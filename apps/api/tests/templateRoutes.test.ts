import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createInitialPcrTemplate, type InspectionTypeTemplate } from '@pcr/templates';
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

class MemoryRepository implements OperationalRepository {
  readonly records = new Map<string, StoredRecord>();
  private key(collection: string, agencyId: string, id: string) { return `${collection}:${agencyId}:${id}`; }
  async list(collection: string, agencyId: string): Promise<Page<StoredRecord>> {
    return { items: [...this.records.entries()].filter(([key]) => key.startsWith(`${collection}:${agencyId}:`)).map(([, value]) => value) };
  }
  async get(collection: string, agencyId: string, id: string) { return this.records.get(this.key(collection, agencyId, id)); }
  async create(collection: string, agencyId: string, id: string, data: Record<string, unknown>, actorId: string) {
    if (await this.get(collection, agencyId, id)) throw Object.assign(new Error('Record exists.'), { status: 409, code: 'ALREADY_EXISTS' });
    const now = new Date().toISOString();
    const record: StoredRecord = { ...data, id, agencyId, version: 1, createdAt: now, updatedAt: now, createdBy: actorId, updatedBy: actorId };
    this.records.set(this.key(collection, agencyId, id), record);
    return record;
  }
  async update(collection: string, agencyId: string, id: string, data: Record<string, unknown>, expectedVersion: number, actorId: string) {
    const existing = await this.get(collection, agencyId, id);
    if (!existing) throw Object.assign(new Error('Record not found.'), { status: 404, code: 'NOT_FOUND' });
    if (existing.version !== expectedVersion) throw Object.assign(new Error('Version conflict.'), { status: 409, code: 'VERSION_CONFLICT' });
    const updated: StoredRecord = { ...existing, ...data, id, agencyId, version: expectedVersion + 1, createdAt: existing.createdAt, updatedAt: new Date().toISOString(), updatedBy: actorId };
    this.records.set(this.key(collection, agencyId, id), updated);
    return updated;
  }
}

class MemoryReportStore implements ReportAggregateStore {
  readonly reports = new Map<string, ReportAggregate>();
  private key(agencyId: string, reportId: string) { return `${agencyId}:${reportId}`; }
  async load(agencyId: string, reportId: string) { return this.reports.get(this.key(agencyId, reportId)); }
  async saveDraft(aggregate: ReportAggregate): Promise<ReportAggregate> {
    const now = new Date().toISOString();
    const stored: ReportAggregate = { ...aggregate, report: { ...aggregate.report, version: 1, createdAt: now, updatedAt: now } };
    this.reports.set(this.key(aggregate.report.agencyId, aggregate.report.id), stored);
    return stored;
  }
  async transition(_agencyId: string, _command: ReportTransitionCommand): Promise<Record<string, unknown>> { throw new Error('Not used.'); }
}

function dependencies(repository: MemoryRepository, reports = new MemoryReportStore()): ApiDependencies {
  return {
    requireAppCheck: false,
    identityVerifier: {
      verifyIdentityToken: async () => ({ uid: 'admin-1', agencyId: 'agency-a', authTime: 1, issuedAt: 1, mfaVerified: true }),
      verifyAppCheckToken: async () => undefined,
    },
    memberships: { getMembership: async () => ({ uid: 'admin-1', agencyId: 'agency-a', role: 'proinspect_admin', status: 'active', mfaRequired: true, updatedAt: new Date().toISOString() }) },
    audit: { append: async () => undefined },
    repository,
    reports,
    idempotency: new MemoryIdempotencyStore(),
    tasks: { dispatch: async () => undefined },
    uploads: { create: async (agencyId, uploadId, input) => ({ id: uploadId, agencyId, ...input, status: 'issued' as const }) },
  };
}

async function request(
  deps: ApiDependencies,
  path: string,
  options: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH'; body?: Record<string, unknown>; key?: string } = {},
) {
  const server = createServer(createRequestHandler(deps)).listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing server address.');
  const method = options.method ?? 'GET';
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
    method,
    headers: {
      authorization: 'Bearer token',
      'x-agency-id': 'agency-a',
      ...(method !== 'GET' ? { 'content-type': 'application/json', 'idempotency-key': options.key ?? `template-${Math.random().toString(36).slice(2)}-key` } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return response;
}

function draft(id: string, version = 1): InspectionTypeTemplate {
  const base = createInitialPcrTemplate();
  return { ...base, id, version, status: 'draft', createdAt: new Date().toISOString(), publishedAt: undefined, retiredAt: undefined };
}

const reportAreas = [{
  id: 'entry',
  name: 'Entry',
  sequence: 1,
  photoReferences: [],
  components: [{
    id: 'front-door', component: 'Front Door', conditionCategory: 'unable_to_confirm', cleanlinessCategory: 'unable_to_confirm', workingStatus: 'not_applicable', testStatus: 'not_applicable', defects: [], maintenanceRequired: false, commentary: '', photoReferences: [], reviewStatus: 'draft', comparisonStatus: 'not_compared',
  }],
}];

async function createAndPublish(deps: ApiDependencies, template: InspectionTypeTemplate) {
  const createdResponse = await request(deps, '/api/v1/templates/drafts', { method: 'POST', body: { template } });
  expect(createdResponse.status).toBe(201);
  const created = (await createdResponse.json() as { data: InspectionTypeTemplate & { recordVersion: number } }).data;
  const publishResponse = await request(deps, `/api/v1/templates/${encodeURIComponent(template.id)}/versions/${template.version}/actions/publish`, {
    method: 'POST',
    body: { expectedRecordVersion: created.recordVersion },
  });
  expect(publishResponse.status).toBe(200);
  return (await publishResponse.json() as { data: InspectionTypeTemplate & { recordVersion: number } }).data;
}

describe('server authoritative templates', () => {
  it('seeds full published system defaults on first list', async () => {
    const repository = new MemoryRepository();
    const response = await request(dependencies(repository), '/api/v1/templates');
    expect(response.status).toBe(200);
    const payload = await response.json() as { data: Array<InspectionTypeTemplate & { recordVersion: number }> };
    expect(payload.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'system-entry-v1', version: 1, status: 'published', inspectionType: 'entry' }),
      expect.objectContaining({ id: 'system-routine-v1', version: 1, status: 'published', inspectionType: 'routine' }),
      expect.objectContaining({ id: 'system-exit-v1', version: 1, status: 'published', inspectionType: 'exit' }),
    ]));
    expect((await repository.get('templates', 'agency-a', 'system-entry-v1'))?.templateVersion).toBe(1);
    expect((await repository.get('templateVersions', 'agency-a', 'system-entry-v1--v1'))?.immutable).toBe(true);
  });

  it('creates, edits, publishes and then makes the published version immutable', async () => {
    const repository = new MemoryRepository();
    const deps = dependencies(repository);
    const template = draft('custom-entry');
    const createdResponse = await request(deps, '/api/v1/templates/drafts', { method: 'POST', body: { template } });
    const created = (await createdResponse.json() as { data: InspectionTypeTemplate & { recordVersion: number } }).data;
    expect(created.status).toBe('draft');

    const changed = { ...created, propertyType: 'apartment' };
    const updateResponse = await request(deps, '/api/v1/templates/custom-entry/versions/1', {
      method: 'PUT',
      body: { expectedRecordVersion: created.recordVersion, template: changed },
    });
    expect(updateResponse.status).toBe(200);
    const updated = (await updateResponse.json() as { data: InspectionTypeTemplate & { recordVersion: number } }).data;

    const publishResponse = await request(deps, '/api/v1/templates/custom-entry/versions/1/actions/publish', {
      method: 'POST',
      body: { expectedRecordVersion: updated.recordVersion },
    });
    expect(publishResponse.status).toBe(200);
    const published = (await publishResponse.json() as { data: InspectionTypeTemplate & { recordVersion: number } }).data;
    expect(published.status).toBe('published');
    expect(await repository.get('templates', 'agency-a', 'custom-entry')).toMatchObject({ templateId: 'custom-entry', templateVersion: 1, status: 'published' });

    const forbiddenEdit = await request(deps, '/api/v1/templates/custom-entry/versions/1', {
      method: 'PUT',
      body: { expectedRecordVersion: published.recordVersion, template: { ...published, status: 'draft' } },
    });
    expect(forbiddenEdit.status).toBe(409);
    expect(await forbiddenEdit.json()).toMatchObject({ error: { code: 'TEMPLATE_IMMUTABLE' } });
  });

  it('duplicates to a new draft version, publishes v2 and makes it the report binding pointer', async () => {
    const repository = new MemoryRepository();
    const reports = new MemoryReportStore();
    const deps = dependencies(repository, reports);
    const publishedV1 = await createAndPublish(deps, draft('custom-entry'));

    const duplicateResponse = await request(deps, '/api/v1/templates/custom-entry/versions/1/actions/duplicate', {
      method: 'POST',
      body: { expectedRecordVersion: publishedV1.recordVersion },
    });
    expect(duplicateResponse.status).toBe(201);
    const draftV2 = (await duplicateResponse.json() as { data: InspectionTypeTemplate & { recordVersion: number } }).data;
    expect(draftV2).toMatchObject({ id: 'custom-entry', version: 2, status: 'draft' });

    const publishV2 = await request(deps, '/api/v1/templates/custom-entry/versions/2/actions/publish', {
      method: 'POST',
      body: { expectedRecordVersion: draftV2.recordVersion },
    });
    expect(publishV2.status).toBe(200);
    expect(await repository.get('templates', 'agency-a', 'custom-entry')).toMatchObject({ templateId: 'custom-entry', templateVersion: 2, status: 'published' });

    await repository.create('properties', 'agency-a', 'property-1', { address: '1 Template Street', status: 'active' }, 'admin-1');
    await repository.create('inspectionJobs', 'agency-a', 'job-1', { propertyId: 'property-1', reportType: 'Property Condition Report', status: 'assigned', assignedInspectorId: 'inspector-1' }, 'admin-1');
    const reportResponse = await request(deps, '/api/v1/inspection-jobs/job-1/create-report', {
      method: 'POST',
      body: { expectedJobVersion: 1, areas: reportAreas },
    });
    expect(reportResponse.status).toBe(201);
    expect(await reportResponse.json()).toMatchObject({ data: { report: { templateId: 'custom-entry', templateVersion: 2 } } });
  });

  it('retires the current version and falls back to the previous published pointer', async () => {
    const repository = new MemoryRepository();
    const deps = dependencies(repository);
    const v1 = await createAndPublish(deps, draft('custom-retire'));
    const duplicateResponse = await request(deps, '/api/v1/templates/custom-retire/versions/1/actions/duplicate', { method: 'POST', body: { expectedRecordVersion: v1.recordVersion } });
    const v2Draft = (await duplicateResponse.json() as { data: InspectionTypeTemplate & { recordVersion: number } }).data;
    const v2PublishResponse = await request(deps, '/api/v1/templates/custom-retire/versions/2/actions/publish', { method: 'POST', body: { expectedRecordVersion: v2Draft.recordVersion } });
    const v2 = (await v2PublishResponse.json() as { data: InspectionTypeTemplate & { recordVersion: number } }).data;

    const retireResponse = await request(deps, '/api/v1/templates/custom-retire/versions/2/actions/retire', { method: 'POST', body: { expectedRecordVersion: v2.recordVersion } });
    expect(retireResponse.status).toBe(200);
    expect(await repository.get('templates', 'agency-a', 'custom-retire')).toMatchObject({ templateVersion: 1, status: 'published' });
  });

  it('blocks generic template mutations', async () => {
    const repository = new MemoryRepository();
    const deps = dependencies(repository);
    const response = await request(deps, '/api/v1/templates', { method: 'POST', body: { status: 'published' } });
    expect(response.status).toBe(405);
  });
});
