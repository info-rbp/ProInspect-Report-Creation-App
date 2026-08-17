import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import type { ExternalAccessGrant } from '@pcr/domain';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies } from './types.js';

type VersionedGrant = ExternalAccessGrant & { version: number };

function adminApp() {
  return getApps()[0] ?? initializeApp({ credential: applicationDefault() });
}

function hashToken(value: string): string {
  return createHash('sha256').update(value.trim()).digest('hex');
}

async function resolveGrant(rawToken: string): Promise<VersionedGrant> {
  const snapshot = await getFirestore(adminApp())
    .collectionGroup('externalAccessGrants')
    .where('tokenHash', '==', hashToken(rawToken))
    .limit(2)
    .get();
  if (snapshot.empty) throw new ApiError(401, 'INVALID_GRANT_TOKEN', 'Access link is invalid or expired.');
  if (snapshot.size !== 1) throw new ApiError(401, 'AMBIGUOUS_GRANT_TOKEN', 'Access link cannot be resolved safely.');
  const grant = snapshot.docs[0].data() as VersionedGrant;
  if (!['work_request', 'tenant_instruction'].includes(grant.resourceType)) throw new ApiError(403, 'GRANT_SCOPE_MISMATCH', 'This access link cannot upload evidence.');
  if (grant.revokedAt) throw new ApiError(401, 'GRANT_TOKEN_REVOKED', 'Access link has been revoked.');
  if (new Date(grant.expiresAt).getTime() <= Date.now()) throw new ApiError(401, 'GRANT_TOKEN_EXPIRED', 'Access link has expired.');
  return grant;
}

function bucketName(): string {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  if (!projectId) throw new ApiError(500, 'PROJECT_ID_REQUIRED', 'Project ID is required to verify uploaded evidence.');
  return process.env.UPLOAD_BUCKET || `${projectId}-uploads`;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

export async function routeExternalEvidenceCompletionRequest(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
): Promise<ApiResponse | undefined> {
  const parts = new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean);
  if (parts[0] !== 'api' || parts[1] !== 'v1' || parts[2] !== 'external' || parts[3] !== 'evidence' || !parts[4] || parts[5] !== 'upload-session' || !parts[6] || parts[7] !== 'complete') return undefined;
  if (req.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'External evidence completion requires POST.');

  const grant = await resolveGrant(decodeURIComponent(parts[4]));
  const uploadId = decodeURIComponent(parts[6]);
  const session = await dependencies.repository.get('uploadSessions', grant.agencyId, uploadId);
  if (!session) throw new ApiError(404, 'UPLOAD_SESSION_NOT_FOUND', 'External evidence upload session not found.');
  if (session.externalGrantId !== grant.id || session.externalResourceType !== grant.resourceType || session.externalResourceId !== grant.resourceId) {
    throw new ApiError(403, 'UPLOAD_SESSION_SCOPE_MISMATCH', 'Upload session does not belong to this external access grant.');
  }

  const objectPath = text(session.objectPath);
  const expectedSha = text(session.sha256).toLowerCase();
  const expectedSize = typeof session.size === 'number' ? session.size : Number(session.size);
  if (!objectPath || !/^[a-f0-9]{64}$/u.test(expectedSha) || !Number.isFinite(expectedSize)) {
    throw new ApiError(409, 'UPLOAD_SESSION_INVALID', 'Upload session is missing immutable provenance metadata.');
  }

  const file = getStorage(adminApp()).bucket(bucketName()).file(objectPath);
  const [metadata] = await file.getMetadata().catch(() => { throw new ApiError(409, 'EVIDENCE_OBJECT_NOT_FOUND', 'Uploaded evidence object is not available yet.'); });
  const generation = text(metadata.generation);
  const contentType = text(metadata.contentType) || text(session.contentType);
  const storedSize = Number(metadata.size ?? 0);
  if (!generation) throw new ApiError(409, 'EVIDENCE_GENERATION_MISSING', 'Uploaded evidence object has no immutable generation.');
  if (storedSize !== expectedSize) throw new ApiError(409, 'EVIDENCE_SIZE_MISMATCH', 'Uploaded evidence size does not match the issued session.');
  const [bytes] = await file.download();
  const actualSha = createHash('sha256').update(bytes).digest('hex');
  if (actualSha !== expectedSha) throw new ApiError(409, 'EVIDENCE_HASH_MISMATCH', 'Uploaded evidence SHA-256 does not match the issued session.');

  const database = getFirestore(adminApp());
  const evidenceRef = database.doc(`agencies/${grant.agencyId}/photoEvidence/${uploadId}`);
  const existing = await evidenceRef.get();
  if (existing.exists) {
    if (existing.get('sha256') !== actualSha || String(existing.get('generation') ?? '') !== generation || existing.get('objectPath') !== objectPath) {
      throw new ApiError(409, 'IMMUTABLE_EVIDENCE_CONFLICT', 'Canonical evidence already exists with different provenance.');
    }
    return { status: 200, body: { data: { photoId: uploadId, status: existing.get('status') ?? 'uploaded', objectPath, generation, sha256: actualSha }, meta: { correlationId, existing: true } } };
  }

  const now = new Date().toISOString();
  const evidence = {
    id: uploadId,
    agencyId: grant.agencyId,
    propertyId: text(session.propertyId),
    inspectionJobId: text(session.inspectionJobId),
    ...(text(session.reportId) ? { reportId: text(session.reportId) } : {}),
    ...(text(session.areaId) ? { areaId: text(session.areaId) } : {}),
    componentIds: stringArray(session.componentIds),
    objectPath,
    generation,
    sha256: actualSha,
    contentType,
    size: expectedSize,
    status: 'uploaded',
    source: 'external_portal',
    externalGrantId: grant.id,
    externalResourceType: grant.resourceType,
    externalResourceId: grant.resourceId,
    createdAt: text(session.createdAt) || now,
    uploadedAt: now,
    updatedAt: now,
  };
  await evidenceRef.create(evidence);
  await dependencies.repository.update('uploadSessions', grant.agencyId, uploadId, {
    status: 'uploaded',
    generation,
    sha256: actualSha,
    uploadedAt: now,
  }, session.version, `external:${grant.id}`);
  await dependencies.audit.append({
    id: randomUUID(), timestamp: now, actorId: `external:${grant.id}`, actorRole: 'external', agencyId: grant.agencyId,
    capability: 'upload.create', outcome: 'allowed', reason: 'external.evidence_uploaded', target: { agencyId: grant.agencyId }, correlationId,
    entityType: grant.resourceType, entityId: grant.resourceId, eventType: 'external.evidence_uploaded', metadata: { photoId: uploadId, objectPath, generation, sha256: actualSha },
  });
  return { status: 201, body: { data: { photoId: uploadId, status: 'uploaded', objectPath, generation, sha256: actualSha }, meta: { correlationId } } };
}
