import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  assert,
  manifest,
  markStage,
  output,
  packageRoot,
  printStageTable,
  root,
  run,
  toolchain,
  verifyCleanTree,
  verifyDevelopmentEnvironment,
  verifyToolchain,
} from './lib.mjs';
import { verifyStages } from './stage-verification.mjs';
import { applyUpdate } from './apply.mjs';

const command = process.argv[2] || 'status';
const args = new Set(process.argv.slice(3));
const development = args.has('--development');
const requireIntegrations = args.has('--require-integrations');

function banner() {
  console.log(`ProInspect ${manifest.id} v${manifest.version}`);
  console.log(`Baseline ${manifest.baselineCommit}`);
}

function verifyRepository() {
  assert(existsSync(resolve(root, '.git')), 'Run this update from the ProInspect repository root.');
  const repository = output('git', ['remote', 'get-url', 'origin']);
  assert(
    /(?:github\.com[:/])info-rbp\/ProInspect-Report-Creation-App(?:\.git)?$/u.test(repository),
    `Unexpected git origin: ${repository}`,
  );
  const head = output('git', ['rev-parse', 'HEAD']);
  const baseline = output('git', ['merge-base', manifest.baselineCommit, head]);
  assert(baseline === manifest.baselineCommit, `Current HEAD does not contain required baseline ${manifest.baselineCommit}.`);
}

function cleanupGeneratedArtifacts() {
  const tracked = output('git', ['ls-files', '--', ':(glob)**/tsconfig.tsbuildinfo'])
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean);
  if (tracked.length) run('git', ['restore', '--', ...tracked]);
  rmSync(resolve(root, 'test-results'), { recursive: true, force: true });
}

function runPackageAudit() {
  run('node', [resolve(packageRoot, 'package-audit.mjs')]);
}

function runDiffAudit() {
  run('node', [resolve(packageRoot, 'diff-audit.mjs')]);
}

async function preflight() {
  banner();
  verifyRepository();
  runPackageAudit();
  const versions = verifyToolchain();
  if (development) verifyDevelopmentEnvironment();
  console.log('PASS repository origin and Stage 2D baseline');
  console.log(`PASS Node ${versions.node}, npm ${versions.npm}, Appwrite CLI ${versions.appwrite}`);
  if (development) console.log(`PASS Development target ${manifest.development.projectId}`);
}

async function sourceVerify() {
  banner();
  verifyRepository();
  runPackageAudit();
  await verifyStages();
  run('node', [resolve(packageRoot, 'performance-budget.mjs')]);
}

function developmentIntegrationChecks() {
  let shopify = false;
  let google = false;

  const expectedShop = manifest.development.shopifyStore.toLowerCase();
  const shop = (process.env.SHOPIFY_STORE_DOMAIN?.trim() || process.env.SHOPIFY_SHOP_DOMAIN?.trim() || '').toLowerCase();
  if (shop) {
    assert(shop === expectedShop, `SHOPIFY_STORE_DOMAIN must be ${manifest.development.shopifyStore}; found ${shop}.`);
    shopify = true;
    console.log(`PASS Stage 09 Shopify Development target ${shop}`);
  } else {
    console.log(`INFO Stage 09 target not declared. Set SHOPIFY_STORE_DOMAIN=${manifest.development.shopifyStore} for integrated UAT.`);
  }

  const expectedGoogle = process.env.GOOGLE_CLOUD_PROJECT?.trim();
  if (expectedGoogle) {
    assert(
      !manifest.development.prohibitedGoogleCloudProjectIds.includes(expectedGoogle),
      `Prohibited Production Google Cloud project selected: ${expectedGoogle}.`,
    );
    let configured;
    try {
      configured = output('gcloud', ['config', 'get-value', 'project']);
    } catch {
      throw new Error('GOOGLE_CLOUD_PROJECT is set but the authenticated gcloud project could not be read.');
    }
    assert(configured && configured !== '(unset)', 'gcloud has no active project.');
    assert(configured === expectedGoogle, `gcloud project ${configured} does not match GOOGLE_CLOUD_PROJECT ${expectedGoogle}.`);
    google = true;
    console.log(`PASS Stage 10 Google Cloud Development target ${configured}`);
  } else {
    console.log('INFO Stage 10 target not declared. Set GOOGLE_CLOUD_PROJECT explicitly to the authenticated Development project for integrated UAT.');
  }

  if (requireIntegrations) {
    assert(shopify, `Integrated UAT requires SHOPIFY_STORE_DOMAIN=${manifest.development.shopifyStore}.`);
    assert(google, 'Integrated UAT requires an explicit, authenticated GOOGLE_CLOUD_PROJECT that is not the prohibited Production project.');
  }

  return { shopify, google };
}

async function localReadiness() {
  try {
    run('npm', ['run', 'check']);
    run('npm', ['run', 'test:emulator']);
    run('npm', ['run', 'test:e2e']);
    run('npm', ['run', 'security:scan']);
    run('npm', ['audit', '--omit=dev', '--audit-level=high']);
    await verifyStages();
    run('node', [resolve(packageRoot, 'performance-budget.mjs')]);
  } finally {
    cleanupGeneratedArtifacts();
  }
}

function recordSuccessfulInstallation(integrations) {
  for (const stage of manifest.stages) {
    if (stage.id === '09' && !integrations.shopify) continue;
    if (stage.id === '10' && !integrations.google) continue;
    markStage(stage.id, 'complete', 'Development installation and all required gates for this stage completed.');
  }

  const integrated = integrations.shopify && integrations.google;
  markStage(
    'update',
    'complete',
    integrated
      ? `Installed ${manifest.id} v${manifest.version} to Development with integrated target gates completed.`
      : `Installed ${manifest.id} v${manifest.version} to Development for core UAT; unverified Stage 09/10 integration targets remain READY.`,
  );
}

async function installDevelopment() {
  banner();
  verifyRepository();
  runPackageAudit();
  verifyToolchain();
  verifyDevelopmentEnvironment();
  verifyCleanTree();
  assert(!process.env.APPWRITE_API_KEY?.trim(), 'APPWRITE_API_KEY must be unset. This installer does not create or depend on a persistent Appwrite API key.');
  assert(process.env.APPWRITE_SEED_PASSWORD?.trim(), 'APPWRITE_SEED_PASSWORD is required for the mandatory seven-portal Development acceptance test.');

  await applyUpdate({ persistState: false });
  run('npm', ['run', 'format']);
  run('npm', ['run', 'appwrite:generate']);
  await verifyStages();
  run('npm', ['run', 'appwrite:validate']);

  console.log('Running all local testing-readiness gates before any Development mutation.');
  await localReadiness();
  runDiffAudit();
  const integrations = developmentIntegrationChecks();

  console.log('PASS local gates and bounded diff. Development mutation is now permitted.');
  run('npm', ['run', 'appwrite:push:development']);
  run('npm', ['run', 'appwrite:audit:development']);
  run('npm', ['run', 'appwrite:smoke:portals'], { env: { APPWRITE_CONFIRM_TEST: 'test-development' } });
  run('npm', ['run', 'appwrite:audit:development']);
  recordSuccessfulInstallation(integrations);

  console.log('PASS: Core Development installation and live seven-portal gates completed. Development is ready for structured core UAT.');
  if (integrations.shopify && integrations.google) {
    console.log('PASS: Shopify and Google Cloud Development targets are explicitly verified. Development is ready for integrated UAT.');
  } else {
    const pending = [
      ...(!integrations.shopify ? ['Stage 09 Shopify target'] : []),
      ...(!integrations.google ? ['Stage 10 Google Cloud target'] : []),
    ];
    console.log(`INFO: Integrated UAT remains pending for ${pending.join(' and ')}.`);
  }
}

async function cleanCheckoutValidation() {
  banner();
  verifyRepository();
  runPackageAudit();
  verifyToolchain();
  verifyCleanTree();
  await applyUpdate({ persistState: false });
  run('npm', ['run', 'format']);
  run('npm', ['run', 'appwrite:generate']);
  await verifyStages();
  run('npm', ['run', 'appwrite:validate']);
  await localReadiness();
  runDiffAudit();
  console.log('PASS: software update applied and fully verified without remote Development mutation.');
}

async function isolatedLocalValidation() {
  banner();
  verifyRepository();
  runPackageAudit();
  verifyToolchain();
  verifyCleanTree();

  const parent = mkdtempSync(join(tmpdir(), 'proinspect-platform-completion-'));
  const sandbox = join(parent, 'worktree');
  const head = output('git', ['rev-parse', 'HEAD']);
  let attached = false;
  try {
    run('git', ['worktree', 'add', '--detach', sandbox, head]);
    attached = true;
    run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: sandbox });
    run('node', ['infrastructure/upgrades/platform-completion-v1/upgrade.mjs', 'ci'], { cwd: sandbox });
    console.log('PASS: isolated local validation completed in a temporary Git worktree. No Development resources were mutated.');
  } finally {
    if (attached) {
      try { run('git', ['worktree', 'remove', '--force', sandbox]); } catch { /* best-effort cleanup */ }
    }
    rmSync(parent, { recursive: true, force: true });
  }
}

try {
  if (command === 'status') {
    banner();
    console.log(toolchain());
    printStageTable();
  } else if (command === 'preflight') {
    await preflight();
  } else if (command === 'apply') {
    banner();
    verifyRepository();
    runPackageAudit();
    verifyToolchain();
    verifyCleanTree();
    await applyUpdate({ persistState: false });
    console.log('PASS: source update applied. Installation state is unchanged until guarded Development installation succeeds.');
  } else if (command === 'verify') {
    await sourceVerify();
  } else if (command === 'local') {
    await isolatedLocalValidation();
  } else if (command === 'ci') {
    await cleanCheckoutValidation();
  } else if (command === 'install') {
    assert(development, 'Production/staging installation is locked. Use --development for this update.');
    await installDevelopment();
  } else {
    throw new Error(`Unknown update command '${command}'.`);
  }
} catch (error) {
  if (command === 'install') {
    markStage('update', 'failed', error instanceof Error ? error.message : String(error));
  }
  console.error(`\nUPDATE FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
