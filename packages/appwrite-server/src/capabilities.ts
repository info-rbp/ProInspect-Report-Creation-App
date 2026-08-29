export type FoundationRole =
  | 'super_admin' | 'proinspect_admin' | 'operations' | 'inspector' | 'analyst' | 'reviewer'
  | 'building_manager' | 'relief_building_manager' | 'strata_manager' | 'council_member'
  | 'resident_owner' | 'resident_tenant' | 'client_admin' | 'client_user'
  | 'contractor_admin' | 'contractor_worker';

export type FoundationCapability =
  | 'managed_site.read' | 'property.read' | 'service_request.create' | 'inspection_job.read'
  | 'maintenance_item.read' | 'work_order.read' | 'approval.read' | 'resident_request.read';

export interface FoundationPrincipal {
  userId: string;
  agencyId: string;
  role: FoundationRole;
  mfaVerified: boolean;
  siteIds?: string[];
  propertyIds?: string[];
  clientId?: string;
}

export interface FoundationResource {
  agencyId: string;
  managedSiteId?: string;
  propertyId?: string;
  clientId?: string;
  residentUserId?: string;
  assignedInspectorId?: string;
  assignedAnalystId?: string;
  assignedReviewerId?: string;
  assignedContractorId?: string;
}

const privileged = new Set<FoundationRole>(['super_admin', 'proinspect_admin', 'reviewer']);
const agencyOperators = new Set<FoundationRole>(['proinspect_admin', 'operations']);
const siteOperators = new Set<FoundationRole>(['building_manager', 'relief_building_manager', 'strata_manager']);

export function canAccessFoundation(principal: FoundationPrincipal, capability: FoundationCapability, resource: FoundationResource): boolean {
  if (principal.agencyId !== resource.agencyId) return false;
  if (privileged.has(principal.role) && !principal.mfaVerified) return false;
  if (agencyOperators.has(principal.role)) return true;
  if (principal.role === 'super_admin') return principal.mfaVerified;
  const siteAssigned = Boolean(resource.managedSiteId && principal.siteIds?.includes(resource.managedSiteId));
  const propertyAssigned = Boolean(resource.propertyId && principal.propertyIds?.includes(resource.propertyId));
  if (siteOperators.has(principal.role)) return siteAssigned;
  if (principal.role === 'council_member') return siteAssigned && capability === 'approval.read';
  if (principal.role === 'inspector') return capability === 'inspection_job.read' && resource.assignedInspectorId === principal.userId;
  if (principal.role === 'analyst') return capability === 'inspection_job.read' && resource.assignedAnalystId === principal.userId;
  if (principal.role === 'reviewer') return capability === 'inspection_job.read' && resource.assignedReviewerId === principal.userId;
  if (principal.role === 'resident_owner' || principal.role === 'resident_tenant') {
    return (capability === 'resident_request.read' && resource.residentUserId === principal.userId) || (capability === 'property.read' && propertyAssigned);
  }
  if (principal.role === 'client_admin' || principal.role === 'client_user') {
    return resource.clientId === principal.clientId && ['property.read', 'service_request.create'].includes(capability);
  }
  if (principal.role === 'contractor_admin' || principal.role === 'contractor_worker') {
    return capability === 'work_order.read' && resource.assignedContractorId === principal.userId;
  }
  return false;
}
