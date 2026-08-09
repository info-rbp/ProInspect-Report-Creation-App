import type { ReportData } from '../../types';
import { apiRequest } from '../apiClient';

export interface PdfJobRecord {
  id: string;
  agencyId: string;
  reportId: string;
  reportVersionId?: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'superseded';
  pdfObjectPath?: string;
  pdfSha256?: string;
  pdfGeneration?: string;
  renderManifestObjectPath?: string;
  renderManifestSha256?: string;
  errorCode?: string;
  errorMessage?: string;
  retryable?: boolean;
  queuedAt?: string;
  startedAt?: string;
  completedAt?: string;
  failedAt?: string;
}

export async function queueFinalPdf(report: ReportData): Promise<PdfJobRecord> {
  if (!report.agencyId) throw new Error('Report agency is required before generating a final PDF.');
  if (!report.currentVersionId) {
    throw new Error('Approve the report to create an immutable report version before generating the final PDF.');
  }

  return apiRequest<PdfJobRecord>(report.agencyId, '/api/v1/pdf-jobs', {
    method: 'POST',
    body: {
      reportId: report.id,
      reportVersionId: report.currentVersionId,
      priority: 'high',
    },
  });
}

export async function getPdfJob(agencyId: string, pdfJobId: string): Promise<PdfJobRecord> {
  return apiRequest<PdfJobRecord>(agencyId, `/api/v1/pdf-jobs/${pdfJobId}`);
}
