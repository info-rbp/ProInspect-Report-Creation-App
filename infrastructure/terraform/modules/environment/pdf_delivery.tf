# Production PDF and archive delivery wiring.
#
# The API publishes final-PDF jobs to google_pubsub_topic.pdf. Pub/Sub pushes the
# authenticated payload to the private pdf-worker Cloud Run service. This keeps
# retries outside the browser/API process while preserving IAM-only access.
#
# The API also creates immutable archive manifests after finalisation, so it has
# create-only access to the report bucket in addition to its existing viewer role.

resource "google_storage_bucket_iam_member" "pdf_worker_upload_viewer" {
  bucket = google_storage_bucket.uploads.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.runtime["pdf_worker"].email}"
}

resource "google_storage_bucket_iam_member" "api_report_archive_creator" {
  bucket = google_storage_bucket.reports.name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.runtime["api"].email}"
}

resource "google_cloud_run_v2_service_iam_member" "pdf_worker_pubsub_invoker" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.service["pdf-worker"].name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.runtime["pdf_worker"].email}"
}

resource "google_project_service_identity" "pubsub_agent" {
  provider   = google-beta
  project    = var.project_id
  service    = "pubsub.googleapis.com"
  depends_on = [google_project_service.required]
}

resource "google_service_account_iam_member" "pubsub_pdf_token_creator" {
  service_account_id = google_service_account.runtime["pdf_worker"].name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_project_service_identity.pubsub_agent.email}"
}

resource "google_pubsub_subscription" "pdf_worker" {
  project                    = var.project_id
  name                       = "pdf-generation-worker"
  topic                      = google_pubsub_topic.pdf.name
  ack_deadline_seconds       = 600
  message_retention_duration = "604800s"
  retain_acked_messages      = false
  labels                     = local.labels

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  push_config {
    push_endpoint = "${google_cloud_run_v2_service.service["pdf-worker"].uri}/tasks/pdf"
    oidc_token {
      service_account_email = google_service_account.runtime["pdf_worker"].email
      audience              = google_cloud_run_v2_service.service["pdf-worker"].uri
    }
    attributes = {
      x-goog-version = "v1"
    }
  }

  depends_on = [
    google_cloud_run_v2_service_iam_member.pdf_worker_pubsub_invoker,
    google_service_account_iam_member.pubsub_pdf_token_creator,
  ]
}
