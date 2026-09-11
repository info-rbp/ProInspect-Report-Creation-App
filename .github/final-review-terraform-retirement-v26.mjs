import { readFileSync,writeFileSync,rmSync } from 'node:fs';
const read=(p)=>readFileSync(p,'utf8');
const write=(p,v)=>writeFileSync(p,v);
function removeOne(path,text){const value=read(path);if(!value.includes(text))throw new Error(`Missing retirement anchor: ${path}`);write(path,value.replace(text,''));}
function replaceOne(path,before,after){const value=read(path);if(!value.includes(before))throw new Error(`Missing replacement anchor: ${path}`);write(path,value.replace(before,after));}
const moduleMain='infrastructure/terraform/modules/environment/main.tf';
for(const block of [
`variable "firestore_database_id" {\n  type = string\n  validation {\n    condition     = trimspace(var.firestore_database_id) != "" && var.firestore_database_id != "(default)"\n    error_message = "firestore_database_id must name the ProInspect database and cannot be (default)."\n  }\n}\n`,
`variable "firestore_location_id" {\n  description = "Firestore database location. Existing databases can differ from the primary compute region."\n  type        = string\n  default     = null\n  nullable    = true\n}\n`,
`variable "identity_authorized_domains" {\n  type    = list(string)\n  default = ["localhost"]\n}\n`,
`variable "firebase_hosting_site_id" {\n  type    = string\n  default = null\n}\n`,
`variable "report_retention_days" {\n  type    = number\n  default = null\n}\n`,
]) removeOne(moduleMain,block);
rmSync('infrastructure/terraform/modules/environment/app_check.tf',{force:true});
write('infrastructure/terraform/modules/environment/legacy_authority_retirement.tf',`# State transition only. Legacy ProInspect application files are retained for\n# migration/reconciliation but are no longer managed as target-side authority.\nremoved {\n  from = google_storage_bucket.assets\n  lifecycle { destroy = false }\n}\n\nremoved {\n  from = google_storage_bucket.reports\n  lifecycle { destroy = false }\n}\n`);
for(const env of ['development','staging','production']){
  const path=`infrastructure/terraform/environments/${env}/main.tf`;
  let value=read(path);
  const blocks=[
`variable "firestore_database_id" { type = string }\n`,
`variable "firestore_location_id" {\n  type     = string\n  default  = null\n  nullable = true\n}\n`,
`variable "identity_authorized_domains" { type = list(string) }\n`,
`variable "firebase_hosting_site_id" {\n  type    = string\n  default = null\n}\n`,
`variable "report_retention_days" {\n  type    = number\n  default = null\n}\n`,
`variable "app_check_recaptcha_enterprise_site_key" {\n  type     = string\n  default  = null\n  nullable = true\n}\n`,
`variable "app_check_enforcement_mode" {\n  type    = string\n  default = "UNENFORCED"\n}\n`,
`variable "require_api_app_check" {\n  type    = bool\n  default = false\n}\n`,
  ];
  for(const block of blocks){if(!value.includes(block))throw new Error(`Missing ${env} legacy variable block`);value=value.replace(block,'');}
  for(const line of [
`  firestore_database_id                   = var.firestore_database_id\n`,
`  firestore_location_id                   = var.firestore_location_id\n`,
`  identity_authorized_domains             = var.identity_authorized_domains\n`,
`  firebase_hosting_site_id                = var.firebase_hosting_site_id\n`,
`  report_retention_days                   = var.report_retention_days\n`,
`  app_check_recaptcha_enterprise_site_key = var.app_check_recaptcha_enterprise_site_key\n`,
`  app_check_enforcement_mode              = var.app_check_enforcement_mode\n`,
`  require_api_app_check                   = var.require_api_app_check\n`,
  ]){if(!value.includes(line))throw new Error(`Missing ${env} legacy module argument`);value=value.replace(line,'');}
  write(path,value);
}
const examples={
  development:`project_id         = "proinspect-development-gcp"\nbilling_account_id = "000000-000000-000000"\nmonthly_budget_aud = 250\n\nnotification_emails = ["platform-alerts@example.com"]\n\n# Must exactly match appwrite.runtimeCredentialPolicies service/secretId pairs in the private launch configuration.\nappwrite_runtime_secret_ids = {\n  api                   = "proinspect-api-appwrite"\n  "pdf-worker"          = "proinspect-pdf-worker-appwrite"\n  "notification-worker" = "proinspect-notification-worker-appwrite"\n  "dashboard-worker"    = "proinspect-dashboard-worker-appwrite"\n  "document-worker"     = "proinspect-document-worker-appwrite"\n  "integration-worker"  = "proinspect-integration-worker-appwrite"\n}\n`,
  staging:`project_id         = "proinspect-staging-gcp"\nbilling_account_id = "000000-000000-000000"\nmonthly_budget_aud = 500\n\nnotification_emails = ["platform-alerts@example.com"]\n\n# Must exactly match appwrite.runtimeCredentialPolicies service/secretId pairs in the private launch configuration.\nappwrite_runtime_secret_ids = {\n  api                   = "proinspect-api-appwrite"\n  "pdf-worker"          = "proinspect-pdf-worker-appwrite"\n  "notification-worker" = "proinspect-notification-worker-appwrite"\n  "dashboard-worker"    = "proinspect-dashboard-worker-appwrite"\n  "document-worker"     = "proinspect-document-worker-appwrite"\n  "integration-worker"  = "proinspect-integration-worker-appwrite"\n}\n`,
  production:`# Deliberately not the prohibited legacy Google/Firebase project. Replace this with\n# the dedicated, environment-labelled ProInspect Production Google Cloud project.\nproject_id         = "proinspect-production-gcp"\nbilling_account_id = "000000-000000-000000"\nmonthly_budget_aud = 2000\n\nnotification_emails = [\n  "platform-alerts@example.com",\n  "finance-alerts@example.com",\n]\n\n# Must exactly match appwrite.runtimeCredentialPolicies service/secretId pairs in the private Production release configuration.\nappwrite_runtime_secret_ids = {\n  api                   = "proinspect-api-appwrite"\n  "pdf-worker"          = "proinspect-pdf-worker-appwrite"\n  "notification-worker" = "proinspect-notification-worker-appwrite"\n  "dashboard-worker"    = "proinspect-dashboard-worker-appwrite"\n  "document-worker"     = "proinspect-document-worker-appwrite"\n  "integration-worker"  = "proinspect-integration-worker-appwrite"\n}\n`,
};
for(const [env,content] of Object.entries(examples))write(`infrastructure/terraform/environments/${env}/terraform.tfvars.example`,content);
const terraformPath='infrastructure/upgrades/launch-readiness-v2/actions/terraform.mjs';
let terraform=read(terraformPath);
replaceOne(terraformPath,
`export function validateTerraformPlan(plan,projectId) {\n  requireThat(plan.errored !== true,'Terraform plan contains an error');\n  for(const item of plan.resource_changes ?? []) {\n    requireThat(!item.change.actions.includes('delete'),'Destructive Terraform deletion/replacement is blocked');`,
`const approvedLegacyIamRevocations=[\n  /^module\\.environment\\.google_project_iam_member\\.runtime_roles\\[\"(?:api_datastore|pdf_datastore)\"\\]$/u,\n  /^module\\.environment\\.google_storage_bucket_iam_member\\.document_worker_reports$/u,\n  /^module\\.environment\\.google_service_account_iam_member\\.api_self_token_creator$/u,\n];\nfunction approvedLegacyRevocation(item){return item.change.actions.length===1&&item.change.actions[0]==='delete'&&approvedLegacyIamRevocations.some((pattern)=>pattern.test(item.address));}\nexport function validateTerraformPlan(plan,projectId) {\n  requireThat(plan.errored !== true,'Terraform plan contains an error');\n  for(const item of plan.resource_changes ?? []) {\n    requireThat(!item.change.actions.includes('delete')||approvedLegacyRevocation(item),'Destructive Terraform deletion/replacement is blocked');`);
const testPath='infrastructure/upgrades/launch-readiness-v2/tests/installer.test.mjs';
let tests=read(testPath);
if(!tests.includes('Terraform allows only named legacy authority revocations'))tests+=`\ntest('Terraform allows only named legacy authority revocations',()=>{const allowed={resource_changes:[{address:'module.environment.google_project_iam_member.runtime_roles["api_datastore"]',change:{actions:['delete'],after:null,after_unknown:{}}}]};assert.doesNotThrow(()=>validateTerraformPlan(allowed,'p'));const denied={resource_changes:[{address:'module.environment.google_storage_bucket.reports',change:{actions:['delete'],after:null,after_unknown:{}}}]};assert.throws(()=>validateTerraformPlan(denied,'p'),/Destructive/);});\n`;
write(testPath,tests);
const readmePath='infrastructure/upgrades/launch-readiness-v2/README.md';
let readme=read(readmePath);
if(!readme.includes('legacy Terraform state transition'))readme+='\nV2.6 includes a legacy Terraform state transition: any previously tracked ProInspect asset/report buckets are forgotten with `destroy = false`, preserving source data for migration/reconciliation, while only the specifically named obsolete Datastore/storage IAM grants may be revoked. All other Terraform deletions and replacements remain blocked. The checked-in tfvars examples contain no Firebase/Firestore target configuration and the Production example no longer references the prohibited legacy Google project.\n';
write(readmePath,readme);
console.log('Applied safe legacy Terraform authority retirement.');
