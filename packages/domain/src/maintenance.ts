export const MAINTENANCE_CATEGORIES = [
  'Plumbing',
  'Electrical',
  'Appliance',
  'Carpentry / Joinery',
  'Doors / Locks',
  'Painting',
  'Flooring',
  'Tiling',
  'Glazing',
  'Air Conditioning',
  'Roof / Gutters',
  'External',
  'Garden / Landscaping',
  'Cleaning',
  'Safety',
  'Pest',
  'General Maintenance',
  'Other',
] as const;

export type MaintenanceCategory = (typeof MAINTENANCE_CATEGORIES)[number];

export const MAINTENANCE_PRIORITIES = ['urgent', 'high', 'routine', 'monitor'] as const;
export type MaintenancePriority = (typeof MAINTENANCE_PRIORITIES)[number];

export const MAINTENANCE_CANDIDATE_STATUSES = ['suggested', 'confirmed', 'dismissed', 'duplicate'] as const;
export type MaintenanceCandidateStatus = (typeof MAINTENANCE_CANDIDATE_STATUSES)[number];

export const MAINTENANCE_CANDIDATE_SOURCES = [
  'inspector',
  'ai',
  'analyst',
  'reviewer',
  'tenant',
  'property_manager',
  'comparison',
  'follow_up_inspection',
  'external_response',
] as const;

export type MaintenanceCandidateSource = (typeof MAINTENANCE_CANDIDATE_SOURCES)[number];

export interface MaintenanceCandidate {
  id: string;
  agencyId: string;
  propertyId: string;
  tenancyId?: string;
  inspectionJobId?: string;
  reportId?: string;
  reportVersionId?: string;
  areaId?: string;
  componentId?: string;
  observationId?: string;
  title: string;
  description: string;
  category: MaintenanceCategory;
  suggestedPriority: MaintenancePriority;
  evidencePhotoIds: string[];
  source: MaintenanceCandidateSource;
  confidence?: number;
  reviewStatus: MaintenanceCandidateStatus;
  confirmedMaintenanceItemId?: string;
  dismissedReason?: string;
  duplicateOfItemId?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export const MAINTENANCE_ITEM_STATUSES = [
  'suggested',
  'triage_required',
  'approved',
  'assigned',
  'in_progress',
  'awaiting_completion_evidence',
  'completed',
  'verification_required',
  'verified',
  'closed',
  'dismissed',
  'cancelled',
  'duplicate',
  'not_actionable',
] as const;

export type MaintenanceItemStatus = (typeof MAINTENANCE_ITEM_STATUSES)[number];

export interface MaintenanceItem {
  id: string;
  agencyId: string;
  propertyId: string;
  tenancyId?: string;

  sourceReportId?: string;
  sourceReportVersionId?: string;
  sourceInspectionJobId?: string;
  sourceAreaId?: string;
  sourceComponentId?: string;
  sourceObservationId?: string;

  candidateId?: string;
  title: string;
  description: string;
  category: MaintenanceCategory;
  priority: MaintenancePriority;
  status: MaintenanceItemStatus;

  sourceEvidenceIds: string[];
  assignedInternalUserId?: string;
  externalContactId?: string;

  approvalRequired: boolean;
  approvalStatus: 'not_required' | 'pending' | 'approved' | 'declined';
  clientApprovalId?: string;

  dueDate?: string;
  targetCompletionDate?: string;
  workInstruction?: string;
  workNotes?: string;

  completionEvidenceIds?: string[];
  completionNote?: string;
  completionDate?: string;

  verificationStatus: 'unverified' | 'verification_required' | 'verified';
  verificationMethod?: 'completion_evidence_review' | 'tenant_confirmation' | 'property_manager_confirmation' | 'follow_up_inspection' | 'contractor_documentation' | 'other';
  verificationNote?: string;
  followUpInspectionJobId?: string;
  followUpReportId?: string;

  createdBy: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  closedBy?: string;
  closureReason?: string;
  reopenReason?: string;
  version: number;
}

export const EXTERNAL_CONTACT_TYPES = ['contractor', 'supplier', 'cleaner', 'client_representative', 'other'] as const;
export type ExternalContactType = (typeof EXTERNAL_CONTACT_TYPES)[number];

export interface ExternalContact {
  id: string;
  agencyId: string;
  name: string;
  businessName?: string;
  email: string;
  phone?: string;
  type: ExternalContactType;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
}

export interface ExternalAccessGrant {
  id: string;
  agencyId: string;
  resourceType: 'work_request' | 'tenant_instruction' | 'client_approval';
  resourceId: string;
  recipientEmail: string;
  tokenHash: string;
  expiresAt: string;
  revokedAt?: string;
  lastAccessedAt?: string;
  createdBy: string;
  createdAt: string;
}

export const WORK_REQUEST_STATUSES = [
  'draft',
  'issued',
  'acknowledged',
  'in_progress',
  'completed',
  'accepted',
  'declined',
  'unable_to_complete',
  'cancelled',
] as const;

export type WorkRequestStatus = (typeof WORK_REQUEST_STATUSES)[number];

export interface WorkRequest {
  id: string;
  agencyId: string;
  maintenanceItemId: string;
  externalContactId: string;
  instructions: string;
  status: WorkRequestStatus;
  priority: MaintenancePriority;
  dueDate?: string;
  issuedAt?: string;
  acknowledgedAt?: string;
  completedAt?: string;
  responseNotes?: string;
  completionEvidenceIds?: string[];
  accessGrantId?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export const TENANT_INSTRUCTION_TYPES = [
  'cleaning_request',
  'access_request',
  'photo_request',
  'info_request',
  'general_followup',
] as const;

export type TenantInstructionType = (typeof TENANT_INSTRUCTION_TYPES)[number];

export const TENANT_INSTRUCTION_STATUSES = [
  'draft',
  'approval_required',
  'approved',
  'issued',
  'viewed',
  'awaiting_action',
  'tenant_responded',
  'review_required',
  'resolved',
  'closed',
  'cancelled',
  'withdrawn',
] as const;

export type TenantInstructionStatus = (typeof TENANT_INSTRUCTION_STATUSES)[number];

export interface TenantInstruction {
  id: string;
  agencyId: string;
  propertyId: string;
  tenancyId: string;

  sourceReportId?: string;
  sourceReportVersionId?: string;
  sourceAreaId?: string;
  sourceComponentId?: string;
  sourceObservationId?: string;

  type: TenantInstructionType;
  title: string;
  instruction: string;
  sourceEvidenceIds: string[];

  status: TenantInstructionStatus;
  responseRequired: boolean;
  dueDate?: string;

  approvedBy?: string;
  approvedAt?: string;

  issuedAt?: string;
  viewedAt?: string;

  tenantResponseNote?: string;
  tenantEvidenceIds?: string[];
  tenantSubmittedAt?: string;

  resolvedAt?: string;
  resolvedBy?: string;
  resolutionNote?: string;

  accessGrantId?: string;

  createdAt: string;
  updatedAt: string;
  version: number;
}

export const CLIENT_APPROVAL_STATUSES = ['pending', 'approved', 'declined', 'information_requested', 'cancelled'] as const;
export type ClientApprovalStatus = (typeof CLIENT_APPROVAL_STATUSES)[number];

export interface ClientApproval {
  id: string;
  agencyId: string;
  propertyId: string;
  maintenanceItemId: string;
  clientId: string;
  recipientEmail: string;

  summary: string;
  recommendedAction: string;
  priority: MaintenancePriority;
  evidencePhotoIds: string[];

  status: ClientApprovalStatus;
  clientNotes?: string;
  respondedAt?: string;

  accessGrantId?: string;

  createdAt: string;
  updatedAt: string;
  version: number;
}

export const FOLLOWUP_COMPARISON_OUTCOMES = [
  'resolved',
  'partially_resolved',
  'issue_remains',
  'changed',
  'unable_to_verify',
  'further_action_required',
] as const;

export type FollowUpComparisonOutcome = (typeof FOLLOWUP_COMPARISON_OUTCOMES)[number];
