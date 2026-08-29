import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertDevelopmentTarget } from './safety.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = process.env.APPWRITE_CLI_BIN || 'appwrite';
const requested = assertDevelopmentTarget({
  projectId: process.env.APPWRITE_PROJECT_ID,
  projectName: process.env.APPWRITE_PROJECT_NAME,
  endpoint: process.env.APPWRITE_ENDPOINT,
}, process.env.APPWRITE_CONFIRM_PUSH);

function run(args, cwd = root) {
  const result = spawnSync(cli, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || `Appwrite CLI failed: ${args.join(' ')}`);
  return result.stdout;
}

const versionOutput = run(['--version']).trim();
const version = versionOutput.match(/\d+\.\d+\.\d+/)?.[0];
if (version !== '27.2.1') throw new Error(`Appwrite CLI 27.2.1 is required; found ${versionOutput}. Set APPWRITE_CLI_BIN to the pinned binary.`);
const organizationId = process.env.APPWRITE_ORGANIZATION_ID?.trim();
if (!organizationId) throw new Error('APPWRITE_ORGANIZATION_ID is required to verify the console project before pushing.');
const live = JSON.parse(run([
  '--json',
  'organization',
  'get-project',
  '--organization-id',
  organizationId,
  '--project-id',
  requested.projectId,
]));
if (live.$id !== requested.projectId || live.name !== requested.projectName || !/\bdevelopment\b/i.test(live.name) || live.status !== 'active') {
  throw new Error('Live project identity does not exactly match the confirmed active Development target.');
}
const materialize = spawnSync(process.execPath, [resolve(root, 'scripts/materialize-development-config.mjs')], { cwd: root, env: process.env, encoding: 'utf8' });
if (materialize.status !== 0) throw new Error(materialize.stderr || materialize.stdout);
const generated = resolve(root, '.generated');
run(['--force', 'push', 'settings'], generated);
for (const resource of ['team', 'table', 'bucket']) run(['--force', 'push', resource, '--all'], generated);
console.log(`Pushed Appwrite foundation to confirmed Development project ${requested.projectId}.`);
