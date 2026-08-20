import { createHash, randomUUID } from 'node:crypto';
import {
  buildInspectionJobFromRequest,
  calculateInspectionReadiness,
  deriveInspectionIntakeStatus,
  mergeCalendarEventIntoRequest,
  mergeShopifyOrderIntoRequest,
  rankPropertyMatches,
  type GoogleCalendarReference,
  type InspectionRequest,
  type InspectionServiceMapping,
  type IntegrationSyncException,
  type PropertyRecord,
  type ShopifyOrderReference,
} from '@pcr/domain';
import type { ApiDependencies, StoredRecord } from '../backend/types.js';

const MAX_PAGES = 20;
const PAGE_SIZE = 100;

function record<T>(value: StoredRecord): T {
  return value as unknown as T;
}

export async function listAllRecords(
  dependencies: ApiDependencies,
  collection: string,
  agencyId: string,
): Promise<StoredRecord[]> {
  const result: StoredRecord[] = [];
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
    const page = await dependencies.repository.list(collection, agencyId, PAGE_SIZE, cursor);
    result.push(...page.items);
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  return result;
}

export function deterministicExternalId(provider: string, externalId: string): string {
  return `${provider}-${createHash('sha256')
    .update(`${provider}:${externalId}`)
    .digest('hex')
    .slice(0, 32)}`;
}

export async function serviceMappings(
  dependencies: ApiDependencies,
  agencyId: string,
): Promise<InspectionServiceMapping[]> {
  return (await listAllRecords(dependencies, 'inspectionServiceMappings', agencyId)).map((item) =>
    record<InspectionServiceMapping>(item),
  );
}

export async function properties(
  dependencies: ApiDependencies,
  agencyId: string,
): Promise<PropertyRecord[]> {
  return (await listAllRecords(dependencies, 'properties', agencyId)).map((item) =>
    record<PropertyRecord>(item),
  );
}

export function applyPropertyMatches(
  request: InspectionRequest,
  propertyRecords: PropertyRecord[],
): InspectionRequest {
  if (request.propertyId) {
    return {
      ...request,
      propertyMatchStatus: 'matched',
      propertyMatchCandidates: [],
      intakeStatus: deriveInspectionIntakeStatus({
        ...request,
        propertyMatchStatus: 'matched',
      }),
    };
  }
  const matches = rankPropertyMatches(request.propertyAddressCandidate || '', propertyRecords);
  const top = matches[0];
  const next: InspectionRequest = top?.score >= 0.92 && (!matches[1] || top.score - matches[1].score >= 0.08)
    ? {
        ...request,
        propertyId: top.propertyId,
        propertyMatchStatus: 'matched',
        propertyMatchCandidates: matches,
      }
    : matches.length
      ? {
          ...request,
          propertyMatchStatus: 'possible_match',
          propertyMatchCandidates: matches,
        }
      : {
          ...request,
          propertyMatchStatus: 'new_property_required',
          propertyMatchCandidates: [],
        };
  return { ...next, intakeStatus: deriveInspectionIntakeStatus(next) };
}

async function activeTenancyId(
  dependencies: ApiDependencies,
  agencyId: string,
  propertyId: string,
): Promise<string | undefined> {
  const tenancies = await listAllRecords(dependencies, 'tenancies', agencyId);
  const active = tenancies
    .filter((item) => item.propertyId === propertyId && item.status === 'active')
    .sort((left, right) => String(right.leaseStartDate || '').localeCompare(String(left.leaseStartDate || '')))[0];
  return active?.id;
}

export async function findRequestByExternalId(
  dependencies: ApiDependencies,
  agencyId: string,
  provider: 'shopify' | 'google_calendar',
  externalId: string,
): Promise<InspectionRequest | undefined> {
  const deterministic = await dependencies.repository.get(
    'inspectionRequests',
    agencyId,
    deterministicExternalId(provider, externalId),
  );
  if (deterministic) return record<InspectionRequest>(deterministic);
  return (await listAllRecords(dependencies, 'inspectionRequests', agencyId))
    .map((item) => record<InspectionRequest>(item))
    .find(
      (item) =>
        item.sourceExternalId === externalId ||
        item.shopifyOrder?.orderGid === externalId ||
        item.googleCalendar?.eventId === externalId,
    );
}

function normalisedEmail(value?: string): string {
  return value?.trim().toLowerCase() || '';
}

export async function findCalendarMergeCandidate(
  dependencies: ApiDependencies,
  agencyId: string,
  calendar: GoogleCalendarReference,
  orderNumber?: string,
): Promise<InspectionRequest | undefined> {
  const requests = (await listAllRecords(dependencies, 'inspectionRequests', agencyId)).map((item) =>
    record<InspectionRequest>(item),
  );
  if (orderNumber) {
    const exact = requests.find(
      (item) => item.shopifyOrder?.orderNumber.toLowerCase() === orderNumber.toLowerCase(),
    );
    if (exact) return exact;
  }
  const eventEmail = normalisedEmail(calendar.attendeeEmails?.[0]);
  if (!eventEmail) return undefined;
  const candidates = requests.filter(
    (item) =>
      item.source === 'shopify' &&
      normalisedEmail(item.customerEmail) === eventEmail &&
      !item.googleCalendar,
  );
  if (candidates.length === 1) return candidates[0];
  return undefined;
}

export async function createSyncException(
  dependencies: ApiDependencies,
  input: Omit<IntegrationSyncException, 'id' | 'createdAt' | 'updatedAt'>,
  actorId: string,
): Promise<StoredRecord> {
  const now = new Date().toISOString();
  const id = `sync-exception-${randomUUID()}`;
  return dependencies.repository.create(
    'integrationSyncExceptions',
    input.agencyId,
    id,
    { ...input, createdAt: now, updatedAt: now },
    actorId,
  );
}

export async function upsertShopifyInspectionRequest(
  dependencies: ApiDependencies,
  input: {
    agencyId: string;
    order: ShopifyOrderReference;
    propertyAddress?: string;
    accessInstructions?: string;
    mapping?: InspectionServiceMapping;
    sourceDeliveryId?: string;
    actorId: string;
  },
): Promise<InspectionRequest> {
  const now = new Date().toISOString();
  const id = deterministicExternalId('shopify', input.order.orderGid);
  const existing = await dependencies.repository.get('inspectionRequests', input.agencyId, id);
  const base: InspectionRequest = existing
    ? record<InspectionRequest>(existing)
    : {
        id,
        agencyId: input.agencyId,
        source: 'shopify',
        sourceExternalId: input.order.orderGid,
        ...(input.sourceDeliveryId ? { sourceDeliveryId: input.sourceDeliveryId } : {}),
        propertyAddressCandidate: input.propertyAddress,
        propertyMatchStatus: 'unmatched',
        customerName: input.order.customerName,
        customerEmail: input.order.customerEmail,
        customerPhone: input.order.customerPhone,
        paymentStatus: 'pending',
        bookingStatus: 'awaiting_booking',
        intakeStatus: 'received',
        priority: input.mapping?.defaultPriority || 'normal',
        accessInstructions: input.accessInstructions,
        shopifyOrder: input.order,
        receivedAt: now,
        createdAt: now,
        updatedAt: now,
      };
  let request = mergeShopifyOrderIntoRequest(
    {
      ...base,
      ...(input.propertyAddress ? { propertyAddressCandidate: input.propertyAddress } : {}),
      ...(input.accessInstructions ? { accessInstructions: input.accessInstructions } : {}),
    },
    input.order,
    input.mapping,
  );
  request = applyPropertyMatches(request, await properties(dependencies, input.agencyId));
  request = {
    ...request,
    intakeStatus: deriveInspectionIntakeStatus(
      request,
      input.mapping?.paymentRequired ?? true,
    ),
    updatedAt: now,
  };
  const stored = existing
    ? await dependencies.repository.update(
        'inspectionRequests',
        input.agencyId,
        id,
        request as unknown as Record<string, unknown>,
        Number(existing.version),
        input.actorId,
      )
    : await dependencies.repository.create(
        'inspectionRequests',
        input.agencyId,
        id,
        request as unknown as Record<string, unknown>,
        input.actorId,
      );
  return record<InspectionRequest>(stored);
}

export async function upsertCalendarInspectionRequest(
  dependencies: ApiDependencies,
  input: {
    agencyId: string;
    calendar: GoogleCalendarReference;
    mapping?: InspectionServiceMapping;
    orderNumber?: string;
    actorId: string;
  },
): Promise<InspectionRequest> {
  const now = new Date().toISOString();
  const existingByEvent = await findRequestByExternalId(
    dependencies,
    input.agencyId,
    'google_calendar',
    input.calendar.eventId,
  );
  const mergeCandidate =
    existingByEvent ||
    (await findCalendarMergeCandidate(
      dependencies,
      input.agencyId,
      input.calendar,
      input.orderNumber,
    ));
  const id = mergeCandidate?.id || deterministicExternalId('google_calendar', input.calendar.eventId);
  const base: InspectionRequest = mergeCandidate || {
    id,
    agencyId: input.agencyId,
    source: 'google_calendar',
    sourceExternalId: input.calendar.eventId,
    propertyMatchStatus: 'unmatched',
    paymentStatus: input.mapping?.paymentRequired ? 'pending' : 'not_required',
    bookingStatus: 'awaiting_booking',
    intakeStatus: 'received',
    priority: input.mapping?.defaultPriority || 'normal',
    receivedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  let request = mergeCalendarEventIntoRequest(base, input.calendar, input.mapping);
  request = applyPropertyMatches(request, await properties(dependencies, input.agencyId));
  request = {
    ...request,
    source: mergeCandidate?.source === 'shopify' ? 'shopify' : 'google_calendar',
    sourceExternalId: mergeCandidate?.sourceExternalId || input.calendar.eventId,
    intakeStatus: deriveInspectionIntakeStatus(
      request,
      input.mapping?.paymentRequired ?? request.source === 'shopify',
    ),
    updatedAt: now,
  };
  const current = await dependencies.repository.get('inspectionRequests', input.agencyId, id);
  const stored = current
    ? await dependencies.repository.update(
        'inspectionRequests',
        input.agencyId,
        id,
        request as unknown as Record<string, unknown>,
        Number(current.version),
        input.actorId,
      )
    : await dependencies.repository.create(
        'inspectionRequests',
        input.agencyId,
        id,
        request as unknown as Record<string, unknown>,
        input.actorId,
      );
  return record<InspectionRequest>(stored);
}

export async function linkInspectionRequestToProperty(
  dependencies: ApiDependencies,
  input: {
    agencyId: string;
    requestId: string;
    propertyId: string;
    expectedVersion: number;
    actorId: string;
  },
): Promise<InspectionRequest> {
  const requestRecord = await dependencies.repository.get(
    'inspectionRequests',
    input.agencyId,
    input.requestId,
  );
  if (!requestRecord) throw new Error('Inspection request was not found.');
  const property = await dependencies.repository.get(
    'properties',
    input.agencyId,
    input.propertyId,
  );
  if (!property) throw new Error('Property was not found.');
  const request = record<InspectionRequest>(requestRecord);
  const next: InspectionRequest = {
    ...request,
    propertyId: input.propertyId,
    propertyMatchStatus: 'matched',
    propertyMatchCandidates: request.propertyMatchCandidates || [],
    intakeStatus: deriveInspectionIntakeStatus({
      ...request,
      propertyId: input.propertyId,
      propertyMatchStatus: 'matched',
    }),
    updatedAt: new Date().toISOString(),
  };
  return record<InspectionRequest>(
    await dependencies.repository.update(
      'inspectionRequests',
      input.agencyId,
      input.requestId,
      next as unknown as Record<string, unknown>,
      input.expectedVersion,
      input.actorId,
    ),
  );
}

export async function convertInspectionRequestToJob(
  dependencies: ApiDependencies,
  input: {
    agencyId: string;
    requestId: string;
    expectedVersion: number;
    actorId: string;
    mapping?: InspectionServiceMapping;
  },
): Promise<{ request: InspectionRequest; job: StoredRecord }> {
  const requestRecord = await dependencies.repository.get(
    'inspectionRequests',
    input.agencyId,
    input.requestId,
  );
  if (!requestRecord) throw new Error('Inspection request was not found.');
  const request = record<InspectionRequest>(requestRecord);
  if (request.inspectionJobId) {
    const existingJob = await dependencies.repository.get(
      'inspectionJobs',
      input.agencyId,
      request.inspectionJobId,
    );
    if (existingJob) return { request, job: existingJob };
  }
  if (!request.propertyId) throw new Error('Inspection request must be linked to a property.');
  const propertyRecord = await dependencies.repository.get(
    'properties',
    input.agencyId,
    request.propertyId,
  );
  if (!propertyRecord) throw new Error('Linked property was not found.');
  const property = record<PropertyRecord>(propertyRecord);
  const tenancyId =
    request.tenancyId ||
    (await activeTenancyId(dependencies, input.agencyId, property.id));
  const readyRequest: InspectionRequest = {
    ...request,
    ...(tenancyId ? { tenancyId } : {}),
    intakeStatus: deriveInspectionIntakeStatus(request, input.mapping?.paymentRequired ?? request.source === 'shopify'),
  };
  if (readyRequest.intakeStatus !== 'ready_for_job') {
    throw new Error(`Inspection request is ${readyRequest.intakeStatus}, not ready for conversion.`);
  }
  const jobId = `job-${createHash('sha256')
    .update(`${input.agencyId}:${input.requestId}`)
    .digest('hex')
    .slice(0, 28)}`;
  const existingJob = await dependencies.repository.get('inspectionJobs', input.agencyId, jobId);
  if (existingJob) {
    const linkedRequest = record<InspectionRequest>(
      await dependencies.repository.update(
        'inspectionRequests',
        input.agencyId,
        input.requestId,
        {
          inspectionJobId: jobId,
          intakeStatus: 'converted',
          convertedAt: new Date().toISOString(),
        },
        input.expectedVersion,
        input.actorId,
      ),
    );
    return { request: linkedRequest, job: existingJob };
  }
  const now = new Date().toISOString();
  const jobInput = buildInspectionJobFromRequest(
    { ...readyRequest, intakeStatus: 'ready_for_job' },
    property,
    now,
  );
  const jobData: Record<string, unknown> = {
    ...jobInput,
    status: 'booked',
    ...(input.mapping?.defaultInspectorId
      ? { assignedInspectorId: input.mapping.defaultInspectorId }
      : {}),
    ...(input.mapping?.defaultReviewerId
      ? { assignedReviewerId: input.mapping.defaultReviewerId }
      : {}),
    ...(input.mapping?.templateId ? { templateId: input.mapping.templateId } : {}),
  };
  const readiness = calculateInspectionReadiness({
    request: readyRequest,
    job: jobData as never,
    property,
    paymentRequired: input.mapping?.paymentRequired ?? request.source === 'shopify',
    bookingRequired: true,
    reviewerRequired: true,
    baselineRequired: readyRequest.reportType === 'Exit Inspection',
  });
  const job = await dependencies.repository.create(
    'inspectionJobs',
    input.agencyId,
    jobId,
    { ...jobData, readiness },
    input.actorId,
  );
  const linkedRequest = record<InspectionRequest>(
    await dependencies.repository.update(
      'inspectionRequests',
      input.agencyId,
      input.requestId,
      {
        inspectionJobId: jobId,
        tenancyId,
        intakeStatus: 'converted',
        convertedAt: now,
      },
      input.expectedVersion,
      input.actorId,
    ),
  );
  return { request: linkedRequest, job };
}

export async function maybeAutoConvertInspectionRequest(
  dependencies: ApiDependencies,
  input: {
    agencyId: string;
    request: InspectionRequest;
    mapping?: InspectionServiceMapping;
    actorId: string;
    autoConvert: boolean;
  },
): Promise<{ request: InspectionRequest; job?: StoredRecord }> {
  if (!input.autoConvert || input.mapping?.manualApprovalRequired || input.request.intakeStatus !== 'ready_for_job') {
    return { request: input.request };
  }
  const result = await convertInspectionRequestToJob(dependencies, {
    agencyId: input.agencyId,
    requestId: input.request.id,
    expectedVersion: input.request.version || 1,
    actorId: input.actorId,
    mapping: input.mapping,
  });
  return result;
}
