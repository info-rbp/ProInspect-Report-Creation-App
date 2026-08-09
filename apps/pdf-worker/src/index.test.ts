import { describe, expect, it } from 'vitest';
import {
  buildArchiveManifest,
  buildRenderManifest,
  buildRenderPackage,
  renderReportPdf,
  submitTenantResponse,
  verifyArchiveManifest,
  verifyRenderManifest,
} from './index.js';
import { referencedPhotoIds } from './pdfGenerationService.js';

const renderInput = {
  reportId: 'report-1',
  reportVersionId: 'version-3',
  templateId: 'wa-entry',
  templateVersion: 2,
  approvedAt: '2026-07-20T00:00:00.000Z',
  approvedBy: 'reviewer-1',
  report: {
    propertyAddress: '1 Example Street',
    lifecycleStatus: 'approved_for_issue',
    reportType: 'Property Condition Report',
    agentCompany: 'ProInspect',
    agentName: 'Inspector One',
    inspectionDate: '2026-07-20',
  },
  areas: [
    {
      id: 'entry',
      name: 'Entry',
      overallCommentary: 'Entry presents in recorded condition.',
      photoReferences: [{ photoId: 'photo-1', objectPath: 'inspection-originals/photo-1.jpg' }],
      components: [
        {
          id: 'front-door',
          component: 'Front Door',
          conditionCategory: 'minor_wear',
          cleanlinessCategory: 'clean',
          workingStatus: 'not_applicable',
          commentary: 'Front Door - Painted white timber door, minor marks noted near handle, otherwise intact.',
          photoReferences: [
            { photoId: 'photo-1', objectPath: 'inspection-originals/photo-1.jpg' },
            { photoId: 'photo-2', objectPath: 'inspection-originals/photo-2.heic' },
          ],
        },
      ],
    },
  ],
  assets: [
    {
      photoId: 'photo-1',
      objectPath: 'inspection-originals/photo-1.jpg',
      generation: '1',
      sha256: 'a'.repeat(64),
      contentType: 'image/jpeg',
    },
    {
      photoId: 'photo-2',
      objectPath: 'inspection-originals/photo-2.heic',
      generation: '2',
      sha256: 'c'.repeat(64),
      contentType: 'image/heic',
    },
  ],
};

describe('deterministic report generation', () => {
  it('returns the same render identity for the same approved inputs', () => {
    const first = buildRenderPackage(renderInput, '2026-07-20T01:00:00.000Z');
    const second = buildRenderPackage(
      {
        ...renderInput,
        report: {
          propertyAddress: '1 Example Street',
          lifecycleStatus: 'approved_for_issue',
          reportType: 'Property Condition Report',
          agentCompany: 'ProInspect',
          agentName: 'Inspector One',
          inspectionDate: '2026-07-20',
        },
      },
      '2026-07-21T01:00:00.000Z',
    );
    expect(first.renderId).toBe(second.renderId);
    expect(first.canonicalInputHash).toBe(second.canonicalInputHash);
  });

  it('changes the render identity when approved content changes', () => {
    const first = buildRenderPackage(renderInput);
    const second = buildRenderPackage({
      ...renderInput,
      areas: [{ id: 'entry', name: 'Entry', commentary: 'Changed.', components: [] }],
    });
    expect(first.renderId).not.toBe(second.renderId);
  });

  it('renders a valid PDF without changing approved commentary', async () => {
    const originalCommentary = String(
      (renderInput.areas[0]?.components as Array<Record<string, unknown>>)[0]?.commentary,
    );
    const bytes = await renderReportPdf(renderInput);
    expect(Buffer.from(bytes).subarray(0, 4).toString('ascii')).toBe('%PDF');
    expect(
      String((renderInput.areas[0]?.components as Array<Record<string, unknown>>)[0]?.commentary),
    ).toBe(originalCommentary);
  });

  it('deduplicates area and component evidence IDs', () => {
    expect(referencedPhotoIds(renderInput.areas)).toEqual(['photo-1', 'photo-2']);
  });
});

describe('immutable render manifest', () => {
  it('builds and verifies the PDF render manifest', () => {
    const render = buildRenderPackage(renderInput);
    const manifest = buildRenderManifest({
      render,
      pdf: { objectPath: render.outputObjectPath, generation: '7', sha256: 'b'.repeat(64) },
      assets: renderInput.assets,
      generatedAt: '2026-07-20T01:00:00.000Z',
      generatedBy: 'reviewer-1',
    });
    expect(manifest.immutable).toBe(true);
    expect(verifyRenderManifest(manifest)).toBe(true);
    expect(verifyRenderManifest({ ...manifest, generatedBy: 'someone-else' })).toBe(false);
  });
});

describe('immutable archive manifest', () => {
  it('builds and verifies an integrity-protected final archive manifest', () => {
    const render = buildRenderPackage(renderInput);
    const manifest = buildArchiveManifest({
      render,
      pdf: { objectPath: render.outputObjectPath, generation: '7', sha256: 'b'.repeat(64) },
      assets: renderInput.assets,
      finalisedAt: '2026-07-20T02:00:00.000Z',
      finalisedBy: 'reviewer-1',
    });
    expect(manifest.immutable).toBe(true);
    expect(verifyArchiveManifest(manifest)).toBe(true);
    expect(verifyArchiveManifest({ ...manifest, finalisedBy: 'someone-else' })).toBe(false);
  });
});

describe('tenant responses', () => {
  it('captures attributable version-bound tenant responses', () => {
    const response = submitTenantResponse({
      reportId: 'report-1',
      reportVersionId: 'version-3',
      tenancyId: 'tenancy-1',
      tenantUid: 'tenant-1',
      submittedAt: '2026-07-20T03:00:00.000Z',
      items: [
        {
          componentId: 'front-door',
          response: 'disagree',
          comment: 'Mark was present at entry.',
          photoIds: ['tenant-photo-1'],
        },
      ],
    });
    expect(response.id).toBe(response.contentHash);
  });

  it('requires commentary for disagreements', () => {
    expect(() =>
      submitTenantResponse({
        reportId: 'report-1',
        reportVersionId: 'version-3',
        tenancyId: 'tenancy-1',
        tenantUid: 'tenant-1',
        submittedAt: '2026-07-20T03:00:00.000Z',
        items: [{ componentId: 'front-door', response: 'disagree', photoIds: [] }],
      }),
    ).toThrow('require commentary');
  });
});
