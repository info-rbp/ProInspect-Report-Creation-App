import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import {
  canTransitionMaintenanceItem,
  canTransitionTenantInstruction,
  canTransitionWorkRequest,
  type MaintenanceItem,
  type MaintenanceItemStatus,
  type TenantInstruction,
  type TenantInstructionStatus,
  type WorkRequest,
  type WorkRequestStatus,
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
    throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key is required for lifecycle commands.');
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
  capability: 'maintenance.manage' | 'tenant_instruction.manage',
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
    capability,
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

async function maintenanceItemAction(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
  agencyId: string,
  id: string,
  action: string,
  body: Record<string, unknown>,
): Promise<IdempotencyResult> {
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
      if (item.approvalRequired && item.approvalStatus !== 'approved') {
        throw new ApiError(409, 'CLIENT_APPROVAL_REQUIRED', 'Required client approval must be recorded before maintenance approval.');
      }
      next = 'approved';
      patch = { approvalStatus: item.approvalRequired ? 'approved' : 'not_required' };
      break;
    case 'assign': {
      next = 'assigned';
      const externalContactId = typeof body.externalContactId === 'string' ? body.externalContactId.trim() : '';
      const assignedInternalUserId = typeof body.assignedInternalUserId === 'string' ? body.assignedInternalUserId.trim() : '';
      if (!externalContactId && !assignedInternalUserId) throw new ApiError(400, 'ASSIGNEE_REQUIRED', 'An internal or external assignee is required.');
      const workInstruction = typeof body.workInstruction === 'string' && body.workInstruction.trim()
        ? body.workInstruction.trim()
        : item.workInstruction?.trim() ?? '';
      if (!workInstruction) throw new ApiError(400, 'WORK_INSTRUCTION_REQUIRED', 'Approved work instruction is required before assignment.');
      patch = {
        ...(externalContactId ? { externalContactId } : {}),
        ...(assignedInternalUserId ? { assignedInternalUserId } : {}),
        workInstruction,
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
        ? [...new Set(body.completionEvidenceIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))]
        : [];
      if (!completionNote && completionEvidenceIds.length === 0) throw new ApiError(400, 'COMPLETION_EVIDENCE_REQUIRED', 'Completion note or evidence is required.');
      patch = { completionNote, completionEvidenceIds, completionDate: now, verificationStatus: 'verification_required' };
      break;
    }
    case 'verify': {
      next = 'verified';
      const verificationNote = typeof body.verificationNote === 'string' ? body.verificationNote.trim() : '';
      if (!verificationNote) throw new ApiError(400, 'VERIFICATION_NOTE_REQUIRED', 'Verification note is required.');
      const verificationMethod = typeof body.verificationMethod === 'string' ? body.verificationMethod : 'completion_evidence_review';
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
      patch = { closureReason: reason(body, action), ...(typeof body.duplicateOfItemId === 'string' ? { duplicateOfItemId: body.duplicateOfItemId } : {}) };
      break;
    case 'not_actionable':
      next = 'not_actionable';
      patch = { closureReason: reason(body, action) };
      break;
    default:
      throw new ApiError(404, 'UNKNOWN_MAINTENANCE_ACTION', `Unknown maintenance action ${action}.`);
  }

  if (!canTransitionMaintenanceItem(item.status, next)) throw new ApiError(409, 'INVALID_MAINTENANCE_TRANSITION', `Cannot transition maintenance from ${item.status} to ${next}.`);
  const updated = await dependencies.repository.update('maintenanceItems', agencyId, id, { status: next, ...patch }, version, principal.uid);
  await appendAudit(dependencies, principal, 'maintenance.manage', `maintenance.${action}`, 'maintenance_item', id, correlationId, { from: item.status, to: next });
  return { status: 200, body: { data: updated, meta: { correlationId } } };
}

async function workRequestAction(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
  agencyId: string,
  id: string,
  action: string,
  body: Record<string, unknown>,
): Promise<IdempotencyResult> {
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
  if (!canTransitionWorkRequest(request.status, next)) throw new ApiError(409, 'INVALID_WORK_REQUEST_TRANSITION', `Cannot transition work request from ${request.status} to ${next}.`);
  const updated = await dependencies.repository.update('workRequests', agencyId, id, { status: next, ...patch }, version, principal.uid);
  await appendAudit(dependencies, principal, 'maintenance.manage', `work_request.${action}`, 'work_request', id, correlationId, { from: request.status, to: next });
  return { status: 200, body: { data: updated, meta: { correlationId } } };
}

async function tenantInstructionAction(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
  agencyId: string,
  id: string,
  action: string,
  body: Record<string, unknown>,
): Promise<IdempotencyResult> {
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
  if (!canTransitionTenantInstruction(instruction.status, next)) throw new ApiError(409, 'INVALID_TENANT_INSTRUCTION_TRANSITION', `Cannot transition tenant instruction from ${instruction.status} to ${next}.`);
  const updated = await dependencies.repository.update('tenantInstructions', agencyId, id, { status: next, ...patch }, version, principal.uid);
  await appendAudit(dependencies, principal, 'tenant_instruction.manage', `tenant_instruction.${action}`, 'tenant_instruction', id, correlationId, { from: instruction.status, to: next });
  return { status: 200, body: { data: updated, meta: { correlationId } } };
}

export async function routeMaintenanceActionRequest(
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
  return idempotent(dependencies, req, agencyId, `${resource}:${id}:${action}`, body, async () => {
    if (resource === 'maintenance-items') return maintenanceItemAction(req, dependencies, correlationId, agencyId, id, action, body);
    if (resource === 'work-requests') return workRequestAction(req, dependencies, correlationId, agencyId, id, action, body);
    return tenantInstructionAction(req, dependencies, correlationId, agencyId, id, action, body);
  });
}
