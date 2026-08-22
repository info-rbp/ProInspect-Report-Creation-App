import type { AuthenticatedPrincipal, AuthorisationTarget, SecurityCapability, UserRole } from '@pcr/domain';
import { roleHasCapability } from '@pcr/domain';

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
  if (!roleHasCapability(principal.role, capability)) return { allowed: false, reason: 'capability_not_granted' };
  if (requiresMfa(principal.role) && !principal.mfaVerified) return { allowed: false, reason: 'mfa_required' };

  if (['inspector', 'analyst', 'reviewer'].includes(principal.role) && ['job.read', 'job.inspect', 'report.read', 'report.edit', 'report.review', 'upload.create', 'analysis.create', 'pdf.create'].includes(capability)) {
    if (!isAssigned(principal, target)) return { allowed: false, reason: 'assignment_required' };
  }

  if (principal.role === 'tenant' && ['report.read', 'tenant_response.submit', 'upload.create'].includes(capability) && !target.reportId) return { allowed: false, reason: 'tenant_report_link_required' };
  if (capability === 'report.edit' && target.lifecycleStatus && immutableStatuses.has(target.lifecycleStatus)) return { allowed: false, reason: 'report_version_immutable' };
  if (capability === 'report.review' && target.assignedInspectorId === principal.uid) return { allowed: false, reason: 'separation_of_duties' };

  return { allowed: true };
}
