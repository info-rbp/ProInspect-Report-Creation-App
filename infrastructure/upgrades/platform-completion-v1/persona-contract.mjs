import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { assertDevelopmentTarget } from '../../appwrite/scripts/safety.mjs';

const personas = [
  ['dev_admin', 'proinspect_admin'],
  ['dev_inspector', 'inspector'],
  ['dev_building_manager', 'building_manager'],
  ['dev_strata_manager', 'strata_manager'],
  ['dev_resident_tenant', 'resident_tenant'],
  ['dev_client_user', 'client_user'],
  ['dev_contractor', 'contractor_worker'],
];

// Execute the actual payload with only in-memory filesystem/CLI dependencies.
// Parsing imports and import.meta keeps this independent of whitespace and
// quoting. No real environment, credentials, filesystem writes or network calls
// are available to the payload in this regression harness.
function executable(source) {
  const file = ts.createSourceFile('preparer.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(file.parseDiagnostics.length, 0, 'Persona preparer must parse');
  const transformed = ts.transform(file, [(context) => {
    const visit = (node) => {
      if (ts.isImportDeclaration(node)) return undefined;
      if (ts.isPropertyAccessExpression(node) && ts.isMetaProperty(node.expression) && node.name.text === 'url') {
        return ts.factory.createStringLiteral('file:///fixture/scripts/prepare-seven-portals-development.mjs');
      }
      return ts.visitEachChild(node, visit, context);
    };
    return (node) => ts.visitNode(node, visit);
  }]);
  try { return ts.createPrinter().printFile(transformed.transformed[0]); }
  finally { transformed.dispose(); }
}

export function auditPersonaPreparer(source, check) {
  const code = executable(source);
  const seed = JSON.parse(readFileSync(new URL('../../appwrite/seeds/development.json', import.meta.url), 'utf8'));
  const password = `${randomBytes(20).toString('hex')}"\\suffix`;

  function execute(options = {}) {
    const env = {
      APPWRITE_ENDPOINT: 'https://syd.cloud.appwrite.io/v1',
      APPWRITE_PROJECT_ID: 'proinspect-development',
      APPWRITE_PROJECT_NAME: 'ProInspect Development',
      APPWRITE_CONFIRM_TEST: 'test-development',
      APPWRITE_SEED_PASSWORD: password,
      ...options.env,
    };
    const calls = [];
    const mutations = [];
    const messages = [];
    const users = options.users ?? new Map(personas.map(([id]) => [id, { $id: id, email: `${id}@example.com`, status: true }]));
    const process = { env, execPath: '/fixture/node', exitCode: 0 };
    const success = (value) => ({ status: 0, stdout: JSON.stringify(value), stderr: '' });
    const spawnSync = (command, args, config) => {
      calls.push([command, ...args.filter((arg) => arg !== password)]);
      assert.deepEqual(Array.from(config.stdio), ['ignore', 'pipe', 'pipe'], 'CLI output must be captured');
      if (command === process.execPath) {
        assert.equal(args[0], '/fixture/scripts/materialize-development-config.mjs');
        return options.materializeFailure ? { status: 1, stderr: password } : success({});
      }
      assert.equal(command, 'appwrite', 'Only the account-authenticated CLI is permitted');
      if (args[0] === '--version') return { status: 0, stdout: `appwrite version ${options.version ?? '27.2.1'}` };
      assert.equal(args[0], '--json');
      if (args[1] === 'project' && args[2] === 'get') {
        assert.equal(args[4], 'proinspect-development');
        return success({ $id: 'proinspect-development', name: 'ProInspect Development', status: 'active', region: 'syd', ...options.live });
      }
      assert.equal(config.cwd, '/fixture/.generated', 'User operations require the materialized Development config');
      assert.equal(args[1], 'users', 'No key creation or other remote resource operation is allowed');
      const id = args[args.indexOf('--user-id') + 1];
      assert(personas.some(([userId]) => userId === id), 'Only the seven synthetic IDs may be accessed');
      if (args[2] === 'get') {
        if (options.lookupFailure) return { status: 1, stderr: options.lookupFailure };
        if (options.invalidJson) return { status: 0, stdout: `invalid ${password}` };
        return users.has(id) ? success(users.get(id)) : { status: 1, stderr: '404 user_not_found: User could not be found.' };
      }
      if (options.mutationFailure) return { status: 1, stderr: options.mutationFailure };
      if (args[2] === 'create') {
        assert(!users.has(id), 'Existing users must never be recreated');
        assert.equal(args[args.indexOf('--email') + 1], `${id}@example.com`);
        assert.equal(args[args.indexOf('--password') + 1], password);
        users.set(id, { $id: id, email: `${id}@example.com`, status: true });
      } else if (args[2] === 'update-password') {
        assert(users.has(id));
        assert.equal(args[args.indexOf('--password') + 1], password);
      } else if (args[2] === 'update-status') {
        assert.equal(args[args.indexOf('--status') + 1], 'true');
        users.get(id).status = true;
      } else {
        assert.fail(`Unexpected user command: ${args[2]}`);
      }
      mutations.push([args[2], id]);
      return success(users.get(id));
    };
    let error;
    try {
      runInNewContext(code, {
        process, spawnSync, dirname, resolve, fileURLToPath, assertDevelopmentTarget,
        readFileSync: (path) => {
          assert.equal(path, '/fixture/seeds/development.json');
          return JSON.stringify(options.seed ?? seed);
        },
        console: { log: (value) => messages.push(String(value)), error: (value) => messages.push(String(value)) },
      }, { timeout: 1000 });
    } catch (cause) { error = String(cause); }
    return { failed: Boolean(error || process.exitCode), detail: [error, ...messages].join('\n'), mutations, calls, users };
  }

  const test = (label, fn) => {
    try { fn(); check(true, `persona execution: ${label}`); }
    catch (error) { check(false, `persona execution: ${label}: ${String(error).replaceAll(password, '[REDACTED]')}`); }
  };
  const accepted = (result) => {
    assert.equal(result.failed, false, result.detail);
    assert.match(result.detail, /Prepared 7 synthetic Development personas in proinspect-development/);
    assert.match(result.detail, /authenticated Appwrite CLI session; no API key was created or used/);
    assert(!result.detail.includes(password));
    assert.deepEqual(result.mutations.filter(([command]) => command === 'update-password').map(([, id]) => id), personas.map(([id]) => id));
  };
  test('resets all seven existing personas on every rerun without creating duplicates', () => {
    const first = execute(); accepted(first);
    const second = execute({ users: first.users }); accepted(second);
    assert.equal(first.mutations.length, 7); assert.equal(second.mutations.length, 7);
  });
  test('creates missing personas and enables disabled personas before resetting passwords', () => {
    const users = new Map([['dev_admin', { $id: 'dev_admin', email: 'dev_admin@example.com', status: false }]]);
    const result = execute({ users }); accepted(result);
    assert.equal(result.mutations.filter(([command]) => command === 'create').length, 6);
    assert.deepEqual(result.mutations.slice(0, 2), [['update-status', 'dev_admin'], ['update-password', 'dev_admin']]);
    accepted(execute({ users }));
  });
  for (const [label, options] of [
    ['legacy project', { env: { APPWRITE_PROJECT_ID: '6a911f1e0031e90015b2' } }],
    ['other project', { env: { APPWRITE_PROJECT_ID: 'other-development' } }],
    ['wrong project name', { env: { APPWRITE_PROJECT_NAME: 'Other Development' } }],
    ['Markdown URL', { env: { APPWRITE_ENDPOINT: '[https://syd.cloud.appwrite.io/v1](https://syd.cloud.appwrite.io/v1)' } }],
    ['API key', { env: { APPWRITE_API_KEY: randomBytes(20).toString('hex') } }],
    ['empty API key variable', { env: { APPWRITE_API_KEY: '' } }],
    ['missing password', { env: { APPWRITE_SEED_PASSWORD: undefined } }],
    ['missing confirmation', { env: { APPWRITE_CONFIRM_TEST: undefined } }],
    ['wrong confirmation', { env: { APPWRITE_CONFIRM_TEST: 'push-development' } }],
    ['CLI version drift', { version: '28.0.0' }],
    ...Object.entries({ $id: 'other-development', name: 'Other Development', status: 'paused', region: 'nyc' }).map(([field, value]) => [`live ${field} mismatch`, { live: { [field]: value } }]),
    ['missing seed role', { seed: { identities: personas.slice(1) } }],
    ['wrong seed role', { seed: { identities: personas.map(([id]) => [id, 'inspector']) } }],
    ['existing email mismatch', { users: new Map([['dev_admin', { $id: 'dev_admin', email: 'unrelated@example.com', status: false }]]) }],
    ['lookup authentication error', { lookupFailure: '401 User unauthorized' }],
  ]) {
    test(`rejects ${label} before any user mutation`, () => {
      const result = execute(options);
      assert(result.failed, result.detail);
      assert.equal(result.mutations.length, 0);
    });
  }
  for (const [label, options] of [
    ['CLI error', { mutationFailure: `CLI failed with ${password}` }],
    ['JSON-escaped CLI error', { mutationFailure: JSON.stringify({ message: password }) }],
    ['invalid CLI JSON', { invalidJson: true }],
    ['materialization error', { materializeFailure: true }],
  ]) {
    test(`redacts ${label}`, () => {
      const result = execute(options);
      assert(result.failed);
      assert(!result.detail.includes(password), 'Raw credential appeared in error output');
      assert(!result.detail.includes(JSON.stringify(password).slice(1, -1)), 'Escaped credential appeared in error output');
    });
  }
}
