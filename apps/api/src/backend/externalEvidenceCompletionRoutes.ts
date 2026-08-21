import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import type { ExternalAccessGrant, UploadSessionRecord } from '@pcr/domain';
import { FirestorePhotoEvidenceStore } from './photoEvidenceStore.js';
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
  if (snapshot.empty) {
    throw new ApiError(401, 'INVALID_GRANT_TOKEN', 'Access link is invalid or expired.');
  }
  if (snapshot.size !== 1) {
    throw new ApiError(401, 'AMBIGUOUS_GRANT_TOKEN', 'Access link cannot be resolved safely.');
  }
  const grant = snapshot.docs[0].data() as VersionedGrant;
  if (!['work_request', 'tenant_instruction', 'report_distribution'].includes(String(grant.resourceType))) {
    throw new ApiError(403, 'GRANT_SCOPE_MISMATCH', 'This access link cannot complete evidence.');
  }
  if (grant.revokedAt) {
    throw new ApiError(401, 'GRANT_TOKEN_REVOKED', 'Access link has been revoked.');
  }
  if (new Date(grant.expiresAt).getTime() <= Date.now()) {
    throw new ApiError(401, 'GRANT_TOKEN_EXPIRED', 'Access link has expired.');
  }
  return grant;
}

export async function routeExternalEvidenceCompletionRequest(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
): Promise<ApiResponse | undefined> {
  const parts = new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean);
  if (
    parts.length !== 8 ||
    parts[0] !== 'api' ||
    parts[1] !== 'v1' ||
    parts[2] !== 'external' ||
    parts[3] !== 'evidence' ||
    !parts[4] ||
    parts[5] !== 'upload-session' ||
    !parts[6] ||
    parts[7] !== 'complete'
  ) {
    return undefined;
  }
  if (req.method !== 'POST') {
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'External evidence completion requires POST.');
  }

  const grant = await resolveGrant(decodeURIComponent(parts[4]));
  const uploadId = decodeURIComponent(parts[6]);
  const database = getFirestore(adminApp());
  const sessionSnapshot = await database
    .doc(`agencies/${grant.agencyId}/uploadSessions/${uploadId}`)
    .get();
  if (!sessionSnapshot.exists) {
    throw new ApiError(404, 'UPLOAD_SESSION_NOT_FOUND', 'Evidence upload session was not found.');
  }
  const session = sessionSnapshot.data() as UploadSessionRecord;
  if (
    session.externalGrantId !== grant.id ||
    String(session.externalResourceType) !== String(grant.resourceType) ||
    session.externalResourceId !== grant.resourceId
  ) {
    throw new ApiError(
      403,
      'UPLOAD_SESSION_SCOPE_MISMATCH',
      'Evidence upload session does not belong to this access grant.',
    );
  }
  if (session.status === 'expired' || new Date(session.expiresAt).getTime() <= Date.now()) {
    throw new ApiError(409, 'UPLOAD_SESSION_EXPIRED', 'Evidence upload session has expired.');
  }

  const projectId = process.env.GOOGLE_CLOUD_PROJECT?.trim();
  const bucketName = process.env.UPLOAD_BUCKET?.trim() || (projectId ? `${projectId}-uploads` : '');
  if (!bucketName) {
    throw new ApiError(
      503,
      'UPLOAD_BUCKET_REQUIRED',
      'UPLOAD_BUCKET is required before evidence completion.',
    );
  }

  const file = getStorage(adminApp()).bucket(bucketName).file(session.objectPath);
  let metadata;
  try {
    [metadata] = await file.getMetadata();
  } catch (error) {
    throw new ApiError(
      422,
      'EVIDENCE_OBJECT_NOT_FOUND',
      'Uploaded evidence object could not be verified.',
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
  const actualSize = Number(metadata.size);
  const generation = String(metadata.generation ?? '');
  const metageneration = String(metadata.metageneration ?? '');
  const contentType = String(metadata.contentType ?? session.contentType);
  if (!generation || !Number.isFinite(actualSize) || actualSize !== session.fileSize) {
    throw new ApiError(
      422,
      'EVIDENCE_SIZE_MISMATCH',
      'Uploaded evidence size does not match the issued session.',
      { expectedSize: session.fileSize, actualSize },
    );
  }

  const [bytes] = await file.download({ validation: false });
  const actualHash = createHash('sha256').update(bytes).digest('hex');
  if (actualHash !== session.sha256) {
    throw new ApiError(
      422,
      'EVIDENCE_HASH_MISMATCH',
      'Uploaded evidence does not match its declared SHA-256.',
      { expectedSha256: session.sha256, actualSha256: actualHash },
    );
  }

  const completedAt = new Date().toISOString();
  const evidence = await new FirestorePhotoEvidenceStore().complete(grant.agencyId, uploadId, {
    bucket: bucketName,
    objectPath: session.objectPath,
    generation,
    ...(metageneration ? { metageneration } : {}),
    contentType,
    size: actualSize,
    sha256: actualHash,
    completedAt,
  });

  await database.doc(`agencies/${grant.agencyId}/photoEvidence/${evidence.id}`).set(
    {
      source: 'external_portal',
      externalGrantId: grant.id,
      externalResourceType: String(grant.resourceType),
      externalResourceId: grant.resourceId,
      updatedAt: completedAt,
    },
    { merge: true },
  );

  await dependencies.audit.append({
    id: randomUUID(),
    timestamp: completedAt,
    actorId: `external:${grant.id}`,
    actorRole: 'external',
    agencyId: grant.agencyId,
    capability: 'upload.create',
    outcome: 'allowed',
    reason: 'external.evidence_upload_completed',
    target: { agencyId: grant.agencyId },
    correlationId,
    entityType: String(grant.resourceType),
    entityId: grant.resourceId,
    eventType: 'external.evidence_upload_completed',
    metadata: {
      photoId: evidence.id,
      uploadId,
      objectPath: evidence.objectPath,
      generation: evidence.generation,
      sha256: evidence.sha256,
    },
  });

  return {
    status: 201,
    body: {
      data: {
        photoId: evidence.id,
        objectPath: evidence.objectPath,
        generation: evidence.generation,
        sha256: evidence.sha256,
        contentType: evidence.contentType,
      },
      meta: { correlationId },
    },
  };
}
