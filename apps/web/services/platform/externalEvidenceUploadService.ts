async function externalRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const baseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
  if (!baseUrl) throw new Error('VITE_API_BASE_URL is required for external portal operations.');
  const response = await fetch(`${baseUrl.replace(/\/$/u, '')}${path}`, init);
  const payload = await response.json().catch(() => ({})) as { data?: T; error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || `External evidence request failed with ${response.status}.`);
  if (payload.data === undefined) throw new Error('External evidence response did not contain data.');
  return payload.data;
}

async function fileSha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function contentTypeFor(file: File): 'image/jpeg' | 'image/png' | 'image/heic' | 'image/heif' {
  const declared = file.type.trim().toLowerCase();
  if (declared === 'image/jpeg' || declared === 'image/png' || declared === 'image/heic' || declared === 'image/heif') return declared;
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.heic')) return 'image/heic';
  if (lower.endsWith('.heif')) return 'image/heif';
  throw new Error('External evidence must be JPEG, PNG, HEIC or HEIF imagery.');
}

export interface ExternalEvidenceUploadResult {
  photoId: string;
  uploadSessionId: string;
  sha256?: string;
  generation?: string;
}

export async function uploadExternalEvidence(grantToken: string, file: File): Promise<ExternalEvidenceUploadResult> {
  const sha256 = await fileSha256(file);
  const contentType = contentTypeFor(file);
  const session = await externalRequest<{
    id: string;
    photoId: string;
    status: string;
    resumableUploadUrl?: string;
    binaryUploadUrl?: string;
    completionUrl?: string;
    duplicatePhotoId?: string;
  }>(`/api/v1/external/evidence/${encodeURIComponent(grantToken)}/upload-session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fileName: file.name, contentType, size: file.size, sha256 }),
  });

  if (session.status === 'duplicate' && session.duplicatePhotoId) {
    return { photoId: session.duplicatePhotoId, uploadSessionId: session.id, sha256 };
  }
  const baseUrl = import.meta.env.VITE_API_BASE_URL?.trim() || '';
  const uploadUrl = session.binaryUploadUrl ? `${baseUrl.replace(/\/$/u, '')}${session.binaryUploadUrl}` : session.resumableUploadUrl;
  if (!uploadUrl) throw new Error('Evidence upload service is not configured.');
  const upload = await fetch(uploadUrl, { method: 'PUT', headers: session.binaryUploadUrl ? { 'content-type': contentType } : { 'content-type': contentType, 'content-range': `bytes 0-${file.size - 1}/${file.size}` }, body: file });
  if (!upload.ok) throw new Error(`Evidence upload failed with ${upload.status}.`);
  const completionPath = session.completionUrl || `/api/v1/external/evidence/${encodeURIComponent(grantToken)}/upload-session/${encodeURIComponent(session.id)}/complete`;
  const completed = await externalRequest<{ photoId: string; sha256: string; generation: string }>(completionPath, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  return { photoId: completed.photoId, uploadSessionId: session.id, sha256: completed.sha256, generation: completed.generation };
}
