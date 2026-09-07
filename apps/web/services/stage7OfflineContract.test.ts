import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('Stage 7 offline field operations boundary', () => {
  it('keeps durable local queues, replay hooks, conflict detection and submit gating', () => {
    const source = read('apps/web/services/offlineWorkspace.ts');
    for (const marker of [
      'openDB<WorkspaceDatabase>',
      'queuePhoto',
      'enqueueMutation',
      'detectDraftConflict',
      'installReconnectSync',
      'canSubmitInspection',
      "state: 'queued'",
    ]) {
      expect(source).toContain(marker);
    }
  });

  it('sends stable operation IDs and only replays the supported job.patch contract', () => {
    const source = read('apps/web/services/offlineSyncCoordinator.ts');
    expect(source).toContain("item.operation !== 'job.patch'");
    expect(source).toContain('operationId: item.id');
    expect(source).toContain('operation: item.operation');
    expect(source).toContain('/offline-sync');
  });

  it('persists idempotent server receipts and fails closed on operation reuse', () => {
    const source = read('apps/api/src/backend/platformEnhancementRoutes.ts');
    expect(source).toContain('deps.idempotency.execute(');
    expect(source).toContain("'offline.job.patch'");
    expect(source).toContain("deps.repository.get('offlineSyncReceipts'");
    expect(source).toContain("'offlineSyncReceipts',");
    expect(source).toContain('OFFLINE_OPERATION_REUSE');
    expect(source).toContain('OFFLINE_OPERATION_UNSUPPORTED');
    expect(source).toContain('payloadHash');
    expect(source).toContain('resultHash');
  });

  it('migrates the existing canonical receipt table to operation-level idempotency', () => {
    const schema = read('infrastructure/appwrite/tables/unified-platform-extensions.mjs');
    expect(schema).toContain("agencyEntity('offline_sync_receipts'");
    expect(schema).toContain("unique('operation_once', ['agencyId', 'operationId'])");
    expect(schema).toContain("str('inspectionJobId', 36, true)");
    expect(schema).toContain("str('operationId', 128, true)");
    expect(schema).toContain("str('operation', 64, true)");
    expect(schema).toContain("str('payloadHash', 128, true)");
    expect(schema).toContain("integer('baseVersion', true)");
    expect(schema).toContain("integer('resultVersion')");
    expect(schema).toContain("str('deviceId', 128)");
    expect(schema).toContain("str('clientSubmissionId', 128)");
    expect(schema).not.toContain("str('deviceId', 128, true)");
    expect(schema).not.toContain("str('clientSubmissionId', 128, true)");
  });
});
