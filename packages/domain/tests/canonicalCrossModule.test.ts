import { describe, expect, it } from 'vitest';
import {
  canonicalAreaIdentity,
  canonicalComponentOccurrenceIdentity,
  canonicalSemanticComponentIdentity,
  evaluateReportQuality,
  matchCanonicalPriceBookEntries,
  type PriceBookEntry,
  type ReportAggregate,
} from '../src/index.js';

function priceEntry(input: Partial<PriceBookEntry> & Pick<PriceBookEntry, 'id' | 'code'>): PriceBookEntry {
  const { id, code, ...overrides } = input;
  return {
    active: true,
    trade: 'Carpentry',
    category: 'Doors / Locks',
    componentPattern: 'front door',
    issueType: 'damaged',
    recommendedAction: 'Repair front door',
    keywords: ['front', 'door', 'repair'],
    propertyUses: ['residential'],
    physicalPropertyTypes: [],
    regions: [],
    postcodes: [],
    unit: 'each',
    defaultQuantity: 1,
    labourHours: 1,
    labourRate: 100,
    materialCost: 25,
    calloutCost: 0,
    travelCost: 0,
    disposalCost: 0,
    subcontractorCost: 0,
    markupPercent: 20,
    fixedMargin: 0,
    administrationFee: 0,
    gstRate: 0.1,
    taxable: true,
    clientDescription: 'Repair front door',
    inclusions: [],
    exclusions: [],
    siteAssessmentRequired: false,
    automationConfidenceThreshold: 0.8,
    ...overrides,
    id,
    code,
  };
}

describe('canonical cross-module identity', () => {
  it('keeps semantic identity stable across display renames and definition versions', () => {
    const oldArea = { id: 'bedroom-1', canonicalAreaDefinitionId: 'bedroom', canonicalAreaDefinitionVersion: 1 };
    const renamedArea = { id: 'bedroom-1', canonicalAreaDefinitionId: 'bedroom', canonicalAreaDefinitionVersion: 2 };
    const oldComponent = { id: 'old-walls', canonicalComponentDefinitionId: 'walls', canonicalComponentDefinitionVersion: 1 };
    const renamedComponent = { id: 'new-label-walls', canonicalComponentDefinitionId: 'walls', canonicalComponentDefinitionVersion: 3 };

    expect(canonicalAreaIdentity(oldArea)).toBe(canonicalAreaIdentity(renamedArea));
    expect(canonicalComponentOccurrenceIdentity(oldArea, oldComponent)).toBe(
      canonicalComponentOccurrenceIdentity(renamedArea, renamedComponent),
    );
    expect(canonicalSemanticComponentIdentity(oldArea, oldComponent)).toBe(
      canonicalSemanticComponentIdentity(renamedArea, renamedComponent),
    );
  });

  it('does not collapse repeated Property Area occurrences that share one canonical Area definition', () => {
    const component = { canonicalComponentDefinitionId: 'walls', canonicalComponentDefinitionVersion: 1 };
    expect(canonicalComponentOccurrenceIdentity(
      { id: 'bedroom-1', canonicalAreaDefinitionId: 'bedroom' },
      component,
    )).not.toBe(canonicalComponentOccurrenceIdentity(
      { id: 'bedroom-2', canonicalAreaDefinitionId: 'bedroom' },
      component,
    ));
  });

  it('rejects a text-perfect but canonically wrong price rule and prioritises the exact Component binding', () => {
    const wrong = priceEntry({
      id: 'wrong',
      code: 'WRONG',
      canonicalComponentDefinitionIds: ['tapware'],
      componentPattern: 'front door',
      keywords: ['front', 'door', 'repair'],
    });
    const exact = priceEntry({
      id: 'exact',
      code: 'EXACT',
      canonicalAreaDefinitionIds: ['entry'],
      canonicalComponentDefinitionIds: ['front-door'],
      componentPattern: 'unrelated wording',
      keywords: [],
    });

    const matches = matchCanonicalPriceBookEntries({
      title: 'Front door repair required',
      description: 'Front door requires repair',
      category: 'Doors / Locks',
      priority: 'routine',
      sourceComponentId: 'area-entry:component:front-door',
      sourceCanonicalAreaDefinitionId: 'entry',
      sourceCanonicalComponentDefinitionId: 'front-door',
      issueType: 'damaged',
    }, [wrong, exact], { propertyUse: 'residential' });

    expect(matches.map((match) => match.entry.id)).toEqual(['exact']);
    expect(matches[0].reasons.join(' ')).toContain('Exact canonical Component identity');
  });

  it('uses the immutable canonical rule snapshot to drive report QC obligations', () => {
    const aggregate: ReportAggregate = {
      report: {
        id: 'report-1',
        agencyId: 'agency-a',
        propertyId: 'property-1',
        inspectionJobId: 'job-1',
        propertyLayoutVersionId: 'layout-1',
        structureResolutionVersion: 1,
        templateStructureMode: 'property_layout_catalogue',
        canonicalCatalogueId: 'property-layout-catalogue',
        canonicalCatalogueVersion: 1,
        reportType: 'Routine Inspection',
        propertyAddress: '1 Test Street',
        lifecycleStatus: 'draft',
        templateId: 'system-routine-v1',
        templateVersion: 1,
      },
      areas: [{
        id: 'area-entry-instance',
        name: 'Renamed Entrance',
        sequence: 1,
        canonicalAreaDefinitionId: 'entry',
        canonicalAreaDefinitionVersion: 1,
        overallCommentary: '',
        photoReferences: [{ photoId: 'overview-1', objectPath: 'photos/overview-1.jpg' }],
        components: [{
          id: 'area-entry-instance:component:decorative-item',
          component: 'Decorative Item',
          canonicalComponentDefinitionId: 'decorative-item',
          canonicalComponentDefinitionVersion: 1,
          canonicalAreaComponentRuleId: 'entry:decorative-item',
          canonicalAreaComponentRuleVersion: 1,
          requirementSnapshot: {
            condition: 'hidden',
            cleanliness: 'hidden',
            material: 'optional',
            colour: 'optional',
            type: 'optional',
            quantity: 'optional',
            workingStatus: 'hidden',
            operationalTest: 'not_applicable',
            commentary: 'optional',
            maintenanceEvaluation: false,
            componentPhotoRequired: true,
            exceptionPhotoRequired: false,
            contextPhotoRequired: false,
            minimumPhotos: 2,
            minimumExceptionPhotos: 0,
            comparisonPairRequired: false,
            reasonRequiredIfMissing: true,
          },
          conditionCategory: 'not_applicable',
          cleanlinessCategory: 'not_applicable',
          workingStatus: 'not_applicable',
          testStatus: 'not_applicable',
          defects: [],
          maintenanceRequired: false,
          commentary: '',
          photoReferences: [{ photoId: 'component-1', objectPath: 'photos/component-1.jpg' }],
          reviewStatus: 'draft',
          comparisonStatus: 'not_compared',
        }],
      }],
    };

    const qc = evaluateReportQuality(aggregate);
    expect(qc.issues.map((issue) => issue.code)).toContain('COMPONENT_EVIDENCE_REQUIRED');
    expect(qc.issues.map((issue) => issue.code)).not.toContain('CONDITION_UNASSESSED');
    expect(qc.issues.map((issue) => issue.code)).not.toContain('CLEANLINESS_UNASSESSED');
    expect(qc.issues.find((issue) => issue.code === 'COMPONENT_EVIDENCE_REQUIRED')).toMatchObject({
      canonicalAreaDefinitionId: 'entry',
      canonicalComponentDefinitionId: 'decorative-item',
      canonicalAreaComponentRuleId: 'entry:decorative-item',
    });
  });
});
