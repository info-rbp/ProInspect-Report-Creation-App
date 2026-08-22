# Manual/Cloud-Build release fallback.
#
# The existing dedicated cloud_build runtime account already has Artifact
# Registry writer and Cloud Run developer permissions. CLOUD_LOGGING_ONLY builds
# also require direct log writer permission when a user-specified build service
# account is used.
resource "google_project_iam_member" "cloud_build_release_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.runtime["cloud_build"].email}"
}
