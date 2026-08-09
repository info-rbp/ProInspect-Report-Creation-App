import { describe, expect, it } from 'vitest';
import {
  generateCommentary,
  importCommentaryBank,
  publishTemplate,
  type InspectionTypeTemplate,
  type StructuredInspectionFact,
} from '../src/index.js';

const draft: InspectionTypeTemplate = {
  id: 'wa-entry-pcr',
  version: 1,
  inspectionType: 'entry',
  propertyType: 'residential',
  status: 'draft',
  createdAt: '2026-07-20T00:00:00.000Z',
  areas: [
    {
      id: 'entry',
      name: 'Entry',
      components: [{ id: 'front-door', name: 'Front Door', required: true, photoRequired: true }],
    },
  ],
  commentaryBank: [
    {
      id: 'entry-front-door-minor',
      area: 'Entry',
      component: 'Front Door',
      inspectionTypes: ['entry'],
      condition: 'minor_wear',
      text: '{{details}}',
    },
  ],
};

const fact: StructuredInspectionFact = {
  area: 'Entry',
  component: 'Front Door',
  material: 'wooden',
  colour: 'painted white',
  type: 'door with silver lever handle',
  visibility: 'visible',
  condition: 'minor_wear',
  conditionIssue: 'minor scuff marks around handle area',
  cleanlinessIssue: 'requires light cleaning',
  workingState: 'not_tested',
  photoReferences: ['entry-01.jpg'],
};

describe('template lifecycle', () => {
  it('publishes a valid draft as an immutable version snapshot', () => {
    const published = publishTemplate(draft, '2026-07-20T01:00:00.000Z');
    expect(published.status).toBe('published');
    expect(published.publishedAt).toBe('2026-07-20T01:00:00.000Z');
    expect(published).not.toBe(draft);
  });

  it('rejects publishing a non-draft version', () => {
    expect(() => publishTemplate({ ...draft, status: 'published' })).toThrow('Only draft templates');
  });
});

describe('commentary-bank import', () => {
  it('normalises valid rows and rejects duplicate entries', () => {
    const row = {
      area: ' Entry ',
      component: 'Front Door',
      condition: 'minor_wear',
      inspectionTypes: 'entry',
      text: '{{details}}',
    };
    const result = importCommentaryBank([row, row]);
    expect(result.entries).toHaveLength(1);
    expect(result.issues).toEqual([
      expect.objectContaining({ row: 3, code: 'DUPLICATE' }),
    ]);
  });

  it('reports invalid categories before import', () => {
    const result = importCommentaryBank([
      {
        area: 'Kitchen',
        component: 'Sink/Taps',
        condition: 'excellent',
        inspectionTypes: 'entry',
        text: 'Intact.',
      },
    ]);
    expect(result.entries).toHaveLength(0);
    expect(result.issues[0]?.code).toBe('INVALID_CONDITION');
  });
});

describe('commentary generation safeguards', () => {
  it('generates deterministic evidence-linked commentary', () => {
    const generated = generateCommentary(draft, fact);
    expect(generated).toEqual({
      area: 'Entry',
      component: 'Front Door',
      commentary:
        'Front Door - Painted white wooden door with silver lever handle, minor scuff marks around handle area noted, requires light cleaning noted, operation not confirmed',
      photoReferences: ['entry-01.jpg'],
      bankEntryId: 'entry-front-door-minor',
      generationMethod: 'bank_rule',
      templateId: 'wa-entry-pcr',
      templateVersion: 1,
    });
  });

  describe('5 Manual Verification Test Scenarios', () => {
    const emptyDraft: InspectionTypeTemplate = {
      id: 'test-template',
      version: 1,
      inspectionType: 'entry',
      propertyType: 'residential',
      status: 'draft',
      createdAt: '2026-07-20T00:00:00.000Z',
      areas: [],
      commentaryBank: [],
    };

    it('Test 1 - Entry Front Door: minor wear on timber hinged door', () => {
      const fact1: StructuredInspectionFact = {
        area: 'Entry',
        component: 'Front Door',
        material: 'timber',
        colour: 'white',
        type: 'hinged door with silver lever handle',
        visibility: 'visible',
        condition: 'minor_wear',
        conditionIssue: 'minor scuff marks near handle',
        workingState: 'not_relevant',
        photoReferences: ['p1.jpg'],
      };
      const result = generateCommentary(emptyDraft, fact1);
      expect(result.commentary).toContain('Front Door - White timber hinged door with silver lever handle, minor scuff marks near handle noted, otherwise intact.');
    });

    it('Test 2 - Bathroom Shower Screen: glass with soap residue requires cleaning', () => {
      const fact2: StructuredInspectionFact = {
        area: 'Bathroom',
        component: 'Shower Screen',
        material: 'glass',
        colour: 'clear glass with silver frame',
        visibility: 'visible',
        condition: 'clean_intact',
        cleanlinessIssue: 'soap residue to lower glass and frame',
        workingState: 'not_relevant',
        photoReferences: ['p2.jpg'],
      };
      const result = generateCommentary(emptyDraft, fact2);
      expect(result.commentary).toContain('Shower Screen - Clear glass with silver frame glass, soap residue to lower glass and frame noted, otherwise intact.');
    });

    it('Test 3 - Light Fitting Untested: must not claim working without testing', () => {
      const fact3: StructuredInspectionFact = {
        area: 'Bedroom',
        component: 'Light Fitting',
        type: 'recessed downlight',
        visibility: 'visible',
        condition: 'clean_intact',
        workingState: 'not_tested',
        photoReferences: ['p3.jpg'],
      };
      const result = generateCommentary(emptyDraft, fact3);
      expect(result.commentary).not.toContain('tested and working');
      expect(result.commentary).not.toContain('working condition');
      expect(result.commentary).toContain('operation not confirmed');
    });

    it('Test 4 - Wall Requires Repair: must not include otherwise intact', () => {
      const fact4: StructuredInspectionFact = {
        area: 'Bedroom',
        component: 'Walls',
        material: 'painted plaster',
        colour: 'white',
        visibility: 'visible',
        condition: 'repair_required',
        conditionIssue: 'hole to lower wall near doorway',
        workingState: 'not_relevant',
        photoReferences: ['p4.jpg'],
      };
      const result = generateCommentary(emptyDraft, fact4);
      expect(result.commentary).not.toContain('otherwise intact');
      expect(result.commentary).toContain('hole to lower wall near doorway noted');
    });

    it('Test 5 - Not Visible: Dishwasher missing photo / hidden', () => {
      const fact5: StructuredInspectionFact = {
        area: 'Kitchen',
        component: 'Dishwasher',
        visibility: 'not_visible',
        condition: 'unable_to_confirm',
        workingState: 'not_tested',
        photoReferences: [],
      };
      const result = generateCommentary(emptyDraft, fact5);
      expect(result.commentary).toBe('Dishwasher - Not visible in photos, condition unable to be confirmed.');
    });
  });

  it('does not claim operation without recorded testing', () => {
    expect(() =>
      generateCommentary(
        {
          ...draft,
          commentaryBank: [
            {
              id: 'unsafe',
              area: 'Entry',
              component: 'Front Door',
              inspectionTypes: ['entry'],
              condition: 'minor_wear',
              text: 'operational and {{details}}',
            },
          ],
        },
        fact,
      ),
    ).toThrow('Working-status claims require recorded operational testing.');
  });

  it('uses explicit missing-photo wording', () => {
    const generated = generateCommentary(draft, {
      ...fact,
      visibility: 'not_visible',
      photoReferences: [],
    });
    expect(generated.commentary).toBe('Front Door - Not visible in photos, condition unable to be confirmed.');
  });

  it('rejects otherwise-intact wording for repair-required items', () => {
    expect(() =>
      generateCommentary(
        {
          ...draft,
          commentaryBank: [
            {
              id: 'bad-bank',
              area: 'Entry',
              component: 'Front Door',
              inspectionTypes: ['entry'],
              condition: 'repair_required',
              text: '{{details}}, otherwise intact',
            },
          ],
        },
        { ...fact, condition: 'repair_required', conditionIssue: 'lower hinge detached' },
      ),
    ).toThrow('Otherwise intact cannot be used');
  });
});
