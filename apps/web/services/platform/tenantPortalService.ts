import { apiRequest } from '../apiClient';

function agencyId(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.localStorage.getItem('pcr_agency_id') || window.localStorage.getItem('agencyId') || undefined;
}

async function externalRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const baseUrl = import.meta.env.VITE_API_BASE_URL?.trim() || '';
  const response = await fetch(`${baseUrl.replace(/\/$/u, '')}${path}`, init);
  const payload = await response.json().catch(() => ({})) as { data?: T; error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || `Tenant portal request failed with ${response.status}.`);
  if (payload.data === undefined) throw new Error('Tenant portal response did not contain data.');
  return payload.data;
}

async function fileSha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function contentTypeFor(file: File): 'image/jpeg' | 'image/png' | 'image/heic' | 'image/heif' {
  const declared = file.type.trim().toLowerCase();
  if (declared === 'image/jpeg' || declared === 'image/png' || declared === 'image/heic' || declared === 'image/heif') return declared;
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.heic')) return 'image/heic';
  if (lower.endsWith('.heif')) return 'image/heif';
  throw new Error('Evidence must be JPEG, PNG, HEIC or HEIF imagery.');
}

export interface TenantPortalSigner {
  id: string;
  kind: 'tenant' | 'agent';
  tenantId?: string;
  userId?: string;
  name?: string;
  email?: string;
  required?: boolean;
  status?: 'pending' | 'signed';
  signedAt?: string;
  signatureName?: string;
}

export interface TenantPortalContext {
  tenant: { id: string; fullName: string; preferredName?: string; email?: string; phone?: string };
  tenancy: { id: string; propertyId: string; leaseStartDate?: string; leaseEndDate?: string; lifecycleStatus?: string; leaseType?: string };
  property?: { id: string; address?: string; suburb?: string; state?: string; postcode?: string };
  inspections: Array<{ id: string; reportType?: string; scheduledAt?: string; status?: string }>;
  reports: Array<{ id: string; reportId: string; reportType?: string; inspectionDate?: string; lifecycleStatus?: string }>;
  maintenance: Array<{ id: string; title?: string; description?: string; category?: string; priority?: string; status?: string; dueDate?: string; sourceEvidenceIds?: string[]; location?: string; accessAvailability?: string }>;
  actions: Array<{ id: string; type?: string; title?: string; instruction?: string; status?: string; dueDate?: string; tenantResponseNote?: string; tenantEvidenceIds?: string[]; tenantResponseType?: string }>;
  communications: Array<{ id: string; channel?: string; direction?: string; subject?: string; message?: string; status?: string; createdAt?: string }>;
  documents: Array<{ id: string; type?: string; title?: string; status?: string; content?: string; contentType?: string; acknowledgementText?: string; issuedAt?: string; signedAt?: string; signers?: TenantPortalSigner[]; downloadUrl?: string }>;
}

export interface TenantPortalGrantSummary {
  id: string;
  tenantId: string;
  tenancyId: string;
  recipientEmail: string;
  expiresAt: string;
  revokedAt?: string;
  lastAccessedAt?: string;
  createdAt?: string;
}

export async function generateTenantPortalGrant(tenantId: string, tenancyId: string, recipientEmail: string, expiresInHours = 168, sendInvitation = false): Promise<{ grantId: string; grantToken: string; expiresAt: string; accessUrl: string }> {
  return apiRequest(agencyId(), '/api/v1/tenant-portal-grants/generate', {
    method: 'POST', body: { tenantId, tenancyId, recipientEmail, expiresInHours, sendInvitation },
  });
}

export async function listTenantPortalGrants(tenantId?: string, tenancyId?: string): Promise<TenantPortalGrantSummary[]> {
  const params = new URLSearchParams();
  if (tenantId) params.set('tenantId', tenantId);
  if (tenancyId) params.set('tenancyId', tenancyId);
  return apiRequest(agencyId(), `/api/v1/tenant-portal-grants${params.size ? `?${params.toString()}` : ''}`);
}

export async function revokeTenantPortalGrant(grantId: string): Promise<unknown> {
  return apiRequest(agencyId(), `/api/v1/tenant-portal-grants/${encodeURIComponent(grantId)}/revoke`, { method: 'POST', body: {} });
}

export async function replaceTenantPortalGrant(grantId: string, expiresInHours = 168): Promise<{ grantId: string; grantToken: string; expiresAt: string; accessUrl: string }> {
  return apiRequest(agencyId(), `/api/v1/tenant-portal-grants/${encodeURIComponent(grantId)}/replace`, { method: 'POST', body: { expiresInHours } });
}

export async function getTenantPortalContext(grantToken: string): Promise<TenantPortalContext> {
  return externalRequest(`/api/v1/external/tenant-portal/${encodeURIComponent(grantToken)}`);
}

export async function submitTenantPortalMessage(grantToken: string, message: string): Promise<unknown> {
  return externalRequest(`/api/v1/external/tenant-portal/${encodeURIComponent(grantToken)}/message`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message }) });
}

export async function submitTenantPortalActionResponse(grantToken: string, input: { actionId: string; responseType: 'completed' | 'clarification' | 'request_more_time' | 'response'; note?: string; evidenceIds?: string[] }): Promise<unknown> {
  return externalRequest(`/api/v1/external/tenant-portal/${encodeURIComponent(grantToken)}/respond-action`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
}

export async function submitTenantPortalMaintenance(grantToken: string, input: { title: string; description: string; category?: string; priority?: string; sourceEvidenceIds?: string[]; location?: string; accessAvailability?: string }): Promise<unknown> {
  return externalRequest(`/api/v1/external/tenant-portal/${encodeURIComponent(grantToken)}/maintenance`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
}

export async function uploadTenantPortalEvidence(grantToken: string, file: File): Promise<{ photoId: string; sha256?: string; generation?: string }> {
  const sha256 = await fileSha256(file);
  const contentType = contentTypeFor(file);
  const session = await externalRequest<{ id: string; status: string; resumableUploadUrl?: string; duplicatePhotoId?: string }>(`/api/v1/external/tenant-portal/${encodeURIComponent(grantToken)}/evidence/upload-session`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fileName: file.name, contentType, size: file.size, sha256 }),
  });
  if (session.status === 'duplicate' && session.duplicatePhotoId) return { photoId: session.duplicatePhotoId, sha256 };
  if (!session.resumableUploadUrl) throw new Error('Evidence upload service is not configured.');
  const upload = await fetch(session.resumableUploadUrl, { method: 'PUT', headers: { 'content-type': contentType, 'content-range': `bytes 0-${file.size - 1}/${file.size}` }, body: file });
  if (!upload.ok) throw new Error(`Evidence upload failed with ${upload.status}.`);
  return externalRequest(`/api/v1/external/tenant-portal/${encodeURIComponent(grantToken)}/evidence/upload-session/${encodeURIComponent(session.id)}/complete`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
}

export async function signTenantPortalDocument(grantToken: string, documentId: string, signatureName: string): Promise<unknown> {
  return externalRequest(`/api/v1/external/tenant-portal/${encodeURIComponent(grantToken)}/sign-document`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ documentId, signatureName }) });
}
