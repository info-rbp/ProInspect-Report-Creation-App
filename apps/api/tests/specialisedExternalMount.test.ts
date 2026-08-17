import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import type { ReportAggregate } from '@pcr/domain';
import { createRequestHandler } from '../src/app.js';
import { MemoryIdempotencyStore } from '../src/backend/idempotency.js';
import type { ApiDependencies, OperationalRepository, Page, ReportAggregateStore, ReportTransitionCommand, StoredRecord } from '../src/backend/types.js';

class MemoryRepository implements OperationalRepository {
  async list(): Promise<Page<StoredRecord>> { return { items: [] }; }
  async get(): Promise<StoredRecord | undefined> { return undefined; }
  async create(_collection: string, agencyId: string, id: string, data: Record<string, unknown>): Promise<StoredRecord> {
    const now = new Date().toISOString();
    return { ...data, id, agencyId, version: 1, createdAt: now, updatedAt: now };
  }
  async update(): Promise<StoredRecord> { throw new Error('not used'); }
}

class MemoryReports implements ReportAggregateStore {
  async load(): Promise<ReportAggregate | undefined> { return undefined; }
  async saveDraft(aggregate: ReportAggregate): Promise<ReportAggregate> { return aggregate; }
  async transition(_agencyId: string, _command: ReportTransitionCommand): Promise<Record<string, unknown>> { throw new Error('not used'); }
}

function dependencies(): ApiDependencies {
  return {
    requireAppCheck: false,
    identityVerifier: { verifyIdentityToken: async () => { throw new Error('not used'); }, verifyAppCheckToken: async () => undefined },
    memberships: { getMembership: async () => undefined },
    audit: { append: async () => undefined },
    repository: new MemoryRepository(),
    reports: new MemoryReports(),
    idempotency: new MemoryIdempotencyStore(),
    tasks: { dispatch: async () => undefined },
    uploads: { create: async (agencyId, uploadId, input) => ({ id: uploadId, agencyId, ...input, status: 'issued' as const }) },
  };
}

async function request(path: string) {
  const server = createServer(createRequestHandler(dependencies())).listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing server address.');
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`, { method: 'POST' });
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return response;
}

describe('external evidence completion API mount', () => {
  it('reaches the completion command before the upload-session creation route', async () => {
    const response = await request('/api/v1/external/evidence/not-a-valid-grant/upload-session/upload-1/complete');
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_GRANT_TOKEN' } });
  });
});
