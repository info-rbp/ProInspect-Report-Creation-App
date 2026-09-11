import { Buffer } from 'node:buffer';
import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Client, Query, TablesDB } from 'node-appwrite';
import { privateDirectory } from '../upgrades/launch-readiness-v2/configuration.mjs';
import { canonical, hash, readJson, requireThat, safePath, sameSourceCandidate } from '../upgrades/launch-readiness-v2/runtime.mjs';

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
export function currentAction(id, input, { exactConfig = true } = {}) {
  const value = actionState(id);
  requireThat(value?.status === 'SUCCEEDED' && sameSourceCandidate(value.candidate, input.candidate), 'Action state is missing or belongs to another source candidate: ' + id);
  if (exactConfig) requireThat(value.candidate?.configHash === input.candidate.configHash, 'Action state belongs to another environment configuration: ' + id);
  return value;
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
    method: 'POST', redirect: 'error', signal: globalThis.AbortSignal.timeout(30000),
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
  const response = await fetch(url, { ...options, redirect: 'error', signal: globalThis.AbortSignal.timeout(30000) });
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
  requireThat(canonical(bundle.targets) === canonical(providerTargets(input)), 'External evidence provider targets differ');
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
