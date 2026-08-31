import {
  createBuildingManagementRecord,
  listBuildingManagementRecords,
  signOutContractorAttendance,
  transitionBuildingManagementRecord,
  updateBuildingManagementRecord,
  type BuildingManagementRecord,
} from './buildingManagementApi';
import { apiRequest, storedAgencyId } from './apiClient';

export type PortalResourceSource = 'building' | 'platform';

export interface PortalResourceContext {
  managedSiteId?: string;
  clientAccountId?: string;
  propertyId?: string;
  contractorId?: string;
  assignedUserId?: string;
  userId?: string;
  status?: string;
}

export interface PortalResourceRecord extends BuildingManagementRecord {
  [key: string]: unknown;
}

function agency(): string {
  const value = storedAgencyId();
  if (!value) throw new Error('Select an agency before opening portal data.');
  return value;
}

function platformPath(resource: string, id?: string, context: PortalResourceContext = {}): string {
  const safe = resource.trim().replace(/[^a-z0-9-]/giu, '');
  if (!safe) throw new Error('A platform resource is required.');
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(context)) if (value) query.set(key, value);
  return `/api/v1/platform/${safe}${id ? `/${encodeURIComponent(id)}` : ''}${query.size ? `?${query.toString()}` : ''}`;
}

export async function listPortalResource(
  source: PortalResourceSource,
  resource: string,
  context: PortalResourceContext = {},
): Promise<PortalResourceRecord[]> {
  if (source === 'building') {
    return listBuildingManagementRecords(resource, { managedSiteId: context.managedSiteId, limit: 100 });
  }
  return apiRequest<PortalResourceRecord[]>(agency(), platformPath(resource, undefined, context));
}

export async function createPortalResource(
  source: PortalResourceSource,
  resource: string,
  data: Record<string, unknown>,
  context: PortalResourceContext = {},
): Promise<PortalResourceRecord> {
  const body = { ...context, ...data };
  if (source === 'building') return createBuildingManagementRecord(resource, body);
  return apiRequest<PortalResourceRecord>(agency(), platformPath(resource), { method: 'POST', body });
}

export async function updatePortalResource(
  source: PortalResourceSource,
  resource: string,
  id: string,
  expectedVersion: number,
  patch: Record<string, unknown>,
  context: PortalResourceContext = {},
): Promise<PortalResourceRecord> {
  if (source === 'building') return updateBuildingManagementRecord(resource, id, expectedVersion, patch);
  return apiRequest<PortalResourceRecord>(agency(), platformPath(resource, id, context), {
    method: 'PATCH', body: { ...patch, expectedVersion },
  });
}

export async function transitionPortalResource(
  resource: 'defects' | 'operational-work-orders' | 'move-bookings' | 'access-device-requests',
  id: string,
  expectedVersion: number,
  status: string,
  details: Record<string, unknown> = {},
): Promise<PortalResourceRecord> {
  return transitionBuildingManagementRecord(resource, id, expectedVersion, status, details);
}

export async function signOutPortalContractor(
  id: string,
  expectedVersion: number,
  details: { keyIssued: boolean; keyReturned: boolean; overrideReason?: string; signoutNotes?: string },
): Promise<PortalResourceRecord> {
  return signOutContractorAttendance(id, expectedVersion, details);
}
