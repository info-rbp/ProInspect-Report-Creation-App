# State transition only. Legacy ProInspect application files are retained for
# migration/reconciliation but are no longer managed as target-side authority.
removed {
  from = google_storage_bucket.assets
  lifecycle { destroy = false }
}

removed {
  from = google_storage_bucket.reports
  lifecycle { destroy = false }
}
