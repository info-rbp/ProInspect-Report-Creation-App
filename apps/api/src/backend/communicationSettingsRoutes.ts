import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type {
  CommunicationPolicy,
  CommunicationProviderSettings,
  CommunicationTemplate,
  NotificationRule,
} from '@pcr/domain';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { saveIntegrationCredentials } from '../services/integrationCredentialStore.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies, StoredRecord } from './types.js';

function parts(req: IncomingMessage): string[] {
  return new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean);
}

function agencyHeader(req: IncomingMessage): string {
  const value = req.headers['x-agency-id']?.toString().trim();
  if (!value) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.');
  return value;
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (!chunks.length) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required');
    return value as Record<string, unknown>;
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }
}

async function listAll(
  dependencies: ApiDependencies,
  collection: string,
  agencyId: string,
): Promise<StoredRecord[]> {
  const result: StoredRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = await dependencies.repository.list(collection, agencyId, 100, cursor);
    result.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return result;
}

function version(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new ApiError(400, 'EXPECTED_VERSION_REQUIRED', 'expectedVersion must be a positive integer.');
  }
  return value;
}

function text(body: Record<string, unknown>, field: string, max = 10_000): string {
  const value = typeof body[field] === 'string' ? body[field].trim() : '';
  if (!value || value.length > max) {
    throw new ApiError(400, 'FIELD_REQUIRED', `${field} is required and must be ${max} characters or fewer.`);
  }
  return value;
}

function optionalText(body: Record<string, unknown>, field: string, max = 500): string | undefined {
  const value = typeof body[field] === 'string' ? body[field].trim() : '';
  if (!value) return undefined;
  if (value.length > max) throw new ApiError(400, 'FIELD_TOO_LONG', `${field} must be ${max} characters or fewer.`);
  return value;
}

function channel(value: unknown): 'email' | 'sms' {
  if (value !== 'email' && value !== 'sms') {
    throw new ApiError(400, 'CHANNEL_INVALID', 'channel must be email or sms.');
  }
  return value;
}

function templateInput(
  body: Record<string, unknown>,
  id: string,
): Omit<CommunicationTemplate, 'agencyId' | 'version' | 'createdAt' | 'updatedAt'> {
  const bodyText = text(body, 'body', 50_000);
  const allowed = Array.isArray(body.allowedVariables)
    ? body.allowedVariables
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean)
    : [];
  const found = [...bodyText.matchAll(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/gu)].map((match) => match[1]);
  const invalid = found.filter((variable) => !allowed.includes(variable));
  if (invalid.length) {
    throw new ApiError(
      400,
      'TEMPLATE_VARIABLE_INVALID',
      `Template contains variables not declared in allowedVariables: ${[...new Set(invalid)].join(', ')}.`,
    );
  }
  return {
    id,
    status: body.status === 'retired' ? 'retired' : body.status === 'draft' ? 'draft' : 'active',
    eventType: text(body, 'eventType', 120),
    channel: channel(body.channel),
    name: text(body, 'name', 160),
    subject: optionalText(body, 'subject', 500),
    body: bodyText,
    allowedVariables: allowed,
  };
}

function ruleInput(
  body: Record<string, unknown>,
  id: string,
): Omit<NotificationRule, 'agencyId' | 'version' | 'createdAt' | 'updatedAt'> {
  const delay = typeof body.delayMinutes === 'number' ? body.delayMinutes : 0;
  const retry = typeof body.retryCount === 'number' ? body.retryCount : 0;
  if (delay < 0 || delay > 525_600) {
    throw new ApiError(400, 'DELAY_INVALID', 'delayMinutes is outside the supported range.');
  }
  if (retry < 0 || retry > 10) {
    throw new ApiError(400, 'RETRY_INVALID', 'retryCount must be between 0 and 10.');
  }
  return {
    id,
    status: body.status === 'retired' ? 'retired' : body.status === 'draft' ? 'draft' : 'active',
    eventType: text(body, 'eventType', 120),
    channel: channel(body.channel),
    templateId: text(body, 'templateId', 160),
    delayMinutes: delay,
    retryCount: retry,
    escalationAfterMinutes:
      typeof body.escalationAfterMinutes === 'number' ? body.escalationAfterMinutes : undefined,
    escalationTarget: optionalText(body, 'escalationTarget', 500),
    enabled: body.enabled !== false,
  };
}

async function upsertProviderPolicy(
  dependencies: ApiDependencies,
  input: {
    agencyId: string;
    provider: 'sendgrid' | 'twilio';
    body: Record<string, unknown>;
    actorId: string;
  },
): Promise<void> {
  const current = await dependencies.repository.get('agencySettings', input.agencyId, 'communications');
  const currentPolicy = current as unknown as CommunicationPolicy | undefined;
  const providers = Array.isArray(currentPolicy?.providers) ? [...currentPolicy.providers] : [];
  const nextProvider: CommunicationProviderSettings = input.provider === 'sendgrid'
    ? {
        channel: 'email',
        provider: 'sendgrid',
        connectionId: 'sendgrid',
        enabled: true,
        senderName: optionalText(input.body, 'senderName', 160),
        senderAddress: text(input.body, 'senderAddress', 320),
        replyToAddress: optionalText(input.body, 'replyToAddress', 320),
      }
    : {
        channel: 'sms',
        provider: 'twilio',
        connectionId: 'twilio',
        enabled: true,
        originatingNumber: text(input.body, 'originatingNumber', 40),
      };
  const withoutCurrent = providers.filter(
    (provider) => !(provider.provider === input.provider && provider.channel === nextProvider.channel),
  );
  const data: Record<string, unknown> = {
    id: 'communications',
    status: currentPolicy?.status === 'retired' ? 'active' : currentPolicy?.status || 'active',
    timezone: currentPolicy?.timezone || 'Australia/Perth',
    quietHoursStart: currentPolicy?.quietHoursStart,
    quietHoursEnd: currentPolicy?.quietHoursEnd,
    providers: [...withoutCurrent, nextProvider],
  };
  if (current) {
    await dependencies.repository.update(
      'agencySettings',
      input.agencyId,
      'communications',
      data,
      Number(current.version),
      input.actorId,
    );
  } else {
    await dependencies.repository.create(
      'agencySettings',
      input.agencyId,
      'communications',
      data,
      input.actorId,
    );
  }
}

export async function routeCommunicationSettingsRequest(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
): Promise<ApiResponse | undefined> {
  const route = parts(req);
  if (route[0] !== 'api' || route[1] !== 'v1' || route[2] !== 'settings' || route[3] !== 'communications' || !route[4]) {
    return undefined;
  }
  const agencyId = agencyHeader(req);
  const kind = route[4];
  const id = route[5];

  if (kind === 'providers') {
    const provider = id;
    if (provider !== 'sendgrid' && provider !== 'twilio') {
      throw new ApiError(404, 'PROVIDER_NOT_FOUND', 'Communication provider is not supported.');
    }
    if (req.method === 'GET') {
      const principal = await authenticateAndAuthorise(req, dependencies, 'settings.read', { agencyId }, correlationId);
      const [connection, policyRecord] = await Promise.all([
        dependencies.repository.get('integrationConnections', agencyId, provider),
        dependencies.repository.get('agencySettings', agencyId, 'communications'),
      ]);
      const policy = policyRecord as unknown as CommunicationPolicy | undefined;
      const settings = policy?.providers?.find((item) => item.provider === provider);
      return {
        status: 200,
        body: {
          data: connection
            ? {
                ...connection,
                credentialReference: connection.credentialReference ? 'configured' : undefined,
                providerSettings: settings,
              }
            : null,
          meta: { actor: principal.uid, correlationId },
        },
      };
    }
    if (req.method === 'POST') {
      const body = await readJson(req);
      const principal = await authenticateAndAuthorise(
        req,
        dependencies,
        'integration.credentials.manage',
        { agencyId },
        correlationId,
      );
      const credentials = provider === 'sendgrid'
        ? { apiKey: text(body, 'apiKey', 500) }
        : { accountSid: text(body, 'accountSid', 200), authToken: text(body, 'authToken', 500) };
      await saveIntegrationCredentials(dependencies, {
        agencyId,
        connectionId: provider,
        provider,
        credentials,
        actorId: principal.uid,
      });
      const existing = await dependencies.repository.get('integrationConnections', agencyId, provider);
      const data = {
        provider,
        status: 'connected',
        externalAccountLabel: optionalText(body, 'accountLabel', 200) || provider,
        credentialReference: `encrypted:${provider}`,
        connectedAt: new Date().toISOString(),
      };
      const connection = existing
        ? await dependencies.repository.update(
            'integrationConnections',
            agencyId,
            provider,
            data,
            Number(existing.version),
            principal.uid,
          )
        : await dependencies.repository.create(
            'integrationConnections',
            agencyId,
            provider,
            data,
            principal.uid,
          );
      await upsertProviderPolicy(dependencies, { agencyId, provider, body, actorId: principal.uid });
      return {
        status: 200,
        body: {
          data: { ...connection, credentialReference: 'configured' },
          meta: { actor: principal.uid, correlationId },
        },
      };
    }
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Provider endpoint supports GET and POST.');
  }

  const collection = kind === 'templates' ? 'communicationTemplates' : kind === 'rules' ? 'notificationRules' : '';
  if (!collection) return undefined;
  if (req.method === 'GET') {
    const principal = await authenticateAndAuthorise(req, dependencies, 'settings.read', { agencyId }, correlationId);
    const data = id
      ? await dependencies.repository.get(collection, agencyId, id)
      : await listAll(dependencies, collection, agencyId);
    return { status: 200, body: { data: data ?? null, meta: { actor: principal.uid, correlationId } } };
  }

  const body = await readJson(req);
  const principal = await authenticateAndAuthorise(
    req,
    dependencies,
    'settings.communications.manage',
    { agencyId },
    correlationId,
  );
  const recordId = id || `${kind.slice(0, -1)}-${randomUUID()}`;
  const data = kind === 'templates' ? templateInput(body, recordId) : ruleInput(body, recordId);
  if (req.method === 'POST' && !id) {
    const created = await dependencies.repository.create(
      collection,
      agencyId,
      recordId,
      data as unknown as Record<string, unknown>,
      principal.uid,
    );
    return { status: 201, body: { data: created, meta: { actor: principal.uid, correlationId } } };
  }
  if ((req.method === 'PUT' || req.method === 'PATCH') && id) {
    const current = await dependencies.repository.get(collection, agencyId, id);
    if (!current) {
      throw new ApiError(404, 'COMMUNICATION_SETTING_NOT_FOUND', 'Communication setting was not found.');
    }
    const updated = await dependencies.repository.update(
      collection,
      agencyId,
      id,
      data as unknown as Record<string, unknown>,
      version(body.expectedVersion),
      principal.uid,
    );
    return { status: 200, body: { data: updated, meta: { actor: principal.uid, correlationId } } };
  }
  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Unsupported communication settings operation.');
}
