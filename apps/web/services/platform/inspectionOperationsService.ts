import {
  calculateInspectionReadiness,
  deriveInspectionIntakeStatus,
  nextRecurringDueDate,
  type InspectionAccessStatus,
  type InspectionCommunication,
  type InspectionIntakeStatus,
  type InspectionJob,
  type InspectionOperationalEvent,
  type InspectionReadinessResult,
  type InspectionRequest,
  type InspectionServiceMapping,
  type InspectorCapabilityProfile,
  type IntegrationConnection,
  type IntegrationSyncException,
  type RecurringInspectionSchedule,
} from '../../types/platform';
import { generateId } from '../../utils';
import { apiRequest } from '../apiClient';
import { isFirebaseConfigured } from '../storageService';
import { localGet, localList, localPut } from './localPlatformStore';
import { getInspectionJob, listInspectionJobs, updateInspectionJob } from './inspectionJobService';
import { getProperty } from './propertyService';

export interface InspectionOperationsOverview {
  intake: {
    total: number;
    new: number;
    awaitingPayment: number;
    awaitingBooking: number;
    propertyMatchRequired: number;
    readyForJob: number;
  };
  jobs: {
    total: number;
    active: number;
    bookedToday: number;
    unassigned: number;
    accessUnconfirmed: number;
    overdue: number;
    reviewRequired: number;
  };
  integrations: {
    openExceptions: number;
    criticalExceptions: number;
  };
  recurring: {
    active: number;
    dueWithinThirtyDays: number;
  };
}

export interface ShopifyIntegrationStatus {
  connection: IntegrationConnection | null;
  mappings: InspectionServiceMapping[];
}

export interface GoogleCalendarIntegrationStatus {
  connection: IntegrationConnection | null;
  mappings: InspectionServiceMapping[];
}

function cloudMode(): boolean {
  return isFirebaseConfigured() && Boolean(import.meta.env.VITE_API_BASE_URL?.trim());
}

function agencyId(): string | undefined {
  if (typeof window === 'undefined') return 'agency-1';
  return window.localStorage.getItem('pcr_agency_id') || window.localStorage.getItem('agencyId') || 'agency-1';
}

function version(record: { version?: number }): number {
  return record.version ?? 1;
}

function statusCount(requests: InspectionRequest[], status: InspectionIntakeStatus): number {
  return requests.filter((request) => request.intakeStatus === status).length;
}

export async function getInspectionOperationsOverview(): Promise<InspectionOperationsOverview> {
  if (cloudMode()) {
    return apiRequest<InspectionOperationsOverview>(
      agencyId(),
      '/api/v1/inspection-operations/overview',
    );
  }
  const [requests, jobs, exceptions, schedules] = await Promise.all([
    localList<InspectionRequest>('inspectionRequests'),
    listInspectionJobs(),
    localList<IntegrationSyncException>('integrationSyncExceptions'),
    localList<RecurringInspectionSchedule>('recurringInspectionSchedules'),
  ]);
  const active = jobs.filter((job) => !['finalised', 'archived', 'cancelled'].includes(job.status));
  const today = new Date().toISOString().slice(0, 10);
  return {
    intake: {
      total: requests.length,
      new: requests.filter((request) => ['received', 'needs_review'].includes(request.intakeStatus)).length,
      awaitingPayment: statusCount(requests, 'awaiting_payment'),
      awaitingBooking: statusCount(requests, 'awaiting_booking'),
      propertyMatchRequired: statusCount(requests, 'awaiting_property'),
      readyForJob: statusCount(requests, 'ready_for_job'),
    },
    jobs: {
      total: jobs.length,
      active: active.length,
      bookedToday: active.filter((job) => job.scheduledAt?.slice(0, 10) === today).length,
      unassigned: active.filter((job) => !job.assignedInspectorId).length,
      accessUnconfirmed: active.filter((job) => !['confirmed', 'instructions_available', 'not_required'].includes(job.accessStatus || '')).length,
      overdue: active.filter((job) => job.scheduledAt && Date.parse(job.scheduledAt) < Date.now() && !['inspection_started', 'photos_uploading', 'photos_uploaded'].includes(job.status)).length,
      reviewRequired: active.filter((job) => ['review_required', 'changes_requested'].includes(job.status)).length,
    },
    integrations: {
      openExceptions: exceptions.filter((item) => item.status === 'open').length,
      criticalExceptions: exceptions.filter((item) => item.status === 'open' && item.severity === 'critical').length,
    },
    recurring: {
      active: schedules.filter((item) => !item.paused).length,
      dueWithinThirtyDays: schedules.filter((item) => Date.parse(item.nextDueAt) <= Date.now() + 30 * 86_400_000).length,
    },
  };
}

export async function listInspectionRequests(): Promise<InspectionRequest[]> {
  if (cloudMode()) return apiRequest<InspectionRequest[]>(agencyId(), '/api/v1/inspection-requests?limit=100');
  return localList<InspectionRequest>('inspectionRequests');
}

export async function createInspectionRequest(
  input: Omit<InspectionRequest, 'id' | 'createdAt' | 'updatedAt' | 'receivedAt' | 'intakeStatus'> &
    Partial<Pick<InspectionRequest, 'id' | 'intakeStatus'>>,
): Promise<InspectionRequest> {
  const now = new Date().toISOString();
  const request: InspectionRequest = {
    ...input,
    id: input.id || `request-${generateId()}`,
    receivedAt: now,
    createdAt: now,
    updatedAt: now,
    intakeStatus: input.intakeStatus || deriveInspectionIntakeStatus(input),
  };
  if (cloudMode()) {
    return apiRequest<InspectionRequest>(request.agencyId, '/api/v1/inspection-requests', {
      method: 'POST',
      body: request,
    });
  }
  await localPut('inspectionRequests', request);
  return request;
}

export async function linkInspectionRequestProperty(
  request: InspectionRequest,
  propertyId: string,
): Promise<InspectionRequest> {
  if (cloudMode()) {
    return apiRequest<InspectionRequest>(
      request.agencyId,
      `/api/v1/inspection-requests/${encodeURIComponent(request.id)}/actions/link-property`,
      {
        method: 'POST',
        body: { propertyId, expectedVersion: version(request) },
      },
    );
  }
  const updated: InspectionRequest = {
    ...request,
    propertyId,
    propertyMatchStatus: 'matched',
    intakeStatus: deriveInspectionIntakeStatus({ ...request, propertyId, propertyMatchStatus: 'matched' }),
    updatedAt: new Date().toISOString(),
  };
  await localPut('inspectionRequests', updated);
  return updated;
}

export async function convertInspectionRequest(
  request: InspectionRequest,
): Promise<{ request: InspectionRequest; job: InspectionJob }> {
  if (cloudMode()) {
    return apiRequest<{ request: InspectionRequest; job: InspectionJob }>(
      request.agencyId,
      `/api/v1/inspection-requests/${encodeURIComponent(request.id)}/actions/convert-to-job`,
      { method: 'POST', body: { expectedVersion: version(request) } },
    );
  }
  if (!request.propertyId || !request.reportType) throw new Error('Match a property and report type before conversion.');
  const property = await getProperty(request.propertyId);
  if (!property) throw new Error('Matched property was not found.');
  const now = new Date().toISOString();
  const job: InspectionJob = {
    id: `job-${generateId()}`,
    agencyId: request.agencyId,
    propertyId: property.id,
    tenancyId: request.tenancyId,
    reportType: request.reportType,
    scheduledAt: request.requestedStartAt,
    scheduledEndAt: request.requestedEndAt,
    timezone: request.timezone || 'Australia/Perth',
    status: 'booked',
    source: request.source,
    inspectionRequestId: request.id,
    paymentStatus: request.paymentStatus,
    bookingStatus: request.bookingStatus,
    propertyMatchStatus: 'matched',
    priority: request.priority,
    durationMinutes: request.durationMinutes,
    accessStatus: request.accessInstructions ? 'instructions_available' : 'unknown',
    notes: request.notes,
    shopifyOrder: request.shopifyOrder,
    shopifyOrderId: request.shopifyOrder?.orderGid,
    googleCalendar: request.googleCalendar,
    createdAt: now,
    updatedAt: now,
  };
  await localPut('inspectionJobs', job);
  const updatedRequest: InspectionRequest = {
    ...request,
    inspectionJobId: job.id,
    intakeStatus: 'converted',
    convertedAt: now,
    updatedAt: now,
  };
  await localPut('inspectionRequests', updatedRequest);
  return { request: updatedRequest, job };
}

export async function cancelInspectionRequest(
  request: InspectionRequest,
  reason: string,
): Promise<InspectionRequest> {
  if (cloudMode()) {
    return apiRequest<InspectionRequest>(
      request.agencyId,
      `/api/v1/inspection-requests/${encodeURIComponent(request.id)}/actions/cancel`,
      { method: 'POST', body: { expectedVersion: version(request), reason } },
    );
  }
  const updated: InspectionRequest = {
    ...request,
    intakeStatus: 'cancelled',
    cancelledAt: new Date().toISOString(),
    notes: [request.notes, `Cancelled: ${reason}`].filter(Boolean).join('\n'),
    updatedAt: new Date().toISOString(),
  };
  await localPut('inspectionRequests', updated);
  return updated;
}

export async function getInspectionJobReadiness(job: InspectionJob): Promise<InspectionReadinessResult> {
  if (cloudMode()) {
    return apiRequest<InspectionReadinessResult>(
      job.agencyId,
      `/api/v1/inspection-jobs/${encodeURIComponent(job.id)}/readiness`,
    );
  }
  const property = await getProperty(job.propertyId);
  const request = job.inspectionRequestId
    ? await localGet<InspectionRequest>('inspectionRequests', job.inspectionRequestId)
    : undefined;
  return calculateInspectionReadiness({
    request,
    job,
    property,
    paymentRequired: request?.source === 'shopify',
    baselineRequired: job.reportType === 'Exit Inspection',
    entryBaselineAvailable: job.reportType !== 'Exit Inspection',
  });
}

export async function refreshInspectionJobReadiness(job: InspectionJob): Promise<InspectionJob> {
  if (cloudMode()) {
    return apiRequest<InspectionJob>(
      job.agencyId,
      `/api/v1/inspection-jobs/${encodeURIComponent(job.id)}/actions/refresh-readiness`,
      { method: 'POST', body: { expectedVersion: version(job) } },
    );
  }
  return updateInspectionJob(job.id, { readiness: await getInspectionJobReadiness(job) });
}

export async function rescheduleInspectionJob(
  job: InspectionJob,
  input: { startAt: string; endAt?: string; durationMinutes?: number; timezone?: string; reason: string },
): Promise<InspectionJob> {
  if (cloudMode()) {
    return apiRequest<InspectionJob>(
      job.agencyId,
      `/api/v1/inspection-jobs/${encodeURIComponent(job.id)}/actions/reschedule`,
      { method: 'POST', body: { ...input, expectedVersion: version(job) } },
    );
  }
  const duration = input.durationMinutes || job.durationMinutes || 60;
  return updateInspectionJob(job.id, {
    scheduledAt: input.startAt,
    scheduledEndAt: input.endAt || new Date(Date.parse(input.startAt) + duration * 60_000).toISOString(),
    durationMinutes: duration,
    timezone: input.timezone || job.timezone || 'Australia/Perth',
    bookingStatus: 'rescheduled',
  });
}

export async function updateInspectionAccessStatus(
  job: InspectionJob,
  accessStatus: InspectionAccessStatus,
  accessInstructions?: string,
): Promise<InspectionJob> {
  if (cloudMode()) {
    return apiRequest<InspectionJob>(
      job.agencyId,
      `/api/v1/inspection-jobs/${encodeURIComponent(job.id)}/actions/access-status`,
      {
        method: 'POST',
        body: { accessStatus, accessInstructions, expectedVersion: version(job) },
      },
    );
  }
  return updateInspectionJob(job.id, { accessStatus, ...(accessInstructions ? { notes: accessInstructions } : {}) });
}

export async function syncInspectionJobCalendar(job: InspectionJob): Promise<InspectionJob> {
  if (!cloudMode()) return job;
  return apiRequest<InspectionJob>(
    job.agencyId,
    `/api/v1/inspection-jobs/${encodeURIComponent(job.id)}/calendar/sync`,
    { method: 'POST', body: {} },
  );
}

export async function listInspectionCommunications(jobId?: string): Promise<InspectionCommunication[]> {
  const records = cloudMode()
    ? await apiRequest<InspectionCommunication[]>(agencyId(), '/api/v1/inspection-communications?limit=100')
    : await localList<InspectionCommunication>('inspectionCommunications');
  return jobId ? records.filter((item) => item.inspectionJobId === jobId) : records;
}

export async function createInspectionCommunication(
  job: InspectionJob,
  input: Pick<InspectionCommunication, 'type' | 'channel' | 'summary'> &
    Partial<Pick<InspectionCommunication, 'recipient' | 'subject'>> & { send?: boolean },
): Promise<InspectionCommunication> {
  if (cloudMode()) {
    return apiRequest<InspectionCommunication>(
      job.agencyId,
      `/api/v1/inspection-jobs/${encodeURIComponent(job.id)}/communications`,
      { method: 'POST', body: input },
    );
  }
  const now = new Date().toISOString();
  const record: InspectionCommunication = {
    id: `communication-${generateId()}`,
    agencyId: job.agencyId,
    inspectionJobId: job.id,
    inspectionRequestId: job.inspectionRequestId,
    type: input.type,
    channel: input.channel,
    summary: input.summary,
    recipient: input.recipient,
    subject: input.subject,
    status: input.send ? 'queued' : 'recorded',
    occurredAt: now,
    createdAt: now,
    updatedAt: now,
  };
  await localPut('inspectionCommunications', record);
  return record;
}

export async function listInspectionOperationalEvents(jobId?: string): Promise<InspectionOperationalEvent[]> {
  const records = cloudMode()
    ? await apiRequest<InspectionOperationalEvent[]>(agencyId(), '/api/v1/inspection-operational-events?limit=100')
    : await localList<InspectionOperationalEvent>('inspectionOperationalEvents');
  return jobId ? records.filter((item) => item.inspectionJobId === jobId) : records;
}

export async function createInspectionOperationalEvent(
  job: InspectionJob,
  input: Pick<InspectionOperationalEvent, 'type' | 'reason'> &
    Partial<Pick<InspectionOperationalEvent, 'previousStartAt' | 'newStartAt' | 'previousEndAt' | 'newEndAt' | 'feeReviewRequired'>>,
): Promise<InspectionOperationalEvent> {
  if (cloudMode()) {
    return apiRequest<InspectionOperationalEvent>(
      job.agencyId,
      `/api/v1/inspection-jobs/${encodeURIComponent(job.id)}/operational-events`,
      { method: 'POST', body: input },
    );
  }
  const record: InspectionOperationalEvent = {
    id: `operational-${generateId()}`,
    agencyId: job.agencyId,
    inspectionJobId: job.id,
    type: input.type,
    reason: input.reason,
    previousStartAt: input.previousStartAt,
    newStartAt: input.newStartAt,
    previousEndAt: input.previousEndAt,
    newEndAt: input.newEndAt,
    feeReviewRequired: input.feeReviewRequired === true,
    createdBy: 'local-operator',
    createdAt: new Date().toISOString(),
  };
  await localPut('inspectionOperationalEvents', record);
  return record;
}

export async function listInspectorCapabilityProfiles(): Promise<InspectorCapabilityProfile[]> {
  if (cloudMode()) return apiRequest<InspectorCapabilityProfile[]>(agencyId(), '/api/v1/inspector-capability-profiles?limit=100');
  return localList<InspectorCapabilityProfile>('inspectorCapabilityProfiles');
}

export async function getAssignmentSuggestions(jobId: string): Promise<Array<{ userId: string; displayName: string; score: number; reasons: string[]; currentDayJobs: number; capacityRemaining?: number }>> {
  if (!cloudMode()) return [];
  return apiRequest(
    agencyId(),
    `/api/v1/inspection-operations/assignment-suggestions?jobId=${encodeURIComponent(jobId)}`,
  );
}

export async function listRecurringInspectionSchedules(): Promise<RecurringInspectionSchedule[]> {
  if (cloudMode()) return apiRequest<RecurringInspectionSchedule[]>(agencyId(), '/api/v1/recurring-inspections?limit=100');
  return localList<RecurringInspectionSchedule>('recurringInspectionSchedules');
}

export async function saveRecurringInspectionSchedule(
  schedule: Omit<RecurringInspectionSchedule, 'id' | 'createdAt' | 'updatedAt'> & Partial<Pick<RecurringInspectionSchedule, 'id'>>,
): Promise<RecurringInspectionSchedule> {
  const now = new Date().toISOString();
  const record: RecurringInspectionSchedule = {
    ...schedule,
    id: schedule.id || `recurring-${generateId()}`,
    createdAt: now,
    updatedAt: now,
  };
  if (cloudMode()) {
    return apiRequest<RecurringInspectionSchedule>(record.agencyId, '/api/v1/recurring-inspections', {
      method: 'POST',
      body: record,
    });
  }
  await localPut('recurringInspectionSchedules', record);
  return record;
}

export async function materialiseRecurringInspection(
  schedule: RecurringInspectionSchedule,
): Promise<{ request: InspectionRequest; schedule: RecurringInspectionSchedule; created: boolean }> {
  if (cloudMode()) {
    return apiRequest(
      schedule.agencyId,
      `/api/v1/recurring-inspections/${encodeURIComponent(schedule.id)}/actions/materialise`,
      { method: 'POST', body: { expectedVersion: version(schedule) } },
    );
  }
  const now = new Date().toISOString();
  const request = await createInspectionRequest({
    agencyId: schedule.agencyId,
    source: 'recurring_schedule',
    sourceExternalId: `${schedule.id}:${schedule.nextDueAt.slice(0, 10)}`,
    serviceCode: `recurring:${schedule.reportType}`,
    reportType: schedule.reportType,
    propertyId: schedule.propertyId,
    tenancyId: schedule.tenancyId,
    propertyMatchStatus: 'matched',
    paymentStatus: 'not_required',
    bookingStatus: 'awaiting_booking',
    priority: 'normal',
    notes: `Created from recurring schedule ${schedule.id}.`,
  });
  const updated = {
    ...schedule,
    nextDueAt: nextRecurringDueDate(schedule, schedule.nextDueAt),
    updatedAt: now,
  };
  await localPut('recurringInspectionSchedules', updated);
  return { request, schedule: updated, created: true };
}

export async function listIntegrationSyncExceptions(): Promise<IntegrationSyncException[]> {
  if (cloudMode()) return apiRequest<IntegrationSyncException[]>(agencyId(), '/api/v1/integration-sync-exceptions?limit=100');
  return localList<IntegrationSyncException>('integrationSyncExceptions');
}

export async function resolveIntegrationSyncException(
  exception: IntegrationSyncException,
  resolution: string,
  ignore = false,
): Promise<IntegrationSyncException> {
  if (cloudMode()) {
    return apiRequest<IntegrationSyncException>(
      exception.agencyId,
      `/api/v1/integration-sync-exceptions/${encodeURIComponent(exception.id)}/actions/resolve`,
      { method: 'POST', body: { expectedVersion: version(exception), resolution, ignore } },
    );
  }
  const updated = {
    ...exception,
    status: ignore ? 'ignored' as const : 'resolved' as const,
    resolution,
    resolvedAt: new Date().toISOString(),
    resolvedBy: 'local-operator',
    updatedAt: new Date().toISOString(),
  };
  await localPut('integrationSyncExceptions', updated);
  return updated;
}

export async function getShopifyIntegrationStatus(): Promise<ShopifyIntegrationStatus> {
  if (!cloudMode()) {
    const connection = await localGet<IntegrationConnection>('integrationConnections', 'shopify');
    const mappings = (await localList<InspectionServiceMapping>('inspectionServiceMappings')).filter((item) => item.provider === 'shopify');
    return { connection: connection || null, mappings };
  }
  return apiRequest<ShopifyIntegrationStatus>(agencyId(), '/api/v1/integrations/shopify');
}

export async function connectShopify(input: {
  shopDomain: string;
  accessToken: string;
  publicApiBaseUrl?: string;
  autoConvertReadyRequests?: boolean;
}): Promise<unknown> {
  return apiRequest(agencyId(), '/api/v1/integrations/shopify/connect', {
    method: 'POST',
    body: input,
  });
}

export async function reconcileShopify(updatedSince?: string): Promise<unknown> {
  return apiRequest(agencyId(), '/api/v1/integrations/shopify/reconcile', {
    method: 'POST',
    body: { updatedSince },
  });
}

export async function seedShopifyMappings(replace = false): Promise<InspectionServiceMapping[]> {
  return apiRequest(agencyId(), '/api/v1/integrations/shopify/seed-mappings', {
    method: 'POST',
    body: { replace },
  });
}

export async function getGoogleCalendarIntegrationStatus(): Promise<GoogleCalendarIntegrationStatus> {
  if (!cloudMode()) {
    const connection = await localGet<IntegrationConnection>('integrationConnections', 'google-calendar');
    const mappings = (await localList<InspectionServiceMapping>('inspectionServiceMappings')).filter((item) => item.provider === 'google_calendar');
    return { connection: connection || null, mappings };
  }
  return apiRequest<GoogleCalendarIntegrationStatus>(agencyId(), '/api/v1/integrations/google-calendar');
}

export async function beginGoogleCalendarConnection(returnPath?: string): Promise<string> {
  const response = await apiRequest<{ authorisationUrl: string }>(
    agencyId(),
    '/api/v1/integrations/google-calendar/oauth/start',
    { method: 'POST', body: { returnPath } },
  );
  return response.authorisationUrl;
}

export async function listConnectedGoogleCalendars(): Promise<Array<{ id: string; summary?: string; primary?: boolean; accessRole?: string }>> {
  return apiRequest(agencyId(), '/api/v1/integrations/google-calendar/calendars');
}

export async function configureGoogleCalendar(input: {
  expectedVersion: number;
  calendarId: string;
  calendarLabel?: string;
  timezone?: string;
  autoConvertReadyRequests?: boolean;
  initialLookbackDays?: number;
  bookingPages?: string[];
}): Promise<IntegrationConnection> {
  return apiRequest(agencyId(), '/api/v1/integrations/google-calendar/configure', {
    method: 'POST',
    body: input,
  });
}

export async function createGoogleCalendarWatch(publicApiBaseUrl?: string): Promise<IntegrationConnection> {
  return apiRequest(agencyId(), '/api/v1/integrations/google-calendar/watch', {
    method: 'POST',
    body: { publicApiBaseUrl },
  });
}

export async function reconcileGoogleCalendar(forceFull = false): Promise<unknown> {
  return apiRequest(agencyId(), '/api/v1/integrations/google-calendar/reconcile', {
    method: 'POST',
    body: { forceFull },
  });
}

export async function seedGoogleCalendarMappings(replace = false): Promise<InspectionServiceMapping[]> {
  return apiRequest(agencyId(), '/api/v1/integrations/google-calendar/seed-mappings', {
    method: 'POST',
    body: { replace },
  });
}
