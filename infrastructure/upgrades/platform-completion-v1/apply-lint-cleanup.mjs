import { replaceOnce } from './patch-lib.mjs';

export async function applyLintCleanup() {
  replaceOnce(
    'apps/api/src/backend/remoteInspectionPortalRoutes.ts',
    "function adminApp() { return getApps()[0] ?? initializeApp({ credential: applicationDefault() }); }",
    '// Stage 2E: Firebase admin helper removed; Appwrite evidence provider is authoritative.',
    'remove orphaned remote-inspection Firebase admin helper',
  );

  replaceOnce(
    'apps/notification-worker/src/index.ts',
    "import { createHash, randomUUID } from 'node:crypto';",
    "import { createHash } from 'node:crypto';",
    'remove unused notification-worker randomUUID import',
  );
}
