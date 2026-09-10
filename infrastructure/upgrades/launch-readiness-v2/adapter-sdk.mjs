import { isDeepStrictEqual } from 'node:util';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { safePath } from './runtime.mjs';

// For reviewed acceptance runners. Assertions must follow real operations or tests.
// This SDK supplies no synthetic PASS values and does not write the launch ledger.
export function acceptance(env = process.env) {
  if (!env.PROINSPECT_LAUNCH_INPUT || !env.PROINSPECT_LAUNCH_OUTPUT) throw new Error('Run this adapter through launch:verify or launch:deploy.');
  const input = JSON.parse(readFileSync(env.PROINSPECT_LAUNCH_INPUT, 'utf8'));
  const directory = dirname(env.PROINSPECT_LAUNCH_OUTPUT);
  const checks = []; const artifacts = [];
  return {
    input,
    check(id, observed, expected) {
      if (checks.some((check) => check.id === id)) throw new Error(`Duplicate assertion ${id}`);
      checks.push({ id, observed, expected, status: isDeepStrictEqual(observed, expected) ? 'PASS' : 'FAIL' });
    },
    artifact(name, bytes) {
      const path = safePath(directory, name, { mustExist: false });
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(path, bytes, { mode: 0o600 }); artifacts.push(name);
    },
    finish() {
      const failed = checks.filter((check) => check.status !== 'PASS').length;
      const result = { schemaVersion: 1, runId: input.runId, candidate: input.candidate, mode: input.gate.mode, mocked: false, failed, skipped: 0, checks, artifacts };
      writeFileSync(resolve(env.PROINSPECT_LAUNCH_OUTPUT), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
      if (failed) process.exitCode = 1;
      return result;
    },
  };
}
