import { resolve } from 'node:path';
import { atomicJson, run, requireThat, canonical } from '../runtime.mjs';
import { appwriteContext } from '../appwrite-session.mjs';
import { credentialInputs, equalSecrets, minimumRemainingMs, requireStoredKeyControl, verifyStoredCredential } from '../stored-credential.mjs';
import { googleIdentity } from './google.mjs';

export function validateCredentialPolicy(policy, services) {
  requireThat(Array.isArray(policy) && policy.length > 0, 'Declare reviewed per-service runtime credential policies');
  const allowed = new Set(['databases.read','tables.read','columns.read','indexes.read','rows.read','rows.write','files.read','files.write','buckets.read','users.read','users.write','teams.read','teams.write']);
  const seen = new Set(); const secrets = new Set();
  for (const item of policy) {
    requireThat(services.includes(item.service) && !seen.has(item.service), 'Invalid/duplicate credential service'); seen.add(item.service);
    requireThat(/^[a-z][a-z0-9_-]{2,200}$/u.test(item.secretId) && !secrets.has(item.secretId), 'Invalid or shared Secret Manager name'); secrets.add(item.secretId);
    requireThat(Number.isInteger(item.expiryHours) && item.expiryHours >= 1 && item.expiryHours <= 720, 'Explicit runtime credential lifetime must be 1-720 hours');
    requireThat(Array.isArray(item.scopes) && item.scopes.length > 0 && new Set(item.scopes).size === item.scopes.length && item.scopes.every((s) => allowed.has(s)), 'Excessive or invalid runtime key scopes');
    requireThat(item.service === 'api' || !item.scopes.some((s) => /^(?:users|teams)\./u.test(s)), 'Worker credentials cannot administer identities');
    requireThat(item.rollbackHours === undefined || (Number.isInteger(item.rollbackHours) && item.rollbackHours >= 1 && item.rollbackHours <= 168), 'Rollback retention must be 1-168 hours');
  }
  return true;
}
export function credentialUsable(key, policy, now = Date.now()) {
  return Boolean(key && Array.isArray(key.scopes) && Date.parse(key.expire) > now + minimumRemainingMs(policy.expiryHours) && Date.parse(key.expire) <= now + policy.expiryHours * 3600000 && canonical([...key.scopes].sort()) === canonical([...policy.scopes].sort()));
}
export function checkCredentialInputs(target, environment, env = process.env) {
  validateCredentialPolicy(target.appwrite.runtimeCredentialPolicies, target.google.services);
  for (const policy of target.appwrite.runtimeCredentialPolicies) {
    const active = target.appwrite.approvedRuntimeKeys?.find((k) => k.service === policy.service && k.status === 'active' && k.secretRef === target.google.runtimeBindings[policy.service]?.secretRefs?.APPWRITE_API_KEY);
    if (credentialUsable(active, policy)) continue; // Live verification still required by the action.
    const names = credentialInputs(environment, policy.service);
    requireThat(env[names.id] && env[names.secret], `Operator-created credential required: ${names.id} and ${names.secret}; use Console, never create-ephemeral-key`);
  }
}
export async function provisionCredentials(config, environment, directory, configurationPath, dependencies = {}) {
  const execute = dependencies.execute ?? run; const env = dependencies.env ?? process.env;
  const save = dependencies.save ?? atomicJson;
  const target = config.environments[environment]; const policies = target.appwrite.runtimeCredentialPolicies;
  validateCredentialPolicy(policies, target.google.services);
  requireThat(environment === 'development' ? target.appwrite.projectId === 'proinspect-development' && target.appwrite.projectName === 'ProInspect Development' : target.appwrite.projectId !== 'proinspect-development', 'Credential environment isolation mismatch');
  const { cli, cwd } = await appwriteContext(target.appwrite, directory, execute);
  await requireStoredKeyControl(cwd, execute);
  await (dependencies.googleIdentity ?? googleIdentity)(target.google);
  const created = []; const rotations = [];
  const inventory = await cli(['project','list-keys','--project-id',target.appwrite.projectId,'--limit','100']);
  requireThat(Array.isArray(inventory.keys) && inventory.total === inventory.keys.length, 'Key inventory truncated');
  const gcloud = (args, input) => execute('gcloud', args, { live: true, sensitive: true, ...(input === undefined ? {} : { input }) });
  for (const policy of policies) {
    const binding = target.google.runtimeBindings[policy.service]; requireThat(binding?.secretRefs, 'Missing runtime binding');
    const bound = binding.secretRefs.APPWRITE_API_KEY;
    const approved = target.appwrite.approvedRuntimeKeys.find((item) => item.service === policy.service && item.secretRef === bound && item.status === 'active');
    const current = approved && inventory.keys.find((key) => key.$id === approved.id);
    if (bound) requireThat(new RegExp(`^${policy.secretId}:[1-9][0-9]*$`, 'u').test(bound), 'Bound credential does not match policy');
    const secretResource = JSON.parse(await gcloud(['secrets','describe',policy.secretId,'--project',target.google.projectId,'--format=json']));
    requireThat(new RegExp(`^projects/[^/]+/secrets/${policy.secretId}$`, 'u').test(secretResource.name), 'Invalid Secret Manager identity');
    const verifyVersion = async (number, expected) => {
      const version = JSON.parse(await gcloud(['secrets','versions','describe',number,'--secret',policy.secretId,'--project',target.google.projectId,'--format=json']));
      requireThat(version.name === `${secretResource.name}/versions/${number}` && version.state === 'ENABLED', 'Immutable secret version is not verified/enabled');
      const stored = await gcloud(['secrets','versions','access',number,'--secret',policy.secretId,'--project',target.google.projectId]);
      requireThat(equalSecrets(stored, expected), 'Immutable secret version payload mismatch');
    };
    if (bound && credentialUsable(current, policy)) {
      const stored = await gcloud(['secrets','versions','access',bound.split(':')[1],'--secret',policy.secretId,'--project',target.google.projectId]);
      await verifyStoredCredential(cli, target.appwrite, { id: current.$id, secret: stored, scopes: policy.scopes, maxHours: policy.expiryHours });
      await verifyVersion(bound.split(':')[1], stored);
      continue;
    }
    const names = credentialInputs(environment, policy.service); let supplied = env[names.secret];
    let number; let accepted = false;
    try {
      const key = await verifyStoredCredential(cli, target.appwrite, { id: env[names.id], secret: supplied, scopes: policy.scopes, maxHours: policy.expiryHours });
      requireThat(!target.appwrite.approvedRuntimeKeys.some((item) => item.id === key.id), 'Import requires a separate, previously unbound service key');
      const previous = approved && current && Date.parse(current.expire) > Date.now() ? { ...approved, status: 'retiring', retireAfter: new Date(Math.min(Date.parse(current.expire), Date.now() + (policy.rollbackHours ?? 24) * 3600000)).toISOString() } : null;
      // Publish and read back before updating config. Never revoke an operator key
      // on publication failure, nor change the previous known-good binding.
      atomicJson(resolve(directory, `runtime-key-${policy.service}.json`), { ...key, service: policy.service, state: 'PUBLICATION_PENDING', previousSecretRef: bound ?? null });
      const version = JSON.parse(await gcloud(['secrets','versions','add',policy.secretId,'--project',target.google.projectId,'--data-file=-','--format=json'], supplied));
      const returnedNumber = version.name?.split('/').at(-1);
      requireThat(/^[1-9][0-9]*$/u.test(returnedNumber) && version.name === `${secretResource.name}/versions/${returnedNumber}`, 'No immutable secret version returned');
      number = returnedNumber;
      await verifyVersion(number, supplied);
      const active = { ...key, service: policy.service, secretRef: `${policy.secretId}:${number}`, status: 'active' };
      const next = globalThis.structuredClone(config); const nextTarget = next.environments[environment];
      nextTarget.appwrite.approvedRuntimeKeys = nextTarget.appwrite.approvedRuntimeKeys.filter((item) => item.id !== approved?.id);
      if (previous) nextTarget.appwrite.approvedRuntimeKeys.push(previous);
      nextTarget.appwrite.approvedRuntimeKeys.push(active);
      nextTarget.google.runtimeBindings[policy.service].secretRefs.APPWRITE_API_KEY = active.secretRef;
      save(configurationPath, next); accepted = true;
      target.appwrite.approvedRuntimeKeys = nextTarget.appwrite.approvedRuntimeKeys;
      binding.secretRefs.APPWRITE_API_KEY = active.secretRef;
      created.push(active);
      if (previous) rotations.push({ service: policy.service, oldKeyId: previous.id, newKeyId: key.id, retireAfter: previous.retireAfter, previousSecretRef: previous.secretRef });
      atomicJson(resolve(directory, `runtime-key-${policy.service}.json`), { ...active, state: 'VERIFIED_IMPORTED_BOUND', rotatedFrom: previous?.id ?? null });
    } catch (error) {
      if (number && !accepted) {
        try { await gcloud(['secrets','versions','disable',number,'--secret',policy.secretId,'--project',target.google.projectId,'--quiet']); }
        catch { throw new Error('Credential publication failed and new version cleanup is unverified; previous binding retained; inspect Secret Manager'); }
      }
      throw error;
    } finally { supplied = undefined; }
  }
  // Expired rollback windows are an explicit operator cleanup obligation. Do
  // not silently revoke a key that a deployed rollback revision may still use.
  if (rotations.length) atomicJson(resolve(directory, 'credential-rotation.json'), { environment, rotations, cleanup: 'Verify rollback revisions are retired, then revoke retiring keys and disable their numeric Secret Manager versions before retireAfter. Re-run credential and acceptance checks.' });
  return { created, rotations, configurationChanged: created.length > 0, requiresFreshAcceptance: created.length > 0, oldKeysRetainedForRollback: rotations.length > 0 };
}
