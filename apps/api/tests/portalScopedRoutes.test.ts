import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import type { ReportAggregate, SecurityRole } from '@pcr/domain';
import { createRequestHandler } from '../src/app.js';
import { MemoryIdempotencyStore } from '../src/backend/idempotency.js';
import type { ApiDependencies, OperationalRepository, Page, ReportAggregateStore, ReportTransitionCommand, StoredRecord } from '../src/backend/types.js';

class MemoryRepository implements OperationalRepository {
  readonly records = new Map<string, StoredRecord>();
  private key(collection: string, agencyId: string, id: string) { return `${collection}:${agencyId}:${id}`; }
  async list(collection: string, agencyId: string, limit = 100, _cursor?: string, filters: Record<string, string | number | boolean> = {}): Promise<Page<StoredRecord>> {
    const items = [...this.records.entries()]
      .filter(([key]) => key.startsWith(`${collection}:${agencyId}:`))
      .map(([, value]) => value)
      .filter((record) => Object.entries(filters).every(([key, value]) => record[key] === value))
      .slice(0, limit);
    return { items };
  }
  async get(collection: string, agencyId: string, id: string) { return this.records.get(this.key(collection, agencyId, id)); }
  async create(collection: string, agencyId: string, id: string, data: Record<string, unknown>, actorId: string) {
    const timestamp = new Date().toISOString(); const record: StoredRecord = { ...data, id, agencyId, version: 1, createdAt: timestamp, updatedAt: timestamp, createdBy: actorId }; this.records.set(this.key(collection, agencyId, id), record); return record;
  }
  async update(collection: string, agencyId: string, id: string, data: Record<string, unknown>, expectedVersion: number, actorId: string) {
    const existing = await this.get(collection, agencyId, id); if (!existing) throw Object.assign(new Error('Record not found.'), { status: 404, code: 'NOT_FOUND' }); if (existing.version !== expectedVersion) throw Object.assign(new Error('Version conflict.'), { status: 409, code: 'VERSION_CONFLICT' }); const record: StoredRecord = { ...existing, ...data, id, agencyId, version: expectedVersion + 1, updatedAt: new Date().toISOString(), updatedBy: actorId }; this.records.set(this.key(collection, agencyId, id), record); return record;
  }
}
class EmptyReportStore implements ReportAggregateStore { async load(): Promise<ReportAggregate | undefined> { return undefined; } async saveDraft(aggregate: ReportAggregate): Promise<ReportAggregate> { return aggregate; } async transition(_agencyId: string, _command: ReportTransitionCommand): Promise<Record<string, unknown>> { return {}; } }
function dependencies(repository: MemoryRepository, input: { role: SecurityRole; uid: string; siteIds?: string[]; propertyIds?: string[]; clientAccountIds?: string[]; contractorId?: string }): ApiDependencies {
  return { requireAppCheck: false, identityVerifier: { verifyIdentityToken: async () => ({ uid: input.uid, agencyId: 'agency-a', authTime: 1, issuedAt: 1, mfaVerified: true }), verifyAppCheckToken: async () => undefined }, memberships: { getMembership: async () => ({ uid: input.uid, agencyId: 'agency-a', role: input.role, status: 'active', mfaRequired: true, updatedAt: new Date().toISOString(), ...(input.siteIds ? { siteIds: input.siteIds } : {}), ...(input.propertyIds ? { propertyIds: input.propertyIds } : {}), ...(input.clientAccountIds ? { clientAccountIds: input.clientAccountIds } : {}), ...(input.contractorId ? { contractorId: input.contractorId } : {}) }) }, audit: { append: async () => undefined }, repository, reports: new EmptyReportStore(), idempotency: new MemoryIdempotencyStore(), tasks: { dispatch: async () => undefined }, uploads: { create: async (agencyId, uploadId, payload) => ({ agencyId, uploadId, ...payload }) } };
}
async function request(deps: ApiDependencies, path: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  const server = createServer(createRequestHandler(deps)).listen(0); await new Promise<void>((resolve) => server.once('listening', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing address');
  try { const response = await fetch(`http://127.0.0.1:${address.port}${path}`, init); const text = await response.text(); return { status: response.status, body: text ? JSON.parse(text) : undefined }; } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
}
function headers(key = 'portal-test-0001'): Record<string, string> { return { authorization: 'Bearer token', 'content-type': 'application/json', 'x-agency-id': 'agency-a', 'idempotency-key': key }; }
async function seed(repository: MemoryRepository, collection: string, id: string, data: Record<string, unknown>) { await repository.create(collection, 'agency-a', id, data, 'seed'); }

describe('portal scoped API', () => {
  it('returns only the signed-in resident requests even when another resident shares the site', async () => {
    const repository = new MemoryRepository();
    await seed(repository, 'residentRequests', 'own', { managedSiteId: 'site-a', residentUserId: 'resident-a', description: 'Own request', status: 'submitted' });
    await seed(repository, 'residentRequests', 'other', { managedSiteId: 'site-a', residentUserId: 'resident-b', description: 'Other request', status: 'submitted' });
    const response = await request(dependencies(repository, { role: 'resident_tenant', uid: 'resident-a', siteIds: ['site-a'], propertyIds: ['property-a'] }), '/api/v1/portal-scope/resident/requests?managedSiteId=site-a', { headers: headers() });
    expect(response.status).toBe(200); expect(response.body.data).toHaveLength(1); expect(response.body.data[0]).toMatchObject({ id: 'own', residentUserId: 'resident-a' });
  });

  it('rejects a resident attempting to read another unit at the same site', async () => {
    const repository = new MemoryRepository(); await seed(repository, 'occupancies', 'occupancy-a', { managedSiteId: 'site-a', userId: 'resident-a', unitId: 'unit-a', propertyId: 'property-a', current: true, status: 'active' });
    const response = await request(dependencies(repository, { role: 'resident_tenant', uid: 'resident-a', siteIds: ['site-a'], propertyIds: ['property-a'] }), '/api/v1/portal-scope/resident/access-requests?managedSiteId=site-a&unitId=unit-b', { headers: headers() });
    expect(response.status).toBe(403); expect(response.body.error.code).toBe('UNIT_SCOPE_REQUIRED');
  });

  it('forces resident identity and site when a resident submits an issue', async () => {
    const repository = new MemoryRepository(); await seed(repository, 'occupancies', 'occupancy-a', { managedSiteId: 'site-a', userId: 'resident-a', unitId: 'unit-a', current: true, status: 'active' });
    const response = await request(dependencies(repository, { role: 'resident_tenant', uid: 'resident-a', siteIds: ['site-a'], propertyIds: ['property-a'] }), '/api/v1/portal-scope/resident/requests?managedSiteId=site-a', { method: 'POST', headers: headers('resident-create-0001'), body: JSON.stringify({ requestType: 'issue', description: 'Lift is not responding', unitId: 'unit-a', residentUserId: 'resident-b', managedSiteId: 'site-b' }) });
    expect(response.status).toBe(201); expect(response.body.data).toMatchObject({ managedSiteId: 'site-a', residentUserId: 'resident-a', unitId: 'unit-a', status: 'submitted' });
  });

  it('returns only work assigned to the signed-in contractor company', async () => {
    const repository = new MemoryRepository(); await seed(repository, 'operationalWorkOrders', 'work-a', { managedSiteId: 'site-a', contractorId: 'contractor-a', status: 'scheduled' }); await seed(repository, 'operationalWorkOrders', 'work-b', { managedSiteId: 'site-a', contractorId: 'contractor-b', status: 'scheduled' });
    const response = await request(dependencies(repository, { role: 'contractor_worker', uid: 'worker-a', siteIds: ['site-a'], contractorId: 'contractor-a' }), '/api/v1/portal-scope/contractor/work?managedSiteId=site-a', { headers: headers() });
    expect(response.status).toBe(200); expect(response.body.data.map((item: StoredRecord) => item.id)).toEqual(['work-a']);
  });

  it('overrides spoofed contractor identity during portal check-in', async () => {
    const repository = new MemoryRepository(); const response = await request(dependencies(repository, { role: 'contractor_worker', uid: 'worker-a', siteIds: ['site-a'], contractorId: 'contractor-a' }), '/api/v1/portal-scope/contractor/attendance?managedSiteId=site-a', { method: 'POST', headers: headers('contractor-checkin-0001'), body: JSON.stringify({ contractorId: 'contractor-b', contractorUserId: 'worker-b', visitorName: 'Worker A', purpose: 'Repair', siteRulesAcknowledged: true }) });
    expect(response.status).toBe(201); expect(response.body.data).toMatchObject({ contractorId: 'contractor-a', contractorUserId: 'worker-a', managedSiteId: 'site-a', status: 'checked_in' });
  });

  it('denies a site manager from opening resident data at an unassigned site', async () => {
    const repository = new MemoryRepository(); const response = await request(dependencies(repository, { role: 'building_manager', uid: 'manager-a', siteIds: ['site-a'] }), '/api/v1/portal-scope/site/residents?managedSiteId=site-b', { headers: headers() });
    expect(response.status).toBe(403); expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('returns only inspection jobs assigned to the inspector', async () => {
    const repository = new MemoryRepository(); await seed(repository, 'inspectionJobs', 'job-a', { inspectorId: 'inspector-a', propertyId: 'property-a', status: 'assigned' }); await seed(repository, 'inspectionJobs', 'job-b', { inspectorId: 'inspector-b', propertyId: 'property-b', status: 'assigned' });
    const response = await request(dependencies(repository, { role: 'inspector', uid: 'inspector-a' }), '/api/v1/portal-scope/inspector/jobs', { headers: headers() });
    expect(response.status).toBe(200); expect(response.body.data.map((item: StoredRecord) => item.id)).toEqual(['job-a']);
  });
});
