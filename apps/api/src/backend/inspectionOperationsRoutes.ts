import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import {
  calculateInspectionReadiness,
  deriveInspectionIntakeStatus,
  nextRecurringDueDate,
  rankInspectorAssignments,
  type InspectionAccessStatus,
  type InspectionCommunication,
  type InspectionOperationalEvent,
  type InspectionRequest,
  type InspectionServiceMapping,
  type InspectorCapabilityProfile,
  type PropertyRecord,
  type RecurringInspectionSchedule,
} from '@pcr/domain';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import {
  convertInspectionRequestToJob,
  linkInspectionRequestToProperty,
  listAllRecords,
  properties,
  serviceMappings,
} from '../services/inspectionIntakeService.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies, IdempotencyResult, StoredRecord } from './types.js';

function parts(req: IncomingMessage): string[] {
  return new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean);
}

function agencyHeader(req: IncomingMessage): string {
  const agencyId = req.headers['x-agency-id']?.toString().trim();
  if (!agencyId) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.');
  return agencyId;
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 1_000_000) {
      throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Inspection operations payload exceeds 1 MB.');
    }
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('object required');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }
}

function positiveVersion(value: unknown, field = 'expectedVersion'): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new ApiError(400, 'EXPECTED_VERSION_REQUIRED', `${field} must be a positive integer.`);
  }
  return value;
}

function idempotencyKey(req: IncomingMessage): string {
  const value = req.headers['idempotency-key']?.toString().trim();
  if (!value || value.length < 8 || value.length > 200) {
    throw new ApiError(
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
      'Idempotency-Key containing 8 to 200 characters is required.',
    );
  }
  return value;
}

function bodyHash(body: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

async function idempotent(
  dependencies: ApiDependencies,
  req: IncomingMessage,
  agencyId: string,
  operation: string,
  body: Record<string, unknown>,
  action: () => Promise<IdempotencyResult>,
): Promise<ApiResponse> {
  const result = await dependencies.idempotency.execute(
    agencyId,
    operation,
    idempotencyKey(req),
    bodyHash(body),
    action,
  );
  return {
    status: result.result.status,
    body: result.result.body,
    headers: { 'idempotency-replayed': String(result.replayed) },
  };
}

function record<T>(value: StoredRecord): T {
  return value as unknown as T;
}

function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function automationActor(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  agencyId: string,
  correlationId: string,
): Promise<{ uid: string; role: string; agencyId: string }> {
  const supplied = req.headers['x-proinspect-automation-secret']?.toString();
  const expected = process.env.AUTOMATION_RUNNER_SECRET?.trim();
  if (supplied && expected && secureEqual(supplied, expected)) {
    return { uid: 'system:automation-runner', role: 'operations', agencyId };
  }
  return authenticateAndAuthorise(
    req,
    dependencies,
    'job.manage',
    { agencyId },
    correlationId,
  );
}

async function appendAudit(
  dependencies: ApiDependencies,
  input: {
    agencyId: string;
    actorId: string;
    actorRole: string;
    correlationId: string;
    eventType: string;
    entityType: string;
    entityId: string;
    propertyId?: string;
    inspectionJobId?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await dependencies.audit.append({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    actorId: input.actorId,
    actorRole: input.actorRole,
    agencyId: input.agencyId,
    capability: 'job.manage',
    outcome: 'allowed',
    reason: input.eventType,
    target: {
      agencyId: input.agencyId,
      ...(input.propertyId ? { propertyId: input.propertyId } : {}),
      ...(input.inspectionJobId ? { inspectionJobId: input.inspectionJobId } : {}),
    },
    correlationId: input.correlationId,
    eventType: input.eventType,
    entityType: input.entityType,
    entityId: input.entityId,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  });
}

async function eligibleEntryBaseline(
  dependencies: ApiDependencies,
  agencyId: string,
  propertyId: string,
  tenancyId?: string,
): Promise<boolean> {
  const reports = await listAllRecords(dependencies, 'reports', agencyId);
  return reports.some(
    (report) =>
      report.propertyId === propertyId &&
      (!tenancyId || report.tenancyId === tenancyId) &&
      String(report.reportType || '').toLowerCase().includes('property condition') &&
      [
        'approved_for_issue',
        'issued_to_tenant',
        'tenant_response_in_progress',
        'tenant_submitted',
        'agent_response_required',
        'finalisation_ready',
        'finalised',
        'archived',
      ].includes(String(report.lifecycleStatus || '')) &&
      typeof report.currentVersionId === 'string' &&
      report.currentVersionId.length > 0,
  );
}

async function readiness(
  dependencies: ApiDependencies,
  agencyId: string,
  job: StoredRecord,
): Promise<ReturnType<typeof calculateInspectionReadiness>> {
  const property = job.propertyId
    ? await dependencies.repository.get('properties', agencyId, String(job.propertyId))
    : undefined;
  const request = job.inspectionRequestId
    ? await dependencies.repository.get(
        'inspectionRequests',
        agencyId,
        String(job.inspectionRequestId),
      )
    : undefined;
  const entryBaselineAvailable =
    String(job.reportType || '') === 'Exit Inspection' && job.propertyId
      ? await eligibleEntryBaseline(
          dependencies,
          agencyId,
          String(job.propertyId),
          typeof job.tenancyId === 'string' ? job.tenancyId : undefined,
        )
      : true;
  return calculateInspectionReadiness({
    request: request
      ? {
          paymentStatus: record<InspectionRequest>(request).paymentStatus,
          bookingStatus: record<InspectionRequest>(request).bookingStatus,
          propertyMatchStatus: record<InspectionRequest>(request).propertyMatchStatus,
        }
      : undefined,
    job: job as never,
    property: property ? record<PropertyRecord>(property) : undefined,
    entryBaselineAvailable,
    baselineRequired: String(job.reportType || '') === 'Exit Inspection',
    paymentRequired: Boolean(request && record<InspectionRequest>(request).source === 'shopify'),
  });
}

async function materialiseRecurringSchedule(
  dependencies: ApiDependencies,
  input: {
    schedule: StoredRecord;
    agencyId: string;
    actorId: string;
  },
): Promise<{ request: StoredRecord; schedule: StoredRecord; created: boolean }> {
  const schedule = record<RecurringInspectionSchedule>(input.schedule);
  const dueKey = schedule.nextDueAt.slice(0, 10);
  const requestId = `recurring-${schedule.id}-${dueKey}`;
  const existing = await dependencies.repository.get(
    'inspectionRequests',
    input.agencyId,
    requestId,
  );
  const now = new Date().toISOString();
  const request = existing ||
    (await dependencies.repository.create(
      'inspectionRequests',
      input.agencyId,
      requestId,
      {
        source: 'recurring_schedule',
        sourceExternalId: `${schedule.id}:${dueKey}`,
        serviceCode: `recurring:${schedule.reportType}`,
        reportType: schedule.reportType,
        propertyId: schedule.propertyId,
        ...(schedule.tenancyId ? { tenancyId: schedule.tenancyId } : {}),
        propertyMatchStatus: 'matched',
        paymentStatus: 'not_required',
        bookingStatus: 'awaiting_booking',
        intakeStatus: 'awaiting_booking',
        priority: 'normal',
        notes: `Created from recurring inspection schedule ${schedule.id}.`,
        receivedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      input.actorId,
    ));
  const nextDueAt = nextRecurringDueDate(schedule, schedule.nextDueAt);
  const updatedSchedule = await dependencies.repository.update(
    'recurringInspectionSchedules',
    input.agencyId,
    schedule.id,
    { nextDueAt, lastMaterialisedAt: now },
    Number(input.schedule.version),
    input.actorId,
  );
  return { request, schedule: updatedSchedule, created: !existing };
}

function operationStatus(job: StoredRecord, now: number): 'on_track' | 'at_risk' | 'overdue' | 'not_applicable' {
  if (['finalised', 'archived', 'cancelled'].includes(String(job.status || ''))) return 'not_applicable';
  if (!job.scheduledAt || typeof job.scheduledAt !== 'string') return 'on_track';
  const scheduled = Date.parse(job.scheduledAt);
  if (!Number.isFinite(scheduled)) return 'on_track';
  if (scheduled < now && !['inspection_started', 'photos_uploading', 'photos_uploaded'].includes(String(job.status || ''))) {
    return 'overdue';
  }
  if (
    scheduled - now <= 2 * 60 * 60 * 1000 &&
    (!job.assignedInspectorId || !['confirmed', 'instructions_available', 'not_required'].includes(String(job.accessStatus || '')))
  ) {
    return 'at_risk';
  }
  return 'on_track';
}

export async function routeInspectionOperationsRequest(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
): Promise<ApiResponse | undefined> {
  const route = parts(req);
  if (route[0] !== 'api' || route[1] !== 'v1') return undefined;
  const resource = route[2];
  if (
    ![
      'inspection-operations',
      'inspection-requests',
      'inspection-jobs',
      'recurring-inspections',
      'integration-sync-exceptions',
    ].includes(resource || '')
  ) {
    return undefined;
  }

  const agencyId = agencyHeader(req);

  if (resource === 'inspection-operations' && route[3] === 'overview' && req.method === 'GET') {
    const principal = await authenticateAndAuthorise(
      req,
      dependencies,
      'job.read',
      { agencyId },
      correlationId,
    );
    const [requests, jobs, exceptions, schedules] = await Promise.all([
      listAllRecords(dependencies, 'inspectionRequests', agencyId),
      listAllRecords(dependencies, 'inspectionJobs', agencyId),
      listAllRecords(dependencies, 'integrationSyncExceptions', agencyId),
      listAllRecords(dependencies, 'recurringInspectionSchedules', agencyId),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    const activeJobs = jobs.filter(
      (job) => !['finalised', 'archived', 'cancelled'].includes(String(job.status || '')),
    );
    return {
      status: 200,
      body: {
        data: {
          intake: {
            total: requests.length,
            new: requests.filter((item) => ['received', 'needs_review'].includes(String(item.intakeStatus || ''))).length,
            awaitingPayment: requests.filter((item) => item.intakeStatus === 'awaiting_payment').length,
            awaitingBooking: requests.filter((item) => item.intakeStatus === 'awaiting_booking').length,
            propertyMatchRequired: requests.filter((item) => item.intakeStatus === 'awaiting_property').length,
            readyForJob: requests.filter((item) => item.intakeStatus === 'ready_for_job').length,
          },
          jobs: {
            total: jobs.length,
            active: activeJobs.length,
            bookedToday: activeJobs.filter((item) => String(item.scheduledAt || '').slice(0, 10) === today).length,
            unassigned: activeJobs.filter((item) => !item.assignedInspectorId).length,
            accessUnconfirmed: activeJobs.filter((item) => !['confirmed', 'instructions_available', 'not_required'].includes(String(item.accessStatus || ''))).length,
            overdue: activeJobs.filter((item) => operationStatus(item, Date.now()) === 'overdue').length,
            reviewRequired: activeJobs.filter((item) => ['review_required', 'changes_requested'].includes(String(item.status || ''))).length,
          },
          integrations: {
            openExceptions: exceptions.filter((item) => item.status === 'open').length,
            criticalExceptions: exceptions.filter((item) => item.status === 'open' && item.severity === 'critical').length,
          },
          recurring: {
            active: schedules.filter((item) => item.paused !== true).length,
            dueWithinThirtyDays: schedules.filter((item) => {
              const due = Date.parse(String(item.nextDueAt || ''));
              return Number.isFinite(due) && due <= Date.now() + 30 * 24 * 60 * 60 * 1000;
            }).length,
          },
        },
        meta: { correlationId, actor: principal.uid },
      },
    };
  }

  if (resource === 'inspection-operations' && route[3] === 'assignment-suggestions' && req.method === 'GET') {
    const principal = await authenticateAndAuthorise(
      req,
      dependencies,
      'job.read',
      { agencyId },
      correlationId,
    );
    const jobId = new URL(req.url ?? '/', 'http://localhost').searchParams.get('jobId');
    if (!jobId) throw new ApiError(400, 'JOB_ID_REQUIRED', 'jobId is required.');
    const job = await dependencies.repository.get('inspectionJobs', agencyId, jobId);
    if (!job) throw new ApiError(404, 'JOB_NOT_FOUND', 'Inspection job was not found.');
    const [profiles, jobs, property] = await Promise.all([
      listAllRecords(dependencies, 'inspectorCapabilityProfiles', agencyId),
      listAllRecords(dependencies, 'inspectionJobs', agencyId),
      job.propertyId
        ? dependencies.repository.get('properties', agencyId, String(job.propertyId))
        : Promise.resolve(undefined),
    ]);
    return {
      status: 200,
      body: {
        data: rankInspectorAssignments(
          profiles.map((item) => record<InspectorCapabilityProfile>(item)),
          {
            reportType: job.reportType as never,
            propertyUse: property?.propertyUse as never,
            suburbOrPostcode: [property?.suburb, property?.postcode]
              .filter(Boolean)
              .join(' '),
            scheduledAt: typeof job.scheduledAt === 'string' ? job.scheduledAt : undefined,
            jobs: jobs as never,
          },
        ),
        meta: { correlationId, actor: principal.uid },
      },
    };
  }

  if (resource === 'inspection-operations' && route[3] === 'run-automation' && req.method === 'POST') {
    const body = await readJson(req);
    const principal = await automationActor(req, dependencies, agencyId, correlationId);
    return idempotent(
      dependencies,
      req,
      agencyId,
      'inspection-operations:run-automation',
      body,
      async () => {
        const now = Date.now();
        const [schedules, jobs] = await Promise.all([
          listAllRecords(dependencies, 'recurringInspectionSchedules', agencyId),
          listAllRecords(dependencies, 'inspectionJobs', agencyId),
        ]);
        const materialised: string[] = [];
        for (const scheduleRecord of schedules) {
          const schedule = record<RecurringInspectionSchedule>(scheduleRecord);
          if (schedule.paused || !schedule.autoCreateRequest) continue;
          const threshold = now + schedule.bookingLeadDays * 24 * 60 * 60 * 1000;
          if (Date.parse(schedule.nextDueAt) <= threshold) {
            const result = await materialiseRecurringSchedule(dependencies, {
              schedule: scheduleRecord,
              agencyId,
              actorId: principal.uid,
            });
            if (result.created) materialised.push(result.request.id);
          }
        }
        const reminders: string[] = [];
        const slaUpdates: string[] = [];
        for (const job of jobs) {
          const slaStatus = operationStatus(job, now);
          if (job.slaStatus !== slaStatus) {
            await dependencies.repository.update(
              'inspectionJobs',
              agencyId,
              job.id,
              { slaStatus },
              Number(job.version),
              principal.uid,
            );
            slaUpdates.push(job.id);
          }
          const scheduledAt = typeof job.scheduledAt === 'string' ? Date.parse(job.scheduledAt) : NaN;
          if (
            Number.isFinite(scheduledAt) &&
            scheduledAt > now &&
            scheduledAt - now <= 24 * 60 * 60 * 1000 &&
            !job.lastReminderAt &&
            !['cancelled', 'finalised', 'archived'].includes(String(job.status || ''))
          ) {
            const communicationId = `communication-${randomUUID()}`;
            const communication: Omit<InspectionCommunication, 'id'> = {
              agencyId,
              inspectionJobId: job.id,
              type: 'reminder_sent',
              channel: 'system',
              summary: 'Automated reminder queued for the upcoming inspection.',
              status: 'queued',
              occurredAt: new Date().toISOString(),
              createdBy: principal.uid,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            await dependencies.repository.create(
              'inspectionCommunications',
              agencyId,
              communicationId,
              communication as unknown as Record<string, unknown>,
              principal.uid,
            );
            await dependencies.tasks.dispatch('notification', agencyId, communicationId, {
              inspectionJobId: job.id,
              communicationId,
              type: 'inspection_reminder',
            });
            const latest = await dependencies.repository.get('inspectionJobs', agencyId, job.id);
            if (latest) {
              await dependencies.repository.update(
                'inspectionJobs',
                agencyId,
                job.id,
                { lastReminderAt: new Date().toISOString() },
                Number(latest.version),
                principal.uid,
              );
            }
            reminders.push(job.id);
          }
        }
        await appendAudit(dependencies, {
          agencyId,
          actorId: principal.uid,
          actorRole: principal.role,
          correlationId,
          eventType: 'inspection.operations_automation_completed',
          entityType: 'system',
          entityId: `automation-${new Date().toISOString()}`,
          metadata: {
            materialisedRequests: materialised,
            reminders,
            slaUpdates,
          },
        });
        return {
          status: 200,
          body: {
            data: { materialisedRequests: materialised, reminders, slaUpdates },
            meta: { correlationId },
          },
        };
      },
    );
  }

  if (resource === 'inspection-jobs' && route[3] && route[4] === 'readiness' && req.method === 'GET') {
    const job = await dependencies.repository.get('inspectionJobs', agencyId, route[3]);
    if (!job) throw new ApiError(404, 'JOB_NOT_FOUND', 'Inspection job was not found.');
    const principal = await authenticateAndAuthorise(
      req,
      dependencies,
      'job.read',
      { agencyId, inspectionJobId: route[3], propertyId: String(job.propertyId || '') },
      correlationId,
    );
    return {
      status: 200,
      body: { data: await readiness(dependencies, agencyId, job), meta: { correlationId, actor: principal.uid } },
    };
  }

  if (resource === 'inspection-requests' && route[3] && route[4] === 'actions' && route[5]) {
    const requestId = route[3];
    const action = route[5];
    if (req.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Inspection request actions require POST.');
    const body = await readJson(req);
    const request = await dependencies.repository.get('inspectionRequests', agencyId, requestId);
    if (!request) throw new ApiError(404, 'INSPECTION_REQUEST_NOT_FOUND', 'Inspection request was not found.');
    const principal = await authenticateAndAuthorise(
      req,
      dependencies,
      'job.manage',
      {
        agencyId,
        ...(typeof request.propertyId === 'string' ? { propertyId: request.propertyId } : {}),
      },
      correlationId,
    );
    return idempotent(
      dependencies,
      req,
      agencyId,
      `inspection-request:${requestId}:${action}`,
      body,
      async () => {
        if (action === 'link-property') {
          const propertyId = typeof body.propertyId === 'string' ? body.propertyId.trim() : '';
          if (!propertyId) throw new ApiError(400, 'PROPERTY_ID_REQUIRED', 'propertyId is required.');
          const updated = await linkInspectionRequestToProperty(dependencies, {
            agencyId,
            requestId,
            propertyId,
            expectedVersion: positiveVersion(body.expectedVersion),
            actorId: principal.uid,
          });
          return { status: 200, body: { data: updated, meta: { correlationId } } };
        }
        if (action === 'convert-to-job') {
          const mappings = await serviceMappings(dependencies, agencyId);
          const typed = record<InspectionRequest>(request);
          const mapping = mappings.find(
            (item) => item.active && item.serviceCode === typed.serviceCode,
          );
          try {
            const result = await convertInspectionRequestToJob(dependencies, {
              agencyId,
              requestId,
              expectedVersion: positiveVersion(body.expectedVersion),
              actorId: principal.uid,
              mapping,
            });
            await appendAudit(dependencies, {
              agencyId,
              actorId: principal.uid,
              actorRole: principal.role,
              correlationId,
              eventType: 'inspection.request_converted',
              entityType: 'inspection_job',
              entityId: result.job.id,
              inspectionJobId: result.job.id,
              propertyId: String(result.job.propertyId || ''),
              metadata: { inspectionRequestId: requestId },
            });
            return { status: 201, body: { data: result, meta: { correlationId } } };
          } catch (error) {
            throw new ApiError(
              422,
              'INSPECTION_REQUEST_NOT_READY',
              error instanceof Error ? error.message : 'Inspection request could not be converted.',
            );
          }
        }
        if (action === 'cancel' || action === 'mark-duplicate') {
          const next = await dependencies.repository.update(
            'inspectionRequests',
            agencyId,
            requestId,
            action === 'cancel'
              ? {
                  intakeStatus: 'cancelled',
                  cancelledAt: new Date().toISOString(),
                  cancellationReason:
                    typeof body.reason === 'string' ? body.reason.trim() : 'Cancelled by operator.',
                }
              : {
                  intakeStatus: 'duplicate',
                  duplicateOfRequestId:
                    typeof body.duplicateOfRequestId === 'string'
                      ? body.duplicateOfRequestId
                      : undefined,
                },
            positiveVersion(body.expectedVersion),
            principal.uid,
          );
          return { status: 200, body: { data: next, meta: { correlationId } } };
        }
        if (action === 'recalculate') {
          const typed = record<InspectionRequest>(request);
          const recalculated = {
            ...typed,
            intakeStatus: deriveInspectionIntakeStatus(typed, typed.source === 'shopify'),
          };
          const updated = await dependencies.repository.update(
            'inspectionRequests',
            agencyId,
            requestId,
            recalculated as unknown as Record<string, unknown>,
            positiveVersion(body.expectedVersion),
            principal.uid,
          );
          return { status: 200, body: { data: updated, meta: { correlationId } } };
        }
        throw new ApiError(404, 'ACTION_NOT_FOUND', 'Inspection request action was not found.');
      },
    );
  }

  if (resource === 'inspection-jobs' && route[3] && route[4] === 'actions' && route[5]) {
    if (req.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Inspection job actions require POST.');
    const jobId = route[3];
    const action = route[5];
    const body = await readJson(req);
    const job = await dependencies.repository.get('inspectionJobs', agencyId, jobId);
    if (!job) throw new ApiError(404, 'JOB_NOT_FOUND', 'Inspection job was not found.');
    const principal = await authenticateAndAuthorise(
      req,
      dependencies,
      'job.manage',
      {
        agencyId,
        inspectionJobId: jobId,
        ...(typeof job.propertyId === 'string' ? { propertyId: job.propertyId } : {}),
      },
      correlationId,
    );
    return idempotent(
      dependencies,
      req,
      agencyId,
      `inspection-job:${jobId}:${action}`,
      body,
      async () => {
        if (action === 'reschedule') {
          const startAt = typeof body.startAt === 'string' ? body.startAt : '';
          if (!startAt || !Number.isFinite(Date.parse(startAt))) {
            throw new ApiError(400, 'START_TIME_REQUIRED', 'A valid startAt value is required.');
          }
          const duration =
            typeof body.durationMinutes === 'number'
              ? Math.max(1, Math.round(body.durationMinutes))
              : Number(job.durationMinutes || 60);
          const endAt =
            typeof body.endAt === 'string' && Number.isFinite(Date.parse(body.endAt))
              ? body.endAt
              : new Date(Date.parse(startAt) + duration * 60_000).toISOString();
          const updated = await dependencies.repository.update(
            'inspectionJobs',
            agencyId,
            jobId,
            {
              scheduledAt: startAt,
              scheduledEndAt: endAt,
              durationMinutes: duration,
              timezone:
                typeof body.timezone === 'string'
                  ? body.timezone
                  : String(job.timezone || 'Australia/Perth'),
              bookingStatus: 'rescheduled',
              lastCalendarSyncStatus: job.googleCalendar ? 'pending' : 'not_required',
            },
            positiveVersion(body.expectedVersion),
            principal.uid,
          );
          const eventId = `operational-${randomUUID()}`;
          await dependencies.repository.create(
            'inspectionOperationalEvents',
            agencyId,
            eventId,
            {
              inspectionJobId: jobId,
              type: 'rescheduled',
              reason:
                typeof body.reason === 'string' && body.reason.trim()
                  ? body.reason.trim()
                  : 'Inspection rescheduled.',
              previousStartAt: job.scheduledAt,
              previousEndAt: job.scheduledEndAt,
              newStartAt: startAt,
              newEndAt: endAt,
              feeReviewRequired: body.feeReviewRequired === true,
              createdBy: principal.uid,
              createdAt: new Date().toISOString(),
            },
            principal.uid,
          );
          return { status: 200, body: { data: updated, meta: { correlationId } } };
        }
        if (action === 'access-status') {
          const allowed = new Set<InspectionAccessStatus>([
            'not_required',
            'unknown',
            'instructions_available',
            'confirmation_requested',
            'confirmed',
            'failed',
            'unable_to_access',
          ]);
          const accessStatus = body.accessStatus;
          if (typeof accessStatus !== 'string' || !allowed.has(accessStatus as InspectionAccessStatus)) {
            throw new ApiError(400, 'ACCESS_STATUS_INVALID', 'A supported accessStatus is required.');
          }
          const updated = await dependencies.repository.update(
            'inspectionJobs',
            agencyId,
            jobId,
            {
              accessStatus,
              ...(typeof body.accessInstructions === 'string'
                ? { accessInstructions: body.accessInstructions.trim() }
                : {}),
              accessStatusUpdatedAt: new Date().toISOString(),
            },
            positiveVersion(body.expectedVersion),
            principal.uid,
          );
          return { status: 200, body: { data: updated, meta: { correlationId } } };
        }
        if (action === 'refresh-readiness') {
          const result = await readiness(dependencies, agencyId, job);
          const updated = await dependencies.repository.update(
            'inspectionJobs',
            agencyId,
            jobId,
            { readiness: result },
            positiveVersion(body.expectedVersion),
            principal.uid,
          );
          return { status: 200, body: { data: updated, meta: { correlationId } } };
        }
        throw new ApiError(404, 'ACTION_NOT_FOUND', 'Inspection job action was not found.');
      },
    );
  }

  if (resource === 'inspection-jobs' && route[3] && route[4] === 'communications' && req.method === 'POST') {
    const jobId = route[3];
    const body = await readJson(req);
    const job = await dependencies.repository.get('inspectionJobs', agencyId, jobId);
    if (!job) throw new ApiError(404, 'JOB_NOT_FOUND', 'Inspection job was not found.');
    const principal = await authenticateAndAuthorise(
      req,
      dependencies,
      'job.manage',
      { agencyId, inspectionJobId: jobId },
      correlationId,
    );
    return idempotent(
      dependencies,
      req,
      agencyId,
      `inspection-job:${jobId}:communication`,
      body,
      async () => {
        const summary = typeof body.summary === 'string' ? body.summary.trim() : '';
        if (!summary) throw new ApiError(400, 'SUMMARY_REQUIRED', 'Communication summary is required.');
        const id = `communication-${randomUUID()}`;
        const now = new Date().toISOString();
        const communication = await dependencies.repository.create(
          'inspectionCommunications',
          agencyId,
          id,
          {
            inspectionJobId: jobId,
            ...(job.inspectionRequestId
              ? { inspectionRequestId: job.inspectionRequestId }
              : {}),
            type: typeof body.type === 'string' ? body.type : 'general',
            channel: typeof body.channel === 'string' ? body.channel : 'system',
            ...(typeof body.recipient === 'string' ? { recipient: body.recipient } : {}),
            ...(typeof body.subject === 'string' ? { subject: body.subject } : {}),
            summary,
            status: body.send === true ? 'queued' : 'recorded',
            occurredAt:
              typeof body.occurredAt === 'string' ? body.occurredAt : now,
            createdBy: principal.uid,
            createdAt: now,
            updatedAt: now,
          },
          principal.uid,
        );
        if (body.send === true) {
          await dependencies.tasks.dispatch('notification', agencyId, id, {
            inspectionJobId: jobId,
            communicationId: id,
            type: communication.type,
            recipient: communication.recipient,
          });
        }
        return { status: 201, body: { data: communication, meta: { correlationId } } };
      },
    );
  }

  if (resource === 'inspection-jobs' && route[3] && route[4] === 'operational-events' && req.method === 'POST') {
    const jobId = route[3];
    const body = await readJson(req);
    const job = await dependencies.repository.get('inspectionJobs', agencyId, jobId);
    if (!job) throw new ApiError(404, 'JOB_NOT_FOUND', 'Inspection job was not found.');
    const principal = await authenticateAndAuthorise(
      req,
      dependencies,
      'job.manage',
      { agencyId, inspectionJobId: jobId },
      correlationId,
    );
    return idempotent(
      dependencies,
      req,
      agencyId,
      `inspection-job:${jobId}:operational-event`,
      body,
      async () => {
        const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
        if (!reason) throw new ApiError(400, 'REASON_REQUIRED', 'Operational event reason is required.');
        const id = `operational-${randomUUID()}`;
        const event: Omit<InspectionOperationalEvent, 'id'> = {
          agencyId,
          inspectionJobId: jobId,
          type: typeof body.type === 'string' ? body.type as never : 'general',
          reason,
          ...(typeof body.previousStartAt === 'string'
            ? { previousStartAt: body.previousStartAt }
            : {}),
          ...(typeof body.newStartAt === 'string' ? { newStartAt: body.newStartAt } : {}),
          ...(typeof body.previousEndAt === 'string'
            ? { previousEndAt: body.previousEndAt }
            : {}),
          ...(typeof body.newEndAt === 'string' ? { newEndAt: body.newEndAt } : {}),
          feeReviewRequired: body.feeReviewRequired === true,
          createdBy: principal.uid,
          createdAt: new Date().toISOString(),
        };
        const created = await dependencies.repository.create(
          'inspectionOperationalEvents',
          agencyId,
          id,
          event as unknown as Record<string, unknown>,
          principal.uid,
        );
        if (['unable_to_access', 'keys_unavailable', 'tenant_not_present', 'no_show'].includes(String(event.type))) {
          await dependencies.repository.update(
            'inspectionJobs',
            agencyId,
            jobId,
            { accessStatus: 'unable_to_access', operationalAttentionRequired: true },
            Number(job.version),
            principal.uid,
          );
        }
        return { status: 201, body: { data: created, meta: { correlationId } } };
      },
    );
  }

  if (resource === 'recurring-inspections' && route[3] && route[4] === 'actions' && route[5] === 'materialise' && req.method === 'POST') {
    const body = await readJson(req);
    const schedule = await dependencies.repository.get(
      'recurringInspectionSchedules',
      agencyId,
      route[3],
    );
    if (!schedule) throw new ApiError(404, 'SCHEDULE_NOT_FOUND', 'Recurring inspection schedule was not found.');
    const principal = await authenticateAndAuthorise(
      req,
      dependencies,
      'job.manage',
      { agencyId, propertyId: String(schedule.propertyId || '') },
      correlationId,
    );
    positiveVersion(body.expectedVersion);
    return idempotent(
      dependencies,
      req,
      agencyId,
      `recurring-inspection:${route[3]}:materialise`,
      body,
      async () => {
        if (Number(schedule.version) !== body.expectedVersion) {
          throw new ApiError(409, 'VERSION_CONFLICT', 'Recurring schedule changed before materialisation.');
        }
        const result = await materialiseRecurringSchedule(dependencies, {
          schedule,
          agencyId,
          actorId: principal.uid,
        });
        return { status: result.created ? 201 : 200, body: { data: result, meta: { correlationId } } };
      },
    );
  }

  if (resource === 'integration-sync-exceptions' && route[3] && route[4] === 'actions' && route[5] === 'resolve' && req.method === 'POST') {
    const body = await readJson(req);
    const exception = await dependencies.repository.get(
      'integrationSyncExceptions',
      agencyId,
      route[3],
    );
    if (!exception) throw new ApiError(404, 'SYNC_EXCEPTION_NOT_FOUND', 'Sync exception was not found.');
    const principal = await authenticateAndAuthorise(
      req,
      dependencies,
      'job.manage',
      { agencyId },
      correlationId,
    );
    return idempotent(
      dependencies,
      req,
      agencyId,
      `sync-exception:${route[3]}:resolve`,
      body,
      async () => {
        const resolution = typeof body.resolution === 'string' ? body.resolution.trim() : '';
        if (!resolution) throw new ApiError(400, 'RESOLUTION_REQUIRED', 'resolution is required.');
        const updated = await dependencies.repository.update(
          'integrationSyncExceptions',
          agencyId,
          route[3],
          {
            status: body.ignore === true ? 'ignored' : 'resolved',
            resolution,
            resolvedAt: new Date().toISOString(),
            resolvedBy: principal.uid,
          },
          positiveVersion(body.expectedVersion),
          principal.uid,
        );
        return { status: 200, body: { data: updated, meta: { correlationId } } };
      },
    );
  }

  return undefined;
}
