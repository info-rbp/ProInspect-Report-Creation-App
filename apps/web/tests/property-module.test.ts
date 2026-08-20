import { describe, expect, it } from 'vitest';
import type { PropertyRecord } from '../types/platform';
import {
  PROPERTY_LAYOUT_TEMPLATES,
  applyLayoutTemplate,
  cloneLayoutFromProperty,
  hierarchyFromRooms,
} from '../services/platform/propertyLayoutService';
import { parsePropertyCsv } from '../services/platform/propertyBulkImportService';

function property(overrides: Partial<PropertyRecord> = {}): PropertyRecord {
  const now = '2026-08-20T00:00:00.000Z';
  return {
    id: 'property-1',
    agencyId: 'agency-1',
    address: '1 Test Street',
    propertyType: 'house',
    propertyUse: 'residential',
    physicalPropertyType: 'house',
    ownershipStructure: 'freehold',
    clientIds: [],
    status: 'active',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('property layout foundation', () => {
  it('provides layouts across residential, commercial, industrial and strata use cases', () => {
    const ids = new Set(PROPERTY_LAYOUT_TEMPLATES.map((template) => template.id));
    expect(ids).toContain('res-house-3x2');
    expect(ids).toContain('res-townhouse');
    expect(ids).toContain('res-furnished-apartment');
    expect(ids).toContain('commercial-office');
    expect(ids).toContain('commercial-retail');
    expect(ids).toContain('industrial-warehouse');
    expect(ids).toContain('strata-common-property');
  });

  it('creates a versioned property-owned copy of a template', () => {
    const source = property();
    const template = PROPERTY_LAYOUT_TEMPLATES.find((candidate) => candidate.id === 'res-house-3x2');
    expect(template).toBeDefined();
    const patch = applyLayoutTemplate(source, template!);
    expect(patch.currentLayoutVersionId).toBeTruthy();
    expect(patch.layoutVersions).toHaveLength(1);
    expect(patch.roomsConfig.length).toBeGreaterThan(10);
    expect(patch.layoutVersions[0].roomsConfig).not.toBe(patch.roomsConfig);
  });

  it('builds Site to Building to Level to Area hierarchy', () => {
    const nodes = hierarchyFromRooms([
      { id: 'area-entry', name: 'Entry', roomType: 'hallway', floorLevel: 'Ground Floor' },
      { id: 'area-bedroom', name: 'Bedroom', roomType: 'bedroom', floorLevel: 'First Floor' },
    ]);
    expect(nodes.find((node) => node.kind === 'site')).toBeDefined();
    expect(nodes.find((node) => node.kind === 'building')).toBeDefined();
    expect(nodes.filter((node) => node.kind === 'level')).toHaveLength(2);
    expect(nodes.filter((node) => node.kind === 'area')).toHaveLength(2);
  });

  it('clones another property layout without reusing stable area identities', () => {
    const source = property({ id: 'source', roomsConfig: [{ id: 'source-area', name: 'Kitchen', roomType: 'kitchen' }] });
    const target = property({ id: 'target', address: '2 Test Street' });
    const patch = cloneLayoutFromProperty(target, source);
    expect(patch.roomsConfig[0].id).not.toBe('source-area');
    expect(patch.layoutVersions[0].changeReason).toContain(source.address);
  });
});

describe('property portfolio CSV review', () => {
  it('parses classification, ownership, people and property configuration before import', () => {
    const rows = parsePropertyCsv([
      'address,suburb,state,postcode,property_use,physical_property_type,ownership_structure,bedrooms,bathrooms,parking,owner_name,tenant_name,tenant_email,lease_start_date,lease_end_date',
      '46 Maamba Road,Wattle Grove,WA,6107,residential,house,freehold,4,2,2,Example Owner,Example Tenant,tenant@example.com,2026-08-01,2027-07-31',
    ].join('\n'));
    expect(rows).toHaveLength(1);
    expect(rows[0].errors).toEqual([]);
    expect(rows[0].propertyUse).toBe('residential');
    expect(rows[0].physicalPropertyType).toBe('house');
    expect(rows[0].ownershipStructure).toBe('freehold');
    expect(rows[0].tenantName).toBe('Example Tenant');
  });

  it('blocks a row without a property address', () => {
    const rows = parsePropertyCsv('address,property_use\n,residential');
    expect(rows[0].errors).toContain('Address is required.');
  });
});
