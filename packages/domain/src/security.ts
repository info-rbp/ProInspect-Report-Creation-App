import type { UserRole } from './platform.js';

export const SECURITY_CAPABILITIES = [
  'agency.read',
  'agency.manage',
  'user.invite',
  'user.suspend',
  'client.read',
  'client.manage',
  'client.contact.manage',
  'client.relationship.manage',
  'client.engagement.manage',
  'client.document.manage',
  'client.portal.manage',
  'client.billing.manage',
  'property.read',
  'property.manage',
  'tenant.read',
  'tenant.manage',
  'tenancy.read',
  'tenancy.manage',
  'tenant.communication.read',
  'tenant.communication.send',
  'tenant.document.read',
  'tenant.document.manage',
  'tenant.portal.manage',
  'job.read',
  'job.manage',
  'job.inspect',
  'report.read',
  'report.edit',
  'report.review',
  'report.issue',
  'report.finalise',
  'template.manage',
  'audit.read',
  'maintenance.manage',
  'maintenance.read',
  'maintenance.triage',
  'maintenance.quote.prepare',
  'maintenance.quote.approve',
  'maintenance.quote.send',
  'maintenance.work_order.issue',
  'maintenance.verify',
  'maintenance.finance.sync',
  'price_book.manage',
  'xero.manage',
  'upload.create',
  'analysis.create',
  'pdf.create',
  'tenant_response.submit',
  'notification.send',
  'tenant_instruction.manage',
  'external_contact.manage',
  'client_approval.manage',
] as const;

export type SecurityCapability = (typeof SECURITY_CAPABILITIES)[number];

export interface AuthenticatedPrincipal {
  uid: string;
  email?: string;
  tenantId?: string;
  agencyId: string;
  role: UserRole;
  mfaVerified: boolean;
  sessionId?: string;
  tokenIssuedAt: number;
}

export interface AgencyMembership {
  uid: string;
  agencyId: string;
  role: UserRole;
  status: 'invited' | 'active' | 'suspended' | 'revoked';
  invitationExpiresAt?: string;
  mfaRequired: boolean;
  propertyIds?: string[];
  tenancyIds?: string[];
  inspectionJobIds?: string[];
  reportIds?: string[];
  clientAccountIds?: string[];
  updatedAt: string;
}

export interface AuthorisationTarget {
  agencyId: string;
  clientAccountId?: string;
  clientContactId?: string;
  tenantId?: string;
  propertyId?: string;
  tenancyId?: string;
  inspectionJobId?: string;
  reportId?: string;
  maintenanceItemId?: string;
  maintenanceQuoteId?: string;
  priceBookId?: string;
  workRequestId?: string;
  tenantInstructionId?: string;
  externalContactId?: string;
  accessGrantToken?: string;
  assignedInspectorId?: string;
  assignedAnalystId?: string;
  assignedReviewerId?: string;
  lifecycleStatus?: string;
}

export const PROHIBITED_LIABILITY_REGEX = /\b(tenant caused|tenant damage|damaged by tenant|misuse|neglected|poorly maintained|tenant responsibility|bond deduction|negligent|tenant misconduct)\b/gi;

export function sanitizeProhibitedCausation(text: string): string {
  if (!text) return '';
  return text.replace(PROHIBITED_LIABILITY_REGEX, '[causation omitted]').trim();
}
