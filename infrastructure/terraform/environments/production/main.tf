terraform {
  required_version = ">= 1.15.0, < 2.0.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.40"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 7.40"
    }
  }
  backend "gcs" {}
}

provider "google" {
  project               = var.project_id
  region                = var.region
  billing_project       = var.project_id
  user_project_override = true
}
provider "google-beta" {
  project               = var.project_id
  region                = var.region
  billing_project       = var.project_id
  user_project_override = true
}

variable "project_id" { type = string }
variable "billing_account_id" {
  type      = string
  sensitive = true
}
variable "region" {
  type    = string
  default = "australia-southeast1"
}
variable "identity_authorized_domains" { type = list(string) }
variable "firebase_hosting_site_id" {
  type    = string
  default = null
}
variable "monthly_budget_aud" { type = number }
variable "notification_emails" {
  type    = set(string)
  default = []
}
variable "report_retention_days" {
  type    = number
  default = 365
}

module "environment" {
  source = "../../modules/environment"
  providers = {
    google      = google
    google-beta = google-beta
  }
  project_id                  = var.project_id
  environment                 = "production"
  billing_account_id          = var.billing_account_id
  region                      = var.region
  identity_authorized_domains = var.identity_authorized_domains
  firebase_hosting_site_id    = var.firebase_hosting_site_id
  monthly_budget_aud          = var.monthly_budget_aud
  notification_emails         = var.notification_emails
  report_retention_days       = var.report_retention_days
  api_allow_unauthenticated   = true
}

output "landing_zone" { value = module.environment }
