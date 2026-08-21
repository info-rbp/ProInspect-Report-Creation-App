import { apiRequest } from '../apiClient';

function agencyId(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.localStorage.getItem('pcr_agency_id') || window.localStorage.getItem('agencyId') || undefined;
}

async function externalRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const baseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
  if (!baseUrl) throw new Error('VITE_API_BASE_URL is required for tenant portal operations.');
  const response = await fetch(`${baseUrl.replace(/\/$/u, '')}${path}`, init);
  const payload = await response.json().catch(() => ({})) as { data?: T; error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || `Tenant portal request failed with ${response.status}.`);
  if (payload.data === undefined) throw new Error('Tenant portal response did not contain data.');
  return payload.data;
}

export interface TenantPortalContext {
  tenant: { id: string; fullName: string; preferredName?: string; email?: string; phone?: string };
  tenancy: { id: string; propertyId: string; leaseStartDate?: string; leaseEndDate?: string; lifecycleStatus?: string; leaseType?: string };
  property?: { id: string; address?: string; suburb?: string; state?: string; postcode?: string };
  inspections: Array<{ id: string; reportType?: string; scheduledAt?: string; status?: string }>;
  reports: Array<{ id: string; reportId: string; reportType?: string; inspectionDate?: string; lifecycleStatus?: string }>;
  maintenance: Array<{ id: string; title?: string; description?: string; category?: string; priority?: string; status?: string; dueDate?: string }>;
  actions: Array<{ id: string; type?: string; title?: string; instruction?: string; status?: string; dueDate?: string; tenantResponseNote?: string }>;
  communications: Array<{ id: string; channel?: string; direction?: string; subject?: string; message?: string; status?: string; createdAt?: string }>;
  documents: Array<{ id: string; type?: string; title?: string; status?: string; issuedAt?: string; signedAt?: string }>;
}

export async function generateTenantPortalGrant(tenantId: string, tenancyId: string, recipientEmail: string, expiresInHours = 168): Promise<{ grantId: string; grantToken: string; expiresAt: string; accessUrl: string }> {
  return apiRequest(agencyId(), '/api/v1/tenant-portal-grants/generate', {
    method: 'POST',
    body: { tenantId, tenancyId, recipientEmail, expiresInHours },
  });
}

export async function getTenantPortalContext(grantToken: string): Promise<TenantPortalContext> {
  return externalRequest(`/api/v1/external/tenant-portal/${encodeURIComponent(grantToken)}`);
}

export async function submitTenantPortalMessage(grantToken: string, message: string): Promise<unknown> {
  return externalRequest(`/api/v1/external/tenant-portal/${encodeURIComponent(grantToken)}/message`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message }),
  });
}

export async function submitTenantPortalMaintenance(grantToken: string, input: { title: string; description: string; category?: string; priority?: string }): Promise<unknown> {
  return externalRequest(`/api/v1/external/tenant-portal/${encodeURIComponent(grantToken)}/maintenance`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
  });
}
