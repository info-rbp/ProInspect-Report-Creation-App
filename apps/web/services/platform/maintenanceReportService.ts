import type { ReportAggregate } from '@pcr/domain';
import { apiRequest } from '../apiClient';

function agencyId(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.localStorage.getItem('pcr_agency_id') || window.localStorage.getItem('agencyId') || undefined;
}

export async function createMaintenanceFollowUpReport(
  maintenanceItemIds: string[],
  inspectionDate = new Date().toISOString().slice(0, 10),
): Promise<ReportAggregate> {
  return apiRequest<ReportAggregate>(agencyId(), '/api/v1/maintenance-reports/create', {
    method: 'POST',
    body: { maintenanceItemIds, inspectionDate },
  });
}