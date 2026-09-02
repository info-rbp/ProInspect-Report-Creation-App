import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import type { ReportAggregate, SecurityRole } from '@pcr/domain';
import { createRequestHandler } from '../src/app.js';
import { MemoryIdempotencyStore } from '../src/backend/idempotency.js';
import type { ApiDependencies, OperationalRepository, Page, ReportAggregateStore, ReportTransitionCommand, StoredRecord } from '../src/backend/types.js';

class MemoryRepository implements OperationalRepository {
  readonly records = new Map<string, StoredRecord>();
  private key(collection: string, agencyId: string, id: string) { return `${collection}:${agencyId}:${id}`; }
  async list(collection: string, agencyId: string, limit = 100, _cursor?: string, filters: Record<string, string | number | boolean> = {}): Promise<Page<StoredRecord>> { return { items: [...this.records.entries()].filter(([key]) => key.startsWith(`${collection}:${agencyId}:`)).map(([, value]) => value).filter((record) => Object.entries(filters).every(([key, value]) => record[key] === value)).slice(0, limit) }; }
  async get(collection: string, agencyId: string, id: string) { return this.records.get(this.key(collection, agencyId, id)); }
  async create(collection: string, agencyId: string, id: string, data: Record<string, unknown>, actorId: string) { const now = new Date().toISOString(); const record: StoredRecord = { ...data, id, agencyId, version: 1, createdAt: now, updatedAt: now, createdBy: actorId }; this.records.set(this.key(collection, agencyId, id), record); return record; }
  async update(collection: string, agencyId: string, id: string, data: Record<string, unknown>, expectedVersion: number, actorId: string) { const current = await this.get(collection, agencyId, id); if (!current) throw Object.assign(new Error('Not found'), { status: 404, code: 'NOT_FOUND' }); if (current.version !== expectedVersion) throw Object.assign(new Error('Version conflict'), { status: 409, code: 'VERSION_CONFLICT' }); const record: StoredRecord = { ...current, ...data, version: expectedVersion + 1, updatedAt: new Date().toISOString(), updatedBy: actorId }; this.records.set(this.key(collection, agencyId, id), record); return record; }
}
class EmptyReports implements ReportAggregateStore { async load(): Promise<ReportAggregate | undefined> { return undefined; } async saveDraft(value: ReportAggregate) { return value; } async transition(_agencyId: string, _command: ReportTransitionCommand): Promise<Record<string, unknown>> { return {}; } }
function deps(repository: MemoryRepository, input: { role?: SecurityRole; uid?: string; clients?: string[] } = {}): ApiDependencies {
  const role = input.role ?? 'client_user'; const uid = input.uid ?? 'client-user-a'; const clients = input.clients ?? ['client-a'];
  return { requireAppCheck: false, identityVerifier: { verifyIdentityToken: async () => ({ uid, agencyId: 'agency-a', authTime: 1, issuedAt: 1, mfaVerified: true }), verifyAppCheckToken: async () => undefined }, memberships: { getMembership: async () => ({ uid, agencyId: 'agency-a', role, status: 'active', mfaRequired: false, clientAccountIds: clients, updatedAt: new Date().toISOString() }) }, audit: { append: async () => undefined }, repository, reports: new EmptyReports(), idempotency: new MemoryIdempotencyStore(), tasks: { dispatch: async () => undefined }, uploads: { create: async (agencyId, uploadId, payload) => ({ agencyId, uploadId, ...payload }) } };
}
interface TestBody { data?: StoredRecord; error?: { code?: string }; [key: string]: unknown; }
async function request(dependencies: ApiDependencies, path: string, init: RequestInit): Promise<{ status: number; body: TestBody }> { const server = createServer(createRequestHandler(dependencies)).listen(0); await new Promise<void>((resolve) => server.once('listening', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing address'); try { const response = await fetch(`http://127.0.0.1:${address.port}${path}`, init); return { status: response.status, body: JSON.parse(await response.text()) as TestBody }; } finally { await new Promise<void>((resolve) => server.close(() => resolve())); } }
function headers(key: string) { return { authorization: 'Bearer token', 'content-type': 'application/json', 'x-agency-id': 'agency-a', 'idempotency-key': key }; }
async function seed(repository: MemoryRepository, collection: string, id: string, data: Record<string, unknown>) { await repository.create(collection, 'agency-a', id, data, 'seed'); }

async function seedClient(repository: MemoryRepository) {
  await seed(repository, 'clients', 'client-a', { name: 'Client A', status: 'active' });
  await seed(repository, 'propertyClientRelationships', 'relationship-a', { clientId: 'client-a', propertyId: 'property-a', relationshipType: 'manager', isCurrent: true, status: 'active' });
  await seed(repository, 'properties', 'property-a', { streetAddress: '1 Example St', status: 'active' });
  await seed(repository, 'properties', 'property-b', { streetAddress: '2 Other St', status: 'active' });
}

describe('persistent client portal actions', () => {
  it('creates a service request only for a property linked to the client account', async () => {
    const repository = new MemoryRepository(); await seedClient(repository);
    const allowed = await request(deps(repository), '/api/v1/client-portal/client-a/service-requests', { method: 'POST', headers: headers('client-service-0001'), body: JSON.stringify({ serviceDefinitionId: 'service-a', propertyId: 'property-a', notes: 'Routine inspection please' }) });
    expect(allowed.status).toBe(201); expect(allowed.body.data).toMatchObject({ clientId: 'client-a', propertyId: 'property-a', requestedByUserId: 'client-user-a', source: 'client_portal', status: 'requested' });
    const denied = await request(deps(repository), '/api/v1/client-portal/client-a/service-requests', { method: 'POST', headers: headers('client-service-0002'), body: JSON.stringify({ serviceDefinitionId: 'service-a', propertyId: 'property-b' }) });
    expect(denied.status).toBe(403); expect(denied.body.error?.code).toBe('CLIENT_PROPERTY_SCOPE_REQUIRED');
  });

  it('rejects a booking request for a property outside the client portfolio', async () => {
    const repository = new MemoryRepository(); await seedClient(repository);
    const response = await request(deps(repository), '/api/v1/client-portal/client-a/bookings', { method: 'POST', headers: headers('client-booking-0001'), body: JSON.stringify({ propertyId: 'property-b', startAt: new Date().toISOString(), endAt: new Date(Date.now() + 3_600_000).toISOString() }) });
    expect(response.status).toBe(403); expect(response.body.error?.code).toBe('CLIENT_PROPERTY_SCOPE_REQUIRED');
  });

  it('allows a scoped client-admin entitlement to approve a quote without making the agency role globally client_admin', async () => {
    const repository = new MemoryRepository(); await seedClient(repository);
    await seed(repository, 'portalEntitlements', 'entitlement-a', { userId: 'client-user-a', portalId: 'client', sourceRole: 'client_admin', clientAccountId: 'client-a', status: 'active' });
    await seed(repository, 'maintenanceItems', 'maintenance-a', { propertyId: 'property-a', title: 'Leaking tap', status: 'awaiting_approval' });
    await seed(repository, 'maintenanceQuotes', 'quote-a', { maintenanceItemId: 'maintenance-a', approvalStatus: 'pending', status: 'active' });
    const response = await request(deps(repository, { role: 'client_user' }), '/api/v1/client-portal/client-a/quotes/quote-a/decision', { method: 'POST', headers: headers('client-quote-0001'), body: JSON.stringify({ decision: 'approved' }) });
    expect(response.status).toBe(201); expect(response.body.data).toMatchObject({ quoteId: 'quote-a', maintenanceItemId: 'maintenance-a', approvedBy: 'client-user-a', decision: 'approved' });
    const quote = await repository.get('maintenanceQuotes', 'agency-a', 'quote-a'); expect(quote?.approvalStatus).toBe('approved');
  });

  it('denies quote decisions to a normal client-user entitlement', async () => {
    const repository = new MemoryRepository(); await seedClient(repository);
    await seed(repository, 'portalEntitlements', 'entitlement-a', { userId: 'client-user-a', portalId: 'client', sourceRole: 'client_user', clientAccountId: 'client-a', status: 'active' });
    await seed(repository, 'maintenanceItems', 'maintenance-a', { propertyId: 'property-a', title: 'Leaking tap', status: 'awaiting_approval' });
    await seed(repository, 'maintenanceQuotes', 'quote-a', { maintenanceItemId: 'maintenance-a', approvalStatus: 'pending', status: 'active' });
    const response = await request(deps(repository, { role: 'client_user' }), '/api/v1/client-portal/client-a/quotes/quote-a/decision', { method: 'POST', headers: headers('client-quote-0002'), body: JSON.stringify({ decision: 'approved' }) });
    expect(response.status).toBe(403); expect(response.body.error?.code).toBe('CLIENT_ADMIN_REQUIRED');
  });
});
