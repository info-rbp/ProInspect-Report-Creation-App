import { Buffer } from 'node:buffer';
import { setTimeout, clearTimeout } from 'node:timers';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostname } from 'node:os';

export const packageRoot = dirname(fileURLToPath(import.meta.url));
export const root = resolve(packageRoot, '../../..');
export const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
export const manifest = readJson(resolve(packageRoot, 'manifest.json'));
export function requireThat(ok, message) { if (!ok) throw new Error(message); }
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const hash = (value) => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
export function git(args, cwd = root) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
export function stateRoot(cwd = root) { return resolve(cwd, git(['rev-parse', '--git-path', 'proinspect-launch-v2'], cwd)); }
export function atomicJson(file, value) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  renameSync(temp, file);
}
export function safePath(base, name, { mustExist = true } = {}) {
  requireThat(typeof name === 'string' && name.length > 0 && !isAbsolute(name) && !name.includes('\\') && !name.includes('\0'), 'A relative POSIX path is required.');
  const full = resolve(base, name);
  const rel = relative(base, full);
  requireThat(rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), 'Path escapes its allowed directory.');
  let cursor = base;
  for (const part of rel.split(sep)) {
    cursor = resolve(cursor, part);
    if (existsSync(cursor)) requireThat(!lstatSync(cursor).isSymbolicLink(), 'Symbolic links are not allowed in evidence or executable paths.');
  }
  if (mustExist) {
    requireThat(existsSync(full) && lstatSync(full).isFile(), `Required file is missing: ${name}`);
    requireThat(realpathSync(full).startsWith(`${realpathSync(base)}${sep}`), 'Resolved path escapes its directory.');
  }
  return full;
}
export function redact(text, env = process.env) {
  let clean = String(text ?? '');
  for (const [name, value] of Object.entries(env)) {
    if (/(password|secret|token|api.?key|credential)/iu.test(name) && typeof value === 'string' && value.length >= 6) clean = clean.split(value).join('[REDACTED]');
  }
  return clean.replace(/Bearer\s+[^\s"']+/giu, 'Bearer [REDACTED]')
    .replace(/shp(?:at|ca|pa|ss)_[a-zA-Z0-9]+/gu, '[REDACTED]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gu, '[REDACTED]')
    .replace(/([?&](?:token|key|secret|signature)=)[^&\s]+/giu, '$1[REDACTED]');
}
export function commandEnv(live = false, extra = {}, inherited = process.env) {
  const result = { ...inherited };
  if (!live) for (const key of Object.keys(result)) if (/(password|secret|token|api.?key|credential)/iu.test(key)) delete result[key];
  return { ...result, ...extra, NO_COLOR: '1', CI: '1' };
}
export async function run(command, args = [], { cwd = root, live = false, env = {}, logFile, timeoutMs = 1_800_000, input, quiet = false } = {}) {
  requireThat(typeof command === 'string' && Array.isArray(args) && args.every((a) => typeof a === 'string'), 'Command arguments must be an array of strings.');
  requireThat(process.platform !== 'win32', 'Use the VS Code WSL terminal on Windows; native Windows process execution is not certified by this package.');
  if (!quiet) console.log(`RUN ${command} ${args.map((v) => redact(v)).join(' ')}`);
  const childEnv = commandEnv(live, env);
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env: childEnv, shell: false, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; let bytes = 0; let stopped; let killTimer;
    const stop = (reason) => {
      if (stopped) return;
      stopped = reason;
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Process may have exited. */ }
      killTimer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already stopped. */ } }, 2000);
      killTimer.unref();
    };
    const capture = (chunk) => {
      bytes += chunk.length;
      if (bytes > 16 * 1024 * 1024) return stop('Command output exceeded the 16 MiB limit.');
      output += chunk.toString('utf8');
    };
    child.stdout.on('data', capture); child.stderr.on('data', capture);
    child.stdin.on('error', () => {});
    child.stdin.end(input ?? '');
    const timer = setTimeout(() => stop('Command timeout.'), timeoutMs);
    const interrupt = () => stop('Command interrupted; inspect the target before retrying.');
    process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
    const cleanup = () => { clearTimeout(timer); process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); };
    child.once('error', (error) => { cleanup(); reject(new Error(redact(`${command}: ${error.message}`, childEnv))); });
    child.once('close', (code) => {
      cleanup();
      if (!stopped) clearTimeout(killTimer);
      const safeOutput = redact(output, childEnv);
      if (logFile) { mkdirSync(dirname(logFile), { recursive: true, mode: 0o700 }); writeFileSync(logFile, safeOutput, { mode: 0o600 }); }
      if (stopped || code !== 0) reject(new Error(`${command} failed: ${stopped || `exit ${code}`}. ${safeOutput.slice(-4000)}`));
      else resolvePromise(output.trim());
    });
  });
}
export function acquireLock(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lock = resolve(directory, 'lock');
  try { mkdirSync(lock, { mode: 0o700 }); }
  catch { throw new Error(`Another launch operation owns ${lock}. Do not delete a live lock. Use the documented stale-lock procedure.`); }
  atomicJson(resolve(lock, 'owner.json'), { pid: process.pid, host: hostname(), startedAt: new Date().toISOString() });
  return () => rmSync(lock, { recursive: true, force: true });
}
export function unlock(directory, confirm) {
  const lock = resolve(directory, 'lock');
  const owner = readJson(resolve(lock, 'owner.json'));
  requireThat(owner.host === hostname(), 'A lock from another host requires manual investigation.');
  requireThat(confirm === `UNLOCK:${owner.pid}`, `Expected --confirm UNLOCK:${owner.pid}`);
  let alive = true;
  try { process.kill(owner.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
  requireThat(!alive, 'Lock owner is still running or its status is unknown.');
  rmSync(lock, { recursive: true });
}
export function assertRepository(cwd = root, baseline = manifest.baselineCommit) {
  requireThat(git(['rev-parse', '--show-toplevel'], cwd) === realpathSync(cwd), 'Package must be located in the canonical repository root.');
  requireThat(/github\.com[:/]info-rbp\/ProInspect-Report-Creation-App(?:\.git)?$/u.test(git(['remote', 'get-url', 'origin'], cwd)), 'Unexpected Git origin.');
  requireThat(git(['merge-base', baseline, 'HEAD'], cwd) === baseline, 'Required seven-portal source baseline is missing.');
}
export function assertClean(cwd = root) {
  requireThat(!git(['status', '--porcelain', '--untracked-files=normal'], cwd), 'Working tree is not clean. Review and commit changes; this package never resets or discards your work.');
}
export function verifyIntegrity(base = packageRoot) {
  const index = readJson(resolve(base, 'integrity.json'));
  requireThat(index.algorithm === 'sha256' && Object.keys(index.files ?? {}).length >= 8, 'Installer integrity index is invalid.');
  for (const [path, expected] of Object.entries(index.files)) requireThat(hash(readFileSync(safePath(base, path))) === expected, `Installer integrity mismatch: ${path}`);
  return index;
}
export function parseArgs(argv) {
  const out = { command: argv[0] || 'plan', env: 'development' };
  const switches = new Set(['apply', 'live', 'resume', 'execute']);
  const values = new Set(['env', 'stage', 'confirm']);
  const seen = new Set();
  for (let i = 1; i < argv.length; i++) {
    requireThat(argv[i].startsWith('--'), `Unexpected argument ${argv[i]}`);
    const key = argv[i].slice(2);
    requireThat(!seen.has(key), `Repeated option --${key}`); seen.add(key);
    if (switches.has(key)) out[key] = true;
    else { requireThat(values.has(key) && argv[i + 1] && !argv[i + 1].startsWith('--'), `Unknown or missing option --${key}`); out[key] = argv[++i]; }
  }
  requireThat(['development', 'staging'].includes(out.env), 'Only development and staging are executable. Production traffic changes are not part of this installer.');
  return out;
}
export function validateConfig(config, environment, { complete = true } = {}) {
  requireThat(config.schemaVersion === 1 && config.environments?.[environment], 'Unsupported or missing environment configuration.');
  const walk = (value) => { if (!value || typeof value !== 'object') return; for (const [key, entry] of Object.entries(value)) { requireThat(!/(password|secret|api.?key|access.?token)/iu.test(key) || key.endsWith('Env'), `Secrets must not be stored in configuration: ${key}`); walk(entry); } };
  walk(config);
  const target = config.environments[environment];
  const app = target.appwrite;
  requireThat(app && app.endpoint === 'https://syd.cloud.appwrite.io/v1', 'This package is pinned to the reviewed Sydney Appwrite endpoint.');
  requireThat(!manifest.prohibited.appwriteProjects.includes(app.projectId), 'Prohibited Appwrite project.');
  requireThat(app.databaseId === 'proinspect_core', 'Unexpected Appwrite database.');
  if (app.projectId) requireThat(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/u.test(app.projectId), 'Invalid Appwrite project ID.');
  requireThat(!manifest.prohibited.googleProjects.includes(target.google?.projectId), 'Prohibited Google Cloud project.');
  if (environment === 'development') requireThat(app.projectId === 'proinspect-development' && app.projectName === 'ProInspect Development', 'Unexpected Development Appwrite target.');
  else if (app.projectId) requireThat(app.projectId !== 'proinspect-development', 'Staging must not point to Development.');
  requireThat(target.shopify?.domain === 'proinspect-2.myshopify.com' && target.shopify.apiVersion === '2026-07', 'Unexpected Shopify store or API version. Shopify operations in this package are read-only.');
  requireThat(target.shopify.tokenEnv === 'SHOPIFY_ADMIN_ACCESS_TOKEN', 'Use the documented Shopify token environment variable.');
  if (!complete) return target;
  requireThat(typeof config.approvedBy === 'string' && config.approvedBy.trim().length >= 3, 'Set approvedBy after reviewing non-production targets and policy.');
  requireThat(typeof config.policyDocument === 'string', 'A reviewed, committed policyDocument is required.');
  for (const [name, value] of Object.entries({ projectId: app.projectId, projectName: app.projectName, googleProject: target.google?.projectId, region: target.google?.region, accountId: target.cloudflare?.accountId, workerName: target.cloudflare?.workerName, origin: target.web?.origin })) requireThat(typeof value === 'string' && value.trim().length > 0 && !/REPLACE|example\.|<|>/iu.test(value), `Configure a real non-production ${name}.`);
  requireThat(/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/u.test(target.google.projectId), 'Invalid Google project ID.');
  requireThat(/^[a-f0-9]{32}$/iu.test(target.cloudflare.accountId), 'Invalid Cloudflare account ID.');
  requireThat(/^[a-zA-Z0-9_-]+$/u.test(target.cloudflare.workerName) && !manifest.prohibited.cloudflareWorkers.includes(target.cloudflare.workerName), 'Invalid or prohibited Worker name.');
  requireThat((environment === 'development' ? /(?:^|[-_])(dev|development)(?:$|[-_])/iu : /(?:^|[-_])staging(?:$|[-_])/iu).test(target.cloudflare.workerName), 'Use an explicitly environment-named Worker, never the root production Worker.');
  requireThat(target.google.environment === environment, 'Google environment label expectation must match the selected environment.');
  requireThat(Array.isArray(target.google.services) && target.google.services.length >= 7 && new Set(target.google.services).size === target.google.services.length && target.google.services.every((s) => /^[a-z][a-z0-9-]+$/u.test(s)), 'Declare API and all six specialist worker service names.');
  const origin = new URL(target.web.origin);
  requireThat(origin.protocol === 'https:' && origin.origin === target.web.origin && !origin.username && !origin.password, 'Web origin must be an exact HTTPS origin, without paths or credentials.');
  for (const key of ['healthPath', 'deniedPath']) requireThat(typeof target.web[key] === 'string' && target.web[key].startsWith('/') && !target.web[key].startsWith('//') && !/[?#\\]/u.test(target.web[key]), `Invalid web ${key}.`);
  requireThat(/^[A-Za-z][A-Za-z0-9_.]*$/u.test(target.web.revisionField), 'Invalid revision field.');
  if (environment === 'staging') {
    const dev = config.environments.development;
    requireThat(target.google.projectId !== dev.google.projectId && target.web.origin !== dev.web.origin && target.cloudflare.workerName !== dev.cloudflare.workerName, 'Staging projects, Worker names and origins must be isolated from Development.');
  }
  return target;
}
export function candidate(config, environment, cwd = root) {
  assertClean(cwd);
  return { commit: git(['rev-parse', 'HEAD'], cwd), tree: git(['rev-parse', 'HEAD^{tree}'], cwd), manifestHash: hash(manifest), configHash: hash(config), environment };
}
