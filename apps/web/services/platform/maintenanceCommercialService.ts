import * as XLSX from 'xlsx';
import type {
  ClientApproval,
  MaintenanceEstimate,
  MaintenanceFinancialReconciliation,
  MaintenanceItem,
  MaintenanceQuote,
  MaintenanceQuoteVersion,
  MaintenanceVariation,
  MaintenanceWorkOrder,
  PreventiveMaintenanceSchedule,
  PriceBook,
  PriceBookImport,
  PriceBookVersion,
  QuoteApprovalPolicy,
} from '../../types/platform';
import { apiRequest } from '../apiClient';

function agencyId(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.localStorage.getItem('pcr_agency_id') || window.localStorage.getItem('agencyId') || undefined;
}

async function externalRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const baseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
  if (!baseUrl) throw new Error('VITE_API_BASE_URL is required for external quote approval.');
  const response = await fetch(`${baseUrl.replace(/\/$/u, '')}${path}`, init);
  const payload = (await response.json().catch(() => ({}))) as { data?: T; error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || `Request failed with ${response.status}.`);
  if (payload.data === undefined) throw new Error('Response did not contain data.');
  return payload.data;
}

function idempotencyKey(prefix: string): string {
  const value = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${value}`;
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export interface MaintenanceOperationsOverview {
  candidates: { awaitingTriage: number; urgent: number };
  items: { total: number; awaitingPricing: number; pricingReview: number; overdue: number; verification: number };
  estimates: { total: number; reviewRequired: number };
  quotes: { total: number; awaitingInternalApproval: number; awaitingClient: number; accepted: number; pipelineValue: number };
  workOrders: { total: number; active: number };
  variations: { awaitingApproval: number };
  financials: { varianceReview: number };
  integrations: { syncExceptions: number };
}

export async function getMaintenanceOperationsOverview(): Promise<MaintenanceOperationsOverview> {
  return apiRequest(agencyId(), '/api/v1/maintenance-operations/overview');
}

export async function runMaintenanceAutomation(): Promise<Record<string, number>> {
  return apiRequest(agencyId(), '/api/v1/maintenance-operations/run-automation', {
    method: 'POST', body: {}, idempotencyKey: idempotencyKey('maintenance-automation'),
  });
}

export async function extractMaintenanceAutomatically(
  reportId: string,
  preliminary = false,
): Promise<{ created: unknown[]; existing: number; sourceVersionId?: string }> {
  return apiRequest(agencyId(), '/api/v1/maintenance-candidates/extract-automatic', {
    method: 'POST', body: { reportId, preliminary }, idempotencyKey: idempotencyKey(`maintenance-extract-${reportId}`),
  });
}

export interface ParsedSpreadsheet {
  fileName: string;
  contentType: string;
  fileSize: number;
  sha256: string;
  sheetName: string;
  rows: Array<Record<string, string | number | boolean | null>>;
}

export async function parsePriceBookSpreadsheet(file: File, preferredSheet?: string): Promise<ParsedSpreadsheet> {
  const bytes = await file.arrayBuffer();
  const workbook = XLSX.read(bytes, { type: 'array', cellDates: false, raw: false });
  const sheetName = (preferredSheet && workbook.SheetNames.includes(preferredSheet) ? preferredSheet : undefined) || workbook.SheetNames[0];
  if (!sheetName) throw new Error('Spreadsheet does not contain a worksheet.');
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error('Selected spreadsheet worksheet could not be read.');
  const rows = XLSX.utils.sheet_to_json<Record<string, string | number | boolean | null>>(sheet, { defval: null, raw: false });
  if (!rows.length) throw new Error('Spreadsheet does not contain any data rows.');
  return {
    fileName: file.name,
    contentType: file.type || (file.name.toLowerCase().endsWith('.csv') ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    fileSize: file.size,
    sha256: await sha256(file),
    sheetName,
    rows,
  };
}

export async function createPriceBookImport(parsed: ParsedSpreadsheet, proposedPriceBookName?: string): Promise<PriceBookImport> {
  return apiRequest(agencyId(), '/api/v1/price-book-imports', {
    method: 'POST', body: { ...parsed, proposedPriceBookName }, idempotencyKey: idempotencyKey(`price-book-import-${parsed.sha256.slice(0, 12)}`),
  });
}

export async function publishPriceBookImport(
  importRecord: PriceBookImport,
  input: { name?: string; currency?: string; effectiveFrom?: string } = {},
): Promise<{ priceBook: PriceBook; version: PriceBookVersion }> {
  return apiRequest(importRecord.agencyId || agencyId(), `/api/v1/price-book-imports/${encodeURIComponent(importRecord.id)}/publish`, {
    method: 'POST', body: input, idempotencyKey: idempotencyKey(`price-book-publish-${importRecord.id}`),
  });
}

export async function listPriceBookImports(): Promise<PriceBookImport[]> { return apiRequest(agencyId(), '/api/v1/price-book-imports'); }
export async function listPriceBooks(): Promise<PriceBook[]> { return apiRequest(agencyId(), '/api/v1/price-books'); }
export async function listPriceBookVersions(): Promise<PriceBookVersion[]> { return apiRequest(agencyId(), '/api/v1/price-book-versions'); }
export async function listMaintenanceEstimates(): Promise<MaintenanceEstimate[]> { return apiRequest(agencyId(), '/api/v1/maintenance-estimates'); }

export async function generateMaintenanceEstimate(
  maintenanceItem: MaintenanceItem,
  input: { preferredPriceBookId?: string; quantity?: number; afterHours?: boolean; saturday?: boolean; sunday?: boolean; publicHoliday?: boolean } = {},
): Promise<MaintenanceEstimate> {
  return apiRequest(maintenanceItem.agencyId, `/api/v1/maintenance-items/${encodeURIComponent(maintenanceItem.id)}/estimate`, {
    method: 'POST', body: input, idempotencyKey: idempotencyKey(`maintenance-estimate-${maintenanceItem.id}`),
  });
}

export async function createMaintenanceQuote(
  maintenanceItem: MaintenanceItem,
  estimate: MaintenanceEstimate,
  optionId?: string,
): Promise<{ quote: MaintenanceQuote; version: MaintenanceQuoteVersion; approval: { required: boolean; recipientType: string; reasons: string[]; emergencyOverrideAvailable: boolean } }> {
  return apiRequest(maintenanceItem.agencyId, `/api/v1/maintenance-items/${encodeURIComponent(maintenanceItem.id)}/quotes`, {
    method: 'POST', body: { estimateId: estimate.id, optionId }, idempotencyKey: idempotencyKey(`maintenance-quote-${maintenanceItem.id}`),
  });
}

export async function listMaintenanceQuotes(): Promise<MaintenanceQuote[]> { return apiRequest(agencyId(), '/api/v1/maintenance-quotes'); }
export async function listMaintenanceQuoteVersions(): Promise<MaintenanceQuoteVersion[]> { return apiRequest(agencyId(), '/api/v1/maintenance-quote-versions'); }

export async function transitionMaintenanceQuote(
  quote: MaintenanceQuote,
  action: 'request-pricing-review' | 'internal-approve' | 'ready' | 'send' | 'cancel' | 'supersede' | 'convert',
  body: Record<string, unknown> = {},
): Promise<unknown> {
  return apiRequest(quote.agencyId, `/api/v1/maintenance-quotes/${encodeURIComponent(quote.id)}/actions/${action}`, {
    method: 'POST', body: { expectedVersion: quote.version, ...body }, idempotencyKey: idempotencyKey(`maintenance-quote-${quote.id}-${action}`),
  });
}

export async function sendMaintenanceQuote(
  quote: MaintenanceQuote,
  recipientEmail?: string,
): Promise<{ quote: MaintenanceQuote; approval: ClientApproval; accessUrl: string; expiresAt: string }> {
  return transitionMaintenanceQuote(quote, 'send', { recipientEmail }) as Promise<{ quote: MaintenanceQuote; approval: ClientApproval; accessUrl: string; expiresAt: string }>;
}

export async function listMaintenanceWorkOrders(): Promise<MaintenanceWorkOrder[]> { return apiRequest(agencyId(), '/api/v1/maintenance-work-orders'); }
export async function listMaintenanceVariations(): Promise<MaintenanceVariation[]> { return apiRequest(agencyId(), '/api/v1/maintenance-variations'); }

export async function createMaintenanceVariation(
  input: Omit<MaintenanceVariation, 'id' | 'agencyId' | 'status' | 'requestedAt' | 'createdAt' | 'updatedAt' | 'version'>,
): Promise<MaintenanceVariation> {
  return apiRequest(agencyId(), '/api/v1/maintenance-variations', {
    method: 'POST', body: input, idempotencyKey: idempotencyKey('maintenance-variation'),
  });
}

export async function transitionMaintenanceVariation(
  variation: MaintenanceVariation,
  action: 'approve' | 'decline' | 'request-approval' | 'cancel',
): Promise<MaintenanceVariation> {
  return apiRequest(variation.agencyId, `/api/v1/maintenance-variations/${encodeURIComponent(variation.id)}/actions/${action}`, {
    method: 'POST', body: { expectedVersion: variation.version }, idempotencyKey: idempotencyKey(`maintenance-variation-${variation.id}-${action}`),
  });
}

export async function reconcileMaintenanceFinancials(input: {
  maintenanceItemId: string;
  quoteId: string;
  actualContractorCost?: number;
  clientInvoiceTotal?: number;
}): Promise<MaintenanceFinancialReconciliation> {
  return apiRequest(agencyId(), '/api/v1/maintenance-financial-reconciliations', {
    method: 'POST', body: input, idempotencyKey: idempotencyKey(`maintenance-reconcile-${input.maintenanceItemId}`),
  });
}

export async function listFinancialReconciliations(): Promise<MaintenanceFinancialReconciliation[]> {
  return apiRequest(agencyId(), '/api/v1/maintenance-financial-reconciliations');
}

export async function listQuoteApprovalPolicies(): Promise<QuoteApprovalPolicy[]> { return apiRequest(agencyId(), '/api/v1/quote-approval-policies'); }
export async function createQuoteApprovalPolicy(
  input: Partial<QuoteApprovalPolicy> & Pick<QuoteApprovalPolicy, 'name' | 'landlordApprovalThreshold'>,
): Promise<QuoteApprovalPolicy> {
  return apiRequest(agencyId(), '/api/v1/quote-approval-policies', { method: 'POST', body: input, idempotencyKey: idempotencyKey('quote-approval-policy') });
}

export async function listPreventiveMaintenanceSchedules(): Promise<PreventiveMaintenanceSchedule[]> {
  return apiRequest(agencyId(), '/api/v1/preventive-maintenance-schedules');
}

export async function savePreventiveMaintenanceSchedule(input: Partial<PreventiveMaintenanceSchedule>): Promise<PreventiveMaintenanceSchedule> {
  if (input.id && input.version) {
    return apiRequest(agencyId(), `/api/v1/preventive-maintenance-schedules/${encodeURIComponent(input.id)}`, {
      method: 'PATCH', body: { ...input, expectedVersion: input.version },
    });
  }
  return apiRequest(agencyId(), '/api/v1/preventive-maintenance-schedules', { method: 'POST', body: input });
}

export async function getExternalMaintenanceQuote(grantToken: string): Promise<{
  quote: MaintenanceQuote;
  version: MaintenanceQuoteVersion;
  maintenanceItem: Pick<MaintenanceItem, 'id' | 'title' | 'description' | 'priority' | 'category' | 'sourceEvidenceIds'>;
  propertyAddress: string;
  approval: ClientApproval;
}> {
  return externalRequest(`/api/v1/external/maintenance-quotes/${encodeURIComponent(grantToken)}`);
}

export async function submitExternalMaintenanceQuoteDecision(
  grantToken: string,
  decision: 'accepted' | 'declined' | 'information_requested',
  comments?: string,
): Promise<{ quote: MaintenanceQuote; approvalStatus: string; workOrder?: MaintenanceWorkOrder }> {
  return externalRequest(`/api/v1/external/maintenance-quotes/${encodeURIComponent(grantToken)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision, comments }),
  });
}
