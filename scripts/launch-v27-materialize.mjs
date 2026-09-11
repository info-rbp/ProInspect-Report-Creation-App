import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const root=process.cwd();
const read=(path)=>readFileSync(resolve(root,path),'utf8');
const write=(path,value)=>writeFileSync(resolve(root,path),value.endsWith('\n')?value:`${value}\n`);
const json=(path)=>JSON.parse(read(path));
const writeJson=(path,value)=>write(path,JSON.stringify(value,null,2));
function requireThat(ok,message){if(!ok)throw new Error(message);}
function replaceOnce(source,needle,replacement,label){const first=source.indexOf(needle);requireThat(first>=0,`Missing ${label}`);requireThat(source.indexOf(needle,first+needle.length)<0,`Duplicate ${label}`);return source.slice(0,first)+replacement+source.slice(first+needle.length);}

const packageDir='infrastructure/upgrades/launch-readiness-v2';

const configPath=`${packageDir}/config.example.json`;
const config=json(configPath);
for(const environment of ['development','staging']){
  config.environments[environment].shopify.replay={
    syntheticOnly:true,
    agencyId:'dev_agency',
    secretEnv:'SHOPIFY_WEBHOOK_SECRET',
    fixture:`${packageDir}/fixtures/shopify-order-paid.synthetic.json`,
  };
}
writeJson(configPath,config);

const packagePath='package.json';
const pkg=json(packagePath);
Object.assign(pkg.scripts,{
  'launch:preflight':`node ${packageDir}/cli.mjs preflight`,
  'launch:check':`node ${packageDir}/cli.mjs check`,
  'launch:issues':`node ${packageDir}/cli.mjs issues`,
  'launch:reconcile':`node ${packageDir}/cli.mjs reconcile`,
  'launch:repair':`node ${packageDir}/cli.mjs repair`,
});
writeJson(packagePath,pkg);

const manifestPath=`${packageDir}/manifest.json`;
const manifest=json(manifestPath);
manifest.version='2.7.0';
manifest.guidedOperatorExecution=true;
manifest.operatorIssueLedger=true;
manifest.checkpointReceipts=true;
writeJson(manifestPath,manifest);

const tasksPath=`${packageDir}/vscode-tasks.example.json`;
const tasks=json(tasksPath);
const wanted=[
  {label:'ProInspect: Full Development preflight',type:'process',command:'npm',args:['run','launch:preflight','--','--all'],problemMatcher:[]},
  {label:'ProInspect: Open launch issues',type:'process',command:'npm',args:['run','launch:issues'],problemMatcher:[]},
  {label:'ProInspect: Reconcile checkpoints',type:'process',command:'npm',args:['run','launch:reconcile','--','--stage','all'],problemMatcher:[]},
];
for(const task of wanted)if(!tasks.tasks.some((item)=>item.label===task.label))tasks.tasks.unshift(task);
writeJson(tasksPath,tasks);

const adapterPath='apps/api/src/backend/appwriteAdapters.ts';
let adapter=read(adapterPath);
if(!adapter.includes("from './appwriteCollectionTransforms.js'"))adapter=replaceOnce(adapter,"import { createHash, randomUUID } from 'node:crypto';","import { createHash, randomUUID } from 'node:crypto';\nimport { appwriteCollectionReadData, appwriteCollectionWriteData } from './appwriteCollectionTransforms.js';",'Appwrite transform import');
if(!adapter.includes("inspectionServiceMappings: 'shopify_service_mappings'"))adapter=replaceOnce(adapter,"shopifyServiceMappings: 'shopify_service_mappings',","shopifyServiceMappings: 'shopify_service_mappings', inspectionServiceMappings: 'shopify_service_mappings',",'Shopify mapping alias');
if(!adapter.includes("integrationSyncExceptions: 'integration_exceptions'"))adapter=replaceOnce(adapter,"integrationExceptions: 'integration_exceptions',","integrationExceptions: 'integration_exceptions', integrationSyncExceptions: 'integration_exceptions',",'integration exception alias');
const functionsStart=adapter.indexOf('function collectionWriteData(');
const functionsEnd=adapter.indexOf('export function createAppwriteApiServices',functionsStart);
requireThat(functionsStart>=0&&functionsEnd>functionsStart,'Collection transform function block missing');
const functions=`function collectionWriteData(\n  collection: string,\n  input: Record<string, unknown>,\n): Record<string, unknown> {\n  const mapped = appwriteCollectionWriteData(collection, input);\n  if (collection !== 'clientApprovals') return mapped;\n  return {\n    ...mapped,\n    ...(Array.isArray(mapped.evidencePhotoIds)\n      ? { evidencePhotoIds: JSON.stringify(mapped.evidencePhotoIds) }\n      : {}),\n  };\n}\n\nfunction collectionReadRecord(\n  collection: string,\n  row: Record<string, unknown>,\n): StoredRecord {\n  const value = appwriteCollectionReadData(collection, publicRecord(row));\n  if (collection === 'clientApprovals' && typeof value.evidencePhotoIds === 'string') {\n    try { value.evidencePhotoIds = JSON.parse(value.evidencePhotoIds) as unknown[]; }\n    catch { value.evidencePhotoIds = []; }\n  }\n  return value;\n}\n\n`;
adapter=adapter.slice(0,functionsStart)+functions+adapter.slice(functionsEnd);
write(adapterPath,adapter);

const operatorPath=`${packageDir}/operator.mjs`;
let operator=read(operatorPath);
operator=operator.replace("import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';","import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';");
operator=operator.replace("import { approvedConfig, privateDirectory, validateShopifyReplay } from './configuration.mjs';","import { approvedConfig, privateDirectory, targetEnv, validateShopifyReplay } from './configuration.mjs';");
const checkNeedle="  await collect(issues, { environment, stage, code: 'CONFIGURATION', target }, () => approvedConfig(config, environment));\n  if (stage === 'source' || stage === 'google') {";
const checkReplacement="  await collect(issues, { environment, stage, code: 'CONFIGURATION', target }, () => approvedConfig(config, environment));\n  await collect(issues, { environment, stage, code: 'TARGET_ENV', target }, () => targetEnv(target));\n  if (['backup','schema','fixtures','data','files','terraform','credentials','google','cloudflare','shopify'].includes(stage)) {\n    await collect(issues, { environment, stage, code: 'FREEZE_NOT_APPROVED', target }, () => requireThat(target?.backup?.freezeApproved === true, 'Application and worker write freeze is not approved'));\n  }\n  if (stage === 'source' || stage === 'google') {";
operator=replaceOnce(operator,checkNeedle,checkReplacement,'stage target/freeze precheck');
const preflightNeedle="  await collect(issues, { environment, stage: 'preflight', code: 'CONFIGURATION', target }, () => approvedConfig(config, environment));\n  await collect(issues, { environment, stage: 'preflight', code: 'TOOLCHAIN', target }, () => toolchain(all));";
const preflightReplacement="  await collect(issues, { environment, stage: 'preflight', code: 'CONFIGURATION', target }, () => approvedConfig(config, environment));\n  await collect(issues, { environment, stage: 'preflight', code: 'TARGET_ENV', target }, () => targetEnv(target));\n  await collect(issues, { environment, stage: 'preflight', code: 'FREEZE_NOT_APPROVED', target }, () => requireThat(target?.backup?.freezeApproved === true, 'Application and worker write freeze is not approved for installation'));\n  await collect(issues, { environment, stage: 'preflight', code: 'TOOLCHAIN', target }, () => toolchain(all));";
operator=replaceOnce(operator,preflightNeedle,preflightReplacement,'preflight target/freeze check');
operator=operator.replace("  const issues = [];\n  const states = selected.map((id) => {","  const issues = [];\n  if (git(['status', '--porcelain', '--untracked-files=normal'])) issues.push(makeIssue({ environment, stage: 'reconcile', code: 'WORKTREE_DIRTY', target, message: 'Commit or move source changes before trusting checkpoint reconciliation.' }));\n  const states = selected.map((id) => {");
operator=operator.replace("  readFileSync;\n  // writeFileSync is intentionally loaded lazily so report generation stays private and simple.\n  return import('node:fs').then(({ writeFileSync, renameSync }) => {\n    writeFileSync(temp, text, { mode: 0o600 });\n    renameSync(temp, path);\n    atomicJson(resolve(directory, environment, 'operator-report.json'), { schemaVersion: 1, environment, generatedAt: new Date().toISOString(), candidate: context || null, command: meta.command || null, result: meta.result || null, error: meta.error ? redact(meta.error) : null, counts, reportSha256: hash(text) });\n    return path;\n  });","  writeFileSync(temp, text, { mode: 0o600 });\n  renameSync(temp, path);\n  atomicJson(resolve(directory, environment, 'operator-report.json'), { schemaVersion: 1, environment, generatedAt: new Date().toISOString(), candidate: context || null, command: meta.command || null, result: meta.result || null, error: meta.error ? redact(meta.error) : null, counts, reportSha256: hash(text) });\n  return path;");
write(operatorPath,operator);

const readmePath=`${packageDir}/README.md`;
let readme=read(readmePath);
readme=readme.replace('npm `10.9.2`','npm `10.9.8`');
readme=readme.replace('```bash\nnpm ci --ignore-scripts --no-audit --no-fund\nnpm run launch:audit','```bash\nnvm use\nnpm ci --ignore-scripts --no-audit --no-fund\nnpm run launch:audit');
readme=readme.replace('npm run launch:install -- --stage schema --apply --confirm INSTALL:development:proinspect-development\nnpm run launch:install -- --stage data','npm run launch:install -- --stage schema --apply --confirm INSTALL:development:proinspect-development\nnpm run launch:install -- --stage fixtures --apply --confirm INSTALL:development:proinspect-development\nnpm run launch:install -- --stage data');
readme=readme.replace('Google Cloud deployment replaces the complete runtime env/Secret Manager binding set so stale Firebase-era configuration cannot survive an Appwrite cutover.','Google Cloud deployment updates only launch-owned runtime env/Secret Manager bindings while preserving Terraform-provisioned service defaults. The source-authority audit prevents stale Firebase-era application data paths from surviving an Appwrite cutover.');
if(!readme.includes('## V2.7 guided operator execution'))readme+=`\n\n## V2.7 guided operator execution\n\nV2.7 adds a fail-closed operator layer for interactive VS Code installation. Run \`npm run launch:preflight -- --all\` before mutation to collect all safely detectable configuration, toolchain, provider, authority, migration, Terraform, credential and Shopify problems in one pass. Findings are persisted privately as BLOCKER, WARNING or ADVISORY issues under the repository Git metadata directory; each issue carries an explicit remediation and recheck command. BLOCKERs prevent the affected mutation stage. WARNINGs prevent release confidence where applicable but do not masquerade as installation failures. ADVISORYs are operator information. There is deliberately no ignore-blockers switch.\n\nUse \`npm run launch:check -- --stage <stage>\` immediately before each explicit installation stage. Successful mutation stages create candidate-bound checkpoint receipts. If source/configuration changes later, \`npm run launch:reconcile -- --stage all\` classifies checkpoints as CURRENT, INVALIDATED or RECHECK_REQUIRED. Durable Appwrite schema/data/file state is never discarded merely because source changed; it must be reconciled through the normal idempotent/drift-guarded stage. This makes fix-as-you-go execution safe without pretending that a stale receipt is current.\n\n\`npm run launch:issues\` displays the persistent open issue ledger. \`npm run launch:repair -- --safe\` is intentionally limited to deterministic local maintenance: configured private-directory creation, repository formatting and Appwrite generated-source refresh. It never commits, resets, discards operator changes, approves Terraform, changes provider resources or performs a cloud mutation. Any resulting diff must be reviewed, tested and explicitly committed before continuing.\n\nThe Development/Staging fixture stage now bootstraps an isolated \`dev_agency\` Shopify connection and deterministic service mapping. Shopify replay configuration is validated during normal configuration checks, the webhook URL is constructed from the synthetic agency rather than accepted as an arbitrary path, the checked-in fixture contains no customer/contact/payment-secret data, invalid HMAC is denied, and the second identical delivery must prove idempotent short-circuiting. The replay never creates or changes a Shopify order.\n\nEvery stateful launch command writes a private operator report at \`$(git rev-parse --git-path proinspect-launch-v2)/<environment>/operator-report.md\` where possible. The report includes open issues, remediation/recheck commands, checkpoint status and recorded action status; it contains no secret values and is not acceptance evidence.\n\nRecommended Development workflow:\n\n\`\`\`bash\nnpm run launch:preflight -- --all\nnpm run launch:issues\nnpm run launch:check -- --stage source\n# Run only the explicit stage after STAGE_READY. If it fails, fix the issue, then:\nnpm run launch:reconcile -- --stage all\nnpm run launch:check -- --stage <failed-stage>\n\`\`\`\n\nThe mutating \`--stage all\` path remains available for already-rehearsed environments, but guided first installation should use one explicit stage at a time. Production remains outside this workflow and continues to require the separate \`launch:release\` controller.\n`;
write(readmePath,readme);

const packageAbsolute=resolve(root,packageDir);
const integrityPath=resolve(packageAbsolute,'integrity.json');
function packageFiles(directory,prefix=''){
  return readdirSync(resolve(directory,prefix),{withFileTypes:true}).flatMap((entry)=>{
    const rel=prefix?`${prefix}/${entry.name}`:entry.name;
    const full=resolve(directory,rel);
    if(entry.isDirectory())return packageFiles(directory,rel);
    requireThat(statSync(full).isFile(),`Unsupported package entry: ${rel}`);
    return rel==='integrity.json'?[]:[rel];
  }).sort();
}
function regenerateIntegrity(){
  const files={};
  for(const rel of packageFiles(packageAbsolute))files[rel]=createHash('sha256').update(readFileSync(resolve(packageAbsolute,rel))).digest('hex');
  writeFileSync(integrityPath,`${JSON.stringify({algorithm:'sha256',files},null,2)}\n`);
}
regenerateIntegrity();

for(const path of ['scripts/launch-v27-materialize.mjs','.github/workflows/launch-v27-finalize.yml'])if(existsSync(resolve(root,path)))rmSync(resolve(root,path));
console.log(JSON.stringify({status:'V27_MATERIALIZED',package:packageDir,version:manifest.version,removedHelpers:true},null,2));
