import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const packageRoot = resolve(root, 'infrastructure/upgrades/platform-completion-v1');
export const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'manifest.json'), 'utf8'));

export function run(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  });
  if (result.status !== 0) {
    const detail = options.capture ? `${result.stdout || ''}${result.stderr || ''}`.trim() : '';
    throw new Error(`${command} ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
  return options.capture ? String(result.stdout || '').trim() : '';
}

export function output(command, args = [], options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd || root,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
  }).trim();
}

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function read(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

export function has(path, needle) {
  return read(path).includes(needle);
}

export function assertHas(path, needle, message = `${path} is missing ${needle}`) {
  assert(has(path, needle), message);
}

export function assertNotHas(path, needle, message = `${path} still contains ${needle}`) {
  assert(!has(path, needle), message);
}

export function statePath() {
  const gitDir = output('git', ['rev-parse', '--git-dir']);
  return resolve(root, gitDir, 'proinspect-platform-completion-v1.json');
}

export function readState() {
  const path = statePath();
  if (!existsSync(path)) return { completed: [], failed: [] };
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function writeState(state) {
  const path = statePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
}

export function markStage(id, status, detail = '') {
  const state = readState();
  state.completed = Array.from(new Set(state.completed || []));
  state.failed = Array.from(new Set(state.failed || []));
  if (status === 'complete') {
    state.completed = Array.from(new Set([...state.completed, id]));
    state.failed = state.failed.filter((value) => value !== id);
  } else if (status === 'failed') {
    state.failed = Array.from(new Set([...state.failed, id]));
  }
  state.lastStage = id;
  state.lastStatus = status;
  state.lastDetail = detail;
  state.updatedAt = new Date().toISOString();
  writeState(state);
}

export function toolchain() {
  const node = process.version.replace(/^v/u, '');
  const npm = output('npm', ['--version']);
  const appwriteOutput = output('appwrite', ['--version']);
  const appwrite = appwriteOutput.match(/(\d+\.\d+\.\d+)/u)?.[1] || appwriteOutput;
  return { node, npm, appwrite };
}

export function verifyToolchain() {
  const current = toolchain();
  assert(current.node === manifest.requiredToolchain.node, `Node ${manifest.requiredToolchain.node} is required; found ${current.node}.`);
  assert(current.npm === manifest.requiredToolchain.npm, `npm ${manifest.requiredToolchain.npm} is required; found ${current.npm}.`);
  assert(current.appwrite === manifest.requiredToolchain.appwriteCli, `Appwrite CLI ${manifest.requiredToolchain.appwriteCli} is required; found ${current.appwrite}.`);
  return current;
}

export function verifyDevelopmentEnvironment() {
  const expected = manifest.development;
  const endpoint = process.env.APPWRITE_ENDPOINT?.trim();
  const projectId = process.env.APPWRITE_PROJECT_ID?.trim();
  const projectName = process.env.APPWRITE_PROJECT_NAME?.trim();
  const confirmPush = process.env.APPWRITE_CONFIRM_PUSH?.trim();
  const confirmVerify = process.env.APPWRITE_CONFIRM_VERIFY?.trim();
  assert(endpoint === expected.endpoint, `APPWRITE_ENDPOINT must be ${expected.endpoint}; found ${endpoint || '<unset>'}.`);
  assert(projectId === expected.projectId, `APPWRITE_PROJECT_ID must be ${expected.projectId}; found ${projectId || '<unset>'}.`);
  assert(projectName === expected.projectName, `APPWRITE_PROJECT_NAME must be ${expected.projectName}; found ${projectName || '<unset>'}.`);
  assert(confirmPush === 'push-development', `APPWRITE_CONFIRM_PUSH must be push-development; found ${confirmPush || '<unset>'}.`);
  assert(confirmVerify === 'verify-development', `APPWRITE_CONFIRM_VERIFY must be verify-development; found ${confirmVerify || '<unset>'}.`);
  assert(!expected.prohibitedProjectIds.includes(projectId), `Prohibited Appwrite project selected: ${projectId}.`);
  assert(!/[\[\]()]/u.test(endpoint), 'APPWRITE_ENDPOINT contains Markdown/link syntax; use the plain HTTPS URL.');
}

export function verifyCleanTree({ allowUpgradeFiles = false } = {}) {
  const status = output('git', ['status', '--porcelain']);
  if (!status) return;
  if (allowUpgradeFiles) {
    const lines = status.split('\n').filter(Boolean);
    const foreign = lines.filter((line) => !line.slice(3).startsWith('infrastructure/upgrades/platform-completion-v1/'));
    assert(foreign.length === 0, `Working tree contains non-upgrade changes:\n${foreign.join('\n')}`);
    return;
  }
  assert(false, `Working tree must be clean before Development installation:\n${status}`);
}

export function stageById(id) {
  return manifest.stages.find((stage) => stage.id === id);
}

export function printStageTable() {
  const state = readState();
  for (const stage of manifest.stages) {
    const status = state.completed?.includes(stage.id) ? 'COMPLETE' : state.failed?.includes(stage.id) ? 'FAILED' : 'READY';
    console.log(`${stage.id.padEnd(4)} ${status.padEnd(9)} ${stage.name}`);
  }
}
