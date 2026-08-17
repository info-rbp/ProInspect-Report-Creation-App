import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import type { ReportAggregate } from '@pcr/domain';
import { routeLegacyBaselineRequest } from '../src/backend/legacyBaselineRoutes.js';
import { routeMaintenanceReportRequest } from '../src/backend/maintenanceReportRoutes.js';
import { MemoryIdempotencyStore } from '../src/backend/idempotency.js';
import type {
  ApiDependencies,
  OperationalRepository,
  Page,
  ReportAggregateStore,
  ReportTransitionCommand,
  StoredRecord,
} from '../src/backend/types.js';

class MemoryRepository implements OperationalRepository {
  readonly records = new Map<string, StoredRecord>();
  private key(collection: string, agencyId: string, id: string) { return `${collection}:${agencyId}:${id}`; }
  async list(collection: string, agencyId: string): Promise<Page<StoredRecord>> {
    return { items: [...this.records.entries()].filter(([key]) => key.startsWith(`${collection}:${agencyId}:`)).map(([, value]) => value) };
  }
  async get(collection: string, agencyId: string, id: string) { return this.records.get(this.key(collection, agencyId, id)); }
  async create(collection: string, agencyId: string, id: string, data: Record<string, unknown>, actorId: string) {
    const now = new Date().toISOString();
    const record: StoredRecord = { ...data, id, agencyId, version: 1, createdAt: now, updatedAt: now, createdBy: actorId };
    this.records.set(this.key(collection, agencyId, id), record);
    return record;
  }
  async update(collection: string, agencyId: string, id: string, data: Record<string, unknown>, expectedVersion: number, actorId: string) {
    const existing = await this.get(collection, agencyId, id);
    if (!existing) throw Object.assign(new Error('Not found.'), { status: 404, code: 'NOT_FOUND' });
    if (existing.version !== expectedVersion) throw Object.assign(new Error('Version conflict.'), { status: 409, code: 'VERSION_CONFLICT' });
    const updated = { ...existing, ...data, id, agencyId, version: expectedVersion + 1, updatedAt: new Date().toISOString(), updatedBy: actorId } as StoredRecord;
    this.records.set(this.key(collection, agencyId, id), updated);
    return updated;
  }
}

class MemoryReportStore implements ReportAggregateStore {
  readonly reports = new Map<string, ReportAggregate>();
  private key(agencyId: string, reportId: string) { return `${agencyId}:${reportId}`; }
  async load(agencyId: string, reportId: string) { return this.reports.get(this.key(agencyId, reportId)); }
  async saveDraft(aggregate: ReportAggregate, expectedVersion?: number) {
    const key = this.key(aggregate.report.agencyId, aggregate.report.id);
    const previous = this.reports.get(key);
    if (previous?.report.version && expectedVersion !== previous.report.version) throw Object.assign(new Error('Version conflict.'), { status: 409, code: 'VERSION_CONFLICT' });
    const now = new Date().toISOString();
    const stored: ReportAggregate = { ...aggregate, report: { ...aggregate.report, version: (previous?.report.version ?? 0) + 1, createdAt: previous?.report.createdAt ?? now, updatedAt: now } };
    this.reports.set(key, stored);
    return stored;
  }
  async transition(_agencyId: string, _command: ReportTransitionCommand): Promise<Record<string, unknown>> { throw new Error('Not used.'); }
}

function dependencies(repository = new MemoryRepository(), reports = new MemoryReportStore()): ApiDependencies {
  return {
    requireAppCheck: false,
    identityVerifier: { verifyIdentityToken: async () => ({ uid: 'admin-1', agencyId: 'agency-a', authTime: 1, issuedAt: 1, mfaVerified: true }), verifyAppCheckToken: async () => undefined },
    memberships: { getMembership: async () => ({ uid: 'admin-1', agencyId: 'agency-a', role: 'proinspect_admin', status: 'active', mfaRequired: true, updatedAt: new Date().toISOString() }) },
    audit: { append: async () => undefined },
    repository,
    reports,
    idempotency: new MemoryIdempotencyStore(),
    tasks: { dispatch: async () => undefined },
    uploads: { create: async (agencyId, uploadId, input) => ({ id: uploadId, agencyId, ...input, status: 'issued' as const }) },
  };
}

async function routeRequest(
  handler: Parameters<typeof createServer>[0],
  path: string,
  body: Record<string, unknown>,
) {
  const server = createServer(handler).listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing server address.');
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
    method: 'POST',
    headers: { authorization: 'Bearer token', 'x-agency-id': 'agency-a', 'content-type': 'application/json', 'idempotency-key': 'specialised-test-key' },
    body: JSON.stringify(body),
  });
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return response;
}

function writeResponse(res: Parameters<NonNullable<Parameters<typeof createServer>[0]>>[1], response: { status: number; body: unknown }) {
  res.writeHead(response.status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(response.body));
}

function legacyReport(): ReportAggregate {
  return {
    report: {
      id: 'exit-report-1', agencyId: 'agency-a', propertyId: 'property-1', tenancyId: 'tenancy-1', inspectionJobId: 'exit-job-1', reportType: 'Exit Inspection', propertyAddress: '1 Test Street', lifecycleStatus: 'draft', templateId: 'system-exit-v1', templateVersion: 1, baselineReportId: 'legacy:legacy-exit-report-1', baselineReportVersionId: 'legacy-exit-report-1', baselineQuality: 'legacy_unstructured', version: 1,
    },
    areas: [{ id: 'bathroom', name: 'Bathroom', sequence: 1, photoReferences: [], components: [{ id: 'mirror', component: 'Mirror', conditionCategory: 'intact', cleanlinessCategory: 'clean', workingStatus: 'not_applicable', testStatus: 'not_applicable', defects: [], maintenanceRequired: false, commentary: 'Current Exit observation.', photoReferences: [], reviewStatus: 'draft', comparisonStatus: 'unable_to_compare', comparisonMethod: 'legacy_mapping', comparisonConfidence: 0, comparisonReviewStatus: 'suggested' }] }],
  };
}

describe('reviewed legacy baseline mapping', () => {
  it('binds reviewed legacy facts to the stable Exit component and keeps comparison review required', async () => {
    const repository = new MemoryRepository();
    const reports = new MemoryReportStore();
    reports.reports.set('agency-a:exit-report-1', legacyReport());
    const deps = dependencies(repository, reports);
    const response = await routeRequest(async (req, res) => {
      try { writeResponse(res, (await routeLegacyBaselineRequest(req, deps, 'corr-1'))!); }
      catch (error) { const candidate = error as { status?: number; code?: string; message?: string }; writeResponse(res, { status: candidate.status ?? 500, body: { error: candidate } }); }
    }, '/api/v1/reports/exit-report-1/legacy-baseline', {
      expectedVersion: 1,
      source: { sourceId: 'legacy-entry-2025', sourceType: 'pdf', sourceName: 'Entry PCR 2025.pdf' },
      mappings: [{
        areaId: 'bathroom', componentId: 'mirror', sourceAreaLabel: 'Bathroom', sourceComponentLabel: 'Mirror', sourceExcerpt: 'Mirror clean and intact.',
        baseline: { conditionCategory: 'intact', cleanlinessCategory: 'clean', workingStatus: 'not_applicable', testStatus: 'not_applicable', commentary: 'Mirror clean and intact.', defects: [], photoReferences: [] },
        mappingMethod: 'legacy_mapping', confidence: 0.6, reviewNote: 'Direct label match reviewed against Entry PDF.',
      }],
    });
    expect(response.status).toBe(201);
    const payload = await response.json() as { data: ReportAggregate };
    expect(payload.data.report.baselineQuality).toBe('legacy_unstructured');
    expect(payload.data.areas[0].components[0]).toMatchObject({
      comparisonStatus: 'not_compared', comparisonMethod: 'legacy_mapping', comparisonConfidence: 0.6, comparisonReviewStatus: 'suggested',
      baselineComponentData: { conditionCategory: 'intact', cleanlinessCategory: 'clean' },
    });
    expect(await repository.get('legacyBaselineMappings', 'agency-a', 'legacy-exit-report-1')).toBeTruthy();
  });

  it('rejects a legacy operational confirmation without a passed test result', async () => {
    const reports = new MemoryReportStore();
    reports.reports.set('agency-a:exit-report-1', legacyReport());
    const deps = dependencies(new MemoryRepository(), reports);
    const response = await routeRequest(async (req, res) => {
      try { writeResponse(res, (await routeLegacyBaselineRequest(req, deps, 'corr-2'))!); }
      catch (error) { const candidate = error as { status?: number; code?: string; message?: string }; writeResponse(res, { status: candidate.status ?? 500, body: { error: candidate } }); }
    }, '/api/v1/reports/exit-report-1/legacy-baseline', {
      expectedVersion: 1,
      source: { sourceId: 'legacy-entry', sourceType: 'pdf', sourceName: 'Entry.pdf' },
      mappings: [{ areaId: 'bathroom', componentId: 'mirror', sourceAreaLabel: 'Bathroom', sourceComponentLabel: 'Mirror', baseline: { conditionCategory: 'intact', cleanlinessCategory: 'clean', workingStatus: 'operation_confirmed', testStatus: 'untested', commentary: '', defects: [] }, mappingMethod: 'legacy_mapping', confidence: 0.5 }],
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'LEGACY_OPERATION_UNSUPPORTED' } });
  });
});

describe('targeted maintenance follow-up report creation', () => {
  it('creates only the selected maintenance target and resets the current assessment conservatively', async () => {
    const repository = new MemoryRepository();
    const reports = new MemoryReportStore();
    await repository.create('properties', 'agency-a', 'property-1', { address: '1 Test Street', status: 'active' }, 'admin-1');
    await repository.create('maintenanceItems', 'agency-a', 'maintenance-1', {
      propertyId: 'property-1', title: 'Inspect exhaust fan', description: 'Fan operation requires follow-up.', category: 'Electrical', priority: 'routine', status: 'verified', sourceEvidenceIds: ['photo-before'], approvalRequired: false, approvalStatus: 'not_required', verificationStatus: 'verified',
    }, 'admin-1');
    const deps = dependencies(repository, reports);
    const response = await routeRequest(async (req, res) => {
      try { writeResponse(res, (await routeMaintenanceReportRequest(req, deps, 'corr-3'))!); }
      catch (error) { const candidate = error as { status?: number; code?: string; message?: string }; writeResponse(res, { status: candidate.status ?? 500, body: { error: candidate } }); }
    }, '/api/v1/maintenance-reports/create', { maintenanceItemIds: ['maintenance-1'], inspectionDate: '2026-08-17' });
    expect(response.status).toBe(201);
    const payload = await response.json() as { data: ReportAggregate };
    expect(payload.data.report.sourceMaintenanceItemIds).toEqual(['maintenance-1']);
    expect(payload.data.areas).toHaveLength(1);
    expect(payload.data.areas[0].components).toHaveLength(1);
    expect(payload.data.areas[0].components[0]).toMatchObject({
      conditionCategory: 'unable_to_confirm', cleanlinessCategory: 'unable_to_confirm', workingStatus: 'not_applicable', testStatus: 'not_applicable', comparisonStatus: 'unable_to_compare', reviewStatus: 'draft',
    });
    expect(payload.data.areas[0].components[0].baselineEvidencePhotoIds).toContain('photo-before');
    expect(await repository.get('inspectionJobs', 'agency-a', String(payload.data.report.inspectionJobId))).toBeTruthy();
  });

  it('rejects mixed-property maintenance items', async () => {
    const repository = new MemoryRepository();
    await repository.create('properties', 'agency-a', 'property-1', { address: 'A' }, 'admin-1');
    await repository.create('properties', 'agency-a', 'property-2', { address: 'B' }, 'admin-1');
    for (const [id, propertyId] of [['one', 'property-1'], ['two', 'property-2']] as const) {
      await repository.create('maintenanceItems', 'agency-a', id, { propertyId, title: id, description: '', category: 'General', priority: 'routine', status: 'verified', sourceEvidenceIds: [], approvalRequired: false, approvalStatus: 'not_required', verificationStatus: 'verified' }, 'admin-1');
    }
    const deps = dependencies(repository);
    const response = await routeRequest(async (req, res) => {
      try { writeResponse(res, (await routeMaintenanceReportRequest(req, deps, 'corr-4'))!); }
      catch (error) { const candidate = error as { status?: number; code?: string; message?: string }; writeResponse(res, { status: candidate.status ?? 500, body: { error: candidate } }); }
    }, '/api/v1/maintenance-reports/create', { maintenanceItemIds: ['one', 'two'] });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'MAINTENANCE_CONTEXT_MISMATCH' } });
  });
});
