import { readFileSync, writeFileSync } from 'node:fs';
const read=(path)=>readFileSync(path,'utf8');
const write=(path,value)=>writeFileSync(path,value);
function replaceOne(path,before,after){const value=read(path);if(!value.includes(before))throw new Error(`Missing runtime-secret anchor: ${path}`);if(value.indexOf(before)!==value.lastIndexOf(before))throw new Error(`Non-unique runtime-secret anchor: ${path}`);write(path,value.replace(before,after));}

const moduleMain='infrastructure/terraform/modules/environment/main.tf';
replaceOne(moduleMain,
`variable "report_retention_days" {\n  type    = number\n  default = null\n}`,
`variable "report_retention_days" {\n  type    = number\n  default = null\n}\nvariable "appwrite_runtime_secret_ids" {\n  description = "Secret Manager containers used for short-lived per-service Appwrite runtime credentials. Values must match the launch credential policy."\n  type        = set(string)\n  default     = []\n  validation {\n    condition     = alltrue([for value in var.appwrite_runtime_secret_ids : can(regex("^[a-z][a-z0-9_-]{2,200}$", value))])\n    error_message = "appwrite_runtime_secret_ids must contain valid Secret Manager secret IDs."\n  }\n}`);
replaceOne(moduleMain,
`resource "google_service_account" "notification_worker" {`,
`resource "google_secret_manager_secret" "appwrite_runtime" {\n  for_each  = var.appwrite_runtime_secret_ids\n  project   = var.project_id\n  secret_id = each.value\n\n  replication {\n    auto {}\n  }\n\n  labels = merge(local.labels, {\n    capability = "appwrite-runtime"\n  })\n\n  depends_on = [google_project_service.required]\n}\n\nresource "google_service_account" "notification_worker" {`);
replaceOne(moduleMain,
`output "report_bucket" { value = google_storage_bucket.reports.name }`,
`output "report_bucket" { value = google_storage_bucket.reports.name }\noutput "appwrite_runtime_secret_ids" { value = sort(tolist(var.appwrite_runtime_secret_ids)) }`);

for(const environment of ['development','staging','production']){
  const path=`infrastructure/terraform/environments/${environment}/main.tf`;
  replaceOne(path,
`variable "require_api_app_check" {\n  type    = bool\n  default = false\n}`,
`variable "require_api_app_check" {\n  type    = bool\n  default = false\n}\nvariable "appwrite_runtime_secret_ids" {\n  type    = set(string)\n  default = []\n}`);
  replaceOne(path,
`  require_api_app_check                   = var.require_api_app_check`,
`  require_api_app_check                   = var.require_api_app_check\n  appwrite_runtime_secret_ids              = var.appwrite_runtime_secret_ids`);
  const example=`infrastructure/terraform/environments/${environment}/terraform.tfvars.example`;
  if(read(example).includes('appwrite_runtime_secret_ids'))throw new Error(`Runtime secret example already present: ${example}`);
  write(example,read(example)+`\n# Must exactly match appwrite.runtimeCredentialPolicies[*].secretId in the private launch configuration.\nappwrite_runtime_secret_ids = [\n  "proinspect-api-appwrite",\n  "proinspect-pdf-worker-appwrite",\n  "proinspect-notification-worker-appwrite",\n  "proinspect-dashboard-worker-appwrite",\n  "proinspect-document-worker-appwrite",\n  "proinspect-integration-worker-appwrite",\n]\n`);
}

const terraform='infrastructure/upgrades/launch-readiness-v2/actions/terraform.mjs';
replaceOne(terraform,
`  requireThat(vars.project_id===target.google.projectId && vars.region===target.google.region,'Terraform variables target mismatch');`,
`  requireThat(vars.project_id===target.google.projectId && vars.region===target.google.region,'Terraform variables target mismatch');\n  const policySecretIds=(target.appwrite.runtimeCredentialPolicies ?? []).map((item)=>item.secretId).sort();\n  requireThat(canonical([...(vars.appwrite_runtime_secret_ids ?? [])].sort())===canonical(policySecretIds),'Terraform Appwrite runtime Secret Manager containers must exactly match runtime credential policy secret IDs');`);

console.log('Aligned Terraform Secret Manager containers with launch Appwrite runtime credential policies.');
