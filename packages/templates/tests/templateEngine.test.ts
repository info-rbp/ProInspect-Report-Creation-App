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
        'Front Door - wooden painted white door with silver lever handle, minor scuff marks around handle area, requires light cleaning, operation not confirmed from photos, otherwise intact.',
      photoReferences: ['entry-01.jpg'],
      bankEntryId: 'entry-front-door-minor',
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
