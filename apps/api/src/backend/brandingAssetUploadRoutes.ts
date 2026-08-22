import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { getStorage } from 'firebase-admin/storage';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies } from './types.js';

const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);
const MAX_SIZE = 5 * 1024 * 1024;

function parts(req: IncomingMessage): string[] {
  return new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean);
}

function agencyHeader(req: IncomingMessage): string {
  const value = req.headers['x-agency-id']?.toString().trim();
  if (!value) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.');
  return value;
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (!chunks.length) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required');
    return value as Record<string, unknown>;
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }
}

function text(body: Record<string, unknown>, field: string, max = 500): string {
  const value = typeof body[field] === 'string' ? body[field].trim() : '';
  if (!value || value.length > max) throw new ApiError(400, 'FIELD_REQUIRED', `${field} is required and must be ${max} characters or fewer.`);
  return value;
}

function extension(fileName: string, contentType: string): string {
  const candidate = fileName.toLowerCase().split('.').pop() || '';
  if (/^(png|jpe?g|webp|svg)$/u.test(candidate)) return candidate === 'jpeg' ? 'jpg' : candidate;
  return contentType === 'image/png' ? 'png' : contentType === 'image/jpeg' ? 'jpg' : contentType === 'image/webp' ? 'webp' : 'svg';
}

function bucketName(): string {
  const value = process.env.BRANDING_BUCKET?.trim() || process.env.UPLOAD_BUCKET?.trim();
  if (!value) throw new ApiError(503, 'BRANDING_BUCKET_REQUIRED', 'BRANDING_BUCKET or UPLOAD_BUCKET must be configured before branding uploads are enabled.');
  return value;
}

export async function routeBrandingAssetUploadRequest(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
): Promise<ApiResponse | undefined> {
  const route = parts(req);
  if (route[0] !== 'api' || route[1] !== 'v1' || route[2] !== 'settings' || route[3] !== 'branding' || route[4] !== 'asset-uploads') return undefined;
  const agencyId = agencyHeader(req);

  if (req.method === 'POST' && route.length === 5) {
    const principal = await authenticateAndAuthorise(req, dependencies, 'settings.branding.manage', { agencyId }, correlationId);
    const body = await readJson(req);
    const fileName = text(body, 'fileName', 240);
    const contentType = text(body, 'contentType', 100).toLowerCase();
    const fileSize = Number(body.fileSize);
    const sha256 = text(body, 'sha256', 64).toLowerCase();
    if (!ALLOWED_TYPES.has(contentType)) throw new ApiError(400, 'BRANDING_ASSET_TYPE_INVALID', 'Branding assets must be PNG, JPEG, WebP or SVG.');
    if (!Number.isInteger(fileSize) || fileSize <= 0 || fileSize > MAX_SIZE) throw new ApiError(400, 'BRANDING_ASSET_SIZE_INVALID', 'Branding assets must be between 1 byte and 5 MB.');
    if (!/^[a-f0-9]{64}$/u.test(sha256)) throw new ApiError(400, 'BRANDING_ASSET_SHA_INVALID', 'sha256 must be a lowercase 64-character digest.');
    const kind = typeof body.kind === 'string' && ['logo', 'dark_logo', 'favicon', 'portal_logo', 'email_header', 'other'].includes(body.kind) ? body.kind : 'logo';
    const uploadId = randomUUID();
    const objectPath = `branding-assets/${agencyId}/${sha256}/${uploadId}.${extension(fileName, contentType)}`;
    const file = getStorage().bucket(bucketName()).file(objectPath);
    const [resumableUploadUrl] = await file.createResumableUpload({
      metadata: {
        contentType,
        metadata: { agencyId, uploadId, sha256, brandingAsset: 'true' },
      },
      preconditionOpts: { ifGenerationMatch: 0 },
    });
    const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
    await dependencies.repository.create('brandingAssetUploads', agencyId, uploadId, {
      fileName,
      contentType,
      fileSize,
      sha256,
      objectPath,
      kind,
      name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : fileName,
      altText: typeof body.altText === 'string' ? body.altText.trim() : '',
      status: 'issued',
      expiresAt,
    }, principal.uid);
    return { status: 201, body: { data: { uploadId, objectPath, resumableUploadUrl, expiresAt }, meta: { correlationId } } };
  }

  if (req.method === 'POST' && route[5] && route[6] === 'complete') {
    const principal = await authenticateAndAuthorise(req, dependencies, 'settings.branding.manage', { agencyId }, correlationId);
    const uploadId = route[5];
    const session = await dependencies.repository.get('brandingAssetUploads', agencyId, uploadId);
    if (!session) throw new ApiError(404, 'BRANDING_UPLOAD_NOT_FOUND', 'Branding upload session was not found.');
    if (session.status === 'completed' && typeof session.assetId === 'string') {
      const existing = await dependencies.repository.get('brandingAssets', agencyId, session.assetId);
      return { status: 200, body: { data: existing, meta: { correlationId } } };
    }
    if (Date.parse(String(session.expiresAt || '')) < Date.now()) throw new ApiError(410, 'BRANDING_UPLOAD_EXPIRED', 'Branding upload session has expired.');
    const file = getStorage().bucket(bucketName()).file(String(session.objectPath));
    const [metadata] = await file.getMetadata();
    const generation = String(metadata.generation || '');
    const actualSize = Number(metadata.size || 0);
    if (!generation || actualSize !== Number(session.fileSize)) throw new ApiError(422, 'BRANDING_ASSET_UPLOAD_INCOMPLETE', 'Uploaded branding asset size does not match the issued session.');
    const [bytes] = await file.download({ validation: false });
    const actualSha = createHash('sha256').update(bytes).digest('hex');
    if (actualSha !== session.sha256) {
      await file.delete({ ignoreNotFound: true }).catch(() => undefined);
      throw new ApiError(422, 'BRANDING_ASSET_HASH_MISMATCH', 'Uploaded branding asset does not match the declared SHA-256.');
    }
    const assetId = `brand-asset-${uploadId}`;
    const asset = await dependencies.repository.create('brandingAssets', agencyId, assetId, {
      kind: session.kind,
      name: session.name,
      contentType: session.contentType,
      objectPath: session.objectPath,
      sha256: actualSha,
      fileSize: actualSize,
      altText: session.altText,
      generation,
      status: 'active',
    }, principal.uid);
    await dependencies.repository.update('brandingAssetUploads', agencyId, uploadId, {
      status: 'completed',
      assetId,
      generation,
      completedAt: new Date().toISOString(),
    }, Number(session.version), principal.uid);
    return { status: 201, body: { data: asset, meta: { correlationId } } };
  }

  return undefined;
}
