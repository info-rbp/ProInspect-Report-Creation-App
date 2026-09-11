terraform {
  required_version = ">= 1.15.0, < 2.0.0"
  required_providers {
    google      = { source = "hashicorp/google", version = "~> 7.40" }
    google-beta = { source = "hashicorp/google-beta", version = "~> 7.40" }
  }
}

variable "project_id" { type = string }
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
variable "notification_emails" {
  type    = set(string)
  default = []
}
variable "api_allow_unauthenticated" {
  type    = bool
  default = true
}
variable "appwrite_runtime_secret_ids" {
  description = "Per-service Secret Manager containers for short-lived Appwrite runtime credentials. Keys are canonical Cloud Run service names."
  type        = map(string)
  default     = {}
  validation {
    condition = (
      alltrue([for service, value in var.appwrite_runtime_secret_ids : contains(["api", "pdf-worker", "notification-worker", "dashboard-worker", "document-worker", "integration-worker"], service) && can(regex("^[a-z][a-z0-9_-]{2,200}$", value))]) &&
      length(values(var.appwrite_runtime_secret_ids)) == length(toset(values(var.appwrite_runtime_secret_ids)))
    )
    error_message = "appwrite_runtime_secret_ids must map canonical services to unique valid Secret Manager secret IDs."
  }
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
    "iam.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "pubsub.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "serviceusage.googleapis.com",
    "storage.googleapis.com",
  ])
  core_services = {
    api = {
      service_account = google_service_account.runtime["api"].email
      ingress         = "INGRESS_TRAFFIC_ALL"
      cpu             = "1"
      memory          = "1Gi"
      max_instances   = local.production ? 30 : 5
    }
    "pdf-worker" = {
      service_account = google_service_account.runtime["pdf_worker"].email
      ingress         = "INGRESS_TRAFFIC_INTERNAL_ONLY"
      cpu             = "2"
      memory          = "2Gi"
      max_instances   = local.production ? 20 : 5
    }
  }
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
    api_pubsub      = { account = "api", role = "roles/pubsub.publisher" }
    ai_vertex       = { account = "ai_worker", role = "roles/aiplatform.user" }
    ai_pubsub       = { account = "ai_worker", role = "roles/pubsub.subscriber" }
    ai_secrets      = { account = "ai_worker", role = "roles/secretmanager.secretAccessor" }
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

resource "google_pubsub_topic" "pdf" {
  name    = "pdf-generation-requests"
  project = var.project_id
  labels  = local.labels

  message_storage_policy {
    allowed_persistence_regions = [var.region]
    enforce_in_transit          = true
  }
}

locals {
  appwrite_runtime_service_accounts = {
    api                   = google_service_account.runtime["api"].email
    "pdf-worker"          = google_service_account.runtime["pdf_worker"].email
    "notification-worker" = google_service_account.notification_worker.email
    "dashboard-worker"    = google_service_account.dashboard_worker.email
    "document-worker"     = google_service_account.enhancement_worker["document-worker"].email
    "integration-worker"  = google_service_account.enhancement_worker["integration-worker"].email
  }
}

resource "google_secret_manager_secret" "appwrite_runtime" {
  for_each  = var.appwrite_runtime_secret_ids
  project   = var.project_id
  secret_id = each.value

  replication {
    auto {}
  }

  labels     = merge(local.labels, { capability = "appwrite-runtime" })
  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_iam_member" "appwrite_runtime_access" {
  for_each  = var.appwrite_runtime_secret_ids
  project   = var.project_id
  secret_id = google_secret_manager_secret.appwrite_runtime[each.key].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${local.appwrite_runtime_service_accounts[each.key]}"
}

resource "google_cloud_run_v2_service" "service" {
  for_each            = local.core_services
  project             = var.project_id
  location            = var.region
  name                = each.key
  ingress             = each.value.ingress
  deletion_protection = local.production
  labels              = local.labels

  template {
    service_account = each.value.service_account
    scaling {
      min_instance_count = 0
      max_instance_count = each.value.max_instances
    }
    containers {
      image = "us-docker.pkg.dev/cloudrun/container/hello"
      env {
        name  = "APP_ENV"
        value = var.environment
      }
      env {
        name  = "NODE_ENV"
        value = local.production ? "production" : "development"
      }
      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
      resources {
        limits = { cpu = each.value.cpu, memory = each.value.memory }
      }
    }
  }
  lifecycle {
    ignore_changes = [template[0].containers[0].image, template[0].containers[0].env]
  }
  depends_on = [google_project_service.required]
}

resource "google_cloud_run_v2_service_iam_member" "api_public" {
  count    = var.api_allow_unauthenticated ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.service["api"].name
  role     = "roles/run.invoker"
  member   = "allUsers"
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
    disable_default_iam_recipients   = false
  }
}

output "project_id" { value = data.google_project.current.project_id }
output "container_repository" { value = google_artifact_registry_repository.containers.name }
output "api_url" { value = google_cloud_run_v2_service.service["api"].uri }
output "pdf_worker_url" { value = google_cloud_run_v2_service.service["pdf-worker"].uri }
output "appwrite_runtime_secret_ids" { value = var.appwrite_runtime_secret_ids }
output "service_accounts" {
  value = merge(
    { for k, v in google_service_account.runtime : k => v.email },
    {
      notification_worker = google_service_account.notification_worker.email
      dashboard_worker    = google_service_account.dashboard_worker.email
      document_worker     = google_service_account.enhancement_worker["document-worker"].email
      integration_worker  = google_service_account.enhancement_worker["integration-worker"].email
    }
  )
}
