import { pendingPhotos, updatePhotoProgress, type LocalPhotoQueueItem } from './offlineWorkspace';

export interface UploadSessionResponse {
  id: string;
  status: string;
  resumableUploadUrl?: string;
  duplicatePhotoId?: string;
}

const CHUNK_SIZE = 8 * 1024 * 1024;

async function createSession(item: LocalPhotoQueueItem): Promise<UploadSessionResponse> {
  const response = await fetch('/api/v1/uploads', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-agency-id': item.agencyId,
      'idempotency-key': `photo-${item.id}`,
    },
    body: JSON.stringify({
      fileName: item.fileName,
      contentType: item.contentType,
      size: item.size,
      sha256: item.sha256,
      propertyId: item.propertyId,
      inspectionJobId: item.inspectionJobId,
      reportId: item.reportId,
      areaId: item.areaId,
      componentIds: item.componentIds,
    }),
  });
  if (!response.ok) throw new Error(`Upload session failed with ${response.status}.`);
  const payload = await response.json() as { data: UploadSessionResponse };
  return payload.data;
}

async function uploadChunk(item: LocalPhotoQueueItem, uploadUrl: string, start: number): Promise<number> {
  const end = Math.min(start + CHUNK_SIZE, item.size);
  const chunk = item.file.slice(start, end);
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'content-type': item.contentType,
      'content-range': `bytes ${start}-${end - 1}/${item.size}`,
    },
    body: chunk,
  });
  if (response.status === 308) {
    const range = response.headers.get('range');
    return range ? Number(range.split('-').pop()) + 1 : end;
  }
  if (!response.ok) throw new Error(`Resumable upload failed with ${response.status}.`);
  return item.size;
}

export async function syncPhoto(item: LocalPhotoQueueItem): Promise<void> {
  if (!navigator.onLine) return;
  try {
    let uploadUrl: string | undefined = item.resumableUploadUrl;
    if (!item.uploadSessionId || !uploadUrl) {
      const session = await createSession(item);
      if (session.status === 'duplicate') {
        await updatePhotoProgress(item.id, item.size, 'synced', { uploadSessionId: session.id });
        return;
      }
      if (!session.resumableUploadUrl) throw new Error('Upload service is not configured.');
      uploadUrl = session.resumableUploadUrl;
      await updatePhotoProgress(item.id, item.uploadedBytes, 'uploading', {
        uploadSessionId: session.id,
        resumableUploadUrl: uploadUrl,
      });
    }
    if (!uploadUrl) throw new Error('Resumable upload URL is missing.');
    const activeUploadUrl: string = uploadUrl;
    let uploadedBytes = item.uploadedBytes;
    while (uploadedBytes < item.size) {
      uploadedBytes = await uploadChunk(item, activeUploadUrl, uploadedBytes);
      await updatePhotoProgress(item.id, uploadedBytes, uploadedBytes === item.size ? 'synced' : 'uploading');
    }
  } catch (error) {
    await updatePhotoProgress(item.id, item.uploadedBytes, 'failed', {
      attempts: item.attempts + 1,
      error: error instanceof Error ? error.message : 'Upload failed.',
    });
  }
}

export async function syncPendingPhotos(jobId?: string): Promise<void> {
  for (const item of await pendingPhotos(jobId)) await syncPhoto(item);
}
