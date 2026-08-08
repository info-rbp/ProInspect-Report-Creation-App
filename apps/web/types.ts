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
  isClean: boolean;
  isUndamaged: boolean;
  isWorking: boolean;
  comment: string;
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
  lifecycleStatus?: ReportLifecycleStatus;
  currentVersionId?: string;
  issuedAt?: string;
  tenantReviewDueAt?: string;
  finalisedAt?: string;
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
