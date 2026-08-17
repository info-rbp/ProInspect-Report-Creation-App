import { describe, expect, it } from 'vitest';
import type { ReportAggregate } from '../src/reportModel.js';
import {
  calculateWorkflowGateContext,
  missingReportTransitionGates,
  transitionReport,
} from '../src/workflow.js';

const hash = 'a'.repeat(64);

function finalisedReport(overrides: Partial<ReportAggregate['report']> = {}): ReportAggregate {
  return {
    report: {
      id: 'report-archive',
      agencyId: 'agency-a',
      reportType: 'Property Condition Report',
      propertyAddress: '1 Archive Street',
      lifecycleStatus: 'finalised',
      currentVersionId: 'version-current',
      templateId: 'entry-default',
      templateVersion: 1,
      finalPdfReportVersionId: 'version-current',
      finalPdfObjectPath: 'final-report-assets/reports/report-archive/version-current/report.pdf',
      finalPdfGeneration: '7',
      finalPdfSha256: hash,
      renderManifestObjectPath: 'final-report-assets/reports/report-archive/version-current/report.manifest.json',
      renderManifestSha256: hash,
      finalisedAt: '2026-08-17T00:00:00.000Z',
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
  };
}

describe('immutable report archive workflow', () => {
  it('does not allow a finalised report to archive before an archive artifact exists', () => {
    const evaluation = calculateWorkflowGateContext(finalisedReport(), {
      status: 'finalised',
      tenantResponseRequired: false,
    });
    expect(evaluation.context.finalPdfCreated).toBe(true);
    expect(evaluation.context.archiveCreated).toBe(false);
    expect(missingReportTransitionGates('archived', evaluation.context)).toEqual(['archiveCreated']);
    expect(evaluation.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ARCHIVE_NOT_CREATED_OR_STALE' }),
    ]));
  });

  it('does not accept archive path and hash without the exact immutable version binding', () => {
    const evaluation = calculateWorkflowGateContext(finalisedReport({
      archiveManifestObjectPath: 'final-report-assets/reports/report-archive/version-current/archive/archive.manifest.json',
      archiveManifestSha256: hash,
      archiveCreatedAt: '2026-08-17T00:05:00.000Z',
    }));
    expect(evaluation.context.archiveCreated).toBe(false);
  });

  it('rejects an archive artifact bound to a superseded report version', () => {
    const evaluation = calculateWorkflowGateContext(finalisedReport({
      archiveReportVersionId: 'version-old',
      archiveManifestObjectPath: 'final-report-assets/reports/report-archive/version-old/archive/archive.manifest.json',
      archiveManifestSha256: hash,
      archiveCreatedAt: '2026-08-17T00:05:00.000Z',
    }));
    expect(evaluation.context.archiveCreated).toBe(false);
  });

  it('accepts an archive artifact only when it is cryptographically identified and version bound', () => {
    const evaluation = calculateWorkflowGateContext(finalisedReport({
      archiveReportVersionId: 'version-current',
      archiveManifestObjectPath: 'final-report-assets/reports/report-archive/version-current/archive/archive.manifest.json',
      archiveManifestSha256: hash,
      archiveCreatedAt: '2026-08-17T00:05:00.000Z',
    }));
    expect(evaluation.context.archiveCreated).toBe(true);
    expect(missingReportTransitionGates('archived', evaluation.context)).toEqual([]);
  });

  it('permits the canonical finalised to archived transition after the archive gate is satisfied', () => {
    const context = calculateWorkflowGateContext(finalisedReport({
      archiveReportVersionId: 'version-current',
      archiveManifestObjectPath: 'final-report-assets/reports/report-archive/version-current/archive/archive.manifest.json',
      archiveManifestSha256: hash,
      archiveCreatedAt: '2026-08-17T00:05:00.000Z',
    })).context;
    const event = transitionReport({
      entityId: 'report-archive',
      current: 'finalised',
      requested: 'archived',
      currentVersion: 11,
      expectedVersion: 11,
      actorId: 'admin-1',
      actorRole: 'proinspect_admin',
      correlationId: 'archive-test',
      context,
      occurredAt: '2026-08-17T00:06:00.000Z',
    });
    expect(event.to).toBe('archived');
    expect(event.resultingVersion).toBe(12);
  });

  it('still blocks finalisation when a PDF is bound to an older report version', () => {
    const evaluation = calculateWorkflowGateContext(finalisedReport({
      lifecycleStatus: 'finalisation_ready',
      finalPdfReportVersionId: 'version-old',
    }));
    expect(evaluation.context.finalPdfCreated).toBe(false);
    expect(missingReportTransitionGates('finalised', evaluation.context)).toEqual(['finalPdfCreated']);
  });
});
