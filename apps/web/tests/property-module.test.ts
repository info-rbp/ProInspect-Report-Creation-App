import { describe, expect, it } from 'vitest';
import type { PropertyRecord } from '../types/platform';
import {
  PROPERTY_LAYOUT_TEMPLATES,
  applyLayoutTemplate,
  cloneLayoutFromProperty,
  hierarchyFromRooms,
  migrateTemplateBackedLayoutToCanonical,
} from '../services/platform/propertyLayoutService';

function property(id: string): PropertyRecord {
  return {
    id,
    agencyId: 'agency-1',
    address: `${id} Test Street`,
    suburb: 'Perth',
    state: 'WA',
    postcode: '6000',
    propertyType: 'house',
    propertyUse: 'residential',
    physicalPropertyType: 'house',
    ownershipStructure: 'freehold',
    status: 'active',
    clientIds: [],
    roomsConfig: [],
    layoutNodes: [],
    layoutVersions: [],
    ownershipHistory: [],
    tenancyHistory: [],
    accessDevices: [],
    assets: [],
    documents: [],
    profilePhotos: [],
    alerts: [],
    floorPlanDocumentIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('property module layout services', () => {
  it('ships the ten canonical Property Layout templates', () => {
    expect(PROPERTY_LAYOUT_TEMPLATES.map((template) => template.id)).toEqual([
      'res-house-3x2',
      'res-house-4x2',
      'res-apartment-1x1',
      'res-apartment-2x2',
      'res-furnished-apartment',
      'res-townhouse',
      'commercial-office',
      'commercial-retail',
      'industrial-warehouse',
      'strata-common-property',
    ]);
  });

  it('applies a template as a versioned exact Area/Component snapshot', () => {
    const target = property('property-1');
    const template = PROPERTY_LAYOUT_TEMPLATES.find((item) => item.id === 'res-house-3x2')!;
    const patch = applyLayoutTemplate(target, template);
    expect(patch.layoutTemplateId).toBe(template.id);
    expect(patch.roomsConfig?.length).toBeGreaterThan(10);
    expect(patch.currentLayoutVersionId).toBeTruthy();
    expect(patch.layoutVersions?.[0]).toMatchObject({
      templateId: template.id,
      canonicalCatalogueId: 'proinspect-property-layout-catalogue',
      canonicalCatalogueVersion: 1,
    });
    for (const room of patch.roomsConfig || []) {
      expect(room.canonicalAreaDefinitionId).toBeTruthy();
      expect(room.canonicalAreaDefinitionVersion).toBeGreaterThan(0);
      expect(room.componentRefs?.length).toBeGreaterThan(0);
      for (const component of room.componentRefs || []) {
        expect(component.id).toContain(`${room.id}:component:`);
        expect(component.canonicalComponentDefinitionId).toBeTruthy();
        expect(component.canonicalComponentDefinitionVersion).toBeGreaterThan(0);
        expect(component.canonicalAreaComponentRuleId).toBeTruthy();
      }
    }
  });

  it('retains canonical references in hierarchy nodes', () => {
    const target = property('property-2');
    const template = PROPERTY_LAYOUT_TEMPLATES.find((item) => item.id === 'res-apartment-2x2')!;
    const rooms = applyLayoutTemplate({ ...target, physicalPropertyType: 'apartment', propertyType: 'apartment' }, template).roomsConfig!;
    const nodes = hierarchyFromRooms(rooms);
    const areaNodes = nodes.filter((node) => node.kind === 'area');
    expect(areaNodes.length).toBe(rooms.length);
    expect(areaNodes.every((node) => Boolean(node.canonicalAreaDefinitionId && node.canonicalAreaDefinitionVersion && node.componentRefs?.length))).toBe(true);
  });

  it('clones Property instance identities while preserving canonical identities', () => {
    const sourceBase = property('source');
    const template = PROPERTY_LAYOUT_TEMPLATES.find((item) => item.id === 'res-house-4x2')!;
    const sourcePatch = applyLayoutTemplate(sourceBase, template);
    const source = { ...sourceBase, ...sourcePatch } as PropertyRecord;
    const target = property('target');
    const patch = cloneLayoutFromProperty(target, source);
    expect(patch.roomsConfig?.length).toBe(source.roomsConfig.length);
    expect(patch.roomsConfig?.[0].id).not.toBe(source.roomsConfig[0].id);
    expect(patch.roomsConfig?.[0].canonicalAreaDefinitionId).toBe(source.roomsConfig[0].canonicalAreaDefinitionId);
    expect(patch.roomsConfig?.[0].componentRefs?.[0].id).not.toBe(source.roomsConfig[0].componentRefs?.[0].id);
    expect(patch.roomsConfig?.[0].componentRefs?.[0].canonicalComponentDefinitionId).toBe(source.roomsConfig[0].componentRefs?.[0].canonicalComponentDefinitionId);
  });

  it('migrates a renamed known-template layout without matching the display name', () => {
    const template = PROPERTY_LAYOUT_TEMPLATES.find((item) => item.id === 'res-apartment-1x1')!;
    const target = {
      ...property('legacy-apartment'),
      propertyType: 'apartment' as const,
      physicalPropertyType: 'apartment' as const,
      layoutTemplateId: template.id,
      roomsConfig: [
        { id: 'legacy-entry', name: 'Absolutely Not Called Entry', roomType: 'hallway' as const },
        { id: 'legacy-living', name: 'The Room With The Sofa', roomType: 'living' as const },
        { id: 'legacy-kitchen', name: 'Room of Regrettable Toast', roomType: 'kitchen' as const },
        { id: 'legacy-bedroom', name: 'Sleeping Zone', roomType: 'bedroom' as const },
        { id: 'legacy-bath', name: 'Wet Room', roomType: 'bathroom' as const },
        { id: 'legacy-laundry', name: 'Machine Cave', roomType: 'laundry' as const },
        { id: 'legacy-outdoor', name: 'Outside-ish', roomType: 'outdoor' as const },
        { id: 'legacy-storage', name: 'Stuff Room', roomType: 'storage' as const },
        { id: 'legacy-parking', name: 'Metal Box Space', roomType: 'garage' as const },
        { id: 'legacy-safety', name: 'Alarm Things', roomType: 'safety' as const },
      ],
    } as PropertyRecord;
    const result = migrateTemplateBackedLayoutToCanonical(target);
    expect(result.complete).toBe(true);
    expect(result.migratedCount).toBe(10);
    expect(result.rooms.find((room) => room.id === 'legacy-kitchen')).toMatchObject({
      name: 'Room of Regrettable Toast',
      canonicalAreaDefinitionId: 'kitchen',
      canonicalAreaDefinitionVersion: 1,
    });
    expect(result.rooms.find((room) => room.id === 'legacy-kitchen')?.componentRefs?.length).toBeGreaterThan(5);
  });

  it('leaves unmatched custom legacy Areas explicit rather than guessing from their names', () => {
    const target = {
      ...property('custom-property'),
      roomsConfig: [{ id: 'custom', name: 'Kitchen But Actually A Plant Room', roomType: 'other' as const }],
    } as PropertyRecord;
    const result = migrateTemplateBackedLayoutToCanonical(target);
    expect(result).toMatchObject({ migratedCount: 0, unmappedCount: 1, complete: false });
    expect(result.rooms[0].canonicalAreaDefinitionId).toBeUndefined();
  });
});
