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

  it('defines an idempotent canonical server receipt table', () => {
    const schema = read('infrastructure/appwrite/tables/schema.mjs');
    expect(schema).toContain("agencyEntity('offline_sync_receipts'");
    expect(schema).toContain("unique('operation_once',['agencyId','operationId'])");
    expect(schema).toContain("str('payloadHash',64,true)");
    expect(schema).toContain("integer('baseVersion')");
    expect(schema).toContain("integer('resultVersion')");
  });
});
