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
  'infrastructure/appwrite/tables/unified-platform-extensions.mjs',
  'infrastructure/appwrite/tables/schema.test.mjs',
  'infrastructure/appwrite/tables/tables.json',
  'infrastructure/appwrite/scripts/prepare-seven-portals-development.mjs',
  'infrastructure/appwrite/scripts/development-portal-fixtures.mjs',
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

run('git', ['diff', '--check']);

function lines(value) {
  return value ? value.split('\n').map((line) => line.trim()).filter(Boolean) : [];
}

// Do not parse `git status --porcelain` with fixed offsets here. The shared
// output() helper trims command output, which can remove the leading status
// column and corrupt paths (for example `apps/...` becoming `pps/...`).
// Query tracked and untracked filenames directly instead.
const tracked = lines(output('git', ['diff', '--name-only']));
const untracked = lines(output('git', ['ls-files', '--others', '--exclude-standard']));
const changed = [...new Set([...tracked, ...untracked])].sort();

const unexpected = changed.filter((path) => !allowed.has(path));
assert(
  unexpected.length === 0,
  `Update changed files outside the declared installation surface:\n${unexpected.join('\n')}`,
);

// This audit intentionally does not require every historical installation
// target to appear in the current working diff. The installer is idempotent,
// so an already-applied or partially-applied feature branch may legitimately
// leave correct files untouched. Required final-state behavior is verified by
// stage-verification.mjs before this bounded-diff gate runs.
console.log(
  `PASS bounded update diff: ${changed.length} changed file(s), all within the declared installation surface; already-correct files may remain unchanged.`,
);
