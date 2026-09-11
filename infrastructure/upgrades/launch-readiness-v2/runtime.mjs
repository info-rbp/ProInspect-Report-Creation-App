import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, lstatSync, realpathSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostname } from 'node:os';
export { run, redact, commandEnv } from './process.mjs';
export const packageRoot = dirname(fileURLToPath(import.meta.url));
export const root = resolve(packageRoot, '../../..');
export const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
export const manifest = readJson(resolve(packageRoot, 'manifest.json'));
manifest.gates = readJson(resolve(packageRoot, 'gates.json'));
export function requireThat(ok, message) { if (!ok) throw new Error(message); }
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const hash = (value) => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
export function git(args, cwd = root) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
export const stateRoot = (cwd = root) => resolve(cwd, git(['rev-parse', '--git-path', 'proinspect-launch-v2'], cwd));
export function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  renameSync(temp, path);
}
export function safePath(base, name, { mustExist = true } = {}) {
  requireThat(typeof name === 'string' && name.length > 0 && !isAbsolute(name) && !/[\\\0]/u.test(name), 'Expected relative POSIX path');
  const full = resolve(base, name); const rel = relative(base, full);
  requireThat(rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), 'Path escapes allowed directory');
  let part = resolve(base);
  requireThat(!lstatSync(part).isSymbolicLink(), 'Symlink base is prohibited');
  for (const item of rel.split(sep)) {
    part = resolve(part, item);
    try { requireThat(!lstatSync(part).isSymbolicLink(), 'Symlinks are prohibited'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (mustExist) requireThat(existsSync(full) && lstatSync(full).isFile() && realpathSync(full).startsWith(`${realpathSync(base)}${sep}`), `Missing or unsafe file: ${name}`);
  return full;
}
export function filesUnder(base, prefix = '') {
  return readdirSync(resolve(base, prefix), { withFileTypes: true }).flatMap((item) => {
    requireThat(!item.isSymbolicLink(), 'Symlinks are prohibited in package');
    const name = prefix ? `${prefix}/${item.name}` : item.name;
    return item.isDirectory() ? filesUnder(base, name) : [name];
  }).sort();
}
export function verifyIntegrity(base = packageRoot) {
  const index = readJson(resolve(base, 'integrity.json'));
  requireThat(index.algorithm === 'sha256' && Object.keys(index.files).length >= 8, 'Invalid integrity index');
  const actual = filesUnder(base).filter((p) => p !== 'integrity.json');
  requireThat(canonical(actual) === canonical(Object.keys(index.files).sort()), 'Integrity index does not cover exact package contents');
  for (const [path, expected] of Object.entries(index.files)) requireThat(hash(readFileSync(safePath(base, path))) === expected, `Integrity mismatch: ${path}`);
  return index;
}
export function assertRepository(cwd = root) {
  requireThat(git(['rev-parse', '--show-toplevel'], cwd) === realpathSync(cwd), 'Not the repository root');
  requireThat(/github\.com[:/]info-rbp\/ProInspect-Report-Creation-App(?:\.git)?$/u.test(git(['remote', 'get-url', 'origin'], cwd)), 'Unexpected repository origin');
  requireThat(git(['merge-base', manifest.baselineCommit, 'HEAD'], cwd) === manifest.baselineCommit, 'Required source baseline is absent');
}
export function assertClean(cwd = root) { requireThat(!git(['status', '--porcelain', '--untracked-files=normal'], cwd), 'Commit or move your changes first. No reset or discard is performed.'); }
export function candidateConfiguration(config, environment) {
  requireThat(config?.environments?.[environment], 'Candidate environment is missing');
  const { environments, ...shared } = config;
  return { ...shared, environments: { [environment]: environments[environment] } };
}
export function appwriteSchemaFingerprint(cwd = root) {
  const paths = ['infrastructure/appwrite/appwrite.config.json','infrastructure/appwrite/databases','infrastructure/appwrite/tables','infrastructure/appwrite/buckets','infrastructure/appwrite/teams','infrastructure/appwrite/platforms','infrastructure/appwrite/functions'];
  const tree = git(['ls-tree','-r','HEAD','--',...paths],cwd);
  requireThat(tree.includes('infrastructure/appwrite/tables/'), 'Appwrite schema sources are missing');
  return hash(tree);
}
export function candidate(config, environment) {
  assertClean();
  return { commit: git(['rev-parse', 'HEAD']), tree: git(['rev-parse', 'HEAD^{tree}']), manifestHash: hash(manifest), schemaHash: appwriteSchemaFingerprint(), configHash: hash(candidateConfiguration(config,environment)), environment };
}
export function sameSourceCandidate(left,right) {
  return ['commit','tree','manifestHash','schemaHash'].every((key) => left?.[key] && left[key] === right?.[key]);
}
export function acquireLock(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 }); const lock = resolve(directory, 'lock');
  try { mkdirSync(lock, { mode: 0o700 }); } catch { throw new Error('Another operation or stale lock exists; inspect before unlocking'); }
  atomicJson(resolve(lock, 'owner.json'), { pid: process.pid, host: hostname(), startedAt: new Date().toISOString() });
  return () => rmSync(lock, { recursive: true });
}
export function unlock(directory, confirmation) {
  const lock = resolve(directory, 'lock'); const owner = readJson(resolve(lock, 'owner.json'));
  requireThat(owner.host === hostname() && confirmation === `UNLOCK:${owner.pid}`, 'Lock host or confirmation mismatch');
  let dead = false;
  try { process.kill(owner.pid, 0); } catch (error) { dead = error.code === 'ESRCH'; }
  requireThat(dead, 'Lock owner is live or cannot be verified'); rmSync(lock, { recursive: true });
}
export function parseArgs(argv) {
  const result = { command: argv[0] ?? 'plan', env: 'development' }; const seen = new Set();
  for (let i = 1; i < argv.length; i++) {
    const key = argv[i].slice(2);
    requireThat(argv[i].startsWith('--') && !seen.has(key), 'Invalid or duplicate option'); seen.add(key);
    if (['apply', 'live', 'resume', 'execute'].includes(key)) result[key] = true;
    else { requireThat(['env', 'stage', 'confirm'].includes(key) && argv[i + 1] && !argv[i + 1].startsWith('--'), 'Unknown or missing option'); result[key] = argv[++i]; }
  }
  requireThat(['development', 'staging'].includes(result.env), 'Production is locked; only Development and Staging are allowed');
  return result;
}
export { validateConfig } from './configuration.mjs';
