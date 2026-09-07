import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { assertDevelopmentTarget } from '../../appwrite/scripts/safety.mjs';
import { buildPortalFixturePlan, portalFixtureChange } from './payload/development-portal-fixtures.mjs';

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

export async function auditPersonaPreparer(source, check) {
  const code = executable(source);
  const seed = JSON.parse(readFileSync(new URL('../../appwrite/seeds/development.json', import.meta.url), 'utf8'));
  const password = `${randomBytes(20).toString('hex')}"\\suffix`;

  async function execute(options = {}) {
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
    const passwordAttempts = [];
    const sessions = new Map();
    const logins = [];
    const rowMutations = [];
    const rows = options.rows ?? new Map();
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
      assert(['--json', '--raw'].includes(args[0]));
      if (args[1] === 'project' && args[2] === 'get') {
        assert.equal(args[4], 'proinspect-development');
        return success({ $id: 'proinspect-development', name: 'ProInspect Development', status: 'active', region: 'syd', ...options.live });
      }
      assert.equal(config.cwd, '/fixture/.generated', 'User operations require the materialized Development config');
      if (args[1] === 'tablesdb') {
        assert.equal(args[args.indexOf('--database-id') + 1], 'proinspect_core');
        const tableId = args[args.indexOf('--table-id') + 1];
        const rowId = args[args.indexOf('--row-id') + 1];
        const key = `${tableId}/${rowId}`;
        const expected = buildPortalFixturePlan(seed, personas).find((item) => item.tableId === tableId && item.rowId === rowId);
        assert(expected, 'Only source-controlled synthetic fixtures may be accessed');
        if (args[2] === 'get-row') {
          assert.equal(args[0], '--raw', 'Fixture reads must preserve permissions and nulls');
          if (options.rowLookupFailure) return { status: 1, stderr: options.rowLookupFailure };
          return rows.has(key) ? success(rows.get(key)) : { status: 1, stderr: '404 row_not_found' };
        }
        assert(['create-row', 'update-row'].includes(args[2]), 'Fixture deletion and arbitrary row operations are forbidden');
        assert.equal(rows.has(key), args[2] === 'update-row');
        const data = JSON.parse(args[args.indexOf('--data') + 1]);
        const permissions = Array.from(args).flatMap((arg, index) => arg === '--permissions' ? [args[index + 1]] : []);
        assert.deepEqual(permissions, expected.permissions);
        rows.set(key, { $id: rowId, ...data, $permissions: permissions });
        rowMutations.push([args[2], key]);
        return success(rows.get(key));
      }
      assert.equal(args[1], 'users', 'No key creation or other remote resource operation is allowed');
      const id = args[args.indexOf('--user-id') + 1];
      assert(personas.some(([userId]) => userId === id), 'Only the seven synthetic IDs may be accessed');
      if (args[2] === 'get') {
        if (options.lookupFailure) return { status: 1, stderr: options.lookupFailure };
        if (options.invalidJson) return { status: 0, stdout: `invalid ${password}` };
        return users.has(id) ? success(users.get(id)) : { status: 1, stderr: '404 user_not_found: User could not be found.' };
      }
      if (args[2] === 'update-password') passwordAttempts.push(id);
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
    const fetch = async (url, init) => {
      assert.equal(init.headers['x-appwrite-project'], 'proinspect-development');
      assert.equal(init.redirect, 'error', 'Credential verification must not follow redirects');
      if (init.method === 'POST') {
        assert.equal(url, 'https://syd.cloud.appwrite.io/v1/account/sessions/email');
        const body = JSON.parse(init.body);
        assert.equal(body.password, password);
        const userId = body.email.replace('@example.com', '');
        assert(users.has(userId));
        if (!options.passwordCurrent) return { ok: false, status: 401 };
        const secret = randomBytes(24).toString('hex');
        sessions.set(secret, userId); logins.push(userId);
        return {
          ok: true, status: 201,
          json: async () => {
            if (options.invalidSessionJson) throw new Error(password);
            return { userId: options.wrongSessionUser ? 'different_user' : userId, secret: options.fallbackCookie ? undefined : secret };
          },
          headers: { get: () => options.fallbackCookie ? JSON.stringify({ 'a_session_proinspect-development': secret }) : null },
        };
      }
      assert.equal(url, 'https://syd.cloud.appwrite.io/v1/account/sessions/current');
      assert.equal(init.method, 'DELETE');
      const secret = init.headers['x-appwrite-session'];
      assert(sessions.has(secret), 'Logout must close the session just created');
      if (options.logoutFailure) return { ok: false, status: 500 };
      sessions.delete(secret);
      return { ok: true, status: 204 };
    };
    let error;
    try {
      await runInNewContext(`(async () => {\n${code}\n})()`, {
        process, spawnSync, fetch, dirname, resolve, fileURLToPath, assertDevelopmentTarget, buildPortalFixturePlan, portalFixtureChange,
        readFileSync: (path) => {
          assert.equal(path, '/fixture/seeds/development.json');
          return JSON.stringify(options.seed ?? seed);
        },
        console: { log: (value) => messages.push(String(value)), error: (value) => messages.push(String(value)) },
      }, { timeout: 1000 });
    } catch (cause) { error = String(cause); }
    return { failed: Boolean(error || process.exitCode), detail: [error, ...messages].join('\n'), mutations, passwordAttempts, sessions, logins, rowMutations, rows, calls, users };
  }

  const test = async (label, fn) => {
    try { await fn(); check(true, `persona execution: ${label}`); }
    catch (error) { check(false, `persona execution: ${label}: ${String(error).replaceAll(password, '[REDACTED]')}`); }
  };
  const accepted = (result) => {
    assert.equal(result.failed, false, result.detail);
    assert.match(result.detail, /Prepared 7 synthetic Development personas in proinspect-development/);
    assert.match(result.detail, /authenticated Appwrite CLI session; no API key was created or used/);
    assert(!result.detail.includes(password));
    assert.deepEqual(result.passwordAttempts, personas.map(([id]) => id));
  };
  await test('resets all seven existing personas on every rerun without creating duplicates', async () => {
    const first = await execute(); accepted(first);
    const second = await execute({ users: first.users, rows: first.rows }); accepted(second);
    assert.equal(first.mutations.length, 7); assert.equal(second.mutations.length, 7);
    assert.equal(second.rowMutations.length, 0, 'Fixture reconciliation must be a no-op on rerun');
  });
  for (const fallbackCookie of [false, true]) {
    await test(`accepts password-history rejection only after verified login and logout (cookie=${fallbackCookie})`, async () => {
      const result = await execute({ mutationFailure: 'Password resembles a previous password', passwordCurrent: true, fallbackCookie });
      accepted(result);
      assert.deepEqual(result.logins, personas.map(([id]) => id));
      assert.equal(result.sessions.size, 0);
      assert.equal(result.mutations.length, 0);
    });
  }
  for (const [label, options] of [
    ['password does not authenticate', { passwordCurrent: false }],
    ['authenticated identity differs', { passwordCurrent: true, wrongSessionUser: true }],
    ['session cleanup fails', { passwordCurrent: true, logoutFailure: true }],
    ['invalid authentication response', { passwordCurrent: true, invalidSessionJson: true }],
  ]) {
    await test(`rejects reset failure when ${label}`, async () => {
      const result = await execute({ mutationFailure: 'Password resembles a previous password', ...options });
      assert(result.failed);
      assert.equal(result.rowMutations.length, 0);
      assert(!result.detail.includes(password));
    });
  }
  await test('restores missing entitlements and representative fixtures with scoped read permissions', async () => {
    const result = await execute(); accepted(result);
    assert.equal(result.rows.size, 51);
    for (const [id] of personas) {
      const entitlement = [...result.rows.entries()].find(([key, row]) => key.startsWith('portal_entitlements/') && row.userId === id)?.[1];
      assert(entitlement, `Missing portal entitlement for ${id}`);
      assert.deepEqual(entitlement.$permissions, [`read("user:${id}")`]);
    }
    for (const key of ['clients/dev_client', 'units/dev_unit_1', 'occupancies/dev_occupancy_tenant', 'occupancies/dev_occupancy_owner', 'contractors/dev_contractor_profile', 'property_client_relationships/dev_property_client']) assert(result.rows.has(key), `Missing ${key}`);
    const incident = result.rows.get('incidents/dev_incident');
    assert.deepEqual(incident.$permissions, ['read("user:dev_admin")', 'read("user:dev_building_manager")', 'read("user:dev_strata_manager")']);
    const commercial = result.rows.get('managed_sites/dev_site_commercial');
    assert.deepEqual(commercial.$permissions, ['read("user:dev_admin")']);
  });
  await test('repairs synthetic fixture permission drift without changing creation time', async () => {
    const first = await execute(); accepted(first);
    const row = first.rows.get('portal_entitlements/dev_admin_portal');
    const createdAt = row.createdAt;
    row.$permissions = [];
    const next = await execute({ rows: first.rows }); accepted(next);
    assert.deepEqual(next.rowMutations, [['update-row', 'portal_entitlements/dev_admin_portal']]);
    assert.equal(next.rows.get('portal_entitlements/dev_admin_portal').createdAt, createdAt);
  });
  await test('migrates only the documented legacy synthetic contractor reference', async () => {
    const first = await execute(); accepted(first);
    const order = first.rows.get('maintenance_work_orders/dev_work_order');
    order.contractorId = 'dev_contractor';
    const migrated = await execute({ rows: first.rows }); accepted(migrated);
    assert.deepEqual(migrated.rowMutations, [['update-row', 'maintenance_work_orders/dev_work_order']]);
    assert.equal(order.agencyId, 'dev_agency');
    assert.equal(migrated.rows.get('maintenance_work_orders/dev_work_order').contractorId, 'dev_contractor_profile');
    migrated.rows.get('maintenance_work_orders/dev_work_order').contractorId = 'unrelated_contractor';
    const rejected = await execute({ rows: migrated.rows });
    assert(rejected.failed); assert.equal(rejected.rowMutations.length, 0);
  });
  await test('treats Appwrite-normalized timestamps as unchanged on rerun', async () => {
    const first = await execute(); accepted(first);
    const job = first.rows.get('inspection_jobs/dev_inspection_job');
    job.scheduledDate = job.scheduledDate.replace('Z', '+00:00');
    const next = await execute({ rows: first.rows }); accepted(next);
    assert.equal(next.rowMutations.length, 0);
  });
  for (const [label, override] of [['agency scope', { agencyId: 'other_agency' }], ['user identity', { userId: 'dev_inspector' }]]) {
    await test(`rejects conflicting fixture ${label} before any fixture writes`, async () => {
      const row = { $id: 'dev_admin_portal', agencyId: 'dev_agency', userId: 'dev_admin', ...override };
      const result = await execute({ rows: new Map([['portal_entitlements/dev_admin_portal', row]]) });
      assert(result.failed);
      assert.equal(result.rowMutations.length, 0);
    });
  }
  await test('rejects a fixture lookup permission error without creating rows', async () => {
    const result = await execute({ rowLookupFailure: '401 unauthorized' });
    assert(result.failed); assert.equal(result.rowMutations.length, 0);
  });
  await test('creates missing personas and enables disabled personas before resetting passwords', async () => {
    const users = new Map([['dev_admin', { $id: 'dev_admin', email: 'dev_admin@example.com', status: false }]]);
    const result = await execute({ users }); accepted(result);
    assert.equal(result.mutations.filter(([command]) => command === 'create').length, 6);
    assert.deepEqual(result.mutations.slice(0, 2), [['update-status', 'dev_admin'], ['update-password', 'dev_admin']]);
    accepted(await execute({ users }));
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
    await test(`rejects ${label} before any user mutation`, async () => {
      const result = await execute(options);
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
    await test(`redacts ${label}`, async () => {
      const result = await execute(options);
      assert(result.failed);
      assert(!result.detail.includes(password), 'Raw credential appeared in error output');
      assert(!result.detail.includes(JSON.stringify(password).slice(1, -1)), 'Escaped credential appeared in error output');
    });
  }
}
