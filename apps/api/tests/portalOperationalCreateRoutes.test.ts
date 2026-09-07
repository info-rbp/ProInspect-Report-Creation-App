import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import type { ReportAggregate } from '@pcr/domain';
import { createRequestHandler } from '../src/app.js';
import { MemoryIdempotencyStore } from '../src/backend/idempotency.js';
import type { ApiDependencies, OperationalRepository, Page, ReportAggregateStore, ReportTransitionCommand, StoredRecord } from '../src/backend/types.js';

class MemoryRepository implements OperationalRepository {
  readonly records = new Map<string, StoredRecord>();
  private key(collection: string, agencyId: string, id: string) { return `${collection}:${agencyId}:${id}`; }
  async list(collection: string, agencyId: string, limit = 100, _cursor?: string, filters: Record<string, string | number | boolean> = {}): Promise<Page<StoredRecord>> {
    return { items: [...this.records.entries()].filter(([key]) => key.startsWith(`${collection}:${agencyId}:`)).map(([, value]) => value).filter((record) => Object.entries(filters).every(([key, value]) => record[key] === value)).slice(0, limit) };
  }
  async get(collection: string, agencyId: string, id: string) { return this.records.get(this.key(collection, agencyId, id)); }
  async create(collection: string, agencyId: string, id: string, data: Record<string, unknown>, actorId: string) { const now = new Date().toISOString(); const record: StoredRecord = { ...data, id, agencyId, version: 1, createdAt: now, updatedAt: now, createdBy: actorId }; this.records.set(this.key(collection, agencyId, id), record); return record; }
  async update(collection: string, agencyId: string, id: string, data: Record<string, unknown>, expectedVersion: number, actorId: string) { const current = await this.get(collection, agencyId, id); if (!current) throw Object.assign(new Error('Not found'), { status: 404, code: 'NOT_FOUND' }); const record: StoredRecord = { ...current, ...data, version: expectedVersion + 1, updatedAt: new Date().toISOString(), updatedBy: actorId }; this.records.set(this.key(collection, agencyId, id), record); return record; }
}
class EmptyReports implements ReportAggregateStore { async load(): Promise<ReportAggregate | undefined> { return undefined; } async saveDraft(value: ReportAggregate) { return value; } async transition(_agencyId: string, _command: ReportTransitionCommand): Promise<Record<string, unknown>> { return {}; } }
function deps(repository: MemoryRepository, siteIds = ['site-a']): ApiDependencies {
  return {
    requireAppCheck: false,
    identityVerifier: { verifyIdentityToken: async () => ({ uid: 'manager-a', agencyId: 'agency-a', authTime: 1, issuedAt: 1, mfaVerified: true }), verifyAppCheckToken: async () => undefined },
    memberships: { getMembership: async () => ({ uid: 'manager-a', agencyId: 'agency-a', role: 'building_manager', status: 'active', mfaRequired: true, siteIds, updatedAt: new Date().toISOString() }) },
    audit: { append: async () => undefined }, repository, reports: new EmptyReports(), idempotency: new MemoryIdempotencyStore(), tasks: { dispatch: async () => undefined }, uploads: { create: async (agencyId, uploadId, payload) => ({ agencyId, uploadId, ...payload }) },
  };
}
interface TestBody { data?: StoredRecord; error?: { code?: string }; [key: string]: unknown; }
async function request(dependencies: ApiDependencies, path: string, init: RequestInit): Promise<{ status: number; body: TestBody }> {
  const server = createServer(createRequestHandler(dependencies)).listen(0); await new Promise<void>((resolve) => server.once('listening', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing address');
  try { const response = await fetch(`http://127.0.0.1:${address.port}${path}`, init); return { status: response.status, body: JSON.parse(await response.text()) as TestBody }; } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
}
function headers(key: string) { return { authorization: 'Bearer token', 'content-type': 'application/json', 'x-agency-id': 'agency-a', 'idempotency-key': key }; }

describe('portal operational create commands', () => {
  it('stamps incident reporter and safe initial status on the server', async () => {
    const repository = new MemoryRepository();
    const response = await request(deps(repository), '/api/v1/portal-operations/incidents', { method: 'POST', headers: headers('incident-create-0001'), body: JSON.stringify({ managedSiteId: 'site-a', incidentType: 'security', severity: 'high', occurredAt: new Date().toISOString(), description: 'Door forced', reportedBy: 'spoofed-user', status: 'closed' }) });
    expect(response.status).toBe(201); expect(response.body.data).toMatchObject({ managedSiteId: 'site-a', reportedBy: 'manager-a', status: 'open', incidentType: 'security' });
  });

  it('stamps daily activity author rather than accepting a browser actor', async () => {
    const repository = new MemoryRepository();
    const response = await request(deps(repository), '/api/v1/portal-operations/daily-activity-logs', { method: 'POST', headers: headers('activity-create-0001'), body: JSON.stringify({ managedSiteId: 'site-a', activityDate: new Date().toISOString(), summary: 'Contractor induction completed', authorUserId: 'spoofed-user' }) });
    expect(response.status).toBe(201); expect(response.body.data).toMatchObject({ authorUserId: 'manager-a', status: 'recorded' });
  });

  it('rejects missing canonical required fields', async () => {
    const response = await request(deps(new MemoryRepository()), '/api/v1/portal-operations/incidents', { method: 'POST', headers: headers('incident-invalid-0001'), body: JSON.stringify({ managedSiteId: 'site-a', severity: 'high' }) });
    expect(response.status).toBe(400); expect(response.body.error?.code).toBe('REQUIRED_FIELDS_MISSING');
  });

  it('denies writes to a managed site outside the manager scope', async () => {
    const response = await request(deps(new MemoryRepository(), ['site-a']), '/api/v1/portal-operations/tasks', { method: 'POST', headers: headers('task-cross-site-0001'), body: JSON.stringify({ managedSiteId: 'site-b', title: 'Unauthorised task', taskType: 'operations' }) });
    expect(response.status).toBe(403); expect(response.body.error?.code).toBe('FORBIDDEN');
  });
});
