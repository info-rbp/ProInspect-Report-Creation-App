import { describe, expect, it } from 'vitest';
import {
  matchBankEntry,
  systemInspectionTemplateContract,
  validateCanonicalInspectionTemplate,
  validateTemplate,
  type InspectionTypeTemplate,
  type StructuredInspectionFact,
} from '../src/index.js';

describe('canonical inspection template contracts', () => {
  it('accepts a canonical dynamic template without cloned Area or Component objects', () => {
    const contract = systemInspectionTemplateContract('entry');
    const template: InspectionTypeTemplate = {
      id: 'agency-entry',
      version: 1,
      inspectionType: 'entry',
      propertyType: 'residential',
      status: 'draft',
      areas: [],
      structureMode: contract.structureMode,
      includeUnreferencedPropertyAreas: true,
      canonicalAreaReferences: [],
      propertyUses: ['residential'],
      physicalPropertyTypes: ['house', 'apartment'],
      commentaryBank: [],
      createdAt: '2026-08-22T00:00:00.000Z',
    };

    expect(() => validateTemplate(template)).not.toThrow();
    expect(validateCanonicalInspectionTemplate({
      ...contract,
      id: template.id,
      status: template.status,
      propertyUses: template.propertyUses || [],
      physicalPropertyTypes: template.physicalPropertyTypes || [],
    })).toEqual([]);
  });

  it('rejects a restrictive template that has no canonical Area references', () => {
    const contract = systemInspectionTemplateContract('exit');
    expect(validateCanonicalInspectionTemplate({
      ...contract,
      includeUnreferencedPropertyAreas: false,
      areaReferences: [],
    })).toContain('A restrictive template must contain at least one canonical Area reference.');
  });

  it('matches commentary by canonical identity even when display labels have changed', () => {
    const template: InspectionTypeTemplate = {
      id: 'canonical-commentary',
      version: 1,
      inspectionType: 'entry',
      propertyType: 'residential',
      status: 'draft',
      areas: [],
      structureMode: 'property_layout_catalogue',
      includeUnreferencedPropertyAreas: true,
      canonicalAreaReferences: [],
      propertyUses: ['residential'],
      physicalPropertyTypes: ['house'],
      createdAt: '2026-08-22T00:00:00.000Z',
      commentaryBank: [
        {
          id: 'canonical-rule',
          area: 'Old Entry Label',
          component: 'Old Door Label',
          canonicalAreaDefinitionId: 'entry',
          canonicalComponentDefinitionId: 'front-door',
          inspectionTypes: ['entry'],
          condition: 'minor_wear',
          text: '{{component}} - minor wear noted.',
          active: true,
        },
        {
          id: 'legacy-label-rule',
          area: 'Renamed Vestibule',
          component: 'Ceremonial Portal',
          inspectionTypes: ['entry'],
          condition: 'minor_wear',
          text: '{{component}} - legacy label match.',
          active: true,
        },
      ],
    };
    const fact: StructuredInspectionFact = {
      area: 'Renamed Vestibule',
      component: 'Ceremonial Portal',
      canonicalAreaDefinitionId: 'entry',
      canonicalAreaDefinitionVersion: 2,
      canonicalComponentDefinitionId: 'front-door',
      canonicalComponentDefinitionVersion: 3,
      visibility: 'visible',
      condition: 'minor_wear',
      workingState: 'not_relevant',
      photoReferences: ['photo-1'],
      inspectionType: 'entry',
    };

    expect(matchBankEntry(template, fact)?.id).toBe('canonical-rule');
  });
});
