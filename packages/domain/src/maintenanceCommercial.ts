import type {
  ClientApproval,
  ExternalContact,
  MaintenanceCandidate,
  MaintenanceCategory,
  MaintenanceItem,
  MaintenancePriority,
  WorkRequest,
} from './maintenance.js';
import type { Client, PropertyAsset, PropertyUse } from './platform.js';

export const PRICE_BOOK_STATUSES = ['draft', 'published', 'retired'] as const;
export type PriceBookStatus = (typeof PRICE_BOOK_STATUSES)[number];

export const PRICE_BOOK_IMPORT_STATUSES = [
  'uploaded',
  'parsing',
  'review_required',
  'validated',
  'published',
  'rejected',
  'failed',
] as const;
export type PriceBookImportStatus = (typeof PRICE_BOOK_IMPORT_STATUSES)[number];

export const PRICE_BOOK_UNITS = [
  'each',
  'hour',
  'metre',
  'square_metre',
  'linear_metre',
  'room',
  'visit',
  'fixed',
  'day',
  'item',
] as const;
export type PriceBookUnit = (typeof PRICE_BOOK_UNITS)[number];

export const MAINTENANCE_ISSUE_TYPES = [
  'leak',
  'blockage',
  'not_working',
  'intermittent_fault',
  'damaged',
  'deteriorated',
  'loose',
  'missing',
  'cleaning_required',
  'pest_activity',
  'safety_hazard',
  'compliance_issue',
  'preventive_service',
  'replacement_recommended',
  'site_assessment_required',
  'other',
] as const;
export type MaintenanceIssueType = (typeof MAINTENANCE_ISSUE_TYPES)[number];

export const MAINTENANCE_SAFETY_CLASSIFICATIONS = [
  'none',
  'low',
  'potential_hazard',
  'urgent_hazard',
  'emergency',
] as const;
export type MaintenanceSafetyClassification =
  (typeof MAINTENANCE_SAFETY_CLASSIFICATIONS)[number];

export const ESTIMATE_STATUSES = [
  'suggested',
  'review_required',
  'approved',
  'superseded',
  'rejected',
] as const;
export type MaintenanceEstimateStatus = (typeof ESTIMATE_STATUSES)[number];

export const MAINTENANCE_QUOTE_STATUSES = [
  'draft',
  'pricing_review_required',
  'internally_approved',
  'ready_to_send',
  'sent',
  'viewed',
  'information_requested',
  'accepted',
  'declined',
  'expired',
  'superseded',
  'cancelled',
  'converted_to_work_order',
  'invoiced',
] as const;
export type MaintenanceQuoteStatus = (typeof MAINTENANCE_QUOTE_STATUSES)[number];

export const MAINTENANCE_QUOTE_TRANSITIONS: Readonly<
  Record<MaintenanceQuoteStatus, readonly MaintenanceQuoteStatus[]>
> = Object.freeze({
  draft: ['pricing_review_required', 'internally_approved', 'cancelled'],
  pricing_review_required: ['draft', 'internally_approved', 'cancelled'],
  internally_approved: ['ready_to_send', 'cancelled'],
  ready_to_send: ['sent', 'cancelled'],
  sent: ['viewed', 'accepted', 'declined', 'information_requested', 'expired', 'cancelled'],
  viewed: ['accepted', 'declined', 'information_requested', 'expired', 'cancelled'],
  information_requested: ['draft', 'sent', 'accepted', 'declined', 'expired', 'cancelled'],
  accepted: ['converted_to_work_order', 'superseded', 'cancelled'],
  declined: ['superseded'],
  expired: ['superseded'],
  superseded: [],
  cancelled: [],
  converted_to_work_order: ['invoiced'],
  invoiced: [],
});

export type MaintenanceQuoteOptionType =
  | 'repair'
  | 'replace'
  | 'site_assessment'
  | 'make_safe'
  | 'custom';

export type MaintenancePricingStatus =
  | 'not_started'
  | 'price_match_found'
  | 'estimate_generated'
  | 'review_required'
  | 'contractor_quote_required'
  | 'quote_ready'
  | 'quote_sent'
  | 'quote_approved'
  | 'not_quoteable';

export type XeroSyncStatus =
  | 'not_connected'
  | 'pending'
  | 'synchronised'
  | 'attention_required'
  | 'failed';

export interface PriceBookSourceDocument {
  fileName: string;
  contentType: string;
  fileSize: number;
  sha256: string;
  objectPath?: string;
  generation?: string;
  uploadedBy: string;
  uploadedAt: string;
}

export interface PriceBookImportColumnMapping {
  sourceColumn: string;
  canonicalField: keyof PriceBookEntry | 'ignore';
}

export interface PriceBookImportRow {
  rowNumber: number;
  rawValues: Record<string, string | number | boolean | null>;
  parsedEntry?: PriceBookEntry;
  errors: string[];
  warnings: string[];
}

export interface PriceBookImport {
  id: string;
  agencyId: string;
  status: PriceBookImportStatus;
  source: PriceBookSourceDocument;
  sheetName?: string;
  headerRow?: number;
  columnMappings: PriceBookImportColumnMapping[];
  rows: PriceBookImportRow[];
  validRowCount: number;
  warningRowCount: number;
  rejectedRowCount: number;
  proposedPriceBookName?: string;
  publishedPriceBookId?: string;
  publishedVersionId?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface PriceBookEntry {
  id: string;
  code: string;
  active: boolean;
  trade: string;
  category: MaintenanceCategory;
  componentPattern?: string;
  issueType?: MaintenanceIssueType;
  recommendedAction?: string;
  keywords: string[];
  propertyUses: PropertyUse[];
  physicalPropertyTypes: string[];
  regions: string[];
  postcodes: string[];
  unit: PriceBookUnit;
  defaultQuantity: number;
  minimumQuantity?: number;
  maximumQuantity?: number;
  labourHours: number;
  labourRate: number;
  materialCost: number;
  calloutCost: number;
  travelCost: number;
  disposalCost: number;
  subcontractorCost: number;
  contractorCost?: number;
  markupPercent: number;
  fixedMargin: number;
  administrationFee: number;
  minimumSellPrice?: number;
  gstRate: number;
  taxable: boolean;
  urgentMultiplier?: number;
  afterHoursMultiplier?: number;
  saturdayMultiplier?: number;
  sundayMultiplier?: number;
  publicHolidayMultiplier?: number;
  clientDescription: string;
  inclusions: string[];
  exclusions: string[];
  warrantyDays?: number;
  siteAssessmentRequired: boolean;
  automationConfidenceThreshold: number;
  xeroItemCode?: string;
  xeroSalesAccountCode?: string;
  xeroPurchaseAccountCode?: string;
  xeroTaxType?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  sourceRowNumber?: number;
}

export interface PriceBookVersion {
  id: string;
  agencyId: string;
  priceBookId: string;
  versionNumber: number;
  status: PriceBookStatus;
  effectiveFrom: string;
  effectiveTo?: string;
  sourceImportId?: string;
  contentHash: string;
  entries: PriceBookEntry[];
  publishedBy?: string;
  publishedAt?: string;
  retiredBy?: string;
  retiredAt?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface PriceBook {
  id: string;
  agencyId: string;
  name: string;
  description?: string;
  currency: string;
  status: 'active' | 'inactive';
  currentPublishedVersionId?: string;
  currentPublishedVersionNumber?: number;
  defaultForPropertyUses: PropertyUse[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface EstimateContext {
  propertyUse?: PropertyUse;
  physicalPropertyType?: string;
  region?: string;
  postcode?: string;
  quantity?: number;
  urgent?: boolean;
  afterHours?: boolean;
  saturday?: boolean;
  sunday?: boolean;
  publicHoliday?: boolean;
}

export interface PriceBookMatch {
  entry: PriceBookEntry;
  score: number;
  reasons: string[];
  conflicts: string[];
}

export interface MaintenanceEstimateLine {
  id: string;
  priceBookEntryId?: string;
  priceCode?: string;
  description: string;
  quantity: number;
  unit: PriceBookUnit;
  labourCost: number;
  materialCost: number;
  calloutCost: number;
  travelCost: number;
  disposalCost: number;
  subcontractorCost: number;
  otherDirectCost: number;
  directCost: number;
  markupAmount: number;
  administrationFee: number;
  sellPriceExcludingTax: number;
  taxAmount: number;
  totalIncludingTax: number;
  confidence: number;
  matchReasons: string[];
  requiresReview: boolean;
  xeroItemCode?: string;
  xeroAccountCode?: string;
  xeroTaxType?: string;
}

export interface MaintenanceEstimateOption {
  id: string;
  type: MaintenanceQuoteOptionType;
  label: string;
  description: string;
  recommended: boolean;
  lineItems: MaintenanceEstimateLine[];
  subtotal: number;
  tax: number;
  total: number;
  exclusions: string[];
  warrantyDays?: number;
  siteAssessmentRequired: boolean;
}

export interface MaintenanceEstimate {
  id: string;
  agencyId: string;
  maintenanceItemId: string;
  priceBookId?: string;
  priceBookVersionId?: string;
  status: MaintenanceEstimateStatus;
  currency: string;
  options: MaintenanceEstimateOption[];
  selectedOptionId?: string;
  confidence: number;
  reviewReasons: string[];
  sourceFingerprint: string;
  calculatedAt: string;
  calculatedBy: string;
  approvedBy?: string;
  approvedAt?: string;
  supersededByEstimateId?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface MaintenanceQuoteLineItem {
  id: string;
  estimateLineId?: string;
  priceCode?: string;
  itemCode?: string;
  description: string;
  quantity: number;
  unit: PriceBookUnit;
  unitAmountExcludingTax: number;
  lineAmountExcludingTax: number;
  taxRate: number;
  taxAmount: number;
  lineTotalIncludingTax: number;
  internalDirectCost?: number;
  internalMarginAmount?: number;
  accountCode?: string;
  taxType?: string;
}

export interface MaintenanceQuoteVersion {
  id: string;
  agencyId: string;
  quoteId: string;
  versionNumber: number;
  immutable: true;
  status: MaintenanceQuoteStatus;
  optionType: MaintenanceQuoteOptionType;
  title: string;
  summary: string;
  scope: string;
  lineItems: MaintenanceQuoteLineItem[];
  subtotal: number;
  totalTax: number;
  total: number;
  currency: string;
  terms?: string;
  inclusions: string[];
  exclusions: string[];
  warrantyDays?: number;
  validUntil?: string;
  sourceEstimateId?: string;
  priceBookVersionId?: string;
  evidencePhotoIds: string[];
  contentHash: string;
  createdBy: string;
  createdAt: string;
}

export interface MaintenanceQuote {
  id: string;
  agencyId: string;
  maintenanceItemId: string;
  propertyId: string;
  clientId?: string;
  recipientEmail?: string;
  quoteNumber: string;
  status: MaintenanceQuoteStatus;
  currentVersionId?: string;
  currentVersionNumber?: number;
  selectedOptionType: MaintenanceQuoteOptionType;
  currency: string;
  subtotal: number;
  totalTax: number;
  total: number;
  approvalRequired: boolean;
  approvalPolicyId?: string;
  internalApprovalBy?: string;
  internalApprovedAt?: string;
  clientApprovalId?: string;
  sentAt?: string;
  viewedAt?: string;
  acceptedAt?: string;
  declinedAt?: string;
  informationRequestedAt?: string;
  expiresAt?: string;
  supersededByQuoteId?: string;
  workOrderId?: string;
  xeroQuoteId?: string;
  xeroQuoteNumber?: string;
  xeroStatus?: XeroSyncStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface QuoteApprovalPolicy {
  id: string;
  agencyId: string;
  name: string;
  active: boolean;
  propertyUses: PropertyUse[];
  propertyManagerDelegatedLimit?: number;
  landlordApprovalThreshold: number;
  secondApprovalThreshold?: number;
  emergencyAuthorisationLimit?: number;
  mandatoryReplacementApproval: boolean;
  mandatoryCapitalApproval: boolean;
  mandatoryCosmeticApproval: boolean;
  autoApprovePreauthorisedServices: boolean;
  approvalLinkExpiryHours: number;
  reminderHours: number[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface ApprovalRequirement {
  required: boolean;
  recipientType: 'property_manager' | 'landlord' | 'second_approver' | 'none';
  reasons: string[];
  emergencyOverrideAvailable: boolean;
}

export interface ContractorQuoteRequest {
  id: string;
  agencyId: string;
  maintenanceItemId: string;
  contractorIds: string[];
  status: 'draft' | 'issued' | 'responses_received' | 'selected' | 'cancelled' | 'expired';
  scope: string;
  evidencePhotoIds: string[];
  dueAt?: string;
  selectedContractorQuoteId?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface ContractorQuote {
  id: string;
  agencyId: string;
  contractorQuoteRequestId: string;
  maintenanceItemId: string;
  externalContactId: string;
  status: 'submitted' | 'selected' | 'declined' | 'withdrawn' | 'expired';
  scope: string;
  exclusions: string[];
  estimatedStartAt?: string;
  estimatedCompletionAt?: string;
  subtotal: number;
  tax: number;
  total: number;
  currency: string;
  evidenceDocumentIds: string[];
  submittedAt: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface MaintenanceWorkOrder {
  id: string;
  agencyId: string;
  maintenanceItemId: string;
  quoteId: string;
  quoteVersionId: string;
  externalContactId?: string;
  workOrderNumber: string;
  status:
    | 'draft'
    | 'issued'
    | 'acknowledged'
    | 'scheduled'
    | 'in_progress'
    | 'completion_submitted'
    | 'verified'
    | 'closed'
    | 'cancelled';
  scope: string;
  approvedAmount: number;
  contractorAmount?: number;
  currency: string;
  scheduledStartAt?: string;
  scheduledEndAt?: string;
  variationIds: string[];
  xeroPurchaseOrderId?: string;
  xeroPurchaseOrderNumber?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface MaintenanceVariation {
  id: string;
  agencyId: string;
  maintenanceItemId: string;
  workOrderId: string;
  quoteId: string;
  status: 'requested' | 'review_required' | 'approval_required' | 'approved' | 'declined' | 'cancelled';
  reason: string;
  scopeChange: string;
  amountExcludingTax: number;
  taxAmount: number;
  total: number;
  evidenceIds: string[];
  requestedBy: string;
  requestedAt: string;
  approvedBy?: string;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface MaintenanceFinancialReconciliation {
  id: string;
  agencyId: string;
  maintenanceItemId: string;
  quoteId: string;
  workOrderId?: string;
  approvedQuoteTotal: number;
  approvedContractorCost?: number;
  variationTotal: number;
  actualContractorCost?: number;
  clientInvoiceTotal?: number;
  grossMarginAmount?: number;
  grossMarginPercent?: number;
  status: 'pending' | 'matched' | 'variance_review_required' | 'complete';
  varianceReasons: string[];
  xeroInvoiceId?: string;
  xeroBillId?: string;
  reconciledBy?: string;
  reconciledAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface XeroConnection {
  id: string;
  agencyId: string;
  status: 'pending' | 'connected' | 'attention_required' | 'disconnected';
  tenantId?: string;
  tenantName?: string;
  credentialReference?: string;
  scopes: string[];
  connectionType: 'oauth_authorisation_code' | 'custom_connection';
  salesAccountCode?: string;
  purchaseAccountCode?: string;
  defaultTaxType?: string;
  lastSuccessfulSyncAt?: string;
  lastAttemptedSyncAt?: string;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface XeroSyncException {
  id: string;
  agencyId: string;
  resourceType: 'contact' | 'item' | 'quote' | 'purchase_order' | 'invoice' | 'attachment';
  internalId: string;
  externalId?: string;
  operation: 'create' | 'update' | 'reconcile' | 'download_pdf' | 'attach';
  severity: 'warning' | 'critical';
  status: 'open' | 'retrying' | 'resolved' | 'ignored';
  code: string;
  message: string;
  attemptCount: number;
  lastAttemptedAt?: string;
  resolvedAt?: string;
  resolvedBy?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface PreventiveMaintenanceSchedule {
  id: string;
  agencyId: string;
  propertyId: string;
  assetId?: string;
  title: string;
  category: MaintenanceCategory;
  cadence: 'monthly' | 'quarterly' | 'six_monthly' | 'annual' | 'custom_days';
  customIntervalDays?: number;
  nextDueAt: string;
  lastCompletedAt?: string;
  priceCode?: string;
  defaultContractorId?: string;
  paused: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface WarrantyClaim {
  id: string;
  agencyId: string;
  maintenanceItemId: string;
  propertyId: string;
  assetId?: string;
  previousWorkOrderId?: string;
  providerName?: string;
  warrantyExpiresAt?: string;
  status: 'review_required' | 'eligible' | 'lodged' | 'accepted' | 'declined' | 'resolved';
  claimReference?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

function money(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function words(value: string | undefined): string[] {
  return (value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
}

export function maintenanceFingerprint(input: {
  propertyId: string;
  reportId?: string;
  reportVersionId?: string;
  areaId?: string;
  componentId?: string;
  issueType?: string;
  description?: string;
}): string {
  return [
    input.propertyId,
    input.reportId || '',
    input.reportVersionId || '',
    input.areaId || '',
    input.componentId || '',
    input.issueType || '',
    words(input.description).slice(0, 12).join('-'),
  ].join('|');
}

export function inferMaintenanceIssueType(input: {
  title?: string;
  description?: string;
  recommendedAction?: string;
}): MaintenanceIssueType {
  const text = words(`${input.title || ''} ${input.description || ''} ${input.recommendedAction || ''}`).join(' ');
  if (/\b(leak|leaking|drip|water escape)\b/u.test(text)) return 'leak';
  if (/\b(blocked|blockage|clogged|slow drain)\b/u.test(text)) return 'blockage';
  if (/\b(not working|inoperative|failed|no power|does not operate)\b/u.test(text)) return 'not_working';
  if (/\b(intermittent|occasionally|cuts out)\b/u.test(text)) return 'intermittent_fault';
  if (/\b(missing|not present)\b/u.test(text)) return 'missing';
  if (/\b(clean|cleaning|stained|soiled|mould)\b/u.test(text)) return 'cleaning_required';
  if (/\b(pest|termite|rodent|cockroach|ant activity)\b/u.test(text)) return 'pest_activity';
  if (/\b(safety|hazard|danger|exposed wire|smoke alarm)\b/u.test(text)) return 'safety_hazard';
  if (/\b(compliance|certificate|non compliant|non-compliant)\b/u.test(text)) return 'compliance_issue';
  if (/\b(replace|replacement)\b/u.test(text)) return 'replacement_recommended';
  if (/\b(loose|unstable)\b/u.test(text)) return 'loose';
  if (/\b(deteriorat|corrosion|rott|worn)\b/u.test(text)) return 'deteriorated';
  if (/\b(damage|broken|cracked|chipped|hole)\b/u.test(text)) return 'damaged';
  return 'other';
}

function applies(entry: PriceBookEntry, context: EstimateContext): boolean {
  if (!entry.active) return false;
  const now = Date.now();
  if (entry.effectiveFrom && Date.parse(entry.effectiveFrom) > now) return false;
  if (entry.effectiveTo && Date.parse(entry.effectiveTo) < now) return false;
  if (entry.propertyUses.length && context.propertyUse && !entry.propertyUses.includes(context.propertyUse)) {
    return false;
  }
  if (
    entry.physicalPropertyTypes.length &&
    context.physicalPropertyType &&
    !entry.physicalPropertyTypes.includes(context.physicalPropertyType)
  ) {
    return false;
  }
  if (entry.regions.length && context.region && !entry.regions.includes(context.region)) return false;
  if (entry.postcodes.length && context.postcode && !entry.postcodes.includes(context.postcode)) return false;
  return true;
}

export function matchPriceBookEntries(
  item: Pick<
    MaintenanceItem,
    'title' | 'description' | 'category' | 'priority' | 'sourceComponentId'
  > & { issueType?: MaintenanceIssueType; recommendedAction?: string },
  entries: PriceBookEntry[],
  context: EstimateContext = {},
): PriceBookMatch[] {
  const textTokens = new Set(
    words(
      `${item.title} ${item.description} ${item.sourceComponentId || ''} ${item.recommendedAction || ''}`,
    ),
  );
  const issueType = item.issueType || inferMaintenanceIssueType(item);
  return entries
    .filter((entry) => applies(entry, context))
    .map((entry) => {
      let score = 0;
      const reasons: string[] = [];
      const conflicts: string[] = [];
      if (entry.category === item.category) {
        score += 0.25;
        reasons.push('Maintenance category matches.');
      } else {
        conflicts.push('Maintenance category differs.');
      }
      if (entry.issueType && entry.issueType === issueType) {
        score += 0.3;
        reasons.push('Issue type matches.');
      } else if (entry.issueType) {
        conflicts.push('Issue type differs.');
      }
      const componentTokens = words(entry.componentPattern);
      const componentMatches = componentTokens.filter((token) => textTokens.has(token)).length;
      if (componentTokens.length) {
        const componentScore = componentMatches / componentTokens.length;
        score += componentScore * 0.25;
        if (componentScore >= 0.5) reasons.push('Component description matches.');
      }
      const keywordMatches = entry.keywords.filter((keyword) =>
        words(keyword).some((token) => textTokens.has(token)),
      ).length;
      if (entry.keywords.length) {
        const keywordScore = keywordMatches / entry.keywords.length;
        score += Math.min(0.15, keywordScore * 0.15);
        if (keywordMatches) reasons.push(`${keywordMatches} pricing keyword(s) match.`);
      }
      if (
        entry.recommendedAction &&
        item.recommendedAction &&
        words(entry.recommendedAction).some((token) => words(item.recommendedAction).includes(token))
      ) {
        score += 0.05;
        reasons.push('Recommended action matches.');
      }
      return { entry, score: Math.max(0, Math.min(1, score)), reasons, conflicts };
    })
    .filter((match) => match.score >= 0.35)
    .sort((left, right) => right.score - left.score);
}

function multiplier(entry: PriceBookEntry, context: EstimateContext): number {
  if (context.publicHoliday) return entry.publicHolidayMultiplier || 1;
  if (context.sunday) return entry.sundayMultiplier || 1;
  if (context.saturday) return entry.saturdayMultiplier || 1;
  if (context.afterHours) return entry.afterHoursMultiplier || 1;
  if (context.urgent) return entry.urgentMultiplier || 1;
  return 1;
}

export function calculateEstimateLine(
  entry: PriceBookEntry,
  context: EstimateContext,
  match: Pick<PriceBookMatch, 'score' | 'reasons'>,
): MaintenanceEstimateLine {
  const requestedQuantity = context.quantity ?? entry.defaultQuantity ?? 1;
  const quantity = Math.max(
    entry.minimumQuantity || 0,
    Math.min(entry.maximumQuantity || Number.MAX_SAFE_INTEGER, requestedQuantity),
  );
  const labourCost = entry.labourHours * entry.labourRate * quantity;
  const materialCost = entry.materialCost * quantity;
  const directBeforeMultiplier =
    labourCost +
    materialCost +
    entry.calloutCost +
    entry.travelCost +
    entry.disposalCost +
    entry.subcontractorCost +
    (entry.contractorCost || 0);
  const directCost = money(directBeforeMultiplier * multiplier(entry, context));
  const markupAmount = money((directCost * entry.markupPercent) / 100 + entry.fixedMargin);
  const calculatedSell = directCost + markupAmount + entry.administrationFee;
  const sellPriceExcludingTax = money(
    Math.max(entry.minimumSellPrice || 0, calculatedSell),
  );
  const taxAmount = entry.taxable ? money(sellPriceExcludingTax * entry.gstRate) : 0;
  return {
    id: `estimate-line-${entry.id}`,
    priceBookEntryId: entry.id,
    priceCode: entry.code,
    description: entry.clientDescription,
    quantity,
    unit: entry.unit,
    labourCost: money(labourCost),
    materialCost: money(materialCost),
    calloutCost: money(entry.calloutCost),
    travelCost: money(entry.travelCost),
    disposalCost: money(entry.disposalCost),
    subcontractorCost: money(entry.subcontractorCost + (entry.contractorCost || 0)),
    otherDirectCost: 0,
    directCost,
    markupAmount,
    administrationFee: money(entry.administrationFee),
    sellPriceExcludingTax,
    taxAmount,
    totalIncludingTax: money(sellPriceExcludingTax + taxAmount),
    confidence: match.score,
    matchReasons: match.reasons,
    requiresReview:
      entry.siteAssessmentRequired || match.score < entry.automationConfidenceThreshold,
    ...(entry.xeroItemCode ? { xeroItemCode: entry.xeroItemCode } : {}),
    ...(entry.xeroSalesAccountCode ? { xeroAccountCode: entry.xeroSalesAccountCode } : {}),
    ...(entry.xeroTaxType ? { xeroTaxType: entry.xeroTaxType } : {}),
  };
}

export function estimateOptionFromMatch(
  match: PriceBookMatch,
  context: EstimateContext,
): MaintenanceEstimateOption {
  const line = calculateEstimateLine(match.entry, context, match);
  return {
    id: `option-${match.entry.id}`,
    type: match.entry.siteAssessmentRequired ? 'site_assessment' : 'repair',
    label: match.entry.siteAssessmentRequired ? 'Site assessment' : 'Recommended repair',
    description: match.entry.clientDescription,
    recommended: true,
    lineItems: [line],
    subtotal: line.sellPriceExcludingTax,
    tax: line.taxAmount,
    total: line.totalIncludingTax,
    exclusions: [...match.entry.exclusions],
    ...(match.entry.warrantyDays ? { warrantyDays: match.entry.warrantyDays } : {}),
    siteAssessmentRequired: match.entry.siteAssessmentRequired,
  };
}

export function quoteLineFromEstimate(
  line: MaintenanceEstimateLine,
): MaintenanceQuoteLineItem {
  const unitAmountExcludingTax = money(line.sellPriceExcludingTax / Math.max(line.quantity, 1));
  return {
    id: `quote-${line.id}`,
    estimateLineId: line.id,
    ...(line.priceCode ? { priceCode: line.priceCode } : {}),
    ...(line.xeroItemCode ? { itemCode: line.xeroItemCode } : {}),
    description: line.description,
    quantity: line.quantity,
    unit: line.unit,
    unitAmountExcludingTax,
    lineAmountExcludingTax: line.sellPriceExcludingTax,
    taxRate:
      line.sellPriceExcludingTax > 0 ? line.taxAmount / line.sellPriceExcludingTax : 0,
    taxAmount: line.taxAmount,
    lineTotalIncludingTax: line.totalIncludingTax,
    internalDirectCost: line.directCost,
    internalMarginAmount: money(line.sellPriceExcludingTax - line.directCost),
    ...(line.xeroAccountCode ? { accountCode: line.xeroAccountCode } : {}),
    ...(line.xeroTaxType ? { taxType: line.xeroTaxType } : {}),
  };
}

export function quoteTotals(
  lines: MaintenanceQuoteLineItem[],
): { subtotal: number; totalTax: number; total: number } {
  const subtotal = money(lines.reduce((sum, line) => sum + line.lineAmountExcludingTax, 0));
  const totalTax = money(lines.reduce((sum, line) => sum + line.taxAmount, 0));
  return { subtotal, totalTax, total: money(subtotal + totalTax) };
}

export function resolveQuoteApproval(
  policy: QuoteApprovalPolicy,
  input: {
    total: number;
    replacement: boolean;
    capital: boolean;
    cosmetic: boolean;
    emergency: boolean;
    preauthorised: boolean;
  },
): ApprovalRequirement {
  const reasons: string[] = [];
  if (input.preauthorised && policy.autoApprovePreauthorisedServices) {
    return { required: false, recipientType: 'none', reasons: [], emergencyOverrideAvailable: false };
  }
  if (input.replacement && policy.mandatoryReplacementApproval) {
    reasons.push('Replacement work requires client approval.');
  }
  if (input.capital && policy.mandatoryCapitalApproval) {
    reasons.push('Capital expenditure requires client approval.');
  }
  if (input.cosmetic && policy.mandatoryCosmeticApproval) {
    reasons.push('Cosmetic or discretionary work requires client approval.');
  }
  if (input.total >= policy.landlordApprovalThreshold) {
    reasons.push('Quote exceeds the landlord approval threshold.');
  }
  if (
    policy.propertyManagerDelegatedLimit !== undefined &&
    input.total > policy.propertyManagerDelegatedLimit
  ) {
    reasons.push('Quote exceeds the property manager delegated authority.');
  }
  const secondApproval =
    policy.secondApprovalThreshold !== undefined && input.total >= policy.secondApprovalThreshold;
  if (secondApproval) reasons.push('Quote requires second-level approval.');
  const emergencyOverrideAvailable = Boolean(
    input.emergency &&
      policy.emergencyAuthorisationLimit !== undefined &&
      input.total <= policy.emergencyAuthorisationLimit,
  );
  return {
    required: reasons.length > 0 && !emergencyOverrideAvailable,
    recipientType: secondApproval ? 'second_approver' : reasons.length ? 'landlord' : 'none',
    reasons,
    emergencyOverrideAvailable,
  };
}

export function canTransitionMaintenanceQuote(
  current: MaintenanceQuoteStatus,
  next: MaintenanceQuoteStatus,
): boolean {
  return MAINTENANCE_QUOTE_TRANSITIONS[current].includes(next);
}

export function maintenanceSlaDueAt(
  priority: MaintenancePriority,
  from = new Date(),
): string {
  const hours: Record<MaintenancePriority, number> = {
    urgent: 4,
    high: 24,
    routine: 5 * 24,
    monitor: 30 * 24,
  };
  return new Date(from.getTime() + hours[priority] * 60 * 60 * 1000).toISOString();
}

export function maintenanceSlaStatus(
  dueAt: string | undefined,
  status: string,
  now = Date.now(),
): 'on_track' | 'at_risk' | 'overdue' | 'not_applicable' {
  if (['closed', 'cancelled', 'dismissed', 'duplicate', 'not_actionable'].includes(status)) {
    return 'not_applicable';
  }
  const due = dueAt ? Date.parse(dueAt) : Number.NaN;
  if (!Number.isFinite(due)) return 'on_track';
  if (due < now) return 'overdue';
  if (due - now <= 6 * 60 * 60 * 1000) return 'at_risk';
  return 'on_track';
}

declare module './maintenance.js' {
  interface MaintenanceCandidate {
    issueType?: MaintenanceIssueType;
    recommendedAction?: string;
    safetyClassification?: MaintenanceSafetyClassification;
    extractionFingerprint?: string;
    preliminary?: boolean;
    pricingStatus?: MaintenancePricingStatus;
    priceBookMatchCandidateIds?: string[];
  }

  interface MaintenanceItem {
    issueType?: MaintenanceIssueType;
    trade?: string;
    recommendedAction?: string;
    safetyClassification?: MaintenanceSafetyClassification;
    pricingStatus?: MaintenancePricingStatus;
    estimateId?: string;
    quoteIds?: string[];
    activeQuoteId?: string;
    approvedQuoteVersionId?: string;
    approvalPolicyId?: string;
    workOrderId?: string;
    actualCost?: number;
    slaDueAt?: string;
    slaStatus?: 'on_track' | 'at_risk' | 'overdue' | 'not_applicable';
    warrantyReviewStatus?: 'not_checked' | 'eligible' | 'not_eligible' | 'claim_lodged';
    responsibility?: 'owner' | 'property_manager' | 'tenant_review_required' | 'strata_review_required' | 'unknown';
  }

  interface ClientApproval {
    quoteId?: string;
    quoteVersionId?: string;
    quoteNumber?: string;
    amount?: number;
    currency?: string;
    quoteExpiresAt?: string;
    decisionByName?: string;
    decisionTokenVerifiedAt?: string;
  }

  interface WorkRequest {
    workOrderId?: string;
    approvedQuoteId?: string;
    approvedQuoteVersionId?: string;
    scopeVersion?: number;
    agreedContractorAmount?: number;
    scheduledStartAt?: string;
    scheduledEndAt?: string;
    variationIds?: string[];
  }

  interface ExternalContact {
    tradeCategories?: MaintenanceCategory[];
    serviceAreas?: string[];
    licenceNumbers?: string[];
    insuranceExpiresAt?: string;
    preferredSupplier?: boolean;
    emergencyAvailable?: boolean;
    standardCalloutFee?: number;
    hourlyRate?: number;
    xeroContactId?: string;
    jobsCompleted?: number;
    averageResponseHours?: number;
    qualityRating?: number;
  }
}

declare module './platform.js' {
  interface Client {
    xeroContactId?: string;
    delegatedApprovalLimit?: number;
    defaultApprovalEmail?: string;
  }

  interface PropertyAsset {
    warrantyProvider?: string;
    warrantyReference?: string;
    installerContactId?: string;
    workmanshipWarrantyExpiresAt?: string;
    replacementCostEstimate?: number;
  }
}

export type {
  Client,
  ClientApproval,
  ExternalContact,
  MaintenanceCandidate,
  MaintenanceCategory,
  MaintenanceItem,
  MaintenancePriority,
  PropertyAsset,
  WorkRequest,
};
