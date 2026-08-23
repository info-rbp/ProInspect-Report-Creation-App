import type {
  ClientAccount,
  ClientContact,
  ClientDocument,
  ClientEngagement,
  ClientPortalUser,
  ClientSnapshot,
  ClientTimelineEvent,
  PropertyClientRelationship,
  PropertyRecord,
} from '../../types/platform';
import { legacyClientType } from '@pcr/domain';
import { apiRequest } from '../apiClient';

function agencyId(): string | undefined {
  if (typeof window === 'undefined') return 'agency-1';
  return window.localStorage.getItem('pcr_agency_id') || window.localStorage.getItem('agencyId') || 'agency-1';
}

export interface ClientOverview {
  client: ClientAccount;
  contacts: ClientContact[];
  relationships: PropertyClientRelationship[];
  engagements: ClientEngagement[];
  documents: ClientDocument[];
  portalUsers: ClientPortalUser[];
  timeline: ClientTimelineEvent[];
  counts: {
    properties: number;
    activeJobs: number;
    reports: number;
    openMaintenance: number;
    pendingInspectionRequests: number;
  };
  recentJobs: Array<Record<string, unknown>>;
  recentReports: Array<Record<string, unknown>>;
  recentMaintenance: Array<Record<string, unknown>>;
}

export interface PropertyClientContext {
  propertyId: string;
  snapshot?: ClientSnapshot;
  account?: ClientAccount;
  relationships: PropertyClientRelationship[];
  contacts: ClientContact[];
  engagement?: ClientEngagement;
  warnings: string[];
}

export interface MaintenanceClientContext {
  item: Record<string, unknown>;
  context: PropertyClientContext;
  approval: {
    recipient?: { contactId?: string; name: string; email?: string; phone?: string };
    recipientType: 'property_manager' | 'landlord' | 'none';
    reasons: string[];
  };
}

export interface ClientBulkImportResult {
  results: Array<{
    row: number;
    status: 'ready' | 'created' | 'linked_existing' | 'review_required' | 'rejected';
    clientAccountId?: string;
    propertyId?: string;
    messages: string[];
  }>;
  created: number;
  linkedExisting: number;
  reviewRequired: number;
  rejected: number;
}

function compatibilityFields(input: Partial<ClientAccount>): Partial<ClientAccount> {
  const name = input.tradingName?.trim() || input.legalName?.trim() || input.name?.trim() || '';
  const defaultApprovalEmail =
    input.defaultApprovalEmail || input.maintenanceEmail || input.generalEmail || input.accountsEmail;
  return {
    ...input,
    ...(name ? { name } : {}),
    ...(input.generalEmail ? { email: input.generalEmail } : {}),
    ...(input.mainPhone ? { phone: input.mainPhone } : {}),
    ...(input.clientType ? { type: legacyClientType(input.clientType) } : {}),
    ...(input.externalReferences?.shopifyCustomerIds?.[0]
      ? { shopifyCustomerId: input.externalReferences.shopifyCustomerIds[0] }
      : {}),
    ...(defaultApprovalEmail ? { defaultApprovalEmail } : {}),
  };
}

export async function listClientAccounts(): Promise<ClientAccount[]> {
  return apiRequest<ClientAccount[]>(agencyId(), '/api/v1/clients');
}

export async function getClientAccount(id: string): Promise<ClientAccount> {
  return apiRequest<ClientAccount>(agencyId(), `/api/v1/clients/${encodeURIComponent(id)}`);
}

export async function createClientAccount(input: Partial<ClientAccount>): Promise<ClientAccount> {
  return apiRequest<ClientAccount>(agencyId(), '/api/v1/clients', {
    method: 'POST',
    body: compatibilityFields({ ...input, status: input.status || 'onboarding' }),
  });
}

export async function updateClientAccount(
  account: ClientAccount,
  updates: Partial<ClientAccount>,
): Promise<ClientAccount> {
  return apiRequest<ClientAccount>(agencyId(), `/api/v1/clients/${encodeURIComponent(account.id)}`, {
    method: 'PATCH',
    body: { ...compatibilityFields(updates), expectedVersion: account.version || 1 },
  });
}

export async function listClientContacts(): Promise<ClientContact[]> {
  return apiRequest<ClientContact[]>(agencyId(), '/api/v1/client-contacts');
}

export async function createClientContact(input: Partial<ClientContact>): Promise<ClientContact> {
  return apiRequest<ClientContact>(agencyId(), '/api/v1/client-contacts', { method: 'POST', body: input });
}

export async function updateClientContact(
  contact: ClientContact,
  updates: Partial<ClientContact>,
): Promise<ClientContact> {
  return apiRequest<ClientContact>(agencyId(), `/api/v1/client-contacts/${encodeURIComponent(contact.id)}`, {
    method: 'PATCH',
    body: { ...updates, expectedVersion: contact.version || 1 },
  });
}

export async function listClientEngagements(): Promise<ClientEngagement[]> {
  return apiRequest<ClientEngagement[]>(agencyId(), '/api/v1/client-engagements');
}

export async function createClientEngagement(input: Partial<ClientEngagement>): Promise<ClientEngagement> {
  return apiRequest<ClientEngagement>(agencyId(), '/api/v1/client-engagements', { method: 'POST', body: input });
}

export async function updateClientEngagement(
  engagement: ClientEngagement,
  updates: Partial<ClientEngagement>,
): Promise<ClientEngagement> {
  return apiRequest<ClientEngagement>(agencyId(), `/api/v1/client-engagements/${encodeURIComponent(engagement.id)}`, {
    method: 'PATCH',
    body: { ...updates, expectedVersion: engagement.version || 1 },
  });
}

export async function listPropertyClientRelationships(): Promise<PropertyClientRelationship[]> {
  return apiRequest<PropertyClientRelationship[]>(agencyId(), '/api/v1/property-client-relationships');
}

export async function createPropertyClientRelationship(
  input: Partial<PropertyClientRelationship> & Pick<PropertyClientRelationship, 'propertyId' | 'clientAccountId' | 'relationshipType'>,
): Promise<PropertyClientRelationship> {
  const relationship = await apiRequest<PropertyClientRelationship>(agencyId(), '/api/v1/property-client-relationships', {
    method: 'POST',
    body: { ...input, isCurrent: input.isCurrent !== false },
  });
  await syncPropertyClientContext(input.propertyId);
  return relationship;
}

export async function updatePropertyClientRelationship(
  relationship: PropertyClientRelationship,
  updates: Partial<PropertyClientRelationship>,
): Promise<PropertyClientRelationship> {
  const updated = await apiRequest<PropertyClientRelationship>(
    agencyId(),
    `/api/v1/property-client-relationships/${encodeURIComponent(relationship.id)}`,
    { method: 'PATCH', body: { ...updates, expectedVersion: relationship.version || 1 } },
  );
  await syncPropertyClientContext(updated.propertyId);
  return updated;
}

export async function endPropertyClientRelationship(
  relationship: PropertyClientRelationship,
  endDate = new Date().toISOString().slice(0, 10),
): Promise<PropertyClientRelationship> {
  return updatePropertyClientRelationship(relationship, { isCurrent: false, endDate });
}

export async function listClientDocuments(): Promise<ClientDocument[]> {
  return apiRequest<ClientDocument[]>(agencyId(), '/api/v1/client-documents');
}

export async function listClientPortalUsers(): Promise<ClientPortalUser[]> {
  return apiRequest<ClientPortalUser[]>(agencyId(), '/api/v1/client-portal-users');
}

export async function createClientPortalUser(input: Partial<ClientPortalUser>): Promise<ClientPortalUser> {
  return apiRequest<ClientPortalUser>(agencyId(), '/api/v1/client-portal-users', {
    method: 'POST',
    body: { ...input, status: input.status || 'invited' },
  });
}

export async function updateClientPortalUser(
  user: ClientPortalUser,
  updates: Partial<ClientPortalUser>,
): Promise<ClientPortalUser> {
  return apiRequest<ClientPortalUser>(agencyId(), `/api/v1/client-portal-users/${encodeURIComponent(user.id)}`, {
    method: 'PATCH',
    body: { ...updates, expectedVersion: user.version || 1 },
  });
}

export async function listClientTimelineEvents(): Promise<ClientTimelineEvent[]> {
  return apiRequest<ClientTimelineEvent[]>(agencyId(), '/api/v1/client-timeline-events');
}

export async function getClientOverview(clientId: string): Promise<ClientOverview> {
  return apiRequest<ClientOverview>(agencyId(), `/api/v1/client-management/clients/${encodeURIComponent(clientId)}/overview`);
}

export async function checkClientDuplicates(
  candidate: Partial<ClientAccount> & { primaryEmail?: string },
): Promise<Array<{ clientAccountId: string; score: number; reasons: string[] }>> {
  return apiRequest(agencyId(), '/api/v1/client-management/duplicates', { method: 'POST', body: candidate });
}

export async function activateClient(account: ClientAccount): Promise<ClientAccount> {
  return apiRequest<ClientAccount>(agencyId(), `/api/v1/client-management/clients/${encodeURIComponent(account.id)}/actions/activate`, {
    method: 'POST', body: { expectedVersion: account.version || 1 },
  });
}

export async function offboardClient(account: ClientAccount, reason: string): Promise<ClientAccount> {
  return apiRequest<ClientAccount>(agencyId(), `/api/v1/client-management/clients/${encodeURIComponent(account.id)}/actions/offboard`, {
    method: 'POST', body: { expectedVersion: account.version || 1, reason },
  });
}

export async function mergeClientAccounts(
  source: ClientAccount,
  targetClientId: string,
): Promise<{ source: ClientAccount; target: ClientAccount; moved: number }> {
  return apiRequest(agencyId(), `/api/v1/client-management/clients/${encodeURIComponent(source.id)}/actions/merge`, {
    method: 'POST', body: { expectedVersion: source.version || 1, targetClientId },
  });
}

export async function getPropertyClientContext(propertyId: string): Promise<PropertyClientContext> {
  return apiRequest<PropertyClientContext>(agencyId(), `/api/v1/client-management/property-context/${encodeURIComponent(propertyId)}`);
}

export async function syncPropertyClientContext(propertyId: string): Promise<{
  context: PropertyClientContext;
  updatedProperty: boolean;
  requestsUpdated: number;
  jobsUpdated: number;
  maintenanceItemsUpdated: number;
}> {
  return apiRequest(agencyId(), `/api/v1/client-management/property-context/${encodeURIComponent(propertyId)}/sync`, {
    method: 'POST', body: {},
  });
}

export async function snapshotInspectionJobClientContext(jobId: string): Promise<Record<string, unknown>> {
  return apiRequest(agencyId(), `/api/v1/client-management/jobs/${encodeURIComponent(jobId)}/snapshot`, {
    method: 'POST', body: {},
  });
}

export async function snapshotReportClientContext(reportId: string): Promise<Record<string, unknown>> {
  return apiRequest(agencyId(), `/api/v1/client-management/reports/${encodeURIComponent(reportId)}/snapshot`, {
    method: 'POST', body: {},
  });
}

export async function getMaintenanceClientContext(
  maintenanceItemId: string,
  amount = 0,
): Promise<MaintenanceClientContext> {
  return apiRequest(agencyId(), `/api/v1/client-management/maintenance/${encodeURIComponent(maintenanceItemId)}/context?amount=${encodeURIComponent(String(amount))}`);
}

export async function migrateLegacyPropertyClient(propertyId: string): Promise<{
  account: ClientAccount;
  contact: ClientContact;
  relationship: PropertyClientRelationship;
  context: PropertyClientContext;
}> {
  return apiRequest(agencyId(), `/api/v1/client-management/properties/${encodeURIComponent(propertyId)}/migrate-legacy`, {
    method: 'POST', body: {},
  });
}

export async function bulkImportClients(
  rows: Array<Record<string, string | number | boolean | null>>,
  dryRun = true,
): Promise<ClientBulkImportResult> {
  return apiRequest(agencyId(), '/api/v1/client-management/bulk-import', {
    method: 'POST', body: { rows, dryRun },
  });
}

async function fileDigest(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function resumableUpload(file: File, uploadUrl: string, contentType: string): Promise<void> {
  const chunkSize = 8 * 1024 * 1024;
  let start = 0;
  while (start < file.size) {
    const end = Math.min(start + chunkSize, file.size);
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': contentType, 'content-range': `bytes ${start}-${end - 1}/${file.size}` },
      body: file.slice(start, end),
    });
    if (response.status === 308) {
      const range = response.headers.get('range');
      start = range ? Number(range.split('-').pop()) + 1 : end;
      continue;
    }
    if (!response.ok) throw new Error(`Client document upload failed with ${response.status}.`);
    start = file.size;
  }
}

export async function uploadClientDocument(
  clientId: string,
  file: File,
  metadata: {
    type: ClientDocument['type'];
    title?: string;
    effectiveFrom?: string;
    expiresAt?: string;
    signedStatus?: ClientDocument['signedStatus'];
    supersedesDocumentId?: string;
  },
): Promise<ClientDocument> {
  const contentType = file.type || 'application/octet-stream';
  const sha256 = await fileDigest(file);
  const session = await apiRequest<{ uploadId: string; resumableUploadUrl: string }>(
    agencyId(),
    `/api/v1/clients/${encodeURIComponent(clientId)}/documents/upload-session`,
    { method: 'POST', body: { fileName: file.name, contentType, fileSize: file.size, sha256 } },
  );
  await resumableUpload(file, session.resumableUploadUrl, contentType);
  return apiRequest<ClientDocument>(
    agencyId(),
    `/api/v1/clients/${encodeURIComponent(clientId)}/documents/${encodeURIComponent(session.uploadId)}/complete`,
    { method: 'POST', body: metadata },
  );
}

export type ClientLinkedProperty = PropertyRecord & { relationship?: PropertyClientRelationship };
