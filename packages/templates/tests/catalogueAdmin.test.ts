import { describe, expect, it } from 'vitest';
import {
  MANAGED_CANONICAL_AREA_V1,
  MANAGED_CANONICAL_COMPONENT_V1,
  createAreaComponentAssignment,
  createAreaDraftDefinition,
  createComponentDraftDefinition,
  normaliseAreaComponentRuleOrder,
  validateManagedArea,
  validateManagedComponent,
} from '../src/catalogueAdmin.js';

describe('catalogue administration contracts', () => {
  it('adds assessment and evidence defaults without losing legacy photo requirements', () => {
    const kitchen = MANAGED_CANONICAL_AREA_V1.find((area) => area.definition.id === 'kitchen');
    const oven = kitchen?.componentRules.find((rule) => rule.componentDefinitionId === 'oven-griller');
    expect(oven).toBeTruthy();
    expect(oven).toMatchObject({
      inclusion: 'required',
      photoRequired: true,
      evidenceDefaults: {
        componentPhotoRequired: true,
        minimumPhotos: 1,
        exceptionPhotoRequired: true,
      },
      assessmentDefaults: {
        workingStatus: 'required',
        operationalTest: 'recommended',
        maintenanceEvaluation: true,
      },
    });
  });

  it('creates agency draft definitions with stable machine codes and broad applicability', () => {
    const area = createAreaDraftDefinition({ id: 'Pool Area', name: 'Pool Area', category: 'external' });
    const component = createComponentDraftDefinition({
      id: 'pool-pump',
      name: 'Pool Pump',
      category: 'plumbing',
      operational: true,
      testable: true,
    });
    expect(area).toMatchObject({ id: 'pool-area', code: 'AREA_POOL_AREA', status: 'draft', source: 'agency_custom' });
    expect(component).toMatchObject({ id: 'pool-pump', code: 'COMPONENT_POOL_PUMP', status: 'draft', operational: true, testable: true });
    expect(area.applicability.inspectionTypes).toEqual(expect.arrayContaining(['entry', 'routine', 'exit', 'comparison', 'maintenance']));
    validateManagedComponent(component);
  });

  it('normalises Area Component order deterministically', () => {
    const area = createAreaDraftDefinition({ id: 'custom-area', name: 'Custom Area' });
    const first = MANAGED_CANONICAL_COMPONENT_V1.find((item) => item.definition.id === 'walls')!.definition;
    const second = MANAGED_CANONICAL_COMPONENT_V1.find((item) => item.definition.id === 'front-door')!.definition;
    const rules = normaliseAreaComponentRuleOrder([
      createAreaComponentAssignment(area, first, 8),
      createAreaComponentAssignment(area, second, 2),
    ]);
    expect(rules.map((rule) => [rule.componentDefinitionId, rule.order])).toEqual([
      ['front-door', 1],
      ['walls', 2],
    ]);
    validateManagedArea(area, rules);
  });

  it('rejects impossible operational configuration', () => {
    const component = createComponentDraftDefinition({ id: 'static-item', name: 'Static Item' });
    expect(() => validateManagedComponent({ ...component, operational: false, testable: true })).toThrow('must also be operational');
  });

  it('rejects evidence rules that claim a required photo with a zero minimum', () => {
    const area = createAreaDraftDefinition({ id: 'custom-area', name: 'Custom Area' });
    const component = MANAGED_CANONICAL_COMPONENT_V1.find((item) => item.definition.id === 'walls')!.definition;
    const rule = createAreaComponentAssignment(area, component, 1);
    rule.evidenceDefaults = { ...rule.evidenceDefaults, componentPhotoRequired: true, minimumPhotos: 0 };
    expect(() => validateManagedArea(area, [rule])).toThrow('minimum photo count');
  });
});
