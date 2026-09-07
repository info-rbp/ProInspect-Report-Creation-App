import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('Stage 2E Appwrite evidence provider boundary', () => {
  it('wires Appwrite evidence authority in Appwrite mode', () => {
    const dependencies = read('src/security/defaultDependencies.ts');
    expect(dependencies).toContain('AppwriteEvidenceStore');
    expect(dependencies).toContain('FirestoreEvidenceStore');
    expect(dependencies).toContain('evidence = new AppwriteEvidenceStore(appwrite)');
  });

  it('uses Appwrite Storage and canonical evidence tables', () => {
    const store = read('src/backend/appwriteEvidenceStore.ts');
    expect(store).toContain('storage.createFile');
    expect(store).toContain("tableId: 'upload_sessions'");
    expect(store).toContain("tableId: 'evidence_files'");
    expect(store).toContain("tableId: 'integration_outbox'");
    expect(store).toContain('createTransaction');
    expect(store).toContain('commit: true');
    expect(store).toContain('rollback: true');
    expect(store).not.toContain('firebase-admin');
    expect(store).not.toContain('firestoreDb(');
  });

  it('keeps raw binary and completion behind grant and session scope', () => {
    const route = read('src/backend/externalEvidenceCompletionRoutes.ts');
    expect(route).toContain('requireExternalGrantStore');
    expect(route).toContain('requireEvidenceStore');
    expect(route).toContain("'tenant_portal'");
    expect(route).toContain("'remote_inspection'");
    expect(route).toContain("operation === 'binary'");
    expect(route).not.toContain('FirestorePhotoEvidenceStore');
    expect(route).not.toContain('firebase-admin/storage');
  });

  it('keeps remote-inspection upload scope distinct from tenant portal', () => {
    const route = read('src/backend/remoteInspectionPortalRoutes.ts');
    expect(route).toContain("externalResourceType: 'remote_inspection'");
    expect(route).toContain('requireEvidenceStore');
    expect(route).not.toContain('FirestorePhotoEvidenceStore');
  });
});
