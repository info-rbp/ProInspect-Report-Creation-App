import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { EvidenceUploadCompletion, PhotoEvidenceRecord, UploadSessionRecord } from '@pcr/domain';

function adminApp() {
  return getApps()[0] ?? initializeApp({ credential: applicationDefault() });
}

function failure(code: string, status: number, message: string, details?: Record<string, unknown>): Error {
  return Object.assign(new Error(message), { code, status, ...(details ? { details } : {}) });
}

function sessionRef(agencyId: string, sessionId: string) {
  return getFirestore(adminApp()).doc(`agencies/${agencyId}/uploadSessions/${sessionId}`);
}

function photoRef(agencyId: string, photoId: string) {
  return getFirestore(adminApp()).doc(`agencies/${agencyId}/photoEvidence/${photoId}`);
}

export class FirestorePhotoEvidenceStore {
  async findByHash(agencyId: string, inspectionJobId: string, sha256: string): Promise<PhotoEvidenceRecord | undefined> {
    const snapshot = await getFirestore(adminApp())
      .collection(`agencies/${agencyId}/photoEvidence`)
      .where('inspectionJobId', '==', inspectionJobId)
      .where('sha256', '==', sha256)
      .where('assetKind', '==', 'original')
      .limit(1)
      .get();
    return snapshot.empty ? undefined : snapshot.docs[0]?.data() as PhotoEvidenceRecord;
  }

  async createSession(session: UploadSessionRecord): Promise<void> {
    await sessionRef(session.agencyId, session.id).create(session);
  }

  async markUploading(agencyId: string, sessionId: string): Promise<void> {
    await sessionRef(agencyId, sessionId).update({ status: 'uploading', updatedAt: new Date().toISOString() });
  }

  async complete(agencyId: string, sessionId: string, completion: EvidenceUploadCompletion): Promise<PhotoEvidenceRecord> {
    return getFirestore(adminApp()).runTransaction(async (transaction) => {
      const reference = sessionRef(agencyId, sessionId);
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) throw failure('UPLOAD_SESSION_NOT_FOUND', 404, 'Upload session not found.');
      const session = snapshot.data() as UploadSessionRecord;
      if (session.agencyId !== agencyId || session.objectPath !== completion.objectPath) {
        throw failure('UPLOAD_COMPLETION_MISMATCH', 409, 'Upload completion does not match the issued object path.');
      }
      if (session.status === 'completed') {
        const existing = await transaction.get(photoRef(agencyId, session.id));
        if (!existing.exists) throw failure('PHOTO_METADATA_MISSING', 409, 'Completed upload metadata is missing.');
        return existing.data() as PhotoEvidenceRecord;
      }
      if (completion.sha256 && completion.sha256 !== session.sha256) {
        throw failure('PHOTO_HASH_MISMATCH', 422, 'Uploaded evidence hash does not match the declared hash.');
      }
      if (completion.size !== undefined && completion.size !== session.fileSize) {
        throw failure('PHOTO_SIZE_MISMATCH', 422, 'Uploaded evidence size does not match the declared size.');
      }
      const now = completion.completedAt;
      const photo: PhotoEvidenceRecord = {
        id: session.id,
        agencyId,
        propertyId: session.propertyId,
        inspectionJobId: session.inspectionJobId,
        ...(session.reportId ? { reportId: session.reportId } : {}),
        ...(session.areaId ? { areaId: session.areaId } : {}),
        componentIds: session.componentIds,
        originalFilename: session.originalFilename,
        objectPath: session.objectPath,
        storageArea: 'inspection-originals',
        contentType: session.contentType,
        fileSize: session.fileSize,
        sha256: session.sha256,
        uploadTimestamp: now,
        uploadedBy: session.issuedTo,
        assetKind: 'original',
        processingStatus: 'validating',
        generation: completion.generation,
        ...(completion.metageneration ? { metageneration: completion.metageneration } : {}),
        createdAt: now,
        updatedAt: now,
      };
      transaction.create(photoRef(agencyId, photo.id), photo);
      transaction.update(reference, { status: 'completed', updatedAt: now });
      transaction.create(getFirestore(adminApp()).doc(`agencies/${agencyId}/photoProcessingJobs/${photo.id}`), {
        id: photo.id,
        agencyId,
        photoId: photo.id,
        objectPath: photo.objectPath,
        sourceGeneration: completion.generation,
        status: 'queued',
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      });
      return photo;
    });
  }
}
