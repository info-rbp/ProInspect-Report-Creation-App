import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { ReportAggregate, SecurityRole } from '@pcr/domain';
import { createRequestHandler } from '../src/app.js';
import { MemoryIdempotencyStore } from '../src/backend/idempotency.js';
import type {
  ApiDependencies,
  OperationalRepository,
  Page,
  ReportAggregateStore,
  ReportTransitionCommand,
  StoredRecord,
} from '../src/backend/types.js';

let server: ReturnType<typeof createServer> | undefined;
afterEach(() => server?.close());

class MemoryRepository implements OperationalRepository {
  readonly records = new Map<string, StoredRecord>();
  private key(collection: string, agencyId: string, id: string) { return `${collection}:${agencyId}:${id}`; }
  async list(collection: string, agencyId: string): Promise<Page<StoredRecord>> {
    return { items: [...this.records.entries()].filter(([key]) => key.startsWith(`${collection}:${agencyId}:`)).map(([, value]) => value) };
  }
  async get(collection: string, agencyId: string, id: string) { return this.records.get(this.key(collection, agencyId, id)); }
  async create(collection: string, agencyId: string, id: string, data: Record<string, unknown>, actorId: string) {
    const timestamp = new Date().toISOString();
    const record: StoredRecord = { ...data, id, agencyId, version: 1, createdAt: timestamp, updatedAt: timestamp, createdBy: actorId };
    this.records.set(this.key(collection, agencyId, id), record);
    return record;
  }
  async update(collection: string, agencyId: string, id: string, data: Record<string, unknown>, expectedVersion: number, actorId: string) {
    const existing = await this.get(collection, agencyId, id);
    if (!existing) throw Object.assign(new Error('Record not found.'), { status: 404, code: 'NOT_FOUND' });
    if (existing.version !== expectedVersion) throw Object.assign(new Error('Version conflict.'), { status: 409, code: 'VERSION_CONFLICT' });
    const record: StoredRecord = { ...existing, ...data, id, agencyId, version: expectedVersion + 1, updatedAt: new Date().toISOString(), updatedBy: actorId };
    this.records.set(this.key(collection, agencyId, id), record);
    return record;
  }
}

class EmptyReportStore implements ReportAggregateStore {
  async load(): Promise<ReportAggregate | undefined> { return undefined; }
  async saveDraft(aggregate: ReportAggregate): Promise<ReportAggregate> { return aggregate; }
  async transition(_agencyId: string, _command: ReportTransitionCommand): Promise<Record<string, unknown>> { return {}; }
}

function dependencies(
  repository: MemoryRepository,
  input: { role?: SecurityRole; uid?: string; siteIds?: string[]; propertyIds?: string[]; clientAccountIds?: string[]; contractorId?: string } = {},
): ApiDependencies {
  const uid = input.uid ?? 'user-1';
  const role = input.role ?? 'proinspect_admin';
  return {
    requireAppCheck: false,
    identityVerifier: {
      verifyIdentityToken: async () => ({ uid, agencyId: 'agency-a', authTime: 1, issuedAt: 1, mfaVerified: true }),
      verifyAppCheckToken: async () => undefined,
    },
    memberships: {
      getMembership: async () => ({
        uid, agencyId: 'agency-a', role, status: 'active', mfaRequired: true,
        updatedAt: new Date().toISOString(),
        ...(input.siteIds ? { siteIds: input.siteIds } : {}),
        ...(input.propertyIds ? { propertyIds: input.propertyIds } : {}),
        ...(input.clientAccountIds ? { clientAccountIds: input.clientAccountIds } : {}),
        ...(input.contractorId ? { contractorId: input.contractorId } : {}),
      }),
    },
    audit: { append: async () => undefined }, repository, reports: new EmptyReportStore(),
    idempotency: new MemoryIdempotencyStore(), tasks: { dispatch: async () => undefined },
    uploads: { create: async (agencyId, uploadId, payload) => ({ agencyId, uploadId, ...payload }) },
  };
}

async function request(deps: ApiDependencies, path: string, init: RequestInit = {}) {
  server = createServer(createRequestHandler(deps)).listen(0);
  await new Promise<void>((resolve) => server?.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing address');
  return fetch(`http://127.0.0.1:${address.port}${path}`, init);
}

function headers(key: string): Record<string, string> {
  return { authorization: 'Bearer token', 'content-type': 'application/json', 'x-agency-id': 'agency-a', 'idempotency-key': key };
}

describe('Building Management API', () => {
  it('creates and transitions a scoped defect through a guarded command', async () => {
    const repository = new MemoryRepository();
    const deps = dependencies(repository);
    const created = await request(deps, '/api/v1/building/defects', {
      method: 'POST', headers: headers('defect-create-0001'),
      body: JSON.stringify({ id: 'defect-1', managedSiteId: 'site-a', status: 'new', title: 'Water leak' }),
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ data: { id: 'defect-1', managedSiteId: 'site-a', status: 'new', version: 1 } });
    server?.close();
    const transition = await request(deps, '/api/v1/building/defects/defect-1/transitions', {
      method: 'POST', headers: headers('defect-transition-0001'), body: JSON.stringify({ expectedVersion: 1, status: 'bm_assessment' }),
    });
    expect(transition.status).toBe(200);
    expect(await transition.json()).toMatchObject({ data: { status: 'bm_assessment', version: 2 } });
  });

  it('rejects direct lifecycle patching', async () => {
    const repository = new MemoryRepository();
    await repository.create('defects', 'agency-a', 'defect-2', { managedSiteId: 'site-a', status: 'new' }, 'admin-1');
    const response = await request(dependencies(repository), '/api/v1/building/defects/defect-2', {
      method: 'PATCH', headers: headers('defect-patch-0001'), body: JSON.stringify({ expectedVersion: 1, status: 'closed' }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'LIFECYCLE_FIELD_PROTECTED' } });
  });

  it('denies a Building Manager outside the assigned site', async () => {
    const repository = new MemoryRepository();
    await repository.create('incidents', 'agency-a', 'incident-1', { managedSiteId: 'site-b', status: 'open' }, 'admin-1');
    const response = await request(dependencies(repository, { role: 'building_manager', siteIds: ['site-a'] }), '/api/v1/building/incidents/incident-1', { headers: { authorization: 'Bearer token', 'x-agency-id': 'agency-a' } });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  it('lets a resident create only a self-scoped request at an assigned site', async () => {
    const repository = new MemoryRepository();
    const response = await request(
      dependencies(repository, { role: 'resident_tenant', uid: 'resident-1', siteIds: ['site-a'], propertyIds: ['property-1'] }),
      '/api/v1/building/resident-requests',
      {
        method: 'POST', headers: headers('resident-request-0001'),
        body: JSON.stringify({ id: 'request-1', managedSiteId: 'site-a', propertyId: 'property-1', status: 'submitted', category: 'maintenance' }),
      },
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ data: { id: 'request-1', submittedByUserId: 'resident-1', residentUserId: 'resident-1' } });
  });

  it('blocks contractor sign-out with an outstanding key unless an override is supplied', async () => {
    const repository = new MemoryRepository();
    await repository.create('contractorAttendance', 'agency-a', 'attendance-1', { managedSiteId: 'site-a', contractorId: 'contractor-1', status: 'checked_in' }, 'admin-1');
    const deps = dependencies(repository, { role: 'contractor_worker', siteIds: ['site-a'], contractorId: 'contractor-1' });
    const blocked = await request(deps, '/api/v1/building/contractor-attendance/attendance-1/sign-out', {
      method: 'POST', headers: headers('attendance-out-0001'), body: JSON.stringify({ expectedVersion: 1, keyIssued: true, keyReturned: false }),
    });
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ error: { code: 'ACCESS_ITEM_OUTSTANDING' } });
    server?.close();
    const allowed = await request(deps, '/api/v1/building/contractor-attendance/attendance-1/sign-out', {
      method: 'POST', headers: headers('attendance-out-0002'),
      body: JSON.stringify({ expectedVersion: 1, keyIssued: true, keyReturned: false, overrideReason: 'Approved return visit tomorrow.' }),
    });
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toMatchObject({ data: { status: 'checked_out', keyReturnOverrideBy: 'user-1' } });
  });

  it('keeps final operational reports read only outside a supersession command', async () => {
    const repository = new MemoryRepository();
    await repository.create('operationalReports', 'agency-a', 'monthly-1', { managedSiteId: 'site-a', status: 'finalised', immutable: true, finalisedAt: '2026-08-01T00:00:00.000Z' }, 'admin-1');
    const response = await request(dependencies(repository), '/api/v1/building/operational-reports/monthly-1', {
      method: 'PATCH', headers: headers('report-patch-0001'), body: JSON.stringify({ expectedVersion: 1, title: 'Changed final report' }),
    });
    expect(response.status).toBe(405);
    expect(await response.json()).toMatchObject({ error: { code: 'METHOD_NOT_ALLOWED' } });
  });
});
