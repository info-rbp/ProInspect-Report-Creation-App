import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tables } from '../../appwrite/tables/schema.mjs';
import { unifiedPlatformExtensionTables } from '../../appwrite/tables/unified-platform-extensions.mjs';
import { manifest, nextStageState, packageRoot, root } from './lib.mjs';
import { auditPersonaPreparer } from './persona-contract.mjs';
import { developmentIntegrationChecks } from './integration-checks.mjs';
import { buildPortalFixturePlan } from './payload/development-portal-fixtures.mjs';

const failures = [];
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
};
const packageHas = (path) => existsSync(resolve(packageRoot, path));
const packageText = (path) => readFileSync(resolve(packageRoot, path), 'utf8');

console.log(`ProInspect ${manifest.id} v${manifest.version} package audit`);

const expectedStages = ['02d','02e','03','04','05','06','07','08','09','10','11','12','13'];
check(JSON.stringify(manifest.stages.map((stage) => stage.id)) === JSON.stringify(expectedStages), 'manifest covers Stage 2D through Stage 13 in order');
check(manifest.baselineCommit === '030d2650870f09556e72b7aebb58a4bec2a7a75f', 'Stage 2D baseline commit is pinned');
check(manifest.targetSchemaTables === 120, 'target Appwrite schema is pinned to 120 tables');
check(manifest.localValidationRequired === true, 'local validation is mandatory');
check(manifest.development?.projectId === 'proinspect-development', 'Development Appwrite target is pinned');
check(manifest.development?.shopifyStore === 'proinspect-2.myshopify.com', 'Development Shopify store is pinned');
check(manifest.development?.prohibitedProjectIds?.includes('6a911f1e0031e90015b2'), 'legacy Appwrite project is prohibited');
check(manifest.development?.prohibitedGoogleCloudProjectIds?.includes('business-plan-applicatio-17047'), 'documented Production Google Cloud project is prohibited');

const sourceTables = [...tables, ...unifiedPlatformExtensionTables];
const sourceIds = sourceTables.map((table) => table.$id);
const duplicateTableIds = [...new Set(sourceIds.filter((id, index) => sourceIds.indexOf(id) !== index))];
check(
  duplicateTableIds.length === 0 && new Set(sourceIds).size === sourceIds.length,
  duplicateTableIds.length
    ? `canonical Appwrite source table IDs are unique (duplicates: ${duplicateTableIds.join(', ')})`
    : 'canonical Appwrite source table IDs are unique',
);
const fixtureSeed = JSON.parse(readFileSync(resolve(root, 'infrastructure/appwrite/seeds/development.json'), 'utf8'));
const fixturePlan = buildPortalFixturePlan(fixtureSeed, fixtureSeed.identities.filter(([id]) => fixtureSeed.portalEntitlements.some((item) => item.userId === id)));
for (const fixture of fixturePlan) {
  const columns = new Map(sourceTables.find((table) => table.$id === fixture.tableId)?.columns.map((column) => [column.key, column]) ?? []);
  const valid = Object.entries(fixture.data).every(([key, value]) => columns.has(key) && (!columns.get(key).elements || columns.get(key).elements.includes(value)))
    && [...columns.values()].every((column) => !column.required || fixture.data[column.key] !== undefined || ['createdAt', 'updatedAt'].includes(column.key));
  check(valid, `synthetic fixture ${fixture.tableId}/${fixture.rowId} matches source columns and required fields`);
}

for (const stage of manifest.stages) {
  check(['baseline','migration','verified-existing','closure'].includes(stage.completionMode), `Stage ${stage.id} has an explicit completion mode`);
}

for (const path of [
  'manifest.json','README.md','lib.mjs','patch-lib.mjs','apply.mjs','apply-02e-v2.mjs','apply-04-v2.mjs','apply-07.mjs','apply-07-live-schema-fix.mjs','apply-lint-cleanup.mjs','stage-verification.mjs','performance-budget.mjs','package-audit.mjs','diff-audit.mjs','upgrade.mjs',
  'payload/appwriteEvidenceStore.ts','payload/firestoreEvidenceStore.ts','payload/externalEvidenceCompletionRoutes.ts','payload/stage2eProviderBoundary.test.ts','payload/stage4RuntimeParity.test.ts','payload/stage7OfflineContract.test.ts','payload/prepare-seven-portals-development.mjs',
]) check(packageHas(path), `package contains ${path}`);

check(!packageHas('apply-02e.mjs') && !packageHas('apply-04.mjs'), 'superseded patchers are absent');
for (const path of ['persona-contract.mjs', 'integration-checks.mjs', 'payload/development-portal-fixtures.mjs']) check(packageHas(path), `package contains ${path}`);

const apply = packageText('apply.mjs');
check(apply.includes('development-portal-fixtures.mjs'), 'installer installs the synthetic portal fixture planner');
for (const marker of ["./apply-02e-v2.mjs","./apply-04-v2.mjs","./apply-07.mjs","./apply-07-live-schema-fix.mjs","./apply-lint-cleanup.mjs","applyStage07LiveSchemaFix()","applyLintCleanup()","stage2eProviderBoundary.test.ts","stage4RuntimeParity.test.ts","stage7OfflineContract.test.ts","prepare-seven-portals-development.mjs"]) {
  check(apply.includes(marker), `apply sequence contains ${marker}`);
}

const personaPreparer = packageText('payload/prepare-seven-portals-development.mjs');
await auditPersonaPreparer(personaPreparer, check);

const lintCleanup = packageText('apply-lint-cleanup.mjs');
for (const marker of [
  'remoteInspectionPortalRoutes.ts',
  'Firebase admin helper removed',
  'notification-worker/src/index.ts',
  "import { createHash } from 'node:crypto';",
  'apps/api/src/backend/appwriteEvidenceStore.ts',
  'return Buffer.from(downloaded);',
  'normalize Appwrite evidence download to Buffer.from(ArrayBuffer)',
]) {
  check(lintCleanup.includes(marker), `lint/type cleanup contains ${marker}`);
}

const stage2eContract = packageText('payload/stage2eProviderBoundary.test.ts');
check(stage2eContract.includes("expect(store).toContain('return Buffer.from(downloaded);')"), 'Stage 2E regression requires direct Buffer conversion for Appwrite downloads');
check(stage2eContract.includes("expect(store).not.toContain('ArrayBuffer.isView(downloaded)')"), 'Stage 2E regression rejects impossible ArrayBuffer view narrowing branch');
check(stage2eContract.includes("expect(store).not.toContain('downloaded.buffer')"), 'Stage 2E regression rejects downloaded.buffer access');
check(stage2eContract.includes("it('preserves external grant provenance in Firestore rollback mode'"), 'Stage 2E regression guards Firestore external grant provenance');

const firestoreEvidenceStore = packageText('payload/firestoreEvidenceStore.ts');
for (const marker of [
  'externalGrantId?: string',
  'externalGrantId: value.externalGrantId',
  'externalGrantId: session.externalGrantId',
]) {
  check(firestoreEvidenceStore.includes(marker), `Firestore evidence rollback provider preserves ${marker}`);
}

const stage4Contract = packageText('payload/stage4RuntimeParity.test.ts');
for (const marker of [
  "parts[2] === 'internal'",
  "parts[3] === 'tenant-portal-grants'",
  "parts[4] === 'automation'",
  "req.method === 'POST'",
  'return automationGrant(req, dependencies, correlationId)',
  '/api/v1/internal/tenant-portal-grants/automation',
]) {
  check(stage4Contract.includes(marker), `Stage 4 regression contains ${marker}`);
}
check(!stage4Contract.includes("expect(portal).toContain('/tenant-portal-grants')"), 'Stage 4 regression does not require a slash-prefixed literal from the segmented router');

const stage07 = packageText('apply-07.mjs');
for (const marker of [
  'unified-platform-extensions.mjs',
  "agencyEntity('offline_sync_receipts'",
  "unique('operation_once', ['agencyId', 'operationId'])",
  "str('inspectionJobId', 36, true)",
  "str('operationId', 128, true)",
  "integer('baseVersion', true)",
  'operationId: item.id',
  "deps.idempotency.execute(",
  "'offlineSyncReceipts',",
  'OFFLINE_OPERATION_REUSE',
]) {
  check(stage07.includes(marker), `Stage 7 package contains ${marker}`);
}
check(!stage07.includes("'expect(allTables).toHaveLength(121);'"), 'Stage 7 does not inflate the schema to 121 tables');

const stage07Live = packageText('apply-07-live-schema-fix.mjs');
for (const marker of [
  'intermediateOfflineReceiptTable',
  'appwriteCompatibleOfflineReceiptTable',
  "{ ...str('userId', 36), default: null }",
  "{ ...str('deviceId', 128), default: null }",
  "{ ...str('clientSubmissionId', 128), default: null }",
  "{ ...str('entityType', 64), default: null }",
  "{ ...str('syncState', 32), default: null }",
  "{ ...integer('attempts'), default: null }",
  "{ ...datetime('firstReceivedAt'), default: null }",
  'offline receipt Appwrite update defaults',
]) {
  check(stage07Live.includes(marker), `Stage 7 live schema compatibility contains ${marker}`);
}

const stage7Contract = packageText('payload/stage7OfflineContract.test.ts');
check(readFileSync(resolve(root, 'vitest.config.ts'), 'utf8').includes('apps/web/services/**/*.test.ts'), 'Vitest discovers Stage 7 and report-index service regression tests');
check(stage7Contract.includes("'userId'"), 'Stage 7 regression checks legacy userId update compatibility');
check(stage7Contract.includes("'deviceId'"), 'Stage 7 regression checks legacy deviceId update compatibility');
check(stage7Contract.includes("'clientSubmissionId'"), 'Stage 7 regression checks legacy clientSubmissionId update compatibility');
check(stage7Contract.includes("'entityType'"), 'Stage 7 regression checks legacy entityType update compatibility');
check(stage7Contract.includes("'syncState'"), 'Stage 7 regression checks legacy syncState update compatibility');
check(stage7Contract.includes("'attempts'"), 'Stage 7 regression checks legacy attempts update compatibility');
check(stage7Contract.includes("'firstReceivedAt'"), 'Stage 7 regression checks legacy firstReceivedAt update compatibility');
check(stage7Contract.includes('default: null'), 'Stage 7 regression requires null defaults for relaxed live Appwrite columns');

const rootPackage = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
for (const script of ['appwrite:smoke:portals','upgrade:status','upgrade:preflight','upgrade:apply','upgrade:verify','upgrade:audit','upgrade:local','upgrade:install']) {
  check(Boolean(rootPackage.scripts?.[script]), `root package exposes ${script}`);
}

const eslintConfig = readFileSync(resolve(root, 'eslint.config.js'), 'utf8');
check(
  eslintConfig.includes("'infrastructure/upgrades/platform-completion-v1/apply-02e-v2.mjs'")
    && eslintConfig.includes("'infrastructure/upgrades/platform-completion-v1/apply-04-v2.mjs'")
    && eslintConfig.includes("'no-useless-escape': 'off'"),
  'nested source-generator escape lint exception is path-scoped to Stage 2E/4 patchers',
);

const diffAudit = packageText('diff-audit.mjs');
check(diffAudit.includes("output('git', ['diff', '--name-only'])"), 'bounded diff audit reads tracked filenames directly');
check(diffAudit.includes("output('git', ['ls-files', '--others', '--exclude-standard'])"), 'bounded diff audit reads untracked filenames directly');
check(!diffAudit.includes("line.slice(3)"), 'bounded diff audit does not parse trimmed porcelain status with fixed offsets');
check(!diffAudit.includes('const required = ['), 'bounded diff audit does not require already-correct files to be modified again');
check(!diffAudit.includes('Update did not produce required source changes'), 'bounded diff audit accepts idempotent partial or no-op re-application');
check(diffAudit.includes('stage-verification.mjs before this bounded-diff gate runs'), 'bounded diff audit delegates required final-state validation to stage verification');
check(diffAudit.includes('infrastructure/appwrite/scripts/prepare-seven-portals-development.mjs'), 'bounded diff audit permits the Development persona preparer');
check(diffAudit.includes('infrastructure/appwrite/scripts/development-portal-fixtures.mjs'), 'bounded diff audit permits the Development fixture planner');

const installer = packageText('upgrade.mjs');
const integrationChecks = packageText('integration-checks.mjs');
check(installer.includes("'worktree', 'add', '--detach'"), 'isolated local validation uses a temporary Git worktree');
const checkIndex = installer.indexOf("run('npm', ['run', 'check'])");
const pushIndex = installer.indexOf("run('npm', ['run', 'appwrite:push:development'])");
const firstAuditIndex = installer.indexOf("run('npm', ['run', 'appwrite:audit:development'])", pushIndex);
const prepareIndex = installer.indexOf("prepare-seven-portals-development.mjs");
const smokeIndex = installer.indexOf("run('npm', ['run', 'appwrite:smoke:portals']");
check(checkIndex >= 0 && pushIndex >= 0 && checkIndex < pushIndex, 'local check is ordered before Appwrite Development push');
check(firstAuditIndex > pushIndex && prepareIndex > firstAuditIndex && smokeIndex > prepareIndex, 'Development persona preparation runs after the first live audit and before seven-portal smoke');
check(installer.includes('await localReadiness();\n  runDiffAudit();'), 'final-state readiness verification runs before bounded diff audit');
check(installer.includes('diff-audit.mjs'), 'installer invokes the bounded source diff audit');
check(installer.includes('APPWRITE_API_KEY must be unset'), 'installer rejects Appwrite API keys');
check(installer.includes('APPWRITE_SEED_PASSWORD is required'), 'installer requires seven-portal acceptance credential');
check(integrationChecks.includes('prohibitedGoogleCloudProjectIds'), 'installer enforces prohibited Google Cloud targets');
check(installer.includes('requireIntegrations'), 'installer supports strict integrated-UAT target enforcement');
check(installer.includes("stage.id === '09' && !integrations.shopify"), 'Stage 09 remains pending until Shopify target verification');
check(installer.includes("stage.id === '10' && !integrations.google"), 'Stage 10 remains pending until Google target verification');
const declarations = { SHOPIFY_STORE_DOMAIN: 'proinspect-2.myshopify.com', GOOGLE_CLOUD_PROJECT: 'synthetic-development-fixture' };
const integrationOptions = { env: declarations, readProject: () => declarations.GOOGLE_CLOUD_PROJECT, log: () => {} };
const declared = developmentIntegrationChecks(integrationOptions);
check(!declared.shopify && !declared.google, 'target declarations cannot mark integrations complete');
for (const [label, options] of [
  ['strict integrated UAT without live evidence', { ...integrationOptions, requireIntegrations: true }],
  ['prohibited Google project', { env: { GOOGLE_CLOUD_PROJECT: 'business-plan-applicatio-17047' } }],
  ['mismatched Google project', { ...integrationOptions, readProject: () => 'different-project' }],
  ['wrong Shopify store', { env: { SHOPIFY_STORE_DOMAIN: 'other.myshopify.com' } }],
  ['conflicting Shopify aliases', { env: { ...declarations, SHOPIFY_SHOP_DOMAIN: 'other.myshopify.com' } }],
]) {
  let rejected = false;
  try { developmentIntegrationChecks(options); } catch { rejected = true; }
  check(rejected, `integration guards reject ${label}`);
}
const pending = nextStageState({ completed: ['09', '10'], failed: ['09'] }, '09', 'ready');
check(!pending.completed.includes('09') && !pending.failed.includes('09') && pending.completed.includes('10'), 'READY clears stale completion and failure only for the selected stage');
const failed = nextStageState({ completed: ['05'], failed: [] }, '05', 'failed');
check(!failed.completed.includes('05') && failed.failed.includes('05'), 'a failed stage cannot retain stale COMPLETE status');
check(!apply.includes('markStage'), 'source application cannot record live acceptance');
check(installer.includes('await verifyIdempotentApplication()'), 'isolated validation requires byte-identical installer reapplication');

const workflow = readFileSync(resolve(root, '.github/workflows/platform-completion-update.yml'), 'utf8');
check(workflow.includes('workflow_dispatch:') && !workflow.includes('\n  push:'), 'optional GitHub Actions validation is manual-only');

check(existsSync(resolve(root, 'infrastructure/appwrite/scripts/test-seven-portals-development.mjs')), 'local seven-portal acceptance script exists');
check(existsSync(resolve(root, 'apps/web/services/offlineWorkspace.ts')), 'offline workspace implementation exists');
check(existsSync(resolve(root, 'apps/web/services/offlineSyncCoordinator.ts')), 'offline replay coordinator exists');

if (failures.length) {
  console.error(`PACKAGE AUDIT FAILED: ${failures.length} issue(s).`);
  process.exitCode = 1;
} else {
  console.log('PACKAGE AUDIT PASS: installer media is structurally complete for Stages 2D-13.');
}
