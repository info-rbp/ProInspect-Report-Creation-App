import type { ReportLifecycleStatus } from '../../types/platform';
import { apiRequest } from '../apiClient';

export interface ReportWorkflowRecord {
  id: string;
  agencyId?: string;
  lifecycleStatus: ReportLifecycleStatus;
  version: number;
  currentVersionId?: string;
  finalPdfReportVersionId?: string;
  finalPdfObjectPath?: string;
  finalPdfSha256?: string;
  finalPdfGeneration?: string;
  renderManifestObjectPath?: string;
  renderManifestSha256?: string;
  pdfGeneratedAt?: string;
  archiveReportVersionId?: string;
  archiveManifestObjectPath?: string;
  archiveManifestSha256?: string;
  archiveCreatedAt?: string;
  finalisedAt?: string;
  archivedAt?: string;
}

export async function getReportWorkflowRecord(
  agencyId: string,
  reportId: string,
): Promise<ReportWorkflowRecord> {
  return apiRequest<ReportWorkflowRecord>(
    agencyId,
    `/api/v1/reports/${encodeURIComponent(reportId)}`,
  );
}

export async function transitionReportLifecycle(
  agencyId: string,
  reportId: string,
  status: ReportLifecycleStatus,
  expectedVersion: number,
  reason?: string,
): Promise<ReportWorkflowRecord> {
  return apiRequest<ReportWorkflowRecord>(
    agencyId,
    `/api/v1/report-actions/${encodeURIComponent(reportId)}/lifecycle/transition`,
    {
      method: 'POST',
      body: {
        status,
        expectedVersion,
        ...(reason?.trim() ? { reason: reason.trim() } : {}),
      },
    },
  );
}
