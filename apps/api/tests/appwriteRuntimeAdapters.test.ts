import { transactionFixture } from '@pcr/testing';
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
  const f = transactionFixture(); f.fault(input.failTable);
  const commits = vi.fn(); const rollbacks = vi.fn(); const deleted = vi.fn();
  const original = f.services.tables.updateTransaction.bind(f.services.tables);
  f.services.tables.updateTransaction = vi.fn(async (args: { transactionId: string; commit?: boolean; rollback?: boolean }) => {
    const result = await original(args);
    if (args.commit) commits(); if (args.rollback) rollbacks(); return result;
  }) as unknown as typeof f.services.tables.updateTransaction;
  return { value: f.services as unknown as AppwriteServerServices, rows: f.rows, commits, rollbacks, deleted };

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

  it('rolls back an idempotency reservation when the governed action fails', async () => {
    const fixture = services();
    const store = new AppwriteIdempotencyStore(fixture.value);
    await expect(store.execute('agency-a', 'request.create', 'failed-key', 'payload-a', async () => {
      throw new Error('injected action failure');
    })).rejects.toThrow('injected action failure');
    expect(fixture.deleted).not.toHaveBeenCalled();
    expect(fixture.rollbacks).toHaveBeenCalledOnce();
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
      .rejects.toThrow('injected 500');
    expect(fixture.commits).not.toHaveBeenCalled();
    expect(fixture.rollbacks).toHaveBeenCalledOnce();
  });
});
