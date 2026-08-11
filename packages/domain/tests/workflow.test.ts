import { describe, expect, it } from 'vitest';
import { transitionInspectionJob, transitionReport, type WorkflowGateContext } from '../src/workflow.js';

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
});
