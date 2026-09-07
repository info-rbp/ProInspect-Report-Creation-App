import { assert, output, run } from './lib.mjs';

const allowed = new Set([
  'apps/api/src/backend/appwriteEvidenceStore.ts',
  'apps/api/src/backend/firestoreEvidenceStore.ts',
  'apps/api/src/backend/externalEvidenceCompletionRoutes.ts',
  'apps/api/src/backend/types.ts',
  'apps/api/src/backend/runtimeDependencyGuards.ts',
  'packages/appwrite-server/src/index.ts',
  'apps/api/src/security/defaultDependencies.ts',
  'packages/domain/src/photoEvidence.ts',
  'apps/api/src/backend/integrations.ts',
  'infrastructure/appwrite/tables/schema.mjs',
  'infrastructure/appwrite/tables/schema.test.mjs',
  'infrastructure/appwrite/tables/tables.json',
  'apps/api/src/backend/externalEvidenceRoutes.ts',
  'apps/web/services/platform/externalEvidenceUploadService.ts',
  'apps/api/src/backend/tenantPortalRoutes.ts',
  'apps/web/services/platform/tenantPortalService.ts',
  'apps/api/src/backend/remoteInspectionPortalRoutes.ts',
  'apps/web/pages/external/RemoteInspectionPage.tsx',
  'tests/emulator/externalEvidence.emulator.test.ts',
  'apps/api/tests/stage2eProviderBoundary.test.ts',
  'apps/api/src/backend/appwriteAdapters.ts',
  'apps/notification-worker/src/index.ts',
  'apps/notification-worker/src/runtime.ts',
  'apps/api/tests/stage4RuntimeParity.test.ts',
  'apps/api/src/backend/platformEnhancementRoutes.ts',
  'apps/web/services/offlineSyncCoordinator.ts',
  'apps/web/services/stage7OfflineContract.test.ts',
]);

const required = [
  'apps/api/src/backend/appwriteEvidenceStore.ts',
  'apps/api/src/backend/externalEvidenceCompletionRoutes.ts',
  'apps/api/src/backend/appwriteAdapters.ts',
  'apps/api/src/backend/platformEnhancementRoutes.ts',
  'apps/web/services/offlineSyncCoordinator.ts',
  'infrastructure/appwrite/tables/schema.mjs',
  'infrastructure/appwrite/tables/tables.json',
  'apps/api/tests/stage2eProviderBoundary.test.ts',
  'apps/api/tests/stage4RuntimeParity.test.ts',
  'apps/web/services/stage7OfflineContract.test.ts',
];

run('git', ['diff', '--check']);

const status = output('git', ['status', '--porcelain']);
const changed = status
  ? status.split('\n').filter(Boolean).map((line) => {
      const path = line.slice(3).trim();
      return path.includes(' -> ') ? path.split(' -> ').at(-1) : path;
    })
  : [];

const unexpected = changed.filter((path) => !allowed.has(path));
assert(
  unexpected.length === 0,
  `Update changed files outside the declared installation surface:\n${unexpected.join('\n')}`,
);

const missing = required.filter((path) => !changed.includes(path));
assert(
  missing.length === 0,
  `Update did not produce required source changes:\n${missing.join('\n')}`,
);

console.log(`PASS bounded update diff: ${changed.length} changed file(s), all within the declared installation surface.`);
