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
    const record: StoredRecord = { ...data, id, agencyId, version: 1, createdAt: timestamp, updatedAt: timestamp, createdBy: actorId, updatedBy: actorId };
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

class EmptyReportStore implements ReportAggregateStore {
  async load(_agencyId: string, _reportId: string): Promise<ReportAggregate | undefined> { return undefined; }
  async saveDraft(aggregate: ReportAggregate): Promise<ReportAggregate> { return aggregate; }
  async transition(_agencyId: string, _command: ReportTransitionCommand): Promise<Record<string, unknown>> { return {}; }
}

function dependencies(repository = new MemoryRepository()): ApiDependencies {
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

function headers(key: string) {
  return {
    authorization: 'Bearer token',
    'content-type': 'application/json',
    'x-agency-id': 'agency-a',
    'idempotency-key': key,
  };
}

describe('Client management API', () => {
  it('creates a canonical Client Account with dedicated Client permissions', async () => {
    const response = await request(dependencies(), '/api/v1/clients', {
      method: 'POST',
      headers: headers('client-create-0001'),
      body: JSON.stringify({
        id: 'client-1',
        legalName: 'Example Property Management Pty Ltd',
        clientType: 'property_management_firm',
        entityType: 'property_management_agency',
        billingProfile: { method: 'account' },
        status: 'onboarding',
      }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ data: { id: 'client-1', legalName: 'Example Property Management Pty Ltd', status: 'onboarding' } });
  });

  it('resolves Property context from current Client relationships', async () => {
    const repository = new MemoryRepository();
    await repository.create('properties', 'agency-a', 'property-1', { address: '1 Test Street', clientIds: [] }, 'admin-1');
    await repository.create('clients', 'agency-a', 'client-1', {
      legalName: 'Example PM', clientType: 'property_management_firm', entityType: 'property_management_agency',
      status: 'active', primaryContactId: 'contact-1', billingProfile: { method: 'account' },
    }, 'admin-1');
    await repository.create('clientContacts', 'agency-a', 'contact-1', {
      clientAccountId: 'client-1', displayName: 'Sarah Manager', email: 'sarah@example.test', roles: ['property_manager'],
      isPrimary: true, receivesReports: true, receivesMaintenance: true, canApproveMaintenance: true, status: 'active',
    }, 'admin-1');
    await repository.create('propertyClientRelationships', 'agency-a', 'relationship-1', {
      propertyId: 'property-1', clientAccountId: 'client-1', relationshipType: 'managing_agent', primaryContactId: 'contact-1', isCurrent: true,
    }, 'admin-1');
    const response = await request(dependencies(repository), '/api/v1/client-management/property-context/property-1', {
      headers: { authorization: 'Bearer token', 'x-agency-id': 'agency-a' },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { snapshot: { clientAccountId: 'client-1', clientName: 'Example PM', propertyManager: { name: 'Sarah Manager' } } } });
  });

  it('synchronises canonical Client relationships back to Property compatibility references', async () => {
    const repository = new MemoryRepository();
    await repository.create('properties', 'agency-a', 'property-1', { address: '1 Test Street', clientIds: [] }, 'admin-1');
    await repository.create('clients', 'agency-a', 'client-1', {
      legalName: 'Private Owner', clientType: 'private_landlord', entityType: 'individual', status: 'active',
      primaryContactId: 'contact-1', billingProfile: { method: 'invoice_per_inspection' },
    }, 'admin-1');
    await repository.create('clientContacts', 'agency-a', 'contact-1', {
      clientAccountId: 'client-1', displayName: 'Private Owner', email: 'owner@example.test', roles: ['owner_landlord'],
      isPrimary: true, receivesReports: true, receivesMaintenance: true, canApproveMaintenance: true, status: 'active',
    }, 'admin-1');
    await repository.create('propertyClientRelationships', 'agency-a', 'relationship-1', {
      propertyId: 'property-1', clientAccountId: 'client-1', relationshipType: 'owner', primaryContactId: 'contact-1', isCurrent: true,
    }, 'admin-1');
    const deps = dependencies(repository);
    const response = await request(deps, '/api/v1/client-management/property-context/property-1/sync', {
      method: 'POST', headers: headers('client-sync-0001'), body: '{}',
    });
    expect(response.status).toBe(200);
    const property = await repository.get('properties', 'agency-a', 'property-1');
    expect(property).toMatchObject({ clientIds: ['client-1'], currentClientRelationshipIds: ['relationship-1'], clientMigrationStatus: 'migrated' });
  });

  it('blocks activation until the minimum onboarding identity, contact and billing gates exist', async () => {
    const repository = new MemoryRepository();
    await repository.create('clients', 'agency-a', 'client-1', {
      legalName: 'Incomplete Client', clientType: 'private_landlord', entityType: 'individual', status: 'onboarding',
    }, 'admin-1');
    const response = await request(dependencies(repository), '/api/v1/client-management/clients/client-1/actions/activate', {
      method: 'POST', headers: headers('client-activate-0001'), body: JSON.stringify({ expectedVersion: 1 }),
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: 'CLIENT_ONBOARDING_INCOMPLETE' } });
  });

  it('dry-runs bulk onboarding and flags strong duplicate business identities', async () => {
    const repository = new MemoryRepository();
    await repository.create('clients', 'agency-a', 'client-existing', {
      legalName: 'Example Realty Pty Ltd', clientType: 'property_management_firm', entityType: 'property_management_agency',
      abn: '12345678901', status: 'active', billingProfile: { method: 'account' },
    }, 'admin-1');
    const response = await request(dependencies(repository), '/api/v1/client-management/bulk-import', {
      method: 'POST', headers: headers('client-import-0001'), body: JSON.stringify({ dryRun: true, rows: [{ legalName: 'Example Realty Pty Ltd', abn: '12 345 678 901', clientType: 'property_management_firm' }] }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { results: [{ status: 'linked_existing', clientAccountId: 'client-existing' }] } });
  });
});
