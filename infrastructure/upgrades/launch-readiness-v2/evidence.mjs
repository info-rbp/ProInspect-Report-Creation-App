import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { atomicJson, canonical, hash, manifest, readJson, redact, requireThat, safePath } from './runtime.mjs';

export function validateManifest(value = manifest) {
  const seen = new Set();
  requireThat(value.schemaVersion === 1 && /^[a-f0-9]{40}$/u.test(value.baselineCommit), 'Invalid launch manifest.');
  for (const gate of value.gates) {
    requireThat(/^[a-z][a-z0-9-]+$/u.test(gate.id) && !seen.has(gate.id), 'Invalid or duplicated gate ID.');
    requireThat(['builtin', 'adapter'].includes(gate.kind) && ['local', 'live', 'device'].includes(gate.mode), 'Invalid gate kind or mode.');
    requireThat(gate.dependsOn.every((id) => seen.has(id)), 'Manifest dependencies must be ordered, present and acyclic.');
    requireThat(gate.checks.length > 0 && new Set(gate.checks).size === gate.checks.length, 'Acceptance checks must be nonempty and unique.');
    seen.add(gate.id);
  }
  return true;
}
export const receiptPath = (directory, environment, id) => resolve(directory, environment, 'receipts', `${id}.json`);
export function loadReceipt(directory, environment, id) {
  const path = receiptPath(directory, environment, id);
  return existsSync(path) ? readJson(path) : null;
}
export function validateResult(result, gate, context, runId) {
  requireThat(result.schemaVersion === 1 && result.runId === runId && canonical(result.candidate) === canonical(context), 'Acceptance output is stale, foreign or not bound to this execution.');
  requireThat(result.mode === gate.mode && result.mocked === false, 'The gate requires actual execution in its declared mode, not mocked acceptance.');
  requireThat(result.failed === 0 && result.skipped === 0, 'Failed or skipped acceptance checks cannot pass.');
  requireThat(Array.isArray(result.checks) && result.checks.length >= gate.checks.length, 'Required acceptance checks are missing.');
  const ids = result.checks.map((check) => check.id);
  requireThat(new Set(ids).size === ids.length && gate.checks.every((id) => ids.includes(id)), 'Acceptance coverage is incomplete or duplicated.');
  for (const check of result.checks) {
    requireThat(check.status === 'PASS' && Object.hasOwn(check, 'expected') && Object.hasOwn(check, 'observed') && canonical(check.expected) === canonical(check.observed), `Acceptance assertion failed or lacks observations: ${check.id}`);
  }
  requireThat(!result.artifacts?.includes('result.json') && !result.artifacts?.includes('input.json'), 'Runner control files cannot be supplied as proof artifacts.');
  requireThat(Array.isArray(result.artifacts) && result.artifacts.length > 0 && result.artifacts.length <= 64 && new Set(result.artifacts).size === result.artifacts.length, 'A nonempty, unique set of evidence artifacts is required.');
  return true;
}
export function recordArtifacts(runDirectory, paths, env = process.env) {
  return paths.map((name) => {
    const bytes = readFileSync(safePath(runDirectory, name));
    requireThat(bytes.length > 0 && bytes.length <= 20 * 1024 * 1024, `Evidence file is empty or exceeds 20 MiB: ${name}`);
    if (/\.(json|xml|log|txt|md|csv)$/u.test(name)) requireThat(redact(bytes.toString('utf8'), env) === bytes.toString('utf8'), `Possible credential in evidence artifact ${name}. Redact it before continuing.`);
    return { path: name, sha256: hash(bytes), bytes: bytes.length };
  });
}
export function receiptValid(receipt, gate, context, directory, now = Date.now(), stack = new Set()) {
  try {
    requireThat(receipt?.status === 'PASS' && receipt.gateId === gate.id && canonical(receipt.candidate) === canonical(context), 'Not a current passing receipt.');
    const age = now - Date.parse(receipt.completedAt);
    requireThat(Number.isFinite(age) && age >= 0 && age <= manifest.evidenceMaxAgeHours * 3600_000, 'Receipt is expired or future-dated.');
    requireThat(!stack.has(gate.id), 'Receipt dependency cycle.');
    const ancestors = new Set([...stack, gate.id]);
    const runDirectory = resolve(directory, context.environment, 'runs', receipt.runId);
    requireThat(/^[a-f0-9-]{36}$/u.test(receipt.runId), 'Invalid run ID.');
    for (const file of receipt.artifacts) requireThat(hash(readFileSync(safePath(runDirectory, file.path))) === file.sha256, 'Evidence was changed or is missing.');
    requireThat(receipt.artifacts.some((file) => file.path === 'result.json'), 'No runner-bound acceptance result.');
    const result = readJson(safePath(runDirectory, 'result.json'));
    validateResult(result, gate, context, receipt.runId);
    requireThat(result.artifacts.every((name) => receipt.artifacts.some((file) => file.path === name)), 'Acceptance artifact references are incomplete.');
    for (const id of gate.dependsOn) {
      const parent = loadReceipt(directory, context.environment, id);
      const definition = manifest.gates.find((item) => item.id === id);
      requireThat(receipt.dependencies[id] === hash(parent) && receiptValid(parent, definition, context, directory, now, ancestors), 'Dependency evidence has changed or is not passing.');
    }
    return true;
  } catch { return false; }
}
export function dependenciesFor(gate, context, directory) {
  const result = {};
  for (const id of gate.dependsOn) {
    const parent = loadReceipt(directory, context.environment, id);
    requireThat(receiptValid(parent, manifest.gates.find((item) => item.id === id), context, directory), `Run and pass prerequisite gate '${id}' for this exact candidate first.`);
    result[id] = hash(parent);
  }
  return result;
}
export function saveReceipt(directory, context, gate, value) {
  atomicJson(receiptPath(directory, context.environment, gate.id), { ...value, gateId: gate.id, candidate: context, completedAt: new Date().toISOString() });
}
export function scorecard(directory, context) {
  return manifest.gates.map((gate) => {
    const receipt = loadReceipt(directory, context.environment, gate.id);
    const status = receiptValid(receipt, gate, context, directory) ? 'PASS' : receipt?.status === 'PASS' ? 'STALE' : receipt?.status ?? 'NOT_RUN';
    return { id: gate.id, title: gate.title, status, elements: gate.scorecardElements, requiredChecks: gate.checks.length };
  });
}
export function writeScorecard(directory, context) {
  const rows = scorecard(directory, context);
  const allPassed = rows.every((row) => row.status === 'PASS');
  let developmentPassed = false;
  if (context.environment === 'staging') {
    const dev = { ...context, environment: 'development' };
    developmentPassed = scorecard(directory, dev).filter((row) => row.id !== 'rehearsal').every((row) => row.status === 'PASS');
  }
  const decision = allPassed && developmentPassed && context.environment === 'staging' ? 'READY_FOR_RELEASE_REVIEW' : 'NOT_LAUNCH_READY';
  const report = { generatedAt: new Date().toISOString(), candidate: context, decision, developmentPassed, gates: rows, productionDeploymentAuthorised: false };
  atomicJson(resolve(directory, context.environment, 'scorecard.json'), report);
  const markdown = `# ProInspect launch-readiness scorecard\n\nDecision: **${decision}**\n\nCandidate: \`${context.commit}\`\nEnvironment: ${context.environment}\n\n| Gate | Status | Required checks |\n| --- | --- | ---: |\n${rows.map((r) => `| ${r.title} | ${r.status} | ${r.requiredChecks} |`).join('\n')}\n\nThis is an evidence gate, not a percentage estimate. Release review does not authorise a Production traffic switch.\n`;
  writeFileSync(resolve(directory, context.environment, 'scorecard.md'), markdown, { mode: 0o600 });
  return report;
}
