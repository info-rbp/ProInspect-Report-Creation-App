export type DocumentPacketStatus =
  | 'draft'
  | 'validation_required'
  | 'approval_required'
  | 'ready_to_issue'
  | 'issued'
  | 'viewed'
  | 'partially_signed'
  | 'completed'
  | 'voided'
  | 'archived';

export interface DocumentTemplateVersion {
  id: string;
  agencyId?: string;
  jurisdiction: string;
  tenancyKind: string;
  formCode?: string;
  name: string;
  purpose: string;
  versionNumber: number;
  status: 'draft' | 'published' | 'retired';
  effectiveFrom: string;
  effectiveTo?: string;
  sourceAuthority?: string;
  sourceObjectPath: string;
  sourceSha256: string;
  sourceGeneration?: string;
  renderStrategy: 'official_pdf_overlay' | 'official_docx_merge' | 'appendix_only' | 'agency_generated';
  mutationPolicy: 'no_text_changes' | 'additional_details_only' | 'agency_editable';
  fieldSchema: Record<string, { required?: boolean; label?: string; type?: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentPacketRecipient {
  partyId: string;
  role: string;
  email?: string;
  required: boolean;
  action: 'execute' | 'acknowledge' | 'serve';
}

export interface DocumentPacket {
  id: string;
  agencyId: string;
  propertyId: string;
  tenancyId: string;
  packetType: string;
  jurisdictionPolicyVersionId: string;
  documentIds: string[];
  recipients: DocumentPacketRecipient[];
  status: DocumentPacketStatus;
  dataSnapshot: Record<string, unknown>;
  dataSnapshotSha256: string;
  supersedesPacketId?: string;
  issuedAt?: string;
  completedAt?: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}
