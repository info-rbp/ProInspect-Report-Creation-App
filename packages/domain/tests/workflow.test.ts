import { describe, expect, it } from 'vitest';
import type { ReportAggregate } from '../src/reportModel.js';
import {
  calculateWorkflowGateContext,
  missingInspectionTransitionGates,
  missingReportTransitionGates,
  transitionInspectionJob,
  transitionReport,
  type WorkflowGateContext,
} from '../src/workflow.js';

const complete: WorkflowGateContext = {
  requiredEvidenceComplete: true,
  requiredComponentsComplete: true,
  templateVersionAssigned: true,
  analysisComplete: true,
  analystApproved: true,
  reviewerApproved: true,
  tenantResponseResolved: true,
  finalPdfCreated: true,
  archiveCreated: true,
};

const reportInput = {
  entityId: 'report-1',
  current: 'draft' as const,
  requested: 'photos_uploaded' as const,
  currentVersion: 1,
  expectedVersion: 1,
  actorId: 'user-1',
  actorRole: 'inspector' as const,
  correlationId: 'correlation-1',
  context: complete,
  occurredAt: '2026-07-20T00:00:00.000Z',
};

const finalisationAggregate = (overrides: Partial<ReportAggregate['report']> = {}): ReportAggregate => ({
  report: {
    id: 'report-final',
    agencyId: 'agency-a',
    reportType: 'Property Condition Report',
    propertyAddress: '1 Test Street',
    lifecycleStatus: 'finalisation_ready',
    currentVersionId: 'version-final',
    ...overrides,
  },
  areas: [
    {
      id: 'entry',
      name: 'Entry',
      sequence: 1,
      components: [
        {
          id: 'front-door',
          component: 'Front Door',
          conditionCategory: 'intact',
          cleanlinessCategory: 'clean',
          workingStatus: 'not_applicable',
          testStatus: 'not_applicable',
          defects: [],
          maintenanceRequired: false,
          commentary: 'Front Door - Painted door, intact.',
          photoReferences: [],
          reviewStatus: 'reviewer_approved',
          comparisonStatus: 'not_compared',
        },
      ],
    },
  ],
});

describe('authoritative workflow transitions', () => {
  it('accepts an allowed report transition and returns an audit event', () => {
    expect(transitionReport(reportInput)).toEqual({
      entityId: 'report-1',
      from: 'draft',
      to: 'photos_uploaded',
      expectedVersion: 1,
      resultingVersion: 2,
      actorId: 'user-1',
      actorRole: 'inspector',
      correlationId: 'correlation-1',
      occurredAt: '2026-07-20T00:00:00.000Z',
    });
  });

  it('rejects stale commands', () => {
    expect(() => transitionReport({ ...reportInput, expectedVersion: 0 })).toThrow('version has changed');
  });

  it('rejects invalid transition jumps', () => {
    expect(() => transitionReport({ ...reportInput, requested: 'archived' })).toThrow('Cannot transition');
  });

  it('enforces evidence and template completion gates', () => {
    expect(() =>
      transitionReport({
        ...reportInput,
        context: { ...complete, requiredEvidenceComplete: false, templateVersionAssigned: false },
      }),
    ).toThrow('requiredEvidenceComplete, templateVersionAssigned');
  });

  it('requires a reason for cancellation and reopening', () => {
    expect(() => transitionReport({ ...reportInput, requested: 'cancelled' })).toThrow('reason is required');
    expect(
      transitionReport({ ...reportInput, requested: 'cancelled', reason: 'Inspection no longer required.' }).reason,
    ).toBe('Inspection no longer required.');
  });

  it('prevents finalisation without a generated PDF', () => {
    expect(() =>
      transitionReport({
        ...reportInput,
        current: 'finalisation_ready',
        requested: 'finalised',
        context: { ...complete, finalPdfCreated: false },
      }),
    ).toThrow('finalPdfCreated');
  });

  it('does not treat an arbitrary job finalPdfUrl as a completed final artifact', () => {
    const evaluation = calculateWorkflowGateContext(finalisationAggregate(), {
      status: 'finalisation_ready',
      finalPdfUrl: 'gs://fake-bucket/fake.pdf',
      tenantResponseRequired: false,
    });
    expect(evaluation.context.finalPdfCreated).toBe(false);
    expect(evaluation.blockers).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PDF_NOT_GENERATED_OR_STALE' })]),
    );
  });

  it('accepts a stored PDF only when its provenance matches the current immutable version', () => {
    const hash = 'a'.repeat(64);
    const evaluation = calculateWorkflowGateContext(
      finalisationAggregate({
        finalPdfReportVersionId: 'version-final',
        finalPdfObjectPath: 'final-report-assets/reports/report-final/version-final/report.pdf',
        finalPdfSha256: hash,
        finalPdfGeneration: '7',
        renderManifestObjectPath: 'final-report-assets/reports/report-final/version-final/report.manifest.json',
        renderManifestSha256: hash,
      }),
      { status: 'finalisation_ready', tenantResponseRequired: false },
    );
    expect(evaluation.context.finalPdfCreated).toBe(true);
  });

  it('rejects a stored PDF bound to a superseded report version', () => {
    const hash = 'b'.repeat(64);
    const evaluation = calculateWorkflowGateContext(
      finalisationAggregate({
        finalPdfReportVersionId: 'version-old',
        finalPdfObjectPath: 'final-report-assets/reports/report-final/version-old/report.pdf',
        finalPdfSha256: hash,
        finalPdfGeneration: '2',
        renderManifestObjectPath: 'final-report-assets/reports/report-final/version-old/report.manifest.json',
        renderManifestSha256: hash,
      }),
      { status: 'finalisation_ready', tenantResponseRequired: false },
    );
    expect(evaluation.context.finalPdfCreated).toBe(false);
  });

  it('applies the same server-authoritative controls to inspection jobs', () => {
    const event = transitionInspectionJob({
      entityId: 'job-1',
      current: 'photos_uploading',
      requested: 'photos_uploaded',
      currentVersion: 4,
      expectedVersion: 4,
      actorId: 'inspector-1',
      actorRole: 'inspector',
      correlationId: 'correlation-2',
      context: complete,
      occurredAt: '2026-07-20T01:00:00.000Z',
    });
    expect(event.resultingVersion).toBe(5);
  });

  it('allows the reviewer approval action without requiring approval to exist beforehand', () => {
    const context = { ...complete, reviewerApproved: false };
    expect(missingInspectionTransitionGates('reviewer_approved', context)).toEqual([]);

    const event = transitionInspectionJob({
      entityId: 'job-review',
      current: 'reviewer_review_in_progress',
      requested: 'reviewer_approved',
      currentVersion: 8,
      expectedVersion: 8,
      actorId: 'reviewer-1',
      actorRole: 'reviewer',
      correlationId: 'correlation-review',
      context,
      occurredAt: '2026-08-09T13:30:00.000Z',
    });

    expect(event.to).toBe('reviewer_approved');
  });

  it('allows report approval after analyst sign-off without a circular reviewer gate', () => {
    const context = { ...complete, reviewerApproved: false };
    expect(missingReportTransitionGates('approved_for_issue', context)).toEqual([]);

    const event = transitionReport({
      entityId: 'report-review',
      current: 'review_required',
      requested: 'approved_for_issue',
      currentVersion: 9,
      expectedVersion: 9,
      actorId: 'reviewer-1',
      actorRole: 'reviewer',
      correlationId: 'correlation-report-review',
      context,
      occurredAt: '2026-08-09T13:31:00.000Z',
    });

    expect(event.to).toBe('approved_for_issue');
  });

  it('reopens an approved report through changes requested before editing', () => {
    const event = transitionReport({
      entityId: 'report-approved',
      current: 'approved_for_issue',
      requested: 'changes_requested',
      currentVersion: 10,
      expectedVersion: 10,
      actorId: 'reviewer-1',
      actorRole: 'reviewer',
      correlationId: 'correlation-changes',
      context: complete,
      reason: 'Correct the Entry wall commentary before issue.',
      occurredAt: '2026-08-09T13:32:00.000Z',
    });

    expect(event.from).toBe('approved_for_issue');
    expect(event.to).toBe('changes_requested');
    expect(event.reason).toBe('Correct the Entry wall commentary before issue.');
  });

  it('still blocks reviewer approval when analyst sign-off is missing', () => {
    const context = { ...complete, analystApproved: false, reviewerApproved: false };
    expect(missingInspectionTransitionGates('reviewer_approved', context)).toEqual(['analystApproved']);
    expect(missingReportTransitionGates('approved_for_issue', context)).toEqual(['analystApproved']);
  });
});
