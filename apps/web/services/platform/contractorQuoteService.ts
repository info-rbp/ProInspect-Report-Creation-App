import type {
  ContractorQuote,
  ContractorQuoteRequest,
  ExternalContact,
  MaintenanceEstimate,
  MaintenanceItem,
} from '../../types/platform';
import { apiRequest } from '../apiClient';

function agencyId(): string | undefined {
  if (typeof window === 'undefined') return 'agency-1';
  return window.localStorage.getItem('pcr_agency_id') || window.localStorage.getItem('agencyId') || 'agency-1';
}

function key(prefix: string): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

async function externalRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const baseUrl = import.meta.env.VITE_API_BASE_URL?.trim() || '';
  const response = await fetch(`${baseUrl.replace(/\/$/u, '')}${path}`, init);
  const payload = (await response.json().catch(() => ({}))) as {
    data?: T;
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(payload.error?.message || `Request failed with ${response.status}.`);
  if (payload.data === undefined) throw new Error('Response did not contain data.');
  return payload.data;
}

export async function listContractorQuoteRequests(): Promise<ContractorQuoteRequest[]> {
  return apiRequest(agencyId(), '/api/v1/contractor-quote-requests');
}

export async function listContractorQuotes(): Promise<ContractorQuote[]> {
  return apiRequest(agencyId(), '/api/v1/contractor-quotes');
}

export async function createContractorQuoteRequest(input: {
  maintenanceItemId: string;
  contractorIds: string[];
  scope: string;
  dueAt?: string;
}): Promise<ContractorQuoteRequest> {
  return apiRequest(agencyId(), '/api/v1/contractor-quote-requests', {
    method: 'POST',
    body: input,
    idempotencyKey: key('contractor-rfq'),
  });
}

export async function issueContractorQuoteRequest(
  request: ContractorQuoteRequest,
): Promise<{
  request: ContractorQuoteRequest;
  links: Array<{ externalContactId: string; email: string; accessUrl: string; expiresAt: string }>;
}> {
  return apiRequest(
    request.agencyId,
    `/api/v1/contractor-quote-requests/${encodeURIComponent(request.id)}/actions/issue`,
    {
      method: 'POST',
      body: { expectedVersion: request.version },
      idempotencyKey: key(`contractor-rfq-${request.id}-issue`),
    },
  );
}

export async function selectContractorQuote(
  request: ContractorQuoteRequest,
  contractorQuoteId: string,
): Promise<{
  requestId: string;
  contractorQuote: ContractorQuote;
  estimate: MaintenanceEstimate;
}> {
  return apiRequest(
    request.agencyId,
    `/api/v1/contractor-quote-requests/${encodeURIComponent(request.id)}/actions/select`,
    {
      method: 'POST',
      body: { expectedVersion: request.version, contractorQuoteId },
      idempotencyKey: key(`contractor-rfq-${request.id}-select`),
    },
  );
}

export async function getExternalContractorQuoteRequest(grantToken: string): Promise<{
  request: ContractorQuoteRequest;
  contractor: Pick<ExternalContact, 'id' | 'name' | 'businessName' | 'email'>;
  maintenanceItem: Pick<
    MaintenanceItem,
    'id' | 'title' | 'description' | 'category' | 'priority' | 'sourceEvidenceIds'
  >;
  propertyAddress: string;
}> {
  return externalRequest(`/api/v1/external/contractor-quotes/${encodeURIComponent(grantToken)}`);
}

export async function submitExternalContractorQuote(
  grantToken: string,
  input: {
    scope: string;
    exclusions?: string[];
    estimatedStartAt?: string;
    estimatedCompletionAt?: string;
    subtotal: number;
    tax: number;
    currency?: string;
    evidenceDocumentIds?: string[];
  },
): Promise<ContractorQuote> {
  return externalRequest(`/api/v1/external/contractor-quotes/${encodeURIComponent(grantToken)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}
