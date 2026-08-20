import { describe, expect, it } from 'vitest';
import { normaliseHistoricalExtraction } from '../src/services/propertyDocumentIntelligenceService.js';

const configuredAreas = [
  { id: 'area-kitchen', name: 'Kitchen', roomType: 'kitchen' as const, floorLevel: 'Ground Floor' },
  { id: 'area-bedroom-1', name: 'Bedroom 1', roomType: 'bedroom' as const, floorLevel: 'Ground Floor' },
];

describe('historical property document extraction', () => {
  it('keeps only valid property and canonical component mappings', () => {
    const result = normaliseHistoricalExtraction({
      detectedReportType: 'Property Condition Report',
      detectedInspectionDate: '2025-01-10',
      summary: 'Historical entry report.',
      findings: [
        {
          sourceArea: 'Kitchen',
          sourceComponent: 'Sink',
          sourceCommentary: 'Stainless steel sink clean and intact.',
          proposedAreaId: 'area-kitchen',
          proposedComponentId: 'sink-taps-spout',
          confidence: 0.94,
        },
        {
          sourceArea: 'Mystery Room',
          sourceComponent: 'Imaginary Component',
          sourceCommentary: 'Recorded in the source.',
          proposedAreaId: 'area-does-not-exist',
          proposedComponentId: 'component-does-not-exist',
          confidence: 0.65,
        },
      ],
    }, configuredAreas);

    expect(result.detectedInspectionDate).toBe('2025-01-10');
    expect(result.findings).toHaveLength(2);
    expect(result.findings[0].proposedAreaId).toBe('area-kitchen');
    expect(result.findings[0].proposedComponentId).toBe('sink-taps-spout');
    expect(result.findings[0].decision).toBe('suggested');
    expect(result.findings[1].proposedAreaId).toBeUndefined();
    expect(result.findings[1].proposedComponentId).toBeUndefined();
    expect(result.findings[1].uncertainty).toContain('Low-confidence');
  });

  it('removes liability language and de-duplicates repeated findings', () => {
    const result = normaliseHistoricalExtraction({
      summary: 'Tenant damage was alleged in a historical report.',
      findings: [
        {
          sourceArea: 'Bedroom 1',
          sourceComponent: 'Walls',
          sourceCommentary: 'Tenant damage to wall near doorway.',
          proposedAreaId: 'area-bedroom-1',
          proposedComponentId: 'walls',
          confidence: 1.4,
          sourcePage: 7,
        },
        {
          sourceArea: 'Bedroom 1',
          sourceComponent: 'Walls',
          sourceCommentary: 'Tenant damage to wall near doorway.',
          proposedAreaId: 'area-bedroom-1',
          proposedComponentId: 'walls',
          confidence: 0.8,
        },
      ],
    }, configuredAreas);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].sourceCommentary).toContain('[liability statement omitted]');
    expect(result.findings[0].sourceCommentary.toLowerCase()).not.toContain('tenant damage');
    expect(result.findings[0].confidence).toBe(1);
    expect(result.findings[0].sourcePage).toBe(7);
    expect(result.summary.toLowerCase()).not.toContain('tenant damage');
  });

  it('rejects malformed dates and empty findings without inventing content', () => {
    const result = normaliseHistoricalExtraction({
      detectedInspectionDate: '10/01/2025',
      summary: '',
      findings: [
        {
          sourceArea: 'Kitchen',
          sourceComponent: 'Oven',
          sourceCommentary: '',
          confidence: 0.9,
        },
      ],
    }, configuredAreas);

    expect(result.detectedInspectionDate).toBeUndefined();
    expect(result.findings).toEqual([]);
    expect(result.summary).toContain('0 review candidate');
  });
});
