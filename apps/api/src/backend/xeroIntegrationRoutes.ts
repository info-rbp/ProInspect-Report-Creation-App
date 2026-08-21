import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { XeroConnection } from '@pcr/domain';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import {
  createXeroInvoiceFromQuote,
  customConnectionToken,
  disconnectXero,
  exchangeXeroCode,
  getXeroConnection,
  listXeroTenants,
  saveXeroConnection,
  syncMaintenanceQuoteToXero,
  syncWorkOrderPurchaseOrderToXero,
  xeroAuthorisationUrl,
  xeroScopes,
} from '../services/xeroAccountingService.js';
import { signOAuthState, verifyOAuthState } from '../services/integrationSecurityService.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies, IdempotencyResult } from './types.js';

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
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Xero command exceeds 1 MB.');
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

function idempotencyKey(req: IncomingMessage): string {
  const value = req.headers['idempotency-key']?.toString().trim();
  if (!value || value.length < 8 || value.length > 200) {
    throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key is required.');
  }
  return value;
}

async function idempotent(
  dependencies: ApiDependencies,
  req: IncomingMessage,
  agencyId: string,
  operation: string,
  body: Record<string, unknown>,
  action: () => Promise<IdempotencyResult>,
): Promise<ApiResponse> {
  const execution = await dependencies.idempotency.execute(
    agencyId,
    operation,
    idempotencyKey(req),
    createHash('sha256').update(JSON.stringify(body)).digest('hex'),
    action,
  );
  return {
    status: execution.result.status,
    body: execution.result.body,
    headers: { 'idempotency-replayed': String(execution.replayed) },
  };
}

async function manager(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  agencyId: string,
  correlationId: string,
) {
  return authenticateAndAuthorise(req, dependencies, 'xero.manage', { agencyId }, correlationId);
}

function webReturnPath(path?: string): string {
  const base = process.env.WEB_APP_BASE_URL?.trim()?.replace(/\/$/u, '') || '';
  const safe = path?.startsWith('/') ? path : '/app/admin/maintenance/configuration';
  return `${base}${safe}`;
}

export async function routeXeroIntegrationRequest(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
): Promise<ApiResponse | undefined> {
  const route = parts(req);
  if (route[0] !== 'api' || route[1] !== 'v1' || route[2] !== 'integrations' || route[3] !== 'xero') {
    return undefined;
  }

  if (route[4] === 'oauth' && route[5] === 'callback' && req.method === 'GET') {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const stateValue = url.searchParams.get('state') || '';
    const code = url.searchParams.get('code') || '';
    if (!stateValue || !code) throw new ApiError(400, 'XERO_OAUTH_CALLBACK_INVALID', 'Xero callback requires code and state.');
    let state;
    try {
      state = verifyOAuthState(stateValue, 15 * 60, 'xero');
    } catch (error) {
      throw new ApiError(400, 'XERO_OAUTH_STATE_INVALID', error instanceof Error ? error.message : 'Xero OAuth state is invalid.');
    }
    const storedState = await dependencies.repository.get('xeroOAuthStates', state.agencyId, state.nonce);
    if (!storedState || storedState.consumedAt) throw new ApiError(409, 'XERO_OAUTH_STATE_REPLAYED', 'Xero OAuth state has already been consumed or is unavailable.');
    const credentials = await exchangeXeroCode(code);
    const tenants = await listXeroTenants(credentials.accessToken);
    if (!tenants.length) throw new ApiError(409, 'XERO_TENANT_REQUIRED', 'No Xero organisation connection was returned.');
    const tenant = tenants[0];
    const connection = await saveXeroConnection(dependencies, {
      agencyId: state.agencyId,
      actorId: String(storedState.createdBy || 'xero-oauth'),
      credentials,
      tenantId: tenant.tenantId,
      tenantName: tenant.tenantName,
      connectionType: 'oauth_authorisation_code',
    });
    await dependencies.repository.update(
      'xeroOAuthStates',
      state.agencyId,
      state.nonce,
      { consumedAt: new Date().toISOString(), tenantId: tenant.tenantId },
      Number(storedState.version),
      String(storedState.createdBy || 'xero-oauth'),
    );
    const location = `${webReturnPath(state.returnPath)}?xero=connected&tenant=${encodeURIComponent(tenant.tenantName || tenant.tenantId)}`;
    return {
      status: 302,
      headers: { location },
      body: { data: connection, meta: { correlationId, redirect: location } },
    };
  }

  const agencyId = agencyHeader(req);

  if (route[4] === 'status' && req.method === 'GET') {
    const actor = await manager(req, dependencies, agencyId, correlationId);
    const [connection, exceptions] = await Promise.all([
      getXeroConnection(dependencies, agencyId),
      dependencies.repository.list('xeroSyncExceptions', agencyId, 100),
    ]);
    return {
      status: 200,
      body: {
        data: {
          connection: connection
            ? {
                ...connection,
                credentialReference: connection.credentialReference ? 'stored' : undefined,
              }
            : null,
          scopes: xeroScopes(),
          exceptions: exceptions.items,
        },
        meta: { correlationId, actor: actor.uid },
      },
    };
  }

  if (route[4] === 'connect' && req.method === 'POST') {
    const body = await readJson(req);
    const actor = await manager(req, dependencies, agencyId, correlationId);
    return idempotent(dependencies, req, agencyId, 'xero:connect', body, async () => {
      const nonce = randomUUID();
      const returnPath = typeof body.returnPath === 'string' && body.returnPath.startsWith('/')
        ? body.returnPath
        : '/app/admin/maintenance/configuration';
      const state = signOAuthState({
        agencyId,
        provider: 'xero',
        nonce,
        issuedAt: Date.now(),
        returnPath,
      });
      await dependencies.repository.create(
        'xeroOAuthStates',
        agencyId,
        nonce,
        { provider: 'xero', stateHash: createHash('sha256').update(state).digest('hex'), returnPath, createdBy: actor.uid, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() },
        actor.uid,
      );
      return {
        status: 201,
        body: { data: { authorisationUrl: xeroAuthorisationUrl(state), expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() }, meta: { correlationId } },
      };
    });
  }

  if (route[4] === 'custom-connection' && req.method === 'POST') {
    const body = await readJson(req);
    const actor = await manager(req, dependencies, agencyId, correlationId);
    const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : '';
    const clientSecret = typeof body.clientSecret === 'string' ? body.clientSecret.trim() : '';
    const tenantId = typeof body.tenantId === 'string' ? body.tenantId.trim() : '';
    if (!clientId || !clientSecret || !tenantId) {
      throw new ApiError(400, 'XERO_CUSTOM_CONNECTION_FIELDS_REQUIRED', 'clientId, clientSecret and tenantId are required.');
    }
    return idempotent(dependencies, req, agencyId, 'xero:custom-connection', body, async () => {
      const scopes = Array.isArray(body.scopes)
        ? body.scopes.filter((value): value is string => typeof value === 'string')
        : xeroScopes().filter((scope) => !['openid', 'profile', 'email', 'offline_access'].includes(scope));
      const credentials = await customConnectionToken(clientId, clientSecret, scopes);
      const connection = await saveXeroConnection(dependencies, {
        agencyId,
        actorId: actor.uid,
        credentials,
        tenantId,
        tenantName: typeof body.tenantName === 'string' ? body.tenantName : undefined,
        connectionType: 'custom_connection',
        salesAccountCode: typeof body.salesAccountCode === 'string' ? body.salesAccountCode : undefined,
        purchaseAccountCode: typeof body.purchaseAccountCode === 'string' ? body.purchaseAccountCode : undefined,
        defaultTaxType: typeof body.defaultTaxType === 'string' ? body.defaultTaxType : undefined,
      });
      return { status: 201, body: { data: connection, meta: { correlationId } } };
    });
  }

  if (route[4] === 'configure' && req.method === 'POST') {
    const body = await readJson(req);
    const actor = await manager(req, dependencies, agencyId, correlationId);
    const connection = await getXeroConnection(dependencies, agencyId) as (XeroConnection & { version: number }) | undefined;
    if (!connection) throw new ApiError(404, 'XERO_NOT_CONNECTED', 'Connect Xero before configuring account mappings.');
    return idempotent(dependencies, req, agencyId, 'xero:configure', body, async () => ({
      status: 200,
      body: {
        data: await dependencies.repository.update(
          'xeroConnections',
          agencyId,
          connection.id,
          {
            ...(typeof body.salesAccountCode === 'string' ? { salesAccountCode: body.salesAccountCode.trim() } : {}),
            ...(typeof body.purchaseAccountCode === 'string' ? { purchaseAccountCode: body.purchaseAccountCode.trim() } : {}),
            ...(typeof body.defaultTaxType === 'string' ? { defaultTaxType: body.defaultTaxType.trim() } : {}),
          },
          Number(connection.version),
          actor.uid,
        ),
        meta: { correlationId },
      },
    }));
  }

  if (route[4] === 'disconnect' && req.method === 'POST') {
    const body = await readJson(req);
    const actor = await manager(req, dependencies, agencyId, correlationId);
    return idempotent(dependencies, req, agencyId, 'xero:disconnect', body, async () => ({
      status: 200,
      body: { data: await disconnectXero(dependencies, agencyId, actor.uid), meta: { correlationId } },
    }));
  }

  if (route[4] === 'quotes' && route[5] && route[6] === 'sync' && req.method === 'POST') {
    const body = await readJson(req);
    const actor = await authenticateAndAuthorise(
      req,
      dependencies,
      'maintenance.finance.sync',
      { agencyId, maintenanceQuoteId: route[5] },
      correlationId,
    );
    return idempotent(dependencies, req, agencyId, `xero:quote:${route[5]}:sync`, body, async () => ({
      status: 200,
      body: { data: await syncMaintenanceQuoteToXero(dependencies, { agencyId, quoteId: route[5], actorId: actor.uid }), meta: { correlationId } },
    }));
  }

  if (route[4] === 'quotes' && route[5] && route[6] === 'invoice' && req.method === 'POST') {
    const body = await readJson(req);
    const actor = await authenticateAndAuthorise(
      req,
      dependencies,
      'maintenance.finance.sync',
      { agencyId, maintenanceQuoteId: route[5] },
      correlationId,
    );
    return idempotent(dependencies, req, agencyId, `xero:quote:${route[5]}:invoice`, body, async () => ({
      status: 201,
      body: { data: await createXeroInvoiceFromQuote(dependencies, { agencyId, quoteId: route[5], actorId: actor.uid }), meta: { correlationId } },
    }));
  }

  if (route[4] === 'work-orders' && route[5] && route[6] === 'purchase-order' && req.method === 'POST') {
    const body = await readJson(req);
    const actor = await authenticateAndAuthorise(
      req,
      dependencies,
      'maintenance.finance.sync',
      { agencyId },
      correlationId,
    );
    return idempotent(dependencies, req, agencyId, `xero:work-order:${route[5]}:purchase-order`, body, async () => ({
      status: 201,
      body: { data: await syncWorkOrderPurchaseOrderToXero(dependencies, { agencyId, workOrderId: route[5], actorId: actor.uid }), meta: { correlationId } },
    }));
  }

  return undefined;
}
