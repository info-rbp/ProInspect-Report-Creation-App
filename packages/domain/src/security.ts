import {
  BUILDING_MANAGEMENT_CAPABILITIES,
  PORTAL_ROLE_CAPABILITIES,
  type BuildingManagementCapability,
  type PortalRole,
} from './buildingManagement.js';
import type { UserRole } from './platform.js';

export const BASE_SECURITY_CAPABILITIES = [
  'agency.read', 'agency.manage',
  'settings.read', 'settings.organisation.manage', 'settings.branding.manage', 'settings.operations.manage', 'settings.communications.manage', 'settings.security.manage',
  'integration.read', 'integration.manage', 'integration.credentials.manage', 'integration.sync',
  'maintenance.policy.manage',
  'user.read', 'user.invite', 'user.profile.manage', 'user.role.manage', 'user.scope.manage', 'user.suspend', 'user.reactivate', 'user.revoke', 'user.session.revoke', 'user.security.manage', 'user.audit.read',
  'workforce.read', 'workforce.manage',
  'client.read', 'client.manage', 'client.contact.manage', 'client.relationship.manage', 'client.engagement.manage', 'client.document.manage', 'client.portal.manage', 'client.portal.read', 'client.commercial.manage',
  'property.read', 'property.manage',
  'tenant.read', 'tenant.manage', 'tenancy.read', 'tenancy.manage', 'tenant.communication.read', 'tenant.communication.send', 'tenant.document.read', 'tenant.document.manage', 'tenant.portal.manage',
  'document.policy.read', 'document.policy.manage', 'document.packet.read', 'document.packet.manage', 'document.packet.approve', 'document.packet.issue', 'document.sign.manage', 'notice.issue', 'service_record.manage',
  'job.read', 'job.manage', 'job.inspect', 'job.plan', 'job.plan.publish', 'job.offline.sync', 'job.remote.manage',
  'report.read', 'report.edit', 'report.review', 'report.issue', 'report.finalise',
  'template.manage', 'audit.read',
  'maintenance.manage', 'maintenance.read', 'maintenance.triage', 'maintenance.quote.prepare', 'maintenance.quote.approve', 'maintenance.quote.send', 'maintenance.work_order.issue', 'maintenance.verify', 'price_book.manage',
  'communication.read', 'communication.send', 'communication.manage',
  'compliance.read', 'compliance.manage', 'compliance.rule.manage',
  'key.read', 'key.manage', 'analytics.read',
  'upload.create', 'analysis.create', 'pdf.create', 'tenant_response.submit', 'notification.send', 'tenant_instruction.manage', 'external_contact.manage', 'client_approval.manage',
] as const;

export const SECURITY_CAPABILITIES = [...BASE_SECURITY_CAPABILITIES, ...BUILDING_MANAGEMENT_CAPABILITIES] as const;
export type BaseSecurityCapability = (typeof BASE_SECURITY_CAPABILITIES)[number];
export type SecurityCapability = BaseSecurityCapability | BuildingManagementCapability;
export type SecurityRole = UserRole | PortalRole;

export const INTERNAL_USER_ROLES = ['super_admin', 'proinspect_admin', 'operations', 'inspector', 'analyst', 'reviewer'] as const satisfies readonly SecurityRole[];
export type InternalUserRole = (typeof INTERNAL_USER_ROLES)[number];
export const INTERNAL_SECTIONS = ['dashboard', 'analytics', 'clients', 'properties', 'jobs', 'reports', 'maintenance', 'tenants', 'communications', 'compliance', 'users', 'templates', 'settings'] as const;
export type InternalSection = (typeof INTERNAL_SECTIONS)[number];

const settingsAdministration = ['settings.read', 'settings.organisation.manage', 'settings.branding.manage', 'settings.operations.manage', 'settings.communications.manage', 'settings.security.manage', 'integration.read', 'integration.manage', 'integration.credentials.manage', 'integration.sync', 'maintenance.policy.manage'] satisfies SecurityCapability[];
const clientAdministration = ['client.read', 'client.manage', 'client.contact.manage', 'client.relationship.manage', 'client.engagement.manage', 'client.document.manage', 'client.portal.manage', 'client.portal.read', 'client.commercial.manage'] satisfies SecurityCapability[];
const tenantWorkspace = ['tenant.read', 'tenant.manage', 'tenancy.read', 'tenancy.manage', 'tenant.communication.read', 'tenant.communication.send', 'tenant.document.read', 'tenant.document.manage', 'tenant.portal.manage', 'tenant_instruction.manage'] satisfies SecurityCapability[];
const documentOperations = ['document.policy.read', 'document.policy.manage', 'document.packet.read', 'document.packet.manage', 'document.packet.approve', 'document.packet.issue', 'document.sign.manage', 'notice.issue', 'service_record.manage'] satisfies SecurityCapability[];
const operationalEnhancements = ['job.plan', 'job.plan.publish', 'job.offline.sync', 'job.remote.manage', 'communication.read', 'communication.send', 'communication.manage', 'compliance.read', 'compliance.manage', 'compliance.rule.manage', 'key.read', 'key.manage', 'analytics.read'] satisfies SecurityCapability[];
const portalCapabilities = (role: PortalRole): readonly SecurityCapability[] => PORTAL_ROLE_CAPABILITIES[role];
const portalCommunication = ['communication.read', 'communication.send'] satisfies SecurityCapability[];

export const ROLE_CAPABILITIES: Readonly<Record<SecurityRole, readonly SecurityCapability[]>> = {
  super_admin: SECURITY_CAPABILITIES,
  proinspect_admin: ['agency.read', 'agency.manage', ...settingsAdministration, 'user.read', 'user.invite', 'user.profile.manage', 'user.role.manage', 'user.scope.manage', 'user.suspend', 'user.reactivate', 'user.revoke', 'user.session.revoke', 'user.security.manage', 'user.audit.read', 'workforce.read', 'workforce.manage', ...clientAdministration, 'property.read', 'property.manage', ...tenantWorkspace, ...documentOperations, 'job.read', 'job.manage', 'job.inspect', ...operationalEnhancements, 'report.read', 'report.edit', 'report.review', 'report.issue', 'report.finalise', 'template.manage', 'audit.read', 'maintenance.manage', 'maintenance.read', 'maintenance.triage', 'maintenance.quote.prepare', 'maintenance.quote.approve', 'maintenance.quote.send', 'maintenance.work_order.issue', 'maintenance.verify', 'price_book.manage', 'upload.create', 'analysis.create', 'pdf.create', 'notification.send', 'external_contact.manage', 'client_approval.manage', ...BUILDING_MANAGEMENT_CAPABILITIES],
  operations: ['agency.read', 'settings.read', 'integration.read', 'integration.sync', 'user.read', 'workforce.read', ...clientAdministration, 'property.read', 'property.manage', ...tenantWorkspace, 'document.policy.read', 'document.packet.read', 'document.packet.manage', 'document.packet.issue', 'document.sign.manage', 'notice.issue', 'service_record.manage', 'job.read', 'job.manage', 'job.plan', 'job.plan.publish', 'job.offline.sync', 'job.remote.manage', 'report.read', 'report.issue', 'maintenance.manage', 'maintenance.read', 'maintenance.triage', 'maintenance.quote.prepare', 'maintenance.quote.send', 'maintenance.work_order.issue', 'maintenance.verify', 'communication.read', 'communication.send', 'communication.manage', 'compliance.read', 'compliance.manage', 'key.read', 'key.manage', 'analytics.read', 'upload.create', 'analysis.create', 'pdf.create', 'notification.send', 'external_contact.manage', 'client_approval.manage', ...BUILDING_MANAGEMENT_CAPABILITIES.filter((item) => !['managed_site.manage', 'offer.manage'].includes(item))],
  inspector: ['property.read', 'tenant.read', 'tenancy.read', 'job.read', 'job.inspect', 'job.plan', 'job.offline.sync', 'report.read', 'report.edit', 'upload.create', 'maintenance.read', 'maintenance.triage', 'key.read', 'key.manage', ...portalCommunication],
  analyst: ['property.read', 'tenant.read', 'tenancy.read', 'job.read', 'report.read', 'report.edit', 'maintenance.read', 'maintenance.triage', 'maintenance.quote.prepare', 'analysis.create', 'tenant_instruction.manage', 'tenant.communication.read', 'tenant.document.read', 'document.packet.read', 'communication.read', 'compliance.read', 'external_contact.manage', 'client_approval.manage'],
  reviewer: ['property.read', 'tenant.read', 'tenancy.read', 'job.read', 'report.read', 'report.review', 'audit.read', 'pdf.create', 'maintenance.read', 'maintenance.triage', 'maintenance.verify', 'tenant_instruction.manage', 'tenant.communication.read', 'tenant.document.read', 'document.packet.read', 'document.packet.approve', 'communication.read', 'compliance.read', 'client_approval.manage'],
  tenant: ['report.read', 'tenant_response.submit', 'upload.create', ...portalCapabilities('resident_tenant'), ...portalCommunication],
  landlord: ['client.portal.read', 'property.read', 'report.read', ...portalCapabilities('client_user'), ...portalCommunication],
  shopify_customer: [],
  building_manager: [...portalCapabilities('building_manager'), ...portalCommunication, 'communication.manage', 'job.offline.sync'],
  relief_building_manager: [...portalCapabilities('relief_building_manager'), ...portalCommunication, 'job.offline.sync'],
  strata_manager: [...portalCapabilities('strata_manager'), ...portalCommunication, 'communication.manage'],
  council_member: [...portalCapabilities('council_member'), 'communication.read'],
  resident_owner: [...portalCapabilities('resident_owner'), ...portalCommunication],
  resident_tenant: [...portalCapabilities('resident_tenant'), ...portalCommunication],
  client_admin: [...portalCapabilities('client_admin'), ...portalCommunication],
  client_user: [...portalCapabilities('client_user'), ...portalCommunication],
  contractor_admin: [...portalCapabilities('contractor_admin'), ...portalCommunication],
  contractor_worker: [...portalCapabilities('contractor_worker'), ...portalCommunication],
};

export const INTERNAL_SECTION_CAPABILITIES: Readonly<Record<InternalSection, readonly SecurityCapability[]>> = {
  dashboard: [], analytics: ['analytics.read'], clients: ['client.read'], properties: ['property.read'],
  jobs: ['job.read'], reports: ['report.read'], maintenance: ['maintenance.read'], tenants: ['tenant.read'],
  communications: ['communication.read'], compliance: ['compliance.read'], users: ['user.profile.manage'],
  templates: ['template.manage'], settings: ['settings.read'],
};

export function roleCapabilities(role: SecurityRole | undefined): readonly SecurityCapability[] { return role ? ROLE_CAPABILITIES[role] ?? [] : []; }
export function roleHasCapability(role: SecurityRole | undefined, capability: SecurityCapability): boolean { return roleCapabilities(role).includes(capability); }
export function isInternalRole(role?: SecurityRole): role is InternalUserRole { return Boolean(role && (INTERNAL_USER_ROLES as readonly SecurityRole[]).includes(role)); }
export function canAccessInternalSection(role: SecurityRole | undefined, section: InternalSection): boolean { return Boolean(role && isInternalRole(role) && INTERNAL_SECTION_CAPABILITIES[section].every((capability) => roleHasCapability(role, capability))); }

export interface AuthenticatedPrincipal {
  uid: string;
  email?: string;
  tenantId?: string;
  agencyId: string;
  role: SecurityRole;
  mfaVerified: boolean;
  sessionId?: string;
  tokenIssuedAt: number;
  siteIds?: string[];
  propertyIds?: string[];
  clientAccountIds?: string[];
  contractorId?: string;
}

export interface AgencyMembership {
  uid: string;
  agencyId: string;
  role: SecurityRole;
  status: 'invited' | 'active' | 'suspended' | 'revoked';
  invitationExpiresAt?: string;
  mfaRequired: boolean;
  siteIds?: string[];
  propertyIds?: string[];
  tenancyIds?: string[];
  inspectionJobIds?: string[];
  reportIds?: string[];
  clientAccountIds?: string[];
  contractorId?: string;
  updatedAt: string;
}

export interface AuthorisationTarget {
  agencyId: string;
  managedSiteId?: string;
  buildingId?: string;
  locationId?: string;
  unitId?: string;
  clientAccountId?: string;
  clientContactId?: string;
  tenantId?: string;
  residentUserId?: string;
  propertyId?: string;
  tenancyId?: string;
  inspectionJobId?: string;
  reportId?: string;
  maintenanceItemId?: string;
  maintenanceQuoteId?: string;
  defectId?: string;
  operationalWorkOrderId?: string;
  priceBookId?: string;
  workRequestId?: string;
  tenantInstructionId?: string;
  externalContactId?: string;
  accessGrantToken?: string;
  assignedInspectorId?: string;
  assignedAnalystId?: string;
  assignedReviewerId?: string;
  assignedContractorId?: string;
  contractorId?: string;
  lifecycleStatus?: string;
}

export const PROHIBITED_LIABILITY_REGEX = /\b(tenant caused|tenant damage|damaged by tenant|misuse|neglected|poorly maintained|tenant responsibility|bond deduction|negligent|tenant misconduct)\b/gi;
export function sanitizeProhibitedCausation(text: string): string { if (!text) return ''; return text.replace(PROHIBITED_LIABILITY_REGEX, '[causation omitted]').trim(); }
