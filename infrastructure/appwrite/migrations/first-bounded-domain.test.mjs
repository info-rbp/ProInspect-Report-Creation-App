import { describe, expect, it } from 'vitest';
import { planFirstBoundedMigration } from './first-bounded-domain.mjs';

const fixture = {
  agencies: [{ id: 'a1', name: 'Agency', code: 'AG', status: 'active' }],
  clients: [{ id: 'c1', agencyId: 'a1', name: 'Client' }],
  managedSites: [{ id: 's1', agencyId: 'a1', name: 'Site', strataPlan: 'SP1' }],
  properties: [{ id: 'p1', agencyId: 'a1', managedSiteSourceId: 's1', propertyType: 'apartment', propertyUse: 'residential', ownershipStructure: 'strata', streetAddress: '1 Test St' }],
  propertyClientRelationships: [{ id: 'r1', agencyId: 'a1', propertyId: 'p1', clientId: 'c1', relationshipType: 'property_manager', primary: true }],
  clientContacts: [{ id: 'cc1', agencyId: 'a1', clientId: 'c1', name: 'Contact', roles: ['property_manager'] }],
};

describe('first bounded migration plan', () => {
  it('builds a deterministic dry-run dependency chain without writes', () => {
    const first = planFirstBoundedMigration(fixture, { now: '2026-08-29T00:00:00.000Z' });
    const second = planFirstBoundedMigration(fixture, { now: '2026-08-29T00:00:00.000Z' });
    expect(first.valid).toBe(true);
    expect(first.dryRun).toBe(true);
    expect(first.rows).toHaveLength(6);
    expect(first.counts).toEqual({ agencies: 1, clients: 1, managed_sites: 1, properties: 1, property_client_relationships: 1, client_contacts: 1 });
    expect(second).toEqual(first);
  });

  it('fails closed when a parent source row is outside the bounded export', () => {
    const plan = planFirstBoundedMigration({ ...fixture, properties: [{ ...fixture.properties[0], managedSiteSourceId: 'missing' }] });
    expect(plan.valid).toBe(false);
    expect(plan.errors[0].message).toContain('unplanned strata_d1.properties');
  });
});
