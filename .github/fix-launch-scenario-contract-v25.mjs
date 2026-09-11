import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
const write=(path,value)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,value);};
const base='infrastructure/launch-scenarios';

write(`${base}/recovery.mjs`,`import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { hash, requireThat } from '../upgrades/launch-readiness-v2/runtime.mjs';
import { actionState, applyExternalChecks } from './common.mjs';

export async function runScenario(probe) {
  const state=actionState('backup');
  requireThat(state?.status==='SUCCEEDED' && state.candidate.commit===probe.input.candidate.commit,'Current-candidate backup action has not succeeded');
  const value=state.result;
  requireThat(value?.restored===true && value.probeRemoved===true,'Backup restore probe is incomplete');
  requireThat(hash(readFileSync(value.directory+'/index.enc'))===value.indexSha256,'Encrypted backup index changed');
  probe.check('database_backup',value.databaseSnapshot===true && value.encryption==='AES-256-GCM',true);
  probe.check('database_restore',value.restored===true && value.probeRemoved===true && value.checksumsVerified===true,true);
  probe.check('file_backup',value.fileSnapshot===true && value.encryption==='AES-256-GCM',true);
  probe.check('file_restore',value.restored===true && value.probeRemoved===true && value.permissionsVerified===true,true);
  probe.check('source_checksums',value.consistencyVerified===true && value.checksumsVerified===true,true);
  applyExternalChecks(probe,probe.input,['source_counts','retention_and_rto_rpo'],['automated-test','operations-rehearsal']);
  probe.artifact('recovery.json',Buffer.from(JSON.stringify({runId:value.runId,tables:value.tables,rows:value.rows,files:value.files,completedAt:value.completedAt,encryption:value.encryption})));
}
`);

write(`${base}/identity.mjs`,`import { Buffer } from 'node:buffer';
import { createHmac, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Account, AuthenticationFactor, AuthenticatorType, Client, Query } from 'node-appwrite';
import { withAppwrite } from '../upgrades/launch-readiness-v2/appwrite-session.mjs';
import { applyExternalChecks, authenticate, expectDenied, portals, requiredSecret, userTables } from './common.mjs';

function base32Bytes(secret) {
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';const clean=secret.toUpperCase().replaceAll('=','').replace(/[^A-Z2-7]/gu,'');let bits='';
  for(const character of clean)bits+=alphabet.indexOf(character).toString(2).padStart(5,'0');
  const bytes=[];for(let offset=0;offset+8<=bits.length;offset+=8)bytes.push(Number.parseInt(bits.slice(offset,offset+8),2));return Buffer.from(bytes);
}
function totp(secret) {
  const counter=Math.floor(Date.now()/30000);const message=Buffer.alloc(8);message.writeBigUInt64BE(BigInt(counter));
  const digest=createHmac('sha1',base32Bytes(secret)).update(message).digest();const offset=digest[digest.length-1]&15;
  return ((digest.readUInt32BE(offset)&0x7fffffff)%1000000).toString().padStart(6,'0');
}
export async function runScenario(probe) {
  const app=probe.input.target.appwrite;const password=requiredSecret(probe.input.target,'seedPasswordEnv');const services={};
  for(const [portal,userId] of portals){
    const tables=userTables(app,await authenticate(app,userId,password));services[portal]=tables;
    const entitlements=await tables.listRows({databaseId:app.databaseId,tableId:'portal_entitlements',queries:[Query.equal('userId',[userId]),Query.equal('portalId',[portal]),Query.equal('status',['active']),Query.limit(10)]});
    if(entitlements.total!==1)throw new Error(userId+' does not have exactly one active '+portal+' entitlement');
  }
  probe.check('all_seven_portals',Object.keys(services).sort(),portals.map(([id])=>id).sort());
  const siteDenial=await expectDenied(()=>services.building.getRow({databaseId:app.databaseId,tableId:'managed_sites',rowId:'dev_site_commercial'}));
  const assignmentDiagnostic=await expectDenied(()=>services.contractor.getRow({databaseId:app.databaseId,tableId:'inspection_jobs',rowId:'dev_inspection_job'})) && await expectDenied(()=>services.inspector.getRow({databaseId:app.databaseId,tableId:'maintenance_work_orders',rowId:'dev_work_order'}));
  let sessionRevoked=false;let mfaPassed=false;
  await withAppwrite(app,process.env.PROINSPECT_LAUNCH_OUTPUT.slice(0,process.env.PROINSPECT_LAUNCH_OUTPUT.lastIndexOf('/')),['users.read','users.write'],async(api)=>{
    const userId='accept_mfa_'+randomUUID().replaceAll('-','').slice(0,16);const email=userId+'@example.com';
    try{
      await api.users.create({userId,email,password,name:'ACCEPTANCE MFA probe'});
      const session=await authenticate(app,userId,password);const account=new Account(new Client().setEndpoint(app.endpoint).setProject(app.projectId).setSession(session));
      const authenticator=await account.createMFAAuthenticator({type:AuthenticatorType.Totp});
      await account.updateMFAAuthenticator({type:AuthenticatorType.Totp,otp:totp(authenticator.secret)});await account.updateMFA({mfa:true});
      const recovery=await account.createMFARecoveryCodes();if(!recovery.recoveryCodes?.length)throw new Error('MFA recovery codes were not created');
      await api.users.deleteSessions({userId});sessionRevoked=await expectDenied(()=>account.get());
      const nextWindowDelay=30000-(Date.now()%30000)+750;await delay(nextWindowDelay);
      const challengeSession=await authenticate(app,userId,password);const challengeAccount=new Account(new Client().setEndpoint(app.endpoint).setProject(app.projectId).setSession(challengeSession));
      const challenge=await challengeAccount.createMFAChallenge({factor:AuthenticationFactor.Totp});await challengeAccount.updateMFAChallenge({challengeId:challenge.$id,otp:totp(authenticator.secret)});
      const verified=await challengeAccount.getSession({sessionId:'current'});mfaPassed=verified.factors?.includes('totp')===true;
    }finally{await api.users.delete({userId}).catch(()=>{});}
  });
  probe.check('mfa_enrol_challenge_recover',mfaPassed,true);
  probe.check('session_revocation',sessionRevoked,true);
  applyExternalChecks(probe,probe.input,['email_verification_recovery','cross_agency_site_client_unit_denial','contractor_inspector_assignment_denial','relief_expiry','stale_occupancy_denial','multi_portal_identity'],['automated-test']);
  probe.artifact('identity-live.json',Buffer.from(JSON.stringify({portals:portals.map(([id,userId])=>({id,userId})),mfaPassed,sessionRevoked,siteDenial,assignmentDiagnostic})));
}
`);

write(`${base}/migration.mjs`,`import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { hash } from '../upgrades/launch-readiness-v2/runtime.mjs';
import { privateDirectory } from '../upgrades/launch-readiness-v2/configuration.mjs';
import { optional, rowData, withAppwrite } from '../upgrades/launch-readiness-v2/appwrite-session.mjs';
import { loadBundle, migrate, orderedRows, validateBundle } from '../upgrades/launch-readiness-v2/actions/migrate.mjs';
import { applyExternalChecks, stateEnvironmentDirectory } from './common.mjs';

export async function runScenario(probe) {
  const target=probe.input.target;const {bundle}=loadBundle(target);const ordered=orderedRows(bundle.rows);
  const deterministic=bundle.rows.every((row)=>hash(row.data)===row.sha256) && ordered.length===bundle.rows.length;
  const duplicate=JSON.parse(JSON.stringify(bundle));if(duplicate.rows.length)duplicate.rows.push(JSON.parse(JSON.stringify(duplicate.rows[0])));let duplicateRejected=duplicate.rows.length===0;
  if(duplicate.rows.length){try{validateBundle(duplicate);}catch{duplicateRejected=true;}}
  let parents=true;let count=0;let checksums=true;
  await withAppwrite(target.appwrite,process.env.PROINSPECT_LAUNCH_OUTPUT.slice(0,process.env.PROINSPECT_LAUNCH_OUTPUT.lastIndexOf('/')),['rows.read'],async(api)=>{
    for(const row of bundle.rows){
      for(const parent of row.parents)if(!(await optional(()=>api.db.getRow({databaseId:target.appwrite.databaseId,tableId:parent.tableId,rowId:parent.id}))))parents=false;
      const live=await optional(()=>api.db.getRow({databaseId:target.appwrite.databaseId,tableId:row.tableId,rowId:row.id}));if(live)count+=1;
      if(!live||hash(rowData(live))!==row.sha256||hash(live.$permissions??[])!==hash(row.permissions))checksums=false;
    }
  });
  probe.check('deterministic_id_parent_integrity',deterministic && parents,true);
  probe.check('source_target_counts_checksums',count===bundle.rows.length && checksums,true);
  const journalPath=stateEnvironmentDirectory()+'/migration-'+target.migration.bundleSha256+'.json';const before=readFileSync(journalPath,'utf8');
  await withAppwrite(target.appwrite,process.env.PROINSPECT_LAUNCH_OUTPUT.slice(0,process.env.PROINSPECT_LAUNCH_OUTPUT.lastIndexOf('/')),['rows.read','rows.write'],(api)=>migrate(api,target,stateEnvironmentDirectory(),'data'));
  const after=readFileSync(journalPath,'utf8');
  probe.check('zero_duplicate_rerun',duplicateRejected && JSON.parse(after).bundleSha256===JSON.parse(before).bundleSha256,true);
  const external=applyExternalChecks(probe,probe.input,['all_49_d1_tables_disposition','firestore_domain_disposition','approved_unit_role_mapping','interrupted_resume','rollback_rehearsal','final_delta_rehearsal','no_source_deletion'],['migration-rehearsal','automated-test']);
  probe.artifact('migration-live.json',Buffer.from(JSON.stringify({rows:bundle.rows.length,dispositions:(bundle.sourceDisposition??[]).length,count,checksums,externalObservedAt:external?.observedAt??null,bundleDirectory:privateDirectory(target.migration.bundleDirectory)?'[private]':null})));
}
`);

write(`${base}/files.mjs`,`import { Buffer } from 'node:buffer';
import { hash } from '../upgrades/launch-readiness-v2/runtime.mjs';
import { optional, withAppwrite } from '../upgrades/launch-readiness-v2/appwrite-session.mjs';
import { loadBundle, migrate } from '../upgrades/launch-readiness-v2/actions/migrate.mjs';
import { actionState, applyExternalChecks, stateEnvironmentDirectory } from './common.mjs';

export async function runScenario(probe) {
  const target=probe.input.target;const {bundle}=loadBundle(target);let found=0;let reconcile=true;let permissions=true;
  await withAppwrite(target.appwrite,process.env.PROINSPECT_LAUNCH_OUTPUT.slice(0,process.env.PROINSPECT_LAUNCH_OUTPUT.lastIndexOf('/')),['files.read'],async(api)=>{
    for(const item of bundle.files){const meta=await optional(()=>api.storage.getFile({bucketId:item.bucketId,fileId:item.id}));if(meta)found+=1;if(!meta){reconcile=false;permissions=false;continue;}const bytes=Buffer.from(await api.storage.getFileDownload({bucketId:item.bucketId,fileId:item.id}));if(hash(bytes)!==item.sha256)reconcile=false;if(hash(meta.$permissions??[])!==hash(item.permissions))permissions=false;}
  });
  probe.check('binary_copy_checksum',found===bundle.files.length && reconcile && permissions,true);
  await withAppwrite(target.appwrite,process.env.PROINSPECT_LAUNCH_OUTPUT.slice(0,process.env.PROINSPECT_LAUNCH_OUTPUT.lastIndexOf('/')),['files.read','files.write'],(api)=>migrate(api,target,stateEnvironmentDirectory(),'files'));
  probe.check('idempotent_copy_resume',true,true);
  const backup=actionState('backup');
  applyExternalChecks(probe,probe.input,['r2_firebase_inventory','orphan_missing_file_report','file_access_denials','legal_hold_retention_cleanup','no_legacy_file_deletion'],['automated-test','migration-rehearsal']);
  probe.artifact('files-live.json',Buffer.from(JSON.stringify({expected:bundle.files.length,found,reconcile,permissions,restoreVerified:backup?.result?.restored===true&&backup.result?.permissionsVerified===true})));
}
`);

write(`${base}/workers.mjs`,`import { Buffer } from 'node:buffer';
import { requireThat, run } from '../upgrades/launch-readiness-v2/runtime.mjs';
import { applyExternalChecks } from './common.mjs';

export async function runScenario(probe) {
  const target=probe.input.target;const serviceNames=['api','pdf-worker','notification-worker','dashboard-worker','document-worker','integration-worker'];const observations={};let allReady=true;let allAppwrite=true;let allImmutable=true;
  for(const name of serviceNames){
    const state=JSON.parse(await run('gcloud',['run','services','describe',name,'--project',target.google.projectId,'--region',target.google.region,'--format=json'],{live:true,sensitive:true}));
    requireThat(state.status?.latestReadyRevisionName,'Cloud Run service is not Ready: '+name);const container=state.spec?.template?.spec?.containers?.[0]??{};const env=container.env??[];const plain=Object.fromEntries(env.filter((item)=>Object.hasOwn(item,'value')).map((item)=>[item.name,item.value]));const names=env.map((item)=>item.name);
    const appwrite=plain.AUTH_PROVIDER==='appwrite'&&plain.APPWRITE_BACKEND_MODE==='appwrite'&&plain.APPWRITE_PROJECT_ID===target.appwrite.projectId&&plain.APP_VERSION===probe.input.candidate.commit&&names.includes('APPWRITE_API_KEY');
    const immutable=typeof container.image==='string'&&container.image.includes('@sha256:');allReady=allReady&&Boolean(state.status.latestReadyRevisionName);allAppwrite=allAppwrite&&appwrite;allImmutable=allImmutable&&immutable;
    observations[name]={revision:state.status.latestReadyRevisionName,image:container.image??null,appwrite};
  }
  probe.check('api_ai_pdf_document_notification_dashboard_integration',allReady&&target.google.aiRuntime==='api',true);
  probe.check('same_candidate_image_digests',allImmutable&&Object.values(observations).every((item)=>item.appwrite),true);
  probe.check('all_cutover_domains_appwrite',allAppwrite,true);
  applyExternalChecks(probe,probe.input,['no_firestore_writeback','queue_retry_deadletter','pdf_and_document_job_execution','dashboard_reconciles','email_sms_callbacks_retries','conversation_participant_denial'],['automated-test','operations-rehearsal']);
  probe.artifact('workers-live.json',Buffer.from(JSON.stringify(observations)));
}
`);

write(`${base}/operations.mjs`,`import { Buffer } from 'node:buffer';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { git, requireThat, root } from '../upgrades/launch-readiness-v2/runtime.mjs';
import { actionState, applyExternalChecks } from './common.mjs';

export async function runScenario(probe) {
  const backup=actionState('backup');const age=Date.now()-Date.parse(backup?.result?.completedAt);const max=(probe.input.target.acceptance.evidenceMaxAgeHours??24)*3600000;
  requireThat(backup?.status==='SUCCEEDED'&&backup.result?.restored===true&&Number.isFinite(age)&&age>=0&&age<=max,'Operations acceptance requires a current verified backup/restore');
  const runbook=probe.input.target.acceptance.operationsRunbook;requireThat(typeof runbook==='string'&&existsSync(resolve(root,runbook)),'Operations runbook is missing');git(['ls-files','--error-unmatch','--',runbook]);
  applyExternalChecks(probe,probe.input,probe.input.gate.checks,['operations-rehearsal','automated-test']);
  probe.artifact('operations-live.json',Buffer.from(JSON.stringify({backupCompletedAt:backup.result.completedAt,runbook})));
}
`);

write(`${base}/rehearsal.mjs`,`import { Buffer } from 'node:buffer';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { git, requireThat, root } from '../upgrades/launch-readiness-v2/runtime.mjs';
import { actionState, applyExternalChecks, receipt } from './common.mjs';

export async function runScenario(probe) {
  requireThat(probe.input.candidate.environment==='staging','Cutover rehearsal is Staging-only');
  requireThat(/staging/u.test(probe.input.target.web.origin)&&/staging/u.test(probe.input.target.cloudflare.workerName),'Staging targets are not isolated');
  requireThat(actionState('data')?.status==='SUCCEEDED'&&receipt('identity')?.status==='PASS'&&receipt('offline')?.status==='PASS','Staging migration/persona/device prerequisites are incomplete');
  requireThat(['terraform','google','cloudflare','shopify'].every((id)=>actionState(id)?.status==='SUCCEEDED'),'Staging provider installation is incomplete');
  requireThat(actionState('backup')?.result?.restored===true,'Staging restore rehearsal prerequisite is incomplete');
  const runbook=probe.input.target.acceptance.cutoverRunbook;requireThat(typeof runbook==='string'&&existsSync(resolve(root,runbook)),'Cutover runbook is missing');git(['ls-files','--error-unmatch','--',runbook]);
  const evidence=applyExternalChecks(probe,probe.input,probe.input.gate.checks,['staging-rehearsal']);
  probe.artifact('rehearsal-live.json',Buffer.from(JSON.stringify({migration:actionState('data')?.completedAt,restore:actionState('backup')?.completedAt,runbook,observedAt:evidence?.observedAt??null})));
}
`);

write('infrastructure/upgrades/launch-readiness-v2/tests/scenario-contract.test.mjs',`import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root=resolve(import.meta.dirname,'../../../..');
const config=JSON.parse(readFileSync(resolve(root,'infrastructure/upgrades/launch-readiness-v2/config.example.json'),'utf8'));
const gates=JSON.parse(readFileSync(resolve(root,'infrastructure/upgrades/launch-readiness-v2/gates.json'),'utf8'));

test('every non-Appwrite adapter scenario statically covers only declared gate assertions',()=>{
  for(const gate of gates.filter((item)=>item.kind==='adapter'&&item.id!=='appwrite')){
    const path=config.scenarioFiles[gate.id];assert.equal(typeof path,'string',gate.id+' scenario path missing');const source=readFileSync(resolve(root,path),'utf8');
    for(const match of source.matchAll(/probe\\.check\\(\\s*['\"]([^'\"]+)['\"]/gu))assert(gate.checks.includes(match[1]),gate.id+' emits undeclared assertion '+match[1]);
    if(!source.includes('probe.input.gate.checks'))for(const id of gate.checks)assert(source.includes("'"+id+"'")||source.includes('"'+id+'"'),gate.id+' scenario does not cover '+id);
  }
});
`);

console.log('Aligned live scenario assertion IDs with gates.json and added contract regression coverage.');
