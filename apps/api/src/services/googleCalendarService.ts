import { createHash, randomUUID } from 'node:crypto';
import type {
  GoogleCalendarReference,
  InspectionServiceMapping,
} from '@pcr/domain';

const GOOGLE_AUTHORISE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
];

export interface GoogleOAuthCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GoogleCalendarTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
  scope?: string;
  tokenType?: string;
}

export interface GoogleCalendarEvent {
  id: string;
  iCalUID?: string;
  etag?: string;
  status?: string;
  htmlLink?: string;
  summary?: string;
  description?: string;
  location?: string;
  updated?: string;
  creator?: { email?: string };
  organizer?: { email?: string };
  attendees?: Array<{ email?: string; responseStatus?: string }>;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  extendedProperties?: {
    private?: Record<string, string>;
    shared?: Record<string, string>;
  };
}

export interface GoogleCalendarEventPage {
  events: GoogleCalendarEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

export interface GoogleCalendarWatchChannel {
  id: string;
  resourceId: string;
  expiration?: string;
}

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

function oauthCredentials(): GoogleOAuthCredentials {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim();
  const redirectUri = process.env.GOOGLE_CALENDAR_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      'GOOGLE_CALENDAR_CLIENT_ID, GOOGLE_CALENDAR_CLIENT_SECRET and GOOGLE_CALENDAR_REDIRECT_URI are required.',
    );
  }
  return { clientId, clientSecret, redirectUri };
}

function tokenExpiry(seconds: number): string {
  return new Date(Date.now() + Math.max(60, seconds - 60) * 1000).toISOString();
}

async function tokenRequest(parameters: URLSearchParams): Promise<GoogleCalendarTokens> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: parameters,
  });
  const payload = (await response.json()) as GoogleTokenResponse;
  if (!response.ok || payload.error || !payload.access_token) {
    throw new Error(
      payload.error_description || payload.error || `Google OAuth failed with ${response.status}.`,
    );
  }
  return {
    accessToken: payload.access_token,
    ...(payload.refresh_token ? { refreshToken: payload.refresh_token } : {}),
    expiresAt: tokenExpiry(payload.expires_in),
    ...(payload.scope ? { scope: payload.scope } : {}),
    ...(payload.token_type ? { tokenType: payload.token_type } : {}),
  };
}

export function buildGoogleCalendarAuthorisationUrl(state: string): string {
  const credentials = oauthCredentials();
  const parameters = new URLSearchParams({
    client_id: credentials.clientId,
    redirect_uri: credentials.redirectUri,
    response_type: 'code',
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    scope: GOOGLE_CALENDAR_SCOPES.join(' '),
    state,
  });
  return `${GOOGLE_AUTHORISE_URL}?${parameters.toString()}`;
}

export async function exchangeGoogleCalendarCode(code: string): Promise<GoogleCalendarTokens> {
  const credentials = oauthCredentials();
  return tokenRequest(
    new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      redirect_uri: credentials.redirectUri,
      grant_type: 'authorization_code',
      code,
    }),
  );
}

export async function refreshGoogleCalendarTokens(
  tokens: GoogleCalendarTokens,
): Promise<GoogleCalendarTokens> {
  if (!tokens.refreshToken) throw new Error('Google Calendar connection has no refresh token.');
  const credentials = oauthCredentials();
  const refreshed = await tokenRequest(
    new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
    }),
  );
  return { ...refreshed, refreshToken: tokens.refreshToken };
}

export function googleTokensNeedRefresh(tokens: GoogleCalendarTokens): boolean {
  return Date.parse(tokens.expiresAt) <= Date.now() + 60_000;
}

async function googleApi<T>(
  tokens: GoogleCalendarTokens,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${GOOGLE_CALENDAR_API}${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${tokens.accessToken}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) {
    const error = payload.error as { message?: string; status?: string; code?: number } | undefined;
    const failure = new Error(error?.message || `Google Calendar API failed with ${response.status}.`);
    Object.assign(failure, {
      code: error?.status || `HTTP_${response.status}`,
      status: response.status,
    });
    throw failure;
  }
  return payload as T;
}

export async function listGoogleCalendars(
  tokens: GoogleCalendarTokens,
): Promise<Array<{ id: string; summary?: string; primary?: boolean; accessRole?: string }>> {
  const response = await googleApi<{
    items?: Array<{ id: string; summary?: string; primary?: boolean; accessRole?: string }>;
  }>(tokens, '/users/me/calendarList?maxResults=250&minAccessRole=reader');
  return response.items || [];
}

export async function listGoogleCalendarEvents(
  tokens: GoogleCalendarTokens,
  input: {
    calendarId: string;
    syncToken?: string;
    pageToken?: string;
    timeMin?: string;
    timeMax?: string;
  },
): Promise<GoogleCalendarEventPage> {
  const parameters = new URLSearchParams({
    showDeleted: 'true',
    singleEvents: 'true',
    maxResults: '2500',
  });
  if (input.pageToken) parameters.set('pageToken', input.pageToken);
  if (input.syncToken) parameters.set('syncToken', input.syncToken);
  else {
    if (input.timeMin) parameters.set('timeMin', input.timeMin);
    if (input.timeMax) parameters.set('timeMax', input.timeMax);
    parameters.set('orderBy', 'startTime');
  }
  const response = await googleApi<{
    items?: GoogleCalendarEvent[];
    nextPageToken?: string;
    nextSyncToken?: string;
  }>(
    tokens,
    `/calendars/${encodeURIComponent(input.calendarId)}/events?${parameters.toString()}`,
  );
  return {
    events: response.items || [],
    ...(response.nextPageToken ? { nextPageToken: response.nextPageToken } : {}),
    ...(response.nextSyncToken ? { nextSyncToken: response.nextSyncToken } : {}),
  };
}

export async function createGoogleCalendarWatch(
  tokens: GoogleCalendarTokens,
  input: {
    calendarId: string;
    webhookAddress: string;
    channelToken: string;
    ttlSeconds?: number;
  },
): Promise<GoogleCalendarWatchChannel> {
  const ttlSeconds = Math.min(Math.max(input.ttlSeconds || 6 * 24 * 60 * 60, 60), 7 * 24 * 60 * 60);
  const id = randomUUID();
  const response = await googleApi<{
    id: string;
    resourceId: string;
    expiration?: string;
  }>(
    tokens,
    `/calendars/${encodeURIComponent(input.calendarId)}/events/watch`,
    {
      method: 'POST',
      body: JSON.stringify({
        id,
        type: 'web_hook',
        address: input.webhookAddress,
        token: input.channelToken,
        params: { ttl: String(ttlSeconds) },
      }),
    },
  );
  return response;
}

export async function stopGoogleCalendarWatch(
  tokens: GoogleCalendarTokens,
  channelId: string,
  resourceId: string,
): Promise<void> {
  await googleApi<void>(tokens, '/channels/stop', {
    method: 'POST',
    body: JSON.stringify({ id: channelId, resourceId }),
  });
}

function deterministicEventId(value: string): string {
  const digest = createHash('sha256').update(value).digest('hex');
  return `pi${digest.slice(0, 48)}`;
}

export async function createGoogleInspectionEvent(
  tokens: GoogleCalendarTokens,
  input: {
    calendarId: string;
    agencyId: string;
    jobId: string;
    requestId?: string;
    shopifyOrderId?: string;
    title: string;
    description?: string;
    location?: string;
    startAt: string;
    endAt: string;
    timezone: string;
    attendeeEmails?: string[];
  },
): Promise<GoogleCalendarEvent> {
  return googleApi<GoogleCalendarEvent>(
    tokens,
    `/calendars/${encodeURIComponent(input.calendarId)}/events?sendUpdates=all`,
    {
      method: 'POST',
      body: JSON.stringify({
        id: deterministicEventId(`${input.agencyId}:${input.jobId}`),
        summary: input.title,
        description: input.description,
        location: input.location,
        start: { dateTime: input.startAt, timeZone: input.timezone },
        end: { dateTime: input.endAt, timeZone: input.timezone },
        attendees: (input.attendeeEmails || []).map((email) => ({ email })),
        extendedProperties: {
          private: {
            proinspectAgencyId: input.agencyId,
            proinspectJobId: input.jobId,
            ...(input.requestId ? { proinspectRequestId: input.requestId } : {}),
            ...(input.shopifyOrderId ? { shopifyOrderId: input.shopifyOrderId } : {}),
            source: 'proinspect',
          },
        },
      }),
    },
  );
}

export async function updateGoogleInspectionEvent(
  tokens: GoogleCalendarTokens,
  input: {
    calendarId: string;
    eventId: string;
    title?: string;
    description?: string;
    location?: string;
    startAt?: string;
    endAt?: string;
    timezone?: string;
    attendeeEmails?: string[];
    privateProperties?: Record<string, string>;
  },
): Promise<GoogleCalendarEvent> {
  const current = await googleApi<GoogleCalendarEvent>(
    tokens,
    `/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`,
  );
  const body: Record<string, unknown> = {
    summary: input.title ?? current.summary,
    description: input.description ?? current.description,
    location: input.location ?? current.location,
    start:
      input.startAt || input.timezone
        ? {
            dateTime: input.startAt || current.start?.dateTime,
            timeZone: input.timezone || current.start?.timeZone,
          }
        : current.start,
    end:
      input.endAt || input.timezone
        ? {
            dateTime: input.endAt || current.end?.dateTime,
            timeZone: input.timezone || current.end?.timeZone,
          }
        : current.end,
    attendees: input.attendeeEmails
      ? input.attendeeEmails.map((email) => ({ email }))
      : current.attendees,
    extendedProperties: {
      ...(current.extendedProperties || {}),
      private: {
        ...(current.extendedProperties?.private || {}),
        ...(input.privateProperties || {}),
      },
    },
  };
  return googleApi<GoogleCalendarEvent>(
    tokens,
    `/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}?sendUpdates=all`,
    { method: 'PATCH', body: JSON.stringify(body) },
  );
}

export async function cancelGoogleInspectionEvent(
  tokens: GoogleCalendarTokens,
  calendarId: string,
  eventId: string,
): Promise<void> {
  await googleApi<void>(
    tokens,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
    { method: 'DELETE' },
  );
}

function eventDate(value?: { dateTime?: string; date?: string }): string | undefined {
  return value?.dateTime || (value?.date ? `${value.date}T00:00:00` : undefined);
}

export function googleCalendarReference(
  event: GoogleCalendarEvent,
  calendarId: string,
  defaultTimezone = 'Australia/Perth',
  syncedAt = new Date().toISOString(),
): GoogleCalendarReference | undefined {
  const startAt = eventDate(event.start);
  const endAt = eventDate(event.end);
  if (!event.id || !startAt || !endAt) return undefined;
  const status = event.status === 'cancelled'
    ? 'cancelled'
    : event.status === 'tentative'
      ? 'tentative'
      : 'confirmed';
  return {
    calendarId,
    eventId: event.id,
    ...(event.iCalUID ? { iCalUID: event.iCalUID } : {}),
    ...(event.etag ? { eventEtag: event.etag } : {}),
    ...(event.htmlLink ? { htmlLink: event.htmlLink } : {}),
    ...(event.summary ? { summary: event.summary } : {}),
    ...(event.description ? { description: event.description } : {}),
    ...(event.location ? { location: event.location } : {}),
    startAt,
    endAt,
    timezone: event.start?.timeZone || event.end?.timeZone || defaultTimezone,
    eventStatus: status,
    ...(event.organizer?.email || event.creator?.email
      ? { organiserEmail: event.organizer?.email || event.creator?.email }
      : {}),
    ...(event.attendees?.length
      ? {
          attendeeEmails: event.attendees
            .map((attendee) => attendee.email)
            .filter((email): email is string => Boolean(email)),
        }
      : {}),
    ...(event.updated ? { lastExternalUpdateAt: event.updated } : {}),
    lastSyncedAt: syncedAt,
  };
}

export function matchCalendarServiceMapping(
  event: GoogleCalendarEvent,
  mappings: InspectionServiceMapping[],
): InspectionServiceMapping | undefined {
  const text = `${event.summary || ''}\n${event.description || ''}`.toLowerCase();
  return mappings
    .filter((mapping) => mapping.active && mapping.provider === 'google_calendar')
    .find((mapping) => {
      if (!mapping.calendarSummaryPattern) return false;
      try {
        return new RegExp(mapping.calendarSummaryPattern, 'iu').test(text);
      } catch {
        return text.includes(mapping.calendarSummaryPattern.toLowerCase());
      }
    });
}

export function defaultGoogleCalendarServiceMappings(
  agencyId: string,
  now = new Date().toISOString(),
): InspectionServiceMapping[] {
  return [
    {
      id: 'calendar-entry-pcr',
      agencyId,
      provider: 'google_calendar',
      active: true,
      serviceCode: 'entry-pcr',
      label: 'Property Condition Report booking',
      calendarSummaryPattern: '(property condition report|\\bpcr\\b|entry inspection)',
      reportType: 'Property Condition Report',
      propertyUse: 'residential',
      defaultDurationMinutes: 60,
      paymentRequired: false,
      manualApprovalRequired: false,
      defaultPriority: 'normal',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'calendar-routine',
      agencyId,
      provider: 'google_calendar',
      active: true,
      serviceCode: 'routine-inspection',
      label: 'Routine Inspection booking',
      calendarSummaryPattern: 'routine inspection',
      reportType: 'Routine Inspection',
      propertyUse: 'residential',
      defaultDurationMinutes: 30,
      paymentRequired: false,
      manualApprovalRequired: false,
      defaultPriority: 'normal',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'calendar-exit',
      agencyId,
      provider: 'google_calendar',
      active: true,
      serviceCode: 'exit-inspection',
      label: 'Exit Inspection booking',
      calendarSummaryPattern: '(exit inspection|vacate inspection|move[- ]?out)',
      reportType: 'Exit Inspection',
      propertyUse: 'residential',
      defaultDurationMinutes: 60,
      paymentRequired: false,
      manualApprovalRequired: false,
      defaultPriority: 'normal',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'calendar-maintenance-follow-up',
      agencyId,
      provider: 'google_calendar',
      active: true,
      serviceCode: 'maintenance-follow-up',
      label: 'Maintenance Follow-Up booking',
      calendarSummaryPattern: '(maintenance follow[- ]?up|follow[- ]?up inspection)',
      reportType: 'Maintenance and Follow-Up Report',
      defaultDurationMinutes: 45,
      paymentRequired: false,
      manualApprovalRequired: false,
      defaultPriority: 'normal',
      createdAt: now,
      updatedAt: now,
    },
  ];
}

export function isCalendarEventEligibleForInspection(
  event: GoogleCalendarEvent,
  mapping?: InspectionServiceMapping,
): boolean {
  if (!mapping) return false;
  if (!event.id || event.status === 'cancelled') return true;
  const summary = event.summary?.trim().toLowerCase() || '';
  if (!summary || /^(block out|work placement|building management)$/u.test(summary)) return false;
  return Boolean(event.start?.dateTime && event.end?.dateTime);
}
