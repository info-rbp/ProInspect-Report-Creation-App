import { createAppwriteServerServices, loadAppwriteServerConfig } from '@pcr/appwrite-server';
import { PdfWorkerError, type PdfGenerationTask } from './pdfGenerationService.js';

type Row = Record<string, unknown> & { $id: string; agencyId?: string };
let cached: ReturnType<typeof createAppwriteServerServices> | undefined;
function services() { return cached ??= createAppwriteServerServices(loadAppwriteServerConfig()); }
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function appwriteCode(error: unknown): number | undefined { return error && typeof error === 'object' && 'code' in error ? Number((error as { code?: unknown }).code) : undefined; }
async function row(tableId: string, rowId: string): Promise<Row | undefined> {
  try { return await services().tables.getRow({ databaseId: services().databaseId, tableId, rowId }) as unknown as Row; }
  catch (error) { if (appwriteCode(error) === 404) return undefined; throw error; }
}
async function recordFailure(task: PdfGenerationTask, error: unknown): Promise<void> {
  const workerError = error instanceof PdfWorkerError ? error : undefined;
  if (workerError?.retryable) return;
  const now = new Date().toISOString();
  const data = {
    agencyId: task.agencyId, status: 'failed', taskId: task.taskId, reportId: task.reportId,
    ...(task.reportVersionId ? { reportVersionId: task.reportVersionId } : {}),
    errorCode: workerError?.code ?? 'PDF_PREFLIGHT_FAILED',
    errorMessage: error instanceof Error ? error.message : String(error), retryable: false,
    failedAt: now, createdAt: now, updatedAt: now, createdBy: 'system:pdf-worker', updatedBy: 'system:pdf-worker',
  };
  try {
    const existing = await row('pdf_jobs', task.taskId);
    if (existing && existing.agencyId === task.agencyId) {
      await services().tables.updateRow({ databaseId: services().databaseId, tableId: 'pdf_jobs', rowId: task.taskId, data: { ...data, createdAt: existing.createdAt, createdBy: existing.createdBy } });
    } else if (!existing) {
      await services().tables.createRow({ databaseId: services().databaseId, tableId: 'pdf_jobs', rowId: task.taskId, permissions: [], data });
    }
  } catch { /* preserve original permanent preflight error */ }
}

export async function assertPdfTaskReady(task: PdfGenerationTask): Promise<void> {
  try {
    const report = await row('reports', task.reportId);
    if (!report || report.agencyId !== task.agencyId) throw new PdfWorkerError('REPORT_NOT_FOUND', 'Report not found.');
    const lifecycle = text(report.lifecycleStatus);
    if (!['finalisation_ready', 'finalised'].includes(lifecycle)) {
      throw new PdfWorkerError('REPORT_NOT_FINALISATION_READY', 'Final PDF generation requires a content-locked finalisation-ready or finalised report.');
    }
    const currentVersionId = text(report.currentVersionId);
    if (!currentVersionId) throw new PdfWorkerError('REPORT_VERSION_REQUIRED', 'A current report version is required before PDF generation.');
    if (task.reportVersionId && task.reportVersionId !== currentVersionId) {
      throw new PdfWorkerError('REPORT_VERSION_SUPERSEDED', 'The requested report version is no longer current.', false, { requestedVersionId: task.reportVersionId, currentVersionId });
    }
    const version = await row('report_versions', currentVersionId);
    if (!version || version.agencyId !== task.agencyId || text(version.reportId) !== task.reportId) throw new PdfWorkerError('REPORT_VERSION_NOT_FOUND', 'The current Appwrite report snapshot does not exist.');
    const aggregate = record(JSON.parse(text(version.snapshot) || '{}'));
    const metadata = record(aggregate.report);
    const template = record(metadata.presentationTemplateSnapshot);
    const branding = record(metadata.brandingSnapshot);
    if (!text(metadata.presentationTemplateId) || !Number(metadata.presentationTemplateVersion) || !text(template.id) || text(template.status) !== 'published') {
      throw new PdfWorkerError('PRESENTATION_NOT_PINNED', 'The report snapshot does not contain a pinned published presentation template.');
    }
    if (!text(metadata.brandingSnapshotHash).match(/^[a-f0-9]{64}$/iu) || !text(branding.profileId)) {
      throw new PdfWorkerError('BRANDING_NOT_PINNED', 'The report snapshot does not contain a pinned immutable branding snapshot.');
    }
  } catch (error) {
    await recordFailure(task, error);
    throw error;
  }
}
