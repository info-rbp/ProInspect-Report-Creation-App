import { describe, expect, it } from 'vitest';
import { buildArchiveManifest, buildRenderPackage, submitTenantResponse, verifyArchiveManifest } from './index.js';

const renderInput = {
  reportId: 'report-1',
  reportVersionId: 'version-3',
  templateId: 'wa-entry',
  templateVersion: 2,
  approvedAt: '2026-07-20T00:00:00.000Z',
  approvedBy: 'reviewer-1',
  report: { propertyAddress: '1 Example Street', lifecycleStatus: 'approved_for_issue' },
  areas: [{ id: 'entry', commentary: 'Entry commentary.' }],
  assets: [{ photoId: 'photo-1', objectPath: 'inspection-originals/photo-1.jpg', generation: '1', sha256: 'a'.repeat(64) }],
};

describe('deterministic report generation', () => {
  it('returns the same render identity for the same approved inputs', () => {
    const first = buildRenderPackage(renderInput, '2026-07-20T01:00:00.000Z');
    const second = buildRenderPackage({ ...renderInput, report: { lifecycleStatus: 'approved_for_issue', propertyAddress: '1 Example Street' } }, '2026-07-21T01:00:00.000Z');
    expect(first.renderId).toBe(second.renderId);
    expect(first.canonicalInputHash).toBe(second.canonicalInputHash);
  });

  it('changes the render identity when approved content changes', () => {
    const first = buildRenderPackage(renderInput);
    const second = buildRenderPackage({ ...renderInput, areas: [{ id: 'entry', commentary: 'Changed.' }] });
    expect(first.renderId).not.toBe(second.renderId);
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
      items: [{ componentId: 'front-door', response: 'disagree', comment: 'Mark was present at entry.', photoIds: ['tenant-photo-1'] }],
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
