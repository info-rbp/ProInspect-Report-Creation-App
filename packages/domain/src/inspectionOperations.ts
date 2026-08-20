import type {
  InspectionJob,
  InspectionJobStatus,
  InspectionReportType,
  PropertyRecord,
  PropertyUse,
  UserRole,
} from './platform.js';

export type InspectionRequestSource =
  | 'shopify'
  | 'google_calendar'
  | 'manual'
  | 'property'
  | 'maintenance'
  | 'recurring_schedule'
  | 'api';

export type InspectionPaymentStatus =
  | 'not_required'
  | 'pending'
  | 'authorised'
  | 'paid'
  | 'partially_paid'
  | 'partially_refunded'
  | 'refunded'
  | 'voided'
  | 'failed';

export type InspectionBookingStatus =
  | 'not_required'
  | 'awaiting_booking'
  | 'tentative'
  | 'booked'
  | 'reschedule_requested'
  | 'rescheduled'
  | 'cancelled'
  | 'no_show';

export type InspectionPropertyMatchStatus =
  | 'unmatched'
  | 'possible_match'
  | 'matched'
  | 'new_property_required'
  | 'not_required';

export type InspectionIntakeStatus =
  | 'received'
  | 'needs_review'
  | 'awaiting_payment'
  | 'awaiting_booking'
  | 'awaiting_property'
  | 'ready_for_job'
  | 'converted'
  | 'duplicate'
  | 'cancelled'
  | 'failed';

export type InspectionPriority = 'low' | 'normal' | 'high' | 'urgent';

export type InspectionAccessStatus =
  | 'not_required'
  | 'unknown'
  | 'instructions_available'
  | 'confirmation_requested'
  | 'confirmed'
  | 'failed'
  | 'unable_to_access';

export type InspectionCommunicationType =
  | 'order_received'
  | 'payment_confirmed'
  | 'booking_link_sent'
  | 'booking_confirmed'
  | 'booking_rescheduled'
  | 'booking_cancelled'
  | 'tenant_notice_sent'
  | 'access_confirmation_requested'
  | 'access_confirmed'
  | 'inspector_assigned'
  | 'reviewer_assigned'
  | 'reminder_sent'
  | 'inspection_completed'
  | 'report_issued'
  | 'general';

export interface ShopifyOrderLineReference {
  lineItemId: string;
  productId?: string;
  variantId?: string;
  title: string;
  variantTitle?: string;
  sku?: string;
  quantity: number;
  amount?: string;
  currency?: string;
}

export interface ShopifyOrderReference {
  shopDomain: string;
  orderGid: string;
  orderNumber: string;
  checkoutToken?: string;
  customerId?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  financialStatus?: string;
  fulfilmentStatus?: string;
  currency?: string;
  totalAmount?: string;
  tags?: string[];
  note?: string;
  lines: ShopifyOrderLineReference[];
  cancelledAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GoogleCalendarReference {
  calendarId: string;
  eventId: string;
  iCalUID?: string;
  eventEtag?: string;
  htmlLink?: string;
  bookingPageId?: string;
  bookingPageLabel?: string;
  summary?: string;
  description?: string;
  location?: string;
  startAt: string;
  endAt: string;
  timezone: string;
  eventStatus: 'confirmed' | 'tentative' | 'cancelled';
  organiserEmail?: string;
  attendeeEmails?: string[];
  lastExternalUpdateAt?: string;
  lastSyncedAt?: string;
}

export interface InspectionServiceMapping {
  id: string;
  agencyId: string;
  provider: 'shopify' | 'google_calendar' | 'manual';
  active: boolean;
  serviceCode: string;
  label: string;
  productId?: string;
  variantId?: string;
  productHandle?: string;
  sku?: string;
  calendarSummaryPattern?: string;
  bookingPageUrl?: string;
  reportType: InspectionReportType;
  propertyUse?: PropertyUse;
  defaultDurationMinutes: number;
  paymentRequired: boolean;
  manualApprovalRequired: boolean;
  defaultPriority: InspectionPriority;
  defaultInspectorId?: string;
  defaultReviewerId?: string;
  templateId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PropertyMatchCandidate {
  propertyId: string;
  address: string;
  score: number;
  reasons: string[];
}

export interface InspectionRequest {
  id: string;
  agencyId: string;
  source: InspectionRequestSource;
  sourceExternalId: string;
  sourceDeliveryId?: string;
  serviceCode?: string;
  reportType?: InspectionReportType;
  propertyId?: string;
  tenancyId?: string;
  propertyAddressCandidate?: string;
  propertyMatchStatus: InspectionPropertyMatchStatus;
  propertyMatchCandidates?: PropertyMatchCandidate[];
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  paymentStatus: InspectionPaymentStatus;
  bookingStatus: InspectionBookingStatus;
  intakeStatus: InspectionIntakeStatus;
  priority: InspectionPriority;
  durationMinutes?: number;
  requestedStartAt?: string;
  requestedEndAt?: string;
  timezone?: string;
  accessInstructions?: string;
  notes?: string;
  shopifyOrder?: ShopifyOrderReference;
  googleCalendar?: GoogleCalendarReference;
  inspectionJobId?: string;
  duplicateOfRequestId?: string;
  failureCode?: string;
  failureMessage?: string;
  receivedAt: string;
  convertedAt?: string;
  cancelledAt?: string;
  createdAt: string;
  updatedAt: string;
  version?: number;
}

export interface InspectionJobPropertySnapshot {
  propertyId: string;
  propertyLayoutVersionId?: string;
  address: string;
  propertyUse?: PropertyUse;
  physicalPropertyType?: string;
  ownershipStructure?: string;
  accessInstructions?: string;
  alertMessages: string[];
  tenancyId?: string;
  capturedAt: string;
}

export const INSPECTION_READINESS_GATES = [
  'propertyMatched',
  'propertyLayoutAvailable',
  'paymentSatisfied',
  'bookingConfirmed',
  'activeTenancyResolved',
  'inspectorAssigned',
  'reviewerAssigned',
  'accessReady',
  'entryBaselineAvailable',
  'templateAssigned',
] as const;

export type InspectionReadinessGate = (typeof INSPECTION_READINESS_GATES)[number];

export interface InspectionReadinessBlocker {
  gate: InspectionReadinessGate;
  code: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface InspectionReadinessResult {
  readyForJob: boolean;
  readyForAssignment: boolean;
  readyForFieldWork: boolean;
  gates: Record<InspectionReadinessGate, boolean>;
  blockers: InspectionReadinessBlocker[];
  evaluatedAt: string;
}

export interface InspectionCommunication {
  id: string;
  agencyId: string;
  inspectionJobId?: string;
  inspectionRequestId?: string;
  type: InspectionCommunicationType;
  channel: 'email' | 'sms' | 'phone' | 'calendar' | 'system' | 'other';
  recipient?: string;
  subject?: string;
  summary: string;
  providerMessageId?: string;
  status: 'queued' | 'sent' | 'delivered' | 'failed' | 'recorded';
  occurredAt: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  version?: number;
}

export interface InspectionOperationalEvent {
  id: string;
  agencyId: string;
  inspectionJobId: string;
  type:
    | 'reschedule_requested'
    | 'rescheduled'
    | 'customer_cancelled'
    | 'agency_cancelled'
    | 'inspector_unavailable'
    | 'unable_to_access'
    | 'keys_unavailable'
    | 'tenant_not_present'
    | 'unsafe_property'
    | 'weather_interruption'
    | 'no_show'
    | 'partial_inspection'
    | 'follow_up_required'
    | 'general';
  reason: string;
  previousStartAt?: string;
  newStartAt?: string;
  previousEndAt?: string;
  newEndAt?: string;
  feeReviewRequired: boolean;
  createdBy: string;
  createdAt: string;
  version?: number;
}

export interface InspectorCapabilityProfile {
  id: string;
  agencyId: string;
  userId: string;
  displayName: string;
  role: Extract<UserRole, 'inspector' | 'operations' | 'proinspect_admin' | 'super_admin'>;
  active: boolean;
  inspectionTypes: InspectionReportType[];
  propertyUses: PropertyUse[];
  serviceAreas: string[];
  commercialQualified: boolean;
  strataQualified: boolean;
  maxJobsPerDay?: number;
  defaultCalendarId?: string;
  workingHours?: Record<string, { start: string; end: string } | undefined>;
  createdAt: string;
  updatedAt: string;
  version?: number;
}

export interface RecurringInspectionSchedule {
  id: string;
  agencyId: string;
  propertyId: string;
  tenancyId?: string;
  reportType: InspectionReportType;
  cadence: 'monthly' | 'quarterly' | 'six_monthly' | 'annual' | 'custom_days';
  customIntervalDays?: number;
  nextDueAt: string;
  lastCompletedAt?: string;
  bookingLeadDays: number;
  noticeLeadDays: number;
  defaultInspectorId?: string;
  defaultReviewerId?: string;
  autoCreateRequest: boolean;
  autoConvertToJob: boolean;
  paused: boolean;
  pauseReason?: string;
  createdAt: string;
  updatedAt: string;
  version?: number;
}

export interface IntegrationConnection {
  id: string;
  agencyId: string;
  provider: 'shopify' | 'google_calendar';
  status: 'pending' | 'connected' | 'attention_required' | 'disconnected';
  externalAccountId?: string;
  externalAccountLabel?: string;
  permissions: string[];
  configuration: Record<string, string | number | boolean | string[] | undefined>;
  credentialReference?: string;
  lastSuccessfulSyncAt?: string;
  lastAttemptedSyncAt?: string;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  createdAt: string;
  updatedAt: string;
  version?: number;
}

export interface IntegrationDelivery {
  id: string;
  agencyId: string;
  provider: 'shopify' | 'google_calendar';
  externalDeliveryId: string;
  externalEventId?: string;
  topic: string;
  payloadHash: string;
  status: 'received' | 'processed' | 'ignored' | 'failed' | 'duplicate';
  inspectionRequestId?: string;
  inspectionJobId?: string;
  errorCode?: string;
  errorMessage?: string;
  receivedAt: string;
  processedAt?: string;
  createdAt: string;
  updatedAt: string;
  version?: number;
}

export interface IntegrationSyncException {
  id: string;
  agencyId: string;
  provider: 'shopify' | 'google_calendar';
  category:
    | 'unknown_product'
    | 'payment_discrepancy'
    | 'missing_customer'
    | 'property_unmatched'
    | 'property_ambiguous'
    | 'booking_without_order'
    | 'order_without_booking'
    | 'cancelled_order_active_job'
    | 'calendar_event_deleted'
    | 'calendar_date_conflict'
    | 'watch_expired'
    | 'oauth_revoked'
    | 'sync_token_expired'
    | 'permission_denied'
    | 'provider_error'
    | 'other';
  severity: 'info' | 'warning' | 'critical';
  status: 'open' | 'retrying' | 'resolved' | 'ignored';
  title: string;
  detail: string;
  inspectionRequestId?: string;
  inspectionJobId?: string;
  externalId?: string;
  resolution?: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  version?: number;
}

export interface CalendarBookingFields {
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  propertyAddress?: string;
  accessInstructions?: string;
  tenantName?: string;
  tenantEmail?: string;
  tenantPhone?: string;
  orderNumber?: string;
}

function compact(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/\b(unit|apartment|apt|flat)\b/gu, '')
    .replace(/\b(street|st|road|rd|avenue|ave|drive|dr|boulevard|bvd|crescent|cr|terrace|tce|lane|ln|way|loop)\b/gu, '')
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}

export function normaliseInspectionAddress(value: string): string {
  return compact(value).replace(/\b(wa|australia)\b/gu, '').trim();
}

function tokens(value: string): Set<string> {
  return new Set(normaliseInspectionAddress(value).split(' ').filter(Boolean));
}

function tokenSimilarity(left: string, right: string): number {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((item) => b.has(item)).length;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

export function propertyDisplayAddress(property: Pick<PropertyRecord, 'address' | 'suburb' | 'state' | 'postcode'>): string {
  return [property.address, property.suburb, property.state, property.postcode]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(', ');
}

export function rankPropertyMatches(
  addressCandidate: string,
  properties: Array<Pick<PropertyRecord, 'id' | 'address' | 'suburb' | 'state' | 'postcode'>>,
): PropertyMatchCandidate[] {
  const candidate = normaliseInspectionAddress(addressCandidate);
  if (!candidate) return [];
  return properties
    .map((property) => {
      const address = propertyDisplayAddress(property);
      const normalised = normaliseInspectionAddress(address);
      const exact = candidate === normalised;
      const contains = candidate.includes(normalised) || normalised.includes(candidate);
      const similarity = tokenSimilarity(candidate, normalised);
      const score = exact ? 1 : contains ? Math.max(0.92, similarity) : similarity;
      const reasons = [
        ...(exact ? ['Normalised address matches exactly.'] : []),
        ...(!exact && contains ? ['One normalised address contains the other.'] : []),
        ...(similarity >= 0.65 ? [`Address token similarity is ${Math.round(similarity * 100)}%.`] : []),
      ];
      return { propertyId: property.id, address, score, reasons };
    })
    .filter((match) => match.score >= 0.45)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);
}

export function inferInspectionReportType(value: string): InspectionReportType | undefined {
  const text = value.toLowerCase();
  if (/\b(exit|move[- ]?out|vacate)\b/u.test(text)) return 'Exit Inspection';
  if (/\b(routine|periodic)\b/u.test(text)) return 'Routine Inspection';
  if (/\b(maintenance|follow[- ]?up|photo update)\b/u.test(text)) return 'Maintenance and Follow-Up Report';
  if (/\b(comparison)\b/u.test(text)) return 'Inspection Comparison Report';
  if (/\b(property condition|entry|move[- ]?in|pcr)\b/u.test(text)) return 'Property Condition Report';
  return undefined;
}

function field(description: string, labels: string[]): string | undefined {
  const lines = description.replace(/\r/gu, '').split('\n');
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const inline = new RegExp(`(?:\\*\\*)?${escaped}(?:\\*\\*)?\\s*[:\\-]?\\s*(.+)$`, 'iu');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].replace(/\*+/gu, '').trim();
      const match = line.match(inline);
      if (match?.[1]?.trim()) return match[1].trim();
      if (new RegExp(`^${escaped}\\s*:?$`, 'iu').test(line)) {
        const next = lines.slice(index + 1).map((item) => item.replace(/\*+/gu, '').trim()).find(Boolean);
        if (next) return next;
      }
    }
  }
  return undefined;
}

export function parseCalendarBookingFields(description = '', location = ''): CalendarBookingFields {
  const customer = field(description, ['Booked by', 'Customer', 'Client']);
  const customerEmail = description.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu)?.[0];
  const customerPhone = description.match(/(?:\+?61|0)4\d(?:[\s-]?\d){7}/u)?.[0];
  const propertyAddress = field(description, ['Full Property Address', 'Property Address', 'Address']) || location || undefined;
  const accessInstructions = field(description, [
    'Access Method (please provide key/lockbox details or access instructions)',
    'Access To Property (Key Collection, Safe)',
    'Access Details (Key Safe, Pick Up)',
    'Access Information (Key Safe Code)',
    'Access Information',
  ]);
  const tenantName = field(description, ['Tenant Name']);
  const tenantEmail = field(description, ['Tenant Email Address']);
  const tenantPhone = field(description, ['Tenant Phone Number']);
  const orderNumber = field(description, ['Shopify Order', 'Order Number', 'Order']);
  return {
    ...(customer ? { customerName: customer } : {}),
    ...(customerEmail ? { customerEmail } : {}),
    ...(customerPhone ? { customerPhone } : {}),
    ...(propertyAddress ? { propertyAddress } : {}),
    ...(accessInstructions ? { accessInstructions } : {}),
    ...(tenantName ? { tenantName } : {}),
    ...(tenantEmail && !/^tba$/iu.test(tenantEmail) ? { tenantEmail } : {}),
    ...(tenantPhone && !/^tba$/iu.test(tenantPhone) ? { tenantPhone } : {}),
    ...(orderNumber ? { orderNumber } : {}),
  };
}

export function paymentSatisfied(status: InspectionPaymentStatus, required = true): boolean {
  return !required || status === 'paid' || status === 'authorised' || status === 'not_required';
}

export function bookingSatisfied(status: InspectionBookingStatus): boolean {
  return status === 'booked' || status === 'rescheduled' || status === 'not_required';
}

export function deriveInspectionIntakeStatus(
  request: Pick<InspectionRequest, 'paymentStatus' | 'bookingStatus' | 'propertyMatchStatus' | 'inspectionJobId' | 'duplicateOfRequestId' | 'cancelledAt' | 'failureCode'>,
  paymentRequired = true,
): InspectionIntakeStatus {
  if (request.duplicateOfRequestId) return 'duplicate';
  if (request.cancelledAt) return 'cancelled';
  if (request.failureCode) return 'failed';
  if (request.inspectionJobId) return 'converted';
  if (!paymentSatisfied(request.paymentStatus, paymentRequired)) return 'awaiting_payment';
  if (!bookingSatisfied(request.bookingStatus)) return 'awaiting_booking';
  if (request.propertyMatchStatus !== 'matched' && request.propertyMatchStatus !== 'not_required') return 'awaiting_property';
  return 'ready_for_job';
}

export function mergeShopifyOrderIntoRequest(
  request: InspectionRequest,
  order: ShopifyOrderReference,
  mapping?: InspectionServiceMapping,
): InspectionRequest {
  const financial = order.financialStatus?.toLowerCase() || '';
  const paymentStatus: InspectionPaymentStatus = order.cancelledAt
    ? financial.includes('refund') ? 'refunded' : 'voided'
    : financial === 'paid'
      ? 'paid'
      : financial === 'authorized' || financial === 'authorised'
        ? 'authorised'
        : financial.includes('partially_refunded')
          ? 'partially_refunded'
          : financial.includes('refund')
            ? 'refunded'
            : financial.includes('partial')
              ? 'partially_paid'
              : financial.includes('fail')
                ? 'failed'
                : 'pending';
  const next: InspectionRequest = {
    ...request,
    source: 'shopify',
    sourceExternalId: order.orderGid,
    shopifyOrder: order,
    customerName: order.customerName || request.customerName,
    customerEmail: order.customerEmail || request.customerEmail,
    customerPhone: order.customerPhone || request.customerPhone,
    paymentStatus,
    serviceCode: mapping?.serviceCode || request.serviceCode,
    reportType: mapping?.reportType || request.reportType,
    durationMinutes: mapping?.defaultDurationMinutes || request.durationMinutes,
    priority: mapping?.defaultPriority || request.priority,
    cancelledAt: order.cancelledAt || request.cancelledAt,
    updatedAt: order.updatedAt,
  };
  return {
    ...next,
    intakeStatus: deriveInspectionIntakeStatus(next, mapping?.paymentRequired ?? true),
  };
}

export function mergeCalendarEventIntoRequest(
  request: InspectionRequest,
  calendar: GoogleCalendarReference,
  mapping?: InspectionServiceMapping,
): InspectionRequest {
  const fields = parseCalendarBookingFields(calendar.description, calendar.location);
  const bookingStatus: InspectionBookingStatus = calendar.eventStatus === 'cancelled'
    ? 'cancelled'
    : calendar.eventStatus === 'tentative'
      ? 'tentative'
      : 'booked';
  const next: InspectionRequest = {
    ...request,
    googleCalendar: calendar,
    bookingStatus,
    requestedStartAt: calendar.startAt,
    requestedEndAt: calendar.endAt,
    timezone: calendar.timezone,
    propertyAddressCandidate: fields.propertyAddress || request.propertyAddressCandidate,
    customerName: fields.customerName || request.customerName,
    customerEmail: fields.customerEmail || request.customerEmail,
    customerPhone: fields.customerPhone || request.customerPhone,
    accessInstructions: fields.accessInstructions || request.accessInstructions,
    serviceCode: mapping?.serviceCode || request.serviceCode,
    reportType: mapping?.reportType || request.reportType || inferInspectionReportType(`${calendar.summary || ''} ${calendar.description || ''}`),
    durationMinutes: mapping?.defaultDurationMinutes || Math.max(1, Math.round((Date.parse(calendar.endAt) - Date.parse(calendar.startAt)) / 60_000)),
    cancelledAt: calendar.eventStatus === 'cancelled' ? request.cancelledAt || new Date().toISOString() : request.cancelledAt,
    updatedAt: calendar.lastExternalUpdateAt || calendar.lastSyncedAt || new Date().toISOString(),
  };
  return {
    ...next,
    intakeStatus: deriveInspectionIntakeStatus(next, mapping?.paymentRequired ?? next.source === 'shopify'),
  };
}

export function propertySnapshot(
  property: PropertyRecord,
  tenancyId?: string,
  capturedAt = new Date().toISOString(),
): InspectionJobPropertySnapshot {
  return {
    propertyId: property.id,
    ...(property.currentLayoutVersionId ? { propertyLayoutVersionId: property.currentLayoutVersionId } : {}),
    address: propertyDisplayAddress(property),
    ...(property.propertyUse ? { propertyUse: property.propertyUse } : {}),
    ...(property.physicalPropertyType ? { physicalPropertyType: property.physicalPropertyType } : {}),
    ...(property.ownershipStructure ? { ownershipStructure: property.ownershipStructure } : {}),
    ...(property.accessDetails?.accessNotes ? { accessInstructions: property.accessDetails.accessNotes } : {}),
    alertMessages: (property.alerts || []).filter((item) => item.active).map((item) => item.message),
    ...(tenancyId ? { tenancyId } : {}),
    capturedAt,
  };
}

export interface InspectionReadinessInput {
  request?: Pick<InspectionRequest, 'paymentStatus' | 'bookingStatus' | 'propertyMatchStatus'>;
  job: Pick<InspectionJob, 'propertyId' | 'tenancyId' | 'reportType' | 'assignedInspectorId' | 'assignedReviewerId' | 'templateId' | 'scheduledAt' | 'accessStatus' | 'propertySnapshot'>;
  property?: Pick<PropertyRecord, 'currentLayoutVersionId' | 'roomsConfig'>;
  paymentRequired?: boolean;
  bookingRequired?: boolean;
  tenancyRequired?: boolean;
  reviewerRequired?: boolean;
  entryBaselineAvailable?: boolean;
  baselineRequired?: boolean;
  now?: string;
}

export function calculateInspectionReadiness(input: InspectionReadinessInput): InspectionReadinessResult {
  const now = input.now || new Date().toISOString();
  const request = input.request;
  const bookingRequired = input.bookingRequired ?? true;
  const paymentRequired = input.paymentRequired ?? Boolean(request);
  const tenancyRequired = input.tenancyRequired ?? ['Property Condition Report', 'Exit Inspection'].includes(input.job.reportType);
  const reviewerRequired = input.reviewerRequired ?? true;
  const baselineRequired = input.baselineRequired ?? input.job.reportType === 'Exit Inspection';
  const propertyMatched = Boolean(input.job.propertyId) && (!request || request.propertyMatchStatus === 'matched' || request.propertyMatchStatus === 'not_required');
  const propertyLayoutAvailable = Boolean(
    input.job.propertySnapshot?.propertyLayoutVersionId ||
    input.property?.currentLayoutVersionId ||
    input.property?.roomsConfig?.length,
  );
  const gates: Record<InspectionReadinessGate, boolean> = {
    propertyMatched,
    propertyLayoutAvailable,
    paymentSatisfied: !paymentRequired || !request || paymentSatisfied(request.paymentStatus, true),
    bookingConfirmed: !bookingRequired || (request ? bookingSatisfied(request.bookingStatus) : Boolean(input.job.scheduledAt)),
    activeTenancyResolved: !tenancyRequired || Boolean(input.job.tenancyId),
    inspectorAssigned: Boolean(input.job.assignedInspectorId),
    reviewerAssigned: !reviewerRequired || Boolean(input.job.assignedReviewerId),
    accessReady: input.job.accessStatus === 'confirmed' || input.job.accessStatus === 'instructions_available' || input.job.accessStatus === 'not_required',
    entryBaselineAvailable: !baselineRequired || input.entryBaselineAvailable === true,
    templateAssigned: Boolean(input.job.templateId),
  };
  const blockers: InspectionReadinessBlocker[] = [];
  const add = (gate: InspectionReadinessGate, code: string, message: string, severity: 'error' | 'warning' = 'error') => {
    if (!gates[gate]) blockers.push({ gate, code, message, severity });
  };
  add('propertyMatched', 'PROPERTY_MATCH_REQUIRED', 'The intake must be linked to one authoritative ProInspect property.');
  add('propertyLayoutAvailable', 'PROPERTY_LAYOUT_REQUIRED', 'The property needs a configured layout before an inspection report can be seeded.');
  add('paymentSatisfied', 'PAYMENT_REQUIRED', 'The linked order must be paid or explicitly exempt before confirmation.');
  add('bookingConfirmed', 'BOOKING_REQUIRED', 'A confirmed appointment is required before field work.');
  add('activeTenancyResolved', 'TENANCY_REQUIRED', 'The current tenancy must be linked for this inspection type.');
  add('inspectorAssigned', 'INSPECTOR_REQUIRED', 'An active inspector must be assigned before field work starts.');
  add('reviewerAssigned', 'REVIEWER_REQUIRED', 'An independent reviewer must be assigned.', 'warning');
  add('accessReady', 'ACCESS_NOT_CONFIRMED', 'Property access instructions or confirmation are required before attendance.');
  add('entryBaselineAvailable', 'ENTRY_BASELINE_REQUIRED', 'Exit Inspection requires an eligible Entry baseline or reviewed legacy mapping.');
  add('templateAssigned', 'TEMPLATE_REQUIRED', 'A published report template must be assigned before report creation.', 'warning');
  return {
    readyForJob: gates.propertyMatched && gates.paymentSatisfied && gates.bookingConfirmed,
    readyForAssignment: gates.propertyMatched && gates.bookingConfirmed && gates.propertyLayoutAvailable,
    readyForFieldWork: gates.propertyMatched && gates.propertyLayoutAvailable && gates.paymentSatisfied && gates.bookingConfirmed && gates.activeTenancyResolved && gates.inspectorAssigned && gates.accessReady && gates.entryBaselineAvailable,
    gates,
    blockers,
    evaluatedAt: now,
  };
}

export function buildInspectionJobFromRequest(
  request: InspectionRequest,
  property: PropertyRecord,
  now = new Date().toISOString(),
): Omit<InspectionJob, 'id' | 'createdAt' | 'updatedAt'> {
  if (request.intakeStatus !== 'ready_for_job') {
    throw new Error(`Inspection request ${request.id} is not ready for job conversion.`);
  }
  if (!request.reportType) throw new Error('Inspection request has no mapped report type.');
  if (!request.propertyId || request.propertyId !== property.id) throw new Error('Inspection request is not matched to the supplied property.');
  return {
    agencyId: request.agencyId,
    propertyId: property.id,
    ...(request.tenancyId ? { tenancyId: request.tenancyId } : {}),
    reportType: request.reportType,
    ...(request.requestedStartAt ? { scheduledAt: request.requestedStartAt } : {}),
    ...(request.requestedEndAt ? { scheduledEndAt: request.requestedEndAt } : {}),
    timezone: request.timezone || 'Australia/Perth',
    status: 'draft',
    source: request.source,
    inspectionRequestId: request.id,
    paymentStatus: request.paymentStatus,
    bookingStatus: request.bookingStatus,
    propertyMatchStatus: request.propertyMatchStatus,
    priority: request.priority,
    durationMinutes: request.durationMinutes,
    accessStatus: request.accessInstructions ? 'instructions_available' : 'unknown',
    propertySnapshot: propertySnapshot(property, request.tenancyId, now),
    ...(request.shopifyOrder ? { shopifyOrder: request.shopifyOrder, shopifyOrderId: request.shopifyOrder.orderGid } : {}),
    ...(request.googleCalendar ? { googleCalendar: request.googleCalendar } : {}),
    notes: [request.notes, request.accessInstructions ? `Access: ${request.accessInstructions}` : undefined]
      .filter((value): value is string => Boolean(value?.trim()))
      .join('\n'),
  };
}

export type ExternalCancellationAction =
  | 'cancel_intake'
  | 'cancel_job_and_release_booking'
  | 'require_operator_review'
  | 'preserve_job_and_raise_exception';

export function externalCancellationAction(status?: InspectionJobStatus): ExternalCancellationAction {
  if (!status) return 'cancel_intake';
  if (status === 'draft' || status === 'booked') return 'cancel_job_and_release_booking';
  if (status === 'assigned' || status === 'on_hold') return 'require_operator_review';
  return 'preserve_job_and_raise_exception';
}

export function nextRecurringDueDate(schedule: Pick<RecurringInspectionSchedule, 'cadence' | 'customIntervalDays'>, from: string): string {
  const date = new Date(from);
  if (Number.isNaN(date.getTime())) throw new Error('Recurring inspection start date is invalid.');
  if (schedule.cadence === 'monthly') date.setUTCMonth(date.getUTCMonth() + 1);
  else if (schedule.cadence === 'quarterly') date.setUTCMonth(date.getUTCMonth() + 3);
  else if (schedule.cadence === 'six_monthly') date.setUTCMonth(date.getUTCMonth() + 6);
  else if (schedule.cadence === 'annual') date.setUTCFullYear(date.getUTCFullYear() + 1);
  else date.setUTCDate(date.getUTCDate() + Math.max(1, schedule.customIntervalDays || 1));
  return date.toISOString();
}

export interface AssignmentCandidate {
  userId: string;
  displayName: string;
  score: number;
  reasons: string[];
  currentDayJobs: number;
  capacityRemaining?: number;
}

export function rankInspectorAssignments(
  profiles: InspectorCapabilityProfile[],
  input: {
    reportType: InspectionReportType;
    propertyUse?: PropertyUse;
    suburbOrPostcode?: string;
    scheduledAt?: string;
    jobs: Array<Pick<InspectionJob, 'assignedInspectorId' | 'scheduledAt' | 'status'>>;
  },
): AssignmentCandidate[] {
  const day = input.scheduledAt?.slice(0, 10);
  return profiles
    .filter((profile) => profile.active)
    .map((profile) => {
      const reasons: string[] = [];
      let score = 0;
      if (profile.inspectionTypes.includes(input.reportType)) { score += 40; reasons.push('Qualified for this inspection type.'); }
      if (!input.propertyUse || profile.propertyUses.includes(input.propertyUse)) { score += 20; reasons.push('Property-use capability matches.'); }
      if (!input.suburbOrPostcode || profile.serviceAreas.length === 0 || profile.serviceAreas.some((area) => input.suburbOrPostcode?.toLowerCase().includes(area.toLowerCase()))) { score += 15; reasons.push('Service area matches.'); }
      const currentDayJobs = input.jobs.filter((job) => job.assignedInspectorId === profile.userId && (!day || job.scheduledAt?.slice(0, 10) === day) && !['cancelled', 'archived'].includes(job.status)).length;
      const remaining = profile.maxJobsPerDay == null ? undefined : Math.max(0, profile.maxJobsPerDay - currentDayJobs);
      if (remaining == null || remaining > 0) { score += 25; reasons.push('Daily capacity remains.'); }
      else { score -= 50; reasons.push('Daily capacity is already reached.'); }
      return { userId: profile.userId, displayName: profile.displayName, score, reasons, currentDayJobs, ...(remaining == null ? {} : { capacityRemaining: remaining }) };
    })
    .sort((left, right) => right.score - left.score);
}
