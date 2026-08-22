import type { ReportAggregate } from '../../types/platform';
import { apiRequest } from '../apiClient';

export interface TenantActionSourceOption {
  areaId: string;
  areaName: string;
  componentId?: string;
  componentName?: string;
  photoId: string;
  label: string;
}

export async function getTenantActionReportSource(reportId: string): Promise<{ aggregate: ReportAggregate; evidence: TenantActionSourceOption[] }> {
  const aggregate = await apiRequest<ReportAggregate>(undefined, `/api/v1/tenant-action-sources/${encodeURIComponent(reportId)}`);
  const evidence: TenantActionSourceOption[] = [];
  for (const area of aggregate.areas) {
    for (const photo of area.photoReferences || []) evidence.push({ areaId: area.id, areaName: area.name, photoId: photo.photoId, label: `${area.name} · Area photo` });
    for (const component of area.components) {
      for (const photo of component.photoReferences || []) evidence.push({ areaId: area.id, areaName: area.name, componentId: component.id, componentName: component.component, photoId: photo.photoId, label: `${area.name} · ${component.component}` });
    }
  }
  return { aggregate, evidence };
}
