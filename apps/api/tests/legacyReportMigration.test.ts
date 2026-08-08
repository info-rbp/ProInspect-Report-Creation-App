import { describe, expect, it } from 'vitest';
import { planLegacyReportMigration } from '../src/migrations/legacyReport.js';

describe('legacy report migration planner', () => {
  it('decomposes legacy rooms and components without embedding binary data', () => {
    const plan = planLegacyReportMigration('legacy-1', {
      id: 'report-1',
      agencyId: 'agency-a',
      propertyAddress: '1 Test Street',
      reportType: 'Property Condition Report',
      rooms: [{
        id: 'entry',
        name: 'Entry',
        status: 'complete',
        overallComment: 'Generally intact.',
        photos: [
          { id: 'photo-1', objectPath: 'agencies/agency-a/photos/photo-1.jpg' },
          { id: 'photo-inline', downloadUrl: 'data:image/jpeg;base64,abc' },
        ],
        items: [{ id: 'front-door', name: 'Front Door', isClean: true, isUndamaged: false, isWorking: false, comment: 'Minor chips noted.' }],
      }],
    });

    expect(plan.destinationPath).toBe('agencies/agency-a/reports/report-1');
    expect(plan.counts).toEqual({ areas: 1, components: 1, photoReferences: 1 });
    expect(plan.aggregate.report).not.toHaveProperty('rooms');
    expect(plan.aggregate.areas[0]?.components[0]).toMatchObject({
      component: 'Front Door',
      conditionCategory: 'repair_required',
      photoReferences: [{ photoId: 'photo-1', objectPath: 'agencies/agency-a/photos/photo-1.jpg' }],
    });
    expect(JSON.stringify(plan.aggregate)).not.toContain('base64');
    expect(plan.warnings).toHaveLength(1);
  });

  it('requires agency ownership before producing a migration plan', () => {
    expect(() => planLegacyReportMigration('legacy-1', { rooms: [] })).toThrow('Legacy report has no agencyId.');
  });
});
