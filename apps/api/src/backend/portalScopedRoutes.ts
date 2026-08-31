import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { AuthenticatedPrincipal, AuthorisationTarget, SecurityCapability, SecurityRole } from '@pcr/domain';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies, IdempotencyResult, StoredRecord } from './types.js';

const RESIDENT_ROLES = new Set<SecurityRole>(['resident_owner', 'resident_tenant', 'tenant']);
const CONTRACTOR_ROLES = new Set<SecurityRole>(['contractor_admin', 'contractor_worker']);
const SITE_ROLES = new Set<SecurityRole>(['building_manager', 'relief_building_manager', 'strata_manager', 'council_member']);
const INTERNAL_ROLES = new Set<SecurityRole>(['super_admin', 'proinspect_admin', 'operations']);

function routeParts(req: IncomingMessage): string[] { return new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean); }
function agencyHeader(req: IncomingMessage): string {
  const agencyId = req.headers['x-agency-id']?.toString().trim();
  if (!agencyId) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.');
  return agencyId;
}
async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const chunk of req) { const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); bytes += value.length; if (bytes > 1_000_000) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 1 MB.'); chunks.push(value); }
  if (!chunks.length) return {};
  try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required'); return value as Record<string, unknown>; }
  catch { throw new ApiError(400, 'INVALID_JSON', 'Request body must be a JSON object.'); }
}
function idempotencyKey(req: IncomingMessage): string {
  const value = req.headers['idempotency-key']?.toString().trim();
  if (!value || value.length < 8 || value.length > 200) throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key is required.');
  return value;
}
function payloadHash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
async function idempotent(deps: ApiDependencies, req: IncomingMessage, agencyId: string, operation: string, body: Record<string, unknown>, action: () => Promise<IdempotencyResult>): Promise<ApiResponse> {
  const execution = await deps.idempotency.execute(agencyId, operation, idempotencyKey(req), payloadHash(body), action);
  return { status: execution.result.status, body: execution.result.body, headers: { 'idempotency-replayed': String(execution.replayed) } };
}
function siteFrom(req: IncomingMessage): string | undefined { return new URL(req.url ?? '/', 'http://localhost').searchParams.get('managedSiteId')?.trim() || undefined; }
function unitFrom(req: IncomingMessage): string | undefined { return new URL(req.url ?? '/', 'http://localhost').searchParams.get('unitId')?.trim() || undefined; }
function target(agencyId: string, managedSiteId?: string, extra: Partial<AuthorisationTarget> = {}): AuthorisationTarget { return { agencyId, ...(managedSiteId ? { managedSiteId } : {}), ...extra }; }
function assertRole(principal: AuthenticatedPrincipal, allowed: Set<SecurityRole>, message: string): void { if (!allowed.has(principal.role) && !INTERNAL_ROLES.has(principal.role)) throw new ApiError(403, 'PORTAL_ROLE_REQUIRED', message); }
function assertSite(principal: AuthenticatedPrincipal, managedSiteId: string): void { if (!INTERNAL_ROLES.has(principal.role) && !principal.siteIds?.includes(managedSiteId)) throw new ApiError(403, 'MANAGED_SITE_SCOPE_REQUIRED', 'This portal context is not assigned to the current user.'); }
function requireSite(req: IncomingMessage): string { const site = siteFrom(req); if (!site) throw new ApiError(400, 'MANAGED_SITE_REQUIRED', 'managedSiteId is required.'); return site; }
function publicRecord(record: StoredRecord, kind?: string): StoredRecord { return kind ? ({ ...record, portalRecordType: kind } as StoredRecord) : record; }
async function list(deps: ApiDependencies, collection: string, agencyId: string, filters: Record<string, string | number | boolean> = {}, limit = 100): Promise<StoredRecord[]> { return (await deps.repository.list(collection, agencyId, limit, undefined, filters)).items; }
async function appendAudit(deps: ApiDependencies, principal: AuthenticatedPrincipal, capability: SecurityCapability, eventType: string, entityType: string, entityId: string, correlationId: string, eventTarget: AuthorisationTarget): Promise<void> {
  await deps.audit.append({ id: randomUUID(), timestamp: new Date().toISOString(), actorId: principal.uid, actorRole: principal.role, agencyId: principal.agencyId, capability, outcome: 'allowed', reason: eventType, target: eventTarget, correlationId, eventType, entityType, entityId });
}

async function residentPrincipal(req: IncomingMessage, deps: ApiDependencies, correlationId: string, agencyId: string, site: string): Promise<AuthenticatedPrincipal> {
  const principal = await authenticateAndAuthorise(req, deps, 'portal.switch', target(agencyId, site), correlationId);
  assertRole(principal, RESIDENT_ROLES, 'A resident portal role is required.'); assertSite(principal, site); return principal;
}
async function contractorPrincipal(req: IncomingMessage, deps: ApiDependencies, correlationId: string, agencyId: string, site: string): Promise<AuthenticatedPrincipal> {
  const principal = await authenticateAndAuthorise(req, deps, 'portal.switch', target(agencyId, site), correlationId);
  assertRole(principal, CONTRACTOR_ROLES, 'A contractor portal role is required.'); assertSite(principal, site);
  if (!principal.contractorId) throw new ApiError(403, 'CONTRACTOR_SCOPE_REQUIRED', 'No contractor profile is assigned to this account.');
  return principal;
}
async function sitePrincipal(req: IncomingMessage, deps: ApiDependencies, correlationId: string, agencyId: string, site: string): Promise<AuthenticatedPrincipal> {
  const principal = await authenticateAndAuthorise(req, deps, 'portal.switch', target(agencyId, site), correlationId);
  if (!SITE_ROLES.has(principal.role) && !INTERNAL_ROLES.has(principal.role)) throw new ApiError(403, 'SITE_ROLE_REQUIRED', 'A Building Management or Strata role is required.');
  assertSite(principal, site); return principal;
}
async function inspectorPrincipal(req: IncomingMessage, deps: ApiDependencies, correlationId: string, agencyId: string): Promise<AuthenticatedPrincipal> {
  const principal = await authenticateAndAuthorise(req, deps, 'job.offline.sync', { agencyId }, correlationId);
  if (principal.role !== 'inspector' && !INTERNAL_ROLES.has(principal.role)) throw new ApiError(403, 'INSPECTOR_ROLE_REQUIRED', 'An inspector role is required.');
  return principal;
}

async function ownOccupancies(deps: ApiDependencies, agencyId: string, principal: AuthenticatedPrincipal, site: string): Promise<StoredRecord[]> {
  const rows = await list(deps, 'occupancies', agencyId, { managedSiteId: site, userId: principal.uid });
  return rows.filter((row) => row.current !== false && (!row.endDate || Date.parse(String(row.endDate)) > Date.now()));
}

async function getResidentResource(req: IncomingMessage, deps: ApiDependencies, correlationId: string, resource: string): Promise<ApiResponse> {
  const agencyId = agencyHeader(req); const site = requireSite(req); const principal = await residentPrincipal(req, deps, correlationId, agencyId, site);
  const occupancies = await ownOccupancies(deps, agencyId, principal, site); const unitIds = new Set(occupancies.map((item) => String(item.unitId ?? '')).filter(Boolean));
  const requestedUnit = unitFrom(req); if (requestedUnit && !unitIds.has(requestedUnit)) throw new ApiError(403, 'UNIT_SCOPE_REQUIRED', 'The requested unit is not part of the current occupancy.');
  const unitId = requestedUnit ?? occupancies[0]?.unitId?.toString();

  if (resource === 'my-property') {
    const result: StoredRecord[] = [...occupancies.map((item) => publicRecord(item, 'occupancy'))];
    for (const id of unitIds) { const unit = await deps.repository.get('units', agencyId, id); if (unit?.managedSiteId === site) result.push(publicRecord(unit, 'unit')); if (unit?.propertyId) { const property = await deps.repository.get('properties', agencyId, String(unit.propertyId)); if (property) result.push(publicRecord(property, 'property')); } }
    return { status: 200, body: { data: result, meta: { correlationId } } };
  }
  if (resource === 'household') {
    if (!unitId) return { status: 200, body: { data: [], meta: { correlationId } } };
    const rows = (await list(deps, 'occupancies', agencyId, { managedSiteId: site, unitId })).filter((item) => item.current !== false);
    return { status: 200, body: { data: rows, meta: { correlationId } } };
  }
  if (resource === 'requests' || resource === 'maintenance') {
    const rows = (await list(deps, 'residentRequests', agencyId, { managedSiteId: site })).filter((item) => item.residentUserId === principal.uid);
    if (resource === 'requests') return { status: 200, body: { data: rows, meta: { correlationId } } };
    const result: StoredRecord[] = rows.map((item) => publicRecord(item, 'resident_request'));
    for (const item of rows) if (item.defectId) { const defect = await deps.repository.get('defects', agencyId, String(item.defectId)); if (defect?.managedSiteId === site) result.push(publicRecord(defect, 'linked_defect')); }
    return { status: 200, body: { data: result, meta: { correlationId } } };
  }
  if (resource === 'moves') {
    const rows = (await list(deps, 'moveBookings', agencyId, { managedSiteId: site })).filter((item) => item.residentUserId === principal.uid || (item.unitId && unitIds.has(String(item.unitId))));
    return { status: 200, body: { data: rows, meta: { correlationId } } };
  }
  if (resource === 'access-requests') {
    if (!unitId) return { status: 200, body: { data: [], meta: { correlationId } } };
    return { status: 200, body: { data: await list(deps, 'accessDeviceRequests', agencyId, { managedSiteId: site, unitId }), meta: { correlationId } } };
  }
  if (resource === 'access-devices') {
    if (!unitId) return { status: 200, body: { data: [], meta: { correlationId } } };
    return { status: 200, body: { data: await list(deps, 'accessDevices', agencyId, { managedSiteId: site, unitId }), meta: { correlationId } } };
  }
  if (resource === 'notices') {
    const rows = (await list(deps, 'notices', agencyId, { managedSiteId: site })).filter((item) => !item.publishAt || Date.parse(String(item.publishAt)) <= Date.now()).filter((item) => !item.expireAt || Date.parse(String(item.expireAt)) > Date.now());
    return { status: 200, body: { data: rows, meta: { correlationId } } };
  }
  if (resource === 'documents') {
    const rows = await list(deps, 'documents', agencyId, { managedSiteId: site });
    const visible = rows.filter((item) => {
      const visibility = String(item.visibility ?? '').toLowerCase();
      if (!['public', 'resident', 'residents', 'unit', 'portal'].includes(visibility)) return false;
      if (item.linkedEntityType === 'unit') return Boolean(item.linkedEntityId && unitIds.has(String(item.linkedEntityId)));
      if (item.linkedEntityType === 'property') return Boolean(item.linkedEntityId && principal.propertyIds?.includes(String(item.linkedEntityId)));
      return visibility !== 'unit';
    });
    return { status: 200, body: { data: visible, meta: { correlationId } } };
  }
  if (resource === 'inspections') {
    const result: StoredRecord[] = [];
    for (const propertyId of principal.propertyIds ?? []) {
      const jobs = await list(deps, 'inspectionJobs', agencyId, { propertyId }); result.push(...jobs.map((item) => publicRecord(item, 'inspection_job')));
      const reports = await list(deps, 'reports', agencyId, { propertyId }); result.push(...reports.filter((item) => ['issued_to_tenant', 'tenant_response_in_progress', 'tenant_submitted', 'finalised', 'archived'].includes(String(item.lifecycleStatus ?? item.status))).map((item) => publicRecord(item, 'report')));
    }
    return { status: 200, body: { data: result, meta: { correlationId } } };
  }
  throw new ApiError(404, 'PORTAL_RESOURCE_NOT_FOUND', 'Resident portal resource not found.');
}

async function createResidentResource(req: IncomingMessage, deps: ApiDependencies, correlationId: string, resource: string): Promise<ApiResponse> {
  const agencyId = agencyHeader(req); const site = requireSite(req); const principal = await residentPrincipal(req, deps, correlationId, agencyId, site); const body = await readJson(req);
  const occupancies = await ownOccupancies(deps, agencyId, principal, site); const unitIds = new Set(occupancies.map((item) => String(item.unitId ?? '')).filter(Boolean)); const propertyIds = new Set(principal.propertyIds ?? []);
  const requestedUnit = typeof body.unitId === 'string' ? body.unitId : occupancies[0]?.unitId?.toString(); const propertyId = typeof body.propertyId === 'string' ? body.propertyId : occupancies[0]?.propertyId?.toString();
  if (requestedUnit && !unitIds.has(requestedUnit)) throw new ApiError(403, 'UNIT_SCOPE_REQUIRED', 'The selected unit is not part of the current occupancy.');
  if (propertyId && propertyIds.size && !propertyIds.has(propertyId)) throw new ApiError(403, 'PROPERTY_SCOPE_REQUIRED', 'The selected property is not assigned to this account.');

  let collection: string; let capability: SecurityCapability; let data: Record<string, unknown>;
  if (resource === 'requests') {
    collection = 'residentRequests'; capability = 'resident.request.create';
    if (typeof body.requestType !== 'string' || typeof body.description !== 'string') throw new ApiError(400, 'REQUEST_DETAILS_REQUIRED', 'requestType and description are required.');
    data = { ...body, managedSiteId: site, residentUserId: principal.uid, ...(requestedUnit ? { unitId: requestedUnit } : {}), ...(propertyId ? { propertyId } : {}), status: 'submitted' };
  } else if (resource === 'moves') {
    collection = 'moveBookings'; capability = 'move_booking.request';
    if (!propertyId || typeof body.moveType !== 'string' || typeof body.startAt !== 'string' || typeof body.endAt !== 'string') throw new ApiError(400, 'MOVE_DETAILS_REQUIRED', 'propertyId, moveType, startAt and endAt are required.');
    data = { ...body, managedSiteId: site, propertyId, ...(requestedUnit ? { unitId: requestedUnit } : {}), residentUserId: principal.uid, requestedAt: new Date().toISOString(), approvalStatus: 'pending', status: 'new' };
  } else if (resource === 'access-requests') {
    collection = 'accessDeviceRequests'; capability = 'access_device.request';
    if (!requestedUnit || typeof body.requestType !== 'string' || typeof body.deviceTypeRequested !== 'string') throw new ApiError(400, 'ACCESS_REQUEST_DETAILS_REQUIRED', 'unitId, requestType and deviceTypeRequested are required.');
    data = { ...body, managedSiteId: site, unitId: requestedUnit, status: 'submitted' };
  } else throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'This resident resource cannot be created.');

  await authenticateAndAuthorise(req, deps, capability, target(agencyId, site, { residentUserId: principal.uid, ...(propertyId ? { propertyId } : {}) }), correlationId);
  const id = randomUUID();
  return idempotent(deps, req, agencyId, `portal:resident:${resource}:create`, body, async () => {
    const created = await deps.repository.create(collection, agencyId, id, data, principal.uid);
    await appendAudit(deps, principal, capability, `portal.resident.${resource}.created`, resource, id, correlationId, target(agencyId, site, { residentUserId: principal.uid }));
    return { status: 201, body: { data: created, meta: { correlationId } } };
  });
}

async function getContractorResource(req: IncomingMessage, deps: ApiDependencies, correlationId: string, resource: string): Promise<ApiResponse> {
  const agencyId = agencyHeader(req); const site = requireSite(req); const principal = await contractorPrincipal(req, deps, correlationId, agencyId, site); const contractorId = principal.contractorId as string;
  if (resource === 'company') { const company = await deps.repository.get('contractors', agencyId, contractorId); return { status: 200, body: { data: company ? [company] : [], meta: { correlationId } } }; }
  if (resource === 'work') { const rows = (await list(deps, 'operationalWorkOrders', agencyId, { managedSiteId: site })).filter((item) => item.contractorId === contractorId || item.assignedContractorId === contractorId); return { status: 200, body: { data: rows, meta: { correlationId } } }; }
  if (resource === 'attendance') { const rows = (await list(deps, 'contractorAttendance', agencyId, { managedSiteId: site })).filter((item) => item.contractorId === contractorId); return { status: 200, body: { data: rows, meta: { correlationId } } }; }
  if (resource === 'quotes') { const rows = (await list(deps, 'operationalQuotes', agencyId, { managedSiteId: site })).filter((item) => item.contractorId === contractorId); return { status: 200, body: { data: rows, meta: { correlationId } } }; }
  if (resource === 'compliance') { return { status: 200, body: { data: await list(deps, 'contractorCompliance', agencyId, { contractorId }), meta: { correlationId } } }; }
  const work = (await list(deps, 'operationalWorkOrders', agencyId, { managedSiteId: site })).filter((item) => item.contractorId === contractorId || item.assignedContractorId === contractorId); const workIds = new Set(work.map((item) => item.id));
  if (resource === 'schedule') { const rows = (await list(deps, 'calendarEvents', agencyId, { managedSiteId: site })).filter((item) => (item.linkedEntityId && workIds.has(String(item.linkedEntityId))) || String(item.eventType ?? '').includes('contractor')); return { status: 200, body: { data: rows, meta: { correlationId } } }; }
  if (resource === 'documents') { const rows = (await list(deps, 'documents', agencyId, { managedSiteId: site })).filter((item) => ['public', 'contractor', 'portal'].includes(String(item.visibility ?? '').toLowerCase())).filter((item) => !item.linkedEntityId || workIds.has(String(item.linkedEntityId))); return { status: 200, body: { data: rows, meta: { correlationId } } }; }
  throw new ApiError(404, 'PORTAL_RESOURCE_NOT_FOUND', 'Contractor portal resource not found.');
}

async function createContractorAttendance(req: IncomingMessage, deps: ApiDependencies, correlationId: string): Promise<ApiResponse> {
  const agencyId = agencyHeader(req); const site = requireSite(req); const principal = await contractorPrincipal(req, deps, correlationId, agencyId, site); const body = await readJson(req); const contractorId = principal.contractorId as string;
  const id = randomUUID(); const data = { ...body, managedSiteId: site, contractorId, contractorUserId: principal.uid, checkedInAt: new Date().toISOString(), status: 'checked_in' };
  await authenticateAndAuthorise(req, deps, 'contractor.attendance.manage', target(agencyId, site, { contractorId, assignedContractorId: contractorId }), correlationId);
  return idempotent(deps, req, agencyId, 'portal:contractor:attendance:create', body, async () => {
    const created = await deps.repository.create('contractorAttendance', agencyId, id, data, principal.uid);
    await appendAudit(deps, principal, 'contractor.attendance.manage', 'portal.contractor.check_in', 'contractor_attendance', id, correlationId, target(agencyId, site, { contractorId }));
    return { status: 201, body: { data: created, meta: { correlationId } } };
  });
}

async function getSiteResource(req: IncomingMessage, deps: ApiDependencies, correlationId: string, resource: string): Promise<ApiResponse> {
  const agencyId = agencyHeader(req); const site = requireSite(req); const principal = await sitePrincipal(req, deps, correlationId, agencyId, site);
  if (resource === 'residents') {
    const [units, occupancies] = await Promise.all([list(deps, 'units', agencyId, { managedSiteId: site }), list(deps, 'occupancies', agencyId, { managedSiteId: site })]);
    return { status: 200, body: { data: [...units.map((item) => publicRecord(item, 'unit')), ...occupancies.map((item) => publicRecord(item, 'occupancy'))], meta: { correlationId } } };
  }
  if (resource === 'users') {
    const memberships = await list(deps, 'siteMemberships', agencyId, { managedSiteId: site });
    return { status: 200, body: { data: memberships, meta: { correlationId } } };
  }
  if (resource === 'audit') {
    const events = await list(deps, 'auditEvents', agencyId, { managedSiteId: site });
    return { status: 200, body: { data: events, meta: { correlationId } } };
  }
  throw new ApiError(404, 'PORTAL_RESOURCE_NOT_FOUND', 'Site portal resource not found.');
}

async function getInspectorResource(req: IncomingMessage, deps: ApiDependencies, correlationId: string, resource: string): Promise<ApiResponse> {
  const agencyId = agencyHeader(req); const principal = await inspectorPrincipal(req, deps, correlationId, agencyId);
  const jobs = (await list(deps, 'inspectionJobs', agencyId)).filter((item) => item.inspectorId === principal.uid);
  if (resource === 'jobs') return { status: 200, body: { data: jobs, meta: { correlationId } } };
  if (resource === 'reports') { const jobIds = new Set(jobs.map((item) => item.id)); const reports = (await list(deps, 'reports', agencyId)).filter((item) => item.inspectionJobId && jobIds.has(String(item.inspectionJobId))); return { status: 200, body: { data: reports, meta: { correlationId } } }; }
  throw new ApiError(404, 'PORTAL_RESOURCE_NOT_FOUND', 'Inspector portal resource not found.');
}

export async function routePortalScopedRequest(req: IncomingMessage, deps: ApiDependencies, correlationId: string): Promise<ApiResponse | undefined> {
  const route = routeParts(req); if (route[0] !== 'api' || route[1] !== 'v1' || route[2] !== 'portal-scope') return undefined;
  const audience = route[3]; const resource = route[4]; if (!audience || !resource) throw new ApiError(404, 'PORTAL_RESOURCE_NOT_FOUND', 'Portal resource not found.');
  if (audience === 'resident') { if (req.method === 'GET') return getResidentResource(req, deps, correlationId, resource); if (req.method === 'POST') return createResidentResource(req, deps, correlationId, resource); }
  if (audience === 'contractor') { if (req.method === 'GET') return getContractorResource(req, deps, correlationId, resource); if (req.method === 'POST' && resource === 'attendance') return createContractorAttendance(req, deps, correlationId); }
  if (audience === 'site' && req.method === 'GET') return getSiteResource(req, deps, correlationId, resource);
  if (audience === 'inspector' && req.method === 'GET') return getInspectorResource(req, deps, correlationId, resource);
  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method is not supported for this portal-scoped resource.');
}
