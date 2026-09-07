import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { assert, manifest, packageRoot, read, root } from './lib.mjs';

const checks = [];
const check = (stage, name, fn) => checks.push({ stage, name, fn });
const exists = (path) => existsSync(resolve(root, path));

check('02d', 'external grant authority is canonical', () => {
  const deps = read('apps/api/src/security/defaultDependencies.ts');
  const provider = read('apps/api/src/backend/appwriteExternalGrantStore.ts');
  assert(deps.includes('AppwriteExternalGrantStore'), 'AppwriteExternalGrantStore is not wired.');
  assert(provider.includes("tableId: 'external_access_grants'"), 'Canonical external grant table is missing.');
});

check('02e', 'Appwrite evidence authority is canonical', () => {
  const deps = read('apps/api/src/security/defaultDependencies.ts');
  const provider = read('apps/api/src/backend/appwriteEvidenceStore.ts');
  const route = read('apps/api/src/backend/externalEvidenceCompletionRoutes.ts');
  assert(deps.includes('AppwriteEvidenceStore'), 'AppwriteEvidenceStore is not wired.');
  for (const token of ["tableId: 'upload_sessions'", "tableId: 'evidence_files'", "tableId: 'integration_outbox'", 'storage.createFile', 'createTransaction']) {
    assert(provider.includes(token), `Appwrite evidence provider is missing ${token}.`);
  }
  assert(!provider.includes('firebase-admin'), 'Appwrite evidence provider contains Firebase authority.');
  assert(route.includes('requireEvidenceStore'), 'External evidence completion is not provider-backed.');
  assert(!route.includes('FirestorePhotoEvidenceStore'), 'External evidence completion still uses FirestorePhotoEvidenceStore.');
});

check('02e', 'all external evidence scopes use the provider boundary', () => {
  const remote = read('apps/api/src/backend/remoteInspectionPortalRoutes.ts');
  const tenant = read('apps/api/src/backend/tenantPortalRoutes.ts');
  assert(remote.includes("externalResourceType: 'remote_inspection'"), 'Remote upload session scope is not remote_inspection.');
  assert(remote.includes('requireEvidenceStore'), 'Remote completion is not provider-backed.');
  assert(tenant.includes('requireEvidenceStore'), 'Tenant evidence completion is not provider-backed.');
});

check('03', 'transaction commit/rollback capability and tests exist', () => {
  const gateway = read('packages/appwrite-server/src/repositories.ts');
  for (const token of ['createTransaction', 'commitTransaction', 'rollbackTransaction']) {
    assert(gateway.includes(token), `Missing ${token}.`);
  }
  assert(read('infrastructure/appwrite/scripts/test-development-workflow.mjs').includes('rollbackTransaction'), 'Development workflow does not exercise rollback.');
});

check('04', 'client approval parity is canonical', () => {
  assert(read('apps/api/src/backend/appwriteAdapters.ts').includes("clientApprovals: 'client_approvals'"), 'clientApprovals is not mapped.');
  assert(read('infrastructure/appwrite/tables/schema.mjs').includes('client_approvals'), 'client_approvals table is missing.');
});

check('04', 'notification automation uses API grant authority', () => {
  for (const path of ['apps/notification-worker/src/index.ts', 'apps/notification-worker/src/runtime.ts']) {
    const value = read(path);
    assert(value.includes('PROINSPECT_API_BASE_URL'), `${path} does not call the internal API.`);
    assert(value.includes('x-proinspect-automation-secret'), `${path} does not authenticate internal grant issuance.`);
    assert(!value.includes('tenantPortalGrants'), `${path} still writes legacy tenantPortalGrants.`);
  }
});

check('05', 'seven required portal personas and entitlements are seeded', () => {
  const seed = read('infrastructure/appwrite/seeds/development.json');
  for (const persona of ['dev_admin', 'dev_inspector', 'dev_building_manager', 'dev_strata_manager', 'dev_resident_tenant', 'dev_client_user', 'dev_contractor']) {
    assert(seed.includes(persona), `Missing Development persona ${persona}.`);
  }
  for (const portal of ['"portalId":"admin"', '"portalId":"inspector"', '"portalId":"building"', '"portalId":"strata"', '"portalId":"resident"', '"portalId":"client"', '"portalId":"contractor"']) {
    assert(seed.includes(portal), `Missing ${portal}.`);
  }
});

check('06', 'local seven-portal acceptance is executable without GitHub Actions', () => {
  assert(exists('infrastructure/appwrite/scripts/test-seven-portals-development.mjs'), 'Missing seven-portal acceptance script.');
  const pkg = JSON.parse(read('package.json'));
  assert(pkg.scripts?.['appwrite:smoke:portals']?.includes('test-seven-portals-development.mjs'), 'Missing local appwrite:smoke:portals command.');
  const installer = read('infrastructure/upgrades/platform-completion-v1/upgrade.mjs');
  assert(installer.includes('APPWRITE_SEED_PASSWORD'), 'Installer does not gate live portal acceptance on the seed credential.');
  assert(installer.includes('appwrite:smoke:portals'), 'Installer does not execute the local seven-portal acceptance command.');
});

check('07', 'offline replay is idempotent and receipt-backed', () => {
  const offline = read('apps/web/services/offlineWorkspace.ts');
  for (const token of ['queuePhoto', 'enqueueMutation', 'detectDraftConflict', 'installReconnectSync', 'canSubmitInspection']) {
    assert(offline.includes(token), `Offline workspace lacks ${token}.`);
  }
  const coordinator = read('apps/web/services/offlineSyncCoordinator.ts');
  assert(coordinator.includes("item.operation !== 'job.patch'"), 'Offline replay does not fail closed on unsupported operations.');
  assert(coordinator.includes('operationId: item.id'), 'Offline replay does not send a stable operation ID.');
  const server = read('apps/api/src/backend/platformEnhancementRoutes.ts');
  for (const token of ["deps.idempotency.execute(", "'offline.job.patch'", "deps.repository.get('offlineSyncReceipts'", "'offlineSyncReceipts',", 'OFFLINE_OPERATION_REUSE']) {
    assert(server.includes(token), `Offline server replay is missing ${token}.`);
  }
  const schema = read('infrastructure/appwrite/tables/schema.mjs');
  assert(schema.includes("agencyEntity('offline_sync_receipts'"), 'offline_sync_receipts is missing.');
  assert(schema.includes("unique('operation_once',['agencyId','operationId'])"), 'offline_sync_receipts lacks operation idempotency.');
  assert(exists('apps/web/services/stage7OfflineContract.test.ts'), 'Stage 7 regression contract was not installed.');
});

check('08', 'migration dry-run/reconciliation framework exists', () => {
  for (const path of ['infrastructure/appwrite/migrations/framework.mjs', 'infrastructure/appwrite/migrations/framework.test.mjs', 'infrastructure/appwrite/migrations/strata-d1-manifest.mjs', 'infrastructure/appwrite/migrations/strata-d1-manifest.test.mjs']) {
    assert(exists(path), `Missing ${path}.`);
  }
});

check('09', 'Shopify Development integration contracts exist', () => {
  assert(exists('apps/api/src/backend/shopifyIntegrationRoutes.ts'), 'Missing Shopify integration routes.');
  assert(read('infrastructure/appwrite/tables/schema.mjs').includes('shopify_service_mappings'), 'Missing Shopify service mappings table.');
});

check('10', 'canonical outbox and specialist worker contracts exist', () => {
  assert(read('apps/api/src/backend/appwriteAdapters.ts').includes("tableId: 'integration_outbox'"), 'Canonical integration outbox is not used.');
  for (const worker of ['ai-worker', 'pdf-worker', 'notification-worker', 'document-worker', 'integration-worker']) {
    assert(exists(`apps/${worker}/src`), `Missing ${worker}.`);
  }
});

check('11', 'toolchain is pinned', () => {
  const pkg = JSON.parse(read('package.json'));
  assert(pkg.packageManager === `npm@${manifest.requiredToolchain.npm}`, 'npm is not pinned.');
  assert(pkg.engines?.node === '22.x', 'Node engine is not 22.x.');
  assert(read('.nvmrc').trim() === '22', '.nvmrc is not Node 22.');
});

check('12', 'security and recovery gates exist', () => {
  for (const path of ['scripts/scan-secrets.mjs', 'tests/rules/backend-boundary.test.ts', 'tests/rules/security-regressions.test.ts']) {
    assert(exists(path), `Missing ${path}.`);
  }
  const grant = read('apps/api/src/backend/appwriteExternalGrantStore.ts');
  for (const token of ['GRANT_SCOPE_MISMATCH', 'GRANT_TOKEN_REVOKED', 'GRANT_TOKEN_EXPIRED', 'AMBIGUOUS_GRANT_TOKEN']) {
    assert(grant.includes(token), `Grant fail-closed code ${token} is missing.`);
  }
});

check('13', 'performance budget verifier is installed', () => {
  assert(existsSync(resolve(packageRoot, 'performance-budget.mjs')), 'Missing performance budget verifier.');
});

export async function verifyStages() {
  let failures = 0;
  for (const item of checks) {
    try {
      await item.fn();
      console.log(`PASS ${item.stage} ${item.name}`);
    } catch (error) {
      failures += 1;
      console.error(`FAIL ${item.stage} ${item.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures) throw new Error(`${failures} Stage 2D-13 verification check(s) failed.`);
  console.log(`PASS: ${checks.length} Stage 2D-13 source readiness checks.`);
}
