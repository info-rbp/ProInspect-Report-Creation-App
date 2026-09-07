import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertDevelopmentTarget } from '../scripts/safety.mjs';
import { buildPortalFixturePlan, portalFixtureChange } from './development-portal-fixtures.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const generated = resolve(root, '.generated');
const cli = process.env.APPWRITE_CLI_BIN || 'appwrite';
const target = assertDevelopmentTarget({
  projectId: process.env.APPWRITE_PROJECT_ID,
  projectName: process.env.APPWRITE_PROJECT_NAME,
  endpoint: process.env.APPWRITE_ENDPOINT,
}, process.env.APPWRITE_CONFIRM_TEST);
if (target.projectName !== 'ProInspect Development') throw new Error('APPWRITE_PROJECT_NAME must be ProInspect Development.');
if (process.env.APPWRITE_CONFIRM_TEST !== 'test-development') throw new Error('APPWRITE_CONFIRM_TEST must be test-development.');

if (process.env.APPWRITE_API_KEY !== undefined) {
  throw new Error('APPWRITE_API_KEY must be unset. Persona preparation uses the authenticated Appwrite CLI session only.');
}

const password = process.env.APPWRITE_SEED_PASSWORD;
if (!password?.trim()) throw new Error('APPWRITE_SEED_PASSWORD is required.');
if (password.length < 8) throw new Error('APPWRITE_SEED_PASSWORD must be at least 8 characters.');

const personas = [
  ['dev_admin', 'proinspect_admin'],
  ['dev_inspector', 'inspector'],
  ['dev_building_manager', 'building_manager'],
  ['dev_strata_manager', 'strata_manager'],
  ['dev_resident_tenant', 'resident_tenant'],
  ['dev_client_user', 'client_user'],
  ['dev_contractor', 'contractor_worker'],
];

const createUserCommand = ['--json', 'users', 'create'];
const updatePasswordCommand = ['--json', 'users', 'update-password'];

const seed = JSON.parse(readFileSync(resolve(root, 'seeds/development.json'), 'utf8'));
const seedRoles = new Map(seed.identities ?? []);
for (const [userId, role] of personas) {
  if (seedRoles.get(userId) !== role) {
    throw new Error(`Development seed does not contain expected persona ${userId} with role ${role}.`);
  }
}
const fixtures = buildPortalFixturePlan(seed, personas);

function redact(value) {
  return String(value ?? '')
    .replaceAll(JSON.stringify(password).slice(1, -1), '[REDACTED]')
    .replaceAll(password, '[REDACTED]').trim();
}

function parseCliJson(value) {
  try { return JSON.parse(value); }
  catch { throw new Error('Appwrite CLI returned invalid JSON; response content suppressed.'); }
}

async function passwordAlreadyMatches(userId, email) {
  const response = await fetch(`${target.endpoint}/account/sessions/email`, {
    method: 'POST',
    redirect: 'error',
    headers: { 'content-type': 'application/json', 'x-appwrite-project': target.projectId },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) return false;
  const session = await response.json().catch(() => { throw new Error('Password verification returned invalid JSON; response content suppressed.'); });
  const fallback = response.headers.get('x-fallback-cookies');
  const secret = session.secret || (fallback ? parseCliJson(fallback)[`a_session_${target.projectId}`] : undefined);
  if (!secret) throw new Error('Password verification returned no usable session.');
  const logout = await fetch(`${target.endpoint}/account/sessions/current`, {
    method: 'DELETE',
    redirect: 'error',
    headers: { 'x-appwrite-project': target.projectId, 'x-appwrite-session': secret },
  });
  if (!logout.ok) throw new Error('Could not close the password verification session.');
  return session.userId === userId;
}

function run(args, cwd = generated, { allowFailure = false } = {}) {
  const result = spawnSync(cli, args, {
    cwd,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0 && !allowFailure) {
    const detail = redact(result.stderr || result.stdout || 'Appwrite CLI command failed.');
    throw new Error(detail || 'Appwrite CLI command failed.');
  }
  return result;
}

const version = redact(run(['--version'], root).stdout).match(/\d+\.\d+\.\d+/)?.[0];
if (version !== '27.2.1') {
  throw new Error(`Appwrite CLI 27.2.1 is required; found ${version ?? 'unknown'}.`);
}

const live = parseCliJson(run([
  '--json',
  'project',
  'get',
  '--project-id',
  target.projectId,
], root).stdout);
if (
  live.$id !== target.projectId
  || live.name !== target.projectName
  || live.status !== 'active'
  || live.region !== 'syd'
) {
  throw new Error('Live project identity does not exactly match the confirmed active Development target.');
}

const materialize = spawnSync(process.execPath, [resolve(root, 'scripts/materialize-development-config.mjs')], {
  cwd: root,
  env: { ...process.env, APPWRITE_CONFIRM_PUSH: 'push-development' },
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});
if (materialize.status !== 0) {
  throw new Error(redact(materialize.stderr || materialize.stdout || 'Failed to materialize Development Appwrite configuration.'));
}

for (const [userId, role] of personas) {
  const email = `${userId}@example.com`;
  const existing = run(['--json', 'users', 'get', '--user-id', userId], generated, { allowFailure: true });

  if (existing.status === 0) {
    const user = parseCliJson(existing.stdout);
    if (user.$id !== userId || user.email !== email) {
      throw new Error(`Synthetic Development persona ${userId} has an unexpected identity; refusing to repurpose it.`);
    }
    if (user.status === false) {
      run(['--json', 'users', 'update-status', '--user-id', userId, '--status', 'true']);
    }
  } else {
    const detail = redact(`${existing.stderr}\n${existing.stdout}`);
    if (!/(404|not found|could not be found)/iu.test(detail)) {
      throw new Error(`Could not inspect synthetic Development persona ${userId}: ${detail || 'unknown Appwrite CLI error'}`);
    }
    run([
      ...createUserCommand,
      '--user-id', userId,
      '--email', email,
      '--password', password,
      '--name', `DEV TEST - ${role}`,
    ]);
  }

  const reset = run([
    ...updatePasswordCommand,
    '--user-id', userId,
    '--password', password,
  ], generated, { allowFailure: true });
  // Password history may reject an already-current password. Only a successful
  // login for this exact user (followed by logout) can establish the no-op case.
  if (reset.status !== 0 && !await passwordAlreadyMatches(userId, email)) {
    throw new Error(redact(reset.stderr || reset.stdout || 'Could not prepare the Development persona password.'));
  }
}

// Inspect every planned row before writing any fixture. The raw CLI response
// preserves permissions, nested values and nulls for exact comparison.
const changes = [];
for (const fixture of fixtures) {
  const identity = ['--database-id', 'proinspect_core', '--table-id', fixture.tableId, '--row-id', fixture.rowId];
  const result = run(['--raw', 'tablesdb', 'get-row', ...identity], generated, { allowFailure: true });
  let existing;
  if (result.status === 0) existing = parseCliJson(result.stdout);
  else if (!/(404|not found|could not be found)/iu.test(redact(`${result.stderr}\n${result.stdout}`))) {
    throw new Error(`Could not inspect synthetic fixture ${fixture.tableId}/${fixture.rowId}; refusing fixture writes.`);
  }
  const change = portalFixtureChange(fixture, existing, new Date().toISOString());
  if (change) changes.push({ identity, existing: Boolean(existing), ...change });
}
for (const change of changes) {
  run(['--json', 'tablesdb', change.existing ? 'update-row' : 'create-row', ...change.identity,
    '--data', JSON.stringify(change.data), ...change.permissions.flatMap((permission) => ['--permissions', permission])]);
}
console.log(`Reconciled ${fixtures.length} synthetic Development portal fixtures (${changes.length} changed); no unrelated rows were modified.`);
console.log(`Prepared ${personas.length} synthetic Development personas in ${target.projectId} using the authenticated Appwrite CLI session; no API key was created or used.`);
