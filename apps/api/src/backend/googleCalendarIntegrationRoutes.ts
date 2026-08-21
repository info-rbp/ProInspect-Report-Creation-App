import { randomBytes, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import {
  externalCancellationAction,
  parseCalendarBookingFields,
  type GoogleCalendarReference,
  type InspectionRequest,
  type InspectionServiceMapping,
  type IntegrationConnection,
} from '@pcr/domain';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import {
  loadIntegrationCredentials,
  saveIntegrationCredentials,
} from '../services/integrationCredentialStore.js';
import {
  createSyncException,
  findRequestByExternalId,
  listAllRecords,
  maybeAutoConvertInspectionRequest,
  serviceMappings,
  upsertCalendarInspectionRequest,
} from '../services/inspectionIntakeService.js';
import {
  buildGoogleCalendarAuthorisationUrl,
  cancelGoogleInspectionEvent,
  createGoogleCalendarWatch,
  createGoogleInspectionEvent,
  defaultGoogleCalendarServiceMappings,
  exchangeGoogleCalendarCode,
  googleCalendarReference,
  googleTokensNeedRefresh,
  isCalendarEventEligibleForInspection,
  listGoogleCalendarEvents,
  listGoogleCalendars,
  matchCalendarServiceMapping,
  refreshGoogleCalendarTokens,
  stopGoogleCalendarWatch,
  updateGoogleInspectionEvent,
  type GoogleCalendarEvent,
  type GoogleCalendarTokens,
} from '../services/googleCalendarService.js';
import {
  signOAuthState,
  verifyCalendarChannelToken,
  verifyOAuthState,
} from '../services/integrationSecurityService.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies, StoredRecord } from './types.js';

const CONNECTION_ID = 'google-calendar';

function routeParts(req: IncomingMessage): string[] {
  return new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean);
}

function agencyHeader(req: IncomingMessage): string {
  const value = req.headers['x-agency-id']?.toString().trim();
  if (!value) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.');
  return value;
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 1_000_000) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Calendar command exceeds 1 MB.');
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required');
    return value as Record<string, unknown>;
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }
}

function record<T>(value: StoredRecord): T {
  return value as unknown as T;
}

function positiveVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new ApiError(400, 'EXPECTED_VERSION_REQUIRED', 'expectedVersion must be a positive integer.');
  }
  return value;
}

async function connection(
  dependencies: ApiDependencies,
  agencyId: string,
): Promise<(IntegrationConnection & { version: number }) | undefined> {
  const stored = await dependencies.repository.get('integrationConnections', agencyId, CONNECTION_ID);
  return stored ? record<IntegrationConnection & { version: number }>(stored) : undefined;
}

async function activeTokens(
  dependencies: ApiDependencies,
  agencyId: string,
  actorId: string,
): Promise<GoogleCalendarTokens> {
  const tokens = await loadIntegrationCredentials<GoogleCalendarTokens>(
    dependencies,
    agencyId,
    CONNECTION_ID,
  );
  if (!tokens) throw new ApiError(409, 'GOOGLE_CALENDAR_CREDENTIALS_MISSING', 'Google Calendar credentials are unavailable.');
  if (!googleTokensNeedRefresh(tokens)) return tokens;
  const refreshed = await refreshGoogleCalendarTokens(tokens);
  await saveIntegrationCredentials(dependencies, {
    agencyId,
    connectionId: CONNECTION_ID,
    provider: 'google_calendar',
    credentials: refreshed,
    actorId,
  });
  return refreshed;
}

function stringConfiguration(
  connectionRecord: IntegrationConnection,
  key: string,
): string | undefined {
  const value = connectionRecord.configuration[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function boolConfiguration(
  connectionRecord: IntegrationConnection,
  key: string,
  fallback: boolean,
): boolean {
  const value = connectionRecord.configuration[key];
  return typeof value === 'boolean' ? value : fallback;
}

function calendarId(connectionRecord: IntegrationConnection): string {
  const value = stringConfiguration(connectionRecord, 'calendarId');
  if (!value) throw new ApiError(409, 'GOOGLE_CALENDAR_NOT_CONFIGURED', 'Select a Google Calendar before synchronising events.');
  return value;
}

async function handleCalendarCancellation(
  dependencies: ApiDependencies,
  agencyId: string,
  request: InspectionRequest,
): Promise<void> {
  if (request.bookingStatus !== 'cancelled' || !request.inspectionJobId) return;
  const job = await dependencies.repository.get('inspectionJobs', agencyId, request.inspectionJobId);
  if (!job) return;
  const action = externalCancellationAction(job.status as never);
  if (action === 'cancel_job_and_release_booking') {
    await dependencies.repository.update(
      'inspectionJobs',
      agencyId,
      job.id,
      {
        status: 'cancelled',
        bookingStatus: 'cancelled',
        transitionReason: 'google_calendar_booking_cancelled',
        lastCalendarSyncStatus: 'synchronised',
      },
      Number(job.version),
      'system:google-calendar',
    );
    return;
  }
  await createSyncException(
    dependencies,
    {
      agencyId,
      provider: 'google_calendar',
      category: 'calendar_event_deleted',
      severity: action === 'preserve_job_and_raise_exception' ? 'critical' : 'warning',
      status: 'open',
      title: 'Calendar booking was cancelled after the job progressed',
      detail: `Google Calendar event ${request.googleCalendar?.eventId || ''} was cancelled while job ${job.id} is ${String(job.status)}. The inspection job was preserved for operator review.`,
      inspectionRequestId: request.id,
      inspectionJobId: job.id,
      externalId: request.googleCalendar?.eventId,
    },
    'system:google-calendar',
  );
}

async function synchroniseJobToCalendar(
  dependencies: ApiDependencies,
  input: {
    agencyId: string;
    job: StoredRecord;
    connection: IntegrationConnection & { version: number };
    tokens: GoogleCalendarTokens;
    actorId: string;
  },
): Promise<StoredRecord> {
  if (!input.job.scheduledAt || typeof input.job.scheduledAt !== 'string') {
    throw new ApiError(422, 'JOB_SCHEDULE_REQUIRED', 'Schedule the inspection before syncing it to Google Calendar.');
  }
  const startAt = input.job.scheduledAt;
  const endAt =
    typeof input.job.scheduledEndAt === 'string'
      ? input.job.scheduledEndAt
      : new Date(Date.parse(startAt) + Number(input.job.durationMinutes || 60) * 60_000).toISOString();
  const request = input.job.inspectionRequestId
    ? await dependencies.repository.get(
        'inspectionRequests',
        input.agencyId,
        String(input.job.inspectionRequestId),
      )
    : undefined;
  const property = input.job.propertyId
    ? await dependencies.repository.get('properties', input.agencyId, String(input.job.propertyId))
    : undefined;
  const title = `${String(input.job.reportType || 'Inspection')} - ${String(property?.address || input.job.propertySnapshot?.address || input.job.id)}`;
  const attendeeEmails = [
    request?.customerEmail,
    input.job.assignedInspectorId,
  ].filter((value): value is string => typeof value === 'string' && value.includes('@'));
  const linked = input.job.googleCalendar as GoogleCalendarReference | undefined;
  const event = linked
    ? await updateGoogleInspectionEvent(input.tokens, {
        calendarId: linked.calendarId,
        eventId: linked.eventId,
        title,
        description: `ProInspect job: ${input.job.id}\nReport type: ${String(input.job.reportType || '')}\n${String(input.job.notes || '')}`,
        location: String(property?.address || input.job.propertySnapshot?.address || ''),
        startAt,
        endAt,
        timezone: String(input.job.timezone || 'Australia/Perth'),
        attendeeEmails,
        privateProperties: {
          proinspectAgencyId: input.agencyId,
          proinspectJobId: input.job.id,
          ...(input.job.inspectionRequestId
            ? { proinspectRequestId: String(input.job.inspectionRequestId) }
            : {}),
          ...(input.job.shopifyOrderId
            ? { shopifyOrderId: String(input.job.shopifyOrderId) }
            : {}),
          source: 'proinspect',
        },
      })
    : await createGoogleInspectionEvent(input.tokens, {
        calendarId: calendarId(input.connection),
        agencyId: input.agencyId,
        jobId: input.job.id,
        requestId:
          typeof input.job.inspectionRequestId === 'string'
            ? input.job.inspectionRequestId
            : undefined,
        shopifyOrderId:
          typeof input.job.shopifyOrderId === 'string'
            ? input.job.shopifyOrderId
            : undefined,
        title,
        description: `ProInspect job: ${input.job.id}\nReport type: ${String(input.job.reportType || '')}\n${String(input.job.notes || '')}`,
        location: String(property?.address || input.job.propertySnapshot?.address || ''),
        startAt,
        endAt,
        timezone: String(input.job.timezone || 'Australia/Perth'),
        attendeeEmails,
      });
  const reference = googleCalendarReference(
    event,
    linked?.calendarId || calendarId(input.connection),
    String(input.job.timezone || 'Australia/Perth'),
  );
  if (!reference) throw new ApiError(502, 'CALENDAR_EVENT_INVALID', 'Google Calendar returned an incomplete event.');
  return dependencies.repository.update(
    'inspectionJobs',
    input.agencyId,
    input.job.id,
    {
      googleCalendar: reference,
      bookingStatus: reference.eventStatus === 'cancelled' ? 'cancelled' : 'booked',
      scheduledAt: reference.startAt,
      scheduledEndAt: reference.endAt,
      lastCalendarSyncStatus: 'synchronised',
      lastSyncedAt: new Date().toISOString(),
    },
    Number(input.job.version),
    input.actorId,
  );
}

async function synchroniseGoogleCalendar(
  dependencies: ApiDependencies,
  input: {
    agencyId: string;
    connection: IntegrationConnection & { version: number };
    tokens: GoogleCalendarTokens;
    actorId: string;
    forceFull?: boolean;
  },
): Promise<{
  processedEvents: number;
  requests: string[];
  jobs: string[];
  ignoredEvents: number;
  nextSyncToken?: string;
}> {
  const configuredCalendarId = calendarId(input.connection);
  const mappings = await serviceMappings(dependencies, input.agencyId);
  const timezone = stringConfiguration(input.connection, 'timezone') || 'Australia/Perth';
  let syncToken = input.forceFull ? undefined : stringConfiguration(input.connection, 'syncToken');
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;
  let processedEvents = 0;
  let ignoredEvents = 0;
  const requestIds: string[] = [];
  const jobIds: string[] = [];
  const since = new Date(
    Date.now() - Number(input.connection.configuration.initialLookbackDays || 180) * 24 * 60 * 60 * 1000,
  ).toISOString();
  try {
    do {
      const page = await listGoogleCalendarEvents(input.tokens, {
        calendarId: configuredCalendarId,
        ...(syncToken ? { syncToken } : { timeMin: since }),
        ...(pageToken ? { pageToken } : {}),
      });
      for (const event of page.events) {
        const existing = await findRequestByExternalId(
          dependencies,
          input.agencyId,
          'google_calendar',
          event.id,
        );
        let mapping = matchCalendarServiceMapping(event, mappings);
        if (!mapping && existing?.serviceCode) {
          mapping = mappings.find(
            (candidate) =>
              candidate.active &&
              candidate.provider === 'google_calendar' &&
              candidate.serviceCode === existing.serviceCode,
          );
        }
        if (!isCalendarEventEligibleForInspection(event, mapping)) {
          ignoredEvents += 1;
          continue;
        }
        const reference = googleCalendarReference(event, configuredCalendarId, timezone);
        if (!reference) {
          ignoredEvents += 1;
          continue;
        }
        const fields = parseCalendarBookingFields(event.description, event.location);
        const request = await upsertCalendarInspectionRequest(dependencies, {
          agencyId: input.agencyId,
          calendar: reference,
          mapping,
          orderNumber: fields.orderNumber,
          actorId: input.actorId,
        });
        const result = await maybeAutoConvertInspectionRequest(dependencies, {
          agencyId: input.agencyId,
          request,
          mapping,
          actorId: input.actorId,
          autoConvert: boolConfiguration(
            input.connection,
            'autoConvertReadyRequests',
            true,
          ),
        });
        requestIds.push(result.request.id);
        if (result.job) {
          jobIds.push(result.job.id);
          await updateGoogleInspectionEvent(input.tokens, {
            calendarId: configuredCalendarId,
            eventId: reference.eventId,
            privateProperties: {
              proinspectAgencyId: input.agencyId,
              proinspectRequestId: result.request.id,
              proinspectJobId: result.job.id,
              ...(result.request.shopifyOrder?.orderGid
                ? { shopifyOrderId: result.request.shopifyOrder.orderGid }
                : {}),
              source: result.request.source,
            },
          });
        }
        if (result.request.inspectionJobId && reference.eventStatus !== 'cancelled') {
          const linkedJob = await dependencies.repository.get(
            'inspectionJobs',
            input.agencyId,
            result.request.inspectionJobId,
          );
          if (linkedJob) {
            const changed =
              linkedJob.scheduledAt !== reference.startAt ||
              linkedJob.scheduledEndAt !== reference.endAt;
            if (changed) {
              if (['draft', 'booked', 'assigned', 'on_hold'].includes(String(linkedJob.status || ''))) {
                await dependencies.repository.update(
                  'inspectionJobs',
                  input.agencyId,
                  linkedJob.id,
                  {
                    scheduledAt: reference.startAt,
                    scheduledEndAt: reference.endAt,
                    timezone: reference.timezone,
                    bookingStatus: 'rescheduled',
                    googleCalendar: reference,
                    lastCalendarSyncStatus: 'synchronised',
                  },
                  Number(linkedJob.version),
                  input.actorId,
                );
              } else {
                await createSyncException(
                  dependencies,
                  {
                    agencyId: input.agencyId,
                    provider: 'google_calendar',
                    category: 'calendar_date_conflict',
                    severity: 'critical',
                    status: 'open',
                    title: 'Calendar changed after field work began',
                    detail: `Google event ${reference.eventId} moved to ${reference.startAt}, but job ${linkedJob.id} is already ${String(linkedJob.status)}. The job schedule was preserved.`,
                    inspectionRequestId: result.request.id,
                    inspectionJobId: linkedJob.id,
                    externalId: reference.eventId,
                  },
                  input.actorId,
                );
              }
            }
          }
        }
        await handleCalendarCancellation(dependencies, input.agencyId, result.request);
        processedEvents += 1;
      }
      pageToken = page.nextPageToken;
      nextSyncToken = page.nextSyncToken || nextSyncToken;
    } while (pageToken);
  } catch (error) {
    if ((error as { status?: number }).status === 410 && syncToken) {
      syncToken = undefined;
      return synchroniseGoogleCalendar(dependencies, {
        ...input,
        forceFull: true,
      });
    }
    throw error;
  }

  const pendingJobs = (await listAllRecords(dependencies, 'inspectionJobs', input.agencyId)).filter(
    (job) => job.lastCalendarSyncStatus === 'pending',
  );
  for (const job of pendingJobs) {
    try {
      const updated = await synchroniseJobToCalendar(dependencies, {
        agencyId: input.agencyId,
        job,
        connection: input.connection,
        tokens: input.tokens,
        actorId: input.actorId,
      });
      jobIds.push(updated.id);
    } catch (error) {
      await createSyncException(
        dependencies,
        {
          agencyId: input.agencyId,
          provider: 'google_calendar',
          category: 'provider_error',
          severity: 'warning',
          status: 'open',
          title: 'Inspection job could not be synchronised to Google Calendar',
          detail: error instanceof Error ? error.message : String(error),
          inspectionJobId: job.id,
          externalId:
            typeof job.googleCalendar === 'object' && job.googleCalendar
              ? String((job.googleCalendar as Record<string, unknown>).eventId || '')
              : undefined,
        },
        input.actorId,
      );
    }
  }

  const current = await connection(dependencies, input.agencyId);
  if (current) {
    await dependencies.repository.update(
      'integrationConnections',
      input.agencyId,
      CONNECTION_ID,
      {
        status: 'connected',
        lastAttemptedSyncAt: new Date().toISOString(),
        lastSuccessfulSyncAt: new Date().toISOString(),
        configuration: {
          ...current.configuration,
          ...(nextSyncToken ? { syncToken: nextSyncToken } : {}),
        },
        lastErrorCode: null,
        lastErrorMessage: null,
      },
      current.version,
      input.actorId,
    );
  }

  return {
    processedEvents,
    requests: [...new Set(requestIds)],
    jobs: [...new Set(jobIds)],
    ignoredEvents,
    ...(nextSyncToken ? { nextSyncToken } : {}),
  };
}

export async function routeGoogleCalendarIntegrationRequest(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
): Promise<ApiResponse | undefined> {
  const route = routeParts(req);
  const integrationRoute =
    route[0] === 'api' &&
    route[1] === 'v1' &&
    route[2] === 'integrations' &&
    route[3] === 'google-calendar';
  const jobSyncRoute =
    route[0] === 'api' &&
    route[1] === 'v1' &&
    route[2] === 'inspection-jobs' &&
    Boolean(route[3]) &&
    route[4] === 'calendar' &&
    route[5] === 'sync';
  if (!integrationRoute && !jobSyncRoute) return undefined;

  if (integrationRoute && route[4] === 'oauth' && route[5] === 'callback' && req.method === 'GET') {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const code = url.searchParams.get('code');
    const stateValue = url.searchParams.get('state');
    const oauthError = url.searchParams.get('error');
    if (oauthError) throw new ApiError(400, 'GOOGLE_OAUTH_DENIED', `Google OAuth returned ${oauthError}.`);
    if (!code || !stateValue) throw new ApiError(400, 'GOOGLE_OAUTH_INVALID', 'OAuth callback requires code and state.');
    let state;
    try {
      state = verifyOAuthState(stateValue);
    } catch (error) {
      throw new ApiError(400, 'GOOGLE_OAUTH_STATE_INVALID', error instanceof Error ? error.message : String(error));
    }
    const stateRecord = await dependencies.repository.get(
      'integrationOAuthStates',
      state.agencyId,
      state.nonce,
    );
    if (!stateRecord || stateRecord.consumedAt) {
      throw new ApiError(409, 'GOOGLE_OAUTH_STATE_REPLAYED', 'OAuth state is missing or has already been used.');
    }
    const tokens = await exchangeGoogleCalendarCode(code);
    await saveIntegrationCredentials(dependencies, {
      agencyId: state.agencyId,
      connectionId: CONNECTION_ID,
      provider: 'google_calendar',
      credentials: tokens,
      actorId: 'system:google-oauth',
    });
    const calendars = await listGoogleCalendars(tokens);
    const preferred = calendars.find((item) => /proinspect/i.test(item.summary || '')) || calendars.find((item) => item.primary) || calendars[0];
    const now = new Date().toISOString();
    const existing = await connection(dependencies, state.agencyId);
    const data = {
      provider: 'google_calendar',
      status: 'connected',
      externalAccountId: preferred?.id,
      externalAccountLabel: preferred?.summary || 'Google Calendar',
      permissions: ['calendar.events', 'calendar.readonly'],
      configuration: {
        ...(existing?.configuration || {}),
        ...(preferred?.id ? { calendarId: preferred.id } : {}),
        ...(preferred?.summary ? { calendarLabel: preferred.summary } : {}),
        timezone: 'Australia/Perth',
        autoConvertReadyRequests: true,
        initialLookbackDays: 180,
      },
      credentialReference: `integrationCredentials/${CONNECTION_ID}`,
      lastSuccessfulSyncAt: now,
      lastAttemptedSyncAt: now,
    };
    if (existing) {
      await dependencies.repository.update(
        'integrationConnections',
        state.agencyId,
        CONNECTION_ID,
        data,
        existing.version,
        'system:google-oauth',
      );
    } else {
      await dependencies.repository.create(
        'integrationConnections',
        state.agencyId,
        CONNECTION_ID,
        data,
        'system:google-oauth',
      );
    }
    await dependencies.repository.update(
      'integrationOAuthStates',
      state.agencyId,
      state.nonce,
      { consumedAt: now },
      Number(stateRecord.version),
      'system:google-oauth',
    );
    const mappings = (await serviceMappings(dependencies, state.agencyId)).filter(
      (item) => item.provider === 'google_calendar',
    );
    if (!mappings.length) {
      for (const mapping of defaultGoogleCalendarServiceMappings(state.agencyId, now)) {
        await dependencies.repository.create(
          'inspectionServiceMappings',
          state.agencyId,
          mapping.id,
          mapping as unknown as Record<string, unknown>,
          'system:google-oauth',
        );
      }
    }
    const returnUrl =
      state.returnPath ||
      `${process.env.WEB_APP_BASE_URL?.replace(/\/$/u, '') || ''}/app/admin/settings?integration=google-calendar&connected=1`;
    if (returnUrl) {
      return {
        status: 302,
        headers: { location: returnUrl },
        body: { data: { connected: true }, meta: { correlationId } },
      };
    }
    return { status: 200, body: { data: { connected: true, calendars }, meta: { correlationId } } };
  }

  if (integrationRoute && route[4] === 'notifications' && route[5] && req.method === 'POST') {
    const agencyId = decodeURIComponent(route[5]);
    const connected = await connection(dependencies, agencyId);
    if (!connected || connected.status !== 'connected') {
      throw new ApiError(404, 'GOOGLE_CALENDAR_CONNECTION_NOT_FOUND', 'Google Calendar connection was not found.');
    }
    const channelId = req.headers['x-goog-channel-id']?.toString();
    const channelToken = req.headers['x-goog-channel-token']?.toString();
    const resourceId = req.headers['x-goog-resource-id']?.toString();
    const expectedToken = stringConfiguration(connected, 'watchChannelToken');
    if (
      channelId !== stringConfiguration(connected, 'watchChannelId') ||
      resourceId !== stringConfiguration(connected, 'watchResourceId') ||
      !verifyCalendarChannelToken(channelToken, expectedToken)
    ) {
      throw new ApiError(401, 'GOOGLE_CALENDAR_NOTIFICATION_INVALID', 'Calendar notification channel is invalid.');
    }
    if (req.headers['x-goog-resource-state']?.toString() === 'sync') {
      return { status: 204, body: null };
    }
    const tokens = await activeTokens(dependencies, agencyId, 'system:google-calendar');
    try {
      const result = await synchroniseGoogleCalendar(dependencies, {
        agencyId,
        connection: connected,
        tokens,
        actorId: 'system:google-calendar',
      });
      return { status: 200, body: { data: result, meta: { correlationId } } };
    } catch (error) {
      const current = await connection(dependencies, agencyId);
      if (current) {
        await dependencies.repository.update(
          'integrationConnections',
          agencyId,
          CONNECTION_ID,
          {
            status: 'attention_required',
            lastAttemptedSyncAt: new Date().toISOString(),
            lastErrorCode: (error as { code?: string }).code || 'GOOGLE_CALENDAR_SYNC_FAILED',
            lastErrorMessage: error instanceof Error ? error.message : String(error),
          },
          current.version,
          'system:google-calendar',
        );
      }
      throw error;
    }
  }

  const agencyId = agencyHeader(req);

  if (jobSyncRoute && req.method === 'POST') {
    const jobId = route[3];
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
    const connected = await connection(dependencies, agencyId);
    if (!connected || connected.status !== 'connected') {
      throw new ApiError(409, 'GOOGLE_CALENDAR_NOT_CONNECTED', 'Connect Google Calendar before syncing this job.');
    }
    const tokens = await activeTokens(dependencies, agencyId, principal.uid);
    const updated = await synchroniseJobToCalendar(dependencies, {
      agencyId,
      job,
      connection: connected,
      tokens,
      actorId: principal.uid,
    });
    return { status: 200, body: { data: updated, meta: { correlationId } } };
  }

  if (integrationRoute && route.length === 4 && req.method === 'GET') {
    const principal = await authenticateAndAuthorise(
      req,
      dependencies,
      'agency.read',
      { agencyId },
      correlationId,
    );
    const connected = await connection(dependencies, agencyId);
    const mappings = (await serviceMappings(dependencies, agencyId)).filter(
      (item) => item.provider === 'google_calendar',
    );
    return {
      status: 200,
      body: {
        data: {
          connection: connected
            ? {
                ...connected,
                credentialReference: connected.credentialReference ? 'configured' : undefined,
                configuration: {
                  ...connected.configuration,
                  watchChannelToken: connected.configuration.watchChannelToken ? 'configured' : undefined,
                },
              }
            : null,
          mappings,
        },
        meta: { correlationId, actor: principal.uid },
      },
    };
  }

  if (integrationRoute && route[4] === 'oauth' && route[5] === 'start' && req.method === 'POST') {
    const body = await readJson(req);
    const principal = await authenticateAndAuthorise(
      req,
      dependencies,
      'agency.manage',
      { agencyId },
      correlationId,
    );
    const nonce = randomUUID();
    const state = signOAuthState({
      agencyId,
      provider: 'google_calendar',
      nonce,
      issuedAt: Date.now(),
      ...(typeof body.returnPath === 'string' ? { returnPath: body.returnPath } : {}),
    });
    await dependencies.repository.create(
      'integrationOAuthStates',
      agencyId,
      nonce,
      {
        provider: 'google_calendar',
        issuedTo: principal.uid,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      },
      principal.uid,
    );
    return {
      status: 201,
      body: { data: { authorisationUrl: buildGoogleCalendarAuthorisationUrl(state) }, meta: { correlationId } },
    };
  }

  if (integrationRoute && route[4] === 'calendars' && req.method === 'GET') {
    const principal = await authenticateAndAuthorise(
      req,
      dependencies,
      'agency.manage',
      { agencyId },
      correlationId,
    );
    const tokens = await activeTokens(dependencies, agencyId, principal.uid);
    return {
      status: 200,
      body: { data: await listGoogleCalendars(tokens), meta: { correlationId } },
    };
  }

  if (integrationRoute && route[4] === 'configure' && req.method === 'POST') {
    const body = await readJson(req);
    const principal = await authenticateAndAuthorise(
      req,
      dependencies,
      'agency.manage',
      { agencyId },
      correlationId,
    );
    const connected = await connection(dependencies, agencyId);
    if (!connected) throw new ApiError(404, 'GOOGLE_CALENDAR_NOT_CONNECTED', 'Google Calendar connection was not found.');
    const selectedCalendarId = typeof body.calendarId === 'string' ? body.calendarId.trim() : '';
    if (!selectedCalendarId) throw new ApiError(400, 'CALENDAR_ID_REQUIRED', 'calendarId is required.');
    const updated = await dependencies.repository.update(
      'integrationConnections',
      agencyId,
      CONNECTION_ID,
      {
        status: 'connected',
        externalAccountId: selectedCalendarId,
        externalAccountLabel:
          typeof body.calendarLabel === 'string'
            ? body.calendarLabel.trim()
            : connected.externalAccountLabel,
        configuration: {
          ...connected.configuration,
          calendarId: selectedCalendarId,
          ...(typeof body.calendarLabel === 'string'
            ? { calendarLabel: body.calendarLabel.trim() }
            : {}),
          timezone:
            typeof body.timezone === 'string'
              ? body.timezone.trim()
              : connected.configuration.timezone || 'Australia/Perth',
          autoConvertReadyRequests: body.autoConvertReadyRequests !== false,
          initialLookbackDays:
            typeof body.initialLookbackDays === 'number'
              ? Math.min(Math.max(Math.round(body.initialLookbackDays), 1), 730)
              : Number(connected.configuration.initialLookbackDays || 180),
          ...(Array.isArray(body.bookingPages)
            ? {
                bookingPages: body.bookingPages.filter(
                  (value): value is string => typeof value === 'string',
                ),
              }
            : {}),
          syncToken: undefined,
        },
      },
      positiveVersion(body.expectedVersion),
      principal.uid,
    );
    return { status: 200, body: { data: updated, meta: { correlationId } } };
  }

  if (integrationRoute && route[4] === 'seed-mappings' && req.method === 'POST') {
    const body = await readJson(req);
    const principal = await authenticateAndAuthorise(
      req,
      dependencies,
      'agency.manage',
      { agencyId },
      correlationId,
    );
    const existing = await serviceMappings(dependencies, agencyId);
    const seeded: StoredRecord[] = [];
    for (const mapping of defaultGoogleCalendarServiceMappings(agencyId)) {
      const current = existing.find((item) => item.id === mapping.id);
      if (current && body.replace !== true) continue;
      seeded.push(
        current
          ? await dependencies.repository.update(
              'inspectionServiceMappings',
              agencyId,
              mapping.id,
              mapping as unknown as Record<string, unknown>,
              Number(current.version || 1),
              principal.uid,
            )
          : await dependencies.repository.create(
              'inspectionServiceMappings',
              agencyId,
              mapping.id,
              mapping as unknown as Record<string, unknown>,
              principal.uid,
            ),
      );
    }
    return { status: 200, body: { data: seeded, meta: { correlationId } } };
  }

  if (integrationRoute && route[4] === 'watch' && req.method === 'POST') {
    const body = await readJson(req);
    const principal = await authenticateAndAuthorise(
      req,
      dependencies,
      'agency.manage',
      { agencyId },
      correlationId,
    );
    const connected = await connection(dependencies, agencyId);
    if (!connected) throw new ApiError(404, 'GOOGLE_CALENDAR_NOT_CONNECTED', 'Google Calendar connection was not found.');
    const tokens = await activeTokens(dependencies, agencyId, principal.uid);
    const webhookBase =
      (typeof body.publicApiBaseUrl === 'string' ? body.publicApiBaseUrl.trim() : '') ||
      process.env.PUBLIC_API_BASE_URL?.trim() ||
      '';
    if (!webhookBase) throw new ApiError(400, 'PUBLIC_API_BASE_URL_REQUIRED', 'A public API base URL is required to create a Calendar watch.');
    const oldChannelId = stringConfiguration(connected, 'watchChannelId');
    const oldResourceId = stringConfiguration(connected, 'watchResourceId');
    if (oldChannelId && oldResourceId) {
      await stopGoogleCalendarWatch(tokens, oldChannelId, oldResourceId).catch(() => undefined);
    }
    const channelToken = randomBytes(32).toString('base64url');
    const watch = await createGoogleCalendarWatch(tokens, {
      calendarId: calendarId(connected),
      webhookAddress: `${webhookBase.replace(/\/$/u, '')}/api/v1/integrations/google-calendar/notifications/${encodeURIComponent(agencyId)}`,
      channelToken,
    });
    const updated = await dependencies.repository.update(
      'integrationConnections',
      agencyId,
      CONNECTION_ID,
      {
        configuration: {
          ...connected.configuration,
          watchChannelId: watch.id,
          watchResourceId: watch.resourceId,
          watchChannelToken: channelToken,
          ...(watch.expiration
            ? { watchExpiration: new Date(Number(watch.expiration)).toISOString() }
            : {}),
        },
      },
      connected.version,
      principal.uid,
    );
    return { status: 200, body: { data: updated, meta: { correlationId } } };
  }

  if (integrationRoute && route[4] === 'reconcile' && req.method === 'POST') {
    const body = await readJson(req);
    const principal = await authenticateAndAuthorise(
      req,
      dependencies,
      'agency.manage',
      { agencyId },
      correlationId,
    );
    const connected = await connection(dependencies, agencyId);
    if (!connected || connected.status === 'disconnected') {
      throw new ApiError(409, 'GOOGLE_CALENDAR_NOT_CONNECTED', 'Connect Google Calendar before reconciliation.');
    }
    const tokens = await activeTokens(dependencies, agencyId, principal.uid);
    const result = await synchroniseGoogleCalendar(dependencies, {
      agencyId,
      connection: connected,
      tokens,
      actorId: principal.uid,
      forceFull: body.forceFull === true,
    });
    return { status: 200, body: { data: result, meta: { correlationId } } };
  }

  if (integrationRoute && route[4] === 'disconnect' && req.method === 'POST') {
    const body = await readJson(req);
    const principal = await authenticateAndAuthorise(
      req,
      dependencies,
      'agency.manage',
      { agencyId },
      correlationId,
    );
    const connected = await connection(dependencies, agencyId);
    if (!connected) throw new ApiError(404, 'GOOGLE_CALENDAR_NOT_CONNECTED', 'Google Calendar connection was not found.');
    const tokens = await activeTokens(dependencies, agencyId, principal.uid).catch(() => undefined);
    const channelId = stringConfiguration(connected, 'watchChannelId');
    const resourceId = stringConfiguration(connected, 'watchResourceId');
    if (tokens && channelId && resourceId) {
      await stopGoogleCalendarWatch(tokens, channelId, resourceId).catch(() => undefined);
    }
    const updated = await dependencies.repository.update(
      'integrationConnections',
      agencyId,
      CONNECTION_ID,
      { status: 'disconnected', disconnectedAt: new Date().toISOString() },
      positiveVersion(body.expectedVersion),
      principal.uid,
    );
    return { status: 200, body: { data: updated, meta: { correlationId } } };
  }

  return undefined;
}
