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
    return {
      items: [...this.records.entries()]
        .filter(([key]) => key.startsWith(`${collection}:${agencyId}:`))
        .map(([, value]) => value),
    };
  }
  async get(collection: string, agencyId: string, id: string) {
    return this.records.get(this.key(collection, agencyId, id));
  }
  async create(collection: string, agencyId: string, id: string, data: Record<string, unknown>, actorId: string) {
    const now = new Date().toISOString();
    const record: StoredRecord = {
      ...data,
      id,
      agencyId,
      version: 1,
      createdAt: now,
      updatedAt: now,
      createdBy: actorId,
    };
    this.records.set(this.key(collection, agencyId, id), record);
    return record;
  }
  async update(collection: string, agencyId: string, id: string, data: Record<string, unknown>, expectedVersion: number, actorId: string) {
    const existing = await this.get(collection, agencyId, id);
    if (!existing) throw Object.assign(new Error('Record not found.'), { status: 404, code: 'NOT_FOUND' });
    if (existing.version !== expectedVersion) throw Object.assign(new Error('Version conflict.'), { status: 409, code: 'VERSION_CONFLICT' });
    const updated: StoredRecord = {
      ...existing,
      ...data,
      id,
      agencyId,
      version: expectedVersion + 1,
      updatedAt: new Date().toISOString(),
      updatedBy: actorId,
    };
    this.records.set(this.key(collection, agencyId, id), updated);
    return updated;
  }
}

class MemoryReportStore implements ReportAggregateStore {
  readonly reports = new Map<string, ReportAggregate>();
  private key(agencyId: string, reportId: string) { return `${agencyId}:${reportId}`; }
  async load(agencyId: string, reportId: string) {
    return this.reports.get(this.key(agencyId, reportId));
  }
  async saveDraft(aggregate: ReportAggregate, expectedVersion: number | undefined, _actorId: string) {
    const key = this.key(aggregate.report.agencyId, aggregate.report.id);
    const existing = this.reports.get(key);
    if (existing?.report.version !== undefined && expectedVersion !== existing.report.version) {
      throw Object.assign(new Error('Version conflict.'), { status: 409, code: 'VERSION_CONFLICT' });
    }
    const now = new Date().toISOString();
    const stored: ReportAggregate = {
      ...aggregate,
      report: {
        ...aggregate.report,
        version: (existing?.report.version ?? 0) + 1,
        createdAt: existing?.report.createdAt ?? now,
        updatedAt: now,
      },
    };
    this.reports.set(key, stored);
    return stored;
  }
  async transition(_agencyId: string, _command: ReportTransitionCommand): Promise<Record<string, unknown>> {
    throw new Error('Not required by inspection creation tests.');
  }
}

function dependencies(repository: MemoryRepository, reports = new MemoryReportStore()): ApiDependencies {
  return {
    requireAppCheck: false,
    identityVerifier: {
      verifyIdentityToken: async () => ({
        uid: 'admin-1',
        agencyId: 'agency-a',
        authTime: 1,
        issuedAt: 1,
        mfaVerified: true,
      }),
      verifyAppCheckToken: async () => undefined,
    },
    memberships: {
      getMembership: async () => ({
        uid: 'admin-1',
        agencyId: 'agency-a',
        role: 'proinspect_admin',
        status: 'active',
        mfaRequired: true,
        updatedAt: new Date().toISOString(),
      }),
    },
    audit: { append: async () => undefined },
    repository,
    reports,
    idempotency: new MemoryIdempotencyStore(),
    tasks: { dispatch: async () => undefined },
    uploads: {
      create: async (agencyId, uploadId, input) => ({
        id: uploadId,
        agencyId,
        ...input,
        status: 'issued' as const,
      }),
    },
  };
}

async function request(deps: ApiDependencies, jobId: string, body: Record<string, unknown>) {
  server = createServer(createRequestHandler(deps)).listen(0);
  await new Promise<void>((resolve) => server?.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing server address.');
  return fetch(`http://127.0.0.1:${address.port}/api/v1/inspection-jobs/${jobId}/create-report`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer token',
      'content-type': 'application/json',
      'x-agency-id': 'agency-a',
      'idempotency-key': `create-${jobId}-report`,
    },
    body: JSON.stringify(body),
  });
}

const areas = [{
  id: 'area-entry',
  name: 'Entry',
  sequence: 1,
  photoReferences: [],
  components: [{
    id: 'front-door',
    component: 'Front Door',
    conditionCategory: 'unable_to_confirm',
    cleanlinessCategory: 'unable_to_confirm',
    workingStatus: 'not_applicable',
    testStatus: 'not_applicable',
    defects: [],
    maintenanceRequired: false,
    commentary: '',
    photoReferences: [],
    reviewStatus: 'draft',
    comparisonStatus: 'not_compared',
  }],
}];

async function seedJob(repository: MemoryRepository, id: string, reportType: string, extra: Record<string, unknown> = {}) {
  await repository.create('properties', 'agency-a', 'property-1', {
    address: '1 Inspection Street',
    clientIds: [],
    status: 'active',
  }, 'admin-1');
  return repository.create('inspectionJobs', 'agency-a', id, {
    propertyId: 'property-1',
    reportType,
    status: 'assigned',
    assignedInspectorId: 'inspector-1',
    ...extra,
  }, 'admin-1');
}

function orphanAggregate(jobId: string): ReportAggregate {
  return {
    report: {
      id: `report-${jobId}`,
      agencyId: 'agency-a',
      propertyId: 'property-1',
      inspectionJobId: jobId,
      reportType: 'Property Condition Report',
      propertyAddress: '1 Inspection Street',
      lifecycleStatus: 'draft',
      templateId: 'system-entry-v1',
      templateVersion: 1,
      version: 1,
    },
    areas: areas as ReportAggregate['areas'],
  };
}

describe('inspection report creation command', () => {
  it('creates an Entry PCR with an immutable template binding and tenant review enabled', async () => {
    const repository = new MemoryRepository();
    await seedJob(repository, 'entry-1', 'Property Condition Report');
    const reports = new MemoryReportStore();

    const response = await request(dependencies(repository, reports), 'entry-1', {
      expectedJobVersion: 1,
      clientName: 'Owner One',
      inspectionDate: '2026-08-17',
      areas,
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      data: {
        report: {
          id: 'report-entry-1',
          reportType: 'Property Condition Report',
          templateId: 'system-entry-v1',
          templateVersion: 1,
          lifecycleStatus: 'draft',
        },
      },
      meta: { inspectionType: 'entry' },
    });
    expect(await repository.get('inspectionJobs', 'agency-a', 'entry-1')).toMatchObject({
      reportId: 'report-entry-1',
      templateId: 'system-entry-v1',
      tenantResponseRequired: true,
      version: 2,
    });
  });

  it('creates a Routine report with the Routine policy and no tenant review by default', async () => {
    const repository = new MemoryRepository();
    await seedJob(repository, 'routine-1', 'Routine Inspection');

    const response = await request(dependencies(repository), 'routine-1', {
      expectedJobVersion: 1,
      areas,
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      data: { report: { id: 'report-routine-1', reportType: 'Routine Inspection', templateId: 'system-routine-v1' } },
      meta: { inspectionType: 'routine' },
    });
    expect(await repository.get('inspectionJobs', 'agency-a', 'routine-1')).toMatchObject({
      tenantResponseRequired: false,
      version: 2,
    });
  });

  it('refuses Exit report creation when no immutable Entry baseline exists for the property and tenancy', async () => {
    const repository = new MemoryRepository();
    await repository.create('tenancies', 'agency-a', 'tenancy-1', {
      propertyId: 'property-1',
      tenantNames: ['Tenant One'],
      tenantEmails: ['tenant@example.test'],
      status: 'active',
    }, 'admin-1');
    await seedJob(repository, 'exit-1', 'Exit Inspection', { tenancyId: 'tenancy-1' });

    const response = await request(dependencies(repository), 'exit-1', {
      expectedJobVersion: 1,
      areas,
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: 'ENTRY_BASELINE_REQUIRED' } });
  });

  it('enforces the current inspection job version before creating a report', async () => {
    const repository = new MemoryRepository();
    await seedJob(repository, 'entry-stale', 'Property Condition Report');

    const response = await request(dependencies(repository), 'entry-stale', {
      expectedJobVersion: 999,
      areas,
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'VERSION_CONFLICT' } });
  });

  it('returns the already-linked report on a safe retry instead of creating a duplicate', async () => {
    const repository = new MemoryRepository();
    await seedJob(repository, 'entry-retry', 'Property Condition Report');
    const reports = new MemoryReportStore();
    const deps = dependencies(repository, reports);

    const first = await request(deps, 'entry-retry', { expectedJobVersion: 1, areas });
    expect(first.status).toBe(201);
    server?.close();
    server = undefined;

    const second = await request(deps, 'entry-retry', { expectedJobVersion: 2, areas });
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({
      data: { report: { id: 'report-entry-retry' } },
      meta: { existing: true },
    });
    expect(reports.reports.size).toBe(1);
  });

  it('recovers the deterministic report link after a partial report-first write', async () => {
    const repository = new MemoryRepository();
    await seedJob(repository, 'entry-recover', 'Property Condition Report');
    const reports = new MemoryReportStore();
    reports.reports.set('agency-a:report-entry-recover', orphanAggregate('entry-recover'));

    const response = await request(dependencies(repository, reports), 'entry-recover', {
      expectedJobVersion: 1,
      areas,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { report: { id: 'report-entry-recover' } },
      meta: { existing: true, recovered: true },
    });
    expect(await repository.get('inspectionJobs', 'agency-a', 'entry-recover')).toMatchObject({
      reportId: 'report-entry-recover',
      templateId: 'system-entry-v1',
      version: 2,
    });
    expect(reports.reports.size).toBe(1);
  });
});
