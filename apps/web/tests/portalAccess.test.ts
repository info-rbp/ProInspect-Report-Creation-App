import { describe, expect, it } from 'vitest';
import {
  asUnifiedRole,
  availablePortals,
  canOpenPortal,
  defaultPortalRoute,
  portalDefinition,
} from '../services/platform/portalAccess';

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

  it('does not widen scoped user access', () => {
    expect(canOpenPortal('resident_tenant', 'resident')).toBe(true);
    expect(canOpenPortal('resident_tenant', 'building')).toBe(false);
    expect(canOpenPortal('contractor_worker', 'strata')).toBe(false);
    expect(canOpenPortal('council_member', 'admin')).toBe(false);
  });

  it('handles unsupported profile roles safely', () => {
    expect(asUnifiedRole('unexpected-role')).toBeUndefined();
    expect(availablePortals('unexpected-role')).toEqual([]);
    expect(defaultPortalRoute('unexpected-role')).toBe('/app/dashboard');
  });

  it('returns stable portal definitions', () => {
    expect(portalDefinition('resident')).toMatchObject({ route: '/resident', name: 'Resident Portal' });
  });
});
