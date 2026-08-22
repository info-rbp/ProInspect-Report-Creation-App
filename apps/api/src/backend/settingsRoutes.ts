import type { IncomingMessage } from 'node:http';
import type { DomainErrorShape, SecurityCapability } from '@pcr/domain';
import { agencyOperationalSettingsSchema, agencyOrganisationSettingsSchema, communicationPolicySchema, maintenancePolicySettingsSchema, type ValidationSchema } from '@pcr/validation';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { routeBrandingSettingsRequest } from './brandingSettingsRoutes.js';
import { routeCommunicationSettingsRequest } from './communicationSettingsRoutes.js';
import { routeSettingsOverviewRequest } from './settingsOverviewRoutes.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies } from './types.js';

type SettingsSection = 'organisation' | 'operational' | 'communications' | 'maintenance';
const SECTION_CONFIG: Record<SettingsSection, { id: string; readCapability: SecurityCapability; writeCapability: SecurityCapability; schema: ValidationSchema<Record<string, unknown>> }> = {
  organisation: { id: 'organisation', readCapability: 'settings.read', writeCapability: 'settings.organisation.manage', schema: agencyOrganisationSettingsSchema as unknown as ValidationSchema<Record<string, unknown>> },
  operational: { id: 'operational', readCapability: 'settings.read', writeCapability: 'settings.operations.manage', schema: agencyOperationalSettingsSchema as unknown as ValidationSchema<Record<string, unknown>> },
  communications: { id: 'communications', readCapability: 'settings.read', writeCapability: 'settings.communications.manage', schema: communicationPolicySchema as unknown as ValidationSchema<Record<string, unknown>> },
  maintenance: { id: 'maintenance', readCapability: 'settings.read', writeCapability: 'maintenance.policy.manage', schema: maintenancePolicySettingsSchema as unknown as ValidationSchema<Record<string, unknown>> },
};
function agencyHeader(req: IncomingMessage): string { const agencyId = req.headers['x-agency-id']?.toString().trim(); if (!agencyId) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.'); return agencyId; }
function parts(req: IncomingMessage): string[] { return new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean); }
async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> { const chunks: Buffer[] = []; let length = 0; for await (const chunk of req) { const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); length += buffer.length; if (length > 1_000_000) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 1 MB.'); chunks.push(buffer); } if (!chunks.length) return {}; try { const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required'); return parsed as Record<string, unknown>; } catch { throw new ApiError(400, 'INVALID_JSON', 'Request body must be valid JSON.'); } }
function validate<T>(result: { ok: true; value: T } | { ok: false; error: DomainErrorShape }): T { if (!result.ok) throw new ApiError(result.error.status, result.error.code, result.error.message, result.error.details); return result.value; }
function expectedVersion(value: unknown): number | undefined { if (value === undefined || value === null) return undefined; if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new ApiError(400, 'EXPECTED_VERSION_INVALID', 'expectedVersion must be a positive integer.'); return value; }

export async function routeSettingsRequest(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string): Promise<ApiResponse | undefined> {
  const route = parts(req); if (route[0] !== 'api' || route[1] !== 'v1' || route[2] !== 'settings') return undefined;
  if (route[3] === 'branding') return routeBrandingSettingsRequest(req, dependencies, correlationId);
  if (route[3] === 'communications' && route[4]) return routeCommunicationSettingsRequest(req, dependencies, correlationId);
  if (route[3] === 'overview' || route[3] === 'integrations') return routeSettingsOverviewRequest(req, dependencies, correlationId);
  const section = route[3] as SettingsSection | undefined;
  if (!section || !(section in SECTION_CONFIG)) {
    if (route.length === 3 && req.method === 'GET') { const agencyId = agencyHeader(req); const principal = await authenticateAndAuthorise(req, dependencies, 'settings.read', { agencyId }, correlationId); const records = await dependencies.repository.list('agencySettings', agencyId, 20); return { status: 200, body: { data: records.items, meta: { actor: principal.uid, correlationId } } }; }
    return undefined;
  }
  const config = SECTION_CONFIG[section]; const agencyId = agencyHeader(req);
  if (req.method === 'GET') { const principal = await authenticateAndAuthorise(req, dependencies, config.readCapability, { agencyId }, correlationId); const record = await dependencies.repository.get('agencySettings', agencyId, config.id); return { status: 200, body: { data: record ?? null, meta: { actor: principal.uid, correlationId } } }; }
  if (req.method !== 'PUT' && req.method !== 'PATCH') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Settings sections support GET, PUT and PATCH only.');
  const body = await readJson(req); const principal = await authenticateAndAuthorise(req, dependencies, config.writeCapability, { agencyId }, correlationId); const suppliedVersion = expectedVersion(body.expectedVersion); const cleanBody = { ...body };
  delete cleanBody.expectedVersion; delete cleanBody.id; delete cleanBody.agencyId; delete cleanBody.version; delete cleanBody.createdAt; delete cleanBody.updatedAt;
  const validated = validate(config.schema.parse(cleanBody)); const current = await dependencies.repository.get('agencySettings', agencyId, config.id);
  if (current) { if (!suppliedVersion) throw new ApiError(400, 'EXPECTED_VERSION_REQUIRED', 'expectedVersion is required when updating settings.'); const updated = await dependencies.repository.update('agencySettings', agencyId, config.id, validated, suppliedVersion, principal.uid); return { status: 200, body: { data: updated, meta: { actor: principal.uid, correlationId } } }; }
  if (suppliedVersion) throw new ApiError(409, 'VERSION_CONFLICT', 'Settings do not exist yet; omit expectedVersion to create them.');
  const created = await dependencies.repository.create('agencySettings', agencyId, config.id, validated, principal.uid); return { status: 201, body: { data: created, meta: { actor: principal.uid, correlationId } } };
}
