import { createHash } from 'node:crypto';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { FirestorePhotoEvidenceStore } from './photoEvidenceStore.js';

export interface StorageObjectFinalisedEvent {
  bucket: string;
  name: string;
  generation: string;
  metageneration?: string;
  contentType?: string;
  size?: string;
  metadata?: Record<string, string>;
  timeCreated?: string;
}

function adminApp() {
  return getApps()[0] ?? initializeApp({ credential: applicationDefault() });
}

function eventError(code: string, status: number, message: string): Error {
  return Object.assign(new Error(message), { code, status });
}

export class OriginalEvidenceFinalisedHandler {
  constructor(private readonly evidence = new FirestorePhotoEvidenceStore()) {}

  async handle(event: StorageObjectFinalisedEvent): Promise<Record<string, unknown>> {
    const metadata = event.metadata ?? {};
    const agencyId = metadata.agencyId;
    const sessionId = metadata.uploadSessionId;
    if (!agencyId || !sessionId) throw eventError('UPLOAD_EVENT_METADATA_REQUIRED', 400, 'Original evidence event is missing agencyId or uploadSessionId metadata.');
    if (metadata.immutableOriginal !== 'true' || !event.name.startsWith(`inspection-originals/agencies/${agencyId}/`)) {
      throw eventError('UPLOAD_EVENT_PATH_INVALID', 400, 'Storage event is not an immutable original evidence object.');
    }

    const file = getStorage(adminApp()).bucket(event.bucket).file(event.name, { generation: Number(event.generation) });
    const [buffer] = await file.download();
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const photo = await this.evidence.complete(agencyId, sessionId, {
      bucket: event.bucket,
      objectPath: event.name,
      generation: event.generation,
      ...(event.metageneration ? { metageneration: event.metageneration } : {}),
      ...(event.contentType ? { contentType: event.contentType } : {}),
      ...(event.size ? { size: Number(event.size) } : {}),
      sha256,
      completedAt: event.timeCreated ?? new Date().toISOString(),
    });
    return { photoId: photo.id, processingStatus: photo.processingStatus, objectPath: photo.objectPath };
  }
}
