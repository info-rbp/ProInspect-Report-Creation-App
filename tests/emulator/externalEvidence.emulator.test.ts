import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { routeExternalEvidenceCompletionRequest } from '../../apps/api/src/backend/externalEvidenceCompletionRoutes.js';
import type {
  ApiDependencies,
  OperationalRepository,
  Page,
  ReportAggregateStore,
  ReportTransitionCommand,
  StoredRecord,
} from '../../apps/api/src/backend/types.js';
import type { ReportAggregate, UploadSessionRecord } from '@pcr/domain';
import { MemoryIdempotencyStore } from '../../apps/api/src/backend/idempotency.js';
import { FirestoreExternalGrantStore } from '../../apps/api/src/backend/firestoreExternalGrantStore.js';

class MemoryRepository implements OperationalRepository {
  readonly values = new Map<string, StoredRecord>();

  private key(collection: string, agencyId: string, id: string) {
    return `${collection}:${agencyId}:${id}`;
  }

  async list(collection: string, agencyId: string): Promise<Page<StoredRecord>> {
    return {
      items: [...this.values.entries()]
        .filter(([key]) => key.startsWith(`${collection}:${agencyId}:`))
        .map(([, value]) => value),
    };
  }

  async get(collection: string, agencyId: string, id: string) {
    return this.values.get(this.key(collection, agencyId, id));
  }

  async create(
    collection: string,
    agencyId: string,
    id: string,
    data: Record<string, unknown>,
    actorId: string,
  ) {
    const now = new Date().toISOString();
    const record = {
      ...data,
      id,
      agencyId,
      version: 1,
      createdAt: now,
      updatedAt: now,
      createdBy: actorId,
    } as StoredRecord;
    this.values.set(this.key(collection, agencyId, id), record);
    return record;
  }

  async update(
    collection: string,
    agencyId: string,
    id: string,
    data: Record<string, unknown>,
    expectedVersion: number,
    actorId: string,
  ) {
    const existing = await this.get(collection, agencyId, id);
    if (!existing) throw new Error('not found');
    if (existing.version !== expectedVersion) throw new Error('version conflict');
    const record = {
      ...existing,
      ...data,
      version: expectedVersion + 1,
      updatedAt: new Date().toISOString(),
      updatedBy: actorId,
    } as StoredRecord;
    this.values.set(this.key(collection, agencyId, id), record);
    return record;
  }
}

class MemoryReports implements ReportAggregateStore {
  async load(): Promise<ReportAggregate | undefined> {
    return undefined;
  }

  async saveDraft(aggregate: ReportAggregate): Promise<ReportAggregate> {
    return aggregate;
  }

  async transition(
    _agencyId: string,
    _command: ReportTransitionCommand,
  ): Promise<Record<string, unknown>> {
    throw new Error('not used');
  }
}

const auditEvents: unknown[] = [];

function dependencies(repository: MemoryRepository): ApiDependencies {
  return {
    requireAppCheck: false,
    identityVerifier: {
      verifyIdentityToken: async () => {
        throw new Error('not used');
      },
      verifyAppCheckToken: async () => undefined,
    },
    memberships: { getMembership: async () => undefined },
    audit: {
      append: async (event) => {
        auditEvents.push(event);
      },
    },
    repository,
    externalGrants:
      new FirestoreExternalGrantStore(),
    reports: new MemoryReports(),
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

async function request(deps: ApiDependencies, token: string, uploadId: string) {
  const server = createServer(async (req, res) => {
    try {
      const response = await routeExternalEvidenceCompletionRequest(req, deps, 'corr-external');
      if (!response) throw new Error('route not matched');
      res.writeHead(response.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(response.body));
    } catch (error) {
      const candidate = error as { status?: number; code?: string; message?: string };
      res.writeHead(candidate.status ?? 500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: candidate }));
    }
  }).listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing address');
  const response = await fetch(
    `http://127.0.0.1:${address.port}/api/v1/external/evidence/${encodeURIComponent(token)}/upload-session/${encodeURIComponent(uploadId)}/complete`,
    { method: 'POST' },
  );
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return response;
}

beforeAll(async () => {
  process.env.GOOGLE_CLOUD_PROJECT = 'demo-pcr';
  process.env.GCLOUD_PROJECT = 'demo-pcr';
  process.env.UPLOAD_BUCKET = 'demo-pcr-uploads';
  if (!getApps().length) initializeApp({ projectId: 'demo-pcr', storageBucket: 'demo-pcr-uploads' });
  const db = getFirestore();
  const existing = await db.collection('agencies').get();
  await Promise.all(existing.docs.map((document) => document.ref.delete()));
});

afterAll(async () => {
  await Promise.all(getApps().map((app) => deleteApp(app)));
});

describe('external evidence provenance', () => {
  it('creates canonical photoEvidence only after verifying exact object bytes', async () => {
    const token = 'valid-external-token-1234567890';
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const db = getFirestore();
    await db.doc('agencies/agency-a/externalAccessGrants/grant-1').set({
      id: 'grant-1',
      agencyId: 'agency-a',
      resourceType: 'work_request',
      resourceId: 'work-1',
      recipientEmail: 'contractor@example.test',
      tokenHash,
      expiresAt: '2099-01-01T00:00:00.000Z',
      version: 1,
    });

    const bytes = Buffer.from('canonical external evidence bytes');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const uploadId = 'upload-1';
    const objectPath =
      'agencies/agency-a/properties/property-1/jobs/job-1/evidence/upload-1/original/photo.jpg';
    await getStorage().bucket('demo-pcr-uploads').file(objectPath).save(bytes, {
      resumable: false,
      metadata: { contentType: 'image/jpeg' },
    });

    const issuedAt = new Date().toISOString();
    const session: UploadSessionRecord = {
      id: uploadId,
      agencyId: 'agency-a',
      propertyId: 'property-1',
      inspectionJobId: 'job-1',
      componentIds: ['component-1'],
      originalFilename: 'photo.jpg',
      contentType: 'image/jpeg',
      fileSize: bytes.length,
      sha256,
      objectPath,
      status: 'issued',
      issuedTo: 'external:grant-1',
      expiresAt: '2099-01-01T00:00:00.000Z',
      externalGrantId: 'grant-1',
      externalResourceType: 'work_request',
      externalResourceId: 'work-1',
      createdAt: issuedAt,
      updatedAt: issuedAt,
    };
    await db.doc(`agencies/agency-a/uploadSessions/${uploadId}`).set(session);

    const response = await request(dependencies(new MemoryRepository()), token, uploadId);
    expect(response.status).toBe(201);
    const evidence = await db.doc(`agencies/agency-a/photoEvidence/${uploadId}`).get();
    expect(evidence.exists).toBe(true);
    expect(evidence.data()).toMatchObject({
      id: uploadId,
      agencyId: 'agency-a',
      propertyId: 'property-1',
      inspectionJobId: 'job-1',
      objectPath,
      sha256,
      processingStatus: 'validating',
      source: 'external_portal',
      externalGrantId: 'grant-1',
    });
    expect(String(evidence.get('generation') ?? '')).not.toBe('');
    const completedSession = await db.doc(`agencies/agency-a/uploadSessions/${uploadId}`).get();
    expect(completedSession.data()).toMatchObject({
      status: 'completed',
      sha256,
    });
    expect(auditEvents.length).toBeGreaterThan(0);
  });

  it('rejects an expired grant before canonical evidence is created', async () => {
    const token = 'expired-external-token-1234567890';
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const db = getFirestore();
    await db.doc('agencies/agency-a/externalAccessGrants/grant-expired').set({
      id: 'grant-expired',
      agencyId: 'agency-a',
      resourceType: 'tenant_instruction',
      resourceId: 'instruction-1',
      recipientEmail: 'tenant@example.test',
      tokenHash,
      expiresAt: '2020-01-01T00:00:00.000Z',
      version: 1,
    });
    const response = await request(dependencies(new MemoryRepository()), token, 'missing-upload');
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'GRANT_TOKEN_EXPIRED' } });
  });
});
