import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { originalObjectPath, type AuthenticatedPrincipal, type UploadSessionRecord } from '@pcr/domain';
import type { TaskDispatcher, UploadSessionIssuer } from './types.js';
import { FirestorePhotoEvidenceStore } from './photoEvidenceStore.js';

function adminApp() {
  return getApps()[0] ?? initializeApp({ credential: applicationDefault() });
}

export class FirestoreTaskOutbox implements TaskDispatcher {
  async dispatch(kind: 'analysis' | 'pdf' | 'notification', agencyId: string, taskId: string, payload: Record<string, unknown>): Promise<void> {
    const now = new Date().toISOString();
    await getFirestore(adminApp()).doc(`agencies/${agencyId}/taskOutbox/${taskId}`).create({
      id: taskId,
      agencyId,
      kind,
      payload,
      status: 'pending',
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    });
  }
}

function extension(fileName: string): string {
  const value = fileName.split('.').pop();
  return value && value !== fileName ? value : 'bin';
}

export class FirebaseUploadSessionIssuer implements UploadSessionIssuer {
  private readonly evidence = new FirestorePhotoEvidenceStore();

  constructor(private readonly bucketName = process.env.UPLOAD_BUCKET) {}

  async create(agencyId: string, uploadId: string, input: Record<string, unknown>, principal: AuthenticatedPrincipal): Promise<Record<string, unknown>> {
    const fileName = String(input.fileName);
    const sha256 = String(input.sha256);
    const inspectionJobId = String(input.inspectionJobId);
    const existing = await this.evidence.findByHash(agencyId, inspectionJobId, sha256);
    const now = new Date().toISOString();
    if (existing) {
      return {
        id: uploadId,
        agencyId,
        status: 'duplicate',
        duplicatePhotoId: existing.id,
        objectPath: existing.objectPath,
        sha256,
        createdAt: now,
        updatedAt: now,
      };
    }

    const objectPath = originalObjectPath({
      agencyId,
      inspectionJobId,
      uploadSessionId: uploadId,
      sha256,
      extension: extension(fileName),
    });
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const session: UploadSessionRecord = {
      id: uploadId,
      agencyId,
      propertyId: String(input.propertyId),
      inspectionJobId,
      ...(typeof input.reportId === 'string' ? { reportId: input.reportId } : {}),
      ...(typeof input.areaId === 'string' ? { areaId: input.areaId } : {}),
      componentIds: Array.isArray(input.componentIds) ? input.componentIds.filter((value): value is string => typeof value === 'string') : [],
      originalFilename: fileName,
      contentType: String(input.contentType),
      fileSize: Number(input.size),
      sha256,
      objectPath,
      status: 'issued',
      issuedTo: principal.uid,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    };

    if (!this.bucketName) {
      await this.evidence.createSession(session);
      return { ...session, status: 'configuration_required', note: 'Set UPLOAD_BUCKET to the evidence bucket before enabling uploads.' };
    }

    const file = getStorage(adminApp()).bucket(this.bucketName).file(objectPath);
    const [resumableUploadUrl] = await file.createResumableUpload({
      metadata: {
        contentType: session.contentType,
        metadata: {
          agencyId,
          inspectionJobId,
          uploadSessionId: uploadId,
          sha256,
          immutableOriginal: 'true',
        },
      },
      preconditionOpts: { ifGenerationMatch: 0 },
    });
    session.resumableUploadUrl = resumableUploadUrl;
    await this.evidence.createSession(session);
    return session as unknown as Record<string, unknown>;
  }
}
