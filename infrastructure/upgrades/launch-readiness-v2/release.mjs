#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { withAppwrite,ensureWebPlatform } from './appwrite-session.mjs';
import { appwriteSchemaAudit } from './adapters/appwrite-cli.mjs';
import { privateDirectory } from './configuration.mjs';
import { scorecard } from './evidence.mjs';
import { appwriteAudit, edgeAcceptance, googleAudit, shopifyAudit, toolchain } from './providers.mjs';
import { backup, restoreProbe } from './actions/backup.mjs';
import { deployCloudflare, rollbackCloudflare, cfRequest, singlePreviousVersion } from './actions/cloudflare.mjs';
import { provisionCredentials, validateCredentialPolicy } from './actions/credentials.mjs';
import { deployGoogle, googleIdentity, rollbackGoogle } from './actions/google.mjs';
import { migrate } from './actions/migrate.mjs';
import { ensureSchema, sourceSchema } from './actions/schema.mjs';
import { auditShopifySubscriptions, reconcileShopifySubscriptions } from './actions/shopify-production.mjs';
import { terraform } from './actions/terraform.mjs';
import { acquireLock, assertClean, assertRepository, atomicJson, candidate, canonical, git, hash, manifest, packageRoot, readJson, redact, requireThat, root, run, safePath, sameSourceCandidate, stateRoot } from './runtime.mjs';

export const releaseStages=['terraform','credentials','backup','schema','data','files','google','cloudflare','shopify','verify'];
const appwriteScopes=['databases.read','databases.write','tables.read','tables.write','columns.read','columns.write','indexes.read','indexes.write','rows.read','rows.write','buckets.read','buckets.write','files.read','files.write','teams.read','teams.write'];
const services=['api','pdf-worker','notification-worker','dashboard-worker','document-worker','integration-worker'];
const requiredApiSecrets=['CLOUDFLARE_ORIGIN_SECRET','SHOPIFY_WEBHOOK_SECRET','GOOGLE_CALENDAR_CLIENT_SECRET','INTEGRATION_TOKEN_ENCRYPTION_KEY','INTEGRATION_STATE_SECRET','AUTOMATION_RUNNER_SECRET'];
const requiredApiEnv=['AUTH_PROVIDER','APPWRITE_BACKEND_MODE','NODE_ENV','PUBLIC_API_BASE_URL','WEB_APP_BASE_URL','SHOPIFY_API_VERSION','GOOGLE_CALENDAR_CLIENT_ID','GOOGLE_CALENDAR_REDIRECT_URI','INTEGRATION_TOKEN_KEY_VERSION'];
const productionConfigPath=()=>resolve(stateRoot(root),'production-release.json');
const releaseDirectory=()=>resolve(stateRoot(root),'production-release');
function real(value){return typeof value==='string' && value.trim() && !/REPLACE|example\.|<|>/iu.test(value);}
function inspectSecrets(value,parent=''){
  if(!value||typeof value!=='object')return;
  for(const [key,item] of Object.entries(value)){
    if(/(password|secret|api.?key|access.?token)/iu.test(key)&&!['secretRefs','secretId','approvedRuntimeKeys'].includes(key)&&parent!=='secretRefs')requireThat(item===null||key.endsWith('Env'),'Secret values are forbidden in Production release configuration');
    inspectSecrets(item,key);
  }
}
function immutableSecretRef(value){return typeof value==='string' && /^[A-Za-z0-9_-]+:[0-9]+$/u.test(value);}
export function validateProductionConfig(config,{forMutation=false,now=Date.now()}={}){
  requireThat(config?.schemaVersion===1 && canonical([...(config.providerStack ?? [])].sort())===canonical([...manifest.providerStack].sort()),'Production provider stack must exactly match the launch manifest');inspectSecrets(config);
  const target=config.environments?.production;requireThat(target,'Production target is missing');const app=target.appwrite;const google=target.google;const cloudflare=target.cloudflare;const shopify=target.shopify;const web=target.web;const control=config.releaseControl;
  requireThat(app?.endpoint==='https://syd.cloud.appwrite.io/v1'&&app.databaseId==='proinspect_core','Unexpected Production Appwrite endpoint/database');
  requireThat(real(app.projectId)&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u.test(app.projectId)&&real(app.projectName)&&/production/i.test(app.projectName),'Use a dedicated named Production Appwrite project');
  requireThat(app.projectId!=='proinspect-development'&&!manifest.prohibited.appwriteProjects.includes(app.projectId),'Legacy/Development Appwrite target is prohibited');
  requireThat(real(google?.projectId)&&/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/u.test(google.projectId)&&google.environment==='production'&&google.region==='australia-southeast1','Use a dedicated labelled Production Google Cloud project');
  requireThat(!manifest.prohibited.googleProjects.includes(google.projectId)&&!/(?:dev|development|staging)(?:-|$)/u.test(google.projectId),'Legacy/non-production Google project is prohibited');
  requireThat(canonical([...google.services].sort())===canonical([...services].sort())&&google.aiRuntime==='api','Production must declare the six canonical Cloud Run services with AI in api');
  requireThat(manifest.requiredGoogleApis.every((id)=>google.requiredApis?.includes(id)),'Production Google Cloud APIs are incomplete');
  requireThat(real(cloudflare?.accountId)&&/^[a-f0-9]{32}$/iu.test(cloudflare.accountId)&&real(cloudflare.workerName)&&/^[a-z0-9_-]+$/u.test(cloudflare.workerName)&&/(?:prod|production)/u.test(cloudflare.workerName),'Use a dedicated Production Cloudflare account/worker binding');
  requireThat(!manifest.prohibited.cloudflareWorkers.includes(cloudflare.workerName)&&!/(?:dev|development|staging)/u.test(cloudflare.workerName),'Legacy/non-production Cloudflare Worker is prohibited');
  requireThat(real(web?.origin)&&new URL(web.origin).protocol==='https:'&&new URL(web.origin).origin===web.origin&&!/(?:^|[.-])(?:dev|development|staging)(?:[.-]|$)/u.test(new URL(web.origin).hostname),'Use the exact Production HTTPS public origin');
  requireThat(real(cloudflare.apiOrigin)&&new URL(cloudflare.apiOrigin).protocol==='https:','Production Cloud Run API origin is required');
  requireThat(shopify?.domain==='proinspect-2.myshopify.com'&&shopify.apiVersion==='2026-07'&&shopify.tokenEnv==='SHOPIFY_ADMIN_ACCESS_TOKEN','Unexpected Production Shopify store/version');
  requireThat(real(shopify.agencyId)&&/^[A-Za-z0-9._-]{2,64}$/u.test(shopify.agencyId),'Production Shopify agency ID is required');
  const expectedWebhook=`${web.origin}/api/v1/integrations/shopify/webhooks/${encodeURIComponent(shopify.agencyId)}`;requireThat(shopify.webhookUri===expectedWebhook,'Shopify webhook must use the Production Cloudflare public API edge');
  requireThat(target.terraform?.root==='infrastructure/terraform/environments/production'&&isAbsolute(target.terraform.variablesFile ?? '')&&isAbsolute(target.terraform.backendFile ?? ''),'Use private Production Terraform variables/backend files');
  privateDirectory(target.terraform.variablesFile);privateDirectory(target.terraform.backendFile);privateDirectory(target.backup?.directory);privateDirectory(target.migration?.bundleDirectory);
  requireThat(/^[a-f0-9]{64}$/u.test(target.migration.bundleSha256 ?? '')&&target.backup.freezeApproved===true,'Production migration bundle and write-freeze approval are required');
  validateCredentialPolicy(app.runtimeCredentialPolicies,services);requireThat(new Set(app.runtimeCredentialPolicies.map((item)=>item.service)).size===services.length&&services.every((name)=>app.runtimeCredentialPolicies.some((item)=>item.service===name)),'Every Production service requires an explicit Appwrite runtime credential policy');
  for(const name of services){const binding=google.runtimeBindings?.[name];requireThat(binding?.env?.AUTH_PROVIDER==='appwrite'&&binding.env.APPWRITE_BACKEND_MODE==='appwrite','Every Production runtime must use Appwrite authority');}
  const api=google.runtimeBindings.api;for(const key of requiredApiEnv)requireThat(real(api.env[key]),`Production API runtime value missing: ${key}`);
  requireThat(api.env.NODE_ENV==='production'&&api.env.PUBLIC_API_BASE_URL===web.origin&&api.env.WEB_APP_BASE_URL===web.origin&&api.env.SHOPIFY_API_VERSION==='2026-07','Production API public runtime values differ from approved targets');
  requireThat(api.env.GOOGLE_CALENDAR_REDIRECT_URI===`${web.origin}/api/v1/integrations/google-calendar/oauth/callback`,'Google Calendar redirect must use the Production Cloudflare edge');
  for(const key of requiredApiSecrets)requireThat(immutableSecretRef(api.secretRefs[key]),`Production API Secret Manager reference missing or mutable: ${key}`);
  requireThat(control&&real(control.approvedBy)&&Number.isFinite(Date.parse(control.approvedAt))&&Date.parse(control.approvedAt)<=now,'Production release requires named dated approval');
  requireThat(/^[a-f0-9]{40}$/u.test(control.approvedCommit ?? '')&&real(control.changeTicket)&&real(control.supportOwner),'Production release control fields are incomplete');
  requireThat(control.supportReady===true&&control.legacyWriteFreezeApproved===true&&control.finalMigrationDeltaApproved===true,'Support, legacy write freeze and final migration delta require explicit approval');
  requireThat(Number.isInteger(control.rollbackWindowHours)&&control.rollbackWindowHours>=1&&control.rollbackWindowHours<=168,'Rollback window must be 1-168 hours');
  const start=Date.parse(control.releaseWindowStart);const end=Date.parse(control.releaseWindowEnd);requireThat(Number.isFinite(start)&&Number.isFinite(end)&&end>start&&end-start<=8*3600000,'Release window must be a bounded maximum-eight-hour interval');
  if(forMutation){requireThat(control.productionMutationEnabled===true,'Set productionMutationEnabled=true only for the approved change window');requireThat(now>=start&&now<=end,'Current time is outside the approved Production release window');}
  return target;
}
function targetFingerprint(target){return hash({appwrite:target.appwrite.projectId,google:target.google.projectId,cloudflare:[target.cloudflare.accountId,target.cloudflare.workerName],shopify:[target.shopify.domain,target.shopify.webhookUri],web:target.web.origin});}
function stagePath(id){return resolve(releaseDirectory(),`stage-${id}.json`);}
function stageRecord(id){return existsSync(stagePath(id))?readJson(stagePath(id)):null;}
function saveStage(id,context,target,result){atomicJson(stagePath(id),{id,status:'SUCCEEDED',candidate:context,targetFingerprint:targetFingerprint(target),completedAt:new Date().toISOString(),result});}
function requireStage(id,context,target,{exactConfig=false}={}){const record=stageRecord(id);requireThat(record?.status==='SUCCEEDED'&&sameSourceCandidate(record.candidate,context)&&record.targetFingerprint===targetFingerprint(target)&&(!exactConfig||record.candidate.configHash===context.configHash),`Production prerequisite '${id}' is missing or stale`);return record;}
function providerEnvGuard(target){const expected={APPWRITE_PROJECT_ID:target.appwrite.projectId,GOOGLE_CLOUD_PROJECT:target.google.projectId,CLOUDFLARE_ACCOUNT_ID:target.cloudflare.accountId,SHOPIFY_STORE_DOMAIN:target.shopify.domain};for(const [key,value] of Object.entries(expected))if(process.env[key])requireThat(process.env[key]===value,`Conflicting Production target in ${key}`);for(const key of ['GCLOUD_PROJECT','CLOUDSDK_CORE_PROJECT'])if(process.env[key])requireThat(process.env[key]===target.google.projectId,`Conflicting Production Google target in ${key}`);}
function productionContext(config){const context=candidate(config,'production');requireThat(context.commit===config.releaseControl.approvedCommit,'Release approval is bound to a different commit');return context;}
export function assertFreshStaging(platformConfig,productionCandidate,directory=stateRoot(root)){
  const development=candidate(platformConfig,'development');const staging=candidate(platformConfig,'staging');
  requireThat(sameSourceCandidate(development,staging)&&sameSourceCandidate(staging,productionCandidate),'Development, Staging and Production release must use the identical source candidate');
  const dev=scorecard(directory,development).filter((gate)=>gate.id!=='rehearsal');const stage=scorecard(directory,staging);
  requireThat(dev.every((gate)=>gate.status==='PASS')&&stage.every((gate)=>gate.status==='PASS'),'Fresh Development and full Staging acceptance, including rehearsal, are required');
  return {development,staging,developmentGates:dev,stagingGates:stage};
}
async function productionProviderPreflight(target,directory,{requireGoogleApis=false}={}){
  const appwrite=await appwriteAudit(target.appwrite,directory);
  const google=requireGoogleApis ? await googleAudit(target.google) : {projectId:await googleIdentity(target.google),requiredApisPendingVerification:true};
  const scripts=await cfRequest(target.cloudflare,'/workers/scripts');
  requireThat(scripts.some((item)=>item.id===target.cloudflare.workerName),'Production Cloudflare Worker must already exist before release');
  const deployments=await cfRequest(target.cloudflare,`/workers/scripts/${target.cloudflare.workerName}/deployments`);const current=deployments.deployments?.[0];singlePreviousVersion(current);
  const shopify=await shopifyAudit(target.shopify);const subscriptions=await auditShopifySubscriptions(target.shopify);requireThat(subscriptions.duplicates.length===0,'Duplicate Production Shopify webhook subscriptions require manual cleanup');
  return {appwrite,google,cloudflare:{accountId:target.cloudflare.accountId,workerName:target.cloudflare.workerName,currentDeploymentId:current.id,currentVersionId:singlePreviousVersion(current)},shopify,subscriptions};
}
async function preflight(config,{forMutation=false,requireGoogleApis=false}={}){
  assertRepository();assertClean();if(forMutation)requireThat(git(['branch','--show-current'])==='main','Production mutation is allowed only from the exact approved main commit');
  const target=validateProductionConfig(config,{forMutation});providerEnvGuard(target);const context=productionContext(config);const platformPath=resolve(stateRoot(root),'config.json');requireThat(existsSync(platformPath),'Development/Staging launch configuration is missing');
  const platformConfig=readJson(platformPath);for(const environment of ['development','staging']){const other=platformConfig.environments?.[environment];requireThat(other&&target.appwrite.projectId!==other.appwrite.projectId&&target.google.projectId!==other.google.projectId&&target.cloudflare.workerName!==other.cloudflare.workerName&&target.web.origin!==other.web.origin,`Production provider targets must be isolated from ${environment}`);}const acceptance=assertFreshStaging(platformConfig,context);await toolchain(true);const providers=await productionProviderPreflight(target,resolve(releaseDirectory(),'preflight'),{requireGoogleApis});
  const result={status:'PRODUCTION_PREFLIGHT_PASS',candidate:context,targetFingerprint:targetFingerprint(target),acceptance:{development:acceptance.development.commit,staging:acceptance.staging.commit},providers,productionMutationEnabled:config.releaseControl.productionMutationEnabled===true};atomicJson(resolve(releaseDirectory(),'preflight.json'),result);return {target,context,result};
}
function currentBackup(context,target){const record=stageRecord('backup');requireThat(record?.status==='SUCCEEDED'&&record.candidate.configHash===context.configHash&&sameSourceCandidate(record.candidate,context)&&record.targetFingerprint===targetFingerprint(target),'Run a fresh Production backup/restore probe for the exact post-credential configuration');requireThat(Date.now()-Date.parse(record.completedAt)<3600000,'Production backup is more than one hour old');requireThat(record.result?.restored===true&&record.result?.probeRemoved===true,'Production restore probe is incomplete');requireThat(hash(readFileSync(resolve(record.result.directory,'index.enc')))===record.result.indexSha256,'Production backup index changed');return record;}
async function executeStage(id,config,configPath){
  const {target,context}=await preflight(config,{forMutation:true,requireGoogleApis:id!=='terraform'});const confirmation=`RELEASE:${id}:${target.appwrite.projectId}:${context.commit}`;return {target,context,confirmation,run:async()=>{
    if(id==='terraform')return terraform(target,context,resolve(releaseDirectory(),'terraform'));
    if(id==='credentials'){requireStage('terraform',context,target);return provisionCredentials(config,'production',resolve(releaseDirectory(),'credentials'),configPath);}
    if(id==='backup'){requireStage('credentials',context,target);return withAppwrite(target.appwrite,resolve(releaseDirectory(),'backup'),appwriteScopes,async(api)=>{const receipt=await backup(api,target,resolve(releaseDirectory(),'backup'),`production-${Date.now()}`);return restoreProbe(api,receipt,target.appwrite,resolve(releaseDirectory(),'backup'));});}
    currentBackup(context,target);
    if(id==='schema'){return withAppwrite(target.appwrite,resolve(releaseDirectory(),'schema'),appwriteScopes,async(api)=>{const schema=await sourceSchema();const installed=await ensureSchema(api,schema,target.appwrite.databaseId);const platform=await ensureWebPlatform(target.appwrite,target.web,resolve(releaseDirectory(),'schema'));return {...installed,platform};});}
    if(id==='data'){requireStage('schema',context,target,{exactConfig:true});return withAppwrite(target.appwrite,resolve(releaseDirectory(),'data'),appwriteScopes,(api)=>migrate(api,target,releaseDirectory(),'data'));}
    if(id==='files'){requireStage('data',context,target,{exactConfig:true});return withAppwrite(target.appwrite,resolve(releaseDirectory(),'files'),appwriteScopes,(api)=>migrate(api,target,releaseDirectory(),'files'));}
    if(id==='google'){requireStage('files',context,target,{exactConfig:true});return deployGoogle(target,context,resolve(releaseDirectory(),'google'));}
    if(id==='cloudflare'){requireStage('google',context,target,{exactConfig:true});return deployCloudflare(target,context,resolve(releaseDirectory(),'cloudflare'),{requireExisting:true});}
    if(id==='shopify'){requireStage('cloudflare',context,target,{exactConfig:true});return reconcileShopifySubscriptions(target.shopify);}
    if(id==='verify'){
      const shopifyStage=requireStage('shopify',context,target,{exactConfig:true});const googleStage=requireStage('google',context,target,{exactConfig:true});const cloudflareStage=requireStage('cloudflare',context,target,{exactConfig:true});
      const cfLive=await cfRequest(target.cloudflare,`/workers/scripts/${target.cloudflare.workerName}/deployments`);const cfCurrent=cfLive.deployments?.[0];requireThat(cfCurrent?.id===cloudflareStage.result.current?.id&&singlePreviousVersion(cfCurrent)===cloudflareStage.result.candidateVersion?.id,'Production Cloudflare traffic differs from the recorded promoted candidate');
      const edge=await edgeAcceptance(target.web,context.commit,fetch,{expectedVersionId:cloudflareStage.result.candidateVersion.id,expectedVersionTag:cloudflareStage.result.candidateVersion.tag});const shopify=await auditShopifySubscriptions(target.shopify);requireThat(shopify.missing.length===0&&shopify.duplicates.length===0,'Production Shopify subscriptions are incomplete or duplicated after release');
      const appwrite=await appwriteSchemaAudit(target,resolve(releaseDirectory(),'verify-appwrite'));requireThat(appwrite.errors.length===0&&appwrite.unavailable.length===0&&appwrite.bucketErrors.length===0&&appwrite.leastPrivilege&&appwrite.approvedKeys&&appwrite.registeredDomains,'Production Appwrite schema, keys or registered domain differ from the approved release');
      const servicesState={};for(const name of services){const expected=googleStage.result.services.find((item)=>item.name===name);requireThat(expected?.deployedRevision&&expected?.image,'Recorded Google deployment is incomplete: '+name);const value=JSON.parse(await run('gcloud',['run','services','describe',name,'--project',target.google.projectId,'--region',target.google.region,'--format=json'],{live:true,sensitive:true}));const container=value.spec?.template?.spec?.containers?.[0]??{};const env=container.env??[];const plain=Object.fromEntries(env.filter((item)=>Object.hasOwn(item,'value')).map((item)=>[item.name,item.value]));const active=(value.status?.traffic??[]).filter((item)=>Number(item.percent)>0);requireThat(value.status?.latestReadyRevisionName===expected.deployedRevision&&container.image===expected.image&&active.length===1&&active[0].revisionName===expected.deployedRevision&&Number(active[0].percent)===100&&plain.APP_VERSION===context.commit&&plain.AUTH_PROVIDER==='appwrite'&&plain.APPWRITE_BACKEND_MODE==='appwrite','Production Cloud Run live revision/image/traffic/runtime differs from the recorded candidate');servicesState[name]={revision:expected.deployedRevision,image:expected.image,traffic:100};}
      return {status:'PRODUCTION_PROMOTED_AWAITING_OBSERVATION',edge,shopify,shopifyStage:shopifyStage.completedAt,appwrite,services:servicesState,cloudflare:{deploymentId:cfCurrent.id,versionId:cloudflareStage.result.candidateVersion.id},legacyRetired:false};
    }
    throw new Error(`Unknown Production release stage: ${id}`);
  }};
}
function parse(argv){const out={command:argv[0]??'plan'};const seen=new Set();for(let i=1;i<argv.length;i+=1){requireThat(argv[i].startsWith('--'),'Invalid release option');const key=argv[i].slice(2);requireThat(!seen.has(key),'Duplicate release option');seen.add(key);requireThat(['stage','confirm','provider'].includes(key)&&argv[i+1]&&!argv[i+1].startsWith('--'),'Unknown or missing release option');out[key]=argv[++i];}requireThat(['plan','init','preflight','apply','status','rollback'].includes(out.command),'Unknown release command');return out;}
export async function release(argv=process.argv.slice(2)){
  const args=parse(argv);const configPath=productionConfigPath();
  if(args.command==='plan')return {status:'PLAN_ONLY',productionMutations:false,stages:releaseStages,confirmation:'RELEASE:<stage>:<production-appwrite-id>:<approved-commit>',rollback:'ROLLBACK:<provider>:<production-appwrite-id>:<release-commit>'};
  if(args.command==='init'){requireThat(!existsSync(configPath),'Production release configuration already exists');atomicJson(configPath,readJson(safePath(packageRoot,'release.example.json')));return {status:'PRODUCTION_RELEASE_CONFIG_CREATED',path:configPath,productionMutationEnabled:false};}
  requireThat(existsSync(configPath),'Run launch:release -- init first');let config=readJson(configPath);
  if(args.command==='status')return {configPath,stages:releaseStages.map((id)=>({id,record:stageRecord(id)})),preflight:existsSync(resolve(releaseDirectory(),'preflight.json'))?readJson(resolve(releaseDirectory(),'preflight.json')):null};
  if(args.command==='preflight')return (await preflight(config)).result;
  if(args.command==='rollback'){
    assertRepository();assertClean();const target=validateProductionConfig(config);const context=productionContext(config);requireThat(['google','cloudflare'].includes(args.provider),'Rollback provider must be google or cloudflare');const confirm=`ROLLBACK:${args.provider}:${target.appwrite.projectId}:${context.commit}`;requireThat(args.confirm===confirm,'Exact Production rollback confirmation is required');
    const releaseLock=acquireLock(resolve(releaseDirectory(),'lock-root'));
    try{let result;if(args.provider==='google')result=await rollbackGoogle(target,resolve(releaseDirectory(),'google','google-deployment.json'));else result=await rollbackCloudflare(target,resolve(releaseDirectory(),'cloudflare','cloudflare-deployment.json'));atomicJson(resolve(releaseDirectory(),`rollback-${args.provider}.json`),{candidate:context,completedAt:new Date().toISOString(),result,databaseRolledBack:false});return {status:'PRODUCTION_TRAFFIC_ROLLBACK_COMPLETE',provider:args.provider,databaseRolledBack:false,result};}finally{releaseLock();}
  }
  requireThat(args.stage&&releaseStages.includes(args.stage),'Use one explicit Production --stage');const unlock=acquireLock(resolve(releaseDirectory(),'lock-root'));
  try{const task=await executeStage(args.stage,config,configPath);requireThat(args.confirm===task.confirmation,`Exact confirmation required: ${task.confirmation}`);const result=await task.run();config=readJson(configPath);const finalContext=productionContext(config);saveStage(args.stage,finalContext,config.environments.production,result);return {status:args.stage==='verify'?'PRODUCTION_PROMOTED_AWAITING_OBSERVATION':'PRODUCTION_STAGE_COMPLETE',stage:args.stage,candidate:finalContext.commit,result};}finally{unlock();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{console.log(JSON.stringify(await release(),null,2));}catch(error){console.error(`RELEASE BLOCKED: ${redact(error.message)}`);process.exitCode=1;}}
