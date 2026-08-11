import type {
  ClientApproval,
  ExternalAccessGrant,
  ExternalContact,
  MaintenanceCandidate,
  MaintenanceItem,
  TenantInstruction,
  WorkRequest,
} from '../../types/platform';

// Helper for agency header
function getAgencyId(): string {
  return localStorage.getItem('pcr_agency_id') || 'agency-1';
}

function getHeaders(extraHeaders?: Record<string, string>): Record<string, string> {
  return {
    'x-agency-id': getAgencyId(),
    'content-type': 'application/json',
    ...extraHeaders,
  };
}

async function handleFetch(url: string, init?: RequestInit) {
  const baseUrl = import.meta.env.VITE_API_BASE_URL?.trim() || '';
  const fullUrl = url.startsWith('/') ? `${baseUrl.replace(/\/$/u, '')}${url}` : url;
  const res = await fetch(fullUrl, init);
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody?.error?.message || `API error: ${res.status}`);
  }
  return res.json();
}

// ---------------------------
// 1. Maintenance Candidates
// ---------------------------
export async function listMaintenanceCandidates(): Promise<MaintenanceCandidate[]> {
  const data = await handleFetch('/api/v1/maintenance-candidates', {
    headers: getHeaders(),
  });
  return data.data || [];
}

export async function extractMaintenanceCandidates(reportId: string): Promise<MaintenanceCandidate[]> {
  const data = await handleFetch('/api/v1/maintenance-candidates/extract', {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ reportId }),
  });
  return data.data || [];
}

export async function confirmMaintenanceCandidate(
  candidateId: string,
  overrides?: { title?: string; description?: string; category?: string; priority?: string; workInstruction?: string },
): Promise<MaintenanceItem> {
  const data = await handleFetch(`/api/v1/maintenance-candidates/${candidateId}/confirm`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(overrides || {}),
  });
  return data.data;
}

export async function dismissMaintenanceCandidate(candidateId: string, reason: string): Promise<MaintenanceCandidate> {
  const data = await handleFetch(`/api/v1/maintenance-candidates/${candidateId}`, {
    method: 'PATCH',
    headers: getHeaders({ 'idempotency-key': `dismiss-${candidateId}-${Date.now()}` }),
    body: JSON.stringify({ reviewStatus: 'dismissed', dismissedReason: reason, expectedVersion: 1 }),
  });
  return data.data;
}

// ---------------------------
// 2. Maintenance Items
// ---------------------------
export async function listMaintenanceItems(): Promise<MaintenanceItem[]> {
  const data = await handleFetch('/api/v1/maintenance-items', {
    headers: getHeaders(),
  });
  return data.data || [];
}

export async function getMaintenanceItem(id: string): Promise<MaintenanceItem> {
  const data = await handleFetch(`/api/v1/maintenance-items/${id}`, {
    headers: getHeaders(),
  });
  return data.data;
}

export async function createMaintenanceItem(input: Partial<MaintenanceItem>): Promise<MaintenanceItem> {
  const data = await handleFetch('/api/v1/maintenance-items', {
    method: 'POST',
    headers: getHeaders({ 'idempotency-key': `create-item-${Date.now()}` }),
    body: JSON.stringify(input),
  });
  return data.data;
}

export async function updateMaintenanceItem(id: string, updates: Partial<MaintenanceItem>, expectedVersion: number): Promise<MaintenanceItem> {
  const data = await handleFetch(`/api/v1/maintenance-items/${id}`, {
    method: 'PATCH',
    headers: getHeaders({ 'idempotency-key': `update-item-${id}-${Date.now()}` }),
    body: JSON.stringify({ ...updates, expectedVersion }),
  });
  return data.data;
}

// ---------------------------
// 3. Work Requests & External Contacts
// ---------------------------
export async function listExternalContacts(): Promise<ExternalContact[]> {
  const data = await handleFetch('/api/v1/external-contacts', {
    headers: getHeaders(),
  });
  return data.data || [];
}

export async function createExternalContact(input: Partial<ExternalContact>): Promise<ExternalContact> {
  const data = await handleFetch('/api/v1/external-contacts', {
    method: 'POST',
    headers: getHeaders({ 'idempotency-key': `create-contact-${Date.now()}` }),
    body: JSON.stringify(input),
  });
  return data.data;
}

export async function listWorkRequests(): Promise<WorkRequest[]> {
  const data = await handleFetch('/api/v1/work-requests', {
    headers: getHeaders(),
  });
  return data.data || [];
}

export async function createWorkRequest(input: Partial<WorkRequest>): Promise<WorkRequest> {
  const data = await handleFetch('/api/v1/work-requests', {
    method: 'POST',
    headers: getHeaders({ 'idempotency-key': `create-workreq-${Date.now()}` }),
    body: JSON.stringify({ ...input, status: 'issued', issuedAt: new Date().toISOString() }),
  });
  return data.data;
}

// ---------------------------
// 4. Tenant Instructions
// ---------------------------
export async function listTenantInstructions(): Promise<TenantInstruction[]> {
  const data = await handleFetch('/api/v1/tenant-instructions', {
    headers: getHeaders(),
  });
  return data.data || [];
}

export async function createTenantInstruction(input: Partial<TenantInstruction>): Promise<TenantInstruction> {
  const data = await handleFetch('/api/v1/tenant-instructions', {
    method: 'POST',
    headers: getHeaders({ 'idempotency-key': `create-inst-${Date.now()}` }),
    body: JSON.stringify({ ...input, status: 'approved', approvedAt: new Date().toISOString() }),
  });
  return data.data;
}

export async function updateTenantInstruction(id: string, updates: Partial<TenantInstruction>, expectedVersion: number): Promise<TenantInstruction> {
  const data = await handleFetch(`/api/v1/tenant-instructions/${id}`, {
    method: 'PATCH',
    headers: getHeaders({ 'idempotency-key': `update-inst-${id}-${Date.now()}` }),
    body: JSON.stringify({ ...updates, expectedVersion }),
  });
  return data.data;
}

// ---------------------------
// 5. Client Approvals
// ---------------------------
export async function listClientApprovals(): Promise<ClientApproval[]> {
  const data = await handleFetch('/api/v1/client-approvals', {
    headers: getHeaders(),
  });
  return data.data || [];
}

export async function createClientApproval(input: Partial<ClientApproval>): Promise<ClientApproval> {
  const data = await handleFetch('/api/v1/client-approvals', {
    method: 'POST',
    headers: getHeaders({ 'idempotency-key': `create-clientapp-${Date.now()}` }),
    body: JSON.stringify({ ...input, status: 'pending' }),
  });
  return data.data;
}

// ---------------------------
// 6. External Access Grants
// ---------------------------
export async function generateAccessGrant(
  resourceType: 'work_request' | 'tenant_instruction' | 'client_approval',
  resourceId: string,
  recipientEmail: string,
  expiresInHours = 72,
): Promise<{ grantId: string; grantToken: string; expiresAt: string; accessUrl: string }> {
  const data = await handleFetch('/api/v1/external-access-grants/generate', {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ resourceType, resourceId, recipientEmail, expiresInHours }),
  });
  return data.data;
}

// ---------------------------
// 7. Scoped External Portal Methods
// ---------------------------
export async function getExternalWorkRequest(grantToken: string): Promise<{ workRequest: WorkRequest; maintenanceItem: any; propertyAddress: string }> {
  const data = await handleFetch(`/api/v1/external/work-requests/${grantToken}`);
  return data.data;
}

export async function submitExternalWorkResponse(
  grantToken: string,
  action: 'acknowledge' | 'in_progress' | 'complete' | 'unable_to_complete',
  responseNotes?: string,
  completionEvidenceIds?: string[],
): Promise<WorkRequest> {
  const data = await handleFetch(`/api/v1/external/work-requests/${grantToken}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, responseNotes, completionEvidenceIds }),
  });
  return data.data;
}

export async function getExternalTenantInstruction(grantToken: string): Promise<TenantInstruction> {
  const data = await handleFetch(`/api/v1/external/tenant-instructions/${grantToken}`);
  return data.data;
}

export async function submitExternalTenantResponse(
  grantToken: string,
  tenantResponseNote: string,
  tenantEvidenceIds?: string[],
): Promise<TenantInstruction> {
  const data = await handleFetch(`/api/v1/external/tenant-instructions/${grantToken}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tenantResponseNote, tenantEvidenceIds }),
  });
  return data.data;
}

export async function getExternalClientApproval(grantToken: string): Promise<ClientApproval> {
  const data = await handleFetch(`/api/v1/external/client-approvals/${grantToken}`);
  return data.data;
}

export async function submitExternalClientApproval(
  grantToken: string,
  decision: 'approved' | 'declined' | 'information_requested',
  clientNotes?: string,
): Promise<ClientApproval> {
  const data = await handleFetch(`/api/v1/external/client-approvals/${grantToken}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ decision, clientNotes }),
  });
  return data.data;
}
