import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { AuthorisationTarget, SecurityCapability } from '@pcr/domain';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies, IdempotencyResult } from './types.js';

interface CreatePolicy {
  collection: string;
  capability: SecurityCapability;
  required: readonly string[];
  prepare(body: Record<string, unknown>, actorId: string): Record<string, unknown>;
}

const POLICIES: Readonly<Record<string, CreatePolicy>> = {
  'daily-activity-logs': { collection: 'dailyActivityLogs', capability: 'building.activity.manage', required: ['activityDate', 'summary'], prepare: (body, actorId) => ({ ...body, authorUserId: actorId, status: 'recorded' }) },
  tasks: { collection: 'tasks', capability: 'building.task.manage', required: ['title', 'taskType'], prepare: (body) => ({ ...body, status: 'open' }) },
  defects: { collection: 'defects', capability: 'defect.create', required: ['category', 'description'], prepare: (body) => ({ ...body, source: typeof body.source === 'string' ? body.source : 'building_management', status: 'new' }) },
  'operational-inspections': { collection: 'operationalInspections', capability: 'operational_inspection.manage', required: ['inspectionType', 'inspectorId'], prepare: (body) => ({ ...body, status: typeof body.status === 'string' ? body.status : 'scheduled' }) },
  'move-bookings': { collection: 'moveBookings', capability: 'move_booking.manage', required: ['propertyId', 'moveType', 'startAt', 'endAt'], prepare: (body) => ({ ...body, requestedAt: new Date().toISOString(), approvalStatus: 'pending', status: 'new' }) },
  'access-device-requests': { collection: 'accessDeviceRequests', capability: 'access_device.manage', required: ['unitId', 'requestType', 'deviceTypeRequested'], prepare: (body) => ({ ...body, status: 'submitted' }) },
  incidents: { collection: 'incidents', capability: 'incident.manage', required: ['incidentType', 'severity', 'occurredAt', 'description'], prepare: (body, actorId) => ({ ...body, reportedBy: actorId, status: 'open' }) },
  'bylaw-observations': { collection: 'bylawObservations', capability: 'bylaw.observe', required: ['observedAt', 'description'], prepare: (body, actorId) => ({ ...body, observedBy: actorId, status: 'observed' }) },
  assets: { collection: 'assets', capability: 'asset.manage', required: ['assetType', 'name'], prepare: (body) => ({ ...body, sourceType: typeof body.sourceType === 'string' ? body.sourceType : 'building_management', status: 'active' }) },
  'maintenance-plans': { collection: 'maintenancePlans', capability: 'asset.maintenance.manage', required: ['name', 'cadence'], prepare: (body) => ({ ...body, status: 'active' }) },
  'waste-events': { collection: 'wasteEvents', capability: 'waste.manage', required: ['eventType', 'occurredAt', 'details'], prepare: (body, actorId) => ({ ...body, reportedBy: actorId, status: 'recorded' }) },
  'operational-report-drafts': { collection: 'operationalReportDrafts', capability: 'operational_report.prepare', required: ['period', 'content'], prepare: (body, actorId) => ({ ...body, preparedBy: actorId, version: 1, status: 'draft' }) },
  handovers: { collection: 'handovers', capability: 'handover.manage', required: ['toUserId', 'handoverAt', 'summary'], prepare: (body, actorId) => ({ ...body, fromUserId: actorId, status: 'open' }) },
  notices: { collection: 'notices', capability: 'notice.manage', required: ['noticeType', 'title', 'content'], prepare: (body, actorId) => ({ ...body, ...(body.publishedAt ? { publishedBy: actorId } : {}), status: body.publishedAt ? 'published' : 'draft' }) },
};

function parts(req: IncomingMessage): string[] { return new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean); }
function agencyId(req: IncomingMessage): string { const value = req.headers['x-agency-id']?.toString().trim(); if (!value) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.'); return value; }
async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> { const chunks: Buffer[] = []; let bytes = 0; for await (const chunk of req) { const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); bytes += value.length; if (bytes > 1_000_000) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 1 MB.'); chunks.push(value); } if (!chunks.length) return {}; try { const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required'); return parsed as Record<string, unknown>; } catch { throw new ApiError(400, 'INVALID_JSON', 'Request body must be a JSON object.'); } }
function idempotencyKey(req: IncomingMessage): string { const value = req.headers['idempotency-key']?.toString().trim(); if (!value || value.length < 8 || value.length > 200) throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key is required.'); return value; }
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
async function idempotent(deps: ApiDependencies, req: IncomingMessage, agency: string, operation: string, body: Record<string, unknown>, action: () => Promise<IdempotencyResult>): Promise<ApiResponse> { const execution = await deps.idempotency.execute(agency, operation, idempotencyKey(req), hash(body), action); return { status: execution.result.status, body: execution.result.body, headers: { 'idempotency-replayed': String(execution.replayed) } }; }
function managedSiteId(body: Record<string, unknown>): string { const value = typeof body.managedSiteId === 'string' ? body.managedSiteId.trim() : ''; if (!value) throw new ApiError(400, 'MANAGED_SITE_REQUIRED', 'managedSiteId is required.'); return value; }
function validate(policy: CreatePolicy, body: Record<string, unknown>): void { const missing = policy.required.filter((key) => body[key] === undefined || body[key] === null || body[key] === ''); if (missing.length) throw new ApiError(400, 'REQUIRED_FIELDS_MISSING', `Missing required fields: ${missing.join(', ')}.`); }

export async function routePortalOperationalCreateRequest(req: IncomingMessage, deps: ApiDependencies, correlationId: string): Promise<ApiResponse | undefined> {
  const route = parts(req); if (route[0] !== 'api' || route[1] !== 'v1' || route[2] !== 'portal-operations' || !route[3]) return undefined;
  if (req.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Operational create commands are POST only.');
  const resource = route[3]; const policy = POLICIES[resource]; if (!policy) throw new ApiError(404, 'OPERATION_NOT_FOUND', 'Operational create command not found.');
  const agency = agencyId(req); const body = await readJson(req); const site = managedSiteId(body); validate(policy, body);
  const eventTarget: AuthorisationTarget = { agencyId: agency, managedSiteId: site, ...(typeof body.propertyId === 'string' ? { propertyId: body.propertyId } : {}), ...(typeof body.contractorId === 'string' ? { contractorId: body.contractorId } : {}) };
  const principal = await authenticateAndAuthorise(req, deps, policy.capability, eventTarget, correlationId);
  const data = policy.prepare({ ...body, managedSiteId: site }, principal.uid); const id = randomUUID();
  return idempotent(deps, req, agency, `portal-operation:${resource}:create`, body, async () => {
    const created = await deps.repository.create(policy.collection, agency, id, data, principal.uid);
    await deps.audit.append({ id: randomUUID(), timestamp: new Date().toISOString(), actorId: principal.uid, actorRole: principal.role, agencyId: agency, capability: policy.capability, outcome: 'allowed', reason: `portal.${resource}.created`, target: eventTarget, correlationId, eventType: `portal.${resource}.created`, entityType: resource, entityId: id });
    return { status: 201, body: { data: created, meta: { correlationId } } };
  });
}
