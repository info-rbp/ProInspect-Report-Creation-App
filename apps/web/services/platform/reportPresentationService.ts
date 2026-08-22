import type { ReportPresentationTemplate } from '@pcr/report-presentation';
import { apiRequest } from '../apiClient';

export async function listReportLayouts(agencyId: string): Promise<ReportPresentationTemplate[]> {
  return apiRequest<ReportPresentationTemplate[]>(agencyId, '/api/v1/report-presentation-templates?limit=100');
}

export async function createReportLayout(
  agencyId: string,
  template: ReportPresentationTemplate,
): Promise<ReportPresentationTemplate> {
  return apiRequest<ReportPresentationTemplate>(agencyId, '/api/v1/report-presentation-templates', {
    method: 'POST',
    body: template,
  });
}

export async function updateReportLayout(
  agencyId: string,
  template: ReportPresentationTemplate,
): Promise<ReportPresentationTemplate> {
  return apiRequest<ReportPresentationTemplate>(agencyId, `/api/v1/report-presentation-templates/${encodeURIComponent(template.id)}`, {
    method: 'PATCH',
    body: { ...template, expectedVersion: template.version },
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
