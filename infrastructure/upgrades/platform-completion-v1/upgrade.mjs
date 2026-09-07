import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
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

function banner() {
  console.log(`ProInspect ${manifest.id} v${manifest.version}`);
  console.log(`Baseline ${manifest.baselineCommit}`);
}

function verifyRepository() {
  assert(existsSync(resolve(root, '.git')), 'Run this update from the ProInspect repository root.');
  const repository = output('git', ['remote', 'get-url', 'origin']);
  assert(repository.includes('ProInspect-Report-Creation-App'), `Unexpected git origin: ${repository}`);
  const head = output('git', ['rev-parse', 'HEAD']);
  const baseline = output('git', ['merge-base', manifest.baselineCommit, head]);
  assert(baseline === manifest.baselineCommit, `Current HEAD does not contain required baseline ${manifest.baselineCommit}.`);
}

async function preflight() {
  banner();
  verifyRepository();
  const versions = verifyToolchain();
  if (development) verifyDevelopmentEnvironment();
  console.log('PASS repository origin and Stage 2D baseline');
  console.log(`PASS Node ${versions.node}, npm ${versions.npm}, Appwrite CLI ${versions.appwrite}`);
  if (development) console.log(`PASS Development target ${manifest.development.projectId}`);
}

async function sourceVerify() {
  banner();
  verifyRepository();
  await verifyStages();
  run('node', [resolve(packageRoot, 'performance-budget.mjs')]);
}

function optionalDevelopmentIntegrationChecks() {
  const shop = process.env.SHOPIFY_STORE_DOMAIN?.trim() || process.env.SHOPIFY_SHOP_DOMAIN?.trim();
  if (shop) {
    assert(/proinspect-2\.myshopify\.com$/iu.test(shop), `Unexpected Shopify store for Development integration: ${shop}`);
    console.log(`PASS Stage 09 Shopify Development bridge target ${shop}`);
  } else {
    console.log('INFO Stage 09 live Shopify bridge check skipped because SHOPIFY_STORE_DOMAIN is not set.');
  }

  const gcp = process.env.GOOGLE_CLOUD_PROJECT?.trim();
  if (gcp) {
    const configured = output('gcloud', ['config', 'get-value', 'project']);
    assert(configured === gcp, `gcloud project ${configured} does not match GOOGLE_CLOUD_PROJECT ${gcp}.`);
    console.log(`PASS Stage 10 Google Cloud Development project ${gcp}`);
  } else {
    console.log('INFO Stage 10 live Google Cloud check skipped because GOOGLE_CLOUD_PROJECT is not set.');
  }
}

async function localReadiness() {
  run('npm', ['run', 'check']);
  run('npm', ['run', 'test:emulator']);
  run('npm', ['run', 'test:e2e']);
  run('npm', ['run', 'security:scan']);
  run('npm', ['audit', '--omit=dev', '--audit-level=high']);
}

async function installDevelopment() {
  banner();
  verifyRepository();
  verifyToolchain();
  verifyDevelopmentEnvironment();
  verifyCleanTree();

  await applyUpdate({ persistState: true });
  run('npm', ['run', 'format']);
  run('npm', ['run', 'appwrite:generate']);
  await verifyStages();
  run('npm', ['run', 'appwrite:validate']);
  run('npm', ['run', 'appwrite:push:development']);
  run('npm', ['run', 'appwrite:audit:development']);

  if (process.env.APPWRITE_API_KEY?.trim() && process.env.APPWRITE_SEED_PASSWORD?.trim()) {
    run('npm', ['run', 'appwrite:seed:development'], { env: { APPWRITE_CONFIRM_SEED: 'seed-development' } });
  } else {
    console.log('INFO Development re-seed skipped: no explicit temporary APPWRITE_API_KEY + APPWRITE_SEED_PASSWORD pair was supplied.');
  }

  if (process.env.APPWRITE_SEED_PASSWORD?.trim()) {
    run('node', ['infrastructure/appwrite/scripts/test-seven-portals-development.mjs'], { env: { APPWRITE_CONFIRM_TEST: 'test-development' } });
  } else {
    console.log('INFO Stage 06 live seven-persona acceptance skipped locally because APPWRITE_SEED_PASSWORD is not set; GitHub Actions can run it from the repository secret.');
  }

  optionalDevelopmentIntegrationChecks();
  await localReadiness();
  await verifyStages();
  run('node', [resolve(packageRoot, 'performance-budget.mjs')]);
  console.log('PASS: Stages 2D-13 source and Development installation gates completed.');
}

async function ci() {
  banner();
  verifyRepository();
  verifyToolchain();
  await applyUpdate({ persistState: false });
  run('npm', ['run', 'format']);
  run('npm', ['run', 'appwrite:generate']);
  await verifyStages();
  run('npm', ['run', 'check']);
  run('npm', ['run', 'security:scan']);
  run('node', [resolve(packageRoot, 'performance-budget.mjs')]);
  console.log('PASS: software update applied and verified in a clean CI checkout.');
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
    verifyToolchain();
    await applyUpdate({ persistState: true });
  } else if (command === 'verify') {
    await sourceVerify();
  } else if (command === 'ci') {
    await ci();
  } else if (command === 'install') {
    assert(development, 'Production/staging installation is locked. Use --development for this update.');
    await installDevelopment();
  } else {
    throw new Error(`Unknown update command '${command}'.`);
  }
} catch (error) {
  if (command === 'apply' || command === 'install' || command === 'ci') {
    markStage('update', 'failed', error instanceof Error ? error.message : String(error));
  }
  console.error(`\nUPDATE FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
