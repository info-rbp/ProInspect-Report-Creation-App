import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import type { ReportAggregate } from '@pcr/domain';
import { createRequestHandler } from '../src/app.js';
import { MemoryIdempotencyStore } from '../src/backend/idempotency.js';
import type { ApiDependencies, OperationalRepository, Page, ReportAggregateStore, ReportTransitionCommand, StoredRecord } from '../src/backend/types.js';

class MemoryRepository implements OperationalRepository {
  readonly records = new Map<string, StoredRecord>();
  private key(collection: string, agencyId: string, id: string) { return `${collection}:${agencyId}:${id}`; }
  async list(collection: string, agencyId: string): Promise<Page<StoredRecord>> { return { items: [...this.records.entries()].filter(([key]) => key.startsWith(`${collection}:${agencyId}:`)).map(([, value]) => value) }; }
  async get(collection: string, agencyId: string, id: string) { return this.records.get(this.key(collection, agencyId, id)); }
  async create(collection: string, agencyId: string, id: string, data: Record<string, unknown>, actorId: string) {
    const now = new Date().toISOString();
    const value: StoredRecord = { ...data, id, agencyId, version: 1, createdAt: now, updatedAt: now, createdBy: actorId };
    this.records.set(this.key(collection, agencyId, id), value);
    return value;
  }
  async update(collection: string, agencyId: string, id: string, data: Record<string, unknown>, expectedVersion: number, actorId: string) {
    const existing = await this.get(collection, agencyId, id);
    if (!existing) throw Object.assign(new Error('Not found.'), { status: 404, code: 'NOT_FOUND' });
    if (existing.version !== expectedVersion) throw Object.assign(new Error('Version conflict.'), { status: 409, code: 'VERSION_CONFLICT' });
    const value = { ...existing, ...data, version: expectedVersion + 1, updatedAt: new Date().toISOString(), updatedBy: actorId } as StoredRecord;
    this.records.set(this.key(collection, agencyId, id), value);
    return value;
  }
}

class MemoryReports implements ReportAggregateStore {
  readonly values = new Map<string, ReportAggregate>();
  async load(agencyId: string, reportId: string) { return this.values.get(`${agencyId}:${reportId}`); }
  async saveDraft(aggregate: ReportAggregate) { const stored = { ...aggregate, report: { ...aggregate.report, version: 1 } }; this.values.set(`${aggregate.report.agencyId}:${aggregate.report.id}`, stored); return stored; }
  async transition(_agencyId: string, _command: ReportTransitionCommand): Promise<Record<string, unknown>> { throw new Error('not used'); }
}

function deps(repository: MemoryRepository): ApiDependencies {
  return {
    requireAppCheck: false,
    identityVerifier: { verifyIdentityToken: async () => ({ uid: 'admin', agencyId: 'agency-a', authTime: 1, issuedAt: 1, mfaVerified: true }), verifyAppCheckToken: async () => undefined },
    memberships: { getMembership: async () => ({ uid: 'admin', agencyId: 'agency-a', role: 'proinspect_admin', status: 'active', mfaRequired: true, updatedAt: new Date().toISOString() }) },
    audit: { append: async () => undefined }, repository, reports: new MemoryReports(), idempotency: new MemoryIdempotencyStore(), tasks: { dispatch: async () => undefined },
    uploads: { create: async (agencyId, uploadId, input) => ({ id: uploadId, agencyId, ...input, status: 'issued' as const }) },
  };
}

async function request(dependencies: ApiDependencies, path: string, method: 'GET' | 'POST', body?: Record<string, unknown>) {
  const server = createServer(createRequestHandler(dependencies)).listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing address');
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
    method,
    headers: { authorization: 'Bearer token', 'x-agency-id': 'agency-a', ...(method === 'POST' ? { 'content-type': 'application/json', 'idempotency-key': 'specialised-app-mount' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return response;
}

describe('specialised API mounts', () => {
  it('routes maintenance follow-up creation through the main request handler', async () => {
    const repository = new MemoryRepository();
    await repository.create('properties', 'agency-a', 'property-1', { address: '1 Test Street' }, 'admin');
    await repository.create('maintenanceItems', 'agency-a', 'item-1', { propertyId: 'property-1', title: 'Follow up item', description: '', category: 'General', priority: 'routine', status: 'verified', sourceEvidenceIds: [], approvalRequired: false, approvalStatus: 'not_required', verificationStatus: 'verified' }, 'admin');
    const response = await request(deps(repository), '/api/v1/maintenance-reports/create', 'POST', { maintenanceItemIds: ['item-1'] });
    expect(response.status).toBe(201);
  });

  it('routes property history through the main request handler rather than generic 404', async () => {
    const repository = new MemoryRepository();
    const response = await request(deps(repository), '/api/v1/properties/missing-property/history', 'GET');
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'PROPERTY_NOT_FOUND' } });
  });
});
