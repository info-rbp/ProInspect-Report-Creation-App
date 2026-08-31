import {
  createBuildingManagementRecord,
  listBuildingManagementRecords,
  signOutContractorAttendance,
  transitionBuildingManagementRecord,
  updateBuildingManagementRecord,
  type BuildingManagementRecord,
} from './buildingManagementApi';
import { apiRequest, storedAgencyId } from './apiClient';

export type PortalResourceSource = 'building' | 'platform' | 'core' | 'scoped';

export interface PortalResourceContext {
  managedSiteId?: string;
  clientAccountId?: string;
  propertyId?: string;
  unitId?: string;
  contractorId?: string;
  assignedUserId?: string;
  userId?: string;
  status?: string;
}

export interface PortalResourceRecord extends BuildingManagementRecord { [key: string]: unknown; }

const EXPERIENCE_RESOURCES = new Set([
  'admin/service-requests',
  'resident/conversations',
  'site/contractors',
  'contractor/site-access',
  'contractor/notifications',
]);

function agency(): string { const value = storedAgencyId(); if (!value) throw new Error('Select an agency before opening portal data.'); return value; }
function safeResource(resource: string): string { const value = resource.trim().replace(/[^a-z0-9-]/giu, ''); if (!value) throw new Error('A portal resource is required.'); return value; }
function safeScopedResource(resource: string): string { const segments = resource.split('/').map((part) => safeResource(part)).filter(Boolean); if (segments.length < 2) throw new Error('A scoped portal resource requires an audience and resource.'); return segments.join('/'); }
function queryString(context: PortalResourceContext): string { const query = new URLSearchParams(); for (const [key, value] of Object.entries(context)) if (value) query.set(key, value); return query.size ? `?${query.toString()}` : ''; }
function platformPath(resource: string, id?: string, context: PortalResourceContext = {}): string { return `/api/v1/platform/${safeResource(resource)}${id ? `/${encodeURIComponent(id)}` : ''}${queryString(context)}`; }
function scopedPath(resource: string, context: PortalResourceContext = {}): string {
  const safe = safeScopedResource(resource);
  const root = EXPERIENCE_RESOURCES.has(safe) ? 'portal-experience' : 'portal-scope';
  return `/api/v1/${root}/${safe}${queryString(context)}`;
}
function corePath(resource: string, id?: string): string { return `/api/v1/${safeResource(resource)}${id ? `/${encodeURIComponent(id)}` : ''}`; }

export async function listPortalResource(source: PortalResourceSource, resource: string, context: PortalResourceContext = {}): Promise<PortalResourceRecord[]> {
  if (source === 'building') return listBuildingManagementRecords(resource, { managedSiteId: context.managedSiteId, limit: 100 });
  if (source === 'core') return apiRequest<PortalResourceRecord[]>(agency(), corePath(resource));
  if (source === 'scoped') return apiRequest<PortalResourceRecord[]>(agency(), scopedPath(resource, context));
  return apiRequest<PortalResourceRecord[]>(agency(), platformPath(resource, undefined, context));
}

export async function createPortalResource(source: PortalResourceSource, resource: string, data: Record<string, unknown>, context: PortalResourceContext = {}): Promise<PortalResourceRecord> {
  const body = { ...context, ...data };
  if (source === 'building') return createBuildingManagementRecord(resource, body);
  if (source === 'core') return apiRequest<PortalResourceRecord>(agency(), corePath(resource), { method: 'POST', body });
  if (source === 'scoped') return apiRequest<PortalResourceRecord>(agency(), scopedPath(resource, context), { method: 'POST', body });
  return apiRequest<PortalResourceRecord>(agency(), platformPath(resource), { method: 'POST', body });
}

export async function updatePortalResource(source: PortalResourceSource, resource: string, id: string, expectedVersion: number, patch: Record<string, unknown>, context: PortalResourceContext = {}): Promise<PortalResourceRecord> {
  if (source === 'building') return updateBuildingManagementRecord(resource, id, expectedVersion, patch);
  if (source === 'core') return apiRequest<PortalResourceRecord>(agency(), corePath(resource, id), { method: 'PATCH', body: { ...patch, expectedVersion } });
  if (source === 'scoped') throw new Error('Scoped portal records must use their dedicated lifecycle action.');
  return apiRequest<PortalResourceRecord>(agency(), platformPath(resource, id, context), { method: 'PATCH', body: { ...patch, expectedVersion } });
}

export async function listConversationMessages(conversationId: string, resource = 'conversations', context: PortalResourceContext = {}): Promise<PortalResourceRecord[]> {
  if (resource === 'resident/conversations') return apiRequest<PortalResourceRecord[]>(agency(), `/api/v1/portal-experience/resident/conversations/${encodeURIComponent(conversationId)}/messages${queryString(context)}`);
  return apiRequest<PortalResourceRecord[]>(agency(), `/api/v1/platform/conversations/${encodeURIComponent(conversationId)}/messages`);
}
export async function sendConversationMessage(conversationId: string, body: string, resource = 'conversations', context: PortalResourceContext = {}): Promise<PortalResourceRecord> {
  if (resource === 'resident/conversations') return apiRequest<PortalResourceRecord>(agency(), `/api/v1/portal-experience/resident/conversations/${encodeURIComponent(conversationId)}/messages${queryString(context)}`, { method: 'POST', body: { body, channel: 'portal' } });
  return apiRequest<PortalResourceRecord>(agency(), `/api/v1/platform/conversations/${encodeURIComponent(conversationId)}/messages`, { method: 'POST', body: { body, channel: 'portal' } });
}
export async function transitionPortalResource(resource: 'defects' | 'operational-work-orders' | 'move-bookings' | 'access-device-requests', id: string, expectedVersion: number, status: string, details: Record<string, unknown> = {}): Promise<PortalResourceRecord> { return transitionBuildingManagementRecord(resource, id, expectedVersion, status, details); }
export async function signOutPortalContractor(id: string, expectedVersion: number, details: { keyIssued: boolean; keyReturned: boolean; overrideReason?: string; signoutNotes?: string }): Promise<PortalResourceRecord> { return signOutContractorAttendance(id, expectedVersion, details); }
