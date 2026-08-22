import { describe, expect, it } from 'vitest';
import {
  CANONICAL_PROPERTY_LAYOUT_TEMPLATES,
  PROPERTY_LAYOUT_AREA_DEFINITIONS,
  PROPERTY_LAYOUT_COMPONENT_DEFINITIONS,
  findSystemAreaDefinition,
  findSystemComponentDefinition,
  resolvePropertyLayoutTemplateRooms,
  systemAreaComponentRulesForArea,
  validatePropertyLayoutCatalogue,
} from '../src/propertyLayoutCatalogue.js';

const EXPECTED_TEMPLATE_IDS = [
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
];

describe('canonical Property Layout catalogue', () => {
  it('preserves all ten Property Layout template identities and validates the catalogue', () => {
    expect(() => validatePropertyLayoutCatalogue()).not.toThrow();
    expect(CANONICAL_PROPERTY_LAYOUT_TEMPLATES.map((template) => template.id)).toEqual(EXPECTED_TEMPLATE_IDS);
  });

  it('pins every template Area and every Area Component rule to an exact published definition version', () => {
    for (const template of CANONICAL_PROPERTY_LAYOUT_TEMPLATES) {
      expect(template.rooms.length).toBeGreaterThan(0);
      for (const room of template.rooms) {
        const area = findSystemAreaDefinition(room.canonicalAreaDefinitionId, room.canonicalAreaDefinitionVersion);
        expect(area, `${template.id}/${room.name} Area`).toBeTruthy();
        expect(area?.status).toBe('published');
        const rules = systemAreaComponentRulesForArea(room.canonicalAreaDefinitionId, room.canonicalAreaDefinitionVersion);
        expect(rules.length, `${template.id}/${room.name} Components`).toBeGreaterThan(0);
        for (const rule of rules) {
          const component = findSystemComponentDefinition(rule.componentDefinitionId, rule.componentDefinitionVersion);
          expect(component, `${rule.id} Component`).toBeTruthy();
          expect(component?.status).toBe('published');
        }
      }
    }
  });

  it('adds commercial, retail, warehouse, strata, furnished and specialist definitions', () => {
    const areaIds = new Set(PROPERTY_LAYOUT_AREA_DEFINITIONS.map((area) => area.id));
    for (const id of [
      'commercial-reception',
      'retail-sales-area',
      'warehouse-floor',
      'strata-building-entry',
      'furniture-included-chattels',
      'medical-consulting-room',
      'childcare-outdoor-play',
      'retirement-accessibility-safety',
    ]) expect(areaIds.has(id), id).toBe(true);

    const componentIds = new Set(PROPERTY_LAYOUT_COMPONENT_DEFINITIONS.map((component) => component.id));
    for (const id of [
      'reception-counter',
      'shopfront-glazing',
      'warehouse-slab',
      'lift-car-doors',
      'furniture-lounge',
      'clinical-handwash-basin',
      'play-equipment',
      'emergency-call-system',
    ]) expect(componentIds.has(id), id).toBe(true);
  });

  it('creates immutable later system Component versions when applicability expands beyond residential v1', () => {
    const residentialWalls = findSystemComponentDefinition('walls', 1);
    const expandedWalls = findSystemComponentDefinition('walls', 2);
    expect(residentialWalls?.applicability.propertyUses).toEqual(['residential']);
    expect(expandedWalls).toMatchObject({ id: 'walls', version: 2, status: 'published', source: 'system_property_layouts' });
    expect(expandedWalls?.applicability.propertyUses).toEqual(expect.arrayContaining(['residential', 'commercial', 'industrial', 'retail', 'strata_common_property']));
  });

  it('injects specialist Areas from physical Property Type instead of display-name inference', () => {
    const commercial = CANONICAL_PROPERTY_LAYOUT_TEMPLATES.find((template) => template.id === 'commercial-office')!;
    const medical = resolvePropertyLayoutTemplateRooms(commercial, 'medical_consulting').map((room) => room.canonicalAreaDefinitionId);
    const childcare = resolvePropertyLayoutTemplateRooms(commercial, 'childcare').map((room) => room.canonicalAreaDefinitionId);
    const office = resolvePropertyLayoutTemplateRooms(commercial, 'office').map((room) => room.canonicalAreaDefinitionId);
    expect(medical).toEqual(expect.arrayContaining(['medical-consulting-room', 'medical-treatment-room']));
    expect(childcare).toEqual(expect.arrayContaining(['childcare-activity-room', 'childcare-sleep-room', 'childcare-outdoor-play']));
    expect(office).not.toContain('medical-consulting-room');
    expect(office).not.toContain('childcare-activity-room');

    const retail = CANONICAL_PROPERTY_LAYOUT_TEMPLATES.find((template) => template.id === 'commercial-retail')!;
    expect(resolvePropertyLayoutTemplateRooms(retail, 'restaurant_cafe').map((room) => room.canonicalAreaDefinitionId)).toEqual(expect.arrayContaining(['commercial-kitchen', 'coolroom-refrigeration-area']));
    expect(resolvePropertyLayoutTemplateRooms(retail, 'showroom').map((room) => room.canonicalAreaDefinitionId)).toContain('showroom-floor');

    const apartment = CANONICAL_PROPERTY_LAYOUT_TEMPLATES.find((template) => template.id === 'res-apartment-1x1')!;
    expect(resolvePropertyLayoutTemplateRooms(apartment, 'retirement_supported').map((room) => room.canonicalAreaDefinitionId)).toContain('retirement-accessibility-safety');
  });
});
