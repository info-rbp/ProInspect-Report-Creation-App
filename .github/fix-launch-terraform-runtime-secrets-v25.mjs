import { readFileSync, writeFileSync } from 'node:fs';
const read=(path)=>readFileSync(path,'utf8');
const write=(path,value)=>writeFileSync(path,value);
function replaceOne(path,before,after){const value=read(path);if(!value.includes(before))throw new Error(`Missing runtime-secret anchor: ${path}`);if(value.indexOf(before)!==value.lastIndexOf(before))throw new Error(`Non-unique runtime-secret anchor: ${path}`);write(path,value.replace(before,after));}

const moduleMain='infrastructure/terraform/modules/environment/main.tf';
replaceOne(moduleMain,
`variable "report_retention_days" {\n  type    = number\n  default = null\n}`,
`variable "report_retention_days" {\n  type    = number\n  default = null\n}\nvariable "appwrite_runtime_secret_ids" {\n  description = "Per-service Secret Manager containers for short-lived Appwrite runtime credentials. Keys are canonical Cloud Run service names."\n  type        = map(string)\n  default     = {}\n  validation {\n    condition = (\n      alltrue([for service, value in var.appwrite_runtime_secret_ids : contains(["api", "pdf-worker", "notification-worker", "dashboard-worker", "document-worker", "integration-worker"], service) && can(regex("^[a-z][a-z0-9_-]{2,200}$", value))]) &&\n      length(values(var.appwrite_runtime_secret_ids)) == length(toset(values(var.appwrite_runtime_secret_ids)))\n    )\n    error_message = "appwrite_runtime_secret_ids must map canonical services to unique valid Secret Manager secret IDs."\n  }\n}`);

const duplicateWorkers=`resource "google_service_account" "notification_worker" {\n  project      = var.project_id\n  account_id   = "notification-worker"\n  display_name = "PCR Notification worker"\n}\n\nresource "google_service_account" "dashboard_worker" {\n  project      = var.project_id\n  account_id   = "dashboard-worker"\n  display_name = "PCR Dashboard worker"\n}\n\nresource "google_service_account" "document_worker" {\n  project      = var.project_id\n  account_id   = "document-worker"\n  display_name = "PCR Document worker"\n}\n\nresource "google_service_account" "integration_worker" {\n  project      = var.project_id\n  account_id   = "integration-worker"\n  display_name = "PCR Integration worker"\n}\n\nresource "google_project_iam_member" "worker_secret_access" {\n  for_each = {\n    notification = google_service_account.notification_worker.email\n    dashboard    = google_service_account.dashboard_worker.email\n    document     = google_service_account.document_worker.email\n    integration  = google_service_account.integration_worker.email\n  }\n  project = var.project_id\n  role    = "roles/secretmanager.secretAccessor"\n  member  = "serviceAccount:\${each.value}"\n}\n\nresource "google_project_iam_member" "worker_logging" {\n  for_each = {\n    notification = google_service_account.notification_worker.email\n    dashboard    = google_service_account.dashboard_worker.email\n    document     = google_service_account.document_worker.email\n    integration  = google_service_account.integration_worker.email\n  }\n  project = var.project_id\n  role    = "roles/logging.logWriter"\n  member  = "serviceAccount:\${each.value}"\n}\n\n`;
replaceOne(moduleMain,duplicateWorkers,'');

replaceOne(moduleMain,
`resource "google_billing_budget" "monthly" {`,
`locals {\n  appwrite_runtime_service_accounts = {\n    api                   = google_service_account.runtime["api"].email\n    "pdf-worker"          = google_service_account.runtime["pdf_worker"].email\n    "notification-worker" = google_service_account.notification_worker.email\n    "dashboard-worker"    = google_service_account.dashboard_worker.email\n    "document-worker"     = google_service_account.enhancement_worker["document-worker"].email\n    "integration-worker"  = google_service_account.enhancement_worker["integration-worker"].email\n  }\n}\n\nresource "google_secret_manager_secret" "appwrite_runtime" {\n  for_each  = var.appwrite_runtime_secret_ids\n  project   = var.project_id\n  secret_id = each.value\n\n  replication {\n    auto {}\n  }\n\n  labels = merge(local.labels, { capability = "appwrite-runtime" })\n  depends_on = [google_project_service.required]\n}\n\nresource "google_secret_manager_secret_iam_member" "appwrite_runtime_access" {\n  for_each  = var.appwrite_runtime_secret_ids\n  project   = var.project_id\n  secret_id = google_secret_manager_secret.appwrite_runtime[each.key].id\n  role      = "roles/secretmanager.secretAccessor"\n  member    = "serviceAccount:\${local.appwrite_runtime_service_accounts[each.key]}"\n}\n\nresource "google_billing_budget" "monthly" {`);
replaceOne(moduleMain,
`output "report_bucket" { value = google_storage_bucket.reports.name }`,
`output "report_bucket" { value = google_storage_bucket.reports.name }\noutput "appwrite_runtime_secret_ids" { value = var.appwrite_runtime_secret_ids }`);
replaceOne(moduleMain,
`      notification_worker = google_service_account.notification_worker.email\n      dashboard_worker    = google_service_account.dashboard_worker.email\n      document_worker     = google_service_account.document_worker.email\n      integration_worker  = google_service_account.integration_worker.email`,
`      notification_worker = google_service_account.notification_worker.email\n      dashboard_worker    = google_service_account.dashboard_worker.email\n      document_worker     = google_service_account.enhancement_worker["document-worker"].email\n      integration_worker  = google_service_account.enhancement_worker["integration-worker"].email`);

for(const environment of ['development','staging','production']){
  const path=`infrastructure/terraform/environments/${environment}/main.tf`;
  replaceOne(path,
`variable "require_api_app_check" {\n  type    = bool\n  default = false\n}`,
`variable "require_api_app_check" {\n  type    = bool\n  default = false\n}\nvariable "appwrite_runtime_secret_ids" {\n  type    = map(string)\n  default = {}\n}`);
  replaceOne(path,
`  require_api_app_check                   = var.require_api_app_check`,
`  require_api_app_check                   = var.require_api_app_check\n  appwrite_runtime_secret_ids              = var.appwrite_runtime_secret_ids`);
  const example=`infrastructure/terraform/environments/${environment}/terraform.tfvars.example`;
  if(read(example).includes('appwrite_runtime_secret_ids'))throw new Error(`Runtime secret example already present: ${example}`);
  write(example,read(example)+`\n# Must exactly match appwrite.runtimeCredentialPolicies service/secretId pairs in the private launch configuration.\nappwrite_runtime_secret_ids = {\n  api                   = "proinspect-api-appwrite"\n  "pdf-worker"          = "proinspect-pdf-worker-appwrite"\n  "notification-worker" = "proinspect-notification-worker-appwrite"\n  "dashboard-worker"    = "proinspect-dashboard-worker-appwrite"\n  "document-worker"     = "proinspect-document-worker-appwrite"\n  "integration-worker"  = "proinspect-integration-worker-appwrite"\n}\n`);
}

const terraform='infrastructure/upgrades/launch-readiness-v2/actions/terraform.mjs';
replaceOne(terraform,
`  requireThat(vars.project_id===target.google.projectId && vars.region===target.google.region,'Terraform variables target mismatch');`,
`  requireThat(vars.project_id===target.google.projectId && vars.region===target.google.region,'Terraform variables target mismatch');\n  const policySecrets=Object.fromEntries((target.appwrite.runtimeCredentialPolicies ?? []).map((item)=>[item.service,item.secretId]));\n  requireThat(canonical(vars.appwrite_runtime_secret_ids ?? {})===canonical(policySecrets),'Terraform Appwrite runtime Secret Manager containers must exactly match service credential policy secret IDs');`);

console.log('Removed duplicate worker declarations and aligned least-privilege Terraform Secret Manager containers with Appwrite runtime credential policies.');
