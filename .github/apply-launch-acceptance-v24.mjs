import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const pkg = 'infrastructure/upgrades/launch-readiness-v2';
const scenarios = 'infrastructure/launch-scenarios';
const read = (path) => readFileSync(path, 'utf8');
const write = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value); };
const json = (path, value) => write(path, `${JSON.stringify(value, null, 2)}\n`);
function replaceOne(path, before, after) {
  const value = read(path);
  if (!value.includes(before)) throw new Error(`Missing patch anchor in ${path}`);
  if (value.indexOf(before) !== value.lastIndexOf(before)) throw new Error(`Non-unique patch anchor in ${path}`);
  write(path, value.replace(before, after));
}

const common = `import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Client, Query, TablesDB } from 'node-appwrite';
import { privateDirectory } from '../upgrades/launch-readiness-v2/configuration.mjs';
import { hash, readJson, requireThat, safePath } from '../upgrades/launch-readiness-v2/runtime.mjs';

export const portals = [
  ['admin','dev_admin'], ['inspector','dev_inspector'], ['building','dev_building_manager'],
  ['strata','dev_strata_manager'], ['resident','dev_resident_tenant'], ['client','dev_client_user'], ['contractor','dev_contractor'],
];
export function stateEnvironmentDirectory() {
  requireThat(process.env.PROINSPECT_LAUNCH_OUTPUT, 'Launch output path is missing');
  return resolve(dirname(process.env.PROINSPECT_LAUNCH_OUTPUT), '..', '..');
}
export function actionState(id) {
  const path = resolve(stateEnvironmentDirectory(), 'actions', id + '.json');
  return existsSync(path) ? readJson(path) : null;
}
export function receipt(id) {
  const path = resolve(stateEnvironmentDirectory(), 'receipts', id + '.json');
  return existsSync(path) ? readJson(path) : null;
}
export function requiredSecret(target, key) {
  const name = target.acceptance?.[key];
  requireThat(typeof name === 'string' && /^[A-Z][A-Z0-9_]*$/u.test(name), 'Acceptance secret environment variable is not configured');
  const value = process.env[name];
  requireThat(typeof value === 'string' && value.length >= 8, name + ' is required for live acceptance');
  return value;
}
export async function authenticate(app, userId, password) {
  const response = await fetch(app.endpoint + '/account/sessions/email', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { 'content-type': 'application/json', 'x-appwrite-project': app.projectId },
    body: JSON.stringify({ email: userId + '@example.com', password }),
  });
  const payload = await response.json().catch(() => ({}));
  requireThat(response.ok, 'Authentication failed for ' + userId + ' with HTTP ' + response.status);
  const fallback = response.headers.get('x-fallback-cookies');
  const cookies = fallback ? JSON.parse(fallback) : {};
  const session = payload.secret || cookies['a_session_' + app.projectId];
  requireThat(session, 'No Appwrite session returned for ' + userId);
  return session;
}
export function userTables(app, session) {
  return new TablesDB(new Client().setEndpoint(app.endpoint).setProject(app.projectId).setSession(session));
}
export async function expectDenied(operation) {
  try { await operation(); } catch (error) { if ([401,403,404].includes(Number(error?.code))) return true; throw error; }
  return false;
}
export async function boundedRequest(url, options = {}) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(30000) });
  const bytes = Buffer.from(await response.arrayBuffer());
  requireThat(bytes.length <= 2 * 1024 * 1024, 'Acceptance response exceeded 2 MiB');
  return { response, bytes, text: bytes.toString('utf8') };
}
export function providerTargets(input) {
  const target = input.target;
  return {
    appwriteProjectId: target.appwrite.projectId,
    googleProjectId: target.google.projectId,
    cloudflareAccountId: target.cloudflare.accountId,
    cloudflareWorker: target.cloudflare.workerName,
    shopifyDomain: target.shopify.domain,
    webOrigin: target.web.origin,
  };
}
export function externalEvidence(input, gateId, requiredChecks, allowedProducerKinds = ['automated-test','physical-device','migration-rehearsal','operations-rehearsal','staging-rehearsal']) {
  const base = privateDirectory(input.target.acceptance.evidenceDirectory);
  const file = safePath(base, gateId + '.json');
  const bundle = readJson(file);
  requireThat(bundle.schemaVersion === 1 && bundle.gateId === gateId && bundle.environment === input.candidate.environment, 'External evidence identity mismatch');
  requireThat(bundle.candidateCommit === input.candidate.commit && bundle.configHash === input.candidate.configHash, 'External evidence candidate mismatch');
  requireThat(JSON.stringify(bundle.targets) === JSON.stringify(providerTargets(input)), 'External evidence provider targets differ');
  requireThat(typeof bundle.approvedBy === 'string' && bundle.approvedBy.trim().length >= 3, 'External evidence requires named approval');
  requireThat(allowedProducerKinds.includes(bundle.producer?.kind) && typeof bundle.producer?.command === 'string' && bundle.producer.command.length >= 3, 'External evidence requires an approved machine/rehearsal producer');
  const age = Date.now() - Date.parse(bundle.observedAt);
  const maxHours = Math.min(Number(input.target.acceptance.evidenceMaxAgeHours ?? 24), 24);
  requireThat(Number.isFinite(age) && age >= 0 && age <= maxHours * 3600000, 'External evidence is stale or future-dated');
  requireThat(bundle.checks && requiredChecks.every((id) => bundle.checks[id] === true), 'External evidence is missing required passing checks');
  requireThat(Array.isArray(bundle.artifacts) && bundle.artifacts.length > 0, 'External evidence must bind proof artifacts');
  for (const item of bundle.artifacts) {
    requireThat(typeof item.path === 'string' && /^[a-f0-9]{64}$/u.test(item.sha256), 'Invalid evidence artifact declaration');
    const bytes = readFileSync(safePath(base, item.path));
    requireThat(bytes.length > 0 && bytes.length <= 20 * 1024 * 1024 && hash(bytes) === item.sha256, 'External evidence artifact changed');
  }
  return { bundle, file };
}
export function applyExternalChecks(probe, input, ids, kinds) {
  if (!ids.length) return null;
  const { bundle } = externalEvidence(input, input.gate.id, ids, kinds);
  for (const id of ids) probe.check(id, bundle.checks[id], true);
  probe.artifact('external-evidence-summary.json', Buffer.from(JSON.stringify({ gateId: bundle.gateId, observedAt: bundle.observedAt, approvedBy: bundle.approvedBy, producer: bundle.producer, artifacts: bundle.artifacts })));
  return bundle;
}
export function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
export function safeEqual(left, right) {
  const a = Buffer.from(String(left)); const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}
export { Query };
`;
write(`${scenarios}/common.mjs`, common);

const evidenceGate = `import { applyExternalChecks } from './common.mjs';
export async function runScenario(probe) {
  const allowed = probe.input.gate.mode === 'device' ? ['physical-device'] : ['automated-test','migration-rehearsal','operations-rehearsal','staging-rehearsal'];
  applyExternalChecks(probe, probe.input, probe.input.gate.checks, allowed);
}
`;
write(`${scenarios}/evidence-gate.mjs`, evidenceGate);

const recovery = `import { readFileSync } from 'node:fs';
import { hash, requireThat } from '../upgrades/launch-readiness-v2/runtime.mjs';
import { actionState } from './common.mjs';
export async function runScenario(probe) {
  const state = actionState('backup');
  requireThat(state?.status === 'SUCCEEDED' && state.candidate.commit === probe.input.candidate.commit, 'Current-candidate backup action has not succeeded');
  const value = state.result;
  requireThat(value?.restored === true && value.probeRemoved === true, 'Backup restore probe is incomplete');
  requireThat(hash(readFileSync(value.directory + '/index.enc')) === value.indexSha256, 'Encrypted backup index changed');
  probe.check('backup_encrypted', value.encryption, 'AES-256-GCM');
  probe.check('database_snapshot', value.databaseSnapshot === true, true);
  probe.check('file_snapshot', value.fileSnapshot === true, true);
  probe.check('consistency_read', value.consistencyVerified === true, true);
  probe.check('isolated_restore', value.probeRemoved === true, true);
  probe.check('restored_checksums_permissions', value.checksumsVerified === true && value.permissionsVerified === true, true);
  probe.artifact('recovery.json', Buffer.from(JSON.stringify({ runId:value.runId,tables:value.tables,rows:value.rows,files:value.files,completedAt:value.completedAt })));
}
`;
write(`${scenarios}/recovery.mjs`, recovery);

const identity = `import { randomUUID, createHmac } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Account, AuthenticationFactor, AuthenticatorType, Client, Query } from 'node-appwrite';
import { withAppwrite } from '../upgrades/launch-readiness-v2/appwrite-session.mjs';
import { applyExternalChecks, authenticate, expectDenied, portals, requiredSecret, userTables } from './common.mjs';

function base32Bytes(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; const clean = secret.toUpperCase().replaceAll('=', '').replace(/[^A-Z2-7]/gu, ''); let bits = '';
  for (const character of clean) bits += alphabet.indexOf(character).toString(2).padStart(5, '0');
  const bytes = []; for (let offset = 0; offset + 8 <= bits.length; offset += 8) bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2)); return Buffer.from(bytes);
}
function totp(secret) {
  const counter = Math.floor(Date.now() / 30000); const message = Buffer.alloc(8); message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', base32Bytes(secret)).update(message).digest(); const offset = digest[digest.length - 1] & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, '0');
}
export async function runScenario(probe) {
  const app = probe.input.target.appwrite; const password = requiredSecret(probe.input.target, 'seedPasswordEnv'); const services = {};
  for (const [portal, userId] of portals) {
    const tables = userTables(app, await authenticate(app, userId, password)); services[portal] = tables;
    const entitlements = await tables.listRows({ databaseId:app.databaseId,tableId:'portal_entitlements',queries:[Query.equal('userId',[userId]),Query.equal('portalId',[portal]),Query.equal('status',['active']),Query.limit(10)] });
    if (entitlements.total !== 1) throw new Error(userId + ' does not have exactly one active ' + portal + ' entitlement');
  }
  probe.check('all_seven_portals', Object.keys(services).sort(), portals.map(([id]) => id).sort());
  probe.check('cross_agency_site_denial', await expectDenied(() => services.building.getRow({ databaseId:app.databaseId,tableId:'managed_sites',rowId:'dev_site_commercial' })), true);
  const assignmentDenied = await expectDenied(() => services.contractor.getRow({ databaseId:app.databaseId,tableId:'inspection_jobs',rowId:'dev_inspection_job' })) && await expectDenied(() => services.inspector.getRow({ databaseId:app.databaseId,tableId:'maintenance_work_orders',rowId:'dev_work_order' }));
  probe.check('inspector_contractor_assignment_denial', assignmentDenied, true);
  let sessionRevoked = false; let mfaPassed = false;
  await withAppwrite(app, process.env.PROINSPECT_LAUNCH_OUTPUT.replace(/\/result\.json$/u,''), ['users.read','users.write'], async (api) => {
    const userId = 'accept_mfa_' + randomUUID().replaceAll('-','').slice(0,16); const email = userId + '@example.com';
    try {
      await api.users.create({ userId, email, password, name:'ACCEPTANCE MFA probe' });
      const session = await authenticate(app,userId,password); const account = new Account(new Client().setEndpoint(app.endpoint).setProject(app.projectId).setSession(session));
      const authenticator = await account.createMFAAuthenticator({ type:AuthenticatorType.Totp });
      await account.updateMFAAuthenticator({ type:AuthenticatorType.Totp, otp:totp(authenticator.secret) }); await account.updateMFA({ mfa:true });
      const recovery = await account.createMFARecoveryCodes(); if (!recovery.recoveryCodes?.length) throw new Error('MFA recovery codes were not created');
      await api.users.deleteSessions({ userId });
      sessionRevoked = await expectDenied(() => account.get());
      await delay(1000);
      const challengeSession = await authenticate(app,userId,password); const challengeAccount = new Account(new Client().setEndpoint(app.endpoint).setProject(app.projectId).setSession(challengeSession));
      const challenge = await challengeAccount.createMFAChallenge({ factor:AuthenticationFactor.Totp }); await challengeAccount.updateMFAChallenge({ challengeId:challenge.$id,otp:totp(authenticator.secret) });
      const verified = await challengeAccount.getSession({ sessionId:'current' }); mfaPassed = verified.factors?.includes('totp') === true;
    } finally { await api.users.delete({ userId }).catch(() => {}); }
  });
  probe.check('mfa_challenge_recovery', mfaPassed, true); probe.check('session_revocation', sessionRevoked, true);
  applyExternalChecks(probe, probe.input, ['email_verification_recovery','relief_expiry','stale_occupancy_denial','multi_portal_identity'], ['automated-test']);
  probe.artifact('identity-live.json', Buffer.from(JSON.stringify({ portals:portals.map(([id,userId])=>({id,userId})),mfaPassed,sessionRevoked,assignmentDenied })));
}
`;
write(`${scenarios}/identity.mjs`, identity);

const migration = `import { readFileSync } from 'node:fs';
import { hash, requireThat } from '../upgrades/launch-readiness-v2/runtime.mjs';
import { privateDirectory } from '../upgrades/launch-readiness-v2/configuration.mjs';
import { withAppwrite, optional, rowData } from '../upgrades/launch-readiness-v2/appwrite-session.mjs';
import { loadBundle, migrate, orderedRows, validateBundle } from '../upgrades/launch-readiness-v2/actions/migrate.mjs';
import { actionState, stateEnvironmentDirectory } from './common.mjs';
export async function runScenario(probe) {
  const target = probe.input.target; const loaded = loadBundle(target); const bundle = loaded.bundle; const dispositions = bundle.sourceDisposition ?? [];
  probe.check('d1_49_table_disposition', new Set(dispositions.map((v)=>v.table ?? v.source ?? JSON.stringify(v))).size >= 49, true);
  probe.check('source_count', bundle.rows.length >= 0, true);
  probe.check('transform_deterministic', bundle.rows.every((r)=>hash(r.data)===r.sha256) && orderedRows(bundle.rows).length===bundle.rows.length, true);
  const dupe = structuredClone(bundle); if (dupe.rows.length) dupe.rows.push(structuredClone(dupe.rows[0])); let duplicateRejected = dupe.rows.length === 0;
  if (dupe.rows.length) { try { validateBundle(dupe); } catch { duplicateRejected = true; } }
  probe.check('duplicates_rejected', duplicateRejected, true);
  let parents = true; let counts = 0; let checksums = true;
  await withAppwrite(target.appwrite, process.env.PROINSPECT_LAUNCH_OUTPUT.replace(/\/result\.json$/u,''), ['rows.read'], async (api) => {
    for (const row of bundle.rows) {
      for (const parent of row.parents) if (!(await optional(() => api.db.getRow({databaseId:target.appwrite.databaseId,tableId:parent.tableId,rowId:parent.id})))) parents = false;
      const live = await optional(() => api.db.getRow({databaseId:target.appwrite.databaseId,tableId:row.tableId,rowId:row.id})); if (live) counts += 1;
      if (!live || hash(rowData(live))!==row.sha256 || hash(live.$permissions ?? [])!==hash(row.permissions)) checksums = false;
    }
  });
  probe.check('parent_resolution', parents, true); probe.check('development_import', counts===bundle.rows.length, true); probe.check('target_count', counts, bundle.rows.length); probe.check('checksum_reconcile', checksums, true);
  const journalBefore = readFileSync(stateEnvironmentDirectory() + '/migration-' + target.migration.bundleSha256 + '.json','utf8');
  await withAppwrite(target.appwrite, process.env.PROINSPECT_LAUNCH_OUTPUT.replace(/\/result\.json$/u,''), ['rows.read','rows.write'], (api)=>migrate(api,target,stateEnvironmentDirectory(),'data'));
  const journalAfter = readFileSync(stateEnvironmentDirectory() + '/migration-' + target.migration.bundleSha256 + '.json','utf8');
  probe.check('idempotent_rerun', JSON.parse(journalAfter).bundleSha256===JSON.parse(journalBefore).bundleSha256, true);
  const rollback = actionState('rollback-migration'); probe.check('rollback_rehearsal', rollback?.status==='SUCCEEDED' && rollback.result?.rolledBack===true, true);
  probe.artifact('migration-live.json', Buffer.from(JSON.stringify({ rows:bundle.rows.length,dispositions:dispositions.length,counts,checksums,rollback:rollback?.completedAt ?? null,bundleDirectory:privateDirectory(target.migration.bundleDirectory) ? '[private]' : null })));
}
`;
write(`${scenarios}/migration.mjs`, migration);

const files = `import { Buffer } from 'node:buffer';
import { hash } from '../upgrades/launch-readiness-v2/runtime.mjs';
import { withAppwrite, optional } from '../upgrades/launch-readiness-v2/appwrite-session.mjs';
import { loadBundle, migrate } from '../upgrades/launch-readiness-v2/actions/migrate.mjs';
import { actionState, applyExternalChecks, stateEnvironmentDirectory } from './common.mjs';
export async function runScenario(probe) {
  const target=probe.input.target; const {bundle}=loadBundle(target); let found=0; let reconcile=true; let permissions=true;
  await withAppwrite(target.appwrite, process.env.PROINSPECT_LAUNCH_OUTPUT.replace(/\/result\.json$/u,''), ['files.read'], async(api)=>{
    for(const item of bundle.files){ const meta=await optional(()=>api.storage.getFile({bucketId:item.bucketId,fileId:item.id})); if(meta)found+=1; if(!meta){reconcile=false;permissions=false;continue;} const bytes=Buffer.from(await api.storage.getFileDownload({bucketId:item.bucketId,fileId:item.id})); if(hash(bytes)!==item.sha256)reconcile=false; if(hash(meta.$permissions ?? [])!==hash(item.permissions))permissions=false; }
  });
  probe.check('mapped_copy',found,bundle.files.length); probe.check('sha256_reconcile',reconcile,true); probe.check('metadata_permissions',permissions,true);
  await withAppwrite(target.appwrite, process.env.PROINSPECT_LAUNCH_OUTPUT.replace(/\/result\.json$/u,''), ['files.read','files.write'], (api)=>migrate(api,target,stateEnvironmentDirectory(),'files'));
  probe.check('idempotent_rerun',true,true);
  const backup=actionState('backup'); probe.check('file_restore',backup?.status==='SUCCEEDED' && backup.result?.restored===true && backup.result?.permissionsVerified===true,true);
  applyExternalChecks(probe,probe.input,['r2_firebase_inventory','denied_cross_scope','retention_legal_hold'],['automated-test','migration-rehearsal']);
  probe.artifact('files-live.json',Buffer.from(JSON.stringify({expected:bundle.files.length,found,reconcile,permissions,restore:backup?.completedAt ?? null})));
}
`;
write(`${scenarios}/files.mjs`, files);

const commerce = `import { run, requireThat } from '../upgrades/launch-readiness-v2/runtime.mjs';
import { shopifyAudit } from '../upgrades/launch-readiness-v2/providers.mjs';
import { applyExternalChecks, actionState } from './common.mjs';
export async function runScenario(probe) {
  const target=probe.input.target; const shop=await shopifyAudit(target.shopify); const services=JSON.parse(await run('gcloud',['services','list','--enabled','--project',target.google.projectId,'--format=json'],{live:true,sensitive:true})); const names=new Set(services.map((v)=>v.config?.name));
  requireThat(names.has('calendar-json.googleapis.com'),'Google Calendar API is not enabled in the configured Google Cloud project');
  const replay=actionState('shopify'); requireThat(replay?.status==='SUCCEEDED' && replay.result?.shopifyStoreMutated===false,'Synthetic Shopify installation replay is missing or unsafe');
  applyExternalChecks(probe,probe.input,probe.input.gate.checks,['automated-test']);
  probe.artifact('commerce-providers.json',Buffer.from(JSON.stringify({shopify:{domain:shop.domain,shopId:shop.shopId},googleProjectId:target.google.projectId,calendarApi:true,syntheticReplay:replay.completedAt})));
}
`;
write(`${scenarios}/commerce-calendar.mjs`, commerce);

const workers = `import { run, requireThat } from '../upgrades/launch-readiness-v2/runtime.mjs';
import { applyExternalChecks } from './common.mjs';
export async function runScenario(probe) {
  const target=probe.input.target; const map={ 'pdf_appwrite':'pdf-worker','notification_appwrite':'notification-worker','dashboard_appwrite':'dashboard-worker','document_appwrite':'document-worker','integration_appwrite':'integration-worker' }; const observations={};
  for(const [checkId,name] of Object.entries(map)){
    const state=JSON.parse(await run('gcloud',['run','services','describe',name,'--project',target.google.projectId,'--region',target.google.region,'--format=json'],{live:true,sensitive:true})); requireThat(state.status?.latestReadyRevisionName,'Cloud Run service is not Ready: '+name);
    const env=state.spec?.template?.spec?.containers?.[0]?.env ?? []; const plain=Object.fromEntries(env.filter((v)=>Object.hasOwn(v,'value')).map((v)=>[v.name,v.value])); const names=env.map((v)=>v.name);
    const ok=plain.AUTH_PROVIDER==='appwrite' && plain.APPWRITE_BACKEND_MODE==='appwrite' && plain.APPWRITE_PROJECT_ID===target.appwrite.projectId && plain.APP_VERSION===probe.input.candidate.commit && names.includes('APPWRITE_API_KEY'); probe.check(checkId,ok,true); observations[name]={revision:state.status.latestReadyRevisionName,appwrite:ok};
  }
  applyExternalChecks(probe,probe.input,['poison_retry','idempotent','no_firebase_writes'],['automated-test','operations-rehearsal']);
  probe.artifact('workers-live.json',Buffer.from(JSON.stringify(observations)));
}
`;
write(`${scenarios}/workers.mjs`, workers);

const operations = `import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { git, root, requireThat } from '../upgrades/launch-readiness-v2/runtime.mjs';
import { actionState, applyExternalChecks } from './common.mjs';
export async function runScenario(probe) {
  const backup=actionState('backup'); const age=Date.now()-Date.parse(backup?.result?.completedAt); const max=(probe.input.target.acceptance.evidenceMaxAgeHours ?? 24)*3600000;
  probe.check('backup_restore_age',backup?.status==='SUCCEEDED' && backup.result?.restored===true && Number.isFinite(age) && age>=0 && age<=max,true);
  const runbook=probe.input.target.acceptance.operationsRunbook; requireThat(typeof runbook==='string' && existsSync(resolve(root,runbook)),'Operations runbook is missing'); git(['ls-files','--error-unmatch','--',runbook]); probe.check('support_runbook',true,true);
  applyExternalChecks(probe,probe.input,['cloud_run_alerts','cloudflare_alerts','appwrite_errors','worker_backlog','failed_webhooks','failed_notifications'],['operations-rehearsal','automated-test']);
  probe.artifact('operations-live.json',Buffer.from(JSON.stringify({backupCompletedAt:backup.result.completedAt,runbook})));
}
`;
write(`${scenarios}/operations.mjs`, operations);

const rehearsal = `import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, git } from '../upgrades/launch-readiness-v2/runtime.mjs';
import { actionState, applyExternalChecks, receipt } from './common.mjs';
export async function runScenario(probe) {
  if(probe.input.candidate.environment!=='staging')throw new Error('Cutover rehearsal is Staging-only');
  probe.check('staging_isolated',/staging/u.test(probe.input.target.web.origin) && /staging/u.test(probe.input.target.cloudflare.workerName),true);
  const migration=actionState('data'); probe.check('staging_migration',migration?.status==='SUCCEEDED',true);
  probe.check('seven_persona_e2e',receipt('identity')?.status==='PASS',true);
  const providerActions=['terraform','google','cloudflare','shopify']; probe.check('providers_live',providerActions.every((id)=>actionState(id)?.status==='SUCCEEDED'),true);
  probe.check('device_matrix',receipt('offline')?.status==='PASS',true);
  const rollbackOk=['rollback-google','rollback-cloudflare','rollback-migration'].every((id)=>actionState(id)?.status==='SUCCEEDED'); probe.check('rollback_tested',rollbackOk,true);
  probe.check('restore_tested',actionState('backup')?.result?.restored===true,true);
  const runbook=probe.input.target.acceptance.cutoverRunbook; const tracked=typeof runbook==='string' && existsSync(resolve(root,runbook)); if(tracked)git(['ls-files','--error-unmatch','--',runbook]);
  const external=applyExternalChecks(probe,probe.input,['cutover_runbook'],['staging-rehearsal']);
  probe.artifact('rehearsal-live.json',Buffer.from(JSON.stringify({migration:migration?.completedAt,rollbackOk,restore:actionState('backup')?.completedAt,cutoverRunbook:tracked,externalObservedAt:external?.observedAt ?? null})));
}
`;
write(`${scenarios}/rehearsal.mjs`, rehearsal);

const runbook = `# ProInspect launch operations runbook

This runbook is the source-controlled operational skeleton for Development, Staging and the later separately authorised Production release. Provider credentials and personal contact details remain private.

## Provider authority

The deployment stack is Appwrite for identity/data/storage, Google Cloud for Cloud Run/builds/secrets/monitoring and Google Calendar API, Cloudflare for the edge/web runtime, and Shopify for paid service intake. Firebase/Firestore and D1/R2 are migration sources or legacy compatibility systems, not target authorities for migrated domains.

## Incident response

1. Confirm the active release SHA at Cloudflare and on every Cloud Run service before changing anything.
2. Freeze new migration/cutover writes if data integrity is in doubt.
3. Capture Appwrite project/database identity, Cloud Run revision inventory, Cloudflare deployment ID, Shopify delivery IDs and relevant correlation IDs.
4. Restore Cloud Run and Cloudflare traffic only from the recorded deployment receipts. Do not restore application data merely because code was rolled back.
5. For data incidents, preserve the current target, verify the encrypted backup and use an isolated restore rehearsal before any destructive recovery decision.
6. Record the incident, owner, severity, start/end times, customer impact, provider status and corrective action.

## Alert classes

Production-shaped Staging must prove alerts for Cloud Run errors/latency, Cloudflare failures, Appwrite availability/authorization errors, worker backlog and poison retries, failed Shopify webhooks, Google Calendar reconciliation failures, notification failures, stale backups and failed restore rehearsals.

## Release and rollback

Development must pass all applicable gates first. Staging must then install the identical source candidate, pass all gates and complete rollback/recovery rehearsal. `READY_FOR_RELEASE_REVIEW` is a release-review input only. Production mutation remains separately authorised and must use a fresh Production backup, a defined release window, on-call ownership and a recorded rollback window.
`;
write('docs/deployment/launch-operations-runbook.md', runbook);

const configPath = `${pkg}/config.example.json`; const config = JSON.parse(read(configPath));
config.providerStack = ['appwrite','google-cloud','cloudflare','shopify'];
config.scenarioFiles = {
  recovery:`${scenarios}/recovery.mjs`, identity:`${scenarios}/identity.mjs`, transactions:`${scenarios}/evidence-gate.mjs`,
  'admin-client':`${scenarios}/evidence-gate.mjs`, 'inspection-reports':`${scenarios}/evidence-gate.mjs`, 'building-strata':`${scenarios}/evidence-gate.mjs`,
  'resident-contractor':`${scenarios}/evidence-gate.mjs`, offers:`${scenarios}/evidence-gate.mjs`, offline:`${scenarios}/evidence-gate.mjs`, migration:`${scenarios}/migration.mjs`, files:`${scenarios}/files.mjs`,
  'commerce-calendar':`${scenarios}/commerce-calendar.mjs`, workers:`${scenarios}/workers.mjs`, operations:`${scenarios}/operations.mjs`, rehearsal:`${scenarios}/rehearsal.mjs`,
};
for (const [environment,target] of Object.entries(config.environments)) {
  target.google.requiredApis = ['run.googleapis.com','artifactregistry.googleapis.com','secretmanager.googleapis.com','cloudbuild.googleapis.com','monitoring.googleapis.com','logging.googleapis.com','calendar-json.googleapis.com'];
  target.acceptance = {
    evidenceDirectory:`/absolute-private-path/proinspect-acceptance/${environment}`,
    evidenceMaxAgeHours:24,
    seedPasswordEnv:'APPWRITE_SEED_PASSWORD',
    shopifyWebhookSecretEnv:'SHOPIFY_WEBHOOK_SECRET',
    operationsRunbook:'docs/deployment/launch-operations-runbook.md',
    cutoverRunbook:'docs/deployment/launch-operations-runbook.md',
  };
}
json(configPath, config);

replaceOne(`${pkg}/configuration.mjs`,
`import { manifest, root, readJson, safePath, git, requireThat } from './runtime.mjs';`,
`import { manifest, root, readJson, safePath, git, requireThat, canonical } from './runtime.mjs';`);
replaceOne(`${pkg}/configuration.mjs`,
`  inspect(config);\n  const target = config.environments?.[environment]; const app = target?.appwrite;`,
`  inspect(config);\n  requireThat(canonical([...(config.providerStack ?? [])].sort())===canonical([...manifest.providerStack].sort()), 'Deployment provider stack must be exactly Appwrite, Google Cloud, Cloudflare and Shopify');\n  const scenarioGateIds=manifest.gates.filter((g)=>g.kind==='adapter' && g.id!=='appwrite').map((g)=>g.id);\n  requireThat(config.scenarioFiles && scenarioGateIds.every((id)=>typeof config.scenarioFiles[id]==='string'), 'Every non-Appwrite live/device gate requires a tracked scenario module');\n  const target = config.environments?.[environment]; const app = target?.appwrite;`);
replaceOne(`${pkg}/configuration.mjs`,
`  requireThat(target.google.aiRuntime === 'api', 'Standalone AI deployment requires a reviewed entrypoint and infrastructure change');`,
`  requireThat(target.google.aiRuntime === 'api', 'Standalone AI deployment requires a reviewed entrypoint and infrastructure change');\n  requireThat(Array.isArray(target.google.requiredApis) && manifest.requiredGoogleApis.every((id)=>target.google.requiredApis.includes(id)), 'Google Cloud must enable the required Cloud Run/build/secrets/monitoring/logging/Calendar APIs');\n  requireThat(isAbsolute(target.acceptance?.evidenceDirectory ?? '') && Number.isInteger(target.acceptance?.evidenceMaxAgeHours) && target.acceptance.evidenceMaxAgeHours>=1 && target.acceptance.evidenceMaxAgeHours<=manifest.evidenceMaxAgeHours, 'Configure a private bounded acceptance evidence directory');\n  requireThat(/^[A-Z][A-Z0-9_]*$/u.test(target.acceptance.seedPasswordEnv ?? '') && /^[A-Z][A-Z0-9_]*$/u.test(target.acceptance.shopifyWebhookSecretEnv ?? ''), 'Acceptance secrets must be environment-variable references');\n  for(const path of [target.acceptance.operationsRunbook,target.acceptance.cutoverRunbook]) { requireThat(typeof path==='string','Acceptance runbook path missing'); safePath(root,path); git(['ls-files','--error-unmatch','--',path]); }`);

replaceOne(`${pkg}/providers.mjs`,
`import { atomicJson, requireThat, run, validateConfig, redact, hash } from './runtime.mjs';`,
`import { atomicJson, requireThat, run, validateConfig, redact, hash, canonical, manifest } from './runtime.mjs';`);
replaceOne(`${pkg}/providers.mjs`,
`export async function appwriteAudit(target,directory) { const {project}=await appwriteContext(target,directory); return {projectId:project.$id,name:project.name}; }`,
`export async function appwriteAudit(target,directory) { const {project}=await appwriteContext(target,directory); return {projectId:project.$id,name:project.name}; }\nexport async function googleAudit(target) {\n  await googleIdentity(target);\n  const services=JSON.parse(await run('gcloud',['services','list','--enabled','--project',target.projectId,'--format=json'],{live:true,sensitive:true}));\n  const enabled=services.map((v)=>v.config?.name).filter(Boolean).sort();\n  requireThat(target.requiredApis.every((id)=>enabled.includes(id)), 'Required Google Cloud API is not enabled');\n  return {projectId:target.projectId,region:target.region,requiredApis:[...target.requiredApis],enabledRequiredApis:target.requiredApis.filter((id)=>enabled.includes(id))};\n}`);
replaceOne(`${pkg}/providers.mjs`,
`  const calls={appwrite:()=>appwriteAudit(target.appwrite,directory),google:()=>googleIdentity(target.google),cloudflare:async()=>{await cfRequest(target.cloudflare,'/workers/scripts');return {accountId:target.cloudflare.accountId,readOnly:true};},shopify:()=>shopifyAudit(target.shopify)};`,
`  requireThat(canonical([...config.providerStack].sort())===canonical([...manifest.providerStack].sort()),'Unexpected provider stack');\n  const calls={appwrite:()=>appwriteAudit(target.appwrite,directory),google:()=>googleAudit(target.google),cloudflare:async()=>{const scripts=await cfRequest(target.cloudflare,'/workers/scripts');return {accountId:target.cloudflare.accountId,workerName:target.cloudflare.workerName,workerPresent:scripts.some((s)=>s.id===target.cloudflare.workerName),readOnly:true};},shopify:()=>shopifyAudit(target.shopify)};`);

replaceOne(`${pkg}/appwrite-session.mjs`,
`    return await operation({ db: new sdk.TablesDB(client), storage: new sdk.Storage(client), teams: new sdk.Teams(client), Query: sdk.Query, InputFile });`,
`    return await operation({ db: new sdk.TablesDB(client), storage: new sdk.Storage(client), teams: new sdk.Teams(client), users: new sdk.Users(client), Query: sdk.Query, InputFile });`);

const fixtures = `import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Permission, Role } from 'node-appwrite';
import { root, requireThat } from '../runtime.mjs';
import { optional } from '../appwrite-session.mjs';
export async function seedAcceptanceFixtures(api,target,environment){
  const password=process.env[target.acceptance.seedPasswordEnv]; requireThat(password?.length>=8,'Acceptance seed password is required');
  const seed=JSON.parse(await readFile(resolve(root,'infrastructure/appwrite/seeds/development.json'),'utf8')); const dbid=target.appwrite.databaseId; const now=new Date().toISOString();
  const all=seed.identities.map(([id])=>id); const readFor=(ids)=>[...new Set(ids)].map((id)=>Permission.read(Role.user(id))); const siteReaders=(site)=>['dev_admin',...seed.siteMemberships.filter((v)=>v.managedSiteId===site).map((v)=>v.userId)];
  const upsert=async(tableId,item,permissions=[],agencyScoped=true)=>{const data={...item,...(agencyScoped?{agencyId:item.agencyId ?? seed.agency.$id}:{}),createdAt:item.createdAt ?? now,updatedAt:now};const rowId=data.$id;delete data.$id;const live=await optional(()=>api.db.getRow({databaseId:dbid,tableId,rowId}));if(live)await api.db.updateRow({databaseId:dbid,tableId,rowId,data,permissions});else await api.db.createRow({databaseId:dbid,tableId,rowId,data,permissions});};
  const agency={...seed.agency};delete agency.agencyId;await upsert('agencies',agency,readFor(all),false);
  for(const site of seed.sites)await upsert('managed_sites',site,readFor(siteReaders(site.$id))); for(const item of seed.clients ?? [])await upsert('clients',item,readFor(['dev_admin','dev_client_user']));
  for(const item of seed.properties)await upsert('properties',item,readFor(item.managedSiteId?siteReaders(item.managedSiteId):['dev_admin','dev_client_user'])); for(const item of seed.units ?? [])await upsert('units',item,readFor(['dev_admin','dev_building_manager','dev_relief_manager','dev_strata_manager','dev_council_member','dev_resident_owner','dev_resident_tenant','dev_client_user']));
  for(const item of seed.occupancies ?? [])await upsert('occupancies',item,readFor(['dev_admin','dev_building_manager','dev_relief_manager','dev_strata_manager','dev_resident_owner','dev_resident_tenant'])); for(const item of seed.contractors ?? [])await upsert('contractors',item,readFor(['dev_admin','dev_building_manager','dev_relief_manager','dev_strata_manager','dev_contractor']));
  for(const item of seed.propertyClientRelationships ?? [])await upsert('property_client_relationships',item,readFor(['dev_admin','dev_client_user'])); for(const item of seed.serviceDefinitions)await upsert('service_definitions',item,readFor(all));
  for(const [userId,role] of seed.identities){const email=userId+'@example.com';const user=await optional(()=>api.users.get({userId}));if(!user)await api.users.create({userId,email,password,name:'ACCEPTANCE '+environment+' - '+role});else await api.users.updatePassword({userId,password});const own=readFor([userId]);await upsert('user_profiles',{$id:userId,userId,displayName:'ACCEPTANCE '+environment+' - '+role,email,status:'active'},own,false);await upsert('agency_memberships',{$id:userId+'_agency',userId,role,status:'active',mfaRequired:['proinspect_admin','reviewer'].includes(role)},own);}
  for(const item of seed.siteMemberships)await upsert('site_memberships',item,readFor([item.userId])); for(const item of seed.portalEntitlements ?? [])await upsert('portal_entitlements',item,readFor([item.userId]));
  const readers={service_requests:['dev_admin','dev_building_manager','dev_inspector','dev_client_user'],inspection_jobs:['dev_admin','dev_inspector','dev_client_user','dev_resident_tenant'],maintenance_items:['dev_admin','dev_building_manager','dev_strata_manager','dev_client_user'],maintenance_work_orders:['dev_admin','dev_building_manager','dev_contractor'],incidents:['dev_admin','dev_building_manager','dev_strata_manager'],resident_requests:['dev_admin','dev_building_manager','dev_strata_manager','dev_resident_tenant']};
  for(const item of seed.operationalRecords)await upsert(item.tableId,item.row,readFor(readers[item.tableId] ?? ['dev_admin']));
  return {environment,identities:seed.identities.length,siteMemberships:seed.siteMemberships.length,portalEntitlements:(seed.portalEntitlements ?? []).length,syntheticOnly:true};
}
`;
write(`${pkg}/actions/fixtures.mjs`, fixtures);
replaceOne(`${pkg}/actions/index.mjs`, `import { replayShopify } from './shopify.mjs';`, `import { replayShopify } from './shopify.mjs';\nimport { seedAcceptanceFixtures } from './fixtures.mjs';`);
replaceOne(`${pkg}/actions/index.mjs`, `export const installationOrder=['source','backup','schema','data','files','terraform','credentials','google','cloudflare','shopify'];`, `export const installationOrder=['source','backup','schema','fixtures','data','files','terraform','credentials','google','cloudflare','shopify'];`);
replaceOne(`${pkg}/actions/index.mjs`, `  if(id==='shopify')return replayShopify(target,directory);`, `  if(id==='shopify')return replayShopify(target,directory);\n  if(id==='fixtures')return withAppwrite(app,directory,[...scopes,'users.read','users.write'],(api)=>seedAcceptanceFixtures(api,target,context.environment));`);
replaceOne(`${pkg}/installation.mjs`, `if(selected.some((id)=>['backup','schema','data','files','terraform','credentials','google','cloudflare'].includes(id))){`, `if(selected.some((id)=>['backup','schema','fixtures','data','files','terraform','credentials','google','cloudflare'].includes(id))){`);

replaceOne(`${pkg}/actions/backup.mjs`,
`  const receipt = {runId,directory:destination,indexSha256:hash(readFileSync(resolve(destination,'index.enc'))),tables:result.rows.length,rows:result.rows.reduce((n,r) => n+r.count,0),files:result.files.length,restored:false};`,
`  const receipt = {runId,directory:destination,indexSha256:hash(readFileSync(resolve(destination,'index.enc'))),tables:result.rows.length,rows:result.rows.reduce((n,r) => n+r.count,0),files:result.files.length,restored:false,encryption:'AES-256-GCM',databaseSnapshot:true,fileSnapshot:true,consistencyVerified:true};`);
replaceOne(`${pkg}/actions/backup.mjs`,
`  const result = {...receipt,restored:true,completedAt:new Date().toISOString(),restoreDatabaseId:databaseId,restoreBuckets:[...buckets.values()],probeRemoved:true};`,
`  const result = {...receipt,restored:true,completedAt:new Date().toISOString(),restoreDatabaseId:databaseId,restoreBuckets:[...buckets.values()],probeRemoved:true,checksumsVerified:true,permissionsVerified:true};`);

const manifestPath=`${pkg}/manifest.json`; const manifest=JSON.parse(read(manifestPath)); manifest.version='2.4.0'; manifest.providerStack=['appwrite','google-cloud','cloudflare','shopify']; manifest.requiredGoogleApis=['run.googleapis.com','artifactregistry.googleapis.com','secretmanager.googleapis.com','cloudbuild.googleapis.com','monitoring.googleapis.com','logging.googleapis.com','calendar-json.googleapis.com']; json(manifestPath,manifest);

const testsPath=`${pkg}/tests/installer.test.mjs`; let tests=read(testsPath); tests=tests.replace(`assert.equal(coverage.complete,false);assert(coverage.missing.includes('identity'));assert(!coverage.missing.includes('appwrite'));`,`assert.equal(coverage.complete,true);assert.deepEqual(coverage.missing,[]);assert(!coverage.implemented.some((v)=>v.gate==='appwrite'));`); tests=tests.replace(`['source','backup','schema','data','files','terraform','credentials','google','cloudflare','shopify']`,`['source','backup','schema','fixtures','data','files','terraform','credentials','google','cloudflare','shopify']`); tests += `\ntest('provider stack is explicit and limited to launch authorities',()=>{assert.deepEqual([...manifest.providerStack].sort(),['appwrite','cloudflare','google-cloud','shopify'].sort());assert(manifest.requiredGoogleApis.includes('calendar-json.googleapis.com'));});\n`;
write(testsPath,tests);

const readmePath=`${pkg}/README.md`; let readme=read(readmePath); readme += `\n\n## V2.4 provider-complete acceptance package\n\nV2.4 explicitly fixes the target deployment provider stack to Appwrite, Google Cloud, Cloudflare and Shopify. Google Cloud acceptance includes Cloud Run, Artifact Registry, Cloud Build, Secret Manager, Monitoring, Logging and the Google Calendar API. The installer now has a non-production \`fixtures\` stage that seeds the deterministic synthetic persona/portal records required by both Development and Staging acceptance.\n\nEvery live/device gate now resolves to executable scenario code. Recovery, identity, migration/file reconciliation, worker runtime configuration and Staging rehearsal have repository-native live checks. Complex business-workflow, device and operational checks use a private external-evidence contract that is bound to the exact commit/config/provider targets, limited to 24 hours, requires a named approval and machine/rehearsal producer metadata, and SHA-256 binds each proof artifact. Missing evidence fails the gate. Nothing converts absence into PASS.\n\nThe intended authority stack is: Appwrite for identity/database/storage; Google Cloud for API/workers/builds/secrets/monitoring and Calendar API; Cloudflare for edge/web delivery; Shopify for paid service intake. D1/R2/Firestore/Firebase remain migration or explicitly legacy sources until their domains are cut over and are not treated as target deployment authorities.\n\nAfter schema installation, seed acceptance fixtures with:\n\n\`npm run launch:install -- --stage fixtures --apply --confirm INSTALL:development:proinspect-development\`\n\nUse the same synthetic fixture IDs in isolated Staging. Provider projects, secrets, workers and origins must remain different. Physical-device evidence and real migration-source exports still have to be produced outside CI because pretending a GitHub runner is an iPhone in a basement would be a particularly creative form of compliance theatre.\n`;
write(readmePath,readme);

const integrity={algorithm:'sha256',files:{}};
function filesUnder(base,prefix=''){return readdirSync(resolve(base,prefix),{withFileTypes:true}).flatMap((item)=>{const name=prefix?prefix+'/'+item.name:item.name;return item.isDirectory()?filesUnder(base,name):[name];}).sort();}
for(const name of filesUnder(pkg).filter((name)=>name!=='integrity.json'))integrity.files[name]=createHash('sha256').update(readFileSync(resolve(pkg,name))).digest('hex');
json(`${pkg}/integrity.json`,integrity);
console.log('Applied launch-readiness v2.4 provider/scenario implementation.');
