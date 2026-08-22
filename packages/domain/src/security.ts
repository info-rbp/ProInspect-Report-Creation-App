import type { UserRole } from './platform.js';

export const SECURITY_CAPABILITIES = [
  'agency.read',
  'agency.manage',
  'settings.read',
  'settings.organisation.manage',
  'settings.branding.manage',
  'settings.operations.manage',
  'settings.communications.manage',
  'settings.security.manage',
  'integration.read',
  'integration.manage',
  'integration.credentials.manage',
  'maintenance.policy.manage',
  'user.read',
  'user.invite',
  'user.profile.manage',
  'user.role.manage',
  'user.scope.manage',
  'user.suspend',
  'user.reactivate',
  'user.revoke',
  'user.session.revoke',
  'user.security.manage',
  'user.audit.read',
  'workforce.read',
  'workforce.manage',
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

export const INTERNAL_USER_ROLES = [
  'super_admin',
  'proinspect_admin',
  'operations',
  'inspector',
  'analyst',
  'reviewer',
] as const satisfies readonly UserRole[];

export type InternalUserRole = (typeof INTERNAL_USER_ROLES)[number];

export const INTERNAL_SECTIONS = [
  'dashboard',
  'clients',
  'properties',
  'jobs',
  'reports',
  'maintenance',
  'tenants',
  'users',
  'templates',
  'settings',
] as const;

export type InternalSection = (typeof INTERNAL_SECTIONS)[number];

const settingsAdministration = [
  'settings.read',
  'settings.organisation.manage',
  'settings.branding.manage',
  'settings.operations.manage',
  'settings.communications.manage',
  'settings.security.manage',
  'integration.read',
  'integration.manage',
  'integration.credentials.manage',
  'maintenance.policy.manage',
] satisfies SecurityCapability[];

const clientAdministration = [
  'client.read',
  'client.manage',
  'client.contact.manage',
  'client.relationship.manage',
  'client.engagement.manage',
  'client.document.manage',
  'client.portal.manage',
  'client.billing.manage',
] satisfies SecurityCapability[];

const tenantWorkspace = [
  'tenant.read',
  'tenant.manage',
  'tenancy.read',
  'tenancy.manage',
  'tenant.communication.read',
  'tenant.communication.send',
  'tenant.document.read',
  'tenant.document.manage',
  'tenant.portal.manage',
  'tenant_instruction.manage',
] satisfies SecurityCapability[];

export const ROLE_CAPABILITIES: Readonly<Record<UserRole, readonly SecurityCapability[]>> = {
  super_admin: SECURITY_CAPABILITIES,
  proinspect_admin: [
    'agency.read', 'agency.manage', ...settingsAdministration,
    'user.read', 'user.invite', 'user.profile.manage', 'user.role.manage', 'user.scope.manage',
    'user.suspend', 'user.reactivate', 'user.revoke', 'user.session.revoke', 'user.security.manage', 'user.audit.read',
    'workforce.read', 'workforce.manage',
    ...clientAdministration,
    'property.read', 'property.manage', ...tenantWorkspace,
    'job.read', 'job.manage', 'job.inspect',
    'report.read', 'report.edit', 'report.review', 'report.issue', 'report.finalise',
    'template.manage', 'audit.read',
    'maintenance.manage', 'maintenance.read', 'maintenance.triage', 'maintenance.quote.prepare',
    'maintenance.quote.approve', 'maintenance.quote.send', 'maintenance.work_order.issue', 'maintenance.verify',
    'maintenance.finance.sync', 'price_book.manage', 'xero.manage',
    'upload.create', 'analysis.create', 'pdf.create', 'notification.send',
    'external_contact.manage', 'client_approval.manage',
  ],
  operations: [
    'agency.read', 'settings.read', 'integration.read', 'user.read', 'workforce.read', ...clientAdministration,
    'property.read', 'property.manage', ...tenantWorkspace,
    'job.read', 'job.manage', 'report.read', 'report.issue',
    'maintenance.manage', 'maintenance.read', 'maintenance.triage', 'maintenance.quote.prepare',
    'maintenance.quote.send', 'maintenance.work_order.issue', 'maintenance.verify',
    'upload.create', 'analysis.create', 'pdf.create', 'notification.send',
    'external_contact.manage', 'client_approval.manage',
  ],
  inspector: [
    'property.read', 'tenant.read', 'tenancy.read', 'job.read', 'job.inspect',
    'report.read', 'report.edit', 'upload.create', 'maintenance.read', 'maintenance.triage',
  ],
  analyst: [
    'property.read', 'tenant.read', 'tenancy.read', 'job.read', 'report.read', 'report.edit',
    'maintenance.read', 'maintenance.triage', 'maintenance.quote.prepare', 'analysis.create',
    'tenant_instruction.manage', 'tenant.communication.read', 'tenant.document.read',
    'external_contact.manage', 'client_approval.manage',
  ],
  reviewer: [
    'property.read', 'tenant.read', 'tenancy.read', 'job.read', 'report.read', 'report.review',
    'audit.read', 'pdf.create', 'maintenance.read', 'maintenance.triage', 'maintenance.verify',
    'tenant_instruction.manage', 'tenant.communication.read', 'tenant.document.read', 'client_approval.manage',
  ],
  tenant: ['report.read', 'tenant_response.submit', 'upload.create'],
  landlord: ['property.read', 'report.read'],
  shopify_customer: [],
};

export const INTERNAL_SECTION_CAPABILITIES: Readonly<Record<InternalSection, readonly SecurityCapability[]>> = {
  dashboard: [],
  clients: ['client.read'],
  properties: ['property.read'],
  jobs: ['job.read'],
  reports: ['report.read'],
  maintenance: ['maintenance.read'],
  tenants: ['tenant.read'],
  users: ['user.profile.manage'],
  templates: ['template.manage'],
  settings: ['settings.read'],
};

export function roleCapabilities(role: UserRole | undefined): readonly SecurityCapability[] {
  return role ? ROLE_CAPABILITIES[role] : [];
}

export function roleHasCapability(role: UserRole | undefined, capability: SecurityCapability): boolean {
  return roleCapabilities(role).includes(capability);
}

export function isInternalRole(role?: UserRole): role is InternalUserRole {
  return Boolean(role && (INTERNAL_USER_ROLES as readonly UserRole[]).includes(role));
}

export function canAccessInternalSection(role: UserRole | undefined, section: InternalSection): boolean {
  if (!role || !isInternalRole(role)) return false;
  return INTERNAL_SECTION_CAPABILITIES[section].every((capability) => roleHasCapability(role, capability));
}

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
