import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { PdfWorkerError, type PdfGenerationTask } from './pdfGenerationService.js';
import { ensureReportPresentationIdentity } from './reportPresentationPreflight.js';

function adminApp() {
  return getApps()[0] ?? initializeApp({ credential: applicationDefault() });
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function persistPreflightFailure(task: PdfGenerationTask, error: unknown): Promise<void> {
  const workerError = error instanceof PdfWorkerError ? error : undefined;
  if (workerError?.retryable) return;

  const now = new Date().toISOString();
  await getFirestore(adminApp()).doc(`agencies/${task.agencyId}/pdfJobs/${task.taskId}`).set(
    {
      status: 'failed',
      errorCode: workerError?.code ?? 'PDF_PREFLIGHT_FAILED',
      errorMessage: error instanceof Error ? error.message : String(error),
      retryable: false,
      failedAt: now,
      updatedAt: now,
    },
    { merge: true },
  );
}

export async function assertPdfTaskReady(task: PdfGenerationTask): Promise<void> {
  try {
    const snapshot = await getFirestore(adminApp())
      .doc(`agencies/${task.agencyId}/reports/${task.reportId}`)
      .get();
    if (!snapshot.exists) throw new PdfWorkerError('REPORT_NOT_FOUND', 'Report not found.');

    const report = snapshot.data() as Record<string, unknown>;
    if (text(report.agencyId) !== task.agencyId) {
      throw new PdfWorkerError('AGENCY_SCOPE_MISMATCH', 'Report does not belong to the requested agency.');
    }
    if (text(report.lifecycleStatus) !== 'finalisation_ready') {
      throw new PdfWorkerError(
        'REPORT_NOT_FINALISATION_READY',
        'The audited final PDF can only be generated when the report is finalisation ready.',
      );
    }

    const currentVersionId = text(report.currentVersionId);
    if (!currentVersionId) {
      throw new PdfWorkerError(
        'REPORT_VERSION_REQUIRED',
        'An immutable current report version is required before final PDF generation.',
      );
    }
    if (task.reportVersionId && task.reportVersionId !== currentVersionId) {
      throw new PdfWorkerError(
        'REPORT_VERSION_SUPERSEDED',
        'The requested report version is no longer the current immutable version.',
        false,
        { requestedVersionId: task.reportVersionId, currentVersionId },
      );
    }

    // The renderer must never invent current branding or layout at render time.
    // Resolve and persist the exact published layout plus immutable branding
    // snapshot before the approved report is handed to the PDF pipeline.
    await ensureReportPresentationIdentity(task);
  } catch (error) {
    await persistPreflightFailure(task, error);
    throw error;
  }
}
