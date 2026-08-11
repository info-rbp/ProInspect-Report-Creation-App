import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { ReportAggregate } from '@pcr/domain';
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
    const updated: StoredRecord = { ...existing, ...data, id, agencyId, version: existing.version + 1, updatedAt: new Date().toISOString(), updatedBy: actorId };
    this.records.set(this.key(collection, agencyId, id), updated);
    return updated;
  }
}

class MemoryReportStore implements ReportAggregateStore {
  aggregate?: ReportAggregate;
  async load(agencyId: string, reportId: string) {
    return this.aggregate?.report.agencyId === agencyId && this.aggregate.report.id === reportId ? this.aggregate : undefined;
  }
  async saveDraft(aggregate: ReportAggregate, expectedVersion: number | undefined, _actorId: string) {
    const current = this.aggregate?.report.version;
    if (current !== undefined && expectedVersion !== current) throw Object.assign(new Error('Version conflict.'), { status: 409, code: 'VERSION_CONFLICT' });
    const timestamp = new Date().toISOString();
    this.aggregate = {
      ...aggregate,
      report: { ...aggregate.report, createdAt: aggregate.report.createdAt ?? timestamp, updatedAt: timestamp, version: (current ?? 0) + 1 },
    };
    return this.aggregate;
  }
  async transition(_agencyId: string, command: ReportTransitionCommand) {
    if (!this.aggregate || this.aggregate.report.version !== command.expectedVersion) throw Object.assign(new Error('Version conflict.'), { status: 409, code: 'VERSION_CONFLICT' });
    this.aggregate = { ...this.aggregate, report: { ...this.aggregate.report, lifecycleStatus: command.status, version: command.expectedVersion + 1 } };
    return { ...this.aggregate.report } as Record<string, unknown>;
  }
}

function dependencies(repository = new MemoryRepository(), reports = new MemoryReportStore()): ApiDependencies {
  return {
    requireAppCheck: false,
    identityVerifier: {
      verifyIdentityToken: async () => ({ uid: 'admin-1', agencyId: 'agency-a', authTime: 1, issuedAt: 1, mfaVerified: true }),
      verifyAppCheckToken: async () => undefined,
    },
    memberships: {
      getMembership: async () => ({ uid: 'admin-1', agencyId: 'agency-a', role: 'proinspect_admin', status: 'active', mfaRequired: true, updatedAt: new Date().toISOString() }),
    },
    audit: { append: async () => undefined },
    repository,
    reports,
    idempotency: new MemoryIdempotencyStore(),
    tasks: { dispatch: async () => undefined },
    uploads: { create: async (agencyId, uploadId, input) => ({ id: uploadId, agencyId, ...input, status: 'issued' }) },
  };
}

async function request(deps: ApiDependencies, path: string, init: RequestInit = {}) {
  server = createServer(createRequestHandler(deps)).listen(0);
  await new Promise<void>((resolve) => server?.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing address');
  return fetch(`http://127.0.0.1:${address.port}${path}`, init);
}

const headers = {
  authorization: 'Bearer token',
  'content-type': 'application/json',
  'x-agency-id': 'agency-a',
  'idempotency-key': 'request-key-0001',
};

const aggregate: ReportAggregate = {
  report: {
    id: 'report-1', agencyId: 'agency-a', reportType: 'Property Condition Report', propertyAddress: '1 Test Street', lifecycleStatus: 'draft',
  },
  areas: [{
    id: 'entry', name: 'Entry', sequence: 1, components: [{
      id: 'front-door', component: 'Front Door', conditionCategory: 'minor_wear', cleanlinessCategory: 'clean',
      workingStatus: 'untested', testStatus: 'untested', defects: ['minor scuff'], maintenanceRequired: false,
      commentary: 'Painted door with minor scuffing, otherwise intact.', photoReferences: [{ photoId: 'photo-1', objectPath: 'agencies/agency-a/photos/photo-1.jpg' }],
      reviewStatus: 'draft', comparisonStatus: 'not_compared',
    }],
  }],
};

describe('Cloud Run API', () => {
  it('serves health checks and generated OpenAPI documentation', async () => {
    const health = await request(dependencies(), '/health');
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: 'ok', service: 'pcr-api', version: 'v1' });
    server?.close();
    const docs = await request(dependencies(), '/api/v1/openapi.json');
    expect(docs.status).toBe(200);
    expect(await docs.json()).toMatchObject({ openapi: '3.1.0', info: { version: '1.1.0' } });
  });

  it('requires an idempotency key for material writes', async () => {
    const response = await request(dependencies(), '/api/v1/properties', {
      method: 'POST',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json', 'x-agency-id': 'agency-a' },
      body: JSON.stringify({ id: 'property-1', address: '1 Test Street' }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REQUIRED' } });
  });

  it('replays the original result for a repeated idempotent create', async () => {
    const deps = dependencies();
    const first = await request(deps, '/api/v1/properties', { method: 'POST', headers, body: JSON.stringify({ id: 'property-1', address: '1 Test Street' }) });
    expect(first.status).toBe(201);
    expect(first.headers.get('idempotency-replayed')).toBe('false');
    const firstBody = await first.json();
    server?.close();
    const second = await request(deps, '/api/v1/properties', { method: 'POST', headers, body: JSON.stringify({ id: 'property-1', address: '1 Test Street' }) });
    expect(second.status).toBe(201);
    expect(second.headers.get('idempotency-replayed')).toBe('true');
    expect(await second.json()).toEqual(firstBody);
  });

  it('rejects reuse of an idempotency key with a different payload', async () => {
    const deps = dependencies();
    await request(deps, '/api/v1/properties', { method: 'POST', headers, body: JSON.stringify({ id: 'property-1', address: '1 Test Street' }) });
    server?.close();
    const response = await request(deps, '/api/v1/properties', { method: 'POST', headers, body: JSON.stringify({ id: 'property-2', address: '2 Test Street' }) });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_CONFLICT' } });
  });

  it('saves and loads decomposed report aggregates through dedicated routes', async () => {
    const deps = dependencies();
    const saved = await request(deps, '/api/v1/reports/report-1/aggregate', { method: 'PUT', headers, body: JSON.stringify(aggregate) });
    expect(saved.status).toBe(201);
    expect(await saved.json()).toMatchObject({ data: { report: { id: 'report-1', version: 1 }, areas: [{ id: 'entry' }] } });
    server?.close();
    const loaded = await request(deps, '/api/v1/reports/report-1/aggregate', { headers: { authorization: 'Bearer token', 'x-agency-id': 'agency-a' } });
    expect(loaded.status).toBe(200);
    expect(await loaded.json()).toMatchObject({ data: { areas: [{ components: [{ id: 'front-door' }] }] } });
  });

  it('rejects binary fields in report aggregates', async () => {
    const firstArea = aggregate.areas[0]!;
    const firstComponent = firstArea.components[0]!;
    const response = await request(dependencies(), '/api/v1/reports/report-1/aggregate', {
      method: 'PUT', headers, body: JSON.stringify({ ...aggregate, areas: [{ ...firstArea, components: [{ ...firstComponent, file: 'data:image/jpeg;base64,abc' }] }] }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('enforces optimistic versions for workflow transitions', async () => {
    const repository = new MemoryRepository();
    await repository.create('inspectionJobs', 'agency-a', 'job-1', { status: 'assigned' }, 'admin-1');
    const deps = dependencies(repository);
    const response = await request(deps, '/api/v1/inspection-jobs/job-1/transitions', {
      method: 'POST', headers, body: JSON.stringify({ status: 'inspection_started', expectedVersion: 1 }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { status: 'inspection_started', version: 2 } });
  });

  it('returns the same error envelope for unknown routes', async () => {
    const response = await request(dependencies(), '/api/v1/not-real', { headers: { authorization: 'Bearer token', 'x-agency-id': 'agency-a' } });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'NOT_FOUND', status: 404 } });
  });
});
