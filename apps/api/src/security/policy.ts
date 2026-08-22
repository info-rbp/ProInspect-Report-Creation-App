import { SECURITY_CAPABILITIES, type AuthenticatedPrincipal, type AuthorisationTarget, type SecurityCapability, type UserRole } from '@pcr/domain';

const clientAdministration: SecurityCapability[] = [
  'client.read',
  'client.manage',
  'client.contact.manage',
  'client.relationship.manage',
  'client.engagement.manage',
  'client.document.manage',
  'client.portal.manage',
  'client.billing.manage',
];

const tenantWorkspace = [
  'tenant.read', 'tenant.manage', 'tenancy.read', 'tenancy.manage',
  'tenant.communication.read', 'tenant.communication.send',
  'tenant.document.read', 'tenant.document.manage', 'tenant.portal.manage',
  'tenant_instruction.manage',
] satisfies SecurityCapability[];

const capabilities: Record<UserRole, ReadonlySet<SecurityCapability>> = {
  super_admin: new Set(SECURITY_CAPABILITIES),
  proinspect_admin: new Set([
    'agency.read', 'agency.manage', 'user.invite', 'user.suspend', ...clientAdministration,
    'property.read', 'property.manage', ...tenantWorkspace, 'job.read', 'job.manage', 'job.inspect',
    'report.read', 'report.edit', 'report.review', 'report.issue', 'report.finalise', 'template.manage', 'audit.read',
    'maintenance.manage', 'maintenance.read', 'maintenance.triage', 'maintenance.quote.prepare',
    'maintenance.quote.approve', 'maintenance.quote.send', 'maintenance.work_order.issue', 'maintenance.verify',
    'maintenance.finance.sync', 'price_book.manage', 'xero.manage', 'upload.create', 'analysis.create', 'pdf.create',
    'notification.send', 'external_contact.manage', 'client_approval.manage',
  ]),
  operations: new Set([
    'agency.read', ...clientAdministration,
    'property.read', 'property.manage', ...tenantWorkspace, 'job.read', 'job.manage', 'report.read',
    'report.issue', 'maintenance.manage', 'maintenance.read', 'maintenance.triage', 'maintenance.quote.prepare',
    'maintenance.quote.send', 'maintenance.work_order.issue', 'maintenance.verify', 'upload.create', 'analysis.create',
    'pdf.create', 'notification.send', 'external_contact.manage', 'client_approval.manage',
  ]),
  inspector: new Set([
    'property.read', 'tenant.read', 'tenancy.read', 'job.read', 'job.inspect', 'report.read', 'report.edit',
    'upload.create', 'maintenance.read', 'maintenance.triage',
  ]),
  analyst: new Set([
    'property.read', 'tenant.read', 'tenancy.read', 'job.read', 'report.read', 'report.edit', 'maintenance.read',
    'maintenance.triage', 'maintenance.quote.prepare', 'analysis.create', 'tenant_instruction.manage',
    'tenant.communication.read', 'tenant.document.read', 'external_contact.manage', 'client_approval.manage',
  ]),
  reviewer: new Set([
    'property.read', 'tenant.read', 'tenancy.read', 'job.read', 'report.read', 'report.review', 'audit.read', 'pdf.create',
    'maintenance.read', 'maintenance.triage', 'maintenance.verify', 'tenant_instruction.manage',
    'tenant.communication.read', 'tenant.document.read', 'client_approval.manage',
  ]),
  tenant: new Set(['report.read', 'tenant_response.submit', 'upload.create']),
  landlord: new Set(['property.read', 'report.read']),
  shopify_customer: new Set(),
};

const privilegedRoles = new Set<UserRole>(['super_admin', 'proinspect_admin', 'reviewer']);
const immutableStatuses = new Set([
  'approved_for_issue',
  'issued_to_tenant',
  'tenant_response_in_progress',
  'tenant_submitted',
  'agent_response_required',
  'finalisation_ready',
  'finalised',
  'archived',
]);

export function requiresMfa(role: UserRole): boolean {
  return privilegedRoles.has(role);
}

function isAssigned(principal: AuthenticatedPrincipal, target: AuthorisationTarget): boolean {
  return target.assignedInspectorId === principal.uid || target.assignedAnalystId === principal.uid || target.assignedReviewerId === principal.uid;
}

export function authorise(principal: AuthenticatedPrincipal, capability: SecurityCapability, target: AuthorisationTarget): { allowed: boolean; reason?: string } {
  if (principal.agencyId !== target.agencyId) return { allowed: false, reason: 'cross_agency_access' };
  if (!capabilities[principal.role].has(capability)) return { allowed: false, reason: 'capability_not_granted' };
  if (requiresMfa(principal.role) && !principal.mfaVerified) return { allowed: false, reason: 'mfa_required' };

  if (['inspector', 'analyst', 'reviewer'].includes(principal.role) && ['job.read', 'job.inspect', 'report.read', 'report.edit', 'report.review', 'upload.create', 'analysis.create', 'pdf.create'].includes(capability)) {
    if (!isAssigned(principal, target)) return { allowed: false, reason: 'assignment_required' };
  }

  if (principal.role === 'tenant' && ['report.read', 'tenant_response.submit', 'upload.create'].includes(capability) && !target.reportId) return { allowed: false, reason: 'tenant_report_link_required' };
  if (capability === 'report.edit' && target.lifecycleStatus && immutableStatuses.has(target.lifecycleStatus)) return { allowed: false, reason: 'report_version_immutable' };
  if (capability === 'report.review' && target.assignedInspectorId === principal.uid) return { allowed: false, reason: 'separation_of_duties' };

  return { allowed: true };
}
