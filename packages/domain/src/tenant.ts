export type TenantStatus = 'active' | 'inactive' | 'archived';
export type TenancyLifecycleStatus = 'upcoming' | 'active' | 'notice_given' | 'vacating' | 'ended' | 'cancelled';
export type TenancyParticipantRole = 'primary_tenant' | 'co_tenant' | 'approved_occupant';

export interface Tenant {
  id: string;
  agencyId: string;
  fullName: string;
  preferredName?: string;
  email?: string;
  phone?: string;
  preferredCommunication?: 'email' | 'sms' | 'portal';
  status: TenantStatus;
  createdAt: string;
  updatedAt: string;
  version?: number;
}

export interface TenancyParticipant {
  id: string;
  agencyId: string;
  tenancyId: string;
  tenantId: string;
  role: TenancyParticipantRole;
  startDate?: string;
  endDate?: string;
  status: 'upcoming' | 'active' | 'ended';
  createdAt: string;
  updatedAt: string;
  version?: number;
}

export interface TenantCommunication {
  id: string;
  agencyId: string;
  tenantId: string;
  tenancyId?: string;
  propertyId?: string;
  channel: 'email' | 'sms' | 'portal';
  direction: 'outbound' | 'inbound';
  subject?: string;
  message: string;
  status: 'draft' | 'queued' | 'sent' | 'delivered' | 'failed' | 'received';
  relatedEntityType?: 'inspection_job' | 'report' | 'tenant_instruction' | 'maintenance_item' | 'tenancy_document' | 'general';
  relatedEntityId?: string;
  createdBy?: string;
  sentAt?: string;
  deliveredAt?: string;
  createdAt: string;
  updatedAt: string;
  version?: number;
}

export type TenancyDocumentType =
  | 'tenancy_agreement'
  | 'variation'
  | 'inspection_notice'
  | 'tenant_form'
  | 'notice'
  | 'information_sheet'
  | 'signed_form'
  | 'other';

export interface TenancyDocument {
  id: string;
  agencyId: string;
  tenantId?: string;
  tenancyId: string;
  propertyId: string;
  type: TenancyDocumentType;
  title: string;
  status: 'draft' | 'ready' | 'issued' | 'signature_required' | 'partially_signed' | 'signed' | 'archived';
  content?: string;
  contentType?: 'text/plain' | 'text/html' | 'application/pdf';
  templateKey?: string;
  objectPath?: string;
  sha256?: string;
  generation?: string;
  issuedAt?: string;
  issuedTo?: string;
  acknowledgementText?: string;
  signedAt?: string;
  signedByTenantId?: string;
  signatureMethod?: 'portal_acknowledgement' | 'external_esign';
  signatureName?: string;
  createdAt: string;
  updatedAt: string;
  version?: number;
}

export interface TenantAttentionItem {
  id: string;
  kind: 'inspection_due' | 'action_overdue' | 'maintenance_access' | 'document_signature' | 'tenancy_expiry' | 'key_outstanding';
  label: string;
  severity: 'info' | 'warning' | 'critical';
  dueAt?: string;
  entityType?: string;
  entityId?: string;
}
