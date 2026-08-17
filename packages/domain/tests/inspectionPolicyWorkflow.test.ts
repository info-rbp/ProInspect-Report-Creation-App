import { describe, expect, it } from 'vitest';
import type { ReportAggregate } from '../src/reportModel.js';
import { calculateWorkflowGateContext } from '../src/workflow.js';
import { inspectionPolicy } from '../src/inspectionPolicy.js';

function component(overrides: Record<string, unknown> = {}) {
  return {
    id: 'walls',
    component: 'Walls',
    conditionCategory: 'intact',
    cleanlinessCategory: 'clean',
    workingStatus: 'not_applicable',
    testStatus: 'not_applicable',
    defects: [],
    maintenanceRequired: false,
    commentary: 'Painted walls observed in satisfactory condition where visible.',
    photoReferences: [],
    reviewStatus: 'draft',
    comparisonStatus: 'not_compared',
    ...overrides,
  } as ReportAggregate['areas'][number]['components'][number];
}

function report(reportType: string, componentOverrides: Record<string, unknown> = {}, reportOverrides: Record<string, unknown> = {}): ReportAggregate {
  return {
    report: {
      id: 'report-1',
      agencyId: 'agency-a',
      reportType,
      propertyAddress: '1 Test Street',
      lifecycleStatus: 'draft',
      templateId: `system-${reportType}`,
      templateVersion: 1,
      ...reportOverrides,
    },
    areas: [
      {
        id: 'bedroom-1',
        name: 'Bedroom 1',
        sequence: 1,
        photoReferences: [{ photoId: 'overview-1', objectPath: 'evidence/overview-1.jpg' }],
        components: [component(componentOverrides)],
      },
    ],
  };
}

describe('inspection type policies', () => {
  it('keeps Entry detailed and Routine exception focused', () => {
    expect(inspectionPolicy('Property Condition Report')).toMatchObject({ detailedBaseline: true, exceptionFocused: false });
    expect(inspectionPolicy('Routine Inspection')).toMatchObject({ detailedBaseline: false, exceptionFocused: true, ordinaryComponentCommentaryRequired: false });
    expect(inspectionPolicy('Exit Inspection')).toMatchObject({ requiresBaseline: true, comparisonRequired: true });
  });

  it('blocks Entry when a component is still unable to confirm', () => {
    const evaluation = calculateWorkflowGateContext(report('Property Condition Report', {
      conditionCategory: 'unable_to_confirm',
      cleanlinessCategory: 'unable_to_confirm',
      commentary: '',
    }));
    expect(evaluation.context.requiredComponentsComplete).toBe(false);
    expect(evaluation.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'COMPONENT_UNASSESSED' }),
      expect.objectContaining({ code: 'COMPONENT_COMMENTARY_REQUIRED' }),
    ]));
  });

  it('allows concise ordinary Routine components without Entry-style commentary', () => {
    const evaluation = calculateWorkflowGateContext(report('Routine Inspection', { commentary: '' }));
    expect(evaluation.context.requiredComponentsComplete).toBe(true);
  });

  it('requires detail and specific evidence for a Routine exception', () => {
    const evaluation = calculateWorkflowGateContext(report('Routine Inspection', {
      conditionCategory: 'repair_required',
      defects: ['Loose hinge'],
      maintenanceRequired: true,
      commentary: '',
      photoReferences: [],
    }));
    expect(evaluation.context.requiredComponentsComplete).toBe(false);
    expect(evaluation.context.requiredEvidenceComplete).toBe(false);
    expect(evaluation.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ROUTINE_EXCEPTION_INCOMPLETE' }),
      expect.objectContaining({ code: 'EVIDENCE_REQUIRED' }),
    ]));
  });

  it('blocks Exit without its immutable Entry baseline', () => {
    const evaluation = calculateWorkflowGateContext(report('Exit Inspection', {
      comparisonStatus: 'unable_to_compare',
      comparisonReviewStatus: 'confirmed',
    }));
    expect(evaluation.context.requiredComponentsComplete).toBe(false);
    expect(evaluation.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ENTRY_BASELINE_REQUIRED' }),
    ]));
  });

  it('requires human review for a material Exit comparison', () => {
    const evaluation = calculateWorkflowGateContext(report('Exit Inspection', {
      baselineComponentData: {
        conditionCategory: 'intact',
        cleanlinessCategory: 'clean',
        workingStatus: 'not_applicable',
        testStatus: 'not_applicable',
        commentary: 'Entry condition.',
        defects: [],
      },
      comparisonStatus: 'material_change',
      comparisonReviewStatus: 'suggested',
    }, {
      baselineReportId: 'entry-report',
      baselineReportVersionId: 'entry-version-1',
    }));
    expect(evaluation.context.requiredComponentsComplete).toBe(false);
    expect(evaluation.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'EXIT_COMPARISON_REVIEW_REQUIRED' }),
    ]));
  });
});
