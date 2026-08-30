import type {
  AuthenticatedPrincipal,
  AuthorisationTarget,
  SecurityCapability,
  SecurityRole,
} from '@pcr/domain';
import { roleHasCapability } from '@pcr/domain';

const privilegedRoles = new Set<SecurityRole>([
  'super_admin', 'proinspect_admin', 'operations', 'inspector', 'reviewer',
  'building_manager', 'relief_building_manager', 'strata_manager', 'council_member',
  'client_admin', 'contractor_admin',
]);
const siteScopedRoles = new Set<SecurityRole>([
  'building_manager', 'relief_building_manager', 'strata_manager', 'council_member',
  'resident_owner', 'resident_tenant', 'contractor_admin', 'contractor_worker',
]);
const siteOptionalCapabilities = new Set<SecurityCapability>([
  'portal.switch', 'communication.read', 'communication.send', 'contractor.compliance.read',
]);
const immutableStatuses = new Set([
  'approved_for_issue', 'issued_to_tenant', 'tenant_response_in_progress', 'tenant_submitted',
  'agent_response_required', 'finalisation_ready', 'finalised', 'archived',
]);
const residentRoles = new Set<SecurityRole>(['resident_owner', 'resident_tenant', 'tenant']);
const contractorRoles = new Set<SecurityRole>(['contractor_admin', 'contractor_worker']);
const clientRoles = new Set<SecurityRole>(['client_admin', 'client_user', 'landlord']);

export function requiresMfa(role: SecurityRole): boolean { return privilegedRoles.has(role); }
function isAssigned(principal: AuthenticatedPrincipal, target: AuthorisationTarget): boolean {
  return target.assignedInspectorId === principal.uid || target.assignedAnalystId === principal.uid || target.assignedReviewerId === principal.uid;
}
function hasSiteScope(principal: AuthenticatedPrincipal, managedSiteId: string | undefined): boolean { return Boolean(managedSiteId && principal.siteIds?.includes(managedSiteId)); }
function hasPropertyScope(principal: AuthenticatedPrincipal, propertyId: string | undefined): boolean { return Boolean(propertyId && principal.propertyIds?.includes(propertyId)); }
function hasClientScope(principal: AuthenticatedPrincipal, clientAccountId: string | undefined): boolean { return Boolean(clientAccountId && principal.clientAccountIds?.includes(clientAccountId)); }

export function authorise(
  principal: AuthenticatedPrincipal,
  capability: SecurityCapability,
  target: AuthorisationTarget,
): { allowed: boolean; reason?: string } {
  if (principal.agencyId !== target.agencyId) return { allowed: false, reason: 'cross_agency_access' };
  if (!roleHasCapability(principal.role, capability)) return { allowed: false, reason: 'capability_not_granted' };
  if (requiresMfa(principal.role) && !principal.mfaVerified) return { allowed: false, reason: 'mfa_required' };

  if (siteScopedRoles.has(principal.role)) {
    if (!target.managedSiteId && !siteOptionalCapabilities.has(capability)) return { allowed: false, reason: 'managed_site_scope_required' };
    if (target.managedSiteId && !hasSiteScope(principal, target.managedSiteId)) return { allowed: false, reason: 'managed_site_assignment_required' };
  }

  if (['inspector', 'analyst', 'reviewer'].includes(principal.role) && [
    'job.read', 'job.inspect', 'report.read', 'report.edit', 'report.review',
    'upload.create', 'analysis.create', 'pdf.create',
  ].includes(capability)) {
    if (!isAssigned(principal, target)) return { allowed: false, reason: 'assignment_required' };
  }

  if (residentRoles.has(principal.role)) {
    if (target.residentUserId && target.residentUserId !== principal.uid) return { allowed: false, reason: 'resident_self_scope_required' };
    if (target.propertyId && !hasPropertyScope(principal, target.propertyId)) return { allowed: false, reason: 'resident_property_scope_required' };
    if (['resident.request.create', 'move_booking.request', 'access_device.request', 'offer.redeem'].includes(capability)) {
      if (!target.managedSiteId || !hasSiteScope(principal, target.managedSiteId)) return { allowed: false, reason: 'resident_site_scope_required' };
    }
  }

  if (clientRoles.has(principal.role)) {
    if (target.clientAccountId && !hasClientScope(principal, target.clientAccountId)) return { allowed: false, reason: 'client_scope_required' };
    if (target.propertyId && principal.propertyIds?.length && !hasPropertyScope(principal, target.propertyId)) return { allowed: false, reason: 'client_property_scope_required' };
  }

  if (contractorRoles.has(principal.role)) {
    const assignedContractorId = target.assignedContractorId ?? target.contractorId;
    const selfServiceCapability = siteOptionalCapabilities.has(capability);
    if (!selfServiceCapability && (!assignedContractorId || assignedContractorId !== principal.contractorId)) {
      return { allowed: false, reason: 'contractor_assignment_required' };
    }
    if (assignedContractorId && assignedContractorId !== principal.contractorId) return { allowed: false, reason: 'contractor_assignment_required' };
  }

  if (principal.role === 'tenant' && ['report.read', 'tenant_response.submit', 'upload.create'].includes(capability) && !target.reportId) return { allowed: false, reason: 'tenant_report_link_required' };
  if (capability === 'report.edit' && target.lifecycleStatus && immutableStatuses.has(target.lifecycleStatus)) return { allowed: false, reason: 'report_version_immutable' };
  if (capability === 'report.review' && target.assignedInspectorId === principal.uid) return { allowed: false, reason: 'separation_of_duties' };
  return { allowed: true };
}
