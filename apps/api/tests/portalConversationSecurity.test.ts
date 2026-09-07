import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import type { ReportAggregate } from '@pcr/domain';
import { createRequestHandler } from '../src/app.js';
import { MemoryIdempotencyStore } from '../src/backend/idempotency.js';
import type { ApiDependencies, OperationalRepository, Page, ReportAggregateStore, ReportTransitionCommand, StoredRecord } from '../src/backend/types.js';

class MemoryRepository implements OperationalRepository {
  readonly records = new Map<string, StoredRecord>();
  private key(collection: string, agencyId: string, id: string) { return `${collection}:${agencyId}:${id}`; }
  async list(collection: string, agencyId: string, limit = 100, _cursor?: string, filters: Record<string, string | number | boolean> = {}): Promise<Page<StoredRecord>> { return { items: [...this.records.entries()].filter(([key]) => key.startsWith(`${collection}:${agencyId}:`)).map(([, value]) => value).filter((record) => Object.entries(filters).every(([key, value]) => record[key] === value)).slice(0, limit) }; }
  async get(collection: string, agencyId: string, id: string) { return this.records.get(this.key(collection, agencyId, id)); }
  async create(collection: string, agencyId: string, id: string, data: Record<string, unknown>, actorId: string) { const now = new Date().toISOString(); const record: StoredRecord = { ...data, id, agencyId, version: 1, createdAt: now, updatedAt: now, createdBy: actorId }; this.records.set(this.key(collection, agencyId, id), record); return record; }
  async update(collection: string, agencyId: string, id: string, data: Record<string, unknown>, expectedVersion: number, actorId: string) { const current = await this.get(collection, agencyId, id); if (!current) throw Object.assign(new Error('Not found'), { status: 404, code: 'NOT_FOUND' }); const record: StoredRecord = { ...current, ...data, version: expectedVersion + 1, updatedAt: new Date().toISOString(), updatedBy: actorId }; this.records.set(this.key(collection, agencyId, id), record); return record; }
}
class EmptyReports implements ReportAggregateStore { async load(): Promise<ReportAggregate | undefined> { return undefined; } async saveDraft(value: ReportAggregate) { return value; } async transition(_agencyId: string, _command: ReportTransitionCommand): Promise<Record<string, unknown>> { return {}; } }
function deps(repository: MemoryRepository, uid: string): ApiDependencies { return { requireAppCheck: false, identityVerifier: { verifyIdentityToken: async () => ({ uid, agencyId: 'agency-a', authTime: 1, issuedAt: 1, mfaVerified: true }), verifyAppCheckToken: async () => undefined }, memberships: { getMembership: async () => ({ uid, agencyId: 'agency-a', role: 'resident_tenant', status: 'active', mfaRequired: false, siteIds: ['site-a'], propertyIds: ['property-a'], updatedAt: new Date().toISOString() }) }, audit: { append: async () => undefined }, repository, reports: new EmptyReports(), idempotency: new MemoryIdempotencyStore(), tasks: { dispatch: async () => undefined }, uploads: { create: async (agencyId, uploadId, payload) => ({ agencyId, uploadId, ...payload }) } }; }
interface TestBody { data?: StoredRecord[]; error?: { code?: string }; [key: string]: unknown; }
async function request(dependencies: ApiDependencies, path: string): Promise<{ status: number; body: TestBody }> { const server = createServer(createRequestHandler(dependencies)).listen(0); await new Promise<void>((resolve) => server.once('listening', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing address'); try { const response = await fetch(`http://127.0.0.1:${address.port}${path}`, { headers: { authorization: 'Bearer token', 'x-agency-id': 'agency-a' } }); return { status: response.status, body: JSON.parse(await response.text()) as TestBody }; } finally { await new Promise<void>((resolve) => server.close(() => resolve())); } }
async function seed(repository: MemoryRepository, collection: string, id: string, data: Record<string, unknown>) { await repository.create(collection, 'agency-a', id, data, 'seed'); }

describe('resident conversation membership', () => {
  it('denies another resident at the same site from reading conversation messages', async () => {
    const repository = new MemoryRepository();
    await seed(repository, 'conversations', 'conversation-a', { managedSiteId: 'site-a', subject: 'Lift issue', linkedEntityType: 'resident_request', linkedEntityId: 'request-a', status: 'active' });
    await seed(repository, 'conversationParticipants', 'participant-a', { conversationId: 'conversation-a', participantType: 'user', participantId: 'resident-a', joinedAt: new Date().toISOString(), canReply: true, status: 'active' });
    await seed(repository, 'conversationMessages', 'message-a', { conversationId: 'conversation-a', senderType: 'user', senderId: 'resident-a', body: 'Please provide an update', status: 'active' });
    const denied = await request(deps(repository, 'resident-b'), '/api/v1/portal-experience/resident/conversations/conversation-a/messages?managedSiteId=site-a');
    expect(denied.status).toBe(403); expect(denied.body.error?.code).toBe('CONVERSATION_PARTICIPANT_REQUIRED');
    const allowed = await request(deps(repository, 'resident-a'), '/api/v1/portal-experience/resident/conversations/conversation-a/messages?managedSiteId=site-a');
    expect(allowed.status).toBe(200); expect(allowed.body.data?.map((item) => item.id)).toEqual(['message-a']);
  });
});
