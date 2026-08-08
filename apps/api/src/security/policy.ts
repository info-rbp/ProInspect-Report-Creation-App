import type { AuthenticatedPrincipal, AuthorisationTarget, SecurityCapability, UserRole } from '@pcr/domain';

const capabilities: Record<UserRole, ReadonlySet<SecurityCapability>> = {
  super_admin: new Set(['agency.read', 'audit.read']),
  proinspect_admin: new Set([
    'agency.read', 'agency.manage', 'user.invite', 'user.suspend', 'property.read', 'property.manage',
    'tenancy.read', 'tenancy.manage', 'job.read', 'job.manage', 'job.inspect', 'report.read', 'report.edit',
    'report.review', 'report.issue', 'report.finalise', 'template.manage', 'audit.read', 'maintenance.manage',
    'upload.create', 'analysis.create', 'pdf.create', 'notification.send',
  ]),
  operations: new Set([
    'agency.read', 'property.read', 'property.manage', 'tenancy.read', 'tenancy.manage', 'job.read',
    'job.manage', 'report.read', 'maintenance.manage', 'upload.create', 'analysis.create', 'pdf.create',
    'notification.send',
  ]),
  inspector: new Set(['property.read', 'tenancy.read', 'job.read', 'job.inspect', 'report.read', 'report.edit', 'upload.create']),
  analyst: new Set(['property.read', 'tenancy.read', 'job.read', 'report.read', 'report.edit', 'maintenance.manage', 'analysis.create']),
  reviewer: new Set(['property.read', 'tenancy.read', 'job.read', 'report.read', 'report.review', 'audit.read', 'pdf.create']),
  tenant: new Set(['report.read', 'tenant_response.submit', 'upload.create']),
  landlord: new Set(['property.read', 'report.read']),
  shopify_customer: new Set(),
};

const privilegedRoles = new Set<UserRole>(['super_admin', 'proinspect_admin', 'reviewer']);
const immutableStatuses = new Set(['reviewer_approved', 'ready_to_issue', 'issued_to_tenant', 'tenant_viewed', 'tenant_submitted', 'finalisation_ready', 'finalised', 'archived']);

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
