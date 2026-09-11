# Scheduled dashboard history aggregation.
#
# Live Dashboard reads remain server-authoritative. Historical daily metrics are
# captured separately by the Appwrite-authoritative dashboard worker so trend
# history does not depend on an administrator manually invoking a snapshot endpoint.

resource "google_service_account" "dashboard_worker" {
  project      = var.project_id
  account_id   = "dashboard-worker"
  display_name = "PCR dashboard metrics worker"
}

resource "google_service_account_iam_member" "build_dashboard_act_as" {
  service_account_id = google_service_account.dashboard_worker.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.runtime["cloud_build"].email}"
}

resource "google_service_account_iam_member" "deploy_dashboard_act_as" {
  service_account_id = google_service_account.dashboard_worker.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.runtime["cloud_deploy"].email}"
}

resource "google_cloud_run_v2_service" "dashboard_worker" {
  project             = var.project_id
  location            = var.region
  name                = "dashboard-worker"
  ingress             = "INGRESS_TRAFFIC_INTERNAL_ONLY"
  deletion_protection = local.production
  labels              = local.labels

  template {
    service_account = google_service_account.dashboard_worker.email

    scaling {
      min_instance_count = 0
      max_instance_count = 2
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
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].containers[0].image, template[0].containers[0].env]
  }

  depends_on = [google_project_service.required]
}

resource "google_cloud_run_v2_service_iam_member" "dashboard_worker_invoker" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.dashboard_worker.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.dashboard_worker.email}"
}

resource "google_service_account_iam_member" "scheduler_dashboard_token_creator" {
  service_account_id = google_service_account.dashboard_worker.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_project_service_identity.scheduler_agent.email}"
}

resource "google_cloud_scheduler_job" "dashboard_daily_snapshot" {
  project          = var.project_id
  region           = var.region
  name             = "dashboard-daily-snapshot"
  description      = "Capture bounded daily dashboard metrics for historical trend analysis"
  schedule         = "55 23 * * *"
  time_zone        = "Australia/Perth"
  attempt_deadline = "300s"

  retry_config {
    retry_count          = 3
    min_backoff_duration = "30s"
    max_backoff_duration = "300s"
    max_doublings        = 3
  }

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.dashboard_worker.uri}/tasks/daily-snapshot"

    oidc_token {
      service_account_email = google_service_account.dashboard_worker.email
      audience              = google_cloud_run_v2_service.dashboard_worker.uri
    }
  }

  depends_on = [
    google_cloud_run_v2_service_iam_member.dashboard_worker_invoker,
    google_service_account_iam_member.scheduler_dashboard_token_creator,
  ]
}

output "dashboard_worker_uri" {
  value = google_cloud_run_v2_service.dashboard_worker.uri
}
