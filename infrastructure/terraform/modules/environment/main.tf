terraform {
  required_version = ">= 1.15.0, < 2.0.0"
  required_providers {
    google      = { source = "hashicorp/google", version = "~> 7.40" }
    google-beta = { source = "hashicorp/google-beta", version = "~> 7.40" }
  }
}

variable "project_id" { type = string }
variable "firestore_database_id" {
  type = string
  validation {
    condition     = trimspace(var.firestore_database_id) != "" && var.firestore_database_id != "(default)"
    error_message = "firestore_database_id must name the ProInspect database and cannot be (default)."
  }
}
variable "firestore_location_id" {
  description = "Firestore database location. Existing databases can differ from the primary compute region."
  type        = string
  default     = null
  nullable    = true
}
variable "environment" {
  type = string
  validation {
    condition     = contains(["development", "staging", "production"], var.environment)
    error_message = "environment must be development, staging or production."
  }
}
variable "billing_account_id" {
  type      = string
  sensitive = true
}
variable "region" {
  type    = string
  default = "australia-southeast1"
}
variable "monthly_budget_aud" { type = number }
variable "identity_authorized_domains" {
  type    = list(string)
  default = ["localhost"]
}
variable "firebase_hosting_site_id" {
  type    = string
  default = null
}
variable "notification_emails" {
  type    = set(string)
  default = []
}
variable "api_allow_unauthenticated" {
  type    = bool
  default = true
}
variable "report_retention_days" {
  type    = number
  default = null
}
variable "labels" {
  type    = map(string)
  default = {}
}

locals {
  production = var.environment == "production"
  labels = merge(var.labels, {
    application = "property-condition-report"
    environment = var.environment
    managed_by  = "terraform"
  })
  services = toset([
    "aiplatform.googleapis.com",
    "artifactregistry.googleapis.com",
    "billingbudgets.googleapis.com",
    "calendar-json.googleapis.com",
    "cloudbilling.googleapis.com",
    "cloudbuild.googleapis.com",
    "clouddeploy.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "cloudtasks.googleapis.com",
    "firebase.googleapis.com",
    "firebasehosting.googleapis.com",
    "firestore.googleapis.com",
    "iam.googleapis.com",
    "identitytoolkit.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "pubsub.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "serviceusage.googleapis.com",
    "storage.googleapis.com",
  ])
  runtime_accounts = {
    api          = "PCR API"
    ai_worker    = "PCR AI worker"
    pdf_worker   = "PCR PDF worker"
    cloud_build  = "PCR Cloud Build"
    cloud_deploy = "PCR Cloud Deploy"
  }
}

resource "google_project_service" "required" {
  for_each           = local.services
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

data "google_project" "current" {
  project_id = var.project_id
  depends_on = [google_project_service.required]
}

resource "google_service_account" "runtime" {
  for_each     = local.runtime_accounts
  project      = var.project_id
  account_id   = each.key == "api" ? "proinspect-api" : replace(each.key, "_", "-")
  display_name = each.value
}

resource "google_project_iam_member" "runtime_roles" {
  for_each = {
    api_datastore   = { account = "api", role = "roles/datastore.user" }
    api_pubsub      = { account = "api", role = "roles/pubsub.publisher" }
    ai_vertex       = { account = "ai_worker", role = "roles/aiplatform.user" }
    ai_pubsub       = { account = "ai_worker", role = "roles/pubsub.subscriber" }
    ai_secrets      = { account = "ai_worker", role = "roles/secretmanager.secretAccessor" }
    pdf_datastore   = { account = "pdf_worker", role = "roles/datastore.user" }
    pdf_pubsub      = { account = "pdf_worker", role = "roles/pubsub.subscriber" }
    build_artifacts = { account = "cloud_build", role = "roles/artifactregistry.writer" }
    build_run       = { account = "cloud_build", role = "roles/run.developer" }
    deploy_run      = { account = "cloud_deploy", role = "roles/run.developer" }
  }
  project = var.project_id
  role    = each.value.role
  member  = "serviceAccount:${google_service_account.runtime[each.value.account].email}"
}

resource "google_service_account_iam_member" "build_act_as" {
  for_each           = toset(["api", "ai_worker", "pdf_worker"])
  service_account_id = google_service_account.runtime[each.value].name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.runtime["cloud_build"].email}"
}

resource "google_service_account_iam_member" "deploy_act_as" {
  for_each           = toset(["api", "ai_worker", "pdf_worker"])
  service_account_id = google_service_account.runtime[each.value].name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.runtime["cloud_deploy"].email}"
}

resource "google_artifact_registry_repository" "containers" {
  location      = var.region
  repository_id = "pcr-containers"
  description   = "Property Condition Report service containers"
  format        = "DOCKER"
  labels        = local.labels
  depends_on    = [google_project_service.required]
}

resource "google_storage_bucket" "assets" {
  name                        = "${var.project_id}-pcr-assets"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  labels                      = local.labels
  versioning { enabled = true }
  lifecycle_rule {
    condition { age = 30 }
    action { type = "Delete" }
  }
}

resource "google_storage_bucket" "reports" {
  name                        = "${var.project_id}-pcr-reports"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  labels                      = local.labels
  versioning { enabled = true }
  dynamic "lifecycle_rule" {
    for_each = var.report_retention_days == null ? [] : [var.report_retention_days]
    content {
      condition { age = lifecycle_rule.value }
      action { type = "Delete" }
    }
  }
}

resource "google_service_account" "notification_worker" {
  project      = var.project_id
  account_id   = "notification-worker"
  display_name = "PCR Notification worker"
}

resource "google_service_account" "dashboard_worker" {
  project      = var.project_id
  account_id   = "dashboard-worker"
  display_name = "PCR Dashboard worker"
}

resource "google_service_account" "document_worker" {
  project      = var.project_id
  account_id   = "document-worker"
  display_name = "PCR Document worker"
}

resource "google_service_account" "integration_worker" {
  project      = var.project_id
  account_id   = "integration-worker"
  display_name = "PCR Integration worker"
}

resource "google_project_iam_member" "worker_secret_access" {
  for_each = {
    notification = google_service_account.notification_worker.email
    dashboard    = google_service_account.dashboard_worker.email
    document     = google_service_account.document_worker.email
    integration  = google_service_account.integration_worker.email
  }
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${each.value}"
}

resource "google_project_iam_member" "worker_logging" {
  for_each = {
    notification = google_service_account.notification_worker.email
    dashboard    = google_service_account.dashboard_worker.email
    document     = google_service_account.document_worker.email
    integration  = google_service_account.integration_worker.email
  }
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${each.value}"
}

resource "google_billing_budget" "monthly" {
  billing_account = var.billing_account_id
  display_name    = "${var.project_id}-${var.environment}-monthly"
  amount {
    specified_amount {
      currency_code = "AUD"
      units         = tostring(var.monthly_budget_aud)
    }
  }
  threshold_rules { threshold_percent = 0.5 }
  threshold_rules { threshold_percent = 0.9 }
  threshold_rules { threshold_percent = 1.0 }
  all_updates_rule {
    monitoring_notification_channels = []
    disable_default_iam_recipients    = false
  }
}

output "project_id" { value = data.google_project.current.project_id }
output "container_repository" { value = google_artifact_registry_repository.containers.name }
output "asset_bucket" { value = google_storage_bucket.assets.name }
output "report_bucket" { value = google_storage_bucket.reports.name }
output "service_accounts" {
  value = merge(
    { for k, v in google_service_account.runtime : k => v.email },
    {
      notification_worker = google_service_account.notification_worker.email
      dashboard_worker    = google_service_account.dashboard_worker.email
      document_worker     = google_service_account.document_worker.email
      integration_worker  = google_service_account.integration_worker.email
    }
  )
}
