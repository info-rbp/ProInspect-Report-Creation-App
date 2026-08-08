terraform {
  required_version = ">= 1.15.0, < 2.0.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.40"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 7.40"
    }
  }

  backend "gcs" {}
}

provider "google" {
  project               = var.control_project_id
  region                = var.region
  billing_project       = var.control_project_id
  user_project_override = true
}

provider "google-beta" {
  project               = var.control_project_id
  region                = var.region
  billing_project       = var.control_project_id
  user_project_override = true
}

variable "control_project_id" {
  description = "Project containing the Cloud Deploy pipeline, normally production."
  type        = string
}

variable "region" {
  description = "Cloud Deploy region."
  type        = string
  default     = "australia-southeast1"
}

variable "target_projects" {
  description = "Target project IDs."
  type = object({
    development = string
    staging     = string
    production  = string
  })
}

variable "runtime_service_accounts" {
  description = "Runtime service-account emails in each target project."
  type = map(object({
    api        = string
    ai_worker  = string
    pdf_worker = string
  }))
}

variable "labels" {
  description = "Additional labels."
  type        = map(string)
  default     = {}
}

locals {
  targets = {
    development = {
      project_id       = var.target_projects.development
      require_approval = false
    }
    staging = {
      project_id       = var.target_projects.staging
      require_approval = false
    }
    production = {
      project_id       = var.target_projects.production
      require_approval = true
    }
  }

  labels = merge(var.labels, {
    application = "property-condition-report"
    managed_by  = "terraform"
  })

  runtime_accounts = merge([
    for environment, accounts in var.runtime_service_accounts : {
      for service, email in accounts : "${environment}-${service}" => {
        environment = environment
        project_id  = local.targets[environment].project_id
        email       = email
      }
    }
  ]...)
}

resource "google_project_service" "cloud_deploy" {
  for_each = toset([
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "clouddeploy.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "logging.googleapis.com",
    "run.googleapis.com",
    "storage.googleapis.com",
  ])

  project                    = var.control_project_id
  service                    = each.value
  disable_on_destroy         = false
  disable_dependent_services = false
}

resource "google_service_account" "execution" {
  project      = var.control_project_id
  account_id   = "pcr-deploy-execution"
  display_name = "PCR Cloud Deploy execution"

  depends_on = [google_project_service.cloud_deploy]
}

resource "google_project_service_identity" "cloud_deploy" {
  provider = google-beta
  project  = var.control_project_id
  service  = "clouddeploy.googleapis.com"

  depends_on = [google_project_service.cloud_deploy]
}

resource "google_service_account_iam_member" "cloud_deploy_uses_execution" {
  service_account_id = google_service_account.execution.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_project_service_identity.cloud_deploy.email}"
}

resource "google_project_iam_member" "execution_control_roles" {
  for_each = toset([
    "roles/clouddeploy.jobRunner",
    "roles/logging.logWriter",
    "roles/storage.objectViewer",
  ])

  project = var.control_project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.execution.email}"
}

resource "google_project_iam_member" "execution_target_run" {
  for_each = local.targets

  project = each.value.project_id
  role    = "roles/run.developer"
  member  = "serviceAccount:${google_service_account.execution.email}"
}

resource "google_service_account_iam_member" "execution_uses_runtime" {
  for_each = local.runtime_accounts

  service_account_id = "projects/${each.value.project_id}/serviceAccounts/${each.value.email}"
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.execution.email}"
}

resource "google_clouddeploy_target" "environment" {
  provider = google-beta
  for_each = local.targets

  project          = var.control_project_id
  location         = var.region
  name             = "pcr-${each.key}"
  description      = "PCR ${title(each.key)} Cloud Run target"
  require_approval = each.value.require_approval
  labels           = merge(local.labels, { environment = each.key })
  deletion_policy  = each.key == "production" ? "PREVENT" : "DELETE"

  run {
    location = "projects/${each.value.project_id}/locations/${var.region}"
  }

  execution_configs {
    usages            = ["RENDER", "DEPLOY"]
    service_account   = google_service_account.execution.email
    execution_timeout = "3600s"
  }

  depends_on = [
    google_project_iam_member.execution_target_run,
    google_service_account_iam_member.execution_uses_runtime,
  ]
}

resource "google_clouddeploy_delivery_pipeline" "platform" {
  provider = google-beta

  project     = var.control_project_id
  location    = var.region
  name        = "pcr-platform"
  description = "Property Condition Report development-to-production delivery pipeline"
  labels      = local.labels

  serial_pipeline {
    stages {
      target_id = google_clouddeploy_target.environment["development"].name
      profiles  = ["development"]
    }

    stages {
      target_id = google_clouddeploy_target.environment["staging"].name
      profiles  = ["staging"]
    }

    stages {
      target_id = google_clouddeploy_target.environment["production"].name
      profiles  = ["production"]
    }
  }

  depends_on = [google_clouddeploy_target.environment]
}

output "delivery_pipeline" {
  value = google_clouddeploy_delivery_pipeline.platform.name
}

output "targets" {
  value = { for environment, target in google_clouddeploy_target.environment : environment => target.name }
}

output "production_requires_approval" {
  value = google_clouddeploy_target.environment["production"].require_approval
}

output "execution_service_account" {
  value = google_service_account.execution.email
}
