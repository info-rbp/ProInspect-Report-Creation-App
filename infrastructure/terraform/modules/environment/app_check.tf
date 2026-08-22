variable "app_check_recaptcha_enterprise_site_key" {
  description = "reCAPTCHA Enterprise score-based site key used by the Firebase web app. The site key is public configuration, not the private secret."
  type        = string
  default     = null
  nullable    = true
}

variable "app_check_enforcement_mode" {
  description = "Firebase App Check service mode. Use UNENFORCED while observing metrics and ENFORCED after staging acceptance."
  type        = string
  default     = "UNENFORCED"
  validation {
    condition     = contains(["UNENFORCED", "ENFORCED"], var.app_check_enforcement_mode)
    error_message = "app_check_enforcement_mode must be UNENFORCED or ENFORCED."
  }
}

resource "google_project_service" "firebase_app_check" {
  project            = var.project_id
  service            = "firebaseappcheck.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "recaptcha_enterprise" {
  project            = var.project_id
  service            = "recaptchaenterprise.googleapis.com"
  disable_on_destroy = false
}

resource "google_firebase_app_check_recaptcha_enterprise_config" "web" {
  provider = google-beta
  count    = var.app_check_recaptcha_enterprise_site_key == null ? 0 : 1

  project   = var.project_id
  app_id    = google_firebase_web_app.web.app_id
  site_key  = var.app_check_recaptcha_enterprise_site_key
  token_ttl = "3600s"

  depends_on = [
    google_firebase_project.this,
    google_firebase_web_app.web,
    google_project_service.firebase_app_check,
    google_project_service.recaptcha_enterprise,
  ]
}

resource "google_firebase_app_check_service_config" "protected_service" {
  for_each = toset([
    "firestore.googleapis.com",
    "firebasestorage.googleapis.com",
    "identitytoolkit.googleapis.com",
  ])

  project          = var.project_id
  service_id       = each.value
  enforcement_mode = var.app_check_enforcement_mode

  lifecycle {
    precondition {
      condition     = var.app_check_enforcement_mode != "ENFORCED" || var.app_check_recaptcha_enterprise_site_key != null
      error_message = "App Check cannot be ENFORCED until app_check_recaptcha_enterprise_site_key is configured for the Firebase web app."
    }
  }

  depends_on = [google_project_service.firebase_app_check]
}

output "app_check" {
  value = {
    enforcement_mode = var.app_check_enforcement_mode
    web_provider_configured = var.app_check_recaptcha_enterprise_site_key != null
  }
}
