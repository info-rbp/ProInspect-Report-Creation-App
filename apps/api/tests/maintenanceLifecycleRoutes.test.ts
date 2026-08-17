import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
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
    const now = new Date().toISOString();
    const record: StoredRecord = { ...data, id, agencyId, version: 1, createdAt: now, updatedAt: now, createdBy: data.createdBy ?? actorId };
    this.records.set(this.key(collection, agencyId, id), record);
    return record;
  }
  async update(collection: string, agencyId: string, id: string, data: Record<string, unknown>, expectedVersion: number, actorId: string) {
    const existing = await this.get(collection, agencyId, id);
    if (!existing) throw Object.assign(new Error('Record not found.'), { status: 404, code: 'NOT_FOUND' });
    if (existing.version !== expectedVersion) throw Object.assign(new Error('Version conflict.'), { status: 409, code: 'VERSION_CONFLICT' });
    const updated: StoredRecord = { ...existing, ...data, id, agencyId, version: expectedVersion + 1, updatedAt: new Date().toISOString(), updatedBy: actorId };
    this.records.set(this.key(collection, agencyId, id), updated);
    return updated;
  }
}

class EmptyReportStore implements ReportAggregateStore {
  async load(): Promise<ReportAggregate | undefined> { return undefined; }
  async saveDraft(): Promise<ReportAggregate> { throw new Error('Not used.'); }
  async transition(_agencyId: string, _command: ReportTransitionCommand): Promise<Record<string, unknown>> { throw new Error('Not used.'); }
}

function dependencies(repository: MemoryRepository): ApiDependencies {
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
    reports: new EmptyReportStore(),
    idempotency: new MemoryIdempotencyStore(),
    tasks: { dispatch: async () => undefined },
    uploads: { create: async (agencyId, uploadId, input) => ({ id: uploadId, agencyId, ...input, status: 'issued' as const }) },
  };
}

async function request(
  deps: ApiDependencies,
  path: string,
  body: Record<string, unknown>,
  options: { method?: 'POST' | 'PATCH'; idempotencyKey?: string } = {},
) {
  const server = createServer(createRequestHandler(deps)).listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing server address.');
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
    method: options.method ?? 'POST',
    headers: {
      authorization: 'Bearer token',
      'content-type': 'application/json',
      'x-agency-id': 'agency-a',
      'idempotency-key': options.idempotencyKey ?? `test-${Math.random().toString(36).slice(2)}-key`,
    },
    body: JSON.stringify(body),
  });
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return response;
}

async function seed(repository: MemoryRepository) {
  await repository.create('properties', 'agency-a', 'property-1', { address: '1 Test Street', status: 'active' }, 'admin-1');
  await repository.create('tenancies', 'agency-a', 'tenancy-1', { propertyId: 'property-1', tenantEmails: ['tenant@example.test'], status: 'active' }, 'admin-1');
  await repository.create('externalContacts', 'agency-a', 'contractor-1', { name: 'Contractor One', email: 'contractor@example.test', type: 'contractor', status: 'active' }, 'admin-1');
}

describe('authoritative maintenance lifecycle routes', () => {
  it('forces a safe initial maintenance state and blocks generic writes', async () => {
    const repository = new MemoryRepository();
    await seed(repository);
    const deps = dependencies(repository);
    const createdResponse = await request(deps, '/api/v1/maintenance-items/create', {
      id: 'maintenance-1',
      propertyId: 'property-1',
      title: 'Leaking tap',
      description: 'Tap is leaking.',
      category: 'Plumbing',
      priority: 'routine',
      status: 'closed',
    });
    expect(createdResponse.status).toBe(201);
    expect(await createdResponse.json()).toMatchObject({ data: { id: 'maintenance-1', status: 'triage_required', verificationStatus: 'unverified' } });

    const genericPatch = await request(deps, '/api/v1/maintenance-items/maintenance-1', { status: 'closed', expectedVersion: 1 }, { method: 'PATCH' });
    expect(genericPatch.status).toBe(405);
    expect(await genericPatch.json()).toMatchObject({ error: { code: 'METHOD_NOT_ALLOWED' } });
  });

  it('replays a lifecycle command idempotently before optimistic version revalidation', async () => {
    const repository = new MemoryRepository();
    await seed(repository);
    const deps = dependencies(repository);
    await request(deps, '/api/v1/maintenance-items/create', {
      id: 'maintenance-replay', propertyId: 'property-1', title: 'Door adjustment', description: '', category: 'Doors / Locks', priority: 'routine',
    }, { idempotencyKey: 'create-maintenance-replay' });

    const first = await request(deps, '/api/v1/maintenance-items/maintenance-replay/actions/approve', { expectedVersion: 1 }, { idempotencyKey: 'approve-maintenance-replay' });
    expect(first.status).toBe(200);
    expect(first.headers.get('idempotency-replayed')).toBe('false');
    expect(await first.json()).toMatchObject({ data: { status: 'approved', version: 2 } });

    const replay = await request(deps, '/api/v1/maintenance-items/maintenance-replay/actions/approve', { expectedVersion: 1 }, { idempotencyKey: 'approve-maintenance-replay' });
    expect(replay.status).toBe(200);
    expect(replay.headers.get('idempotency-replayed')).toBe('true');
    expect(await replay.json()).toMatchObject({ data: { status: 'approved', version: 2 } });
  });

  it('requires client approval before approving an approval-required maintenance item', async () => {
    const repository = new MemoryRepository();
    await seed(repository);
    const deps = dependencies(repository);
    await request(deps, '/api/v1/maintenance-items/create', {
      id: 'maintenance-client-approval', propertyId: 'property-1', title: 'Replace appliance', description: '', category: 'Appliance', priority: 'high', approvalRequired: true,
    });
    const response = await request(deps, '/api/v1/maintenance-items/maintenance-client-approval/actions/approve', { expectedVersion: 1 });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'CLIENT_APPROVAL_REQUIRED' } });
  });

  it('creates and issues a work request only from approved maintenance', async () => {
    const repository = new MemoryRepository();
    await seed(repository);
    const deps = dependencies(repository);
    await request(deps, '/api/v1/maintenance-items/create', {
      id: 'maintenance-work', propertyId: 'property-1', title: 'Repair door', description: '', category: 'Doors / Locks', priority: 'routine', workInstruction: 'Adjust and test door operation.',
    });
    await request(deps, '/api/v1/maintenance-items/maintenance-work/actions/approve', { expectedVersion: 1 });
    await request(deps, '/api/v1/maintenance-items/maintenance-work/actions/assign', { expectedVersion: 2, externalContactId: 'contractor-1', workInstruction: 'Adjust and test door operation.' });

    const created = await request(deps, '/api/v1/work-requests/create', {
      id: 'work-1', maintenanceItemId: 'maintenance-work', externalContactId: 'contractor-1', instructions: 'Adjust and test door operation.', priority: 'routine', status: 'accepted',
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ data: { id: 'work-1', status: 'draft', version: 1 } });

    const issued = await request(deps, '/api/v1/work-requests/work-1/actions/issue', { expectedVersion: 1 });
    expect(issued.status).toBe(200);
    expect(await issued.json()).toMatchObject({ data: { status: 'issued', version: 2 } });

    const genericPatch = await request(deps, '/api/v1/work-requests/work-1', { status: 'accepted', expectedVersion: 2 }, { method: 'PATCH' });
    expect(genericPatch.status).toBe(405);
  });

  it('enforces the tenant instruction approval and issue sequence', async () => {
    const repository = new MemoryRepository();
    await seed(repository);
    const deps = dependencies(repository);
    const created = await request(deps, '/api/v1/tenant-instructions/create', {
      id: 'instruction-1', propertyId: 'property-1', tenancyId: 'tenancy-1', type: 'cleaning_request', title: 'Clean cooktop', instruction: 'Please clean the cooktop.', responseRequired: true, status: 'issued',
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ data: { status: 'draft', version: 1 } });

    const earlyIssue = await request(deps, '/api/v1/tenant-instructions/instruction-1/actions/issue', { expectedVersion: 1 });
    expect(earlyIssue.status).toBe(409);

    await request(deps, '/api/v1/tenant-instructions/instruction-1/actions/request_approval', { expectedVersion: 1 });
    await request(deps, '/api/v1/tenant-instructions/instruction-1/actions/approve', { expectedVersion: 2 });
    const issued = await request(deps, '/api/v1/tenant-instructions/instruction-1/actions/issue', { expectedVersion: 3 });
    expect(issued.status).toBe(200);
    expect(await issued.json()).toMatchObject({ data: { status: 'issued', version: 4 } });

    const genericPatch = await request(deps, '/api/v1/tenant-instructions/instruction-1', { status: 'closed', expectedVersion: 4 }, { method: 'PATCH' });
    expect(genericPatch.status).toBe(405);
  });
});
