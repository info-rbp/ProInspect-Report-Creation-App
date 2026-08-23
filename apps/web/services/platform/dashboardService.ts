import type { DashboardOverview, DashboardRange, DashboardSnapshot } from '@pcr/domain';
import { apiRequest } from '../apiClient';

function agencyId(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.localStorage.getItem('pcr_agency_id') || window.localStorage.getItem('agencyId') || undefined;
}

export async function getDashboardOverview(range: DashboardRange = '30d', timezone = 'Australia/Perth'): Promise<DashboardOverview> {
  const query = new URLSearchParams({ range, timezone });
  return apiRequest<DashboardOverview>(agencyId(), `/api/v1/dashboard/overview?${query.toString()}`);
}

export async function listDashboardSnapshots(): Promise<DashboardSnapshot[]> {
  return apiRequest<DashboardSnapshot[]>(agencyId(), '/api/v1/dashboard/snapshots');
}

export async function captureDashboardSnapshot(): Promise<DashboardSnapshot> {
  return apiRequest<DashboardSnapshot>(agencyId(), '/api/v1/dashboard/snapshots', { method: 'POST', body: {} });
}
