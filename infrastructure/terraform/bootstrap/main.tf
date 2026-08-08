terraform {
  required_version = ">= 1.15.0, < 2.0.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.40"
    }
  }
}

provider "google" {
  billing_project       = var.bootstrap_billing_project_id
  user_project_override = var.bootstrap_billing_project_id != null
}

variable "billing_account_id" {
  description = "Billing account attached to all environment projects."
  type        = string
  sensitive   = true
}

variable "bootstrap_billing_project_id" {
  description = "Optional quota/billing project used by Application Default Credentials."
  type        = string
  default     = null
}

variable "folder_id" {
  description = "Optional parent folder ID. Supply either folder_id or organization_id."
  type        = string
  default     = null
}

variable "organization_id" {
  description = "Optional parent organisation ID. Supply either organization_id or folder_id."
  type        = string
  default     = null
}

variable "project_ids" {
  description = "Globally unique project IDs for each environment."
  type = object({
    development = string
    staging     = string
    production  = string
  })
}

variable "region" {
  description = "Primary region."
  type        = string
  default     = "australia-southeast1"
}

variable "labels" {
  description = "Additional labels applied to all projects."
  type        = map(string)
  default     = {}
}

variable "github_repository" {
  description = "GitHub repository allowed to federate, in owner/name form."
  type        = string
  default     = "info-rbp/Property-Condition-Report"
}

locals {
  projects = {
    development = {
      project_id = var.project_ids.development
      name       = "PCR Development"
      retention  = 7
    }
    staging = {
      project_id = var.project_ids.staging
      name       = "PCR Staging"
      retention  = 14
    }
    production = {
      project_id = var.project_ids.production
      name       = "PCR Production"
      retention  = 30
    }
  }

  terraform_project_roles = toset([
    "roles/aiplatform.admin",
    "roles/artifactregistry.admin",
    "roles/cloudbuild.builds.editor",
    "roles/clouddeploy.admin",
    "roles/cloudtasks.admin",
    "roles/datastore.owner",
    "roles/firebase.admin",
    "roles/iam.serviceAccountAdmin",
    "roles/identityplatform.admin",
    "roles/logging.admin",
    "roles/monitoring.admin",
    "roles/pubsub.admin",
    "roles/resourcemanager.projectIamAdmin",
    "roles/run.admin",
    "roles/secretmanager.admin",
    "roles/serviceusage.serviceUsageAdmin",
    "roles/storage.admin",
  ])
}

module "projects" {
  for_each = local.projects
  source   = "../modules/project"

  project_id           = each.value.project_id
  project_name         = each.value.name
  environment          = each.key
  billing_account_id   = var.billing_account_id
  folder_id            = var.folder_id
  organization_id      = var.organization_id
  region               = var.region
  labels               = var.labels
  state_retention_days = each.value.retention
}

resource "google_service_account" "terraform" {
  for_each = local.projects

  project      = module.projects[each.key].project_id
  account_id   = "pcr-terraform"
  display_name = "PCR Terraform ${title(each.key)}"
}

resource "google_project_iam_member" "terraform" {
  for_each = {
    for binding in flatten([
      for environment, project in local.projects : [
        for role in local.terraform_project_roles : {
          key         = "${environment}-${replace(role, "/", "-")}"
          environment = environment
          role        = role
        }
      ]
    ]) : binding.key => binding
  }

  project = module.projects[each.value.environment].project_id
  role    = each.value.role
  member  = "serviceAccount:${google_service_account.terraform[each.value.environment].email}"
}

resource "google_project_iam_member" "production_delivery_cross_project" {
  for_each = {
    for binding in flatten([
      for environment, project in local.projects : [
        for role in ["roles/iam.serviceAccountAdmin", "roles/resourcemanager.projectIamAdmin", "roles/run.admin"] : {
          key         = "${environment}-${replace(role, "/", "-")}"
          environment = environment
          role        = role
        }
      ]
    ]) : binding.key => binding
  }

  project = module.projects[each.value.environment].project_id
  role    = each.value.role
  member  = "serviceAccount:${google_service_account.terraform["production"].email}"
}

resource "google_billing_account_iam_member" "terraform_budget" {
  for_each = google_service_account.terraform

  billing_account_id = var.billing_account_id
  role               = "roles/billing.costsManager"
  member             = "serviceAccount:${each.value.email}"
}

resource "google_iam_workload_identity_pool" "github" {
  project                   = module.projects["production"].project_id
  workload_identity_pool_id = "github-actions"
  display_name              = "GitHub Actions"
  description               = "Keyless GitHub Actions federation for PCR Terraform"
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = module.projects["production"].project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  display_name                       = "Property Condition Report repository"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.actor"      = "assertion.actor"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }

  attribute_condition = "assertion.repository == '${var.github_repository}' && assertion.ref == 'refs/heads/main'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account_iam_member" "github_federation" {
  for_each = google_service_account.terraform

  service_account_id = each.value.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repository}"
}

output "project_ids" {
  value = { for environment, project in module.projects : environment => project.project_id }
}

output "project_numbers" {
  value = { for environment, project in module.projects : environment => project.project_number }
}

output "state_buckets" {
  value = { for environment, project in module.projects : environment => project.state_bucket }
}

output "github_workload_identity_provider" {
  value = google_iam_workload_identity_pool_provider.github.name
}

output "terraform_service_accounts" {
  value = { for environment, account in google_service_account.terraform : environment => account.email }
}
