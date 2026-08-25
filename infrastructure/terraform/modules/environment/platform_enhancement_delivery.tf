# Platform enhancement asynchronous workers.
# Document rendering and PMS synchronisation use the same private Cloud Run +
# Pub/Sub push pattern as PDF generation. Neither worker is granted financial
# transaction privileges; PMS sync is limited in application code to operational
# resources and coarse external status.

locals {
  enhancement_workers = {
    "document-worker" = {
      account_id   = "document-worker"
      display_name = "PCR tenancy document worker"
      topic        = "document-generation-requests"
      subscription = "document-generation-worker"
    }
    "integration-worker" = {
      account_id   = "integration-worker"
      display_name = "PCR PMS integration worker"
      topic        = "integration-sync-requests"
      subscription = "integration-sync-worker"
    }
  }
}

resource "google_service_account" "enhancement_worker" {
  for_each     = local.enhancement_workers
  project      = var.project_id
  account_id   = each.value.account_id
  display_name = each.value.display_name
}

resource "google_project_iam_member" "enhancement_worker_datastore" {
  for_each = local.enhancement_workers
  project  = var.project_id
  role     = "roles/datastore.user"
  member   = "serviceAccount:${google_service_account.enhancement_worker[each.key].email}"
}

resource "google_project_iam_member" "enhancement_worker_pubsub" {
  for_each = local.enhancement_workers
  project  = var.project_id
  role     = "roles/pubsub.subscriber"
  member   = "serviceAccount:${google_service_account.enhancement_worker[each.key].email}"
}

resource "google_project_iam_member" "integration_worker_secrets" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.enhancement_worker["integration-worker"].email}"
}

resource "google_storage_bucket_iam_member" "document_worker_reports" {
  bucket = google_storage_bucket.reports.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.enhancement_worker["document-worker"].email}"
}

resource "google_service_account_iam_member" "build_enhancement_worker_act_as" {
  for_each           = local.enhancement_workers
  service_account_id = google_service_account.enhancement_worker[each.key].name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.runtime["cloud_build"].email}"
}

resource "google_service_account_iam_member" "deploy_enhancement_worker_act_as" {
  for_each           = local.enhancement_workers
  service_account_id = google_service_account.enhancement_worker[each.key].name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.runtime["cloud_deploy"].email}"
}

resource "google_pubsub_topic" "enhancement_worker" {
  for_each = local.enhancement_workers
  project  = var.project_id
  name     = each.value.topic
  labels   = local.labels
  message_storage_policy {
    allowed_persistence_regions = [var.region]
    enforce_in_transit          = true
  }
}

resource "google_cloud_run_v2_service" "enhancement_worker" {
  for_each            = local.enhancement_workers
  project             = var.project_id
  location            = var.region
  name                = each.key
  ingress             = "INGRESS_TRAFFIC_INTERNAL_ONLY"
  deletion_protection = local.production
  labels              = local.labels

  template {
    service_account = google_service_account.enhancement_worker[each.key].email

    scaling {
      min_instance_count = 0
      max_instance_count = local.production ? 10 : 3
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
      env {
        name  = "FIRESTORE_DATABASE_ID"
        value = var.firestore_database_id
      }
      env {
        name  = "DOCUMENT_BUCKET"
        value = google_storage_bucket.reports.name
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
    google_project_iam_member.enhancement_worker_datastore,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "enhancement_worker_pubsub_invoker" {
  for_each = local.enhancement_workers
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.enhancement_worker[each.key].name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.enhancement_worker[each.key].email}"
}

resource "google_service_account_iam_member" "pubsub_enhancement_token_creator" {
  for_each           = local.enhancement_workers
  service_account_id = google_service_account.enhancement_worker[each.key].name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_project_service_identity.pubsub_agent.email}"
}

resource "google_pubsub_subscription" "enhancement_worker" {
  for_each                   = local.enhancement_workers
  project                    = var.project_id
  name                       = each.value.subscription
  topic                      = google_pubsub_topic.enhancement_worker[each.key].name
  ack_deadline_seconds       = 600
  message_retention_duration = "604800s"
  retain_acked_messages      = false
  labels                     = local.labels

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  push_config {
    push_endpoint = google_cloud_run_v2_service.enhancement_worker[each.key].uri

    oidc_token {
      service_account_email = google_service_account.enhancement_worker[each.key].email
      audience              = google_cloud_run_v2_service.enhancement_worker[each.key].uri
    }

    attributes = {
      x-goog-version = "v1"
    }
  }

  depends_on = [
    google_cloud_run_v2_service_iam_member.enhancement_worker_pubsub_invoker,
    google_service_account_iam_member.pubsub_enhancement_token_creator,
  ]
}

output "enhancement_worker_uris" {
  value = { for name, service in google_cloud_run_v2_service.enhancement_worker : name => service.uri }
}
