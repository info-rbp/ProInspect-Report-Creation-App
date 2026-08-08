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
  account_id   = replace(each.key, "_", "-")
  display_name = each.value
}

resource "google_project_iam_member" "runtime_roles" {
  for_each = {
    api_datastore   = { account = "api", role = "roles/datastore.user" }
    api_pubsub      = { account = "api", role = "roles/pubsub.publisher" }
    api_tasks       = { account = "api", role = "roles/cloudtasks.enqueuer" }
    api_secrets     = { account = "api", role = "roles/secretmanager.secretAccessor" }
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

resource "google_storage_bucket" "uploads" {
  name                        = "${var.project_id}-uploads"
  project                     = var.project_id
  location                    = upper(var.region)
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = !local.production
  labels                      = local.labels
  versioning { enabled = true }
  lifecycle_rule {
    condition { age = local.production ? 90 : 30 }
    action { type = "Delete" }
  }
  depends_on = [google_project_service.required]
}

resource "google_storage_bucket" "reports" {
  name                        = "${var.project_id}-reports"
  project                     = var.project_id
  location                    = upper(var.region)
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = local.labels
  versioning { enabled = true }
  dynamic "retention_policy" {
    for_each = var.report_retention_days == null ? [] : [var.report_retention_days]
    content { retention_period = retention_policy.value * 86400 }
  }
  depends_on = [google_project_service.required]
}

resource "google_storage_bucket_iam_member" "upload_access" {
  for_each = {
    api = "roles/storage.objectAdmin"
    ai  = "roles/storage.objectViewer"
  }
  bucket = google_storage_bucket.uploads.name
  role   = each.value
  member = each.key == "api" ? "serviceAccount:${google_service_account.runtime["api"].email}" : "serviceAccount:${google_service_account.runtime["ai_worker"].email}"
}

resource "google_storage_bucket_iam_member" "report_access" {
  for_each = {
    api = "roles/storage.objectViewer"
    pdf = "roles/storage.objectAdmin"
  }
  bucket = google_storage_bucket.reports.name
  role   = each.value
  member = each.key == "api" ? "serviceAccount:${google_service_account.runtime["api"].email}" : "serviceAccount:${google_service_account.runtime["pdf_worker"].email}"
}

resource "google_artifact_registry_repository" "containers" {
  project       = var.project_id
  location      = var.region
  repository_id = "pcr-containers"
  format        = "DOCKER"
  description   = "Property Condition Report containers"
  labels        = local.labels
  docker_config { immutable_tags = local.production }
  depends_on = [google_project_service.required]
}

resource "google_pubsub_topic" "analysis" {
  name    = "analysis-requests"
  project = var.project_id
  labels  = local.labels
  message_storage_policy {
    allowed_persistence_regions = [var.region]
    enforce_in_transit          = true
  }
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

resource "google_pubsub_topic" "billing" {
  name    = "billing-alerts"
  project = var.project_id
  labels  = local.labels
}

resource "google_cloud_tasks_queue" "analysis" {
  project  = var.project_id
  location = var.region
  name     = "analysis-requests"
  rate_limits {
    max_concurrent_dispatches = 20
    max_dispatches_per_second = 10
  }
  retry_config {
    max_attempts  = 5
    min_backoff   = "5s"
    max_backoff   = "300s"
    max_doublings = 5
  }
  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret" "runtime" {
  for_each  = toset(["external-api-config", "shopify-webhook-secret", "email-provider-config"])
  project   = var.project_id
  secret_id = each.value
  labels    = local.labels
  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
  depends_on = [google_project_service.required]
}

resource "google_firestore_database" "default" {
  project                           = var.project_id
  name                              = "(default)"
  location_id                       = var.region
  type                              = "FIRESTORE_NATIVE"
  concurrency_mode                  = "OPTIMISTIC"
  app_engine_integration_mode       = "DISABLED"
  point_in_time_recovery_enablement = local.production ? "POINT_IN_TIME_RECOVERY_ENABLED" : "POINT_IN_TIME_RECOVERY_DISABLED"
  delete_protection_state           = local.production ? "DELETE_PROTECTION_ENABLED" : "DELETE_PROTECTION_DISABLED"
  deletion_policy                   = local.production ? "ABANDON" : "DELETE"
  depends_on                        = [google_project_service.required]
}

resource "google_firebase_project" "this" {
  provider   = google-beta
  project    = var.project_id
  depends_on = [google_project_service.required]
}

resource "google_firebase_web_app" "web" {
  provider     = google-beta
  project      = var.project_id
  display_name = "PCR ${title(var.environment)} web"
  depends_on   = [google_firebase_project.this]
}

resource "google_firebase_hosting_site" "web" {
  provider   = google-beta
  project    = var.project_id
  site_id    = coalesce(var.firebase_hosting_site_id, var.project_id)
  app_id     = google_firebase_web_app.web.app_id
  depends_on = [google_firebase_project.this]
}

resource "google_identity_platform_config" "this" {
  provider           = google-beta
  project            = var.project_id
  authorized_domains = var.identity_authorized_domains
  sign_in {
    email {
      enabled           = true
      password_required = true
    }
    anonymous { enabled = false }
  }
  depends_on = [google_project_service.required]
}

resource "google_cloud_run_v2_service" "service" {
  for_each = {
    api        = { account = "api", public = var.api_allow_unauthenticated }
    ai-worker  = { account = "ai_worker", public = false }
    pdf-worker = { account = "pdf_worker", public = false }
  }
  project             = var.project_id
  location            = var.region
  name                = each.key
  ingress             = each.value.public ? "INGRESS_TRAFFIC_ALL" : "INGRESS_TRAFFIC_INTERNAL_ONLY"
  deletion_protection = local.production
  labels              = local.labels
  template {
    service_account = google_service_account.runtime[each.value.account].email
    scaling {
      min_instance_count = 0
      max_instance_count = local.production ? 20 : 5
    }
    containers {
      image = "us-docker.pkg.dev/cloudrun/container/hello"
      env {
        name  = "APP_ENV"
        value = var.environment
      }
      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
      env {
        name  = "VERTEX_AI_LOCATION"
        value = var.region
      }
      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
    }
  }
  lifecycle { ignore_changes = [template[0].containers[0].image] }
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

resource "google_logging_project_bucket_config" "regional" {
  project        = var.project_id
  location       = var.region
  retention_days = local.production ? 365 : 30
  bucket_id      = "pcr-regional"
  description    = "Regional PCR application logs"
  depends_on     = [google_project_service.required]
}

resource "google_monitoring_notification_channel" "email" {
  for_each     = var.notification_emails
  project      = var.project_id
  display_name = "PCR ${title(var.environment)} ${each.value}"
  type         = "email"
  labels       = { email_address = each.value }
}

resource "google_monitoring_alert_policy" "cloud_run_errors" {
  project               = var.project_id
  display_name          = "PCR ${title(var.environment)} Cloud Run server errors"
  combiner              = "OR"
  notification_channels = [for channel in google_monitoring_notification_channel.email : channel.name]
  conditions {
    display_name = "Cloud Run 5xx responses"
    condition_threshold {
      filter          = "resource.type = \"cloud_run_revision\" AND metric.type = \"run.googleapis.com/request_count\" AND metric.label.response_code_class = \"5xx\""
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = 5
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }
  depends_on = [google_project_service.required]
}

resource "google_billing_budget" "project" {
  billing_account = var.billing_account_id
  display_name    = "PCR ${title(var.environment)} monthly budget"
  budget_filter { projects = ["projects/${data.google_project.current.number}"] }
  amount {
    specified_amount {
      currency_code = "AUD"
      units         = tostring(var.monthly_budget_aud)
    }
  }
  threshold_rules { threshold_percent = 0.5 }
  threshold_rules { threshold_percent = 0.8 }
  threshold_rules { threshold_percent = 1.0 }
  all_updates_rule {
    pubsub_topic   = google_pubsub_topic.billing.id
    schema_version = "1.0"
  }
}

output "project_id" { value = var.project_id }
output "region" { value = var.region }
output "firebase_hosting_site" { value = google_firebase_hosting_site.web.site_id }
output "cloud_run_services" { value = { for name, service in google_cloud_run_v2_service.service : name => service.uri } }
output "runtime_service_accounts" { value = { for name, account in google_service_account.runtime : name => account.email } }
output "cloud_deploy_service_account" { value = google_service_account.runtime["cloud_deploy"].email }
output "artifact_repository" { value = google_artifact_registry_repository.containers.name }
output "storage_buckets" {
  value = {
    uploads = google_storage_bucket.uploads.name
    reports = google_storage_bucket.reports.name
  }
}
