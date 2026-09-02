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
  async list(
    collection: string,
    agencyId: string,
    _limit: number,
    _cursor?: string,
    filters: Record<string, string | number | boolean> = {},
  ): Promise<Page<StoredRecord>> {
    const items = [...this.records.entries()]
      .filter(([key]) => key.startsWith(`${collection}:${agencyId}:`))
      .map(([, value]) => value)
      .filter((record) => Object.entries(filters).every(([key, value]) => record[key] === value));
    return { items };
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
  input: {
    role?: SecurityRole;
    uid?: string;
    siteIds?: string[];
    propertyIds?: string[];
    clientAccountIds?: string[];
    contractorId?: string;
  } = {},
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
    audit: { append: async () => undefined },
    repository,
    reports: new EmptyReportStore(),
    idempotency: new MemoryIdempotencyStore(),
    tasks: { dispatch: async () => undefined },
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

function headers(key = 'platform-request-0001'): Record<string, string> {
  return {
    authorization: 'Bearer token',
    'content-type': 'application/json',
    'x-agency-id': 'agency-a',
    'idempotency-key': key,
  };
}

describe('Unified platform API', () => {
  it('returns the authoritative active membership for Appwrite browser bootstrap', async () => {
    const repository = new MemoryRepository();
    const response = await request(dependencies(repository, {
      role: 'client_user', uid: 'client-user-a', clientAccountIds: ['client-a'],
    }), '/api/v1/platform/membership/me', { headers: headers() });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        uid: 'client-user-a', agencyId: 'agency-a', role: 'client_user', clientAccountIds: ['client-a'],
      },
    });
  });

  it('self-scopes resident offer redemptions and rejects another resident record', async () => {
    const repository = new MemoryRepository();
    await repository.create('offerRedemptions', 'agency-a', 'redemption-other', {
      offerId: 'offer-1', userId: 'other-user', managedSiteId: 'site-a', status: 'created',
    }, 'admin-1');
    const deps = dependencies(repository, {
      role: 'resident_tenant', uid: 'resident-1', siteIds: ['site-a'], propertyIds: ['property-1'],
    });

    const created = await request(deps, '/api/v1/platform/offer-redemptions', {
      method: 'POST', headers: headers('redemption-create-0001'),
      body: JSON.stringify({ id: 'redemption-1', offerId: 'offer-1', managedSiteId: 'site-a', status: 'created' }),
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ data: { id: 'redemption-1', userId: 'resident-1' } });
    server?.close();

    const list = await request(deps, '/api/v1/platform/offer-redemptions?managedSiteId=site-a', {
      headers: { authorization: 'Bearer token', 'x-agency-id': 'agency-a' },
    });
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({ data: [{ id: 'redemption-1', userId: 'resident-1' }] });
  });

  it('returns only offers eligible for the resident managed site', async () => {
    const repository = new MemoryRepository();
    await repository.create('offers', 'agency-a', 'offer-a', {
      status: 'active', title: 'Site A offer', locationRules: JSON.stringify({ managedSiteIds: ['site-a'] }),
    }, 'admin-1');
    await repository.create('offers', 'agency-a', 'offer-b', {
      status: 'active', title: 'Site B offer', locationRules: JSON.stringify({ managedSiteIds: ['site-b'] }),
    }, 'admin-1');
    const deps = dependencies(repository, { role: 'resident_owner', uid: 'resident-1', siteIds: ['site-a'] });
    const response = await request(deps, '/api/v1/platform/offers?managedSiteId=site-a&status=active', {
      headers: { authorization: 'Bearer token', 'x-agency-id': 'agency-a' },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: [{ id: 'offer-a' }] });
  });

  it('creates a scoped conversation and appends a portal message', async () => {
    const repository = new MemoryRepository();
    const deps = dependencies(repository, { role: 'resident_tenant', uid: 'resident-1', siteIds: ['site-a'] });
    const created = await request(deps, '/api/v1/platform/conversations', {
      method: 'POST', headers: headers('conversation-create-0001'),
      body: JSON.stringify({
        id: 'conversation-1', managedSiteId: 'site-a', subject: 'Lift issue',
        linkedEntityType: 'resident_request', linkedEntityId: 'request-1', conversationState: 'open', status: 'active',
      }),
    });
    expect(created.status).toBe(201);
    server?.close();

    const message = await request(deps, '/api/v1/platform/conversations/conversation-1/messages', {
      method: 'POST', headers: headers('conversation-message-0001'),
      body: JSON.stringify({ body: 'The lift remains unavailable.', channel: 'portal' }),
    });
    expect(message.status).toBe(201);
    expect(await message.json()).toMatchObject({ data: { conversationId: 'conversation-1', senderId: 'resident-1' } });
  });

  it('forces notification preferences to the current user', async () => {
    const repository = new MemoryRepository();
    const deps = dependencies(repository, { role: 'client_user', uid: 'client-user-1', clientAccountIds: ['client-1'] });
    const created = await request(deps, '/api/v1/platform/notification-preferences', {
      method: 'POST', headers: headers('notification-preference-0001'),
      body: JSON.stringify({ id: 'preference-1', emailEnabled: true, smsEnabled: false, pushEnabled: true, urgentOverride: true, status: 'active' }),
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ data: { id: 'preference-1', userId: 'client-user-1' } });
  });

  it('allows an inspector to create only their own route plan', async () => {
    const repository = new MemoryRepository();
    const deps = dependencies(repository, { role: 'inspector', uid: 'inspector-1' });
    const own = await request(deps, '/api/v1/platform/route-plans', {
      method: 'POST', headers: headers('route-plan-create-0001'),
      body: JSON.stringify({ id: 'route-1', assignedUserId: 'inspector-1', routeDate: '2026-08-31T00:00:00.000Z', routeState: 'draft', status: 'active' }),
    });
    expect(own.status).toBe(201);
    server?.close();

    const other = await request(deps, '/api/v1/platform/route-plans', {
      method: 'POST', headers: headers('route-plan-create-0002'),
      body: JSON.stringify({ id: 'route-2', assignedUserId: 'inspector-2', routeDate: '2026-09-01T00:00:00.000Z', routeState: 'draft', status: 'active' }),
    });
    expect(other.status).toBe(403);
  });

  it('deduplicates offline receipts by idempotency key', async () => {
    const repository = new MemoryRepository();
    const deps = dependencies(repository, { role: 'building_manager', uid: 'bm-1', siteIds: ['site-a'] });
    const init = {
      method: 'POST', headers: headers('offline-receipt-0001'),
      body: JSON.stringify({
        id: 'receipt-1', deviceId: 'device-1', clientSubmissionId: 'submission-1',
        entityType: 'daily_activity_log', payloadHash: 'abc123', status: 'active',
      }),
    } satisfies RequestInit;
    const first = await request(deps, '/api/v1/platform/offline-sync-receipts', init);
    expect(first.status).toBe(201);
    expect(first.headers.get('idempotency-replayed')).toBe('false');
    server?.close();
    const replay = await request(deps, '/api/v1/platform/offline-sync-receipts', init);
    expect(replay.status).toBe(201);
    expect(replay.headers.get('idempotency-replayed')).toBe('true');
  });
});
