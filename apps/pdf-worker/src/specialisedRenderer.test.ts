import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { renderReportPdf, type RenderInput } from './renderer.js';

function component(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `component-${index}`,
    component: `Component ${index}`,
    conditionCategory: 'intact',
    cleanlinessCategory: 'clean',
    workingStatus: 'untested',
    testStatus: 'untested',
    defects: [],
    maintenanceRequired: false,
    commentary: 'No material issue observed at the time of inspection.',
    photoReferences: [],
    ...overrides,
  };
}

function input(reportType: string, tenantResponses: Array<Record<string, unknown>> = []): RenderInput {
  return {
    reportId: 'report-1',
    reportVersionId: 'version-1',
    templateId: 'template-1',
    templateVersion: 1,
    approvedAt: '2026-08-17T10:00:00.000Z',
    approvedBy: 'reviewer-1',
    report: { reportType, propertyAddress: '1 Test Street', inspectionDate: '2026-08-17', agentCompany: 'ProInspect', agentName: 'Reviewer' },
    areas: [{
      id: 'living',
      name: 'Living Room',
      overallCommentary: 'Area inspected. Exceptions are recorded below where applicable.',
      photoReferences: [],
      components: [
        ...Array.from({ length: 28 }, (_, index) => component(index + 1)),
        component(29, { conditionCategory: 'repair_required', defects: ['Visible damage'], maintenanceRequired: true, commentary: 'Visible damage noted to this component.' }),
      ],
    }],
    assets: [],
    tenantResponses,
  };
}

async function pages(renderInput: RenderInput): Promise<number> {
  const bytes = await renderReportPdf(renderInput);
  return (await PDFDocument.load(bytes)).getPageCount();
}

describe('specialised PDF presentation', () => {
  it('renders Routine reports exception-first while retaining the same structured input', async () => {
    const routinePages = await pages(input('Routine Inspection'));
    const entryPages = await pages(input('Property Condition Report'));
    expect(routinePages).toBeLessThan(entryPages);
    expect(routinePages).toBeGreaterThanOrEqual(2);
  });

  it('renders tenant responses as a separate append-only section', async () => {
    const withoutResponse = await pages(input('Property Condition Report'));
    const withResponse = await pages(input('Property Condition Report', [{
      id: 'tenant-response-1',
      respondentName: 'Tenant One',
      submittedAt: '2026-08-18T10:00:00.000Z',
      status: 'submitted',
      tenantResponseNote: 'Tenant records an additional observation for review.',
      tenantEvidenceIds: ['tenant-photo-1'],
    }]));
    expect(withResponse).toBeGreaterThan(withoutResponse);
  });
});
