import {
  PORTAL_DEFINITIONS,
  portalDefinitionsForRole,
  type PortalDefinition,
  type PortalId,
  type UnifiedRole,
} from '@pcr/domain';

const UNIFIED_ROLES = new Set<UnifiedRole>([
  'super_admin', 'proinspect_admin', 'operations', 'inspector', 'analyst', 'reviewer',
  'tenant', 'landlord', 'shopify_customer', 'building_manager', 'relief_building_manager',
  'strata_manager', 'council_member', 'resident_owner', 'resident_tenant', 'client_admin',
  'client_user', 'contractor_admin', 'contractor_worker',
]);

export function asUnifiedRole(value: string | undefined): UnifiedRole | undefined {
  return value && UNIFIED_ROLES.has(value as UnifiedRole) ? value as UnifiedRole : undefined;
}

export function availablePortals(roleValue: string | undefined): readonly PortalDefinition[] {
  return portalDefinitionsForRole(asUnifiedRole(roleValue));
}

export function canOpenPortal(roleValue: string | undefined, portalId: PortalId): boolean {
  return availablePortals(roleValue).some((portal) => portal.id === portalId);
}

export function defaultPortalRoute(roleValue: string | undefined): string {
  const role = asUnifiedRole(roleValue);
  if (role === 'super_admin' || role === 'proinspect_admin' || role === 'operations' || role === 'analyst' || role === 'reviewer') return '/admin';
  return portalDefinitionsForRole(role)[0]?.route ?? '/app/dashboard';
}

export function portalDefinition(portalId: PortalId): PortalDefinition {
  const portal = PORTAL_DEFINITIONS.find((item) => item.id === portalId);
  if (!portal) throw new Error(`Unknown portal: ${portalId}`);
  return portal;
}
