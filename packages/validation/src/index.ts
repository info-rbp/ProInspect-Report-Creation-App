import type { DomainErrorShape, InspectionJobStatus, InspectionType, ReportLifecycleStatus, UserRole } from '@pcr/domain';
import { evidenceUploadSessionSchema, type EvidenceUploadSessionInput } from './photoUpload.js';

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: DomainErrorShape };

export interface ValidationSchema<T> {
  parse(value: unknown): ValidationResult<T>;
}

export interface ResourceWriteInput {
  id?: string;
  agencyId?: string;
  version?: number;
  [key: string]: unknown;
}

export type WorkflowStatus = InspectionJobStatus | ReportLifecycleStatus;

export interface WorkflowTransitionInput {
  status: WorkflowStatus;
  expectedVersion: number;
  reason?: string;
  assignedUserId?: string;
}

export type UploadSessionInput = EvidenceUploadSessionInput;

export interface TaskCreationInput {
  reportId: string;
  reportVersionId?: string;
  priority?: 'normal' | 'high';
}

export interface TenantResponseInput {
  reportId: string;
  tenancyId: string;
  responses: unknown[];
  expectedVersion: number;
}

const inspectionTypes = new Set<InspectionType>(['entry', 'routine', 'exit', 'comparison', 'maintenance']);
const workflowStatuses = new Set<WorkflowStatus>([
  'draft', 'booked', 'assigned', 'inspection_started', 'photos_uploading', 'photos_uploaded',
  'inspection_submitted', 'analysis_queued', 'analysis_running', 'analysis_failed', 'analysis_complete',
  'analyst_review_in_progress', 'review_required', 'reviewer_review_in_progress', 'changes_requested',
  'reviewer_approved', 'ready_to_issue', 'issued_to_tenant', 'tenant_viewed',
  'tenant_response_in_progress', 'tenant_submitted', 'agent_response_required', 'finalisation_ready',
  'finalised', 'archived', 'on_hold', 'cancelled', 'internal_review', 'approved_for_issue',
]);
const roles = new Set<UserRole>([
  'super_admin', 'proinspect_admin', 'operations', 'inspector', 'analyst', 'reviewer', 'tenant',
  'landlord', 'shopify_customer',
]);

function validationError(message: string, details?: Record<string, unknown>): ValidationResult<never> {
  return { ok: false, error: { code: 'VALIDATION_ERROR', message, status: 400, ...(details ? { details } : {}) } };
}

function record(value: unknown): ValidationResult<Record<string, unknown>> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return { ok: true, value: value as Record<string, unknown> };
  return validationError('Request body must be a JSON object.');
}

export function parseInspectionType(value: unknown): ValidationResult<InspectionType> {
  if (typeof value === 'string' && inspectionTypes.has(value as InspectionType)) return { ok: true, value: value as InspectionType };
  return { ok: false, error: { code: 'INVALID_INSPECTION_TYPE', message: 'Unsupported inspection type.', status: 400 } };
}

export function requireNonEmptyString(value: unknown, field: string): ValidationResult<string> {
  if (typeof value === 'string' && value.trim().length > 0) return { ok: true, value: value.trim() };
  return validationError(`${field} is required.`, { field });
}

export function requirePositiveInteger(value: unknown, field: string): ValidationResult<number> {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return { ok: true, value };
  return validationError(`${field} must be a non-negative integer.`, { field });
}

export const resourceWriteSchema: ValidationSchema<ResourceWriteInput> = {
  parse(value) {
    const parsed = record(value);
    if (!parsed.ok) return parsed;
    const forbidden = ['createdAt', 'updatedAt', 'actorId', 'actorRole'];
    const supplied = forbidden.filter((field) => field in parsed.value);
    if (supplied.length) return validationError('Server-managed fields cannot be supplied.', { fields: supplied });
    return { ok: true, value: parsed.value as ResourceWriteInput };
  },
};

export const workflowTransitionSchema: ValidationSchema<WorkflowTransitionInput> = {
  parse(value) {
    const parsed = record(value);
    if (!parsed.ok) return parsed;
    const status = parsed.value.status;
    const expectedVersion = parsed.value.expectedVersion;
    if (typeof status !== 'string' || !workflowStatuses.has(status as WorkflowStatus)) return validationError('status is not a supported workflow state.', { field: 'status' });
    const version = requirePositiveInteger(expectedVersion, 'expectedVersion');
    if (!version.ok) return version;
    const reason = parsed.value.reason;
    if (reason !== undefined && typeof reason !== 'string') return validationError('reason must be a string.', { field: 'reason' });
    const assignedUserId = parsed.value.assignedUserId;
    if (assignedUserId !== undefined && typeof assignedUserId !== 'string') return validationError('assignedUserId must be a string.', { field: 'assignedUserId' });
    return { ok: true, value: {
      status: status as WorkflowStatus,
      expectedVersion: version.value,
      ...(reason ? { reason: reason.trim() } : {}),
      ...(assignedUserId ? { assignedUserId: assignedUserId.trim() } : {}),
    } };
  },
};

export const uploadSessionSchema: ValidationSchema<UploadSessionInput> = evidenceUploadSessionSchema;

export const taskCreationSchema: ValidationSchema<TaskCreationInput> = {
  parse(value) {
    const parsed = record(value);
    if (!parsed.ok) return parsed;
    const reportId = requireNonEmptyString(parsed.value.reportId, 'reportId');
    if (!reportId.ok) return reportId;
    const priority = parsed.value.priority;
    if (priority !== undefined && priority !== 'normal' && priority !== 'high') return validationError('priority must be normal or high.', { field: 'priority' });
    return { ok: true, value: { reportId: reportId.value, ...(typeof parsed.value.reportVersionId === 'string' ? { reportVersionId: parsed.value.reportVersionId } : {}), ...(priority ? { priority } : {}) } };
  },
};

export const tenantResponseSchema: ValidationSchema<TenantResponseInput> = {
  parse(value) {
    const parsed = record(value);
    if (!parsed.ok) return parsed;
    const reportId = requireNonEmptyString(parsed.value.reportId, 'reportId');
    if (!reportId.ok) return reportId;
    const tenancyId = requireNonEmptyString(parsed.value.tenancyId, 'tenancyId');
    if (!tenancyId.ok) return tenancyId;
    const version = requirePositiveInteger(parsed.value.expectedVersion, 'expectedVersion');
    if (!version.ok) return version;
    if (!Array.isArray(parsed.value.responses)) return validationError('responses must be an array.', { field: 'responses' });
    return { ok: true, value: { reportId: reportId.value, tenancyId: tenancyId.value, responses: parsed.value.responses, expectedVersion: version.value } };
  },
};

export const userRoleSchema: ValidationSchema<UserRole> = {
  parse(value) {
    if (typeof value === 'string' && roles.has(value as UserRole)) return { ok: true, value: value as UserRole };
    return validationError('Unsupported user role.', { field: 'role' });
  },
};

export function parseWithSchema<T>(schema: ValidationSchema<T>, value: unknown): T {
  const result = schema.parse(value);
  if (!result.ok) throw result.error;
  return result.value;
}

export * from './reportModel.js';
export * from './photoUpload.js';
