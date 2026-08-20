import type {
  ClientApproval,
  ExternalContact,
  MaintenanceCandidate,
  MaintenanceItem,
  TenantInstruction,
  WorkRequest,
} from '../../types/platform';
import { apiRequest } from '../apiClient';

function agencyId(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.localStorage.getItem('pcr_agency_id') || window.localStorage.getItem('agencyId') || undefined;
}

async function externalRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const baseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
  if (!baseUrl) throw new Error('VITE_API_BASE_URL is required for external portal operations.');
  const response = await fetch(`${baseUrl.replace(/\/$/u, '')}${path}`, init);
  const payload = await response.json().catch(() => ({})) as { data?: T; error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || `External portal request failed with ${response.status}.`);
  if (payload.data === undefined) throw new Error('External portal response did not contain data.');
  return payload.data;
}

async function lifecycleAction<T>(
  resource: 'maintenance-items' | 'work-requests' | 'tenant-instructions',
  id: string,
  action: string,
  expectedVersion: number,
  body: Record<string, unknown> = {},
): Promise<T> {
  return apiRequest<T>(agencyId(), `/api/v1/${resource}/${encodeURIComponent(id)}/actions/${encodeURIComponent(action)}`, {
    method: 'POST',
    body: { expectedVersion, ...body },
  });
}

export async function listMaintenanceCandidates(): Promise<MaintenanceCandidate[]> {
  return apiRequest<MaintenanceCandidate[]>(agencyId(), '/api/v1/maintenance-candidates');
}

export async function extractMaintenanceCandidates(reportId: string): Promise<MaintenanceCandidate[]> {
  return apiRequest<MaintenanceCandidate[]>(agencyId(), '/api/v1/maintenance-candidates/extract', {
    method: 'POST',
    body: { reportId },
  });
}

export async function confirmMaintenanceCandidate(
  candidateId: string,
  overrides?: {
    title?: string;
    description?: string;
    category?: string;
    priority?: string;
    workInstruction?: string;
    recommendedAction?: string;
    approvalRequired?: boolean;
  },
): Promise<MaintenanceItem> {
  return apiRequest<MaintenanceItem>(agencyId(), `/api/v1/maintenance-candidates/${candidateId}/confirm`, {
    method: 'POST',
    body: overrides || {},
  });
}

export async function dismissMaintenanceCandidate(
  candidateId: string,
  reason: string,
  expectedVersion = 1,
): Promise<MaintenanceCandidate> {
  return apiRequest<MaintenanceCandidate>(agencyId(), `/api/v1/maintenance-candidates/${candidateId}`, {
    method: 'PATCH',
    body: { reviewStatus: 'dismissed', dismissedReason: reason, expectedVersion },
  });
}

export async function listMaintenanceItems(): Promise<MaintenanceItem[]> {
  return apiRequest<MaintenanceItem[]>(agencyId(), '/api/v1/maintenance-items');
}

export async function getMaintenanceItem(id: string): Promise<MaintenanceItem> {
  return apiRequest<MaintenanceItem>(agencyId(), `/api/v1/maintenance-items/${id}`);
}

export async function createMaintenanceItem(input: Partial<MaintenanceItem>): Promise<MaintenanceItem> {
  return apiRequest<MaintenanceItem>(agencyId(), '/api/v1/maintenance-items/create', { method: 'POST', body: input });
}

export async function transitionMaintenanceItem(
  id: string,
  action: 'approve' | 'assign' | 'start' | 'await_evidence' | 'submit_completion' | 'verify' | 'close' | 'reopen' | 'cancel' | 'dismiss' | 'duplicate' | 'not_actionable',
  expectedVersion: number,
  body: Record<string, unknown> = {},
): Promise<MaintenanceItem> {
  return lifecycleAction<MaintenanceItem>('maintenance-items', id, action, expectedVersion, body);
}

export async function listExternalContacts(): Promise<ExternalContact[]> {
  return apiRequest<ExternalContact[]>(agencyId(), '/api/v1/external-contacts');
}

export async function createExternalContact(input: Partial<ExternalContact>): Promise<ExternalContact> {
  return apiRequest<ExternalContact>(agencyId(), '/api/v1/external-contacts', { method: 'POST', body: input });
}

export async function listWorkRequests(): Promise<WorkRequest[]> {
  return apiRequest<WorkRequest[]>(agencyId(), '/api/v1/work-requests');
}

export async function createWorkRequest(input: Partial<WorkRequest>): Promise<WorkRequest> {
  return apiRequest<WorkRequest>(agencyId(), '/api/v1/work-requests/create', {
    method: 'POST',
    body: input,
  });
}

export async function transitionWorkRequest(
  id: string,
  action: 'issue' | 'accept' | 'cancel',
  expectedVersion: number,
  body: Record<string, unknown> = {},
): Promise<WorkRequest> {
  return lifecycleAction<WorkRequest>('work-requests', id, action, expectedVersion, body);
}

export async function listTenantInstructions(): Promise<TenantInstruction[]> {
  return apiRequest<TenantInstruction[]>(agencyId(), '/api/v1/tenant-instructions');
}

export async function createTenantInstruction(input: Partial<TenantInstruction>): Promise<TenantInstruction> {
  return apiRequest<TenantInstruction>(agencyId(), '/api/v1/tenant-instructions/create', {
    method: 'POST',
    body: input,
  });
}

export async function transitionTenantInstruction(
  id: string,
  action: 'request_approval' | 'approve' | 'issue' | 'await_action' | 'review_response' | 'resolve' | 'close' | 'withdraw' | 'cancel',
  expectedVersion: number,
  body: Record<string, unknown> = {},
): Promise<TenantInstruction> {
  return lifecycleAction<TenantInstruction>('tenant-instructions', id, action, expectedVersion, body);
}

export async function listClientApprovals(): Promise<ClientApproval[]> {
  return apiRequest<ClientApproval[]>(agencyId(), '/api/v1/client-approvals');
}

export async function createClientApproval(input: Partial<ClientApproval>): Promise<ClientApproval> {
  return apiRequest<ClientApproval>(agencyId(), '/api/v1/client-approvals', {
    method: 'POST',
    body: { ...input, status: input.status || 'pending' },
  });
}

export async function generateAccessGrant(
  resourceType: 'work_request' | 'tenant_instruction' | 'client_approval',
  resourceId: string,
  recipientEmail: string,
  expiresInHours = 72,
): Promise<{ grantId: string; grantToken: string; expiresAt: string; accessUrl: string }> {
  return apiRequest(agencyId(), '/api/v1/external-access-grants/generate', {
    method: 'POST',
    body: { resourceType, resourceId, recipientEmail, expiresInHours },
  });
}

export async function getExternalWorkRequest(
  grantToken: string,
): Promise<{ workRequest: WorkRequest; maintenanceItem: Partial<MaintenanceItem> | null; propertyAddress: string }> {
  return externalRequest(`/api/v1/external/work-requests/${encodeURIComponent(grantToken)}`);
}

export async function submitExternalWorkResponse(
  grantToken: string,
  action: 'acknowledge' | 'in_progress' | 'complete' | 'unable_to_complete',
  responseNotes?: string,
  completionEvidenceIds?: string[],
): Promise<WorkRequest> {
  return externalRequest(`/api/v1/external/work-requests/${encodeURIComponent(grantToken)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, responseNotes, completionEvidenceIds }),
  });
}

export async function getExternalTenantInstruction(grantToken: string): Promise<TenantInstruction> {
  return externalRequest(`/api/v1/external/tenant-instructions/${encodeURIComponent(grantToken)}`);
}

export async function submitExternalTenantResponse(
  grantToken: string,
  tenantResponseNote: string,
  tenantEvidenceIds?: string[],
): Promise<TenantInstruction> {
  return externalRequest(`/api/v1/external/tenant-instructions/${encodeURIComponent(grantToken)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tenantResponseNote, tenantEvidenceIds }),
  });
}

export async function getExternalClientApproval(grantToken: string): Promise<ClientApproval> {
  return externalRequest(`/api/v1/external/client-approvals/${encodeURIComponent(grantToken)}`);
}

export async function submitExternalClientApproval(
  grantToken: string,
  decision: 'approved' | 'declined' | 'information_requested',
  clientNotes?: string,
): Promise<ClientApproval> {
  return externalRequest(`/api/v1/external/client-approvals/${encodeURIComponent(grantToken)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ decision, clientNotes }),
  });
}
