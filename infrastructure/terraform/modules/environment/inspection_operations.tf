locals {
  inspection_operations_secret_ids = toset([
    "google-calendar-client-id",
    "google-calendar-client-secret",
    "google-calendar-redirect-uri",
    "integration-token-encryption-key",
    "integration-state-secret",
    "automation-runner-secret",
  ])
}

resource "google_secret_manager_secret" "inspection_operations" {
  for_each  = local.inspection_operations_secret_ids
  project   = var.project_id
  secret_id = each.value

  replication {
    auto {}
  }

  labels = merge(local.labels, {
    capability = "inspection-operations"
  })

  depends_on = [google_project_service.required]
}

output "inspection_operations_secret_ids" {
  description = "Secret Manager containers required by Shopify, Google Calendar and inspection automation. Secret versions are supplied out of band."
  value       = sort(tolist(local.inspection_operations_secret_ids))
}
