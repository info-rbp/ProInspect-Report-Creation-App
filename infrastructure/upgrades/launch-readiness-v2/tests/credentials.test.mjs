import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { provisionCredentials } from '../actions/credentials.mjs';
import { credentialInputs } from '../stored-credential.mjs';

function harness(options = {}) {
  const directory = mkdtempSync(resolve(tmpdir(), 'credential-import-')); const path = resolve(directory, 'config.json');
  const secret = 'synthetic-only-runtime-credential-value'; const policy = { service: 'api', scopes: ['rows.read'], secretId: 'appwrite-api', expiryHours: 24, rollbackHours: 1 };
  const key = { $id: 'new-key', name: 'development-api', secret, scopes: policy.scopes, expire: new Date(Date.now() + 23 * 3600000).toISOString(), ...options.key };
  const old = { $id: 'old-key', name: 'previous-api', scopes: policy.scopes, expire: new Date(Date.now() + 1800000).toISOString() };
  const config = { environments: { development: { appwrite: { endpoint: 'https://syd.cloud.appwrite.io/v1', projectId: 'proinspect-development', projectName: 'ProInspect Development', runtimeCredentialPolicies: [policy], approvedRuntimeKeys: options.rotation ? [{ id: old.$id, name: old.name, scopes: old.scopes, expire: old.expire, service: 'api', secretRef: 'appwrite-api:1', status: 'active' }] : [] }, google: { projectId: 'isolated-development', services: ['api'], runtimeBindings: { api: { secretRefs: options.rotation ? { APPWRITE_API_KEY: 'appwrite-api:1' } : {} } } } } } };
  const calls = []; const resource = 'projects/123/secrets/appwrite-api';
  const names = credentialInputs('development', 'api'); const env = { [names.id]: 'new-key', [names.secret]: secret, ...options.env };
  const execute = async (exe, args, opts) => {
    calls.push({ exe, args, opts });
    if (exe === 'appwrite') {
      if (args.includes('--help')) return `Usage:\n  appwrite project ${args[1]} [flags]\nFlags:\n  --project-id string\n  --key-id string\n  --limit int\n`;
      if (args.includes('get')) return JSON.stringify({ $id: 'proinspect-development', name: 'ProInspect Development', status: 'active', region: 'syd', ...options.project });
      if (args.includes('get-key')) return JSON.stringify(key);
      if (args.includes('list-keys')) return JSON.stringify({ total: options.rotation ? 2 : 1, keys: options.rotation ? [old, key] : [key] });
      throw new Error('Unexpected Appwrite mutation');
    }
    if (args[1] === 'describe') return JSON.stringify({ name: resource });
    if (args[2] === 'add') { if (options.publishFailure) throw new Error('Publication failed'); return JSON.stringify({ name: `${resource}/versions/2` }); }
    if (args[2] === 'describe') return JSON.stringify({ name: `${resource}/versions/2`, state: options.disabled ? 'DISABLED' : 'ENABLED' });
    if (args[2] === 'access') return options.payloadMismatch ? 'wrong-value' : secret;
    if (args[2] === 'disable') return '{}';
    throw new Error('Unexpected command');
  };
  return { directory, path, config, calls, key, secret, execute, env, run: () => provisionCredentials(config, 'development', directory, path, { execute, env, googleIdentity: async () => {}, ...(options.saveFailure ? { save: () => { throw new Error('Save failed'); } } : {}) }), clean: () => rmSync(directory, { recursive: true, force: true }) };
}
test('operator credential import publishes stdin only, verifies immutable payload, and saves non-secret metadata', async () => {
  const h = harness(); try {
    const result = await h.run(); assert.equal(result.created[0].secretRef, 'appwrite-api:2');
    const config = readFileSync(h.path, 'utf8'); assert(!config.includes(h.secret));
    assert(!h.calls.some((c) => c.args.some((a) => a.includes(h.secret))));
    assert.equal(h.calls.find((c) => c.args[2] === 'add').opts.input, h.secret);
    assert(h.calls.some((c) => c.args[2] === 'access')); assert(h.calls.every((c) => !c.opts.logFile));
  } finally { h.clean(); }
});
test('rotation retains only a bounded previous credential and version for controlled rollback', async () => {
  const h = harness({ rotation: true }); try {
    const result = await h.run(); assert.equal(result.oldKeysRetainedForRollback, true);
    const keys = h.config.environments.development.appwrite.approvedRuntimeKeys;
    assert.equal(keys.length, 2); assert.equal(keys[0].status, 'retiring'); assert.equal(keys[0].secretRef, 'appwrite-api:1'); assert(Date.parse(keys[0].retireAfter) <= Date.parse(keys[0].expire));
    assert(!h.calls.some((c) => c.args.includes('delete-key') && !c.args.includes('--help')));
  } finally { h.clean(); }
});
test('wrong project, scopes, metadata, absent/mismatched/ephemeral credential and unsafe expiry block publication', async () => {
  const cases = [ { project: { $id: 'wrong' } }, { key: { scopes: ['rows.write'] } }, { key: { $id: 'wrong' } }, { key: { name: null } }, { key: { scopes: null } }, { key: { secret: '[REDACTED]' } }, { env: { [credentialInputs('development', 'api').secret]: undefined } }, { key: { expire: 'invalid' } }, { key: { expire: new Date(Date.now() - 1).toISOString() } }, { key: { expire: new Date(Date.now() + 300000).toISOString() } }, { key: { expire: new Date(Date.now() + 48 * 3600000).toISOString() } }, { key: { type: 'ephemeral' } } ];
  for (const options of cases) { const h = harness(options); try { await assert.rejects(h.run()); assert(!h.calls.some((c) => c.args[2] === 'add')); } finally { h.clean(); } }
});
test('prohibited target is rejected before any provider call', async () => {
  const h = harness(); h.config.environments.development.appwrite.projectId = '6a911f1e0031e90015b2';
  try { await assert.rejects(h.run()); assert.equal(h.calls.length, 0); } finally { h.clean(); }
});
test('failed publication, verification, or config save preserves previous binding and cleans only new version', async () => {
  for (const fault of ['publishFailure', 'payloadMismatch', 'disabled', 'saveFailure']) {
    const h = harness({ rotation: true, [fault]: true }); const before = globalThis.structuredClone(h.config);
    try { await assert.rejects(h.run()); assert.deepEqual(h.config, before); assert.equal(h.calls.some((c) => c.args[2] === 'disable'), fault !== 'publishFailure'); }
    finally { h.clean(); }
  }
});
