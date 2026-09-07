import { createHash } from 'node:crypto';
import {
  applicationDefault,
  getApps,
  initializeApp,
} from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import type { UploadSessionRecord } from '@pcr/domain';
import { firestoreDb } from '../firestoreDatabase.js';
import { FirestorePhotoEvidenceStore } from './photoEvidenceStore.js';
import type {
  EvidenceFileRecord,
  EvidenceStore,
  EvidenceStoreCompletionInput,
  EvidenceStoreUploadInput,
  EvidenceUploadSessionRecord,
} from './types.js';

function adminApp() {
  return getApps()[0]
    ?? initializeApp({ credential: applicationDefault() });
}

function failure(
  code: string,
  status: number,
  message: string,
): Error {
  return Object.assign(new Error(message), { code, status });
}

function sessionRecord(
  value: UploadSessionRecord,
): EvidenceUploadSessionRecord {
  return {
    id: value.id,
    agencyId: value.agencyId,
    userId: value.issuedTo,
    bucketId: process.env.UPLOAD_BUCKET?.trim() ?? '',
    fileId: value.objectPath,
    originalFilename: value.originalFilename,
    mimeType: value.contentType,
    size: value.fileSize,
    checksum: value.sha256,
    expiresAt: value.expiresAt,
    status: value.status,
    ...(value.propertyId ? { propertyId: value.propertyId } : {}),
    ...(value.inspectionJobId ? { inspectionJobId: value.inspectionJobId } : {}),
    ...(value.reportId ? { reportId: value.reportId } : {}),
    ...(value.externalResourceType
      ? { entityType: String(value.externalResourceType) }
      : {}),
    ...(value.externalResourceId ? { entityId: value.externalResourceId } : {}),
  };
}

function assertScope(
  session: EvidenceUploadSessionRecord,
  input: {
    actorId: string;
    entityType: string;
    entityId: string;
  },
): void {
  if (session.userId !== input.actorId) {
    throw failure(
      'UPLOAD_SESSION_ACTOR_MISMATCH',
      403,
      'Evidence upload session does not belong to this access principal.',
    );
  }
  if (
    session.entityType !== input.entityType
    || session.entityId !== input.entityId
  ) {
    throw failure(
      'UPLOAD_SESSION_SCOPE_MISMATCH',
      403,
      'Evidence upload session does not belong to this resource.',
    );
  }
  if (Date.parse(session.expiresAt) <= Date.now()) {
    throw failure(
      'UPLOAD_SESSION_EXPIRED',
      409,
      'Evidence upload session has expired.',
    );
  }
}

export class FirestoreEvidenceStore implements EvidenceStore {
  private readonly evidence = new FirestorePhotoEvidenceStore();

  async getSession(
    agencyId: string,
    uploadId: string,
  ): Promise<EvidenceUploadSessionRecord> {
    const snapshot = await firestoreDb(adminApp())
      .doc(`agencies/${agencyId}/uploadSessions/${uploadId}`)
      .get();
    if (!snapshot.exists) {
      throw failure(
        'UPLOAD_SESSION_NOT_FOUND',
        404,
        'Evidence upload session was not found.',
      );
    }
    return sessionRecord(snapshot.data() as UploadSessionRecord);
  }

  async uploadBinary(
    input: EvidenceStoreUploadInput,
  ): Promise<EvidenceUploadSessionRecord> {
    const session = await this.getSession(input.agencyId, input.uploadId);
    assertScope(session, input);

    if (input.bytes.byteLength !== session.size) {
      throw failure(
        'EVIDENCE_SIZE_MISMATCH',
        422,
        'Uploaded evidence size does not match the issued session.',
      );
    }
    const digest = createHash('sha256').update(input.bytes).digest('hex');
    if (digest !== session.checksum) {
      throw failure(
        'EVIDENCE_HASH_MISMATCH',
        422,
        'Uploaded evidence does not match its declared SHA-256.',
      );
    }

    const bucketName = session.bucketId;
    if (!bucketName) {
      throw failure(
        'UPLOAD_BUCKET_REQUIRED',
        503,
        'UPLOAD_BUCKET is required before evidence upload.',
      );
    }

    await getStorage(adminApp())
      .bucket(bucketName)
      .file(session.fileId)
      .save(Buffer.from(input.bytes), {
        resumable: false,
        validation: false,
        contentType: input.contentType ?? session.mimeType,
        preconditionOpts: { ifGenerationMatch: 0 },
      });
    await this.evidence.markUploading(session.agencyId, session.id);
    return { ...session, status: 'uploading' };
  }

  async complete(
    input: EvidenceStoreCompletionInput,
  ): Promise<EvidenceFileRecord> {
    const session = await this.getSession(input.agencyId, input.uploadId);
    assertScope(session, input);
    const bucketName = session.bucketId;
    if (!bucketName) {
      throw failure(
        'UPLOAD_BUCKET_REQUIRED',
        503,
        'UPLOAD_BUCKET is required before evidence completion.',
      );
    }

    const file = getStorage(adminApp()).bucket(bucketName).file(session.fileId);
    let metadata;
    try {
      [metadata] = await file.getMetadata();
    } catch {
      throw failure(
        'EVIDENCE_OBJECT_NOT_FOUND',
        422,
        'Uploaded evidence object could not be verified.',
      );
    }
    const actualSize = Number(metadata.size);
    const [bytes] = await file.download({ validation: false });
    const actualHash = createHash('sha256').update(bytes).digest('hex');
    if (actualSize !== session.size) {
      throw failure(
        'EVIDENCE_SIZE_MISMATCH',
        422,
        'Uploaded evidence size does not match the issued session.',
      );
    }
    if (actualHash !== session.checksum) {
      throw failure(
        'EVIDENCE_HASH_MISMATCH',
        422,
        'Uploaded evidence does not match its declared SHA-256.',
      );
    }

    const completedAt = new Date().toISOString();
    const evidence = await this.evidence.complete(
      session.agencyId,
      session.id,
      {
        bucket: bucketName,
        objectPath: session.fileId,
        generation: String(metadata.generation ?? ''),
        ...(metadata.metageneration
          ? { metageneration: String(metadata.metageneration) }
          : {}),
        contentType: String(metadata.contentType ?? session.mimeType),
        size: actualSize,
        sha256: actualHash,
        completedAt,
      },
    );

    await firestoreDb(adminApp())
      .doc(`agencies/${session.agencyId}/photoEvidence/${evidence.id}`)
      .set(
        {
          source: input.source,
          entityType: input.entityType,
          entityId: input.entityId,
          updatedAt: completedAt,
        },
        { merge: true },
      );

    return {
      id: evidence.id,
      agencyId: evidence.agencyId,
      bucketId: bucketName,
      fileId: evidence.objectPath,
      entityType: input.entityType,
      entityId: input.entityId,
      mimeType: evidence.contentType,
      originalFilename: evidence.originalFilename,
      size: evidence.fileSize,
      checksum: evidence.sha256,
      uploadedBy: evidence.uploadedBy,
      createdAt: evidence.createdAt,
      updatedAt: evidence.updatedAt,
      generation: evidence.generation ?? evidence.objectPath,
      ...(evidence.propertyId ? { propertyId: evidence.propertyId } : {}),
    };
  }
}
