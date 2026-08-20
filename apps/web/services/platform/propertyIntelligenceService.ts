import type {
  HistoricalExtractedFinding,
  PropertyDocumentAnalysisRecord,
  PropertyRecord,
} from '../../types/platform';
import { apiRequest } from '../apiClient';

export interface HistoricalReviewDecision {
  findingId: string;
  decision: 'confirmed' | 'edited' | 'rejected';
  proposedAreaId?: string;
  proposedComponentId?: string;
  reviewerNote?: string;
}

export async function getHistoricalDocumentAnalysis(
  property: PropertyRecord,
  documentId: string,
): Promise<PropertyDocumentAnalysisRecord | null> {
  return apiRequest<PropertyDocumentAnalysisRecord | null>(
    property.agencyId,
    `/api/v1/properties/${encodeURIComponent(property.id)}/documents/${encodeURIComponent(documentId)}/analysis`,
  );
}

export async function analyseHistoricalDocument(
  property: PropertyRecord,
  documentId: string,
  force = false,
): Promise<PropertyDocumentAnalysisRecord> {
  return apiRequest<PropertyDocumentAnalysisRecord>(
    property.agencyId,
    `/api/v1/properties/${encodeURIComponent(property.id)}/documents/${encodeURIComponent(documentId)}/analyse`,
    {
      method: 'POST',
      body: { expectedPropertyVersion: property.version ?? 1, force },
    },
  );
}

export async function reviewHistoricalDocument(
  property: PropertyRecord,
  documentId: string,
  analysis: Pick<PropertyDocumentAnalysisRecord, 'id' | 'version'>,
  decisions: HistoricalReviewDecision[],
): Promise<PropertyDocumentAnalysisRecord> {
  return apiRequest<PropertyDocumentAnalysisRecord>(
    property.agencyId,
    `/api/v1/properties/${encodeURIComponent(property.id)}/documents/${encodeURIComponent(documentId)}/analysis/${encodeURIComponent(analysis.id)}/review`,
    {
      method: 'POST',
      body: {
        expectedPropertyVersion: property.version ?? 1,
        expectedAnalysisVersion: analysis.version,
        decisions,
      },
    },
  );
}

export async function getPropertyDocumentViewUrl(
  property: PropertyRecord,
  documentId: string,
): Promise<{ url: string; expiresAt: string }> {
  return apiRequest<{ url: string; expiresAt: string }>(
    property.agencyId,
    `/api/v1/properties/${encodeURIComponent(property.id)}/documents/${encodeURIComponent(documentId)}/view`,
  );
}

export function decisionsFromFindings(findings: HistoricalExtractedFinding[]): HistoricalReviewDecision[] {
  return findings
    .filter((finding) => finding.decision !== 'suggested')
    .map((finding) => ({
      findingId: finding.id,
      decision: finding.decision as HistoricalReviewDecision['decision'],
      ...(finding.proposedAreaId ? { proposedAreaId: finding.proposedAreaId } : {}),
      ...(finding.proposedComponentId ? { proposedComponentId: finding.proposedComponentId } : {}),
      ...(finding.reviewerNote ? { reviewerNote: finding.reviewerNote } : {}),
    }));
}
