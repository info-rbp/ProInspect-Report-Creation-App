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

export const COMPONENT_REVIEW_STATUSES = ['draft', 'ai_generated', 'analyst_reviewed', 'reviewer_approved', 'changes_requested'] as const;
export const COMPONENT_COMPARISON_STATUSES = ['not_compared', 'unchanged', 'improved', 'deteriorated', 'new_item', 'missing_item', 'unable_to_compare'] as const;

export type ComponentConditionCategory = (typeof COMPONENT_CONDITION_CATEGORIES)[number];
export type ComponentCleanlinessCategory = (typeof COMPONENT_CLEANLINESS_CATEGORIES)[number];
export type ComponentWorkingStatus = (typeof COMPONENT_WORKING_STATUSES)[number];
export type ComponentTestStatus = (typeof COMPONENT_TEST_STATUSES)[number];
export type ComponentReviewStatus = (typeof COMPONENT_REVIEW_STATUSES)[number];
export type ComponentComparisonStatus = (typeof COMPONENT_COMPARISON_STATUSES)[number];

export interface ReportPhotoReference {
  photoId: string;
  objectPath: string;
  thumbnailObjectPath?: string;
  caption?: string;
  sequence?: number;
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
  reportType: string;
  propertyAddress: string;
  clientName?: string;
  tenantName?: string;
  inspectionDate?: string;
  lifecycleStatus: ReportLifecycleStatus;
  assignedUserId?: string;
  currentVersionId?: string;
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
  report: Omit<ReportMetadataRecord, 'createdAt' | 'updatedAt' | 'version' | 'areaCount' | 'componentCount'> & Partial<Pick<ReportMetadataRecord, 'createdAt' | 'updatedAt' | 'version'>>;
  areas: Array<Omit<ReportAreaRecord, 'agencyId' | 'reportId' | 'createdAt' | 'updatedAt' | 'version' | 'componentCount'> & { components: Array<Omit<ReportComponentRecord, 'agencyId' | 'reportId' | 'areaId' | 'createdAt' | 'updatedAt' | 'version'>> }>;
}

export const IMMUTABLE_REPORT_STATUSES = new Set<ReportLifecycleStatus>(['finalised', 'archived']);
