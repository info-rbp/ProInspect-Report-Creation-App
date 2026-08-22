import type { ReportPresentationTemplate } from '@pcr/report-presentation';
import { apiRequest } from '../apiClient';

function writable(template: ReportPresentationTemplate): Record<string, unknown> {
  const body = structuredClone(template) as unknown as Record<string, unknown>;
  delete body.createdAt;
  delete body.updatedAt;
  delete body.publishedAt;
  delete body.retiredAt;
  return body;
}

export async function listReportLayouts(agencyId: string): Promise<ReportPresentationTemplate[]> {
  return apiRequest<ReportPresentationTemplate[]>(agencyId, '/api/v1/report-presentation-templates?limit=100');
}

export async function createReportLayout(
  agencyId: string,
  template: ReportPresentationTemplate,
): Promise<ReportPresentationTemplate> {
  return apiRequest<ReportPresentationTemplate>(agencyId, '/api/v1/report-presentation-templates', {
    method: 'POST',
    body: writable(template),
  });
}

export async function updateReportLayout(
  agencyId: string,
  template: ReportPresentationTemplate,
): Promise<ReportPresentationTemplate> {
  return apiRequest<ReportPresentationTemplate>(agencyId, `/api/v1/report-presentation-templates/${encodeURIComponent(template.id)}`, {
    method: 'PATCH',
    body: { ...writable(template), expectedVersion: template.version },
  });
}

export async function publishReportLayout(
  agencyId: string,
  template: ReportPresentationTemplate,
): Promise<ReportPresentationTemplate> {
  return apiRequest<ReportPresentationTemplate>(agencyId, `/api/v1/report-presentation-templates/${encodeURIComponent(template.id)}/actions/publish`, {
    method: 'POST',
    body: { expectedVersion: template.version },
  });
}

export async function retireReportLayout(
  agencyId: string,
  template: ReportPresentationTemplate,
): Promise<ReportPresentationTemplate> {
  return apiRequest<ReportPresentationTemplate>(agencyId, `/api/v1/report-presentation-templates/${encodeURIComponent(template.id)}/actions/retire`, {
    method: 'POST',
    body: { expectedVersion: template.version },
  });
}
