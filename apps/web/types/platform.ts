export type UserRole =
  | 'super_admin'
  | 'proinspect_admin'
  | 'operations'
  | 'inspector'
  | 'analyst'
  | 'reviewer'
  | 'tenant'
  | 'landlord'
  | 'shopify_customer';

export type EntityStatus = 'active' | 'inactive' | 'archived';

export type {
  MaintenanceCategory,
  MaintenancePriority,
  MaintenanceCandidateStatus,
  MaintenanceCandidateSource,
  MaintenanceCandidate,
  MaintenanceItemStatus,
  MaintenanceItem,
  ExternalContactType,
  ExternalContact,
  ExternalAccessGrant,
  WorkRequestStatus,
  WorkRequest,
  TenantInstructionType,
  TenantInstructionStatus,
  TenantInstruction,
  ClientApprovalStatus,
  ClientApproval,
  FollowUpComparisonOutcome,
} from '@pcr/domain';

export const INSPECTION_REPORT_TYPES = [
  'Property Condition Report',
  'Routine Inspection',
  'Exit Inspection',
  'Inspection Comparison Report',
  'Maintenance and Follow-Up Report',
] as const;

export type InspectionReportType = (typeof INSPECTION_REPORT_TYPES)[number];

export type InspectionJobStatus =
  | 'draft'
  | 'booked'
  | 'assigned'
  | 'inspection_started'
  | 'photos_uploading'
  | 'photos_uploaded'
  | 'inspection_submitted'
  | 'analysis_queued'
  | 'analysis_running'
  | 'analysis_failed'
  | 'analysis_complete'
  | 'analyst_review_in_progress'
  | 'review_required'
  | 'reviewer_review_in_progress'
  | 'changes_requested'
  | 'reviewer_approved'
  | 'ready_to_issue'
  | 'issued_to_tenant'
  | 'tenant_viewed'
  | 'tenant_response_in_progress'
  | 'tenant_submitted'
  | 'agent_response_required'
  | 'finalisation_ready'
  | 'finalised'
  | 'archived'
  | 'on_hold'
  | 'cancelled';

export type ReportLifecycleStatus =
  | 'draft'
  | 'internal_review'
  | 'photos_uploaded'
  | 'analysis_queued'
  | 'analysis_running'
  | 'analysis_complete'
  | 'review_required'
  | 'changes_requested'
  | 'approved_for_issue'
  | 'issued_to_tenant'
  | 'tenant_response_in_progress'
  | 'tenant_submitted'
  | 'agent_response_required'
  | 'finalisation_ready'
  | 'finalised'
  | 'archived'
  | 'cancelled';

export type WorkflowExceptionCode =
  | 'evidence_upload_failed'
  | 'analysis_failed'
  | 'issue_failed'
  | 'notification_failed'
  | 'finalisation_failed'
  | 'archive_failed';

export interface Agency {
  id: string;
  name: string;
  tradingName?: string;
  abn?: string;
  contactEmail?: string;
  contactPhone?: string;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  id: string;
  agencyId?: string;
  displayName?: string;
  email: string;
  role: UserRole;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Client {
  id: string;
  agencyId: string;
  name: string;
  email?: string;
  phone?: string;
  type: 'landlord' | 'agency' | 'owner' | 'other';
  shopifyCustomerId?: string;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
}

export type RoomType =
  | 'bedroom'
  | 'bathroom'
  | 'living'
  | 'kitchen'
  | 'dining'
  | 'outdoor'
  | 'laundry'
  | 'garage'
  | 'study'
  | 'hallway'
  | 'storage'
  | 'other';

export interface RoomConfigItem {
  id: string;
  name: string;
  roomType: RoomType;
  floorLevel?: string;
  notes?: string;
  itemsPreset?: string[];
}

export interface LandlordDetails {
  name?: string;
  email?: string;
  phone?: string;
  companyName?: string;
  address?: string;
  contactPreference?: 'email' | 'phone' | 'sms';
  notes?: string;
}

export interface TenantDetails {
  primaryTenantName?: string;
  primaryTenantEmail?: string;
  primaryTenantPhone?: string;
  additionalTenants?: string[];
  leaseStartDate?: string;
  leaseEndDate?: string;
  rentAmount?: number;
  rentFrequency?: 'weekly' | 'fortnightly' | 'monthly';
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  occupancyStatus?: 'tenanted' | 'vacant' | 'notice_given';
  notes?: string;
}

export interface AccessDetails {
  keyNumbers?: string;
  lockboxCode?: string;
  alarmCode?: string;
  accessNotes?: string;
}

export interface PropertyFeatures {
  airConditioning?: boolean;
  heating?: boolean;
  pool?: boolean;
  furnished?: boolean;
  petsAllowed?: boolean;
  dishwasher?: boolean;
  solar?: boolean;
  courtyard?: boolean;
  balcony?: boolean;
  securitySystem?: boolean;
}

export interface PropertyRecord {
  id: string;
  agencyId: string;
  address: string;
  suburb?: string;
  state?: string;
  postcode?: string;
  propertyType?: 'house' | 'unit' | 'apartment' | 'townhouse' | 'villa' | 'commercial' | 'duplex' | 'other';
  bedrooms?: number;
  bathrooms?: number;
  parking?: number;
  livingAreas?: number;
  roomsConfig?: RoomConfigItem[];
  landlordDetails?: LandlordDetails;
  tenantDetails?: TenantDetails;
  accessDetails?: AccessDetails;
  features?: PropertyFeatures;
  notes?: string;
  clientIds: string[];
  googleDriveFolderId?: string;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Tenancy {
  id: string;
  agencyId: string;
  propertyId: string;
  tenantNames: string[];
  tenantEmails: string[];
  leaseStartDate?: string;
  leaseEndDate?: string;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
}

export interface InspectionJob {
  id: string;
  agencyId: string;
  propertyId: string;
  tenancyId?: string;
  reportId?: string;
  reportType: InspectionReportType;
  scheduledAt?: string;
  assignedInspectorId?: string;
  assignedReviewerId?: string;
  status: InspectionJobStatus;
  workflowException?: WorkflowExceptionCode;
  googleDriveFolderId?: string;
  shopifyOrderId?: string;
  notes?: string;
  /** Optimistic-lock version returned by the server-authoritative API. */
  version?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReportIndex {
  id: string;
  agencyId?: string;
  propertyId?: string;
  tenancyId?: string;
  inspectionJobId?: string;
  reportId: string;
  reportType: InspectionReportType | string;
  propertyAddress?: string;
  clientName?: string;
  tenantName?: string;
  inspectionDate?: string;
  lifecycleStatus: ReportLifecycleStatus;
  ownerUid?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEvent {
  id: string;
  agencyId?: string;
  entityType:
    | 'agency'
    | 'user'
    | 'property'
    | 'client'
    | 'tenancy'
    | 'inspection_job'
    | 'report'
    | 'area'
    | 'component'
    | 'photo'
    | 'template'
    | 'system';
  entityId: string;
  eventType: string;
  actorId?: string;
  actorRole?: UserRole;
  timestamp: string;
  metadata?: Record<string, unknown>;
}
