import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { AgencyBrandingProfile, BrandingAsset, DomainErrorShape, PublicAgencyBranding } from '@pcr/domain';
import { agencyBrandingProfileSchema } from '@pcr/validation';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies, StoredRecord } from './types.js';

function agencyHeader(req: IncomingMessage): string {
  const value = req.headers['x-agency-id']?.toString().trim();
  if (!value) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.');
  return value;
}

function routeParts(req: IncomingMessage): string[] {
  return new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 1_000_000) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 1 MB.');
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required');
    return value as Record<string, unknown>;
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }
}

function validate<T>(result: { ok: true; value: T } | { ok: false; error: DomainErrorShape }): T {
  if (!result.ok) throw new ApiError(result.error.status, result.error.code, result.error.message, result.error.details);
  return result.value;
}

async function listAll(dependencies: ApiDependencies, collection: string, agencyId: string): Promise<StoredRecord[]> {
  const values: StoredRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = await dependencies.repository.list(collection, agencyId, 100, cursor);
    values.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return values;
}

function expectedVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new ApiError(400, 'EXPECTED_VERSION_REQUIRED', 'expectedVersion must be a positive integer.');
  return value;
}

function brandingAsset(body: Record<string, unknown>, id: string): Omit<BrandingAsset, 'agencyId' | 'version' | 'createdAt' | 'updatedAt'> {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const kind = typeof body.kind === 'string' ? body.kind : '';
  const contentType = typeof body.contentType === 'string' ? body.contentType : '';
  if (!name) throw new ApiError(400, 'ASSET_NAME_REQUIRED', 'Branding asset name is required.');
  if (!['logo', 'dark_logo', 'favicon', 'portal_logo', 'email_header', 'other'].includes(kind)) throw new ApiError(400, 'ASSET_KIND_INVALID', 'Branding asset kind is not supported.');
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(contentType)) throw new ApiError(400, 'ASSET_CONTENT_TYPE_INVALID', 'Branding assets must be PNG, JPEG, WebP or SVG.');
  const publicUrl = typeof body.publicUrl === 'string' && body.publicUrl.trim() ? body.publicUrl.trim() : undefined;
  const objectPath = typeof body.objectPath === 'string' && body.objectPath.trim() ? body.objectPath.trim() : undefined;
  if (!publicUrl && !objectPath) throw new ApiError(400, 'ASSET_LOCATION_REQUIRED', 'Provide publicUrl or objectPath for the branding asset.');
  if (publicUrl) {
    try { const parsed = new URL(publicUrl); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('protocol'); } catch { throw new ApiError(400, 'ASSET_URL_INVALID', 'publicUrl must be a valid HTTP or HTTPS URL.'); }
  }
  const sha256 = typeof body.sha256 === 'string' ? body.sha256.trim().toLowerCase() : undefined;
  if (sha256 && !/^[a-f0-9]{64}$/u.test(sha256)) throw new ApiError(400, 'ASSET_SHA256_INVALID', 'sha256 must be a lowercase 64-character digest.');
  return {
    id,
    name,
    kind: kind as BrandingAsset['kind'],
    contentType: contentType as BrandingAsset['contentType'],
    status: body.status === 'retired' ? 'retired' : 'active',
    ...(publicUrl ? { publicUrl } : {}),
    ...(objectPath ? { objectPath } : {}),
    ...(sha256 ? { sha256 } : {}),
    ...(typeof body.fileSize === 'number' && body.fileSize >= 0 ? { fileSize: body.fileSize } : {}),
    ...(typeof body.altText === 'string' && body.altText.trim() ? { altText: body.altText.trim() } : {}),
  };
}

async function publicBranding(dependencies: ApiDependencies, agencyId: string): Promise<PublicAgencyBranding | null> {
  const profiles = (await listAll(dependencies, 'brandingProfiles', agencyId)) as unknown as AgencyBrandingProfile[];
  const active = profiles.filter((item) => item.status === 'active').sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0];
  if (!active) return null;
  const assets = (await listAll(dependencies, 'brandingAssets', agencyId)) as unknown as BrandingAsset[];
  const asset = (id?: string) => assets.find((item) => item.id === id && item.status === 'active');
  return {
    profileId: active.id,
    profileVersion: active.version,
    name: active.name,
    logoUrl: asset(active.logoAssetId)?.publicUrl,
    portalLogoUrl: asset(active.portalLogoAssetId)?.publicUrl || asset(active.logoAssetId)?.publicUrl,
    primaryColour: active.primaryColour,
    secondaryColour: active.secondaryColour,
    accentColour: active.accentColour,
    reportHeaderText: active.reportHeaderText,
    reportFooterText: active.reportFooterText,
    portalWelcomeText: active.portalWelcomeText,
    legalFooter: active.legalFooter,
    privacyNoticeUrl: active.privacyNoticeUrl,
  };
}

export async function resolvePublicAgencyBranding(dependencies: ApiDependencies, agencyId: string): Promise<PublicAgencyBranding | null> {
  return publicBranding(dependencies, agencyId);
}

export async function routeBrandingSettingsRequest(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string): Promise<ApiResponse | undefined> {
  const route = routeParts(req);
  if (route[0] !== 'api' || route[1] !== 'v1' || route[2] !== 'settings' || route[3] !== 'branding') return undefined;
  const agencyId = agencyHeader(req);

  if (route[4] === 'active' && req.method === 'GET') {
    const principal = await authenticateAndAuthorise(req, dependencies, 'settings.read', { agencyId }, correlationId);
    return { status: 200, body: { data: await publicBranding(dependencies, agencyId), meta: { actor: principal.uid, correlationId } } };
  }

  if (route[4] === 'assets') {
    const assetId = route[5];
    if (req.method === 'GET') {
      const principal = await authenticateAndAuthorise(req, dependencies, 'settings.read', { agencyId }, correlationId);
      const data = assetId ? await dependencies.repository.get('brandingAssets', agencyId, assetId) : await listAll(dependencies, 'brandingAssets', agencyId);
      return { status: 200, body: { data: data ?? null, meta: { actor: principal.uid, correlationId } } };
    }
    const body = await readJson(req);
    const principal = await authenticateAndAuthorise(req, dependencies, 'settings.branding.manage', { agencyId }, correlationId);
    if (req.method === 'POST' && !assetId) {
      const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : `brand-asset-${randomUUID()}`;
      const created = await dependencies.repository.create('brandingAssets', agencyId, id, brandingAsset(body, id), principal.uid);
      return { status: 201, body: { data: created, meta: { actor: principal.uid, correlationId } } };
    }
    if ((req.method === 'PUT' || req.method === 'PATCH') && assetId) {
      const current = await dependencies.repository.get('brandingAssets', agencyId, assetId);
      if (!current) throw new ApiError(404, 'BRANDING_ASSET_NOT_FOUND', 'Branding asset was not found.');
      const updated = await dependencies.repository.update('brandingAssets', agencyId, assetId, brandingAsset(body, assetId), expectedVersion(body.expectedVersion), principal.uid);
      return { status: 200, body: { data: updated, meta: { actor: principal.uid, correlationId } } };
    }
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Unsupported branding asset operation.');
  }

  const profileId = route[4];
  if (req.method === 'GET') {
    const principal = await authenticateAndAuthorise(req, dependencies, 'settings.read', { agencyId }, correlationId);
    const data = profileId ? await dependencies.repository.get('brandingProfiles', agencyId, profileId) : await listAll(dependencies, 'brandingProfiles', agencyId);
    return { status: 200, body: { data: data ?? null, meta: { actor: principal.uid, correlationId } } };
  }

  const body = await readJson(req);
  const principal = await authenticateAndAuthorise(req, dependencies, 'settings.branding.manage', { agencyId }, correlationId);
  if (req.method === 'POST' && !profileId) {
    const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : `branding-${randomUUID()}`;
    const validated = validate(agencyBrandingProfileSchema.parse({ ...body, id }));
    const created = await dependencies.repository.create('brandingProfiles', agencyId, id, validated as unknown as Record<string, unknown>, principal.uid);
    return { status: 201, body: { data: created, meta: { actor: principal.uid, correlationId } } };
  }
  if ((req.method === 'PUT' || req.method === 'PATCH') && profileId) {
    const current = await dependencies.repository.get('brandingProfiles', agencyId, profileId);
    if (!current) throw new ApiError(404, 'BRANDING_PROFILE_NOT_FOUND', 'Branding profile was not found.');
    const clean: Record<string, unknown> = { ...body, id: profileId };
    delete clean.expectedVersion;
    const validated = validate(agencyBrandingProfileSchema.parse(clean));
    const updated = await dependencies.repository.update('brandingProfiles', agencyId, profileId, validated as unknown as Record<string, unknown>, expectedVersion(body.expectedVersion), principal.uid);
    return { status: 200, body: { data: updated, meta: { actor: principal.uid, correlationId } } };
  }
  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Unsupported branding profile operation.');
}
