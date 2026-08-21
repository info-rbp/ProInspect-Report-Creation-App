import type {
  ReportAcknowledgement,
  ReportAggregate,
  ReportDistribution,
  ReportDistributionRecipientRole,
  ReportQcResult,
  ReportRecipientResponse,
  ReportReviewComment,
} from '@pcr/domain';
import type { InspectionJob } from '../../types/platform';
import { apiRequest } from '../apiClient';

export interface ReportWorkflowEvaluation {
  context: Record<string, boolean>;
  blockers: Array<{ gate: string; code: string; message: string; field?: string }>;
}

export interface ReportConsoleData {
  aggregate: ReportAggregate;
  job?: InspectionJob;
  workflow: ReportWorkflowEvaluation;
  qc: ReportQcResult;
  comments: ReportReviewComment[];
  distributions: ReportDistribution[];
  acknowledgements: ReportAcknowledgement[];
  recipientResponses: ReportRecipientResponse[];
  maintenanceCandidates: Array<Record<string, unknown>>;
  maintenanceItems: Array<Record<string, unknown>>;
  versions: Array<Record<string, unknown>>;
}

export async function getReportConsole(reportId: string, agencyId?: string): Promise<ReportConsoleData> {
  return apiRequest<ReportConsoleData>(agencyId, `/api/v1/report-operations/${encodeURIComponent(reportId)}`);
}

export async function listReportAuditHistory(reportId: string, agencyId?: string): Promise<Array<Record<string, unknown>>> {
  const records = await apiRequest<Array<Record<string, unknown>>>(agencyId, '/api/v1/audit-history?limit=100');
  return records.filter((record) => {
    const target = record.target && typeof record.target === 'object' && !Array.isArray(record.target)
      ? record.target as Record<string, unknown>
      : undefined;
    return record.entityId === reportId || record.reportId === reportId || target?.reportId === reportId;
  });
}

export async function reviewReportComponent(
  reportId: string,
  areaId: string,
  componentId: string,
  action: 'analyst_review' | 'reviewer_approve' | 'request_changes' | 'accept_ai' | 'reject_ai',
  expectedVersion: number,
  agencyId?: string,
): Promise<ReportAggregate> {
  return apiRequest<ReportAggregate>(agencyId, `/api/v1/report-operations/${encodeURIComponent(reportId)}/components/${encodeURIComponent(areaId)}/${encodeURIComponent(componentId)}/review`, {
    method: 'POST',
    body: { action, expectedVersion },
  });
}

export async function createReportReviewComment(
  reportId: string,
  input: {
    scope: ReportReviewComment['scope'];
    body: string;
    category?: ReportReviewComment['category'];
    areaId?: string;
    componentId?: string;
    evidencePhotoId?: string;
  },
  agencyId?: string,
): Promise<ReportReviewComment> {
  return apiRequest<ReportReviewComment>(agencyId, `/api/v1/report-operations/${encodeURIComponent(reportId)}/review-comments`, {
    method: 'POST',
    body: input,
  });
}

export async function updateReportReviewComment(
  reportId: string,
  commentId: string,
  action: 'resolve' | 'verify' | 'reopen',
  resolutionNote?: string,
  agencyId?: string,
): Promise<ReportReviewComment> {
  return apiRequest<ReportReviewComment>(agencyId, `/api/v1/report-operations/${encodeURIComponent(reportId)}/review-comments/${encodeURIComponent(commentId)}`, {
    method: 'POST',
    body: { action, ...(resolutionNote?.trim() ? { resolutionNote: resolutionNote.trim() } : {}) },
  });
}

export async function createReportDistribution(
  reportId: string,
  input: {
    recipientName: string;
    recipientEmail: string;
    recipientRole: ReportDistributionRecipientRole;
    subject?: string;
    message?: string;
    expiryDays?: number;
  },
  agencyId?: string,
): Promise<{ distribution: ReportDistribution; accessPath: string }> {
  return apiRequest<{ distribution: ReportDistribution; accessPath: string }>(agencyId, `/api/v1/report-operations/${encodeURIComponent(reportId)}/distributions`, {
    method: 'POST',
    body: input,
  });
}

export async function revokeReportDistribution(
  reportId: string,
  distributionId: string,
  agencyId?: string,
): Promise<ReportDistribution> {
  return apiRequest<ReportDistribution>(agencyId, `/api/v1/report-operations/${encodeURIComponent(reportId)}/distributions/${encodeURIComponent(distributionId)}/revoke`, {
    method: 'POST',
    body: {},
  });
}

export async function resolveReportRecipientResponse(
  reportId: string,
  responseId: string,
  resolutionNote: string,
  advanceToFinalisation: boolean,
  agencyId?: string,
): Promise<ReportRecipientResponse> {
  return apiRequest<ReportRecipientResponse>(agencyId, `/api/v1/report-operations/${encodeURIComponent(reportId)}/recipient-responses/${encodeURIComponent(responseId)}/resolve`, {
    method: 'POST',
    body: { resolutionNote, advanceToFinalisation },
  });
}

export async function supersedeReport(
  reportId: string,
  reason: string,
  agencyId?: string,
): Promise<{ report: ReportAggregate; supersession: Record<string, unknown> }> {
  return apiRequest<{ report: ReportAggregate; supersession: Record<string, unknown> }>(agencyId, `/api/v1/report-operations/${encodeURIComponent(reportId)}/supersede`, {
    method: 'POST',
    body: { reason },
  });
}

async function publicRequest<T>(token: string, init: RequestInit = {}): Promise<T> {
  const baseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
  if (!baseUrl) throw new Error('VITE_API_BASE_URL is required for secure report access.');
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  if (init.body) headers.set('content-type', 'application/json');
  if ((init.method ?? 'GET') !== 'GET') {
    headers.set('idempotency-key', typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
  }
  const response = await fetch(`${baseUrl.replace(/\/$/u, '')}/api/v1/public/report-access/${encodeURIComponent(token)}`, { ...init, headers });
  const payload = await response.json().catch(() => ({})) as { data?: T; error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || `Report access request failed with ${response.status}.`);
  if (payload.data === undefined) throw new Error('Report access response did not contain data.');
  return payload.data;
}

export interface PublicReportAccessData {
  distribution: ReportDistribution;
  report: {
    id: string;
    reportVersionId: string;
    reportType: string;
    propertyAddress: string;
    inspectionDate?: string;
    tenantName?: string;
    clientName?: string;
    issuedAt?: string;
    lifecycleStatus: string;
  };
  areas: ReportAggregate['areas'];
  acknowledgements: ReportAcknowledgement[];
  responses: ReportRecipientResponse[];
}

export function getPublicReportAccess(token: string): Promise<PublicReportAccessData> {
  return publicRequest<PublicReportAccessData>(token);
}

export function acknowledgePublicReport(
  token: string,
  acknowledgementType: ReportAcknowledgement['acknowledgementType'],
  note?: string,
): Promise<ReportAcknowledgement> {
  return publicRequest<ReportAcknowledgement>(token, {
    method: 'POST',
    body: JSON.stringify({ action: 'acknowledge', acknowledgementType, ...(note?.trim() ? { note: note.trim() } : {}) }),
  });
}

export function submitPublicReportResponse(
  token: string,
  input: {
    generalNote?: string;
    evidencePhotoIds?: string[];
    comments?: Array<{ areaId?: string; componentId?: string; note: string; evidencePhotoIds?: string[] }>;
  },
): Promise<ReportRecipientResponse> {
  return publicRequest<ReportRecipientResponse>(token, {
    method: 'POST',
    body: JSON.stringify({ action: 'submit_response', ...input }),
  });
}
