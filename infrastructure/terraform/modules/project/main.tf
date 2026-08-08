terraform {
  required_version = ">= 1.15.0, < 2.0.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.40"
    }
  }
}

variable "project_id" {
  description = "Globally unique Google Cloud project ID."
  type        = string
}

variable "project_name" {
  description = "Human-readable project name."
  type        = string
}

variable "billing_account_id" {
  description = "Billing account attached to the project."
  type        = string
  sensitive   = true
}

variable "folder_id" {
  description = "Optional folder ID. Supply either folder_id or organization_id."
  type        = string
  default     = null
}

variable "organization_id" {
  description = "Optional organisation ID. Supply either organization_id or folder_id."
  type        = string
  default     = null
}

variable "environment" {
  description = "Environment label."
  type        = string

  validation {
    condition     = contains(["development", "staging", "production"], var.environment)
    error_message = "environment must be development, staging or production."
  }
}

variable "region" {
  description = "Primary Google Cloud region."
  type        = string
  default     = "australia-southeast1"
}

variable "labels" {
  description = "Additional project labels."
  type        = map(string)
  default     = {}
}

variable "state_retention_days" {
  description = "Retention period for Terraform state objects."
  type        = number
  default     = 7
}

locals {
  bootstrap_services = toset([
    "cloudbilling.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "iam.googleapis.com",
    "serviceusage.googleapis.com",
    "storage.googleapis.com",
  ])

  labels = merge(var.labels, {
    application = "property-condition-report"
    environment = var.environment
    managed_by  = "terraform"
  })
}

resource "google_project" "this" {
  project_id          = var.project_id
  name                = var.project_name
  billing_account     = var.billing_account_id
  folder_id           = var.folder_id
  org_id              = var.folder_id == null ? var.organization_id : null
  labels              = local.labels
  auto_create_network = false
  deletion_policy     = var.environment == "production" ? "PREVENT" : "DELETE"

  lifecycle {
    precondition {
      condition     = (var.folder_id == null) != (var.organization_id == null)
      error_message = "Exactly one of folder_id or organization_id must be supplied."
    }
  }
}

resource "google_project_service" "bootstrap" {
  for_each = local.bootstrap_services

  project                    = google_project.this.project_id
  service                    = each.value
  disable_on_destroy         = false
  disable_dependent_services = false
}

resource "google_storage_bucket" "terraform_state" {
  name                        = "${google_project.this.project_id}-tfstate"
  project                     = google_project.this.project_id
  location                    = upper(var.region)
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = local.labels

  versioning {
    enabled = true
  }

  retention_policy {
    retention_period = var.state_retention_days * 86400
    is_locked        = false
  }

  depends_on = [google_project_service.bootstrap]
}

output "project_id" {
  value = google_project.this.project_id
}

output "project_number" {
  value = google_project.this.number
}

output "state_bucket" {
  value = google_storage_bucket.terraform_state.name
}
