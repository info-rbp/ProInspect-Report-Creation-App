// The API verifies Firebase ID tokens with revocation checks. Firebase Admin must
// read Identity Platform user state to perform that verification. Keep this
// read-only permission separate from administrative identity roles.
resource "google_project_iam_member" "api_identity_platform_viewer" {
  project = var.project_id
  role    = "roles/identityplatform.viewer"
  member  = "serviceAccount:${google_service_account.runtime["api"].email}"
}
