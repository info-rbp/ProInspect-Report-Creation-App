import type { ReportLifecycleStatus } from './platform.js';

export const COMPONENT_CONDITION_CATEGORIES = [
  'not_applicable',
  'not_visible',
  'partially_visible',
  'intact',
  'minor_wear',
  'repair_required',
  'replacement_recommended',
  'unable_to_confirm',
] as const;

export const COMPONENT_CLEANLINESS_CATEGORIES = [
  'not_applicable',
  'clean',
  'requires_cleaning',
  'stained',
  'unable_to_confirm',
] as const;

export const COMPONENT_WORKING_STATUSES = [
  'not_applicable',
  'operation_confirmed',
  'appears_operational',
  'not_working',
  'untested',
  'unable_to_confirm',
] as const;

export const COMPONENT_TEST_STATUSES = [
  'not_applicable',
  'tested_passed',
  'tested_failed',
  'untested',
  'unable_to_confirm',
] as const;

export const COMPONENT_REVIEW_STATUSES = [
  'draft',
  'ai_generated',
  'analyst_reviewed',
  'reviewer_approved',
  'changes_requested',
] as const;

export const COMPONENT_COMPARISON_STATUSES = [
  'not_compared',
  'unchanged',
  'improved',
  'deteriorated',
  'new_item',
  'missing_item',
  'material_change',
  'no_material_change',
  'review_required',
  'confirmed',
  'unable_to_compare',
] as const;

export const PRESENCE_COMPARISON_STATES = [
  'present_both',
  'present_at_entry_not_identified_at_exit',
  'not_recorded_at_entry_present_at_exit',
  'not_visible_at_entry',
  'not_visible_at_exit',
  'not_applicable',
  'unable_to_compare',
] as const;

export const CONDITION_COMPARISON_STATES = [
  'no_material_change',
  'improved',
  'deteriorated',
  'different_condition',
  'new_condition_observation',
  'unable_to_compare',
  'not_applicable',
] as const;

export const CLEANLINESS_COMPARISON_STATES = [
  'no_material_change',
  'improved',
  'deteriorated',
  'unable_to_compare',
  'not_applicable',
] as const;

export const WORKING_COMPARISON_STATES = [
  'no_material_change',
  'improved',
  'deteriorated',
  'unable_to_compare',
  'not_applicable',
] as const;

export type ComponentConditionCategory = (typeof COMPONENT_CONDITION_CATEGORIES)[number];
export type ComponentCleanlinessCategory = (typeof COMPONENT_CLEANLINESS_CATEGORIES)[number];
export type ComponentWorkingStatus = (typeof COMPONENT_WORKING_STATUSES)[number];
export type ComponentTestStatus = (typeof COMPONENT_TEST_STATUSES)[number];
export type ComponentReviewStatus = (typeof COMPONENT_REVIEW_STATUSES)[number];
export type ComponentComparisonStatus = (typeof COMPONENT_COMPARISON_STATUSES)[number];
export type PresenceComparison = (typeof PRESENCE_COMPARISON_STATES)[number];
export type ConditionComparison = (typeof CONDITION_COMPARISON_STATES)[number];
export type CleanlinessComparison = (typeof CLEANLINESS_COMPARISON_STATES)[number];
export type WorkingComparison = (typeof WORKING_COMPARISON_STATES)[number];
export type ComponentComparisonMethod =
  | 'stable_id'
  | 'explicit_mapping'
  | 'legacy_mapping'
  | 'ai_assisted'
  | 'manual';

export interface ComponentEvidencePair {
  baselinePhotoId: string;
  currentPhotoId: string;
  matchingMethod: ComponentComparisonMethod;
  matchingConfidence: number;
}

export interface ReportPhotoReference {
  photoId: string;
  objectPath: string;
  thumbnailObjectPath?: string;
  caption?: string;
  sequence?: number;
}

export interface BaselineComponentSnapshot {
  id?: string;
  conditionCategory: ComponentConditionCategory;
  cleanlinessCategory: ComponentCleanlinessCategory;
  workingStatus: ComponentWorkingStatus;
  testStatus: ComponentTestStatus;
  commentary: string;
  defects: string[];
  photoReferences?: ReportPhotoReference[];
}

export interface ReportComponentRecord {
  id: string;
  agencyId: string;
  reportId: string;
  areaId: string;
  component: string;
  subComponent?: string;
  material?: string;
  colour?: string;
  type?: string;
  quantity?: number;
  conditionCategory: ComponentConditionCategory;
  cleanlinessCategory: ComponentCleanlinessCategory;
  workingStatus: ComponentWorkingStatus;
  testStatus: ComponentTestStatus;
  defects: string[];
  maintenanceRequired: boolean;
  commentary: string;
  photoReferences: ReportPhotoReference[];
  aiConfidence?: number;
  reviewStatus: ComponentReviewStatus;
  comparisonStatus: ComponentComparisonStatus;
  presenceComparison?: PresenceComparison;
  conditionComparison?: ConditionComparison;
  cleanlinessComparison?: CleanlinessComparison;
  workingComparison?: WorkingComparison;
  comparisonCommentary?: string;
  baselineComponentId?: string;
  baselineComponentData?: BaselineComponentSnapshot;
  baselineEvidencePhotoIds?: string[];
  currentEvidencePhotoIds?: string[];
  evidencePairs?: ComponentEvidencePair[];
  comparisonConfidence?: number;
  comparisonUncertainty?: string;
  comparisonReviewStatus?: 'suggested' | 'confirmed' | 'edited' | 'rejected';
  comparisonMethod?: ComponentComparisonMethod;
  tenantResponseId?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReportAreaRecord {
  id: string;
  agencyId: string;
  reportId: string;
  name: string;
  sequence: number;
  overallCommentary?: string;
  /** Complete area-level evidence, including overview and currently unassigned photos. */
  photoReferences?: ReportPhotoReference[];
  componentCount: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReportMetadataRecord {
  id: string;
  agencyId: string;
  propertyId?: string;
  tenancyId?: string;
  inspectionJobId?: string;
  /** Exact property layout version from which the report area/component structure was seeded. */
  propertyLayoutVersionId?: string;
  reportType: string;
  propertyAddress: string;
  clientName?: string;
  tenantName?: string;
  inspectionDate?: string;
  lifecycleStatus: ReportLifecycleStatus;
  assignedUserId?: string;
  currentVersionId?: string;
  templateId?: string;
  templateVersion?: number;
  baselineReportId?: string;
  baselineReportVersionId?: string;
  baselineInspectionJobId?: string;
  baselineTemplateId?: string;
  baselineTemplateVersion?: number;
  baselineQuality?: 'structured' | 'legacy_unstructured' | 'none';
  sourceMaintenanceItemIds?: string[];
  finalPdfReportVersionId?: string;
  finalPdfObjectPath?: string;
  finalPdfSha256?: string;
  finalPdfGeneration?: string;
  renderManifestObjectPath?: string;
  renderManifestSha256?: string;
  pdfGeneratedAt?: string;
  archiveReportVersionId?: string;
  archiveManifestObjectPath?: string;
  archiveManifestSha256?: string;
  archiveCreatedAt?: string;
  archivedAt?: string;
  areaCount: number;
  componentCount: number;
  finalisedAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface ReportVersionRecord {
  id: string;
  agencyId: string;
  reportId: string;
  sequence: number;
  lifecycleStatus: ReportLifecycleStatus;
  areaCount: number;
  componentCount: number;
  contentHash: string;
  createdAt: string;
  createdBy: string;
  immutable: true;
}

export interface ReportAggregate {
  report: Omit<
    ReportMetadataRecord,
    'createdAt' | 'updatedAt' | 'version' | 'areaCount' | 'componentCount'
  > &
    Partial<Pick<ReportMetadataRecord, 'createdAt' | 'updatedAt' | 'version'>>;
  areas: Array<
    Omit<
      ReportAreaRecord,
      'agencyId' | 'reportId' | 'createdAt' | 'updatedAt' | 'version' | 'componentCount'
    > & {
      components: Array<
        Omit<
          ReportComponentRecord,
          'agencyId' | 'reportId' | 'areaId' | 'createdAt' | 'updatedAt' | 'version'
        >
      >;
    }
  >;
}

export const IMMUTABLE_REPORT_STATUSES = new Set<ReportLifecycleStatus>(['finalised', 'archived']);

/**
 * Once review approval creates an immutable report version, direct content editing is locked.
 * Corrections must travel through the explicit changes-requested workflow and create a superseding version.
 */
export const REPORT_CONTENT_LOCKED_STATUSES = new Set<ReportLifecycleStatus>([
  'approved_for_issue',
  'issued_to_tenant',
  'tenant_response_in_progress',
  'tenant_submitted',
  'agent_response_required',
  'finalisation_ready',
  'finalised',
  'archived',
]);
