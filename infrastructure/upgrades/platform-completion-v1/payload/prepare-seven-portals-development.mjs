import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertDevelopmentTarget } from '../scripts/safety.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const generated = resolve(root, '.generated');
const cli = process.env.APPWRITE_CLI_BIN || 'appwrite';
const target = assertDevelopmentTarget({
  projectId: process.env.APPWRITE_PROJECT_ID,
  projectName: process.env.APPWRITE_PROJECT_NAME,
  endpoint: process.env.APPWRITE_ENDPOINT,
}, process.env.APPWRITE_CONFIRM_TEST);

if (process.env.APPWRITE_API_KEY?.trim()) {
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

function redact(value) {
  return String(value ?? '').replaceAll(password, '[REDACTED]').trim();
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

const live = JSON.parse(run([
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
    const user = JSON.parse(existing.stdout);
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

  run([
    ...updatePasswordCommand,
    '--user-id', userId,
    '--password', password,
  ]);
}

console.log(`Prepared ${personas.length} synthetic Development personas in ${target.projectId} using the authenticated Appwrite CLI session; no API key was created or used.`);
