export type InspectionExecutionMode = 'professional' | 'tenant_assisted' | 'remote_customer';

export interface RemoteInspectionRequirement {
  id: string;
  areaId: string;
  componentId?: string;
  label: string;
  instructions: string;
  requiredEvidenceCount: number;
  evidenceKinds: Array<'photo' | 'video' | 'audio'>;
  commentaryRequired: boolean;
}

export interface RemoteInspectionAssignment {
  id: string;
  agencyId: string;
  inspectionJobId: string;
  propertyId?: string;
  tenantId: string;
  tenancyId: string;
  executionMode: Exclude<InspectionExecutionMode, 'professional'>;
  status: 'draft' | 'issued' | 'in_progress' | 'submitted' | 'review_required' | 'accepted' | 'rejected' | 'expired';
  requirements: RemoteInspectionRequirement[];
  dueAt?: string;
  issuedAt?: string;
  submittedAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface RemoteInspectionSubmission {
  id: string;
  agencyId: string;
  assignmentId: string;
  requirementId: string;
  tenantId: string;
  commentary?: string;
  evidenceIds: string[];
  source: 'tenant';
  submittedAt: string;
  reviewStatus: 'pending' | 'accepted' | 'changes_required' | 'rejected';
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}
