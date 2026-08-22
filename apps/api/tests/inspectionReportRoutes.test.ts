import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { ReportAggregate } from '@pcr/domain';
import {
  PROPERTY_LAYOUT_CATALOGUE_ID,
  PROPERTY_LAYOUT_CATALOGUE_VERSION,
  findSystemComponentDefinition,
  systemAreaComponentRulesForArea,
} from '@pcr/templates/propertyLayoutCatalogue';
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

function canonicalEntryRoom() {
  const rule = systemAreaComponentRulesForArea('entry', 1)
    .find((candidate) => candidate.componentDefinitionId === 'front-door');
  if (!rule) throw new Error('Canonical Entry Front Door rule is required by this test.');
  const component = findSystemComponentDefinition(rule.componentDefinitionId, rule.componentDefinitionVersion);
  if (!component) throw new Error('Canonical Front Door definition is required by this test.');
  return {
    id: 'area-entry-instance',
    name: 'Entry display label may change',
    roomType: 'hallway',
    floorLevel: 'Ground Floor',
    canonicalAreaDefinitionId: 'entry',
    canonicalAreaDefinitionVersion: 1,
    itemsPreset: [],
    componentRefs: [{
      id: 'area-entry-instance:component:front-door',
      name: component.name,
      canonicalComponentDefinitionId: component.id,
      canonicalComponentDefinitionVersion: component.version,
      canonicalAreaComponentRuleId: rule.id,
      canonicalAreaComponentRuleVersion: rule.version,
      order: rule.order,
      inclusion: rule.inclusion,
      photoRequired: rule.photoRequired,
    }],
  };
}

async function seedJob(repository: MemoryRepository, id: string, reportType: string, extra: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  const room = canonicalEntryRoom();
  await repository.create('properties', 'agency-a', 'property-1', {
    address: '1 Inspection Street',
    propertyUse: 'residential',
    physicalPropertyType: 'house',
    clientIds: [],
    status: 'active',
    roomsConfig: [room],
    currentLayoutVersionId: 'layout-1',
    layoutVersions: [{
      id: 'layout-1',
      version: 1,
      label: 'Layout v1',
      effectiveFrom: now,
      nodes: [],
      roomsConfig: [room],
      canonicalCatalogueId: PROPERTY_LAYOUT_CATALOGUE_ID,
      canonicalCatalogueVersion: PROPERTY_LAYOUT_CATALOGUE_VERSION,
      createdAt: now,
    }],
  }, 'admin-1');
  return repository.create('inspectionJobs', 'agency-a', id, {
    propertyId: 'property-1',
    reportType,
    status: 'assigned',
    assignedInspectorId: 'inspector-1',
    ...extra,
  }, 'admin-1');
}

const legacyAreas = [{
  id: 'area-entry-instance',
  name: 'Legacy Entry',
  sequence: 1,
  photoReferences: [],
  components: [{
    id: 'area-entry-instance:component:front-door',
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

function orphanAggregate(jobId: string): ReportAggregate {
  return {
    report: {
      id: `report-${jobId}`,
      agencyId: 'agency-a',
      propertyId: 'property-1',
      inspectionJobId: jobId,
      propertyLayoutVersionId: 'layout-1',
      reportType: 'Property Condition Report',
      propertyAddress: '1 Inspection Street',
      lifecycleStatus: 'draft',
      templateId: 'system-entry-v1',
      templateVersion: 1,
      version: 1,
    },
    areas: legacyAreas as ReportAggregate['areas'],
  };
}

describe('inspection report creation command', () => {
  it('creates an Entry PCR from the authoritative Property Layout and published canonical template', async () => {
    const repository = new MemoryRepository();
    await seedJob(repository, 'entry-1', 'Property Condition Report');
    const reports = new MemoryReportStore();

    const response = await request(dependencies(repository, reports), 'entry-1', {
      expectedJobVersion: 1,
      clientName: 'Owner One',
      inspectionDate: '2026-08-17',
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      data: {
        report: {
          id: 'report-entry-1',
          reportType: 'Property Condition Report',
          templateId: 'system-entry-v1',
          templateVersion: 1,
          propertyLayoutVersionId: 'layout-1',
          structureResolutionVersion: 1,
          templateStructureMode: 'property_layout_catalogue',
          lifecycleStatus: 'draft',
        },
        areas: [{
          id: 'area-entry-instance',
          canonicalAreaDefinitionId: 'entry',
          components: [{
            canonicalComponentDefinitionId: 'front-door',
            canonicalAreaComponentRuleId: 'entry:front-door',
          }],
        }],
      },
      meta: { inspectionType: 'entry', propertyLayoutVersionId: 'layout-1', structureResolutionVersion: 1 },
    });
    expect(await repository.get('inspectionJobs', 'agency-a', 'entry-1')).toMatchObject({
      reportId: 'report-entry-1',
      templateId: 'system-entry-v1',
      propertyLayoutVersionId: 'layout-1',
      tenantResponseRequired: true,
      version: 2,
    });
  });

  it('ignores forged client-supplied report structure and resolves the canonical server structure instead', async () => {
    const repository = new MemoryRepository();
    await seedJob(repository, 'entry-forged', 'Property Condition Report');

    const response = await request(dependencies(repository), 'entry-forged', {
      expectedJobVersion: 1,
      areas: [{
        id: 'evil-room',
        name: 'Totally Authoritative Bedroom, Trust Me',
        components: [{ id: 'cash-machine', component: 'Definitely Canonical' }],
      }],
    });

    expect(response.status).toBe(201);
    const payload = await response.json() as { data: ReportAggregate };
    expect(payload.data.areas.map((area) => area.id)).toEqual(['area-entry-instance']);
    expect(payload.data.areas[0].components.map((component) => component.canonicalComponentDefinitionId)).toEqual(['front-door']);
  });

  it('creates a Routine report with the Routine policy and no tenant review by default', async () => {
    const repository = new MemoryRepository();
    await seedJob(repository, 'routine-1', 'Routine Inspection');

    const response = await request(dependencies(repository), 'routine-1', {
      expectedJobVersion: 1,
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

  it('refuses report creation when the Property lacks a current versioned canonical layout', async () => {
    const repository = new MemoryRepository();
    await seedJob(repository, 'layout-required', 'Property Condition Report');
    const property = await repository.get('properties', 'agency-a', 'property-1');
    if (!property) throw new Error('property missing');
    await repository.update('properties', 'agency-a', 'property-1', {
      currentLayoutVersionId: undefined,
      layoutVersions: [],
    }, property.version, 'admin-1');

    const response = await request(dependencies(repository), 'layout-required', { expectedJobVersion: 1 });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: 'PROPERTY_LAYOUT_VERSION_REQUIRED' } });
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
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: 'ENTRY_BASELINE_REQUIRED' } });
  });

  it('enforces the current inspection job version before creating a report', async () => {
    const repository = new MemoryRepository();
    await seedJob(repository, 'entry-stale', 'Property Condition Report');

    const response = await request(dependencies(repository), 'entry-stale', {
      expectedJobVersion: 999,
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'VERSION_CONFLICT' } });
  });

  it('returns the already-linked report on a safe retry instead of creating a duplicate', async () => {
    const repository = new MemoryRepository();
    await seedJob(repository, 'entry-retry', 'Property Condition Report');
    const reports = new MemoryReportStore();
    const deps = dependencies(repository, reports);

    const first = await request(deps, 'entry-retry', { expectedJobVersion: 1 });
    expect(first.status).toBe(201);
    server?.close();
    server = undefined;

    const second = await request(deps, 'entry-retry', { expectedJobVersion: 2 });
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
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { report: { id: 'report-entry-recover' } },
      meta: { existing: true, recovered: true },
    });
    expect(await repository.get('inspectionJobs', 'agency-a', 'entry-recover')).toMatchObject({
      reportId: 'report-entry-recover',
      templateId: 'system-entry-v1',
      propertyLayoutVersionId: 'layout-1',
      version: 2,
    });
    expect(reports.reports.size).toBe(1);
  });
});
