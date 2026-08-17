import type { MaintenanceItemStatus, TenantInstructionStatus, WorkRequestStatus } from './maintenance.js';

export const MAINTENANCE_ITEM_TRANSITIONS: Readonly<Record<MaintenanceItemStatus, readonly MaintenanceItemStatus[]>> = Object.freeze({
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
});

export const WORK_REQUEST_TRANSITIONS: Readonly<Record<WorkRequestStatus, readonly WorkRequestStatus[]>> = Object.freeze({
  draft: ['issued', 'cancelled'],
  issued: ['acknowledged', 'declined', 'unable_to_complete', 'cancelled'],
  acknowledged: ['in_progress', 'declined', 'unable_to_complete', 'cancelled'],
  in_progress: ['completed', 'unable_to_complete', 'cancelled'],
  completed: ['accepted'],
  accepted: [],
  declined: [],
  unable_to_complete: [],
  cancelled: [],
});

export const TENANT_INSTRUCTION_TRANSITIONS: Readonly<Record<TenantInstructionStatus, readonly TenantInstructionStatus[]>> = Object.freeze({
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
});

export function canTransitionMaintenanceItem(current: MaintenanceItemStatus, next: MaintenanceItemStatus): boolean {
  return MAINTENANCE_ITEM_TRANSITIONS[current].includes(next);
}

export function canTransitionWorkRequest(current: WorkRequestStatus, next: WorkRequestStatus): boolean {
  return WORK_REQUEST_TRANSITIONS[current].includes(next);
}

export function canTransitionTenantInstruction(current: TenantInstructionStatus, next: TenantInstructionStatus): boolean {
  return TENANT_INSTRUCTION_TRANSITIONS[current].includes(next);
}
