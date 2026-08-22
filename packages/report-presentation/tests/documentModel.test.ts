import { describe, expect, it } from 'vitest';
import { captureBrandingSnapshot, publishBrandingProfile, publishPresentationTemplate, type ReportBrandingProfile } from '../src/index.js';
import { buildReportDocumentModel } from '../src/documentModel.js';
import { presentationTemplateForReportType } from '../src/presets.js';
import { buildReportPresentationViewModel } from '../src/viewModel.js';

function branding() {
  const draft: ReportBrandingProfile = {
    id: 'quality-brand', version: 1, status: 'draft', agencyName: 'Quality Property Services',
    primaryColour: '#1D4ED8', secondaryColour: '#0F172A', accentColour: '#0284C7',
    headingFont: 'Inter', bodyFont: 'Inter', createdAt: '2026-08-22T00:00:00.000Z',
  };
  return captureBrandingSnapshot(publishBrandingProfile(draft, '2026-08-22T00:10:00.000Z'), '2026-08-22T00:20:00.000Z');
}

function view(reportType: string) {
  return buildReportPresentationViewModel({
    reportId: 'report-1', reportVersionId: 'version-1', reportType,
    propertyAddress: '1 Example Street', inspectorName: 'Inspector One', agencyName: 'Quality Property Services',
    areas: [{ id: 'living', name: 'Living Room', components: [{ id: 'ac', component: 'Air Conditioner', conditionCategory: 'repair_required', cleanlinessCategory: 'clean', workingStatus: 'not_working', testStatus: 'tested_failed', maintenanceRequired: true, commentary: 'Unit did not operate during the recorded test.', comparisonStatus: 'deteriorated', comparisonCommentary: 'Current operation differs from baseline.' }] }],
  });
}

describe('shared report document model quality', () => {
  it('produces the same deterministic block sequence for the same approved facts', () => {
    const template = publishPresentationTemplate(presentationTemplateForReportType('Exit Inspection', '2026-08-22T00:00:00.000Z'), '2026-08-22T00:30:00.000Z');
    const first = buildReportDocumentModel({ view: view('Exit Inspection'), template, branding: branding() });
    const second = buildReportDocumentModel({ view: view('Exit Inspection'), template, branding: branding() });
    expect(first).toEqual(second);
    expect(first.blocks.map((block) => block.type)).toContain('summary');
    expect(first.blocks.map((block) => block.type)).toContain('finding-list');
  });

  it('keeps Routine reports exception-first in the shared document model', () => {
    const template = publishPresentationTemplate(presentationTemplateForReportType('Routine Inspection', '2026-08-22T00:00:00.000Z'), '2026-08-22T00:30:00.000Z');
    const document = buildReportDocumentModel({ view: view('Routine Inspection'), template, branding: branding() });
    const areas = document.blocks.filter((block) => block.type === 'area');
    expect(areas).toHaveLength(1);
    expect(areas[0]?.type === 'area' ? areas[0].components.every((component) => component.exception) : false).toBe(true);
  });

  it('never introduces liability conclusions into generated scope text', () => {
    const template = publishPresentationTemplate(presentationTemplateForReportType('Property Condition Report', '2026-08-22T00:00:00.000Z'), '2026-08-22T00:30:00.000Z');
    const document = buildReportDocumentModel({ view: view('Property Condition Report'), template, branding: branding() });
    const scope = document.blocks.find((block) => block.type === 'text');
    expect(scope?.type === 'text' ? scope.body.toLowerCase() : '').not.toContain('tenant caused');
    expect(scope?.type === 'text' ? scope.body.toLowerCase() : '').toContain('does not determine legal liability');
  });
});
