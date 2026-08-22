import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { buildRenderPackage, renderReportPdf } from './index.js';
import type { RenderInput } from './renderer.js';

function input(componentCount = 4): RenderInput {
  return {
    reportId: 'quality-report',
    reportVersionId: 'version-1',
    templateId: 'wa-entry',
    templateVersion: 1,
    approvedAt: '2026-08-22T00:00:00.000Z',
    approvedBy: 'reviewer-1',
    report: {
      reportType: 'Property Condition Report',
      propertyAddress: '123 Very Long Example Boulevard, Example Suburb WA 6000',
      inspectionDate: '2026-08-22',
      agentCompany: 'ProInspect',
      agentName: 'Inspector One',
      clientName: 'Example Client',
    },
    areas: [{
      id: 'living',
      name: 'Living Room',
      overallCommentary: 'Area inspected with approved structured observations.',
      photoReferences: [],
      components: Array.from({ length: componentCount }, (_, index) => ({
        id: `component-${index + 1}`,
        component: `Component ${index + 1}`,
        conditionCategory: index % 7 === 0 ? 'repair_required' : 'intact',
        cleanlinessCategory: 'clean',
        workingStatus: 'not_applicable',
        testStatus: 'not_applicable',
        defects: index % 7 === 0 ? ['Visible exception requiring review'] : [],
        maintenanceRequired: index % 7 === 0,
        commentary: `Recorded approved observation ${index + 1}. `.repeat(index % 5 === 0 ? 12 : 2),
        photoReferences: [],
      })),
    }],
    assets: [],
  };
}

describe('production PDF presentation quality gates', () => {
  it('changes immutable render identity when renderer version changes', () => {
    const source = input();
    const first = buildRenderPackage({ ...source, rendererVersion: 'renderer-a' });
    const second = buildRenderPackage({ ...source, rendererVersion: 'renderer-b' });
    expect(first.renderId).not.toBe(second.renderId);
    expect(first.canonicalInputHash).not.toBe(second.canonicalInputHash);
  });

  it('changes immutable render identity when presentation template changes', () => {
    const source = input();
    const first = buildRenderPackage({ ...source, presentationTemplateId: 'presentation-a', presentationTemplateVersion: 1 });
    const second = buildRenderPackage({ ...source, presentationTemplateId: 'presentation-a', presentationTemplateVersion: 2 });
    expect(first.renderId).not.toBe(second.renderId);
  });

  it('renders long reports without losing PDF validity', async () => {
    const bytes = await renderReportPdf(input(140));
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(3);
    expect(Buffer.from(bytes).subarray(0, 4).toString('ascii')).toBe('%PDF');
  });

  it('keeps short reports compact', async () => {
    const bytes = await renderReportPdf(input(2));
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(2);
    expect(pdf.getPageCount()).toBeLessThan(12);
  });
});
