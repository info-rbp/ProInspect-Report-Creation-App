import type { IncomingMessage } from 'node:http';
import { requireNotificationDeliveryStore } from './runtimeDependencyGuards.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies } from './types.js';

interface ProviderConfig {
  callbackSecret?: string;
}

async function metadataAccessToken(): Promise<string> {
  const response = await fetch(
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    {
      headers: { 'Metadata-Flavor': 'Google' },
      signal: AbortSignal.timeout(5_000),
    },
  );

  if (!response.ok) {
    throw new ApiError(
      503,
      'METADATA_TOKEN_FAILED',
      `Metadata token request failed with ${response.status}.`,
    );
  }

  const body = await response.json() as {
    access_token?: string;
  };

  if (!body.access_token) {
    throw new ApiError(
      503,
      'METADATA_TOKEN_FAILED',
      'Metadata token response did not contain access_token.',
    );
  }

  return body.access_token;
}

async function secretConfig(): Promise<ProviderConfig> {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT?.trim();
  if (!projectId) return {};

  try {
    const token = await metadataAccessToken();
    const response = await fetch(
      `https://secretmanager.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/secrets/email-provider-config/versions/latest:access`,
      {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(7_000),
      },
    );

    if (!response.ok) return {};

    const body = await response.json() as {
      payload?: { data?: string };
    };

    const encoded = body.payload?.data;

    return encoded
      ? JSON.parse(
          Buffer.from(encoded, 'base64').toString('utf8'),
        ) as ProviderConfig
      : {};
  } catch {
    return {};
  }
}

let secretCache:
  | { value?: string; expiresAt: number }
  | undefined;

async function callbackSecret(): Promise<string> {
  if (process.env.NOTIFICATION_CALLBACK_SECRET?.trim()) {
    return process.env.NOTIFICATION_CALLBACK_SECRET.trim();
  }

  if (
    secretCache
    && secretCache.expiresAt > Date.now()
    && secretCache.value
  ) {
    return secretCache.value;
  }

  const raw = process.env.NOTIFICATION_PROVIDER_CONFIG?.trim();
  let parsed: ProviderConfig = {};

  if (raw) {
    try {
      parsed = JSON.parse(raw) as ProviderConfig;
    } catch {
      throw new ApiError(
        503,
        'NOTIFICATION_CONFIG_INVALID',
        'Notification provider configuration is invalid.',
      );
    }
  } else {
    parsed = await secretConfig();
  }

  const value = parsed.callbackSecret?.trim();

  secretCache = {
    value,
    expiresAt: Date.now() + 5 * 60_000,
  };

  if (!value) {
    throw new ApiError(
      503,
      'NOTIFICATION_CALLBACK_SECRET_REQUIRED',
      'Notification callback secret is not configured.',
    );
  }

  return value;
}

async function authorize(url: URL): Promise<void> {
  const supplied = url.searchParams.get('token')?.trim() || '';

  if (!supplied || supplied !== await callbackSecret()) {
    throw new ApiError(
      401,
      'INVALID_CALLBACK_TOKEN',
      'Notification callback token is invalid.',
    );
  }
}

async function readRaw(
  req: IncomingMessage,
  maxBytes = 1_000_000,
): Promise<string> {
  const chunks: Buffer[] = [];
  let length = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk);

    length += buffer.length;

    if (length > maxBytes) {
      throw new ApiError(
        413,
        'PAYLOAD_TOO_LARGE',
        'Notification callback payload is too large.',
      );
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString('utf8');
}

async function updateStatus(
  dependencies: ApiDependencies,
  agencyId: string,
  notificationId: string,
  communicationId: string | undefined,
  status: 'queued' | 'sent' | 'delivered' | 'failed',
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await requireNotificationDeliveryStore(
    dependencies,
  ).update({
    agencyId,
    notificationId,
    ...(communicationId ? { communicationId } : {}),
    status,
    metadata,
  });
}

async function handleTwilio(
  req: IncomingMessage,
  url: URL,
  dependencies: ApiDependencies,
  correlationId: string,
): Promise<ApiResponse> {
  await authorize(url);

  const agencyId =
    url.searchParams.get('agencyId')?.trim() || '';
  const notificationId =
    url.searchParams.get('notificationId')?.trim() || '';
  const communicationId =
    url.searchParams.get('communicationId')?.trim()
    || undefined;

  if (!agencyId || !notificationId) {
    throw new ApiError(
      400,
      'CALLBACK_SCOPE_REQUIRED',
      'Twilio callback requires agencyId and notificationId.',
    );
  }

  const form = new URLSearchParams(await readRaw(req));
  const providerStatus = form.get('MessageStatus') || '';
  const providerMessageId =
    form.get('MessageSid') || undefined;
  const errorCode = form.get('ErrorCode') || undefined;

  const failed = [
    'failed',
    'undelivered',
    'canceled',
  ].includes(providerStatus);

  const delivered = providerStatus === 'delivered';
  const sent = ['sent', 'sending'].includes(providerStatus);

  await updateStatus(
    dependencies,
    agencyId,
    notificationId,
    communicationId,
    delivered
      ? 'delivered'
      : failed
        ? 'failed'
        : sent
          ? 'sent'
          : 'queued',
    {
      provider: 'twilio',
      providerStatus,
      ...(providerMessageId
        ? { providerMessageId }
        : {}),
      ...(errorCode
        ? { providerErrorCode: errorCode }
        : {}),
    },
  );

  return {
    status: 200,
    body: {
      data: {
        accepted: true,
        providerStatus,
      },
      meta: { correlationId },
    },
  };
}

async function handleSendGrid(
  req: IncomingMessage,
  url: URL,
  dependencies: ApiDependencies,
  correlationId: string,
): Promise<ApiResponse> {
  await authorize(url);

  let events: unknown;

  try {
    events = JSON.parse(await readRaw(req));
  } catch {
    throw new ApiError(
      400,
      'INVALID_CALLBACK_JSON',
      'SendGrid callback must be valid JSON.',
    );
  }

  if (!Array.isArray(events)) {
    throw new ApiError(
      400,
      'INVALID_CALLBACK_BODY',
      'SendGrid callback must be an event array.',
    );
  }

  let updated = 0;

  for (const raw of events) {
    if (
      !raw
      || typeof raw !== 'object'
      || Array.isArray(raw)
    ) {
      continue;
    }

    const event = raw as Record<string, unknown>;
    const agencyId =
      typeof event.agencyId === 'string'
        ? event.agencyId
        : '';
    const notificationId =
      typeof event.notificationId === 'string'
        ? event.notificationId
        : '';
    const communicationId =
      typeof event.communicationId === 'string'
      && event.communicationId
        ? event.communicationId
        : undefined;

    if (!agencyId || !notificationId) continue;

    const providerEvent =
      typeof event.event === 'string'
        ? event.event
        : '';

    const delivered = providerEvent === 'delivered';
    const failed = [
      'bounce',
      'dropped',
      'blocked',
    ].includes(providerEvent);
    const sent = [
      'processed',
      'deferred',
    ].includes(providerEvent);

    if (!delivered && !failed && !sent) continue;

    await updateStatus(
      dependencies,
      agencyId,
      notificationId,
      communicationId,
      delivered
        ? 'delivered'
        : failed
          ? 'failed'
          : 'sent',
      {
        provider: 'sendgrid',
        providerStatus: providerEvent,
        ...(typeof event.sg_message_id === 'string'
          ? {
              providerMessageId:
                event.sg_message_id,
            }
          : {}),
        ...(typeof event.reason === 'string'
          ? { providerReason: event.reason }
          : {}),
      },
    );

    updated += 1;
  }

  return {
    status: 200,
    body: {
      data: {
        accepted: true,
        updated,
      },
      meta: { correlationId },
    },
  };
}

export async function routeNotificationCallbackRequest(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
): Promise<ApiResponse | undefined> {
  const url = new URL(
    req.url ?? '/',
    'http://localhost',
  );

  const parts = url.pathname
    .split('/')
    .filter(Boolean);

  if (
    parts[0] !== 'api'
    || parts[1] !== 'v1'
    || parts[2] !== 'external'
    || parts[3] !== 'notification-callbacks'
    || !parts[4]
  ) {
    return undefined;
  }

  if (req.method !== 'POST') {
    throw new ApiError(
      405,
      'METHOD_NOT_ALLOWED',
      'Notification callbacks require POST.',
    );
  }

  if (parts[4] === 'twilio') {
    return handleTwilio(
      req,
      url,
      dependencies,
      correlationId,
    );
  }

  if (parts[4] === 'sendgrid') {
    return handleSendGrid(
      req,
      url,
      dependencies,
      correlationId,
    );
  }

  throw new ApiError(
    404,
    'CALLBACK_PROVIDER_NOT_FOUND',
    'Notification callback provider was not found.',
  );
}
