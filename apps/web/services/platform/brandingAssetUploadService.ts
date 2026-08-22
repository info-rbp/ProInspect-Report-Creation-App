import type { BrandingAsset, BrandingAssetKind } from '@pcr/domain';
import { apiRequest } from '../apiClient';

const CHUNK_SIZE = 4 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);

async function digest(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function uploadChunks(file: File, uploadUrl: string): Promise<void> {
  let start = 0;
  while (start < file.size) {
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'content-type': file.type,
        'content-range': `bytes ${start}-${end - 1}/${file.size}`,
      },
      body: file.slice(start, end),
    });
    if (response.status === 308) {
      const range = response.headers.get('range');
      start = range ? Number(range.split('-').pop()) + 1 : end;
      continue;
    }
    if (!response.ok) throw new Error(`Branding asset upload failed with ${response.status}.`);
    start = file.size;
  }
}

export async function uploadBrandingAsset(
  agencyId: string,
  file: File,
  input: { kind?: BrandingAssetKind; name?: string; altText?: string } = {},
): Promise<BrandingAsset> {
  if (!ALLOWED_TYPES.has(file.type)) throw new Error('Branding assets must be PNG, JPEG, WebP or SVG.');
  if (file.size <= 0 || file.size > 5 * 1024 * 1024) throw new Error('Branding assets must be between 1 byte and 5 MB.');
  const sha256 = await digest(file);
  const session = await apiRequest<{
    uploadId: string;
    objectPath: string;
    resumableUploadUrl: string;
    expiresAt: string;
  }>(agencyId, '/api/v1/settings/branding/asset-uploads', {
    method: 'POST',
    body: {
      fileName: file.name,
      contentType: file.type,
      fileSize: file.size,
      sha256,
      kind: input.kind || 'logo',
      name: input.name || file.name,
      altText: input.altText || '',
    },
  });
  await uploadChunks(file, session.resumableUploadUrl);
  return apiRequest<BrandingAsset>(agencyId, `/api/v1/settings/branding/asset-uploads/${encodeURIComponent(session.uploadId)}/complete`, {
    method: 'POST',
    body: {},
  });
}
