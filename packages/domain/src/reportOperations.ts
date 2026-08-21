import { inspectionPolicy } from './inspectionPolicy.js';
import type { ReportAggregate } from './reportModel.js';
import type { ReportLifecycleStatus } from './platform.js';

export const REPORT_QC_SEVERITIES = ['info', 'warning', 'error', 'blocker'] as const;
export type ReportQcSeverity = (typeof REPORT_QC_SEVERITIES)[number];

export const REPORT_QC_CATEGORIES = [
  'administration',
  'evidence',
  'assessment',
  'testing',
  'commentary',
  'comparison',
  'ai_review',
  'workflow',
] as const;
export type ReportQcCategory = (typeof REPORT_QC_CATEGORIES)[number];

export interface ReportTestRecord {
  status: 'tested' | 'not_tested' | 'not_applicable';
  method?: string;
  result?: 'passed' | 'failed' | 'inconclusive';
  testedBy?: string;
  testedAt?: string;
  evidencePhotoIds?: string[];
  notes?: string;
}

export interface ReportAiSuggestion {
  id: string;
  generatedAt: string;
  model?: string;
  confidence?: number;
  proposed: Record<string, unknown>;
  status: 'suggested' | 'accepted' | 'rejected' | 'superseded';
  decidedBy?: string;
  decidedAt?: string;
}

export interface ReportQcIssue {
  id: string;
  code: string;
  severity: ReportQcSeverity;
  category: ReportQcCategory;
  message: string;
  recommendation?: string;
  areaId?: string;
  componentId?: string;
  field?: string;
}

export interface ReportQcResult {
  reportId: string;
  generatedAt: string;
  status: 'pass' | 'warnings' | 'blocked';
  score: number;
  blockerCount: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  issues: ReportQcIssue[];
}

export type ReportReviewCommentScope = 'report' | 'area' | 'component' | 'evidence' | 'comparison';
export type ReportReviewCommentStatus = 'open' | 'resolved' | 'verified';

export interface ReportReviewComment {
  id: string;
  agencyId: string;
  reportId: string;
  reportVersionId?: string;
  scope: ReportReviewCommentScope;
  areaId?: string;
  componentId?: string;
  evidencePhotoId?: string;
  category?: 'evidence' | 'assessment' | 'commentary' | 'comparison' | 'administration' | 'other';
  body: string;
  status: ReportReviewCommentStatus;
  createdBy: string;
  createdByRole: string;
  createdAt: string;
  resolvedBy?: string;
  resolvedAt?: string;
  verifiedBy?: string;
  verifiedAt?: string;
  resolutionNote?: string;
  version?: number;
}

export type ReportDistributionRecipientRole = 'tenant' | 'landlord' | 'property_manager' | 'client' | 'other';
export type ReportDistributionStatus = 'draft' | 'queued' | 'sent' | 'delivered' | 'viewed' | 'responded' | 'failed' | 'revoked' | 'expired';

export interface ReportDistribution {
  id: string;
  agencyId: string;
  reportId: string;
  reportVersionId: string;
  recipientName: string;
  recipientEmail: string;
  recipientRole: ReportDistributionRecipientRole;
  status: ReportDistributionStatus;
  subject?: string;
  message?: string;
  accessGrantId?: string;
  sentAt?: string;
  deliveredAt?: string;
  viewedAt?: string;
  downloadedAt?: string;
  respondedAt?: string;
  failedAt?: string;
  failureReason?: string;
  expiresAt?: string;
  revokedAt?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  version?: number;
}

export interface ReportAcknowledgement {
  id: string;
  agencyId: string;
  reportId: string;
  reportVersionId: string;
  distributionId: string;
  recipientEmail: string;
  recipientRole: ReportDistributionRecipientRole;
  acknowledgementType: 'received' | 'reviewed' | 'agreed' | 'disagreed';
  note?: string;
  createdAt: string;
  source: 'secure_link';
  version?: number;
}

export interface ReportRecipientResponseComment {
  areaId?: string;
  componentId?: string;
  note: string;
  evidencePhotoIds?: string[];
}

export interface ReportRecipientResponse {
  id: string;
  agencyId: string;
  reportId: string;
  reportVersionId: string;
  distributionId: string;
  recipientEmail: string;
  recipientRole: ReportDistributionRecipientRole;
  generalNote?: string;
  comments: ReportRecipientResponseComment[];
  evidencePhotoIds: string[];
  status: 'submitted' | 'under_review' | 'resolved';
  submittedAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  resolutionNote?: string;
  version?: number;
}

export interface ReportSupersession {
  id: string;
  agencyId: string;
  sourceReportId: string;
  sourceReportVersionId: string;
  supersedingReportId: string;
  reason: string;
  createdBy: string;
  createdAt: string;
  version?: number;
}

export interface ReportBrandingSnapshot {
  agencyName?: string;
  logoDocumentId?: string;
  abn?: string;
  phone?: string;
  email?: string;
  address?: string;
  disclaimerVersion?: string;
  capturedAt: string;
}

declare module './reportModel.js' {
  interface ReportComponentRecord {
    testRecord?: ReportTestRecord;
    aiSuggestion?: ReportAiSuggestion;
    authoritativeSource?: 'inspector' | 'analyst' | 'reviewer';
    lastReviewedBy?: string;
    lastReviewedAt?: string;
  }

  interface ReportMetadataRecord {
    assignedInspectorId?: string;
    assignedAnalystId?: string;
    assignedReviewerId?: string;
    qcStatus?: ReportQcResult['status'];
    distributionStatus?: ReportDistributionStatus;
    maintenanceExtractionStatus?: 'not_started' | 'queued' | 'completed' | 'failed';
    issuedReportVersionId?: string;
    supersedesReportId?: string;
    supersededByReportId?: string;
    correctionReason?: string;
    brandingSnapshot?: ReportBrandingSnapshot;
  }
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

function isOperational(component: ReportAggregate['areas'][number]['components'][number]): boolean {
  return component.workingStatus !== 'not_applicable' || component.testStatus !== 'not_applicable';
}

function normaliseCommentary(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function issueId(code: string, areaId?: string, componentId?: string): string {
  return [code, areaId, componentId].filter(Boolean).join(':');
}

export function evaluateReportQuality(aggregate: ReportAggregate): ReportQcResult {
  const policy = inspectionPolicy(aggregate.report.reportType || 'entry');
  const issues: ReportQcIssue[] = [];
  const add = (
    code: string,
    severity: ReportQcSeverity,
    category: ReportQcCategory,
    message: string,
    context: Partial<Pick<ReportQcIssue, 'areaId' | 'componentId' | 'field' | 'recommendation'>> = {},
  ) => issues.push({ id: issueId(code, context.areaId, context.componentId), code, severity, category, message, ...context });

  if (!aggregate.report.propertyId) {
    add('PROPERTY_LINK_REQUIRED', 'blocker', 'administration', 'The report must remain linked to its canonical Property record.');
  }
  if (!aggregate.report.inspectionJobId) {
    add('INSPECTION_JOB_LINK_REQUIRED', 'blocker', 'administration', 'Operational reports must be created from an Inspection Job.');
  }
  if (!aggregate.report.propertyLayoutVersionId) {
    add('PROPERTY_LAYOUT_VERSION_REQUIRED', 'blocker', 'administration', 'The exact Property layout version used for the inspection is not recorded.');
  }
  if (!aggregate.report.templateId || !aggregate.report.templateVersion) {
    add('TEMPLATE_VERSION_REQUIRED', 'blocker', 'administration', 'A published immutable Template Version must be assigned.');
  }
  if (policy.requiresBaseline && (!aggregate.report.baselineReportId || !aggregate.report.baselineReportVersionId)) {
    add('BASELINE_VERSION_REQUIRED', 'blocker', 'comparison', `${policy.displayName} requires an immutable baseline report version.`);
  }
  if (!aggregate.areas.length) {
    add('REPORT_AREAS_REQUIRED', 'blocker', 'assessment', 'The report does not contain any inspection areas.');
  }

  for (const area of aggregate.areas) {
    if (!area.components.length) {
      add('AREA_COMPONENTS_REQUIRED', 'blocker', 'assessment', `Area "${area.name}" contains no components.`, { areaId: area.id });
      continue;
    }
    if (policy.areaOverviewEvidenceRequired && !(area.photoReferences?.length)) {
      add('AREA_OVERVIEW_EVIDENCE_REQUIRED', 'blocker', 'evidence', `Area overview evidence is required for "${area.name}".`, { areaId: area.id });
    }

    for (const component of area.components) {
      const context = { areaId: area.id, componentId: component.id };
      const label = `${area.name} - ${component.component}`;
      const exception = isException(component);
      const commentary = normaliseCommentary(component.commentary);

      if (!component.conditionCategory || component.conditionCategory === 'unable_to_confirm') {
        add('CONDITION_UNASSESSED', 'blocker', 'assessment', `Condition is incomplete for "${label}".`, { ...context, field: 'conditionCategory' });
      }
      if (!component.cleanlinessCategory || component.cleanlinessCategory === 'unable_to_confirm') {
        add('CLEANLINESS_UNASSESSED', 'blocker', 'assessment', `Cleanliness is incomplete for "${label}".`, { ...context, field: 'cleanlinessCategory' });
      }
      if (exception && !component.photoReferences?.length) {
        add('EXCEPTION_EVIDENCE_REQUIRED', 'blocker', 'evidence', `Evidence is required for the exception recorded on "${label}".`, { ...context, field: 'photoReferences' });
      }
      if (policy.ordinaryComponentCommentaryRequired && !commentary) {
        add('COMMENTARY_REQUIRED', 'blocker', 'commentary', `Component commentary is required for "${label}".`, { ...context, field: 'commentary' });
      }
      if (policy.inspectionType === 'routine' && exception && !commentary) {
        add('ROUTINE_EXCEPTION_COMMENTARY_REQUIRED', 'blocker', 'commentary', `Routine exception commentary is required for "${label}".`, { ...context, field: 'commentary' });
      }

      if (isOperational(component)) {
        if (!component.workingStatus || component.workingStatus === 'unable_to_confirm') {
          add('WORKING_STATUS_UNASSESSED', 'blocker', 'testing', `Operational status is incomplete for "${label}".`, { ...context, field: 'workingStatus' });
        }
        if (!component.testStatus || component.testStatus === 'unable_to_confirm') {
          add('TEST_STATUS_UNASSESSED', 'blocker', 'testing', `Test status is incomplete for "${label}".`, { ...context, field: 'testStatus' });
        }
        if (component.workingStatus === 'operation_confirmed' && component.testStatus !== 'tested_passed') {
          add('OPERATION_CONFIRMATION_REQUIRES_TEST', 'blocker', 'testing', `"${label}" cannot be recorded as operation confirmed without a passed test.`, {
            ...context,
            field: 'testStatus',
            recommendation: 'Record a qualifying test or change the working status to a non-confirmed state.',
          });
        }
        if (component.testStatus === 'tested_passed') {
          if (component.testRecord?.status !== 'tested' || !component.testRecord.method?.trim()) {
            add('TEST_METHOD_REQUIRED', 'blocker', 'testing', `A test method is required for the passed test on "${label}".`, { ...context, field: 'testRecord.method' });
          }
          if (!component.testRecord?.testedAt || !component.testRecord?.testedBy) {
            add('TEST_PROVENANCE_REQUIRED', 'error', 'testing', `Test provenance is incomplete for "${label}".`, { ...context, field: 'testRecord' });
          }
        }
        if (component.workingStatus === 'not_working' && component.testStatus === 'tested_passed') {
          add('WORKING_TEST_CONTRADICTION', 'error', 'testing', `"${label}" is marked not working but its test is recorded as passed.`, { ...context });
        }
      }

      if (['intact', 'minor_wear'].includes(component.conditionCategory) && component.defects?.length) {
        add('CONDITION_DEFECT_CONTRADICTION', 'warning', 'assessment', `"${label}" has defects recorded while its condition is ${component.conditionCategory.replaceAll('_', ' ')}.`, { ...context });
      }
      if (component.conditionCategory === 'replacement_recommended' && !component.maintenanceRequired) {
        add('REPLACEMENT_WITHOUT_MAINTENANCE', 'error', 'assessment', `"${label}" recommends replacement but maintenance is not flagged.`, { ...context, field: 'maintenanceRequired' });
      }
      if (component.cleanlinessCategory === 'clean' && /\b(dirty|unclean|stain(?:ed|ing)?|requires cleaning)\b/u.test(commentary)) {
        add('CLEANLINESS_COMMENTARY_CONTRADICTION', 'warning', 'commentary', `Commentary for "${label}" appears inconsistent with a Clean classification.`, { ...context });
      }
      if (['intact', 'minor_wear'].includes(component.conditionCategory) && /\b(broken|cracked|damaged|repair required|replacement required)\b/u.test(commentary)) {
        add('CONDITION_COMMENTARY_CONTRADICTION', 'warning', 'commentary', `Commentary for "${label}" may conflict with the recorded condition.`, { ...context });
      }
      if (component.reviewStatus === 'ai_generated' && typeof component.aiConfidence === 'number' && component.aiConfidence < 0.65) {
        add('LOW_AI_CONFIDENCE_REVIEW_REQUIRED', 'warning', 'ai_review', `AI confidence is low for "${label}" and requires human review.`, { ...context });
      }

      if (policy.comparisonRequired) {
        if (!component.comparisonStatus || component.comparisonStatus === 'not_compared') {
          add('COMPARISON_REQUIRED', 'blocker', 'comparison', `Comparison is incomplete for "${label}".`, { ...context });
        }
        if (
          ['material_change', 'deteriorated', 'improved', 'new_item', 'missing_item', 'unable_to_compare', 'review_required'].includes(component.comparisonStatus ?? '') &&
          !['confirmed', 'edited'].includes(component.comparisonReviewStatus ?? '')
        ) {
          add('COMPARISON_HUMAN_REVIEW_REQUIRED', 'blocker', 'comparison', `The comparison for "${label}" requires human confirmation.`, { ...context });
        }
      }
    }
  }

  const blockerCount = issues.filter((issue) => issue.severity === 'blocker').length;
  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
  const infoCount = issues.filter((issue) => issue.severity === 'info').length;
  const score = Math.max(0, 100 - blockerCount * 18 - errorCount * 8 - warningCount * 2);
  return {
    reportId: aggregate.report.id,
    generatedAt: new Date().toISOString(),
    status: blockerCount || errorCount ? 'blocked' : warningCount ? 'warnings' : 'pass',
    score,
    blockerCount,
    errorCount,
    warningCount,
    infoCount,
    issues,
  };
}

export function reportLifecycleGroup(status: ReportLifecycleStatus):
  | 'draft'
  | 'analysis'
  | 'review'
  | 'changes_requested'
  | 'ready_to_issue'
  | 'tenant_response'
  | 'finalisation'
  | 'archived'
  | 'cancelled' {
  if (status === 'draft' || status === 'photos_uploaded') return 'draft';
  if (['analysis_queued', 'analysis_running', 'analysis_complete'].includes(status)) return 'analysis';
  if (['internal_review', 'review_required'].includes(status)) return 'review';
  if (status === 'changes_requested') return 'changes_requested';
  if (status === 'approved_for_issue') return 'ready_to_issue';
  if (['issued_to_tenant', 'tenant_response_in_progress', 'tenant_submitted', 'agent_response_required'].includes(status)) return 'tenant_response';
  if (['finalisation_ready', 'finalised'].includes(status)) return 'finalisation';
  if (status === 'archived') return 'archived';
  return 'cancelled';
}
