import { apiRequest, storedAgencyId } from './apiClient';

export interface BuildingManagementRecord {
  id: string;
  agencyId: string;
  managedSiteId?: string;
  status?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface BuildingManagementListOptions {
  managedSiteId?: string;
  limit?: number;
  cursor?: string;
}

function agency(): string {
  const value = storedAgencyId();
  if (!value) throw new Error('Select an agency before opening Building Management data.');
  return value;
}

function resourcePath(resource: string, id?: string): string {
  const safe = resource.trim().replace(/[^a-z0-9-]/giu, '');
  if (!safe) throw new Error('A Building Management resource is required.');
  return `/api/v1/building/${safe}${id ? `/${encodeURIComponent(id)}` : ''}`;
}

export async function listBuildingManagementRecords(
  resource: string,
  options: BuildingManagementListOptions = {},
): Promise<BuildingManagementRecord[]> {
  const search = new URLSearchParams();
  if (options.managedSiteId) search.set('managedSiteId', options.managedSiteId);
  if (options.limit) search.set('limit', String(options.limit));
  if (options.cursor) search.set('cursor', options.cursor);
  const suffix = search.size ? `?${search.toString()}` : '';
  return apiRequest<BuildingManagementRecord[]>(agency(), `${resourcePath(resource)}${suffix}`);
}

export function getBuildingManagementRecord(resource: string, id: string): Promise<BuildingManagementRecord> {
  return apiRequest<BuildingManagementRecord>(agency(), resourcePath(resource, id));
}

export function createBuildingManagementRecord(
  resource: string,
  data: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<BuildingManagementRecord> {
  return apiRequest<BuildingManagementRecord>(agency(), resourcePath(resource), {
    method: 'POST', body: data, idempotencyKey,
  });
}

export function updateBuildingManagementRecord(
  resource: string,
  id: string,
  expectedVersion: number,
  patch: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<BuildingManagementRecord> {
  return apiRequest<BuildingManagementRecord>(agency(), resourcePath(resource, id), {
    method: 'PATCH', body: { ...patch, expectedVersion }, idempotencyKey,
  });
}

export function transitionBuildingManagementRecord(
  resource: 'defects' | 'operational-work-orders' | 'move-bookings' | 'access-device-requests',
  id: string,
  expectedVersion: number,
  status: string,
  details: Record<string, unknown> = {},
  idempotencyKey?: string,
): Promise<BuildingManagementRecord> {
  return apiRequest<BuildingManagementRecord>(agency(), `${resourcePath(resource, id)}/transitions`, {
    method: 'POST', body: { expectedVersion, status, ...details }, idempotencyKey,
  });
}

export function signOutContractorAttendance(
  id: string,
  expectedVersion: number,
  details: { keyIssued: boolean; keyReturned: boolean; overrideReason?: string; signoutNotes?: string },
  idempotencyKey?: string,
): Promise<BuildingManagementRecord> {
  return apiRequest<BuildingManagementRecord>(agency(), `${resourcePath('contractor-attendance', id)}/sign-out`, {
    method: 'POST', body: { expectedVersion, ...details }, idempotencyKey,
  });
}
