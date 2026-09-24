import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { withAppwrite } from '../appwrite-session.mjs';
import { commandEnv, run } from '../process.mjs';

const target = { endpoint: 'https://syd.cloud.appwrite.io/v1', projectId: 'proinspect-development', projectName: 'ProInspect Development' };
const env = { LAUNCH_APPWRITE_OPERATION_KEY_ID: 'test-key', LAUNCH_APPWRITE_OPERATION_SECRET: 'unit-test-only-not-a-real-credential' };
function harness(overrides = {}) {
  const calls = []; let revoked = false;
  const execute = async (exe, args, options) => {
    calls.push({ exe, args, options });
    if (args.includes('--help')) return `Usage:\n  appwrite project ${args[1]} [flags]\nFlags:\n  --project-id string\n  --key-id string\n  --limit int\n`;
    if (args.includes('get')) return JSON.stringify({ $id: target.projectId, name: target.projectName, status: 'active', region: 'syd', ...overrides.project });
    if (args.includes('get-key')) return JSON.stringify({ $id: 'test-key', name: 'test-operation', secret: env.LAUNCH_APPWRITE_OPERATION_SECRET, scopes: ['rows.read', 'files.read'], expire: new Date(Date.now() + 3599000).toISOString(), ...overrides.key });
    if (args.includes('delete-key')) { if (overrides.revokeError) throw new Error('revocation failed'); revoked = true; return '{}'; }
    if (args.includes('list-keys')) return JSON.stringify({ total: revoked ? 0 : 1, keys: revoked ? [] : [{ $id: 'test-key' }] });
    throw new Error('Unexpected command');
  };
  return { calls, execute };
}
test('temporary imported session verifies stored credential and verifies revocation after operation failure', async () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'appwrite-session-test-')); const { calls, execute } = harness();
  try {
    await assert.rejects(withAppwrite(target, directory, ['rows.read', 'files.read'], async () => { throw new Error('operation failed'); }, execute, env), /operation failed/);
    assert(!calls.some(({ args }) => args.includes('create-key') || args.includes('create-ephemeral-key')));
    const get = calls.find(({ args }) => args.includes('get-key') && !args.includes('--help'));
    assert(get.args.includes('--show-secrets')); assert.equal(get.options.sensitive, true); assert.equal(get.options.logFile, undefined);
    const receipt = readFileSync(resolve(directory, 'temporary-key.json'), 'utf8'); assert.equal(JSON.parse(receipt).revoked, true); assert(!receipt.includes(env.LAUNCH_APPWRITE_OPERATION_SECRET));
    assert(calls.at(-1).args.includes('list-keys'));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('invalid identity, scopes, metadata or plaintext never uses or revokes an unverified operator credential', async () => {
  for (const [overrides, message] of [[{ project: { region: 'fra' } }, /identity mismatch/], [{ key: { scopes: ['rows.write'] } }, /scopes differ/], [{ key: { expire: new Date(Date.now() + 7200000).toISOString() } }, /bounded lifetime/], [{ key: { secret: '[REDACTED]' } }, /Cannot verify/], [{ key: { $id: 'different' } }, /identity metadata/]]) {
    const directory = mkdtempSync(resolve(tmpdir(), 'appwrite-session-test-')); const { calls, execute } = harness(overrides);
    try {
      await assert.rejects(withAppwrite(target, directory, ['rows.read', 'files.read'], async () => assert.fail('Operation must not execute'), execute, env), message);
      assert(!calls.some(({ args }) => args.includes('delete-key') && !args.includes('--help')));
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
});
test('failed revocation never records successful cleanup', async () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'appwrite-session-test-')); const { execute } = harness({ revokeError: true });
  try {
    await assert.rejects(withAppwrite(target, directory, ['rows.read', 'files.read'], async () => ({ ok: true }), execute, env), /revocation failed/);
    assert.equal(JSON.parse(readFileSync(resolve(directory, 'temporary-key.json'))).revoked, false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('missing credential and missing supported stored-key lookup fail closed without ephemeral fallback', async () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'appwrite-session-test-')); const { calls, execute } = harness();
  try {
    await assert.rejects(withAppwrite(target, directory, ['rows.read'], async () => assert.fail(), execute, {}), /operator-created key ID/);
    const pinned = async (exe, args, options) => args.includes('--help') ? 'Usage:\n  appwrite project [flags]\nAvailable Commands:\n  create-ephemeral-key\n' : execute(exe, args, options);
    await assert.rejects(withAppwrite(target, directory, ['rows.read'], async () => assert.fail(), pinned, env), /lacks project get-key/);
    assert(!calls.some(({ args }) => args.includes('create-ephemeral-key'))); assert(!existsSync(resolve(directory, 'temporary-key.json')));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('sensitive subprocess output is never logged and import secrets are not inherited by child processes', async () => {
  assert(!commandEnv(true, {}, env).LAUNCH_APPWRITE_OPERATION_SECRET);
  const directory = mkdtempSync(resolve(tmpdir(), 'credential-log-test-')); const logFile = resolve(directory, 'output.log');
  try { await run(process.execPath, ['-e', 'process.stdout.write("synthetic-secret-material")'], { sensitive: true, logFile }); assert(!existsSync(logFile)); }
  finally { rmSync(directory, { recursive: true, force: true }); }
});
