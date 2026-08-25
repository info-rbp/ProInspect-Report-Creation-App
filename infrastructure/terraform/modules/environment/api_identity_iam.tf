// Firebase Admin verifies privileged ID tokens with revocation checking enabled.
// That requires read access to Identity Platform user state. Production already
// has this least-privilege binding; keep Terraform authoritative so a future
// apply cannot drift back to an unusable API runtime identity.
resource "google_project_iam_member" "api_identity_platform_viewer" {
  project = var.project_id
  role    = "roles/identityplatform.viewer"
  member  = "serviceAccount:${google_service_account.runtime["api"].email}"
}
