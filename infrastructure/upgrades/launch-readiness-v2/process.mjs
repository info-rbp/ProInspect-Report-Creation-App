import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { setTimeout, clearTimeout } from 'node:timers';

export function redact(text, env = process.env) {
  let value = String(text ?? '');
  for (const [name, secret] of Object.entries(env)) {
    if (/(password|secret|token|key|credential)/iu.test(name) && typeof secret === 'string' && secret.length >= 6) value = value.split(secret).join('[REDACTED]');
  }
  return value.replace(/Bearer\s+[^\s"']+/giu, 'Bearer [REDACTED]')
    .replace(/shp(?:at|ca|pa|ss)_[A-Za-z0-9]+/gu, '[REDACTED]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gu, '[REDACTED]')
    .replace(/([?&](?:token|key|secret|signature)=)[^&\s]+/giu, '$1[REDACTED]');
}
export function commandEnv(live = false, extra = {}, inherited = process.env) {
  const result = { ...inherited };
  if (!live) for (const name of Object.keys(result)) if (/(password|secret|token|key|credential)/iu.test(name)) delete result[name];
  return { ...result, ...extra, NO_COLOR: '1', CI: '1' };
}
export function run(command, args = [], options = {}) {
  if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) throw new Error('Arguments must be strings.');
  if (process.platform === 'win32') throw new Error('Use the VS Code WSL terminal on Windows.');
  const env = commandEnv(options.live, options.env);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env, shell: false, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let size = 0; let stopped; let killTimer;
    const stop = (reason) => {
      if (stopped) return;
      stopped = reason;
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Already exited. */ }
      killTimer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already exited. */ } }, 1000);
      killTimer.unref();
    };
    const collect = (kind, chunk) => {
      size += chunk.length;
      if (size > 16 * 1024 * 1024) return stop('Output limit exceeded');
      if (kind === 'out') stdout += chunk.toString('utf8'); else stderr += chunk.toString('utf8');
    };
    child.stdout.on('data', (c) => collect('out', c)); child.stderr.on('data', (c) => collect('err', c));
    child.stdin.on('error', () => {}); child.stdin.end(options.input ?? '');
    const timer = setTimeout(() => stop('Timeout; inspect remote state before retry'), options.timeoutMs ?? 1800000);
    const interrupt = () => stop('Interrupted; inspect remote state before retry');
    process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
    const clean = () => { clearTimeout(timer); process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); };
    child.once('error', (error) => { clean(); reject(new Error(redact(error.message, env))); });
    child.once('close', (code) => {
      clean(); if (!stopped) clearTimeout(killTimer);
      const log = redact(`${stdout}\n${stderr}`, env);
      if (options.logFile) { mkdirSync(dirname(options.logFile), { recursive: true, mode: 0o700 }); writeFileSync(options.logFile, log, { mode: 0o600 }); }
      if (stopped || code !== 0) reject(new Error(`${command}: ${stopped ?? `exit ${code}`}. ${options.sensitive ? 'Output suppressed.' : log.slice(-2000)}`));
      else resolve(stdout.trim());
    });
  });
}
