import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { approvedConfig, privateDirectory, targetEnv, validateShopifyReplay } from './configuration.mjs';
import { adapterCoverage } from './verification.mjs';
import { auditProviders, toolchain } from './providers.mjs';
import { inspectTargetAuthority } from './actions/runtime-authority.mjs';
import { installationOrder, requireBackup } from './actions/index.mjs';
import { loadBundle } from './actions/migrate.mjs';
import { validateCredentialPolicy } from './actions/credentials.mjs';
import {
  atomicJson,
  canonical,
  git,
  hash,
  readJson,
  redact,
  requireThat,
  root,
  run,
  sameSourceCandidate,
} from './runtime.mjs';

export const ISSUE_SEVERITIES = ['BLOCKER', 'WARNING', 'ADVISORY'];
export const STAGE_DEPENDENCIES = {
  source: [],
  backup: ['source'],
  schema: ['source', 'backup'],
  fixtures: ['source', 'backup', 'schema'],
  data: ['source', 'backup', 'schema', 'fixtures'],
  files: ['source', 'backup', 'data'],
  terraform: ['source', 'backup'],
  credentials: ['source', 'backup', 'terraform'],
  google: ['source', 'backup', 'terraform', 'credentials'],
  cloudflare: ['source', 'backup', 'google'],
  shopify: ['source', 'backup', 'fixtures', 'google', 'cloudflare'],
};
const REMOTE_RECHECK_STAGES = new Set(['schema', 'data', 'files']);

function issueId(environment, stage, code) {
  return `L-${hash(`${environment}:${stage}:${code}`).slice(0, 10).toUpperCase()}`;
}
function commandSuffix(environment) {
  return environment === 'development' ? '' : ` --env ${environment}`;
}
function recheckCommand(environment, stage) {
  const suffix = commandSuffix(environment);
  if (stage === 'preflight') return `npm run launch:preflight --${suffix} --all`;
  if (stage === 'reconcile') return `npm run launch:reconcile --${suffix} --stage all`;
  return `npm run launch:check --${suffix} --stage ${stage}`;
}
function defaultRemediation(code, stage, environment, target) {
  const suffix = commandSuffix(environment);
  const appwriteId = target?.appwrite?.projectId || 'APPWRITE_PROJECT_ID';
  if (code === 'WORKTREE_DIRTY') return 'Commit or move local changes. The installer never resets or discards operator work.';
  if (code === 'CONFIGURATION') return `Edit the private launch config, then run: npm run launch:preflight --${suffix} --all`;
  if (code === 'POLICY') return 'Complete and commit the tracked launch policy approvals, then repeat preflight.';
  if (code === 'TOOLCHAIN') return 'Run nvm use, npm ci --ignore-scripts --no-audit --no-fund, then repeat the command.';
  if (code === 'PROVIDERS') return 'Authenticate the Appwrite, gcloud, Wrangler and Shopify credentials in this VS Code terminal and verify the configured non-production target IDs.';
  if (code === 'AUTHORITY') return `Run npm run launch:authority, repair the reported Appwrite-authority source paths, then repeat: ${recheckCommand(environment, stage)}`;
  if (code === 'MIGRATION_BUNDLE') return 'Create the reviewed private migration bundle and SHA-256 pin it in config before retrying this stage.';
  if (code === 'TERRAFORM_INPUT') return 'Configure existing absolute private Terraform tfvars/backend files outside the repository.';
  if (code === 'CREDENTIAL_POLICY') return 'Configure minimum per-service Appwrite runtimeCredentialPolicies and matching Google Secret Manager bindings.';
  if (code === 'BACKUP_KEY') return 'Export LAUNCH_BACKUP_KEY as exactly 64 hexadecimal characters from the approved secret source.';
  if (code === 'SEED_PASSWORD') return `Export ${target?.acceptance?.seedPasswordEnv || 'APPWRITE_SEED_PASSWORD'} with the synthetic acceptance password.`;
  if (code === 'EDGE_SECRET') return `Export ${target?.cloudflare?.trustedEdgeSecretEnv || 'PROINSPECT_EDGE_SECRET'} in this terminal before Cloudflare deployment.`;
  if (code === 'SHOPIFY_REPLAY') return `Complete the synthetic Shopify replay configuration and fixture, then run: npm run launch:check --${suffix} --stage shopify`;
  if (code === 'SHOPIFY_TOKEN') return `Export ${target?.shopify?.tokenEnv || 'SHOPIFY_ADMIN_ACCESS_TOKEN'} for the approved store.`;
  if (code === 'SHOPIFY_HMAC') return `Export ${target?.acceptance?.shopifyWebhookSecretEnv || 'SHOPIFY_WEBHOOK_SECRET'} with the non-production webhook HMAC secret.`;
  if (code === 'DEPENDENCY_NOT_CURRENT') return `Run npm run launch:reconcile --${suffix} --stage all, then complete the prerequisite stages before ${stage}.`;
  if (code === 'CHECKPOINT_INVALIDATED') return `Re-run npm run launch:check --${suffix} --stage ${stage}, then re-run the explicit ${stage} installation stage after review.`;
  if (code === 'CHECKPOINT_RECHECK') return `Reconcile and explicitly re-run ${stage}; the installer will use its idempotent/drift guards rather than assuming prior remote state is current.`;
  if (code === 'BACKUP_NOT_CURRENT') return `Repeat the backup stage for this exact candidate: npm run launch:install --${suffix} --stage backup --apply --confirm INSTALL:${environment}:${appwriteId}`;
  return `Correct the reported condition, then re-run: ${recheckCommand(environment, stage)}`;
}
export function makeIssue({ environment, stage = 'preflight', code, severity = 'BLOCKER', message, target, remediation, recheck }) {
  requireThat(ISSUE_SEVERITIES.includes(severity), 'Unknown issue severity');
  return {
    id: issueId(environment, stage, code),
    code,
    stage,
    severity,
    message: redact(message),
    remediation: remediation || defaultRemediation(code, stage, environment, target),
    recheck: recheck || recheckCommand(environment, stage),
  };
}
function ledgerPath(directory, environment) {
  return resolve(directory, environment, 'issues.json');
}
function checkpointDirectory(directory, environment) {
  return resolve(directory, environment, 'checkpoints');
}
function reportPath(directory, environment) {
  return resolve(directory, environment, 'operator-report.md');
}
function readLedger(directory, environment) {
  const path = ledgerPath(directory, environment);
  return existsSync(path) ? readJson(path) : { schemaVersion: 1, environment, issues: [] };
}
export function syncIssueLedger(directory, environment, context, observed, scannedStages = ['*']) {
  const now = new Date().toISOString();
  const previous = readLedger(directory, environment);
  const current = new Map(observed.map((item) => [item.id, item]));
  const scopeAll = scannedStages.includes('*');
  const issues = [];
  for (const old of previous.issues || []) {
    const seen = current.get(old.id);
    if (seen) {
      issues.push({ ...old, ...seen, status: 'OPEN', firstSeenAt: old.firstSeenAt || now, lastSeenAt: now, candidate: context || old.candidate });
      current.delete(old.id);
      continue;
    }
    if (old.status === 'OPEN' && (scopeAll || scannedStages.includes(old.stage))) issues.push({ ...old, status: 'RESOLVED', resolvedAt: now, lastSeenAt: old.lastSeenAt || now });
    else issues.push(old);
  }
  for (const item of current.values()) issues.push({ ...item, status: 'OPEN', firstSeenAt: now, lastSeenAt: now, candidate: context || null });
  const ledger = { schemaVersion: 1, environment, updatedAt: now, candidate: context || null, issues };
  atomicJson(ledgerPath(directory, environment), ledger);
  return ledger;
}
export function openIssues(directory, environment) {
  return readLedger(directory, environment).issues.filter((item) => item.status === 'OPEN');
}
export function issueSummary(directory, environment) {
  const open = openIssues(directory, environment);
  return Object.fromEntries(ISSUE_SEVERITIES.map((severity) => [severity.toLowerCase(), open.filter((item) => item.severity === severity).length]));
}
function readCheckpoint(directory, environment, stage) {
  const path = resolve(checkpointDirectory(directory, environment), `${stage}.json`);
  return existsSync(path) ? readJson(path) : null;
}
export function checkpointEvaluation(checkpoint, context) {
  if (!checkpoint) return { status: 'NOT_STARTED', reason: 'No successful checkpoint exists.' };
  if (checkpoint.status !== 'PASS') return { status: checkpoint.status || 'UNKNOWN', reason: 'Checkpoint is not passing.' };
  const exact = ['commit', 'tree', 'manifestHash', 'schemaHash', 'configHash'].every((key) => checkpoint.candidate?.[key] === context?.[key]);
  if (exact) return { status: 'CURRENT', reason: 'Checkpoint matches the exact candidate and configuration.' };
  if (REMOTE_RECHECK_STAGES.has(checkpoint.stage)) return { status: 'RECHECK_REQUIRED', reason: sameSourceCandidate(checkpoint.candidate, context) ? 'Configuration changed; durable remote state must be reconciled.' : 'Source candidate changed; durable remote state must be reconciled rather than discarded.' };
  return { status: 'INVALIDATED', reason: sameSourceCandidate(checkpoint.candidate, context) ? 'Configuration changed after this checkpoint.' : 'Source candidate changed after this checkpoint.' };
}
export function recordCheckpoint(directory, context, stage, actionRecord) {
  const dependencies = (STAGE_DEPENDENCIES[stage] || []).map((id) => {
    const checkpoint = readCheckpoint(directory, context.environment, id);
    return { stage: id, checkpointHash: checkpoint ? hash(checkpoint) : null };
  });
  const checkpoint = {
    schemaVersion: 1,
    stage,
    status: 'PASS',
    candidate: context,
    completedAt: actionRecord.completedAt || new Date().toISOString(),
    actionStateHash: hash({ id: actionRecord.id, result: actionRecord.result, completedAt: actionRecord.completedAt }),
    dependencies,
  };
  atomicJson(resolve(checkpointDirectory(directory, context.environment), `${stage}.json`), checkpoint);
  return checkpoint;
}
export function checkpointSummary(directory, context) {
  return installationOrder.map((stage) => ({ stage, ...checkpointEvaluation(readCheckpoint(directory, context.environment, stage), context) }));
}
export function recordRuntimeIssue(directory, context, stage, code, error, target) {
  const issue = makeIssue({ environment: context.environment, stage, code, message: redact(error?.message || error), target });
  syncIssueLedger(directory, context.environment, context, [issue], [stage]);
  return issue;
}
async function collect(issues, input, fn) {
  try {
    await fn();
    return true;
  } catch (error) {
    issues.push(makeIssue({ ...input, message: error.message }));
    return false;
  }
}
function requiredEnvironmentVariable(name) {
  requireThat(typeof name === 'string' && /^[A-Z][A-Z0-9_]*$/u.test(name) && process.env[name], `Required environment variable is missing: ${name}`);
}
function actionRecordCurrent(directory, context, stage) {
  const path = resolve(directory, context.environment, 'actions', `${stage}.json`);
  requireThat(existsSync(path), `Required ${stage} action has not completed`);
  const record = readJson(path);
  requireThat(record.status === 'SUCCEEDED', `Required ${stage} action is not successful`);
  const evaluation = checkpointEvaluation(readCheckpoint(directory, context.environment, stage), context);
  requireThat(evaluation.status === 'CURRENT', `${stage} checkpoint is ${evaluation.status}: ${evaluation.reason}`);
  return record;
}
export async function checkStage(config, context, directory, stage, { live = false, writeLedger = true } = {}) {
  requireThat(installationOrder.includes(stage), 'Unknown installation stage');
  const environment = context.environment;
  const target = config.environments?.[environment];
  const issues = [];
  await collect(issues, { environment, stage, code: 'WORKTREE_DIRTY', target }, () => requireThat(!git(['status', '--porcelain', '--untracked-files=normal']), 'Repository working tree is not clean'));
  await collect(issues, { environment, stage, code: 'CONFIGURATION', target }, () => approvedConfig(config, environment));
  await collect(issues, { environment, stage, code: 'TARGET_ENV', target }, () => targetEnv(target));
  if (['backup','schema','fixtures','data','files','terraform','credentials','google','cloudflare','shopify'].includes(stage)) {
    await collect(issues, { environment, stage, code: 'FREEZE_NOT_APPROVED', target }, () => requireThat(target?.backup?.freezeApproved === true, 'Application and worker write freeze is not approved'));
  }
  if (stage === 'source' || stage === 'google') {
    await collect(issues, { environment, stage, code: 'AUTHORITY', target }, () => {
      const authority = inspectTargetAuthority(root);
      requireThat(authority.pass, authority.workers.violations.concat(authority.terraform.violations).map((item) => `${item.path}:${item.reason}`).join('; '));
    });
  }
  for (const dependency of STAGE_DEPENDENCIES[stage] || []) {
    await collect(issues, { environment, stage, code: 'DEPENDENCY_NOT_CURRENT', target }, () => actionRecordCurrent(directory, context, dependency));
  }
  if (['backup', 'schema', 'fixtures', 'data', 'files', 'terraform', 'credentials', 'google', 'cloudflare', 'shopify'].includes(stage)) {
    await collect(issues, { environment, stage, code: 'BACKUP_DIRECTORY', target }, () => privateDirectory(target.backup.directory));
  }
  if (stage === 'backup') await collect(issues, { environment, stage, code: 'BACKUP_KEY', target }, () => requireThat(/^[a-f0-9]{64}$/iu.test(process.env.LAUNCH_BACKUP_KEY || ''), 'LAUNCH_BACKUP_KEY must be exactly 64 hexadecimal characters'));
  if (stage === 'fixtures') await collect(issues, { environment, stage, code: 'SEED_PASSWORD', target }, () => requiredEnvironmentVariable(target.acceptance.seedPasswordEnv));
  if (['data', 'files'].includes(stage)) await collect(issues, { environment, stage, code: 'MIGRATION_BUNDLE', target }, () => loadBundle(target));
  if (stage === 'terraform') {
    await collect(issues, { environment, stage, code: 'TERRAFORM_INPUT', target }, () => {
      for (const path of [target.terraform.variablesFile, target.terraform.backendFile]) requireThat(typeof path === 'string' && existsSync(path), `Private Terraform input missing: ${path || '(unset)'}`);
    });
    if (!process.env.LAUNCH_TERRAFORM_PLAN_SHA256) issues.push(makeIssue({ environment, stage, code: 'TERRAFORM_REVIEW', severity: 'ADVISORY', target, message: 'The first Terraform apply intentionally stops with TERRAFORM_REVIEW_REQUIRED so the exact plan digest can be approved.', remediation: 'Run the Terraform stage once, review terraform-plan-review.json, export LAUNCH_TERRAFORM_PLAN_SHA256 to the exact digest, then repeat the stage.', recheck: `npm run launch:check --${commandSuffix(environment)} --stage terraform` }));
  }
  if (stage === 'credentials') await collect(issues, { environment, stage, code: 'CREDENTIAL_POLICY', target }, () => validateCredentialPolicy(target.appwrite.runtimeCredentialPolicies, target.google.services));
  if (stage === 'cloudflare') await collect(issues, { environment, stage, code: 'EDGE_SECRET', target }, () => requiredEnvironmentVariable(target.cloudflare.trustedEdgeSecretEnv));
  if (stage === 'shopify') {
    await collect(issues, { environment, stage, code: 'SHOPIFY_REPLAY', target }, () => validateShopifyReplay(target));
    await collect(issues, { environment, stage, code: 'SHOPIFY_TOKEN', target }, () => requiredEnvironmentVariable(target.shopify.tokenEnv));
    await collect(issues, { environment, stage, code: 'SHOPIFY_HMAC', target }, () => requiredEnvironmentVariable(target.acceptance.shopifyWebhookSecretEnv));
  }
  if (!['source', 'backup'].includes(stage)) await collect(issues, { environment, stage, code: 'BACKUP_NOT_CURRENT', target }, () => requireBackup(directory, context));
  if (live) await collect(issues, { environment, stage, code: 'TOOLCHAIN', target }, () => toolchain(true));
  if (writeLedger) syncIssueLedger(directory, environment, context, issues, [stage]);
  const blockers = issues.filter((item) => item.severity === 'BLOCKER');
  return { status: blockers.length ? 'STAGE_BLOCKED' : 'STAGE_READY', blocked: blockers.length > 0, stage, issues, checkpoints: checkpointSummary(directory, context) };
}
export async function preflight(config, context, directory, { all = false } = {}) {
  const environment = context.environment;
  const target = config.environments?.[environment];
  const issues = [];
  await collect(issues, { environment, stage: 'preflight', code: 'WORKTREE_DIRTY', target }, () => requireThat(!git(['status', '--porcelain', '--untracked-files=normal']), 'Repository working tree is not clean'));
  await collect(issues, { environment, stage: 'preflight', code: 'CONFIGURATION', target }, () => approvedConfig(config, environment));
  await collect(issues, { environment, stage: 'preflight', code: 'TARGET_ENV', target }, () => targetEnv(target));
  await collect(issues, { environment, stage: 'preflight', code: 'FREEZE_NOT_APPROVED', target }, () => requireThat(target?.backup?.freezeApproved === true, 'Application and worker write freeze is not approved for installation'));
  await collect(issues, { environment, stage: 'preflight', code: 'TOOLCHAIN', target }, () => toolchain(all));
  await collect(issues, { environment, stage: 'preflight', code: 'AUTHORITY', target }, () => {
    const authority = inspectTargetAuthority(root);
    requireThat(authority.pass, authority.workers.violations.concat(authority.terraform.violations).map((item) => `${item.path}:${item.reason}`).join('; '));
  });
  await collect(issues, { environment, stage: 'preflight', code: 'ACCEPTANCE_COVERAGE', target }, () => {
    const coverage = adapterCoverage(config, environment);
    requireThat(coverage.complete, `Missing/invalid acceptance implementation: ${[...coverage.missing, ...coverage.invalid.map((item) => item.gate)].join(', ')}`);
  });
  await collect(issues, { environment, stage: 'preflight', code: 'BACKUP_DIRECTORY', target }, () => privateDirectory(target.backup.directory));
  await collect(issues, { environment, stage: 'preflight', code: 'MIGRATION_BUNDLE', target }, () => loadBundle(target));
  await collect(issues, { environment, stage: 'preflight', code: 'TERRAFORM_INPUT', target }, () => {
    for (const path of [target.terraform.variablesFile, target.terraform.backendFile]) requireThat(typeof path === 'string' && existsSync(path), `Private Terraform input missing: ${path || '(unset)'}`);
  });
  await collect(issues, { environment, stage: 'preflight', code: 'CREDENTIAL_POLICY', target }, () => validateCredentialPolicy(target.appwrite.runtimeCredentialPolicies, target.google.services));
  await collect(issues, { environment, stage: 'preflight', code: 'SHOPIFY_REPLAY', target }, () => validateShopifyReplay(target));
  for (const [code, name] of [['SEED_PASSWORD', target?.acceptance?.seedPasswordEnv], ['EDGE_SECRET', target?.cloudflare?.trustedEdgeSecretEnv], ['SHOPIFY_TOKEN', target?.shopify?.tokenEnv], ['SHOPIFY_HMAC', target?.acceptance?.shopifyWebhookSecretEnv]]) {
    await collect(issues, { environment, stage: 'preflight', code, target }, () => requiredEnvironmentVariable(name));
  }
  if (all) {
    await collect(issues, { environment, stage: 'preflight', code: 'PROVIDERS', target }, async () => {
      const folder = resolve(directory, environment, 'preflight', new Date().toISOString().replace(/[:.]/gu, '-'));
      mkdirSync(folder, { recursive: true, mode: 0o700 });
      await auditProviders(config, environment, folder);
    });
  }
  issues.push(makeIssue({ environment, stage: 'preflight', code: 'PHYSICAL_DEVICE_EVIDENCE', severity: 'WARNING', target, message: 'Physical-device/offline acceptance cannot be completed before deployment and remains required before release review.', remediation: 'Collect the controlled device evidence after Development deployment using npm run launch:evidence.', recheck: `npm run launch:status --${commandSuffix(environment)}` }));
  issues.push(makeIssue({ environment, stage: 'preflight', code: 'PRODUCTION_LOCKED', severity: 'ADVISORY', target, message: 'Production remains intentionally unavailable through launch:install; release uses the separate human-gated launch:release controller.', remediation: 'No action during Development installation.', recheck: 'npm run launch:release -- plan' }));
  const ledger = syncIssueLedger(directory, environment, context, issues, ['preflight']);
  const open = ledger.issues.filter((item) => item.status === 'OPEN');
  const blockers = open.filter((item) => item.severity === 'BLOCKER').length;
  return { status: blockers ? 'PREFLIGHT_BLOCKED' : open.some((item) => item.severity === 'WARNING') ? 'PREFLIGHT_PASS_WITH_WARNINGS' : 'PREFLIGHT_PASS', blocked: blockers > 0, environment, counts: issueSummary(directory, environment), issues: open, checkpoints: checkpointSummary(directory, context) };
}
export function reconcile(config, context, directory, stage = 'all') {
  const environment = context.environment;
  const selected = stage === 'all' ? installationOrder : [stage];
  requireThat(selected.every((id) => installationOrder.includes(id)), 'Unknown reconciliation stage');
  const target = config.environments[environment];
  const issues = [];
  if (git(['status', '--porcelain', '--untracked-files=normal'])) issues.push(makeIssue({ environment, stage: 'reconcile', code: 'WORKTREE_DIRTY', target, message: 'Commit or move source changes before trusting checkpoint reconciliation.' }));
  const states = selected.map((id) => {
    const checkpoint = readCheckpoint(directory, environment, id);
    const evaluation = checkpointEvaluation(checkpoint, context);
    if (evaluation.status === 'INVALIDATED') issues.push(makeIssue({ environment, stage: id, code: 'CHECKPOINT_INVALIDATED', target, message: `${id}: ${evaluation.reason}` }));
    if (evaluation.status === 'RECHECK_REQUIRED') issues.push(makeIssue({ environment, stage: id, code: 'CHECKPOINT_RECHECK', target, message: `${id}: ${evaluation.reason}` }));
    return { stage: id, ...evaluation };
  });
  const scanned = selected;
  syncIssueLedger(directory, environment, context, issues, ['reconcile', ...scanned]);
  const blocked = issues.some((item) => item.severity === 'BLOCKER') || states.some((item) => ['INVALIDATED', 'RECHECK_REQUIRED'].includes(item.status));
  atomicJson(resolve(directory, environment, 'reconciliation.json'), { schemaVersion: 1, environment, candidate: context, observedAt: new Date().toISOString(), states, safeToContinue: !blocked });
  return { status: blocked ? 'RECONCILIATION_REQUIRED' : 'SAFE_TO_CONTINUE', blocked, states, issues };
}
export async function safeRepair(config, environment) {
  requireThat(!git(['status', '--porcelain', '--untracked-files=normal']), 'Safe repair starts only from a clean worktree so operator changes cannot be overwritten');
  const target = config.environments[environment];
  const created = [];
  for (const candidate of [target?.backup?.directory, target?.acceptance?.evidenceDirectory]) {
    if (typeof candidate === 'string' && candidate.startsWith('/') && !existsSync(candidate)) {
      privateDirectory(candidate);
      mkdirSync(candidate, { recursive: true, mode: 0o700 });
      created.push(candidate);
    }
  }
  await run('npm', ['run', 'format'], { cwd: root, timeoutMs: 1800000 });
  await run('npm', ['run', 'appwrite:generate'], { cwd: root, timeoutMs: 1800000 });
  const changes = git(['status', '--porcelain', '--untracked-files=normal']).split('\n').filter(Boolean);
  return { status: changes.length ? 'SAFE_LOCAL_REPAIR_REQUIRES_REVIEW' : 'SAFE_LOCAL_REPAIR_NO_CHANGES', remoteMutations: false, createdPrivateDirectories: created, changes, next: changes.length ? 'Review the diff, run npm run check, then commit approved changes before continuing.' : 'Re-run launch:preflight.' };
}
function actionRows(directory, environment) {
  const path = resolve(directory, environment, 'actions');
  if (!existsSync(path)) return [];
  return readdirSync(path).filter((name) => name.endsWith('.json')).sort().map((name) => {
    const value = readJson(resolve(path, name));
    return { stage: name.replace(/\.json$/u, ''), status: value.status, completedAt: value.completedAt || null };
  });
}
export function writeOperatorReport(directory, environment, context, meta = {}) {
  if (!environment) return null;
  const issues = openIssues(directory, environment);
  const counts = Object.fromEntries(ISSUE_SEVERITIES.map((severity) => [severity, issues.filter((item) => item.severity === severity).length]));
  const checkpoints = context ? checkpointSummary(directory, context) : [];
  const lines = [
    '# ProInspect launch operator report',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Environment: ${environment}`,
    `Candidate: ${context?.commit || 'unavailable'}`,
    `Command: ${meta.command || 'unknown'}`,
    `Result: ${meta.result || (meta.error ? 'FAILED' : 'unknown')}`,
    ...(meta.error ? [`Error: ${redact(meta.error)}`] : []),
    '',
    '## Open issues',
    '',
    `BLOCKER: ${counts.BLOCKER} | WARNING: ${counts.WARNING} | ADVISORY: ${counts.ADVISORY}`,
    '',
    ...issues.flatMap((item) => [`### ${item.id} ${item.severity} ${item.stage}/${item.code}`, '', item.message, '', `Remediation: ${item.remediation}`, `Recheck: ${item.recheck}`, '']),
    '## Checkpoints',
    '',
    ...(checkpoints.length ? checkpoints.map((item) => `- ${item.stage}: ${item.status} - ${item.reason}`) : ['- No candidate checkpoint summary is available.']),
    '',
    '## Recorded installation actions',
    '',
    ...actionRows(directory, environment).map((item) => `- ${item.stage}: ${item.status}${item.completedAt ? ` at ${item.completedAt}` : ''}`),
    '',
    'This report is private operator state under the Git metadata directory. It is not launch acceptance and contains no secret values.',
    '',
  ];
  const path = reportPath(directory, environment);
  mkdirSync(resolve(directory, environment), { recursive: true, mode: 0o700 });
  const temp = `${path}.tmp`;
  const text = lines.join('\n');
  requireThat(!/(?:shpat_|Bearer\s+\S+)/u.test(text), 'Operator report unexpectedly resembles a credential-bearing document');
  writeFileSync(temp, text, { mode: 0o600 });
  renameSync(temp, path);
  atomicJson(resolve(directory, environment, 'operator-report.json'), { schemaVersion: 1, environment, generatedAt: new Date().toISOString(), candidate: context || null, command: meta.command || null, result: meta.result || null, error: meta.error ? redact(meta.error) : null, counts, reportSha256: hash(text) });
  return path;
}

export function operatorStateDigest(directory, context) {
  return hash(canonical({ issues: openIssues(directory, context.environment), checkpoints: checkpointSummary(directory, context) }));
}
