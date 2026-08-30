import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import {
  assertFinalOperationalReportImmutable,
  canCloseDefect,
  canCloseMoveBooking,
  canSignOutContractorAttendance,
  canTransitionAccessDeviceRequest,
  canTransitionDefect,
  canTransitionMoveBooking,
  canTransitionOperationalWorkOrder,
  type AccessDeviceRequestStatus,
  type AuthorisationTarget,
  type BuildingManagementCapability,
  type DefectStatus,
  type MoveBookingStatus,
  type OperationalWorkOrderStatus,
  type SecurityCapability,
} from '@pcr/domain';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies, IdempotencyResult, StoredRecord } from './types.js';

interface BuildingResourcePolicy {
  collection: string;
  readCapability: BuildingManagementCapability;
  writeCapability?: BuildingManagementCapability;
  siteScoped: boolean;
}

const RESOURCE_POLICIES: Readonly<Record<string, BuildingResourcePolicy>> = {
  'managed-sites': { collection: 'managedSites', readCapability: 'managed_site.read', writeCapability: 'managed_site.manage', siteScoped: false },
  'daily-activity-logs': { collection: 'dailyActivityLogs', readCapability: 'building.activity.read', writeCapability: 'building.activity.manage', siteScoped: true },
  'resident-requests': { collection: 'residentRequests', readCapability: 'resident.request.read', writeCapability: 'resident.request.manage', siteScoped: true },
  contractors: { collection: 'contractors', readCapability: 'contractor.read', writeCapability: 'contractor.manage', siteScoped: false },
  'contractor-attendance': { collection: 'contractorAttendance', readCapability: 'contractor.attendance.read', writeCapability: 'contractor.attendance.manage', siteScoped: true },
  'key-register': { collection: 'keyRegister', readCapability: 'key_register.read', writeCapability: 'key_register.manage', siteScoped: true },
  'key-transactions': { collection: 'keyTransactions', readCapability: 'key_register.read', writeCapability: 'key_register.manage', siteScoped: true },
  'access-device-requests': { collection: 'accessDeviceRequests', readCapability: 'access_device.read', writeCapability: 'access_device.manage', siteScoped: true },
  'access-devices': { collection: 'accessDevices', readCapability: 'access_device.read', writeCapability: 'access_device.manage', siteScoped: true },
  'move-bookings': { collection: 'moveBookings', readCapability: 'move_booking.read', writeCapability: 'move_booking.manage', siteScoped: true },
  'resident-onboarding': { collection: 'residentOnboarding', readCapability: 'resident.read', writeCapability: 'resident.manage', siteScoped: true },
  'operational-inspections': { collection: 'operationalInspections', readCapability: 'operational_inspection.read', writeCapability: 'operational_inspection.perform', siteScoped: true },
  'operational-inspection-results': { collection: 'operationalInspectionResults', readCapability: 'operational_inspection.read', writeCapability: 'operational_inspection.perform', siteScoped: true },
  defects: { collection: 'defects', readCapability: 'defect.read', writeCapability: 'defect.manage', siteScoped: true },
  assets: { collection: 'assets', readCapability: 'asset.read', writeCapability: 'asset.manage', siteScoped: true },
  'maintenance-plans': { collection: 'maintenancePlans', readCapability: 'maintenance_plan.read', writeCapability: 'maintenance_plan.manage', siteScoped: true },
  'service-events': { collection: 'serviceEvents', readCapability: 'maintenance_plan.read', writeCapability: 'maintenance_plan.manage', siteScoped: true },
  'waste-services': { collection: 'wasteServices', readCapability: 'waste.read', writeCapability: 'waste.manage', siteScoped: true },
  'waste-events': { collection: 'wasteEvents', readCapability: 'waste.read', writeCapability: 'waste.manage', siteScoped: true },
  incidents: { collection: 'incidents', readCapability: 'incident.read', writeCapability: 'incident.manage', siteScoped: true },
  'bylaw-observations': { collection: 'bylawObservations', readCapability: 'bylaw.read', writeCapability: 'bylaw.create', siteScoped: true },
  notices: { collection: 'notices', readCapability: 'building_notice.read', writeCapability: 'building_notice.manage', siteScoped: true },
  handovers: { collection: 'handovers', readCapability: 'handover.read', writeCapability: 'handover.manage', siteScoped: true },
  'handover-checklist-items': { collection: 'handoverChecklistItems', readCapability: 'handover.read', writeCapability: 'handover.manage', siteScoped: true },
  'operational-report-drafts': { collection: 'operationalReportDrafts', readCapability: 'operational_report.read', writeCapability: 'operational_report.prepare', siteScoped: true },
  'operational-reports': { collection: 'operationalReports', readCapability: 'operational_report.read', siteScoped: true },
  tasks: { collection: 'tasks', readCapability: 'building_task.read', writeCapability: 'building_task.manage', siteScoped: true },
  'calendar-events': { collection: 'calendarEvents', readCapability: 'building_calendar.read', writeCapability: 'building_calendar.manage', siteScoped: true },
  documents: { collection: 'documents', readCapability: 'building_document.read', writeCapability: 'building_document.manage', siteScoped: true },
  'inventory-items': { collection: 'inventoryItems', readCapability: 'asset.read', writeCapability: 'asset.manage', siteScoped: true },
  'operational-quotes': { collection: 'operationalQuotes', readCapability: 'operational_quote.read', writeCapability: 'operational_quote.manage', siteScoped: true },
  'operational-approvals': { collection: 'operationalApprovals', readCapability: 'operational_approval.read', writeCapability: 'operational_approval.decide', siteScoped: true },
  'operational-work-orders': { collection: 'operationalWorkOrders', readCapability: 'operational_work_order.read', writeCapability: 'operational_work_order.manage', siteScoped: true },
  notifications: { collection: 'notifications', readCapability: 'building_notice.read', siteScoped: false },
  'property-operating-settings': { collection: 'propertyOperatingSettings', readCapability: 'managed_site.read', writeCapability: 'managed_site.manage', siteScoped: true },
};

const PROTECTED_LIFECYCLE_FIELDS = new Set([
  'status', 'finalisedAt', 'finalisedBy', 'immutable', 'checkedOutAt', 'verifiedAt', 'verifiedBy',
]);

function parts(req: IncomingMessage): string[] {
  return new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean);
}

function agencyHeader(req: IncomingMessage): string {
  const agencyId = req.headers['x-agency-id']?.toString().trim();
  if (!agencyId) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.');
  return agencyId;
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 1_000_000) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 1 MB.');
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required');
    return value as Record<string, unknown>;
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Request body must be a JSON object.');
  }
}

function target(record: Record<string, unknown>, agencyId: string): AuthorisationTarget {
  return {
    agencyId,
    ...(typeof record.managedSiteId === 'string' ? { managedSiteId: record.managedSiteId } : {}),
    ...(typeof record.buildingId === 'string' ? { buildingId: record.buildingId } : {}),
    ...(typeof record.locationId === 'string' ? { locationId: record.locationId } : {}),
    ...(typeof record.propertyAreaId === 'string' ? { locationId: record.propertyAreaId } : {}),
    ...(typeof record.unitId === 'string' ? { unitId: record.unitId } : {}),
    ...(typeof record.propertyId === 'string' ? { propertyId: record.propertyId } : {}),
    ...(typeof record.clientAccountId === 'string' ? { clientAccountId: record.clientAccountId } : {}),
    ...(typeof record.clientId === 'string' ? { clientAccountId: record.clientId } : {}),
    ...(typeof record.residentUserId === 'string' ? { residentUserId: record.residentUserId } : {}),
    ...(typeof record.defectId === 'string' ? { defectId: record.defectId } : {}),
    ...(typeof record.operationalWorkOrderId === 'string' ? { operationalWorkOrderId: record.operationalWorkOrderId } : {}),
    ...(typeof record.contractorId === 'string' ? { contractorId: record.contractorId, assignedContractorId: record.contractorId } : {}),
    ...(typeof record.assignedContractorId === 'string' ? { assignedContractorId: record.assignedContractorId } : {}),
    ...(typeof record.status === 'string' ? { lifecycleStatus: record.status } : {}),
  };
}

function requireManagedSite(policy: BuildingResourcePolicy, data: Record<string, unknown>): void {
  if (policy.siteScoped && typeof data.managedSiteId !== 'string') {
    throw new ApiError(400, 'MANAGED_SITE_REQUIRED', 'managedSiteId is required for this Building Management resource.');
  }
}

function expectedVersion(body: Record<string, unknown>): number {
  const value = body.expectedVersion;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new ApiError(400, 'EXPECTED_VERSION_REQUIRED', 'expectedVersion must be a positive integer.');
  }
  return value;
}

function idempotencyKey(req: IncomingMessage): string {
  const value = req.headers['idempotency-key']?.toString().trim();
  if (!value || value.length < 8 || value.length > 200) {
    throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key is required.');
  }
  return value;
}

function payloadHash(body: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

async function idempotent(
  dependencies: ApiDependencies,
  req: IncomingMessage,
  agencyId: string,
  operation: string,
  body: Record<string, unknown>,
  action: () => Promise<IdempotencyResult>,
): Promise<ApiResponse> {
  const execution = await dependencies.idempotency.execute(
    agencyId,
    operation,
    idempotencyKey(req),
    payloadHash(body),
    action,
  );
  return {
    status: execution.result.status,
    body: execution.result.body,
    headers: { 'idempotency-replayed': String(execution.replayed) },
  };
}

async function appendAudit(
  dependencies: ApiDependencies,
  principal: { uid: string; role: string; agencyId: string },
  capability: SecurityCapability,
  eventType: string,
  entityType: string,
  entityId: string,
  correlationId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await dependencies.audit.append({
    id: randomUUID(), timestamp: new Date().toISOString(), actorId: principal.uid,
    actorRole: principal.role, agencyId: principal.agencyId, capability, outcome: 'allowed',
    reason: eventType, target: { agencyId: principal.agencyId }, correlationId,
    eventType, entityType, entityId, metadata,
  });
}

function cleanWriteBody(body: Record<string, unknown>): Record<string, unknown> {
  const value = { ...body };
  for (const field of ['id', 'agencyId', 'version', 'expectedVersion', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy']) delete value[field];
  return value;
}

async function transition(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
  policy: BuildingResourcePolicy,
  resourceName: string,
  id: string,
  body: Record<string, unknown>,
): Promise<ApiResponse> {
  if (!policy.writeCapability) throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'This resource is read-only.');
  const agencyId = agencyHeader(req);
  const existing = await dependencies.repository.get(policy.collection, agencyId, id);
  if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Record not found.');
  const principal = await authenticateAndAuthorise(req, dependencies, policy.writeCapability, target(existing, agencyId), correlationId);
  const version = expectedVersion(body);
  if (version !== existing.version) throw new ApiError(409, 'VERSION_CONFLICT', 'Record changed. Reload and retry.');
  const requested = typeof body.status === 'string' ? body.status : '';
  if (!requested) throw new ApiError(400, 'STATUS_REQUIRED', 'A target status is required.');

  let allowed = false;
  let extraPatch: Record<string, unknown> = {};
  if (resourceName === 'defects') {
    allowed = canTransitionDefect(existing.status as DefectStatus, requested as DefectStatus);
    if (requested === 'closed') {
      const closure = canCloseDefect({
        status: existing.status as DefectStatus,
        hasCompletionEvidence: body.hasCompletionEvidence === true,
        verifiedByUserId: typeof existing.verifiedBy === 'string' ? existing.verifiedBy : null,
      });
      if (!closure.allowed) throw new ApiError(409, 'DEFECT_CLOSE_BLOCKED', closure.reason ?? 'Defect cannot be closed.');
    }
  } else if (resourceName === 'operational-work-orders') {
    allowed = canTransitionOperationalWorkOrder(existing.status as OperationalWorkOrderStatus, requested as OperationalWorkOrderStatus);
  } else if (resourceName === 'move-bookings') {
    allowed = canTransitionMoveBooking(existing.status as MoveBookingStatus, requested as MoveBookingStatus);
    if (requested === 'closed') {
      const closure = canCloseMoveBooking({
        status: existing.status as MoveBookingStatus,
        keysReturned: body.keysReturned === true,
        hasPostMoveInspection: body.hasPostMoveInspection === true,
      });
      if (!closure.allowed) throw new ApiError(409, 'MOVE_CLOSE_BLOCKED', closure.reason ?? 'Move cannot be closed.');
      extraPatch = { keysReturned: true, closedAt: new Date().toISOString() };
    }
  } else if (resourceName === 'access-device-requests') {
    allowed = canTransitionAccessDeviceRequest(existing.status as AccessDeviceRequestStatus, requested as AccessDeviceRequestStatus);
  } else {
    throw new ApiError(404, 'TRANSITION_NOT_SUPPORTED', 'Lifecycle transitions are not configured for this resource.');
  }
  if (!allowed) throw new ApiError(409, 'INVALID_TRANSITION', `Cannot transition ${resourceName} from ${String(existing.status)} to ${requested}.`);

  return idempotent(dependencies, req, agencyId, `building:${resourceName}:${id}:transition`, body, async () => {
    const updated = await dependencies.repository.update(
      policy.collection, agencyId, id,
      { status: requested, ...extraPatch, ...(typeof body.reason === 'string' ? { transitionReason: body.reason.trim() } : {}) },
      version, principal.uid,
    );
    await appendAudit(dependencies, principal, policy.writeCapability as SecurityCapability, `building.${resourceName}.transition`, resourceName, id, correlationId, { from: existing.status, to: requested });
    return { status: 200, body: { data: updated, meta: { correlationId } } };
  });
}

async function signOutAttendance(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
  policy: BuildingResourcePolicy,
  id: string,
  body: Record<string, unknown>,
): Promise<ApiResponse> {
  const agencyId = agencyHeader(req);
  const existing = await dependencies.repository.get(policy.collection, agencyId, id);
  if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Attendance record not found.');
  const principal = await authenticateAndAuthorise(req, dependencies, 'contractor.attendance.manage', target(existing, agencyId), correlationId);
  const version = expectedVersion(body);
  const decision = canSignOutContractorAttendance({
    keyIssued: body.keyIssued === true,
    keyReturned: body.keyReturned === true,
    overrideReason: typeof body.overrideReason === 'string' ? body.overrideReason : null,
  });
  if (!decision.allowed) throw new ApiError(409, 'ACCESS_ITEM_OUTSTANDING', decision.reason ?? 'Sign-out is blocked.');
  return idempotent(dependencies, req, agencyId, `building:contractor-attendance:${id}:sign-out`, body, async () => {
    const updated = await dependencies.repository.update(policy.collection, agencyId, id, {
      status: 'checked_out', checkedOutAt: new Date().toISOString(), keysReturned: body.keyReturned === true,
      ...(decision.requiresOverride ? { keyReturnOverrideReason: String(body.overrideReason), keyReturnOverrideBy: principal.uid } : {}),
      ...(typeof body.signoutNotes === 'string' ? { signoutNotes: body.signoutNotes.trim() } : {}),
    }, version, principal.uid);
    await appendAudit(dependencies, principal, 'contractor.attendance.manage', 'building.contractor_attendance.sign_out', 'contractor_attendance', id, correlationId, { override: decision.requiresOverride });
    return { status: 200, body: { data: updated, meta: { correlationId } } };
  });
}

export async function routeBuildingManagementRequest(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
): Promise<ApiResponse | undefined> {
  const route = parts(req);
  if (route[0] !== 'api' || route[1] !== 'v1' || route[2] !== 'building') return undefined;
  const resourceName = route[3];
  if (!resourceName) return { status: 200, body: { name: 'ProInspect Building Management API', version: 'v1' } };
  const policy = RESOURCE_POLICIES[resourceName];
  if (!policy) throw new ApiError(404, 'NOT_FOUND', 'Building Management resource not found.');
  const id = route[4];
  const command = route[5];

  if (req.method === 'POST' && id && command === 'transitions') {
    return transition(req, dependencies, correlationId, policy, resourceName, id, await readJson(req));
  }
  if (req.method === 'POST' && resourceName === 'contractor-attendance' && id && command === 'sign-out') {
    return signOutAttendance(req, dependencies, correlationId, policy, id, await readJson(req));
  }

  const agencyId = agencyHeader(req);
  if (req.method === 'GET') {
    if (id) {
      const record = await dependencies.repository.get(policy.collection, agencyId, id);
      if (!record) throw new ApiError(404, 'NOT_FOUND', 'Record not found.');
      const principal = await authenticateAndAuthorise(req, dependencies, policy.readCapability, target(record, agencyId), correlationId);
      return { status: 200, body: { data: record, meta: { correlationId, actor: principal.uid } } };
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    const managedSiteId = url.searchParams.get('managedSiteId')?.trim() || undefined;
    const queryTarget = { agencyId, ...(managedSiteId ? { managedSiteId } : {}) };
    requireManagedSite(policy, queryTarget);
    const principal = await authenticateAndAuthorise(req, dependencies, policy.readCapability, target(queryTarget, agencyId), correlationId);
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50), 1), 100);
    const page = await dependencies.repository.list(policy.collection, agencyId, limit, url.searchParams.get('cursor') ?? undefined);
    const filtered = managedSiteId ? page.items.filter((item) => item.managedSiteId === managedSiteId) : page.items;
    return { status: 200, body: { data: filtered, meta: { correlationId, actor: principal.uid, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) } } };
  }

  if (!policy.writeCapability) throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'This resource is read-only.');
  const body = await readJson(req);
  if (req.method === 'POST' && !id) {
    const data = cleanWriteBody(body);
    requireManagedSite(policy, data);
    const principal = await authenticateAndAuthorise(req, dependencies, policy.writeCapability, target(data, agencyId), correlationId);
    const recordId = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : randomUUID();
    return idempotent(dependencies, req, agencyId, `building:${resourceName}:create`, body, async () => {
      const created = await dependencies.repository.create(policy.collection, agencyId, recordId, data, principal.uid);
      await appendAudit(dependencies, principal, policy.writeCapability as SecurityCapability, `building.${resourceName}.created`, resourceName, recordId, correlationId, {});
      return { status: 201, body: { data: created, meta: { correlationId } } };
    });
  }

  if ((req.method === 'PATCH' || req.method === 'PUT') && id) {
    const existing = await dependencies.repository.get(policy.collection, agencyId, id);
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Record not found.');
    if (resourceName === 'operational-reports') {
      assertFinalOperationalReportImmutable({
        immutable: existing.immutable === true,
        existingFinalisedAt: typeof existing.finalisedAt === 'string' ? existing.finalisedAt : undefined,
        requestedMutation: 'update',
      });
    }
    const suppliedProtected = Object.keys(body).filter((field) => PROTECTED_LIFECYCLE_FIELDS.has(field));
    if (suppliedProtected.length) throw new ApiError(400, 'LIFECYCLE_FIELD_PROTECTED', 'Use a lifecycle command for protected fields.', { fields: suppliedProtected });
    const principal = await authenticateAndAuthorise(req, dependencies, policy.writeCapability, target(existing, agencyId), correlationId);
    const version = expectedVersion(body);
    return idempotent(dependencies, req, agencyId, `building:${resourceName}:${id}:update`, body, async () => {
      const updated = await dependencies.repository.update(policy.collection, agencyId, id, cleanWriteBody(body), version, principal.uid);
      await appendAudit(dependencies, principal, policy.writeCapability as SecurityCapability, `building.${resourceName}.updated`, resourceName, id, correlationId, {});
      return { status: 200, body: { data: updated, meta: { correlationId } } };
    });
  }

  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method is not supported for this Building Management resource.');
}

export const BUILDING_MANAGEMENT_RESOURCE_NAMES = Object.freeze(Object.keys(RESOURCE_POLICIES));
export type BuildingManagementStoredRecord = StoredRecord;
