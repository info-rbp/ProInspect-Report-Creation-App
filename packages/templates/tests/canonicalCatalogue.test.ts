import { describe, expect, it } from 'vitest';
import {
  CANONICAL_AREA_COMPONENT_RULES,
  CANONICAL_AREA_DEFINITIONS,
  CANONICAL_COMPONENT_DEFINITIONS,
  CANONICAL_PCR_CATALOGUE_V1,
  LEGACY_CATALOGUE_ID_MAP,
  areaComponentRulesForArea,
  findAreaDefinition,
  findComponentDefinition,
  legacyTemplateAreasFromCatalogue,
  resolveComponentDefinitionId,
  validateCanonicalCatalogue,
} from '../src/canonicalCatalogue.js';
import { pcrStandardAreas } from '../src/pcrPreset.js';

describe('canonical area and component catalogue migration', () => {
  it('round-trips the legacy PCR catalogue without changing any report-facing ids or ordering', () => {
    expect(legacyTemplateAreasFromCatalogue(CANONICAL_PCR_CATALOGUE_V1)).toEqual(pcrStandardAreas);
    expect(CANONICAL_PCR_CATALOGUE_V1.migrationSummary.legacyAreaCount).toBe(pcrStandardAreas.length);
    expect(CANONICAL_PCR_CATALOGUE_V1.migrationSummary.legacyAreaComponentCount).toBe(
      pcrStandardAreas.reduce((total, area) => total + area.components.length, 0),
    );
  });

  it('maps every existing legacy area and area-component membership to a canonical record', () => {
    for (const area of pcrStandardAreas) {
      expect(LEGACY_CATALOGUE_ID_MAP.areaIds[area.id]).toBe(area.id);
      const canonicalArea = findAreaDefinition(area.id);
      expect(canonicalArea?.legacyIds).toContain(area.id);

      for (const component of area.components) {
        const canonicalComponentId = LEGACY_CATALOGUE_ID_MAP.componentIds[component.id];
        expect(canonicalComponentId).toBeTruthy();
        expect(findComponentDefinition(component.id)?.legacyIds).toContain(component.id);
        expect(LEGACY_CATALOGUE_ID_MAP.areaComponentKeys[`${area.id}/${component.id}`]).toBe(
          `${area.id}:${component.id}`,
        );
      }
    }
  });

  it('consolidates safe legacy synonyms while retaining the old ids as aliases', () => {
    expect(resolveComponentDefinitionId('light-fitting')).toBe('light-fittings');
    expect(findComponentDefinition('light-fitting')?.legacyIds).toEqual(
      expect.arrayContaining(['light-fitting', 'light-fittings']),
    );

    expect(resolveComponentDefinitionId('smoke-alarms')).toBe('smoke-alarm');
    expect(findComponentDefinition('smoke-alarms')?.aliases).toEqual(
      expect.arrayContaining(['Smoke Alarm', 'Smoke Alarms']),
    );
  });

  it('publishes stable codes, aliases, applicability and categories for the migrated definitions', () => {
    const areaCodes = CANONICAL_AREA_DEFINITIONS.map((area) => area.code);
    const componentCodes = CANONICAL_COMPONENT_DEFINITIONS.map((component) => component.code);
    const ruleCodes = CANONICAL_AREA_COMPONENT_RULES.map((rule) => rule.code);

    expect(new Set(areaCodes).size).toBe(areaCodes.length);
    expect(new Set(componentCodes).size).toBe(componentCodes.length);
    expect(new Set(ruleCodes).size).toBe(ruleCodes.length);

    const bedroom = findAreaDefinition('bedroom');
    expect(bedroom).toMatchObject({
      code: 'AREA_BEDROOM',
      category: 'sleeping',
      repeatable: true,
      version: 1,
      status: 'published',
    });
    expect(bedroom?.aliases).toEqual(expect.arrayContaining(['Master Bedroom', 'Primary Bedroom']));
    expect(bedroom?.applicability.propertyUses).toContain('residential');

    const frontExterior = findAreaDefinition('exterior-front');
    expect(frontExterior?.applicability.physicalPropertyTypes).toContain('house');
    expect(frontExterior?.applicability.physicalPropertyTypes).not.toContain('apartment');
  });

  it('preserves the legacy required and photo-required flags in area-component rules', () => {
    const kitchenRules = areaComponentRulesForArea('kitchen');
    const oven = kitchenRules.find((rule) => rule.legacyComponentId === 'oven-griller');
    const dishwasher = kitchenRules.find((rule) => rule.legacyComponentId === 'dishwasher');

    expect(oven).toMatchObject({ inclusion: 'required', photoRequired: true, order: 14 });
    expect(dishwasher).toMatchObject({ inclusion: 'default', photoRequired: false, order: 16 });
  });

  it('rejects catalogue records that reference missing canonical definitions', () => {
    const invalid = structuredClone(CANONICAL_PCR_CATALOGUE_V1);
    invalid.areaComponentRules[0] = {
      ...invalid.areaComponentRules[0],
      componentDefinitionId: 'component-that-does-not-exist',
    };
    expect(() => validateCanonicalCatalogue(invalid)).toThrow('references unknown component');
  });
});
