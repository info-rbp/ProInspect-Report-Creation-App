import type { IncomingMessage } from 'node:http';
import {
  captureBrandingSnapshot,
  publishBrandingProfile,
  publishPresentationTemplate,
  validateBrandingProfile,
  validatePresentationTemplate,
  type ReportBrandingProfile,
  type ReportPresentationTemplate,
} from '@pcr/report-presentation';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies, StoredRecord } from './types.js';

const PRESENTATION_COLLECTION = 'reportPresentationTemplateVersions';
const BRANDING_COLLECTION = 'reportBrandingProfileVersions';

function agencyHeader(req: IncomingMessage): string {
  const agencyId = req.headers['x-agency-id']?.toString().trim();
  if (!agencyId) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.');
  return agencyId;
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Presentation payload exceeds 1 MB.');
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

function storageId(id: string, version: number): string {
  const logicalId = id.trim();
  if (!logicalId || logicalId.includes('/')) throw new ApiError(400, 'INVALID_PRESENTATION_ID', 'ID must be non-empty and cannot contain a slash.');
  if (!Number.isInteger(version) || version < 1) throw new ApiError(400, 'INVALID_PRESENTATION_VERSION', 'Version must be a positive integer.');
  return `${logicalId}--v${version}`;
}

function expectedRecordVersion(body: Record<string, unknown>): number {
  const value = body.expectedRecordVersion;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new ApiError(400, 'EXPECTED_VERSION_REQUIRED', 'expectedRecordVersion must be a positive integer.');
  }
  return value;
}

function templateFrom(value: unknown): ReportPresentationTemplate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'PRESENTATION_TEMPLATE_REQUIRED', 'A presentation template is required.');
  const template = structuredClone(value) as ReportPresentationTemplate;
  try { validatePresentationTemplate(template); }
  catch (error) { throw new ApiError(400, 'PRESENTATION_TEMPLATE_INVALID', error instanceof Error ? error.message : 'Presentation template is invalid.'); }
  return template;
}

function brandingFrom(value: unknown): ReportBrandingProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'BRANDING_PROFILE_REQUIRED', 'A branding profile is required.');
  const profile = structuredClone(value) as ReportBrandingProfile;
  try { validateBrandingProfile(profile); }
  catch (error) { throw new ApiError(400, 'BRANDING_PROFILE_INVALID', error instanceof Error ? error.message : 'Branding profile is invalid.'); }
  return profile;
}

function templateData(template: ReportPresentationTemplate): Record<string, unknown> {
  return { ...structuredClone(template), presentationTemplateId: template.id, presentationTemplateVersion: template.version, immutable: template.status !== 'draft' };
}

function brandingData(profile: ReportBrandingProfile): Record<string, unknown> {
  return { ...structuredClone(profile), brandingProfileId: profile.id, brandingProfileVersion: profile.version, immutable: profile.status !== 'draft' };
}

function stripStoredFields<T extends object>(record: StoredRecord): T & { recordVersion: number } {
  const { agencyId: _agencyId, createdAt: _createdAt, updatedAt: _updatedAt, version, ...data } = record;
  return { ...(data as T), recordVersion: version };
}

async function listRecords(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string, collection: string): Promise<ApiResponse> {
  const agencyId = agencyHeader(req);
  await authenticateAndAuthorise(req, dependencies, 'report.read', { agencyId }, correlationId);
  const page = await dependencies.repository.list(collection, agencyId, 100);
  return { status: 200, body: { data: page.items.map((record) => stripStoredFields(record)), meta: { correlationId } } };
}

async function createTemplate(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string): Promise<ApiResponse> {
  const agencyId = agencyHeader(req);
  const principal = await authenticateAndAuthorise(req, dependencies, 'template.manage', { agencyId }, correlationId);
  const body = await readJson(req);
  const template = templateFrom(body.template ?? body);
  if (template.status !== 'draft') throw new ApiError(400, 'DRAFT_REQUIRED', 'New presentation templates must start as draft.');
  const id = storageId(template.id, template.version);
  if (await dependencies.repository.get(PRESENTATION_COLLECTION, agencyId, id)) throw new ApiError(409, 'PRESENTATION_VERSION_EXISTS', 'This presentation template version already exists.');
  const created = await dependencies.repository.create(PRESENTATION_COLLECTION, agencyId, id, templateData(template), principal.uid);
  return { status: 201, body: { data: stripStoredFields(created), meta: { correlationId } } };
}

async function updateTemplate(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string, id: string, version: number): Promise<ApiResponse> {
  const agencyId = agencyHeader(req);
  const principal = await authenticateAndAuthorise(req, dependencies, 'template.manage', { agencyId }, correlationId);
  const body = await readJson(req);
  const storedId = storageId(id, version);
  const existing = await dependencies.repository.get(PRESENTATION_COLLECTION, agencyId, storedId);
  if (!existing) throw new ApiError(404, 'PRESENTATION_NOT_FOUND', 'Presentation template version not found.');
  if (existing.status !== 'draft' || existing.immutable === true) throw new ApiError(409, 'PRESENTATION_IMMUTABLE', 'Published presentation templates cannot be edited.');
  const expected = expectedRecordVersion(body);
  if (expected !== existing.version) throw new ApiError(409, 'VERSION_CONFLICT', 'Presentation template changed. Reload and retry.');
  const template = templateFrom(body.template);
  if (template.id !== id || template.version !== version || template.status !== 'draft') throw new ApiError(400, 'PRESENTATION_IDENTITY_MISMATCH', 'Presentation template identity and lifecycle cannot change during editing.');
  const updated = await dependencies.repository.update(PRESENTATION_COLLECTION, agencyId, storedId, templateData(template), expected, principal.uid);
  return { status: 200, body: { data: stripStoredFields(updated), meta: { correlationId } } };
}

async function publishTemplateVersion(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string, id: string, version: number): Promise<ApiResponse> {
  const agencyId = agencyHeader(req);
  const principal = await authenticateAndAuthorise(req, dependencies, 'template.manage', { agencyId }, correlationId);
  const body = await readJson(req);
  const storedId = storageId(id, version);
  const existing = await dependencies.repository.get(PRESENTATION_COLLECTION, agencyId, storedId);
  if (!existing) throw new ApiError(404, 'PRESENTATION_NOT_FOUND', 'Presentation template version not found.');
  const expected = expectedRecordVersion(body);
  if (expected !== existing.version) throw new ApiError(409, 'VERSION_CONFLICT', 'Presentation template changed. Reload and retry.');
  const published = publishPresentationTemplate(templateFrom(existing as unknown as ReportPresentationTemplate));
  const updated = await dependencies.repository.update(PRESENTATION_COLLECTION, agencyId, storedId, templateData(published), expected, principal.uid);
  return { status: 200, body: { data: stripStoredFields(updated), meta: { correlationId } } };
}

async function createBranding(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string): Promise<ApiResponse> {
  const agencyId = agencyHeader(req);
  const principal = await authenticateAndAuthorise(req, dependencies, 'template.manage', { agencyId }, correlationId);
  const body = await readJson(req);
  const profile = brandingFrom(body.profile ?? body);
  if (profile.status !== 'draft') throw new ApiError(400, 'DRAFT_REQUIRED', 'New branding profiles must start as draft.');
  const id = storageId(profile.id, profile.version);
  if (await dependencies.repository.get(BRANDING_COLLECTION, agencyId, id)) throw new ApiError(409, 'BRANDING_VERSION_EXISTS', 'This branding profile version already exists.');
  const created = await dependencies.repository.create(BRANDING_COLLECTION, agencyId, id, brandingData(profile), principal.uid);
  return { status: 201, body: { data: stripStoredFields(created), meta: { correlationId } } };
}

async function publishBrandingVersion(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string, id: string, version: number): Promise<ApiResponse> {
  const agencyId = agencyHeader(req);
  const principal = await authenticateAndAuthorise(req, dependencies, 'template.manage', { agencyId }, correlationId);
  const body = await readJson(req);
  const storedId = storageId(id, version);
  const existing = await dependencies.repository.get(BRANDING_COLLECTION, agencyId, storedId);
  if (!existing) throw new ApiError(404, 'BRANDING_NOT_FOUND', 'Branding profile version not found.');
  const expected = expectedRecordVersion(body);
  if (expected !== existing.version) throw new ApiError(409, 'VERSION_CONFLICT', 'Branding profile changed. Reload and retry.');
  const published = publishBrandingProfile(brandingFrom(existing as unknown as ReportBrandingProfile));
  const updated = await dependencies.repository.update(BRANDING_COLLECTION, agencyId, storedId, brandingData(published), expected, principal.uid);
  return { status: 200, body: { data: { ...stripStoredFields(updated), snapshot: captureBrandingSnapshot(published) }, meta: { correlationId } } };
}

export async function routeReportPresentationRequest(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string): Promise<ApiResponse | undefined> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'api' || parts[1] !== 'v1' || parts[2] !== 'report-presentation') return undefined;
  const resource = parts[3];
  if (resource === 'templates') {
    if (parts.length === 4 && req.method === 'GET') return listRecords(req, dependencies, correlationId, PRESENTATION_COLLECTION);
    if (parts.length === 4 && req.method === 'POST') return createTemplate(req, dependencies, correlationId);
    if (parts[4] && parts[5] && req.method === 'PUT') return updateTemplate(req, dependencies, correlationId, parts[4], Number(parts[5]));
    if (parts[4] && parts[5] && parts[6] === 'publish' && req.method === 'POST') return publishTemplateVersion(req, dependencies, correlationId, parts[4], Number(parts[5]));
  }
  if (resource === 'branding') {
    if (parts.length === 4 && req.method === 'GET') return listRecords(req, dependencies, correlationId, BRANDING_COLLECTION);
    if (parts.length === 4 && req.method === 'POST') return createBranding(req, dependencies, correlationId);
    if (parts[4] && parts[5] && parts[6] === 'publish' && req.method === 'POST') return publishBrandingVersion(req, dependencies, correlationId, parts[4], Number(parts[5]));
  }
  throw new ApiError(404, 'REPORT_PRESENTATION_ROUTE_NOT_FOUND', 'Report presentation route not found.');
}
