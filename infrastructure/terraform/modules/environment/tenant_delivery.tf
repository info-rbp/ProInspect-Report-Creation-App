# Tenant communication delivery and scheduled lifecycle automation.
#
# Notification jobs are published by the API to notification-requests. Pub/Sub
# pushes them to a private notification-worker. The same worker is invoked hourly
# by Cloud Scheduler to generate lifecycle notifications and drain delayed/retry
# queues using the agency's governed communication policy.

resource "google_project_service" "cloud_scheduler" {
  project            = var.project_id
  service            = "cloudscheduler.googleapis.com"
  disable_on_destroy = false
}

resource "google_service_account" "notification_worker" {
  project      = var.project_id
  account_id   = "notification-worker"
  display_name = "PCR notification worker"
}

resource "google_project_iam_member" "notification_worker_datastore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.notification_worker.email}"
}

resource "google_project_iam_member" "notification_worker_secrets" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.notification_worker.email}"
}

resource "google_service_account_iam_member" "build_notification_act_as" {
  service_account_id = google_service_account.notification_worker.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.runtime["cloud_build"].email}"
}

resource "google_service_account_iam_member" "deploy_notification_act_as" {
  service_account_id = google_service_account.notification_worker.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.runtime["cloud_deploy"].email}"
}

resource "google_pubsub_topic" "notification" {
  name    = "notification-requests"
  project = var.project_id
  labels  = local.labels

  message_storage_policy {
    allowed_persistence_regions = [var.region]
    enforce_in_transit          = true
  }
}

resource "google_cloud_run_v2_service" "notification_worker" {
  project             = var.project_id
  location            = var.region
  name                = "notification-worker"
  ingress             = "INGRESS_TRAFFIC_INTERNAL_ONLY"
  deletion_protection = local.production
  labels              = local.labels

  template {
    service_account = google_service_account.notification_worker.email

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
        name  = "WEB_APP_BASE_URL"
        value = "https://${google_firebase_hosting_site.web.site_id}.web.app"
      }
      env {
        name  = "NOTIFICATION_CALLBACK_BASE_URL"
        value = google_cloud_run_v2_service.service["api"].uri
      }
      env {
        name = "INTEGRATION_TOKEN_ENCRYPTION_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.inspection_operations["integration-token-encryption-key"].secret_id
            version = "latest"
          }
        }
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].containers[0].image]
  }

  depends_on = [
    google_project_service.required,
    google_project_iam_member.notification_worker_datastore,
    google_project_iam_member.notification_worker_secrets,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "notification_worker_invoker" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.notification_worker.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.notification_worker.email}"
}

resource "google_service_account_iam_member" "pubsub_notification_token_creator" {
  service_account_id = google_service_account.notification_worker.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_project_service_identity.pubsub_agent.email}"
}

resource "google_pubsub_subscription" "notification_worker" {
  project                    = var.project_id
  name                       = "notification-worker"
  topic                      = google_pubsub_topic.notification.name
  ack_deadline_seconds       = 120
  message_retention_duration = "604800s"
  retain_acked_messages      = false
  labels                     = local.labels

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  push_config {
    push_endpoint = "${google_cloud_run_v2_service.notification_worker.uri}/tasks/notification"
    oidc_token {
      service_account_email = google_service_account.notification_worker.email
      audience              = google_cloud_run_v2_service.notification_worker.uri
    }
    attributes = {
      x-goog-version = "v1"
    }
  }

  depends_on = [
    google_cloud_run_v2_service_iam_member.notification_worker_invoker,
    google_service_account_iam_member.pubsub_notification_token_creator,
  ]
}

resource "google_project_service_identity" "scheduler_agent" {
  provider   = google-beta
  project    = var.project_id
  service    = "cloudscheduler.googleapis.com"
  depends_on = [google_project_service.cloud_scheduler]
}

resource "google_service_account_iam_member" "scheduler_notification_token_creator" {
  service_account_id = google_service_account.notification_worker.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_project_service_identity.scheduler_agent.email}"
}

resource "google_cloud_scheduler_job" "tenant_automation" {
  project          = var.project_id
  region           = var.region
  name             = "tenant-lifecycle-automation"
  description      = "Hourly ProInspect communication policy, lifecycle reminder and retry queue automation"
  schedule         = "0 * * * *"
  time_zone        = "Australia/Perth"
  attempt_deadline = "180s"

  retry_config {
    retry_count          = 3
    min_backoff_duration = "30s"
    max_backoff_duration = "300s"
    max_doublings        = 3
  }

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.notification_worker.uri}/tasks/tenant-automation"

    oidc_token {
      service_account_email = google_service_account.notification_worker.email
      audience              = google_cloud_run_v2_service.notification_worker.uri
    }
  }

  depends_on = [
    google_cloud_run_v2_service_iam_member.notification_worker_invoker,
    google_service_account_iam_member.scheduler_notification_token_creator,
  ]
}

# The API creates immutable tenancy-document PDFs in the report bucket and signs
# short-lived download URLs using its own service account identity.
resource "google_service_account_iam_member" "api_self_token_creator" {
  service_account_id = google_service_account.runtime["api"].name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.runtime["api"].email}"
}

output "notification_worker_uri" {
  value = google_cloud_run_v2_service.notification_worker.uri
}
