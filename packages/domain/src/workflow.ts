import type { InspectionJobStatus, ReportLifecycleStatus, UserRole } from './platform.js';
import type { ReportAggregate } from './reportModel.js';

export interface WorkflowGateContext {
  requiredEvidenceComplete: boolean;
  requiredComponentsComplete: boolean;
  templateVersionAssigned: boolean;
  analysisComplete: boolean;
  analystApproved: boolean;
  reviewerApproved: boolean;
  tenantResponseResolved: boolean;
  finalPdfCreated: boolean;
  archiveCreated: boolean;
}

export interface GateBlocker {
  gate: keyof WorkflowGateContext;
  code: string;
  message: string;
  field?: string;
}

export function calculateWorkflowGateContext(
  reportAggregate?: ReportAggregate | null,
  jobRecord?: Record<string, unknown> | null,
): { context: WorkflowGateContext; blockers: GateBlocker[] } {
  const blockers: GateBlocker[] = [];

  // 1. requiredEvidenceComplete
  let requiredEvidenceComplete = true;
  if (!reportAggregate || !reportAggregate.areas || reportAggregate.areas.length === 0) {
    requiredEvidenceComplete = false;
    blockers.push({
      gate: 'requiredEvidenceComplete',
      code: 'NO_AREAS_OR_COMPONENTS',
      message: 'Inspection report must contain areas and components.',
    });
  } else {
    for (const area of reportAggregate.areas) {
      if (!area.components || area.components.length === 0) {
        requiredEvidenceComplete = false;
        blockers.push({
          gate: 'requiredEvidenceComplete',
          code: 'AREA_EMPTY',
          message: `Area "${area.name}" contains no inspection components.`,
          field: area.id,
        });
        continue;
      }
      for (const comp of area.components) {
        const hasPhotos = Array.isArray(comp.photoReferences) && comp.photoReferences.length > 0;
        const requiresPhotos =
          comp.maintenanceRequired ||
          (Array.isArray(comp.defects) && comp.defects.length > 0) ||
          comp.conditionCategory === 'repair_required' ||
          comp.conditionCategory === 'replacement_recommended';

        if (requiresPhotos && !hasPhotos) {
          requiredEvidenceComplete = false;
          blockers.push({
            gate: 'requiredEvidenceComplete',
            code: 'EVIDENCE_REQUIRED',
            message: `Evidence photograph required for defect or maintenance on "${area.name} - ${comp.component}".`,
            field: `${area.id}.${comp.id}`,
          });
        }
      }
    }
  }

  // 2. requiredComponentsComplete
  let requiredComponentsComplete = true;
  if (!reportAggregate || !reportAggregate.areas || reportAggregate.areas.length === 0) {
    requiredComponentsComplete = false;
  } else {
    for (const area of reportAggregate.areas) {
      for (const comp of area.components) {
        if (!comp.conditionCategory || !comp.cleanlinessCategory || !comp.workingStatus) {
          requiredComponentsComplete = false;
          blockers.push({
            gate: 'requiredComponentsComplete',
            code: 'COMPONENT_UNASSESSED',
            message: `Component assessment incomplete for "${area.name} - ${comp.component}".`,
            field: `${area.id}.${comp.id}`,
          });
        }
      }
    }
  }

  // 3. templateVersionAssigned
  const templateVersionAssigned = Boolean(
    reportAggregate?.report?.reportType && reportAggregate.report.reportType.trim().length > 0
  );
  if (!templateVersionAssigned) {
    blockers.push({
      gate: 'templateVersionAssigned',
      code: 'TEMPLATE_UNASSIGNED',
      message: 'Report type/template must be assigned.',
    });
  }

  // 4. analysisComplete
  const reportStatus = reportAggregate?.report?.lifecycleStatus;
  const jobStatus = jobRecord?.status as string | undefined;

  const analysisCompleteStatuses = [
    'analysis_complete',
    'analyst_review_in_progress',
    'review_required',
    'reviewer_review_in_progress',
    'changes_requested',
    'reviewer_approved',
    'approved_for_issue',
    'ready_to_issue',
    'issued_to_tenant',
    'tenant_viewed',
    'tenant_response_in_progress',
    'tenant_submitted',
    'agent_response_required',
    'finalisation_ready',
    'finalised',
    'archived',
  ];

  const analysisComplete = Boolean(
    (reportStatus && analysisCompleteStatuses.includes(reportStatus)) ||
    (jobStatus && analysisCompleteStatuses.includes(jobStatus)) ||
    jobRecord?.analysisStatus === 'completed'
  );
  if (!analysisComplete) {
    blockers.push({
      gate: 'analysisComplete',
      code: 'ANALYSIS_INCOMPLETE',
      message: 'AI photo analysis must be completed.',
    });
  }

  // 5. analystApproved
  const analystApprovedStatuses = [
    'review_required',
    'reviewer_review_in_progress',
    'reviewer_approved',
    'approved_for_issue',
    'ready_to_issue',
    'issued_to_tenant',
    'tenant_viewed',
    'tenant_response_in_progress',
    'tenant_submitted',
    'agent_response_required',
    'finalisation_ready',
    'finalised',
    'archived',
  ];
  const analystApproved = Boolean(
    (reportStatus && analystApprovedStatuses.includes(reportStatus)) ||
    (jobStatus && analystApprovedStatuses.includes(jobStatus)) ||
    jobRecord?.analystApproved === true
  );
  if (!analystApproved) {
    blockers.push({
      gate: 'analystApproved',
      code: 'ANALYST_APPROVAL_REQUIRED',
      message: 'Analyst review and sign-off required.',
    });
  }

  // 6. reviewerApproved
  const reviewerApprovedStatuses = [
    'approved_for_issue',
    'reviewer_approved',
    'ready_to_issue',
    'issued_to_tenant',
    'tenant_viewed',
    'tenant_response_in_progress',
    'tenant_submitted',
    'agent_response_required',
    'finalisation_ready',
    'finalised',
    'archived',
  ];
  const reviewerApproved = Boolean(
    (reportStatus && reviewerApprovedStatuses.includes(reportStatus)) ||
    (jobStatus && reviewerApprovedStatuses.includes(jobStatus)) ||
    jobRecord?.reviewerApproved === true
  );
  if (!reviewerApproved) {
    blockers.push({
      gate: 'reviewerApproved',
      code: 'REVIEWER_APPROVAL_REQUIRED',
      message: 'Reviewer manager approval required.',
    });
  }

  // 7. tenantResponseResolved
  const tenantResolvedStatuses = [
    'finalisation_ready',
    'finalised',
    'archived',
  ];
  const tenantResponseResolved = Boolean(
    (reportStatus && tenantResolvedStatuses.includes(reportStatus)) ||
    (jobStatus && tenantResolvedStatuses.includes(jobStatus)) ||
    jobRecord?.tenantResponseStatus === 'resolved' ||
    jobRecord?.tenantResponseStatus === 'not_required' ||
    !jobRecord?.tenantResponseRequired
  );
  if (!tenantResponseResolved) {
    blockers.push({
      gate: 'tenantResponseResolved',
      code: 'TENANT_RESPONSE_UNRESOLVED',
      message: 'Tenant response must be resolved.',
    });
  }

  // 8. finalPdfCreated
  const finalPdfCreated = Boolean(
    jobRecord?.finalPdfUrl ||
    reportAggregate?.report?.finalisedAt ||
    (reportStatus && ['finalised', 'archived'].includes(reportStatus)) ||
    (jobStatus && ['finalised', 'archived'].includes(jobStatus))
  );
  if (!finalPdfCreated) {
    blockers.push({
      gate: 'finalPdfCreated',
      code: 'PDF_NOT_GENERATED',
      message: 'Final signed PDF report must be generated.',
    });
  }

  // 9. archiveCreated
  const archiveCreated = Boolean(
    reportStatus === 'archived' || jobStatus === 'archived' || jobRecord?.archivedAt
  );
  if (!archiveCreated) {
    blockers.push({
      gate: 'archiveCreated',
      code: 'ARCHIVE_NOT_CREATED',
      message: 'Report archive record must be created.',
    });
  }

  return {
    context: {
      requiredEvidenceComplete,
      requiredComponentsComplete,
      templateVersionAssigned,
      analysisComplete,
      analystApproved,
      reviewerApproved,
      tenantResponseResolved,
      finalPdfCreated,
      archiveCreated,
    },
    blockers,
  };
}

export interface WorkflowTransitionEvent<TStatus extends string> {
  entityId: string;
  from: TStatus;
  to: TStatus;
  expectedVersion: number;
  resultingVersion: number;
  actorId: string;
  actorRole: UserRole;
  reason?: string;
  correlationId: string;
  occurredAt: string;
}

export class WorkflowError extends Error {
  constructor(readonly code: 'INVALID_TRANSITION' | 'GATE_NOT_MET' | 'VERSION_CONFLICT' | 'REASON_REQUIRED', message: string) {
    super(message);
  }
}

const reportTransitions: Record<ReportLifecycleStatus, readonly ReportLifecycleStatus[]> = {
  draft: ['photos_uploaded', 'cancelled'],
  internal_review: ['changes_requested', 'approved_for_issue', 'cancelled'],
  photos_uploaded: ['analysis_queued', 'internal_review', 'cancelled'],
  analysis_queued: ['analysis_running', 'cancelled'],
  analysis_running: ['analysis_complete', 'photos_uploaded', 'cancelled'],
  analysis_complete: ['review_required', 'internal_review', 'cancelled'],
  review_required: ['changes_requested', 'approved_for_issue', 'cancelled'],
  changes_requested: ['internal_review', 'analysis_queued', 'cancelled'],
  approved_for_issue: ['issued_to_tenant', 'cancelled'],
  issued_to_tenant: ['tenant_response_in_progress', 'finalisation_ready'],
  tenant_response_in_progress: ['tenant_submitted', 'finalisation_ready'],
  tenant_submitted: ['agent_response_required', 'finalisation_ready'],
  agent_response_required: ['finalisation_ready', 'tenant_response_in_progress'],
  finalisation_ready: ['finalised'],
  finalised: ['archived'],
  archived: [],
  cancelled: ['draft'],
};

const inspectionTransitions: Record<InspectionJobStatus, readonly InspectionJobStatus[]> = {
  draft: ['booked', 'cancelled'],
  booked: ['assigned', 'cancelled'],
  assigned: ['inspection_started', 'on_hold', 'cancelled'],
  inspection_started: ['photos_uploading', 'on_hold', 'cancelled'],
  photos_uploading: ['photos_uploaded', 'inspection_started', 'on_hold', 'cancelled'],
  photos_uploaded: ['inspection_submitted', 'photos_uploading', 'on_hold', 'cancelled'],
  inspection_submitted: ['analysis_queued', 'analyst_review_in_progress', 'on_hold', 'cancelled'],
  analysis_queued: ['analysis_running', 'analysis_failed', 'on_hold', 'cancelled'],
  analysis_running: ['analysis_complete', 'analysis_failed', 'on_hold', 'cancelled'],
  analysis_failed: ['analysis_queued', 'analyst_review_in_progress', 'on_hold', 'cancelled'],
  analysis_complete: ['analyst_review_in_progress', 'review_required', 'on_hold', 'cancelled'],
  analyst_review_in_progress: ['review_required', 'changes_requested', 'on_hold', 'cancelled'],
  review_required: ['reviewer_review_in_progress', 'on_hold', 'cancelled'],
  reviewer_review_in_progress: ['changes_requested', 'reviewer_approved', 'on_hold', 'cancelled'],
  changes_requested: ['inspection_started', 'analysis_queued', 'analyst_review_in_progress', 'on_hold', 'cancelled'],
  reviewer_approved: ['ready_to_issue', 'changes_requested', 'on_hold', 'cancelled'],
  ready_to_issue: ['issued_to_tenant', 'changes_requested', 'on_hold', 'cancelled'],
  issued_to_tenant: ['tenant_viewed', 'tenant_response_in_progress', 'finalisation_ready', 'on_hold'],
  tenant_viewed: ['tenant_response_in_progress', 'finalisation_ready', 'on_hold'],
  tenant_response_in_progress: ['tenant_submitted', 'finalisation_ready', 'on_hold'],
  tenant_submitted: ['agent_response_required', 'finalisation_ready', 'on_hold'],
  agent_response_required: ['tenant_response_in_progress', 'finalisation_ready', 'on_hold'],
  finalisation_ready: ['finalised', 'on_hold'],
  finalised: ['archived'],
  archived: [],
  on_hold: ['assigned', 'inspection_started', 'photos_uploading', 'photos_uploaded', 'inspection_submitted', 'analysis_queued', 'analyst_review_in_progress', 'review_required', 'ready_to_issue', 'issued_to_tenant', 'finalisation_ready', 'cancelled'],
  cancelled: ['draft'],
};

const reasonRequired = new Set<string>(['changes_requested', 'on_hold', 'cancelled', 'draft']);

function gateReportTransition(to: ReportLifecycleStatus, context: WorkflowGateContext): string[] {
  const missing: string[] = [];
  if (['photos_uploaded', 'analysis_queued', 'internal_review'].includes(to)) {
    if (!context.requiredEvidenceComplete) missing.push('requiredEvidenceComplete');
    if (!context.requiredComponentsComplete) missing.push('requiredComponentsComplete');
    if (!context.templateVersionAssigned) missing.push('templateVersionAssigned');
  }
  if (['review_required', 'approved_for_issue'].includes(to) && !context.analysisComplete) missing.push('analysisComplete');
  if (to === 'approved_for_issue') {
    if (!context.analystApproved) missing.push('analystApproved');
    if (!context.reviewerApproved) missing.push('reviewerApproved');
  }
  if (to === 'finalisation_ready' && !context.tenantResponseResolved) missing.push('tenantResponseResolved');
  if (to === 'finalised' && !context.finalPdfCreated) missing.push('finalPdfCreated');
  if (to === 'archived' && !context.archiveCreated) missing.push('archiveCreated');
  return missing;
}

function gateInspectionTransition(to: InspectionJobStatus, context: WorkflowGateContext): string[] {
  const missing: string[] = [];
  if (['photos_uploaded', 'inspection_submitted'].includes(to)) {
    if (!context.requiredEvidenceComplete) missing.push('requiredEvidenceComplete');
    if (!context.requiredComponentsComplete) missing.push('requiredComponentsComplete');
    if (!context.templateVersionAssigned) missing.push('templateVersionAssigned');
  }
  if (to === 'review_required' && !context.analysisComplete) missing.push('analysisComplete');
  if (to === 'reviewer_approved') {
    if (!context.analystApproved) missing.push('analystApproved');
    if (!context.reviewerApproved) missing.push('reviewerApproved');
  }
  if (to === 'finalisation_ready' && !context.tenantResponseResolved) missing.push('tenantResponseResolved');
  if (to === 'finalised' && !context.finalPdfCreated) missing.push('finalPdfCreated');
  if (to === 'archived' && !context.archiveCreated) missing.push('archiveCreated');
  return missing;
}

export function transitionReport(input: {
  entityId: string;
  current: ReportLifecycleStatus;
  requested: ReportLifecycleStatus;
  currentVersion: number;
  expectedVersion: number;
  actorId: string;
  actorRole: UserRole;
  correlationId: string;
  context: WorkflowGateContext;
  reason?: string;
  occurredAt?: string;
}): WorkflowTransitionEvent<ReportLifecycleStatus> {
  return transition(input, reportTransitions, gateReportTransition);
}

export function transitionInspectionJob(input: {
  entityId: string;
  current: InspectionJobStatus;
  requested: InspectionJobStatus;
  currentVersion: number;
  expectedVersion: number;
  actorId: string;
  actorRole: UserRole;
  correlationId: string;
  context: WorkflowGateContext;
  reason?: string;
  occurredAt?: string;
}): WorkflowTransitionEvent<InspectionJobStatus> {
  return transition(input, inspectionTransitions, gateInspectionTransition);
}

function transition<TStatus extends string>(
  input: {
    entityId: string;
    current: TStatus;
    requested: TStatus;
    currentVersion: number;
    expectedVersion: number;
    actorId: string;
    actorRole: UserRole;
    correlationId: string;
    context: WorkflowGateContext;
    reason?: string;
    occurredAt?: string;
  },
  matrix: Record<TStatus, readonly TStatus[]>,
  gates: (to: TStatus, context: WorkflowGateContext) => string[],
): WorkflowTransitionEvent<TStatus> {
  if (input.currentVersion !== input.expectedVersion) throw new WorkflowError('VERSION_CONFLICT', 'Workflow version has changed. Reload before retrying.');
  if (!matrix[input.current].includes(input.requested)) throw new WorkflowError('INVALID_TRANSITION', `Cannot transition from ${input.current} to ${input.requested}.`);
  if (reasonRequired.has(input.requested) && !input.reason?.trim()) throw new WorkflowError('REASON_REQUIRED', `A reason is required when transitioning to ${input.requested}.`);
  const missing = gates(input.requested, input.context);
  if (missing.length) throw new WorkflowError('GATE_NOT_MET', `Workflow requirements are incomplete: ${missing.join(', ')}.`);
  return {
    entityId: input.entityId,
    from: input.current,
    to: input.requested,
    expectedVersion: input.expectedVersion,
    resultingVersion: input.currentVersion + 1,
    actorId: input.actorId,
    actorRole: input.actorRole,
    ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
    correlationId: input.correlationId,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
  };
}

export const REPORT_TRANSITION_MATRIX = reportTransitions;
export const INSPECTION_TRANSITION_MATRIX = inspectionTransitions;
