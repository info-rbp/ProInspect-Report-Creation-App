import {
  PORTAL_DEFINITIONS,
  portalDefinitionsForRole,
  type PortalDefinition,
  type PortalId,
  type UnifiedRole,
} from '@pcr/domain';
import {
  activePortalEntitlements,
  type PortalEntitlementRecord,
} from './portalEntitlementService';

const UNIFIED_ROLES = new Set<UnifiedRole>([
  'super_admin', 'proinspect_admin', 'operations', 'inspector', 'analyst', 'reviewer',
  'tenant', 'landlord', 'shopify_customer', 'building_manager', 'relief_building_manager',
  'strata_manager', 'council_member', 'resident_owner', 'resident_tenant', 'client_admin',
  'client_user', 'contractor_admin', 'contractor_worker',
]);

export function asUnifiedRole(value: string | undefined): UnifiedRole | undefined {
  return value && UNIFIED_ROLES.has(value as UnifiedRole) ? value as UnifiedRole : undefined;
}

function entitledPortalIds(entitlements: readonly PortalEntitlementRecord[]): Set<PortalId> {
  return new Set(activePortalEntitlements(entitlements).map((item) => item.portalId));
}

export function availablePortals(
  roleValue: string | undefined,
  entitlements: readonly PortalEntitlementRecord[] = [],
): readonly PortalDefinition[] {
  const role = asUnifiedRole(roleValue);
  if (role === 'super_admin' || role === 'proinspect_admin') return PORTAL_DEFINITIONS;

  const allowed = new Set<PortalId>(portalDefinitionsForRole(role).map((portal) => portal.id));
  for (const portalId of entitledPortalIds(entitlements)) allowed.add(portalId);
  return PORTAL_DEFINITIONS.filter((portal) => allowed.has(portal.id));
}

export function canOpenPortal(
  roleValue: string | undefined,
  portalId: PortalId,
  entitlements: readonly PortalEntitlementRecord[] = [],
): boolean {
  return availablePortals(roleValue, entitlements).some((portal) => portal.id === portalId);
}

export function defaultPortalRoute(
  roleValue: string | undefined,
  entitlements: readonly PortalEntitlementRecord[] = [],
): string {
  const role = asUnifiedRole(roleValue);
  if (role === 'super_admin' || role === 'proinspect_admin' || role === 'operations' || role === 'analyst' || role === 'reviewer') return '/admin';
  return availablePortals(roleValue, entitlements)[0]?.route ?? '/app/dashboard';
}

export function portalDefinition(portalId: PortalId): PortalDefinition {
  const portal = PORTAL_DEFINITIONS.find((item) => item.id === portalId);
  if (!portal) throw new Error(`Unknown portal: ${portalId}`);
  return portal;
}
