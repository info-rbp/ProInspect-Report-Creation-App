import { describe, expect, it } from 'vitest';
import {
  asUnifiedRole,
  availablePortals,
  canOpenPortal,
  defaultPortalRoute,
  portalDefinition,
} from '../services/platform/portalAccess';
import type { PortalEntitlementRecord } from '../services/platform/portalEntitlementService';

function entitlement(overrides: Partial<PortalEntitlementRecord> = {}): PortalEntitlementRecord {
  return {
    id: 'entitlement-1',
    agencyId: 'agency-a',
    userId: 'user-a',
    portalId: 'resident',
    sourceRole: 'resident_tenant',
    managedSiteId: 'site-a',
    status: 'active',
    ...overrides,
  };
}

describe('portal access resolver', () => {
  it('maps each scoped role to its intended portal', () => {
    expect(defaultPortalRoute('building_manager')).toBe('/building');
    expect(defaultPortalRoute('relief_building_manager')).toBe('/building');
    expect(defaultPortalRoute('strata_manager')).toBe('/strata');
    expect(defaultPortalRoute('resident_owner')).toBe('/resident');
    expect(defaultPortalRoute('client_admin')).toBe('/client');
    expect(defaultPortalRoute('contractor_worker')).toBe('/contractor');
    expect(defaultPortalRoute('inspector')).toBe('/inspector');
  });

  it('provides all portal workspaces to ProInspect administrators', () => {
    const portals = availablePortals('proinspect_admin');
    expect(portals.map((portal) => portal.id)).toEqual([
      'admin', 'inspector', 'building', 'strata', 'resident', 'client', 'contractor',
    ]);
    expect(canOpenPortal('proinspect_admin', 'contractor')).toBe(true);
  });

  it('does not widen scoped user access without an entitlement', () => {
    expect(canOpenPortal('resident_tenant', 'resident')).toBe(true);
    expect(canOpenPortal('resident_tenant', 'building')).toBe(false);
    expect(canOpenPortal('contractor_worker', 'strata')).toBe(false);
    expect(canOpenPortal('council_member', 'admin')).toBe(false);
  });

  it('adds a second portal only when an active scoped entitlement grants it', () => {
    const client = entitlement({
      id: 'client-entitlement',
      portalId: 'client',
      sourceRole: 'client_user',
      clientAccountId: 'client-a',
      managedSiteId: undefined,
    });
    expect(canOpenPortal('resident_tenant', 'client', [client])).toBe(true);
    expect(availablePortals('resident_tenant', [client]).map((portal) => portal.id)).toEqual(['resident', 'client']);
  });

  it('ignores inactive, expired and future portal entitlements', () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    expect(canOpenPortal('resident_tenant', 'client', [entitlement({ portalId: 'client', sourceRole: 'client_user', status: 'suspended', clientAccountId: 'client-a' })])).toBe(false);
    expect(canOpenPortal('resident_tenant', 'client', [entitlement({ portalId: 'client', sourceRole: 'client_user', validUntil: yesterday, clientAccountId: 'client-a' })])).toBe(false);
    expect(canOpenPortal('resident_tenant', 'client', [entitlement({ portalId: 'client', sourceRole: 'client_user', validFrom: tomorrow, clientAccountId: 'client-a' })])).toBe(false);
  });

  it('uses an entitlement-backed portal as the default for otherwise unsupported transitional roles', () => {
    const building = entitlement({ portalId: 'building', sourceRole: 'building_manager', managedSiteId: 'site-a' });
    expect(defaultPortalRoute('unexpected-role', [building])).toBe('/building');
  });

  it('handles unsupported profile roles safely when no entitlement exists', () => {
    expect(asUnifiedRole('unexpected-role')).toBeUndefined();
    expect(availablePortals('unexpected-role')).toEqual([]);
    expect(defaultPortalRoute('unexpected-role')).toBe('/app/dashboard');
  });

  it('returns stable portal definitions', () => {
    expect(portalDefinition('resident')).toMatchObject({ route: '/resident', name: 'Resident Portal' });
  });
});
