import { describe, expect, it } from 'vitest';
import { buildReportPresentationViewModel } from '../src/viewModel.js';

describe('report presentation view model', () => {
  it('derives deterministic summary and exception views from approved facts', () => {
    const view = buildReportPresentationViewModel({
      reportId: 'report-1', reportVersionId: 'version-1', reportType: 'Routine Inspection', propertyAddress: '1 Example Street',
      areas: [{ id: 'living', name: 'Living Room', components: [
        { id: 'wall', component: 'Wall', conditionCategory: 'intact', cleanlinessCategory: 'clean', workingStatus: 'not_applicable', testStatus: 'not_applicable', commentary: 'No issue observed.', photoReferences: [{ photoId: 'photo-2', sequence: 2 }, { photoId: 'photo-1', sequence: 1 }] },
        { id: 'ac', component: 'Air Conditioner', conditionCategory: 'repair_required', cleanlinessCategory: 'clean', workingStatus: 'not_working', testStatus: 'tested_failed', maintenanceRequired: true, commentary: 'Unit did not operate during recorded test.' },
      ] }],
    });
    expect(view.isRoutine).toBe(true);
    expect(view.summary.componentCount).toBe(2);
    expect(view.summary.exceptionCount).toBe(1);
    expect(view.summary.maintenanceCount).toBe(1);
    expect(view.maintenanceFindings).toHaveLength(1);
    expect(view.areas[0]?.components[0]?.photos.map((photo) => photo.photoId)).toEqual(['photo-1', 'photo-2']);
  });

  it('does not turn missing assessment fields into confirmed exceptions', () => {
    const view = buildReportPresentationViewModel({
      reportId: 'report-unassessed',
      reportType: 'Property Condition Report',
      propertyAddress: '2 Example Street',
      areas: [{
        id: 'kitchen',
        name: 'Kitchen',
        components: Array.from({ length: 12 }, (_, index) => ({ id: `component-${index + 1}`, component: `Component ${index + 1}` })),
      }],
    });

    expect(view.summary.componentCount).toBe(12);
    expect(view.summary.exceptionCount).toBe(0);
    expect(view.summary.conditionExceptionCount).toBe(0);
    expect(view.summary.cleaningExceptionCount).toBe(0);
    expect(view.summary.operationalExceptionCount).toBe(0);
    expect(view.summary.unableToConfirmCount).toBe(0);
    expect(view.areas[0]?.components[0]).toMatchObject({
      condition: 'unassessed',
      cleanliness: 'unassessed',
      working: 'unassessed',
      test: 'unassessed',
      exception: false,
    });
  });

  it('still counts an explicit unable-to-confirm assessment as an exception', () => {
    const view = buildReportPresentationViewModel({
      reportId: 'report-unable',
      reportType: 'Routine Inspection',
      propertyAddress: '3 Example Street',
      areas: [{ id: 'external', name: 'External', components: [{ id: 'roof', component: 'Roof', conditionCategory: 'unable_to_confirm' }] }],
    });

    expect(view.summary.exceptionCount).toBe(1);
    expect(view.summary.conditionExceptionCount).toBe(1);
    expect(view.summary.unableToConfirmCount).toBe(1);
  });
});
