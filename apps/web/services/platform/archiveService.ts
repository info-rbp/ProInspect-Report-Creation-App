import { apiRequest } from '../apiClient';

export interface ArchiveArtifactResult {
  reportId: string;
  reportVersionId: string;
  objectPath: string;
  sha256: string;
  createdAt: string;
  alreadyExists: boolean;
  /** Current optimistic report metadata version after archive metadata is persisted. */
  reportVersion: number;
}

export interface ArchiveReportResult {
  artifact: ArchiveArtifactResult;
  archivedReport: Record<string, unknown>;
}

/**
 * Archiving is deliberately two-stage. First create the immutable version-bound
 * archive manifest. Only after that succeeds may the canonical report workflow
 * transition from finalised to archived.
 */
export async function archiveFinalisedReport(
  agencyId: string,
  reportId: string,
  expectedVersion: number,
): Promise<ArchiveReportResult> {
  const artifact = await apiRequest<ArchiveArtifactResult>(
    agencyId,
    `/api/v1/reports/${encodeURIComponent(reportId)}/archive-artifact`,
    {
      method: 'POST',
      body: { expectedVersion },
    },
  );

  const archivedReport = await apiRequest<Record<string, unknown>>(
    agencyId,
    `/api/v1/reports/${encodeURIComponent(reportId)}/transitions`,
    {
      method: 'POST',
      body: {
        status: 'archived',
        expectedVersion: artifact.reportVersion,
      },
    },
  );

  return { artifact, archivedReport };
}
