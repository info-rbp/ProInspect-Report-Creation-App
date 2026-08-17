import type { InspectionJobStatus, ReportLifecycleStatus, UserRole } from './platform.js';
import type { ReportAggregate, ReportComponentRecord } from './reportModel.js';
import { inspectionPolicy } from './inspectionPolicy.js';

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

function componentField(areaId: string, componentId: string): string {
  return `${areaId}.${componentId}`;
}

function hasEvidence(component: Pick<ReportComponentRecord, 'photoReferences'>): boolean {
  return Array.isArray(component.photoReferences) && component.photoReferences.length > 0;
}

function isException(component: ReportAggregate['areas'][number]['components'][number]): boolean {
  return Boolean(
    component.maintenanceRequired ||
    component.defects?.length ||
    component.conditionCategory === 'repair_required' ||
    component.conditionCategory === 'replacement_recommended' ||
    component.cleanlinessCategory === 'requires_cleaning' ||
    component.cleanlinessCategory === 'stained' ||
    component.workingStatus === 'not_working' ||
    component.testStatus === 'tested_failed'
  );
}

function isUnassessed(component: ReportAggregate['areas'][number]['components'][number]): boolean {
  return Boolean(
    !component.conditionCategory ||
    !component.cleanlinessCategory ||
    !component.workingStatus ||
    !component.testStatus ||
    component.conditionCategory === 'unable_to_confirm' ||
    component.cleanlinessCategory === 'unable_to_confirm' ||
    component.workingStatus === 'unable_to_confirm' ||
    component.testStatus === 'unable_to_confirm'
  );
}

function comparisonNeedsHumanReview(status: string | undefined): boolean {
  return [
    'material_change',
    'deteriorated',
    'improved',
    'new_item',
    'missing_item',
    'unable_to_compare',
    'review_required',
  ].includes(status ?? '');
}

function evaluateInspectionContent(reportAggregate: ReportAggregate | null | undefined): {
  requiredEvidenceComplete: boolean;
  requiredComponentsComplete: boolean;
  blockers: GateBlocker[];
} {
  const blockers: GateBlocker[] = [];
  if (!reportAggregate?.areas?.length) {
    return {
      requiredEvidenceComplete: false,
      requiredComponentsComplete: false,
      blockers: [{
        gate: 'requiredEvidenceComplete',
        code: 'NO_AREAS_OR_COMPONENTS',
        message: 'Inspection report must contain areas and components.',
      }],
    };
  }

  const policy = inspectionPolicy(reportAggregate.report.reportType || 'entry');
  let requiredEvidenceComplete = true;
  let requiredComponentsComplete = true;

  if (policy.requiresBaseline) {
    const baselineBound = Boolean(
      reportAggregate.report.baselineReportId?.trim() &&
      reportAggregate.report.baselineReportVersionId?.trim(),
    );
    if (!baselineBound) {
      requiredComponentsComplete = false;
      blockers.push({
        gate: 'requiredComponentsComplete',
        code: policy.inspectionType === 'exit' ? 'ENTRY_BASELINE_REQUIRED' : 'BASELINE_REQUIRED',
        message: policy.inspectionType === 'exit'
          ? 'Exit Inspection requires an immutable Entry Property Condition Report baseline for the same tenancy.'
          : `${policy.displayName} requires an immutable baseline report version.`,
      });
    }
  }

  for (const area of reportAggregate.areas) {
    if (!area.components?.length) {
      requiredEvidenceComplete = false;
      requiredComponentsComplete = false;
      blockers.push({
        gate: 'requiredEvidenceComplete',
        code: 'AREA_EMPTY',
        message: `Area "${area.name}" contains no inspection components.`,
        field: area.id,
      });
      continue;
    }

    if (policy.areaOverviewEvidenceRequired && (!area.photoReferences || area.photoReferences.length === 0)) {
      requiredEvidenceComplete = false;
      blockers.push({
        gate: 'requiredEvidenceComplete',
        code: 'AREA_OVERVIEW_EVIDENCE_REQUIRED',
        message: `${policy.displayName} requires area overview evidence for "${area.name}".`,
        field: area.id,
      });
    }

    for (const component of area.components) {
      const field = componentField(area.id, component.id);
      const exception = isException(component);

      if (exception && !hasEvidence(component)) {
        requiredEvidenceComplete = false;
        blockers.push({
          gate: 'requiredEvidenceComplete',
          code: 'EVIDENCE_REQUIRED',
          message: `Evidence photograph required for the exception recorded on "${area.name} - ${component.component}".`,
          field,
        });
      }

      if (isUnassessed(component)) {
        requiredComponentsComplete = false;
        blockers.push({
          gate: 'requiredComponentsComplete',
          code: 'COMPONENT_UNASSESSED',
          message: `Component assessment incomplete for "${area.name} - ${component.component}".`,
          field,
        });
      }

      const commentary = component.commentary?.trim() ?? '';
      if (policy.ordinaryComponentCommentaryRequired && !commentary) {
        requiredComponentsComplete = false;
        blockers.push({
          gate: 'requiredComponentsComplete',
          code: 'COMPONENT_COMMENTARY_REQUIRED',
          message: `${policy.displayName} requires component commentary for "${area.name} - ${component.component}".`,
          field,
        });
      }

      if (policy.inspectionType === 'routine' && exception && !commentary) {
        requiredComponentsComplete = false;
        blockers.push({
          gate: 'requiredComponentsComplete',
          code: 'ROUTINE_EXCEPTION_INCOMPLETE',
          message: `Routine exception requires specific commentary for "${area.name} - ${component.component}".`,
          field,
        });
      }

      if (policy.comparisonRequired) {
        const comparisonStatus = component.comparisonStatus;
        if (!comparisonStatus || comparisonStatus === 'not_compared') {
          requiredComponentsComplete = false;
          blockers.push({
            gate: 'requiredComponentsComplete',
            code: policy.inspectionType === 'exit' ? 'EXIT_COMPARISON_REQUIRED' : 'COMPARISON_REQUIRED',
            message: `Comparison must be completed for "${area.name} - ${component.component}" before submission.`,
            field,
          });
        } else if (
          comparisonNeedsHumanReview(comparisonStatus) &&
          !['confirmed', 'edited'].includes(component.comparisonReviewStatus ?? '')
        ) {
          requiredComponentsComplete = false;
          blockers.push({
            gate: 'requiredComponentsComplete',
            code: policy.inspectionType === 'exit' ? 'EXIT_COMPARISON_REVIEW_REQUIRED' : 'COMPARISON_REVIEW_REQUIRED',
            message: `Comparison for "${area.name} - ${component.component}" requires human confirmation.`,
            field,
          });
        }
      }
    }
  }

  return { requiredEvidenceComplete, requiredComponentsComplete, blockers };
}

export function calculateWorkflowGateContext(
  reportAggregate?: ReportAggregate | null,
  jobRecord?: Record<string, unknown> | null,
): { context: WorkflowGateContext; blockers: GateBlocker[] } {
  const content = evaluateInspectionContent(reportAggregate);
  const blockers = [...content.blockers];

  const templateVersionAssigned = Boolean(
    reportAggregate?.report?.reportType?.trim() &&
    reportAggregate?.report?.templateId?.trim() &&
    typeof reportAggregate?.report?.templateVersion === 'number' &&
    reportAggregate.report.templateVersion > 0,
  );
  if (!templateVersionAssigned) {
    blockers.push({
      gate: 'templateVersionAssigned',
      code: 'TEMPLATE_UNASSIGNED',
      message: 'A published template and immutable template version must be assigned.',
    });
  }

  const reportStatus = reportAggregate?.report?.lifecycleStatus;
  const jobStatus = jobRecord?.status as string | undefined;

  const analysisCompleteStatuses = new Set([
    'analysis_complete', 'analyst_review_in_progress', 'review_required', 'reviewer_review_in_progress',
    'changes_requested', 'reviewer_approved', 'approved_for_issue', 'ready_to_issue', 'issued_to_tenant',
    'tenant_viewed', 'tenant_response_in_progress', 'tenant_submitted', 'agent_response_required',
    'finalisation_ready', 'finalised', 'archived',
  ]);
  const analysisComplete = Boolean(
    (reportStatus && analysisCompleteStatuses.has(reportStatus)) ||
    (jobStatus && analysisCompleteStatuses.has(jobStatus)) ||
    jobRecord?.analysisStatus === 'completed',
  );
  if (!analysisComplete) {
    blockers.push({ gate: 'analysisComplete', code: 'ANALYSIS_INCOMPLETE', message: 'Photo analysis must be completed.' });
  }

  const analystApprovedStatuses = new Set([
    'review_required', 'reviewer_review_in_progress', 'reviewer_approved', 'approved_for_issue', 'ready_to_issue',
    'issued_to_tenant', 'tenant_viewed', 'tenant_response_in_progress', 'tenant_submitted', 'agent_response_required',
    'finalisation_ready', 'finalised', 'archived',
  ]);
  const analystApproved = Boolean(
    (reportStatus && analystApprovedStatuses.has(reportStatus)) ||
    (jobStatus && analystApprovedStatuses.has(jobStatus)) ||
    jobRecord?.analystApproved === true,
  );
  if (!analystApproved) {
    blockers.push({ gate: 'analystApproved', code: 'ANALYST_APPROVAL_REQUIRED', message: 'Analyst review and sign-off required.' });
  }

  const reviewerApprovedStatuses = new Set([
    'reviewer_approved', 'approved_for_issue', 'ready_to_issue', 'issued_to_tenant', 'tenant_viewed',
    'tenant_response_in_progress', 'tenant_submitted', 'agent_response_required', 'finalisation_ready', 'finalised', 'archived',
  ]);
  const reviewerApproved = Boolean(
    (reportStatus && reviewerApprovedStatuses.has(reportStatus)) ||
    (jobStatus && reviewerApprovedStatuses.has(jobStatus)) ||
    jobRecord?.reviewerApproved === true,
  );
  if (!reviewerApproved) {
    blockers.push({ gate: 'reviewerApproved', code: 'REVIEWER_APPROVAL_REQUIRED', message: 'Reviewer manager approval required.' });
  }

  const tenantResolvedStatuses = new Set(['finalisation_ready', 'finalised', 'archived']);
  const tenantResponseResolved = Boolean(
    (reportStatus && tenantResolvedStatuses.has(reportStatus)) ||
    (jobStatus && tenantResolvedStatuses.has(jobStatus)) ||
    jobRecord?.tenantResponseStatus === 'resolved' ||
    jobRecord?.tenantResponseStatus === 'not_required' ||
    !jobRecord?.tenantResponseRequired,
  );
  if (!tenantResponseResolved) {
    blockers.push({ gate: 'tenantResponseResolved', code: 'TENANT_RESPONSE_UNRESOLVED', message: 'Tenant response must be resolved.' });
  }

  const report = reportAggregate?.report;
  const shaPattern = /^[a-f0-9]{64}$/i;
  const versionBoundPdf = Boolean(
    report?.currentVersionId &&
    report.finalPdfReportVersionId === report.currentVersionId &&
    report.finalPdfObjectPath?.trim() &&
    report.finalPdfGeneration?.trim() &&
    report.finalPdfSha256 && shaPattern.test(report.finalPdfSha256) &&
    report.renderManifestObjectPath?.trim() &&
    report.renderManifestSha256 && shaPattern.test(report.renderManifestSha256),
  );
  const finalPdfCreated = Boolean(
    versionBoundPdf ||
    report?.finalisedAt ||
    (reportStatus && ['finalised', 'archived'].includes(reportStatus)) ||
    (jobStatus && ['finalised', 'archived'].includes(jobStatus)),
  );
  if (!finalPdfCreated) {
    blockers.push({
      gate: 'finalPdfCreated',
      code: 'PDF_NOT_GENERATED_OR_STALE',
      message: 'A stored final PDF and render manifest must match the current immutable report version.',
    });
  }

  const versionBoundArchive = Boolean(
    report?.currentVersionId &&
    report.archiveReportVersionId === report.currentVersionId &&
    report.archiveManifestObjectPath?.trim() &&
    report.archiveManifestSha256 &&
    shaPattern.test(report.archiveManifestSha256) &&
    report.archiveCreatedAt,
  );
  const archiveCreated = Boolean(
    versionBoundArchive || reportStatus === 'archived' || jobStatus === 'archived',
  );
  if (!archiveCreated) {
    blockers.push({
      gate: 'archiveCreated',
      code: 'ARCHIVE_NOT_CREATED_OR_STALE',
      message: 'An immutable archive manifest matching the current report version must be created before archiving.',
    });
  }

  return {
    context: {
      requiredEvidenceComplete: content.requiredEvidenceComplete,
      requiredComponentsComplete: content.requiredComponentsComplete,
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
  constructor(
    readonly code: 'INVALID_TRANSITION' | 'GATE_NOT_MET' | 'VERSION_CONFLICT' | 'REASON_REQUIRED',
    message: string,
  ) {
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
  approved_for_issue: ['issued_to_tenant', 'changes_requested', 'cancelled'],
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
  on_hold: [
    'assigned', 'inspection_started', 'photos_uploading', 'photos_uploaded', 'inspection_submitted', 'analysis_queued',
    'analyst_review_in_progress', 'review_required', 'ready_to_issue', 'issued_to_tenant', 'finalisation_ready', 'cancelled',
  ],
  cancelled: ['draft'],
};

const reasonRequired = new Set<string>(['changes_requested', 'on_hold', 'cancelled', 'draft']);

export function missingReportTransitionGates(
  to: ReportLifecycleStatus,
  context: WorkflowGateContext,
): Array<keyof WorkflowGateContext> {
  const missing: Array<keyof WorkflowGateContext> = [];
  if (['photos_uploaded', 'analysis_queued', 'internal_review'].includes(to)) {
    if (!context.requiredEvidenceComplete) missing.push('requiredEvidenceComplete');
    if (!context.requiredComponentsComplete) missing.push('requiredComponentsComplete');
    if (!context.templateVersionAssigned) missing.push('templateVersionAssigned');
  }
  if (['review_required', 'approved_for_issue'].includes(to) && !context.analysisComplete) missing.push('analysisComplete');
  if (to === 'approved_for_issue' && !context.analystApproved) missing.push('analystApproved');
  if (to === 'finalisation_ready' && !context.tenantResponseResolved) missing.push('tenantResponseResolved');
  if (to === 'finalised' && !context.finalPdfCreated) missing.push('finalPdfCreated');
  if (to === 'archived' && !context.archiveCreated) missing.push('archiveCreated');
  return missing;
}

export function missingInspectionTransitionGates(
  to: InspectionJobStatus,
  context: WorkflowGateContext,
): Array<keyof WorkflowGateContext> {
  const missing: Array<keyof WorkflowGateContext> = [];
  if (['photos_uploaded', 'inspection_submitted'].includes(to)) {
    if (!context.requiredEvidenceComplete) missing.push('requiredEvidenceComplete');
    if (!context.requiredComponentsComplete) missing.push('requiredComponentsComplete');
    if (!context.templateVersionAssigned) missing.push('templateVersionAssigned');
  }
  if (to === 'review_required' && !context.analysisComplete) missing.push('analysisComplete');
  if (to === 'reviewer_approved' && !context.analystApproved) missing.push('analystApproved');
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
  return transition(input, reportTransitions, missingReportTransitionGates);
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
  return transition(input, inspectionTransitions, missingInspectionTransitionGates);
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
  gates: (to: TStatus, context: WorkflowGateContext) => Array<keyof WorkflowGateContext>,
): WorkflowTransitionEvent<TStatus> {
  if (input.currentVersion !== input.expectedVersion) {
    throw new WorkflowError('VERSION_CONFLICT', 'Workflow version has changed. Reload before retrying.');
  }
  if (!matrix[input.current].includes(input.requested)) {
    throw new WorkflowError('INVALID_TRANSITION', `Cannot transition from ${input.current} to ${input.requested}.`);
  }
  if (reasonRequired.has(input.requested) && !input.reason?.trim()) {
    throw new WorkflowError('REASON_REQUIRED', `A reason is required when transitioning to ${input.requested}.`);
  }
  const missing = gates(input.requested, input.context);
  if (missing.length) {
    throw new WorkflowError('GATE_NOT_MET', `Workflow requirements are incomplete: ${missing.join(', ')}.`);
  }
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
