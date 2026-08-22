import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import type { ReportAggregate } from '@pcr/domain';
import {
  createAreaComponentAssignment,
  type CatalogueAreaVersionView,
  type CatalogueComponentVersionView,
  type CatalogueUsageImpact,
} from '@pcr/templates/catalogueAdmin';
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
    const record: StoredRecord = {
      ...existing,
      ...data,
      id,
      agencyId,
      version: expectedVersion + 1,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
      updatedBy: actorId,
    };
    this.records.set(this.key(collection, agencyId, id), record);
    return record;
  }
}

class MemoryReportStore implements ReportAggregateStore {
  async load(): Promise<ReportAggregate | undefined> { return undefined; }
  async saveDraft(aggregate: ReportAggregate): Promise<ReportAggregate> { return aggregate; }
  async transition(_agencyId: string, _command: ReportTransitionCommand): Promise<Record<string, unknown>> { return {}; }
}

function dependencies(repository: MemoryRepository): ApiDependencies {
  return {
    requireAppCheck: false,
    identityVerifier: {
      verifyIdentityToken: async () => ({ uid: 'admin-1', agencyId: 'agency-a', authTime: 1, issuedAt: 1, mfaVerified: true }),
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
    reports: new MemoryReportStore(),
    idempotency: new MemoryIdempotencyStore(),
    tasks: { dispatch: async () => undefined },
    uploads: { create: async (agencyId, uploadId, input) => ({ id: uploadId, agencyId, ...input, status: 'issued' as const }) },
  };
}

async function request(
  deps: ApiDependencies,
  path: string,
  options: { method?: 'GET' | 'POST' | 'PUT'; body?: Record<string, unknown>; key?: string } = {},
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
      ...(method !== 'GET'
        ? {
            'content-type': 'application/json',
            'idempotency-key': options.key ?? `catalogue-${Math.random().toString(36).slice(2)}-key`,
          }
        : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return response;
}

async function listComponents(deps: ApiDependencies): Promise<CatalogueComponentVersionView[]> {
  const response = await request(deps, '/api/v1/catalogue/components');
  expect(response.status).toBe(200);
  return (await response.json() as { data: CatalogueComponentVersionView[] }).data;
}

async function createArea(deps: ApiDependencies, id = 'inspection-porch'): Promise<CatalogueAreaVersionView> {
  const response = await request(deps, '/api/v1/catalogue/areas/drafts', {
    method: 'POST',
    body: { input: { id, name: 'Inspection Porch', category: 'external' } },
  });
  expect(response.status).toBe(201);
  return (await response.json() as { data: CatalogueAreaVersionView }).data;
}

describe('catalogue administration routes', () => {
  it('seeds the canonical catalogue as published immutable versioned records', async () => {
    const repository = new MemoryRepository();
    const deps = dependencies(repository);
    const response = await request(deps, '/api/v1/catalogue/areas?status=published&category=sleeping&q=bedroom');
    expect(response.status).toBe(200);
    const payload = await response.json() as { data: CatalogueAreaVersionView[] };
    expect(payload.data).toEqual([
      expect.objectContaining({
        definition: expect.objectContaining({ id: 'bedroom', code: 'AREA_BEDROOM', version: 1, status: 'published' }),
        immutable: true,
        systemDefault: true,
      }),
    ]);
    expect(await repository.get('catalogueAreas', 'agency-a', 'bedroom')).toMatchObject({ definitionVersion: 1, status: 'published' });
    expect(await repository.get('catalogueAreaVersions', 'agency-a', 'bedroom--v1')).toBeTruthy();
    expect(await repository.get('catalogueComponentVersions', 'agency-a', 'walls--v1')).toBeTruthy();
  });

  it('creates and edits Area drafts, assigns published Components, normalises order and publishes immutably', async () => {
    const repository = new MemoryRepository();
    const deps = dependencies(repository);
    const components = await listComponents(deps);
    const frontDoor = components.find((item) => item.definition.id === 'front-door' && item.definition.version === 1);
    const walls = components.find((item) => item.definition.id === 'walls' && item.definition.version === 1);
    expect(frontDoor).toBeTruthy();
    expect(walls).toBeTruthy();

    const area = await createArea(deps);
    const wallRule = createAreaComponentAssignment(area.definition, walls!.definition, 9, 'required');
    const doorRule = createAreaComponentAssignment(area.definition, frontDoor!.definition, 2, 'default');
    wallRule.evidenceDefaults = { ...wallRule.evidenceDefaults, componentPhotoRequired: true, minimumPhotos: 2 };
    wallRule.assessmentDefaults = { ...wallRule.assessmentDefaults, commentary: 'always' };

    const updateResponse = await request(deps, '/api/v1/catalogue/areas/inspection-porch/versions/1', {
      method: 'PUT',
      body: {
        expectedRecordVersion: area.recordVersion,
        definition: { ...area.definition, aliases: ['Inspection Porch', 'Front Porch'] },
        componentRules: [wallRule, doorRule],
      },
    });
    expect(updateResponse.status).toBe(200);
    const updated = (await updateResponse.json() as { data: CatalogueAreaVersionView }).data;
    expect(updated.componentRules.map((rule) => rule.order)).toEqual([1, 2]);
    expect(updated.componentRules[1]?.evidenceDefaults.minimumPhotos).toBe(2);
    expect(updated.componentRules[1]?.assessmentDefaults.commentary).toBe('always');

    const publishResponse = await request(deps, '/api/v1/catalogue/areas/inspection-porch/versions/1/actions/publish', {
      method: 'POST',
      body: { expectedRecordVersion: updated.recordVersion },
    });
    expect(publishResponse.status).toBe(200);
    const published = (await publishResponse.json() as { data: CatalogueAreaVersionView }).data;
    expect(published.definition.status).toBe('published');
    expect(published.immutable).toBe(true);
    expect(await repository.get('catalogueAreas', 'agency-a', 'inspection-porch')).toMatchObject({ definitionVersion: 1, status: 'published' });

    const forbidden = await request(deps, '/api/v1/catalogue/areas/inspection-porch/versions/1', {
      method: 'PUT',
      body: { expectedRecordVersion: published.recordVersion, definition: published.definition, componentRules: published.componentRules },
    });
    expect(forbidden.status).toBe(409);
    expect(await forbidden.json()).toMatchObject({ error: { code: 'CATALOGUE_AREA_IMMUTABLE' } });
  });

  it('duplicates published Area and Component definitions into editable next versions', async () => {
    const repository = new MemoryRepository();
    const deps = dependencies(repository);
    await listComponents(deps);

    const areaListResponse = await request(deps, '/api/v1/catalogue/areas?q=kitchen');
    const kitchen = ((await areaListResponse.json() as { data: CatalogueAreaVersionView[] }).data)
      .find((item) => item.definition.id === 'kitchen' && item.definition.version === 1)!;
    const duplicateAreaResponse = await request(deps, '/api/v1/catalogue/areas/kitchen/versions/1/actions/duplicate', {
      method: 'POST',
      body: { expectedRecordVersion: kitchen.recordVersion },
    });
    expect(duplicateAreaResponse.status).toBe(201);
    const kitchenV2 = (await duplicateAreaResponse.json() as { data: CatalogueAreaVersionView }).data;
    expect(kitchenV2).toMatchObject({ definition: { id: 'kitchen', version: 2, status: 'draft', source: 'duplicated' }, immutable: false });
    expect(kitchenV2.componentRules.length).toBe(kitchen.componentRules.length);

    const components = await listComponents(deps);
    const oven = components.find((item) => item.definition.id === 'oven-griller' && item.definition.version === 1)!;
    const duplicateComponentResponse = await request(deps, '/api/v1/catalogue/components/oven-griller/versions/1/actions/duplicate', {
      method: 'POST',
      body: { expectedRecordVersion: oven.recordVersion },
    });
    expect(duplicateComponentResponse.status).toBe(201);
    expect(await duplicateComponentResponse.json()).toMatchObject({
      data: { definition: { id: 'oven-griller', version: 2, status: 'draft', source: 'duplicated' }, immutable: false },
    });
  });

  it('creates, edits and publishes custom Components with operational and maintenance defaults', async () => {
    const repository = new MemoryRepository();
    const deps = dependencies(repository);
    const createResponse = await request(deps, '/api/v1/catalogue/components/drafts', {
      method: 'POST',
      body: { input: { id: 'pool-pump', name: 'Pool Pump', category: 'plumbing', operational: true, testable: true } },
    });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json() as { data: CatalogueComponentVersionView }).data;

    const updateResponse = await request(deps, '/api/v1/catalogue/components/pool-pump/versions/1', {
      method: 'PUT',
      body: {
        expectedRecordVersion: created.recordVersion,
        definition: {
          ...created.definition,
          aliases: ['Pool Pump', 'Swimming Pool Pump'],
          maintenanceCategory: 'pool',
          defaultTrade: 'Pool Technician',
        },
      },
    });
    expect(updateResponse.status).toBe(200);
    const updated = (await updateResponse.json() as { data: CatalogueComponentVersionView }).data;
    expect(updated.definition).toMatchObject({ operational: true, testable: true, maintenanceCategory: 'pool', defaultTrade: 'Pool Technician' });

    const publishResponse = await request(deps, '/api/v1/catalogue/components/pool-pump/versions/1/actions/publish', {
      method: 'POST',
      body: { expectedRecordVersion: updated.recordVersion },
    });
    expect(publishResponse.status).toBe(200);
    expect(await publishResponse.json()).toMatchObject({ data: { definition: { status: 'published' }, immutable: true } });
  });

  it('shows direct usage impact and requires explicit acknowledgement before retirement', async () => {
    const repository = new MemoryRepository();
    const deps = dependencies(repository);
    const areasResponse = await request(deps, '/api/v1/catalogue/areas?q=entry');
    const entry = ((await areasResponse.json() as { data: CatalogueAreaVersionView[] }).data)
      .find((item) => item.definition.id === 'entry' && item.definition.version === 1)!;

    await repository.create('templateVersions', 'agency-a', 'usage-template--v1', {
      templateId: 'usage-template',
      templateVersion: 1,
      status: 'published',
      areas: [{ id: 'entry', name: 'Entry', components: [] }],
    }, 'admin-1');
    await repository.create('maintenanceItems', 'agency-a', 'maintenance-1', {
      status: 'triaged',
      sourceAreaId: 'entry',
    }, 'admin-1');

    const impactResponse = await request(deps, '/api/v1/catalogue/areas/entry/versions/1/usage');
    expect(impactResponse.status).toBe(200);
    const impact = (await impactResponse.json() as { data: CatalogueUsageImpact }).data;
    expect(impact).toMatchObject({ templates: 1, maintenanceItems: 1, totalRecords: 2, hasPublishedDependencies: true });

    const blocked = await request(deps, '/api/v1/catalogue/areas/entry/versions/1/actions/retire', {
      method: 'POST',
      body: { expectedRecordVersion: entry.recordVersion },
    });
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ error: { code: 'CATALOGUE_USAGE_ACK_REQUIRED' } });

    const retiredResponse = await request(deps, '/api/v1/catalogue/areas/entry/versions/1/actions/retire', {
      method: 'POST',
      key: 'retire-entry-with-impact',
      body: { expectedRecordVersion: entry.recordVersion, acknowledgeUsageImpact: true },
    });
    expect(retiredResponse.status).toBe(200);
    expect(await retiredResponse.json()).toMatchObject({ data: { definition: { status: 'retired' } } });
    expect(await repository.get('catalogueAreas', 'agency-a', 'entry')).toMatchObject({ status: 'retired' });
  });
});
