variable "app_check_recaptcha_enterprise_site_key" {
  description = "Deprecated Firebase compatibility input. Unified Appwrite launch environments must leave this unset."
  type        = string
  default     = null
  nullable    = true
  validation {
    condition     = var.app_check_recaptcha_enterprise_site_key == null
    error_message = "Firebase App Check is not part of the unified Appwrite target architecture."
  }
}

variable "app_check_enforcement_mode" {
  description = "Deprecated Firebase compatibility input. Must remain UNENFORCED."
  type        = string
  default     = "UNENFORCED"
  validation {
    condition     = var.app_check_enforcement_mode == "UNENFORCED"
    error_message = "Firebase App Check cannot be enabled in the unified Appwrite target architecture."
  }
}

variable "require_api_app_check" {
  description = "Deprecated Firebase compatibility input. Appwrite auth replaces Firebase App Check for this runtime."
  type        = bool
  default     = false
  validation {
    condition     = var.require_api_app_check == false
    error_message = "Firebase App Check cannot be required by the unified Appwrite API runtime."
  }
}

output "app_check" {
  value = {
    enforcement_mode        = "DISABLED_APPWRITE_TARGET"
    web_provider_configured = false
  }
}
