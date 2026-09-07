import { replaceOnce, replaceSection } from './patch-lib.mjs';

const appwriteEvidenceBytes = `  private async bytes(
    bucketId: string,
    fileId: string,
  ): Promise<Buffer> {
    const downloaded =
      await this.services.storage.getFileDownload({
        bucketId,
        fileId,
      });

    return Buffer.from(downloaded);
  }

`;

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

  replaceSection(
    'apps/api/src/backend/appwriteEvidenceStore.ts',
    '  private async bytes(',
    '  async uploadBinary(',
    appwriteEvidenceBytes,
    'normalize Appwrite evidence download to Buffer.from(ArrayBuffer)',
  );
}
