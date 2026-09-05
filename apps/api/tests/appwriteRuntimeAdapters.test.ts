import { describe, expect, it, vi } from 'vitest';
import type { AppwriteServerServices } from '@pcr/appwrite-server';
import type { AuthenticatedPrincipal, ReportAggregate } from '@pcr/domain';
import {
  AppwriteIdempotencyStore,
  AppwriteReportAggregateStore,
  AppwriteTaskOutbox,
  AppwriteUploadSessionIssuer,
} from '../src/backend/appwriteAdapters.js';

function services(input: { failTable?: string } = {}): {
  value: AppwriteServerServices;
  rows: Map<string, Record<string, unknown>>;
  commits: ReturnType<typeof vi.fn>;
  rollbacks: ReturnType<typeof vi.fn>;
  deleted: ReturnType<typeof vi.fn>;
} {
  const rows = new Map<string, Record<string, unknown>>();
  const commits = vi.fn();
  const rollbacks = vi.fn();
  const deleted = vi.fn();
  const tables = {
    getRow: vi.fn(async ({ tableId, rowId }: { tableId: string; rowId: string }) => {
      const row = rows.get(`${tableId}:${rowId}`);
      if (!row) throw Object.assign(new Error('not found'), { code: 404 });
      return row;
    }),
    createRow: vi.fn(async ({ tableId, rowId, data }: { tableId: string; rowId: string; data: Record<string, unknown> }) => {
      if (tableId === input.failTable) throw new Error(`injected ${tableId} failure`);
      const key = `${tableId}:${rowId}`;
      if (rows.has(key)) throw Object.assign(new Error('duplicate'), { code: 409 });
      const row = { $id: rowId, ...data };
      rows.set(key, row);
      return row;
    }),
    updateRow: vi.fn(async ({ tableId, rowId, data }: { tableId: string; rowId: string; data: Record<string, unknown> }) => {
      const key = `${tableId}:${rowId}`;
      const row = { ...rows.get(key), ...data };
      rows.set(key, row);
      return row;
    }),
    deleteRow: vi.fn(async ({ tableId, rowId }: { tableId: string; rowId: string }) => {
      deleted(tableId, rowId);
      rows.delete(`${tableId}:${rowId}`);
      return {};
    }),
    createTransaction: vi.fn(async () => ({ $id: 'transaction-1' })),
    updateTransaction: vi.fn(async ({ commit, rollback }: { commit?: boolean; rollback?: boolean }) => {
      if (commit) commits();
      if (rollback) rollbacks();
      return {};
    }),
  };
  return {
    value: { tables, databaseId: 'proinspect_core' } as unknown as AppwriteServerServices,
    rows,
    commits,
    rollbacks,
    deleted,
  };
}

describe('Appwrite runtime adapters', () => {
  it('persists and replays idempotent results without re-running the action', async () => {
    const fixture = services();
    const store = new AppwriteIdempotencyStore(fixture.value);
    const action = vi.fn(async () => ({ status: 201, body: { id: 'request-1' } }));

    await expect(store.execute('agency-a', 'request.create', 'client-key', 'payload-a', action))
      .resolves.toMatchObject({ replayed: false, result: { status: 201 } });
    await expect(store.execute('agency-a', 'request.create', 'client-key', 'payload-a', action))
      .resolves.toEqual({ replayed: true, result: { status: 201, body: { id: 'request-1' } } });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('removes an idempotency reservation when the governed action fails', async () => {
    const fixture = services();
    const store = new AppwriteIdempotencyStore(fixture.value);
    await expect(store.execute('agency-a', 'request.create', 'failed-key', 'payload-a', async () => {
      throw new Error('injected action failure');
    })).rejects.toThrow('injected action failure');
    expect(fixture.deleted).toHaveBeenCalledOnce();
    expect([...fixture.rows.keys()].filter((key) => key.startsWith('idempotency_keys:'))).toHaveLength(0);
  });

  it('writes specialist work to the Appwrite integration outbox', async () => {
    const fixture = services();
    await new AppwriteTaskOutbox(fixture.value).dispatch('pdf', 'agency-a', 'task-1', { reportId: 'report-1' });
    expect(fixture.rows.get('integration_outbox:task-1')).toMatchObject({
      agencyId: 'agency-a', eventType: 'pdf.requested', entityType: 'pdf', deliveryStatus: 'pending',
    });
  });

  it('creates a deny-by-default Appwrite upload-session record', async () => {
    const fixture = services();
    const principal = { uid: 'user-a', agencyId: 'agency-a' } as AuthenticatedPrincipal;
    const result = await new AppwriteUploadSessionIssuer(fixture.value).create('agency-a', 'upload-1', {
      fileName: 'photo.png', contentType: 'image/png', size: 12, sha256: 'a'.repeat(64), propertyId: 'property-a',
    }, principal);
    expect(result).toMatchObject({ id: 'upload-1', uploadProvider: 'appwrite', status: 'awaiting_binary' });
    expect(fixture.rows.get('upload_sessions:upload-1')).toMatchObject({
      agencyId: 'agency-a', userId: 'user-a', bucketId: 'inspection-evidence', propertyId: 'property-a',
    });
  });

  it('rolls back an Appwrite report transaction when a related write fails', async () => {
    const fixture = services({ failTable: 'reports' });
    const aggregate = {
      report: {
        id: 'report-1', agencyId: 'agency-a', reportType: 'routine', propertyAddress: '1 Test Street',
        lifecycleStatus: 'draft', propertyId: 'property-a',
      },
      areas: [],
    } satisfies ReportAggregate;
    await expect(new AppwriteReportAggregateStore(fixture.value).saveDraft(aggregate, undefined, 'user-a'))
      .rejects.toThrow('injected reports failure');
    expect(fixture.commits).not.toHaveBeenCalled();
    expect(fixture.rollbacks).toHaveBeenCalledOnce();
  });
});
