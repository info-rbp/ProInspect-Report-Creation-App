import type {
  ComponentConditionCategory,
  ComponentCleanlinessCategory,
  ComponentWorkingStatus,
  ComponentTestStatus,
  ComponentReviewStatus,
  ComponentComparisonStatus,
  PresenceComparison,
  ConditionComparison,
  CleanlinessComparison,
  WorkingComparison,
  ComponentEvidencePair,
  BaselineComponentSnapshot,
  ReportPhotoReference,
} from '@pcr/domain';
import type { ReportLifecycleStatus } from './types/platform';

export interface Photo {
  id: string;
  file: File;
  previewUrl: string;
  tags?: string[];
  downloadUrl?: string;
  objectPath?: string;
  thumbnailObjectPath?: string;
}

export interface PreviousReportAttachment {
  id: string;
  file: File;
  name: string;
  mimeType: string;
  downloadUrl?: string;
}

export interface InspectionItem {
  id: string;
  name: string;
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
  comment: string;
  photoReferences?: ReportPhotoReference[];
  aiConfidence?: number;
  reviewStatus?: ComponentReviewStatus;
  comparisonStatus?: ComponentComparisonStatus;
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
  comparisonMethod?: 'stable_id' | 'explicit_mapping' | 'legacy_mapping' | 'ai_assisted' | 'manual';
  tenantResponseId?: string;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
}

export type RoomStatus = 'draft' | 'photos_uploaded' | 'analyzed' | 'complete';

export interface Room {
  id: string;
  name: string;
  status: RoomStatus;
  items: InspectionItem[];
  photos: Photo[];
  overallComment: string;
  isExpanded?: boolean;
}

export interface ReportData {
  id: string;
  agencyId?: string;
  propertyId?: string;
  tenancyId?: string;
  inspectionJobId?: string;
  /** Exact property layout snapshot used to seed this inspection. */
  propertyLayoutVersionId?: string;
  lifecycleStatus?: ReportLifecycleStatus;
  currentVersionId?: string;
  templateId?: string;
  templateVersion?: number;
  issuedAt?: string;
  tenantReviewDueAt?: string;
  finalisedAt?: string;
  archivedAt?: string;
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
  propertyAddress: string;
  agentName: string;
  agentCompany: string;
  agentAddress?: string;
  agentPhone?: string;
  agentEmail?: string;
  clientName: string;
  inspectionDate: string;
  tenantName: string;
  reportType: string;
  baselineReportId?: string;
  baselineReportVersionId?: string;
  baselineInspectionJobId?: string;
  baselineTemplateId?: string;
  baselineTemplateVersion?: number;
  baselineQuality?: 'structured' | 'legacy_unstructured' | 'none';
  heroPhoto?: Photo;
  previousReport?: PreviousReportAttachment;
  previousReportNotes?: string;
  rooms: Room[];
  createdAt?: string;
  updatedAt?: string;
  ownerUid?: string;
  version?: number;
}

export enum ReportViewMode {
  EDIT = 'EDIT',
  PREVIEW = 'PREVIEW'
}
