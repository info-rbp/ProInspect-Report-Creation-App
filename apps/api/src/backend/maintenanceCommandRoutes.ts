import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type {
  MaintenanceItem,
  MaintenanceItemStatus,
  TenantInstruction,
  TenantInstructionStatus,
  WorkRequest,
  WorkRequestStatus,
} from '@pcr/domain';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies, IdempotencyResult } from './types.js';

type Versioned<T> = T & { version: number };

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Command payload exceeds 1 MB.');
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

function agencyHeader(req: IncomingMessage): string {
  const agencyId = req.headers['x-agency-id']?.toString().trim();
  if (!agencyId) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.');
  return agencyId;
}

function expectedVersion(body: Record<string, unknown>): number {
  const value = body.expectedVersion;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new ApiError(400, 'EXPECTED_VERSION_REQUIRED', 'expectedVersion must be a positive integer.');
  }
  return value;
}

function idempotencyKey(req: IncomingMessage): string {
  const key = req.headers['idempotency-key']?.toString().trim();
  if (!key || key.length < 8 || key.length > 200) {
    throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key is required for maintenance commands.');
  }
  return key;
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

async function load<T>(dependencies: ApiDependencies, collection: string, agencyId: string, id: string): Promise<Versioned<T>> {
  const value = await dependencies.repository.get(collection, agencyId, id);
  if (!value) throw new ApiError(404, 'NOT_FOUND', 'Record not found.');
  return value as unknown as Versioned<T>;
}

function reason(body: Record<string, unknown>, action: string): string {
  const value = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!value) throw new ApiError(400, 'REASON_REQUIRED', `A reason is required for ${action}.`);
  return value;
}

async function appendAudit(
  dependencies: ApiDependencies,
  principal: { uid: string; role: string; agencyId: string },
  eventType: string,
  entityType: string,
  entityId: string,
  correlationId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await dependencies.audit.append({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    actorId: principal.uid,
    actorRole: principal.role,
    agencyId: principal.agencyId,
    capability: 'maintenance.manage',
    outcome: 'allowed',
    reason: eventType,
    target: { agencyId: principal.agencyId },
    correlationId,
    entityType,
    entityId,
    eventType,
    metadata,
  });
}

function assertMaintenanceTransition(current: MaintenanceItemStatus, next: MaintenanceItemStatus): void {
  const matrix: Record<MaintenanceItemStatus, readonly MaintenanceItemStatus[]> = {
    suggested: ['triage_required', 'dismissed', 'duplicate', 'not_actionable', 'cancelled'],
    triage_required: ['approved', 'dismissed', 'duplicate', 'not_actionable', 'cancelled'],
    approved: ['assigned', 'in_progress', 'cancelled'],
    assigned: ['in_progress', 'verification_required', 'cancelled'],
    in_progress: ['awaiting_completion_evidence', 'verification_required', 'cancelled'],
    awaiting_completion_evidence: ['verification_required', 'in_progress', 'cancelled'],
    completed: ['verification_required', 'closed'],
    verification_required: ['verified', 'in_progress', 'cancelled'],
    verified: ['closed', 'in_progress'],
    closed: ['triage_required'],
    dismissed: ['triage_required'],
    cancelled: ['triage_required'],
    duplicate: ['triage_required'],
    not_actionable: ['triage_required'],
  };
  if (!matrix[current].includes(next)) {
    throw new ApiError(409, 'INVALID_MAINTENANCE_TRANSITION', `Cannot transition maintenance from ${current} to ${next}.`);
  }
}

function assertWorkRequestTransition(current: WorkRequestStatus, next: WorkRequestStatus): void {
  const matrix: Record<WorkRequestStatus, readonly WorkRequestStatus[]> = {
    draft: ['issued', 'cancelled'],
    issued: ['acknowledged', 'declined', 'unable_to_complete', 'cancelled'],
    acknowledged: ['in_progress', 'declined', 'unable_to_complete', 'cancelled'],
    in_progress: ['completed', 'unable_to_complete', 'cancelled'],
    completed: ['accepted'],
    accepted: [],
    declined: [],
    unable_to_complete: [],
    cancelled: [],
  };
  if (!matrix[current].includes(next)) {
    throw new ApiError(409, 'INVALID_WORK_REQUEST_TRANSITION', `Cannot transition work request from ${current} to ${next}.`);
  }
}

function assertTenantInstructionTransition(current: TenantInstructionStatus, next: TenantInstructionStatus): void {
  const matrix: Record<TenantInstructionStatus, readonly TenantInstructionStatus[]> = {
    draft: ['approval_required', 'approved', 'cancelled'],
    approval_required: ['approved', 'cancelled'],
    approved: ['issued', 'cancelled'],
    issued: ['viewed', 'awaiting_action', 'withdrawn'],
    viewed: ['awaiting_action', 'tenant_responded', 'withdrawn'],
    awaiting_action: ['tenant_responded', 'withdrawn'],
    tenant_responded: ['review_required', 'resolved'],
    review_required: ['resolved', 'awaiting_action'],
    resolved: ['closed'],
    closed: [],
    cancelled: [],
    withdrawn: [],
  };
  if (!matrix[current].includes(next)) {
    throw new ApiError(409, 'INVALID_TENANT_INSTRUCTION_TRANSITION', `Cannot transition tenant instruction from ${current} to ${next}.`);
  }
}

async function routeMaintenanceItemAction(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
  agencyId: string,
  id: string,
  action: string,
  body: Record<string, unknown>,
): Promise<ApiResponse> {
  const item = await load<MaintenanceItem>(dependencies, 'maintenanceItems', agencyId, id);
  const principal = await authenticateAndAuthorise(
    req,
    dependencies,
    'maintenance.manage',
    { agencyId, propertyId: item.propertyId, ...(item.tenancyId ? { tenancyId: item.tenancyId } : {}) },
    correlationId,
  );
  const version = expectedVersion(body);
  if (version !== item.version) throw new ApiError(409, 'VERSION_CONFLICT', 'Maintenance item changed. Reload and retry.');

  let next: MaintenanceItemStatus;
  let patch: Record<string, unknown> = {};
  const now = new Date().toISOString();

  switch (action) {
    case 'approve':
      next = 'approved';
      patch = { approvalStatus: 'approved' };
      break;
    case 'assign': {
      next = 'assigned';
      const externalContactId = typeof body.externalContactId === 'string' ? body.externalContactId.trim() : '';
      const assignedInternalUserId = typeof body.assignedInternalUserId === 'string' ? body.assignedInternalUserId.trim() : '';
      if (!externalContactId && !assignedInternalUserId) throw new ApiError(400, 'ASSIGNEE_REQUIRED', 'An internal or external assignee is required.');
      if (!item.workInstruction?.trim() && !(typeof body.workInstruction === 'string' && body.workInstruction.trim())) {
        throw new ApiError(400, 'WORK_INSTRUCTION_REQUIRED', 'Approved work instruction is required before assignment.');
      }
      patch = {
        ...(externalContactId ? { externalContactId } : {}),
        ...(assignedInternalUserId ? { assignedInternalUserId } : {}),
        ...(typeof body.workInstruction === 'string' && body.workInstruction.trim() ? { workInstruction: body.workInstruction.trim() } : {}),
      };
      break;
    }
    case 'start':
      next = 'in_progress';
      break;
    case 'await_evidence':
      next = 'awaiting_completion_evidence';
      break;
    case 'submit_completion': {
      next = 'verification_required';
      const completionNote = typeof body.completionNote === 'string' ? body.completionNote.trim() : '';
      const completionEvidenceIds = Array.isArray(body.completionEvidenceIds)
        ? body.completionEvidenceIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        : [];
      if (!completionNote && completionEvidenceIds.length === 0) {
        throw new ApiError(400, 'COMPLETION_EVIDENCE_REQUIRED', 'Completion note or evidence is required.');
      }
      patch = {
        completionNote,
        completionEvidenceIds,
        completionDate: now,
        verificationStatus: 'verification_required',
      };
      break;
    }
    case 'verify': {
      next = 'verified';
      const verificationMethod = typeof body.verificationMethod === 'string' ? body.verificationMethod : 'completion_evidence_review';
      const verificationNote = typeof body.verificationNote === 'string' ? body.verificationNote.trim() : '';
      if (!verificationNote) throw new ApiError(400, 'VERIFICATION_NOTE_REQUIRED', 'Verification note is required.');
      patch = { verificationStatus: 'verified', verificationMethod, verificationNote };
      break;
    }
    case 'close':
      next = 'closed';
      patch = { closedAt: now, closedBy: principal.uid, closureReason: reason(body, action) };
      break;
    case 'reopen':
      next = 'triage_required';
      patch = { reopenReason: reason(body, action), verificationStatus: 'unverified' };
      break;
    case 'cancel':
      next = 'cancelled';
      patch = { closureReason: reason(body, action) };
      break;
    case 'dismiss':
      next = 'dismissed';
      patch = { closureReason: reason(body, action) };
      break;
    case 'duplicate':
      next = 'duplicate';
      patch = { closureReason: reason(body, action), duplicateOfItemId: typeof body.duplicateOfItemId === 'string' ? body.duplicateOfItemId : undefined };
      break;
    case 'not_actionable':
      next = 'not_actionable';
      patch = { closureReason: reason(body, action) };
      break;
    default:
      throw new ApiError(404, 'UNKNOWN_MAINTENANCE_ACTION', `Unknown maintenance action ${action}.`);
  }

  assertMaintenanceTransition(item.status, next);
  return idempotent(dependencies, req, agencyId, `maintenance:${id}:${action}`, body, async () => {
    const updated = await dependencies.repository.update('maintenanceItems', agencyId, id, { status: next, ...patch }, version, principal.uid);
    await appendAudit(dependencies, principal, `maintenance.${action}`, 'maintenance_item', id, correlationId, { from: item.status, to: next });
    return { status: 200, body: { data: updated, meta: { correlationId } } };
  });
}

async function routeWorkRequestAction(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
  agencyId: string,
  id: string,
  action: string,
  body: Record<string, unknown>,
): Promise<ApiResponse> {
  const request = await load<WorkRequest>(dependencies, 'workRequests', agencyId, id);
  const maintenance = await load<MaintenanceItem>(dependencies, 'maintenanceItems', agencyId, request.maintenanceItemId);
  const principal = await authenticateAndAuthorise(req, dependencies, 'maintenance.manage', { agencyId, propertyId: maintenance.propertyId }, correlationId);
  const version = expectedVersion(body);
  if (version !== request.version) throw new ApiError(409, 'VERSION_CONFLICT', 'Work request changed. Reload and retry.');

  let next: WorkRequestStatus;
  let patch: Record<string, unknown> = {};
  switch (action) {
    case 'issue':
      next = 'issued';
      if (!request.externalContactId || !request.instructions.trim()) throw new ApiError(400, 'WORK_REQUEST_INCOMPLETE', 'External contact and instructions are required before issue.');
      patch = { issuedAt: new Date().toISOString() };
      break;
    case 'accept':
      next = 'accepted';
      break;
    case 'cancel':
      next = 'cancelled';
      patch = { cancellationReason: reason(body, action) };
      break;
    default:
      throw new ApiError(404, 'UNKNOWN_WORK_REQUEST_ACTION', `Unknown work request action ${action}.`);
  }
  assertWorkRequestTransition(request.status, next);
  return idempotent(dependencies, req, agencyId, `work-request:${id}:${action}`, body, async () => {
    const updated = await dependencies.repository.update('workRequests', agencyId, id, { status: next, ...patch }, version, principal.uid);
    await appendAudit(dependencies, principal, `work_request.${action}`, 'work_request', id, correlationId, { from: request.status, to: next });
    return { status: 200, body: { data: updated, meta: { correlationId } } };
  });
}

async function routeTenantInstructionAction(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
  agencyId: string,
  id: string,
  action: string,
  body: Record<string, unknown>,
): Promise<ApiResponse> {
  const instruction = await load<TenantInstruction>(dependencies, 'tenantInstructions', agencyId, id);
  const principal = await authenticateAndAuthorise(req, dependencies, 'tenant_instruction.manage', { agencyId, propertyId: instruction.propertyId, tenancyId: instruction.tenancyId }, correlationId);
  const version = expectedVersion(body);
  if (version !== instruction.version) throw new ApiError(409, 'VERSION_CONFLICT', 'Tenant instruction changed. Reload and retry.');

  let next: TenantInstructionStatus;
  let patch: Record<string, unknown> = {};
  const now = new Date().toISOString();
  switch (action) {
    case 'request_approval':
      next = 'approval_required';
      break;
    case 'approve':
      next = 'approved';
      patch = { approvedAt: now, approvedBy: principal.uid };
      break;
    case 'issue':
      next = 'issued';
      if (!instruction.approvedAt && instruction.status !== 'approved') throw new ApiError(409, 'TENANT_INSTRUCTION_NOT_APPROVED', 'Tenant instruction must be approved before issue.');
      patch = { issuedAt: now };
      break;
    case 'await_action':
      next = 'awaiting_action';
      break;
    case 'review_response':
      next = 'review_required';
      break;
    case 'resolve':
      next = 'resolved';
      patch = { resolvedAt: now, resolvedBy: principal.uid, resolutionNote: reason(body, action) };
      break;
    case 'close':
      next = 'closed';
      break;
    case 'withdraw':
      next = 'withdrawn';
      patch = { resolutionNote: reason(body, action) };
      break;
    case 'cancel':
      next = 'cancelled';
      patch = { resolutionNote: reason(body, action) };
      break;
    default:
      throw new ApiError(404, 'UNKNOWN_TENANT_INSTRUCTION_ACTION', `Unknown tenant instruction action ${action}.`);
  }
  assertTenantInstructionTransition(instruction.status, next);
  return idempotent(dependencies, req, agencyId, `tenant-instruction:${id}:${action}`, body, async () => {
    const updated = await dependencies.repository.update('tenantInstructions', agencyId, id, { status: next, ...patch }, version, principal.uid);
    await appendAudit(dependencies, principal, `tenant_instruction.${action}`, 'tenant_instruction', id, correlationId, { from: instruction.status, to: next });
    return { status: 200, body: { data: updated, meta: { correlationId } } };
  });
}

export async function routeMaintenanceCommandRequest(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
): Promise<ApiResponse | undefined> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'api' || parts[1] !== 'v1') return undefined;
  const resource = parts[2];
  const id = parts[3];
  const commandSegment = parts[4];
  const action = parts[5];
  if (!id || commandSegment !== 'actions' || !action) return undefined;
  if (!['maintenance-items', 'work-requests', 'tenant-instructions'].includes(resource)) return undefined;
  if (req.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Lifecycle commands require POST.');

  const agencyId = agencyHeader(req);
  const body = await readJson(req);
  if (resource === 'maintenance-items') return routeMaintenanceItemAction(req, dependencies, correlationId, agencyId, id, action, body);
  if (resource === 'work-requests') return routeWorkRequestAction(req, dependencies, correlationId, agencyId, id, action, body);
  return routeTenantInstructionAction(req, dependencies, correlationId, agencyId, id, action, body);
}
