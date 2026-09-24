import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { transactionFixture } from '@pcr/testing';
import { workerSchema, type AppwriteServerServices } from '@pcr/appwrite-server';
import { AppwriteAuditWriter, AppwriteIdempotencyStore, AppwriteOperationalRepository, AppwriteTaskOutbox } from '../src/backend/appwriteAdapters.js';
import { routeAtomicCommandRequest } from '../src/backend/atomicCommandRoutes.js';
import type { ApiDependencies } from '../src/backend/types.js';

function fixture() {
  const f = transactionFixture(workerSchema); const services = f.services as unknown as AppwriteServerServices;
  const repository = new AppwriteOperationalRepository(services);
  const deps = { requireAppCheck: false, identityVerifier: { verifyIdentityToken: async () => ({ uid: 'admin-a', agencyId: 'a', authTime: 1, issuedAt: 1, mfaVerified: true }), verifyAppCheckToken: async () => undefined }, memberships: { getMembership: async () => ({ uid: 'admin-a', agencyId: 'a', role: 'proinspect_admin', status: 'active', mfaRequired: true, updatedAt: '2026-01-01T00:00:00Z' }) }, repository, audit: new AppwriteAuditWriter(services), idempotency: new AppwriteIdempotencyStore(services), tasks: new AppwriteTaskOutbox(services) } as ApiDependencies;
  const seed = (table: string, id: string, data: Record<string, unknown>) => f.rows.set(`${table}:${id}`, { $id: id, agencyId: 'a', status: 'active', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...data });
  const request = (command: string, body: Record<string, unknown>, key = 'stable-command-key') => {
    const req = Object.assign(Readable.from([JSON.stringify({ expectedVersion: Date.parse('2026-01-01T00:00:00Z'), ...body })]), { url: `/api/v1/commands/${command}`, method: 'POST', socket: { remoteAddress: '127.0.0.1' }, headers: { authorization: 'Bearer synthetic', 'x-agency-id': 'a', 'idempotency-key': key } });
    return routeAtomicCommandRequest(req as unknown as IncomingMessage, deps, 'test-correlation');
  };
  return { ...f, seed, request, deps };
}
const business = (f: ReturnType<typeof fixture>) => [...f.rows.entries()].filter(([key, row]) => !key.startsWith('audit_events:') || String(row.action).startsWith('command.'));
describe('atomic Appwrite command execution', () => {
  it('approves quote, creates work order/approval, appends audit and outbox once across replay', async () => {
    const f = fixture(); f.seed('operational_quotes', 'q', { managedSiteId: 'site', contractorId: 'c', scope: 'Repair', status: 'submitted' });
    await f.request('quote-approve', { id: 'q', actorId: 'spoofed' }); const before = business(f);
    await expect(f.request('quote-approve', { id: 'q', actorId: 'spoofed' })).resolves.toMatchObject({ headers: { 'idempotency-replayed': 'true' } });
    expect(business(f)).toEqual(before);
    expect([...f.rows.values()].find((r) => r.action === 'command.quote-approve')).toMatchObject({ actorUserId: 'admin-a' });
    expect([...f.rows.keys()].filter((k) => k.startsWith('operational_work_orders:'))).toHaveLength(1);
    expect([...f.rows.keys()].filter((k) => k.startsWith('integration_outbox:'))).toHaveLength(1);
  });
  it.each(['operational_work_orders', 'operational_approvals', 'operational_quotes', 'integration_outbox'])('fault at %s leaves no partial business state or receipt', async (table) => {
    const f = fixture(); f.seed('operational_quotes', 'q', { managedSiteId: 'site', contractorId: 'c', scope: 'Repair', status: 'submitted' }); const before = business(f);
    f.fault(table); await expect(f.request('quote-approve', { id: 'q' })).rejects.toThrow('injected 500'); expect(business(f)).toEqual(before);
  });
  it('concurrent identical commands retry conflicts and replay the committed receipt', async () => {
    const f = fixture(); f.seed('incidents', 'i', { managedSiteId: 'site', status: 'open', incidentType: 'damage', severity: 'low', occurredAt: '2026-01-01T00:00:00Z', description: 'Synthetic' });
    const body = { id: 'i', title: 'Follow up', dueAt: '2026-10-01T00:00:00Z' };
    await Promise.all([f.request('incident-follow-up', body), f.request('incident-follow-up', body)]);
    expect([...f.rows.keys()].filter((k) => k.startsWith('tasks:'))).toHaveLength(1); expect(f.stats().rollbacks).toBeGreaterThan(0);
  });
  it('custody issue/return creates history atomically and denies a holder from another site', async () => {
    const f = fixture(); f.seed('key_register', 'k', { managedSiteId: 'site', description: 'Test key', custodyStatus: 'available' });
    await expect(f.request('key-issue', { id: 'k', holderId: 'foreign' })).rejects.toThrow('membership');
    f.seed('site_memberships', 'membership', { userId: 'holder', managedSiteId: 'site', role: 'inspector' });
    await f.request('key-issue', { id: 'k', holderId: 'holder' });
    const current = await f.deps.repository.get('keyRegister', 'a', 'k');
    await f.request('key-return', { id: 'k', expectedVersion: current!.version }, 'return-key-command');
    expect(f.rows.get('key_register:k')?.currentHolderId).toBeNull();
    expect([...f.rows.keys()].filter((k) => k.startsWith('key_transactions:'))).toHaveLength(2);
  });
  it('denies foreign agencies and rejects changed payload replay', async () => {
    const f = fixture(); f.seed('operational_quotes', 'q', { agencyId: 'b', managedSiteId: 'site', contractorId: 'c', scope: 'Repair', status: 'submitted' });
    await expect(f.request('quote-approve', { id: 'q' })).rejects.toThrow('not found');
    f.rows.get('operational_quotes:q')!.agencyId = 'a'; await f.request('quote-approve', { id: 'q' });
    await expect(f.request('quote-approve', { id: 'q', reason: 'changed' })).rejects.toThrow('different request');
  });
});
