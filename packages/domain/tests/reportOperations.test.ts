import { describe, expect, it } from 'vitest';
import type { ReportAggregate } from '../src/reportModel.js';
import { evaluateReportQuality, reportLifecycleGroup } from '../src/reportOperations.js';

function completeEntryAggregate(): ReportAggregate {
  return {
    report: {
      id: 'report-entry-1',
      agencyId: 'agency-a',
      propertyId: 'property-a',
      tenancyId: 'tenancy-a',
      inspectionJobId: 'job-a',
      propertyLayoutVersionId: 'layout-v2',
      reportType: 'Property Condition Report',
      propertyAddress: '1 Example Street, Perth WA 6000',
      lifecycleStatus: 'internal_review',
      templateId: 'template-entry',
      templateVersion: 4,
    },
    areas: [
      {
        id: 'living',
        name: 'Living Room',
        sequence: 1,
        photoReferences: [{ photoId: 'overview-1', objectPath: 'photos/overview-1.jpg' }],
        components: [
          {
            id: 'walls',
            component: 'Walls',
            conditionCategory: 'intact',
            cleanlinessCategory: 'clean',
            workingStatus: 'not_applicable',
            testStatus: 'not_applicable',
            defects: [],
            maintenanceRequired: false,
            commentary: 'Painted walls are intact and clean at the time of inspection.',
            photoReferences: [],
            reviewStatus: 'analyst_reviewed',
            comparisonStatus: 'not_compared',
          },
          {
            id: 'light',
            component: 'Ceiling Light',
            conditionCategory: 'intact',
            cleanlinessCategory: 'clean',
            workingStatus: 'operation_confirmed',
            testStatus: 'tested_passed',
            testRecord: {
              status: 'tested',
              method: 'Wall-switch operation test',
              result: 'passed',
              testedBy: 'inspector-1',
              testedAt: '2026-08-21T02:00:00.000Z',
              evidencePhotoIds: ['light-evidence-1'],
            },
            defects: [],
            maintenanceRequired: false,
            commentary: 'Ceiling light is intact, clean and operation was confirmed by wall-switch test.',
            photoReferences: [{ photoId: 'light-evidence-1', objectPath: 'photos/light-evidence-1.jpg' }],
            reviewStatus: 'analyst_reviewed',
            comparisonStatus: 'not_compared',
          },
        ],
      },
    ],
  };
}

describe('report quality control', () => {
  it('passes a fully linked Entry report with evidence and valid operational testing', () => {
    const result = evaluateReportQuality(completeEntryAggregate());
    expect(result.status).toBe('pass');
    expect(result.blockerCount).toBe(0);
    expect(result.errorCount).toBe(0);
  });

  it('blocks operation-confirmed claims that are not supported by a passed test', () => {
    const aggregate = completeEntryAggregate();
    const light = aggregate.areas[0].components[1];
    light.testStatus = 'untested';
    light.testRecord = { status: 'not_tested', notes: 'No safe test performed.' };

    const result = evaluateReportQuality(aggregate);
    expect(result.status).toBe('blocked');
    expect(result.issues.some((issue) => issue.code === 'OPERATION_CONFIRMATION_REQUIRES_TEST')).toBe(true);
  });

  it('requires test method and provenance when a passed test is recorded', () => {
    const aggregate = completeEntryAggregate();
    const light = aggregate.areas[0].components[1];
    light.testRecord = { status: 'tested', result: 'passed' };

    const result = evaluateReportQuality(aggregate);
    expect(result.issues.some((issue) => issue.code === 'TEST_METHOD_REQUIRED')).toBe(true);
    expect(result.issues.some((issue) => issue.code === 'TEST_PROVENANCE_REQUIRED')).toBe(true);
    expect(result.status).toBe('blocked');
  });

  it('detects replacement recommendations that are not routed to maintenance', () => {
    const aggregate = completeEntryAggregate();
    const walls = aggregate.areas[0].components[0];
    walls.conditionCategory = 'replacement_recommended';
    walls.defects = ['Large impact damage'];
    walls.maintenanceRequired = false;
    walls.commentary = 'Large impact damage observed. Replacement recommended.';
    walls.photoReferences = [{ photoId: 'walls-defect', objectPath: 'photos/walls-defect.jpg' }];

    const result = evaluateReportQuality(aggregate);
    expect(result.issues.some((issue) => issue.code === 'REPLACEMENT_WITHOUT_MAINTENANCE')).toBe(true);
    expect(result.status).toBe('blocked');
  });

  it('requires an immutable baseline and reviewed comparisons for Exit reports', () => {
    const aggregate = completeEntryAggregate();
    aggregate.report.id = 'report-exit-1';
    aggregate.report.reportType = 'Exit Inspection';
    aggregate.report.baselineReportId = undefined;
    aggregate.report.baselineReportVersionId = undefined;
    for (const component of aggregate.areas[0].components) {
      component.comparisonStatus = 'deteriorated';
      component.comparisonReviewStatus = 'suggested';
    }

    const result = evaluateReportQuality(aggregate);
    expect(result.issues.some((issue) => issue.code === 'BASELINE_VERSION_REQUIRED')).toBe(true);
    expect(result.issues.some((issue) => issue.code === 'COMPARISON_HUMAN_REVIEW_REQUIRED')).toBe(true);
    expect(result.status).toBe('blocked');
  });

  it('warns rather than overwrites authority when low-confidence AI work remains for review', () => {
    const aggregate = completeEntryAggregate();
    aggregate.areas[0].components[0].reviewStatus = 'ai_generated';
    aggregate.areas[0].components[0].aiConfidence = 0.42;

    const result = evaluateReportQuality(aggregate);
    expect(result.status).toBe('warnings');
    expect(result.issues.some((issue) => issue.code === 'LOW_AI_CONFIDENCE_REVIEW_REQUIRED')).toBe(true);
  });
});

describe('report register lifecycle grouping', () => {
  it('groups authoritative lifecycle states for operational views', () => {
    expect(reportLifecycleGroup('draft')).toBe('draft');
    expect(reportLifecycleGroup('analysis_running')).toBe('analysis');
    expect(reportLifecycleGroup('review_required')).toBe('review');
    expect(reportLifecycleGroup('changes_requested')).toBe('changes_requested');
    expect(reportLifecycleGroup('approved_for_issue')).toBe('ready_to_issue');
    expect(reportLifecycleGroup('tenant_submitted')).toBe('tenant_response');
    expect(reportLifecycleGroup('finalisation_ready')).toBe('finalisation');
    expect(reportLifecycleGroup('archived')).toBe('archived');
    expect(reportLifecycleGroup('cancelled')).toBe('cancelled');
  });
});
