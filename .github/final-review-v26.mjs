import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const read=(p)=>readFileSync(p,'utf8');
const write=(p,v)=>writeFileSync(p,v);
function replaceOne(path,before,after){const value=read(path);if(!value.includes(before))throw new Error(`Missing patch anchor: ${path}`);if(value.indexOf(before)!==value.lastIndexOf(before))throw new Error(`Non-unique patch anchor: ${path}`);write(path,value.replace(before,after));}

const pkg='infrastructure/upgrades/launch-readiness-v2';

write('.nvmrc','22.23.2\n');

mkdirSync(`${pkg}/actions`,{recursive:true});
write(`${pkg}/actions/runtime-authority.mjs`, `import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, requireThat } from '../runtime.mjs';

export const workerServices=['pdf-worker','notification-worker','dashboard-worker','document-worker','integration-worker'];
const forbiddenRuntimePackages=new Set(['firebase','firebase-admin','@google-cloud/firestore','@google-cloud/storage']);
const forbiddenSource=[
  {id:'firebase-admin',pattern:/['\"]firebase-admin(?:\\/[^'\"]*)?['\"]/u},
  {id:'google-firestore',pattern:/['\"]@google-cloud\\/firestore['\"]/u},
  {id:'google-storage',pattern:/['\"]@google-cloud\\/storage['\"]/u},
  {id:'firestore-helper',pattern:/from\\s+['\"].*firestoreDatabase(?:\\.js|\\.ts)?['\"]/u},
];
const sourceExtensions=new Set(['.js','.mjs','.cjs','.ts','.tsx']);
function walk(directory){if(!existsSync(directory))return [];return readdirSync(directory).flatMap((name)=>{const path=resolve(directory,name);const stat=statSync(path);if(stat.isDirectory())return name==='node_modules'||name==='dist'||name==='coverage'||name==='__tests__'?[]:walk(path);return [path];});}
function isRuntimeSource(path){const name=path.split('/').at(-1)??'';return sourceExtensions.has(extname(path))&&!/(?:^|\\.)(?:test|spec)\\.[^.]+$/u.test(name)&&!name.endsWith('.d.ts');}
export function inspectWorkerAuthority(base=root,services=workerServices){
  const violations=[];
  for(const service of services){
    const packagePath=resolve(base,'apps',service,'package.json');
    if(!existsSync(packagePath)){violations.push({service,path:relative(base,packagePath),reason:'missing-package'});continue;}
    const manifest=JSON.parse(readFileSync(packagePath,'utf8'));
    for(const name of Object.keys(manifest.dependencies??{}))if(forbiddenRuntimePackages.has(name))violations.push({service,path:relative(base,packagePath),reason:'forbidden-runtime-dependency:'+name});
    for(const path of walk(resolve(base,'apps',service,'src')).filter(isRuntimeSource)){
      const source=readFileSync(path,'utf8');
      for(const rule of forbiddenSource)if(rule.pattern.test(source))violations.push({service,path:relative(base,path),reason:'forbidden-runtime-import:'+rule.id});
    }
  }
  return {authority:'appwrite',services:[...services],violations,pass:violations.length===0};
}
export function inspectTerraformAuthority(base=root){
  const directory=resolve(base,'infrastructure/terraform/modules/environment');
  const violations=[];
  for(const path of walk(directory).filter((item)=>item.endsWith('.tf'))){
    const source=readFileSync(path,'utf8');
    const rules=[
      ['datastore-runtime-role',/roles\\/datastore\\.user/u],
      ['application-gcs-assets',/resource\\s+\"google_storage_bucket\"\\s+\"assets\"/u],
      ['application-gcs-reports',/resource\\s+\"google_storage_bucket\"\\s+\"reports\"/u],
      ['document-bucket-runtime',/name\\s*=\\s*\"DOCUMENT_BUCKET\"/u],
      ['report-bucket-runtime',/name\\s*=\\s*\"REPORT_BUCKET\"/u],
      ['firestore-resource',/resource\\s+\"google_firestore_/u],
    ];
    for(const [id,pattern] of rules)if(pattern.test(source))violations.push({path:relative(base,path),reason:id});
  }
  return {authority:'google-compute-only',violations,pass:violations.length===0};
}
export function inspectTargetAuthority(base=root,services=workerServices){const workers=inspectWorkerAuthority(base,services);const terraform=inspectTerraformAuthority(base);return {workers,terraform,pass:workers.pass&&terraform.pass};}
export function assertTargetAuthority(base=root,services=workerServices){const result=inspectTargetAuthority(base,services);const detail=[...result.workers.violations,...result.terraform.violations].map((v)=>v.path+':'+v.reason).join('; ');requireThat(result.pass,'BLOCKED_LEGACY_RUNTIME: '+detail);return result;}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const report=inspectTargetAuthority(root);console.log(JSON.stringify(report,null,2));if(!report.pass)process.exitCode=1;
}
`);

replaceOne(`${pkg}/actions/source.mjs`,
`import { run,root,atomicJson } from '../runtime.mjs';`,
`import { run,root,atomicJson } from '../runtime.mjs';\nimport { assertTargetAuthority } from './runtime-authority.mjs';`);
replaceOne(`${pkg}/actions/source.mjs`,
`    await run('git',['worktree','add','--detach',checkout,context.commit],{cwd:root});attached=true;\n    for(let i=0;i<commands.length;i++)await run(commands[i][0],commands[i][1],{cwd:checkout,logFile:resolve(directory,\`source-\${i}.log\`),timeoutMs:3600000});\n    const result={commit:context.commit,validated:true,commands:commands.map(([command,args])=>({command,args}))};`,
`    await run('git',['worktree','add','--detach',checkout,context.commit],{cwd:root});attached=true;\n    const authority=assertTargetAuthority(checkout);atomicJson(resolve(directory,'runtime-authority.json'),authority);\n    for(let i=0;i<commands.length;i++)await run(commands[i][0],commands[i][1],{cwd:checkout,logFile:resolve(directory,\`source-\${i}.log\`),timeoutMs:3600000});\n    const result={commit:context.commit,validated:true,authority,commands:commands.map(([command,args])=>({command,args}))};`);

replaceOne(`${pkg}/actions/google.mjs`,
`import { atomicJson, readJson, run, root, requireThat, safePath } from '../runtime.mjs';`,
`import { atomicJson, readJson, run, root, requireThat, safePath } from '../runtime.mjs';\nimport { assertTargetAuthority } from './runtime-authority.mjs';`);
replaceOne(`${pkg}/actions/google.mjs`,
`  return {steps,images,options:{logging:'CLOUD_LOGGING_ONLY'}};`,
`  return {steps,images,serviceAccount:\`projects/\${target.projectId}/serviceAccounts/cloud-build@\${target.projectId}.iam.gserviceaccount.com\`,options:{logging:'CLOUD_LOGGING_ONLY'}};`);
replaceOne(`${pkg}/actions/google.mjs`,
`  return ['--set-env-vars',\`^|^\${Object.entries(vars).map(([k,v])=>\`\${k}=\${v}\`).join('|')}\`,...(secrets.length ? ['--set-secrets',secrets.join(',')] : ['--clear-secrets'])];`,
`  return ['--update-env-vars',\`^|^\${Object.entries(vars).map(([k,v])=>\`\${k}=\${v}\`).join('|')}\`,'--update-secrets',secrets.join(',')];`);
replaceOne(`${pkg}/actions/google.mjs`,
`    const archive=resolve(workspace,'source.tar');const source=resolve(workspace,'source');await run('git',['archive','--format=tar','--output',archive,context.commit],{cwd:root});await run('mkdir',['-p',source]);await run('tar',['-xf',archive,'-C',source]);atomicJson(resolve(workspace,'cloudbuild.json'),cloud);`,
`    const archive=resolve(workspace,'source.tar');const source=resolve(workspace,'source');await run('git',['archive','--format=tar','--output',archive,context.commit],{cwd:root});await run('mkdir',['-p',source]);await run('tar',['-xf',archive,'-C',source]);const authority=assertTargetAuthority(source);atomicJson(resolve(directory,'runtime-authority.json'),authority);atomicJson(resolve(workspace,'cloudbuild.json'),cloud);`);

replaceOne(`${pkg}/configuration.mjs`,
`  requireThat(target.google.aiRuntime === 'api', 'Standalone AI deployment requires a reviewed entrypoint and infrastructure change');`,
`  requireThat(target.google.aiRuntime === 'api', 'Standalone AI deployment requires a reviewed entrypoint and infrastructure change');\n  for (const service of ['api','pdf-worker','notification-worker','dashboard-worker','document-worker','integration-worker']) { const binding=target.google.runtimeBindings?.[service]; requireThat(binding?.env?.AUTH_PROVIDER==='appwrite'&&binding.env.APPWRITE_BACKEND_MODE==='appwrite'&&binding.secretRefs&&typeof binding.secretRefs==='object'&&!Array.isArray(binding.secretRefs), \`Missing Appwrite runtime binding for \${service}\`); }`);

replaceOne('infrastructure/terraform/modules/environment/main.tf',
`    api_datastore   = { account = "api", role = "roles/datastore.user" }\n    api_pubsub      = { account = "api", role = "roles/pubsub.publisher" }`,
`    api_pubsub      = { account = "api", role = "roles/pubsub.publisher" }`);
replaceOne('infrastructure/terraform/modules/environment/main.tf',
`    pdf_datastore   = { account = "pdf_worker", role = "roles/datastore.user" }\n    pdf_pubsub      = { account = "pdf_worker", role = "roles/pubsub.subscriber" }`,
`    pdf_pubsub      = { account = "pdf_worker", role = "roles/pubsub.subscriber" }`);
replaceOne('infrastructure/terraform/modules/environment/main.tf',
`resource "google_storage_bucket" "assets" {\n  name                        = "\${var.project_id}-pcr-assets"\n  location                    = var.region\n  uniform_bucket_level_access = true\n  public_access_prevention    = "enforced"\n  labels                      = local.labels\n  versioning { enabled = true }\n  lifecycle_rule {\n    condition { age = 30 }\n    action { type = "Delete" }\n  }\n}\n\nresource "google_storage_bucket" "reports" {\n  name                        = "\${var.project_id}-pcr-reports"\n  location                    = var.region\n  uniform_bucket_level_access = true\n  public_access_prevention    = "enforced"\n  labels                      = local.labels\n  versioning { enabled = true }\n  dynamic "lifecycle_rule" {\n    for_each = var.report_retention_days == null ? [] : [var.report_retention_days]\n    content {\n      condition { age = lifecycle_rule.value }\n      action { type = "Delete" }\n    }\n  }\n}\n\n`,``);
replaceOne('infrastructure/terraform/modules/environment/main.tf',
`output "asset_bucket" { value = google_storage_bucket.assets.name }\noutput "report_bucket" { value = google_storage_bucket.reports.name }\n`,``);

replaceOne('infrastructure/terraform/modules/environment/platform_enhancement_delivery.tf',
`resource "google_storage_bucket_iam_member" "document_worker_reports" {\n  bucket = google_storage_bucket.reports.name\n  role   = "roles/storage.objectAdmin"\n  member = "serviceAccount:\${google_service_account.enhancement_worker["document-worker"].email}"\n}\n\n`,``);
replaceOne('infrastructure/terraform/modules/environment/platform_enhancement_delivery.tf',
`      env {\n        name  = "DOCUMENT_BUCKET"\n        value = google_storage_bucket.reports.name\n      }\n\n`,``);
replaceOne('infrastructure/terraform/modules/environment/platform_enhancement_delivery.tf',
`    ignore_changes = [template[0].containers[0].image]`,
`    ignore_changes = [template[0].containers[0].image, template[0].containers[0].env]`);
replaceOne('infrastructure/terraform/modules/environment/dashboard_delivery.tf',
`# captured separately with Firestore count aggregations so trend history does\n# not depend on an administrator manually invoking a snapshot endpoint.`,
`# captured separately by the Appwrite-authoritative dashboard worker so trend\n# history does not depend on an administrator manually invoking a snapshot endpoint.`);
replaceOne('infrastructure/terraform/modules/environment/dashboard_delivery.tf',
`    ignore_changes = [template[0].containers[0].image]`,
`    ignore_changes = [template[0].containers[0].image, template[0].containers[0].env]`);
replaceOne('infrastructure/terraform/modules/environment/tenant_delivery.tf',
`    ignore_changes = [template[0].containers[0].image]`,
`    ignore_changes = [template[0].containers[0].image, template[0].containers[0].env]`);
replaceOne('infrastructure/terraform/modules/environment/tenant_delivery.tf',
`# The API creates immutable tenancy-document PDFs in the report bucket and signs\n# short-lived download URLs using its own service account identity.\nresource "google_service_account_iam_member" "api_self_token_creator" {\n  service_account_id = google_service_account.runtime["api"].name\n  role               = "roles/iam.serviceAccountTokenCreator"\n  member             = "serviceAccount:\${google_service_account.runtime["api"].email}"\n}\n\n`,``);
replaceOne('infrastructure/terraform/modules/environment/pdf_delivery.tf',
`# The API also creates immutable archive manifests after finalisation, so it has\n# create-only access to the report bucket in addition to its existing viewer role.\n`,
`# Final report files and archive manifests remain in Appwrite Storage. Google Cloud\n# provides compute and delivery only; it is not an application-file authority.\n`);

const manifest=JSON.parse(read(`${pkg}/manifest.json`));manifest.version='2.6.0';manifest.runtimeAuthority={applicationData:'appwrite',applicationFiles:'appwrite',googleRole:'compute-queues-secrets-monitoring-calendar',workerServices:['pdf-worker','notification-worker','dashboard-worker','document-worker','integration-worker']};write(`${pkg}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');
const packageJson=JSON.parse(read('package.json'));packageJson.scripts['launch:authority']=`node ${pkg}/actions/runtime-authority.mjs`;write('package.json',JSON.stringify(packageJson,null,2)+'\n');

write(`${pkg}/tests/authority.test.mjs`, `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { mkdtempSync,mkdirSync,writeFileSync,rmSync } from 'node:fs';\nimport { tmpdir } from 'node:os';\nimport { resolve } from 'node:path';\nimport { inspectWorkerAuthority } from '../actions/runtime-authority.mjs';\nimport { buildConfiguration,runtimeArguments } from '../actions/google.mjs';\n\ntest('worker authority scanner rejects Firebase runtime dependencies/imports',()=>{const base=mkdtempSync(resolve(tmpdir(),'pi-authority-'));try{mkdirSync(resolve(base,'apps/pdf-worker/src'),{recursive:true});writeFileSync(resolve(base,'apps/pdf-worker/package.json'),JSON.stringify({dependencies:{'firebase-admin':'1.0.0'}}));writeFileSync(resolve(base,'apps/pdf-worker/src/index.ts'),\"import { getFirestore } from 'firebase-admin/firestore';\\n\");const report=inspectWorkerAuthority(base,['pdf-worker']);assert.equal(report.pass,false);assert(report.violations.some((v)=>v.reason.includes('firebase-admin')));}finally{rmSync(base,{recursive:true,force:true});}});\ntest('worker authority scanner accepts Appwrite-only runtime',()=>{const base=mkdtempSync(resolve(tmpdir(),'pi-authority-'));try{mkdirSync(resolve(base,'apps/pdf-worker/src'),{recursive:true});writeFileSync(resolve(base,'apps/pdf-worker/package.json'),JSON.stringify({dependencies:{'@pcr/appwrite-server':'*'}}));writeFileSync(resolve(base,'apps/pdf-worker/src/index.ts'),\"import { createAppwriteServerServices } from '@pcr/appwrite-server';\\n\");assert.equal(inspectWorkerAuthority(base,['pdf-worker']).pass,true);}finally{rmSync(base,{recursive:true,force:true});}});\ntest('Google build uses the provisioned Cloud Build service account',()=>{const target={projectId:'proinspect-development-gcp',region:'australia-southeast1',imageRepository:'pcr-containers',services:['api']};const build=buildConfiguration(target,'a'.repeat(40));assert.equal(build.serviceAccount,'projects/proinspect-development-gcp/serviceAccounts/cloud-build@proinspect-development-gcp.iam.gserviceaccount.com');});\ntest('Cloud Run deployment updates rather than clears Terraform service defaults',()=>{const target={google:{environment:'development',projectId:'proinspect-development-gcp',runtimeBindings:{api:{env:{AUTH_PROVIDER:'appwrite',APPWRITE_BACKEND_MODE:'appwrite'},secretRefs:{APPWRITE_API_KEY:'appwrite-api:1'}}}},appwrite:{endpoint:'https://syd.cloud.appwrite.io/v1',projectId:'proinspect-development',databaseId:'proinspect_core'}};const args=runtimeArguments(target,'api','a'.repeat(40));assert(args.includes('--update-env-vars'));assert(args.includes('--update-secrets'));assert(!args.includes('--set-env-vars'));assert(!args.includes('--clear-secrets'));});\n`);

const marker='## Final deployment hardening v2.6';
if(!read(`${pkg}/README.md`).includes(marker))write(`${pkg}/README.md`,read(`${pkg}/README.md`)+`\n\n${marker}\n\nV2.6 closes the final deployment-ownership gaps found during the pre-release review. The exact Node runtime is pinned in .nvmrc. Google Cloud remains the compute, queue, build, secret, monitoring and Calendar platform, while Appwrite is the application database and file authority. Terraform no longer provisions ProInspect application asset/report buckets or Datastore runtime grants. Launch-managed Cloud Run environment and secret bindings are ignored consistently by Terraform across all six deployable services, preventing a later Terraform apply from erasing Appwrite runtime configuration.\n\nCloud Build now runs under the Terraform-provisioned cloud-build service account. Cloud Run revision deployment uses update semantics for env/secrets so Terraform-provisioned service defaults are preserved rather than cleared. A new \`npm run launch:authority\` audit reports forbidden Firebase/Firestore/Google-Storage dependencies in the five standalone worker runtimes and forbidden target-side Terraform data-plane resources. Both source acceptance and Google deployment independently enforce this check against the exact candidate source. A candidate with a legacy worker data path is therefore blocked before cloud mutation rather than merely failing a later acceptance assertion.\n`);

console.log('Applied final launch-readiness v2.6 hardening.');
