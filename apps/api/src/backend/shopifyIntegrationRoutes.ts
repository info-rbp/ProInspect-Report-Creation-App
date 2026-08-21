import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import {
  externalCancellationAction,
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
  listAllRecords,
  maybeAutoConvertInspectionRequest,
  serviceMappings,
  upsertShopifyInspectionRequest,
} from '../services/inspectionIntakeService.js';
import {
  defaultShopifyServiceMappings,
  fetchShopifyOrders,
  matchShopifyServiceMapping,
  parseShopifyOrderWebhook,
  shopifyAccessInstructions,
  shopifyPropertyAddress,
  type ShopifyAdminCredentials,
  type ShopifyOrderWebhookPayload,
} from '../services/shopifyAdminService.js';
import {
  getShopifyShopIdentity,
  ensureShopifyWebhookSubscriptions,
} from '../services/shopifyWebhookSubscriptionService.js';
import {
  payloadSha256,
  verifyShopifyWebhookHmac,
} from '../services/integrationSecurityService.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies, StoredRecord } from './types.js';

const CONNECTION_ID = 'shopify';

function routeParts(req: IncomingMessage): string[] {
  return new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean);
}

function agencyHeader(req: IncomingMessage): string {
  const value = req.headers['x-agency-id']?.toString().trim();
  if (!value) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.');
  return value;
}

async function readRaw(req: IncomingMessage, maximum = 5_000_000): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > maximum) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Shopify payload exceeds 5 MB.');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readRaw(req, 1_000_000);
  if (!raw.length) return {};
  try {
    const parsed = JSON.parse(raw.toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required');
    return parsed as Record<string, unknown>;
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }
}

function record<T>(value: StoredRecord): T {
  return value as unknown as T;
}

function canonicalDomain(value: string): string {
  const result = value.trim().replace(/^https?:\/\//iu, '').replace(/\/$/u, '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/u.test(result)) {
    throw new ApiError(400, 'SHOP_DOMAIN_INVALID', 'shopDomain must use store.myshopify.com.');
  }
  return result;
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

async function storeDelivery(
  dependencies: ApiDependencies,
  input: {
    agencyId: string;
    deliveryId: string;
    eventId?: string;
    topic: string;
    payloadHash: string;
    status: 'received' | 'processed' | 'ignored' | 'failed' | 'duplicate';
    requestId?: string;
    jobId?: string;
    errorCode?: string;
    errorMessage?: string;
    actorId: string;
  },
): Promise<StoredRecord> {
  const id = `shopify-delivery-${createHash('sha256')
    .update(input.deliveryId)
    .digest('hex')
    .slice(0, 32)}`;
  const existing = await dependencies.repository.get('integrationDeliveries', input.agencyId, id);
  if (existing) return existing;
  const now = new Date().toISOString();
  return dependencies.repository.create(
    'integrationDeliveries',
    input.agencyId,
    id,
    {
      provider: 'shopify',
      externalDeliveryId: input.deliveryId,
      ...(input.eventId ? { externalEventId: input.eventId } : {}),
      topic: input.topic,
      payloadHash: input.payloadHash,
      status: input.status,
      ...(input.requestId ? { inspectionRequestId: input.requestId } : {}),
      ...(input.jobId ? { inspectionJobId: input.jobId } : {}),
      ...(input.errorCode ? { errorCode: input.errorCode } : {}),
      ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
      receivedAt: now,
      ...(input.status !== 'received' ? { processedAt: now } : {}),
      createdAt: now,
      updatedAt: now,
    },
    input.actorId,
  );
}

async function updateDelivery(
  dependencies: ApiDependencies,
  delivery: StoredRecord,
  agencyId: string,
  actorId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await dependencies.repository.update(
    'integrationDeliveries',
    agencyId,
    delivery.id,
    { ...patch, processedAt: new Date().toISOString() },
    Number(delivery.version),
    actorId,
  );
}

async function handleExternalCancellation(
  dependencies: ApiDependencies,
  agencyId: string,
  request: InspectionRequest,
): Promise<void> {
  if (!request.cancelledAt || !request.inspectionJobId) return;
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
        transitionReason: 'shopify_order_cancelled',
        bookingStatus: 'cancelled',
        lastCalendarSyncStatus: job.googleCalendar ? 'pending' : 'not_required',
      },
      Number(job.version),
      'system:shopify-webhook',
    );
    return;
  }
  await createSyncException(
    dependencies,
    {
      agencyId,
      provider: 'shopify',
      category: 'cancelled_order_active_job',
      severity: action === 'preserve_job_and_raise_exception' ? 'critical' : 'warning',
      status: 'open',
      title: 'Cancelled Shopify order has an active inspection job',
      detail: `Order ${request.shopifyOrder?.orderNumber || request.sourceExternalId} was cancelled after job ${job.id} progressed to ${String(job.status)}. The inspection record was preserved and requires operator review.`,
      inspectionRequestId: request.id,
      inspectionJobId: job.id,
      externalId: request.shopifyOrder?.orderGid,
    },
    'system:shopify-webhook',
  );
}

async function processOrder(
  dependencies: ApiDependencies,
  input: {
    agencyId: string;
    order: ReturnType<typeof parseShopifyOrderWebhook>;
    propertyAddress?: string;
    accessInstructions?: string;
    deliveryId?: string;
    actorId: string;
    autoConvert: boolean;
  },
): Promise<{ request: InspectionRequest; jobId?: string; mapping?: InspectionServiceMapping }> {
  const mappings = await serviceMappings(dependencies, input.agencyId);
  const mapping = matchShopifyServiceMapping(input.order, mappings);
  if (!mapping) {
    await createSyncException(
      dependencies,
      {
        agencyId: input.agencyId,
        provider: 'shopify',
        category: 'unknown_product',
        severity: 'warning',
        status: 'open',
        title: 'Shopify inspection product is not mapped',
        detail: `Order ${input.order.orderNumber} contains no active product or variant mapping. It remains visible in integration history but was not converted into an operational job.`,
        externalId: input.order.orderGid,
      },
      input.actorId,
    );
  }
  const request = await upsertShopifyInspectionRequest(dependencies, {
    agencyId: input.agencyId,
    order: input.order,
    propertyAddress: input.propertyAddress,
    accessInstructions: input.accessInstructions,
    mapping,
    sourceDeliveryId: input.deliveryId,
    actorId: input.actorId,
  });
  if (!mapping) return { request };
  const result = await maybeAutoConvertInspectionRequest(dependencies, {
    agencyId: input.agencyId,
    request,
    mapping,
    actorId: input.actorId,
    autoConvert: input.autoConvert,
  });
  await handleExternalCancellation(dependencies, input.agencyId, result.request);
  return {
    request: result.request,
    ...(result.job ? { jobId: result.job.id } : {}),
    mapping,
  };
}

export async function routeShopifyIntegrationRequest(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
): Promise<ApiResponse | undefined> {
  const route = routeParts(req);
  if (route[0] !== 'api' || route[1] !== 'v1' || route[2] !== 'integrations' || route[3] !== 'shopify') {
    return undefined;
  }

  if (route[4] === 'webhooks' && route[5] && req.method === 'POST') {
    const agencyId = decodeURIComponent(route[5]);
    const raw = await readRaw(req);
    const hmac = req.headers['x-shopify-hmac-sha256']?.toString();
    if (!verifyShopifyWebhookHmac(raw, hmac)) {
      throw new ApiError(401, 'SHOPIFY_WEBHOOK_INVALID', 'Shopify webhook signature is invalid.');
    }
    const topic = req.headers['x-shopify-topic']?.toString().trim().toLowerCase() || 'unknown';
    const shopDomain = canonicalDomain(req.headers['x-shopify-shop-domain']?.toString() || '');
    const deliveryId =
      req.headers['x-shopify-webhook-id']?.toString().trim() ||
      payloadSha256(raw);
    const connectionRecord = await connection(dependencies, agencyId);
    if (!connectionRecord || connectionRecord.status !== 'connected') {
      throw new ApiError(404, 'SHOPIFY_CONNECTION_NOT_FOUND', 'Shopify integration is not connected for this agency.');
    }
    if (
      connectionRecord.externalAccountId &&
      canonicalDomain(connectionRecord.externalAccountId) !== shopDomain
    ) {
      throw new ApiError(403, 'SHOPIFY_STORE_MISMATCH', 'Webhook store does not match the connected Shopify store.');
    }
    const deliveryKey = `shopify-delivery-${createHash('sha256')
      .update(deliveryId)
      .digest('hex')
      .slice(0, 32)}`;
    const duplicate = await dependencies.repository.get('integrationDeliveries', agencyId, deliveryKey);
    if (duplicate) {
      return {
        status: 200,
        body: { data: { duplicate: true, deliveryId }, meta: { correlationId } },
        headers: { 'x-proinspect-webhook-replayed': 'true' },
      };
    }
    const delivery = await storeDelivery(dependencies, {
      agencyId,
      deliveryId,
      topic,
      payloadHash: payloadSha256(raw),
      status: 'received',
      actorId: 'system:shopify-webhook',
    });
    try {
      if (topic.includes('refund')) {
        await dependencies.repository.update(
          'integrationConnections',
          agencyId,
          CONNECTION_ID,
          { syncRequestedAt: new Date().toISOString() },
          connectionRecord.version,
          'system:shopify-webhook',
        );
        await updateDelivery(dependencies, delivery, agencyId, 'system:shopify-webhook', {
          status: 'processed',
        });
        return {
          status: 202,
          body: { data: { accepted: true, reconciliationRequested: true }, meta: { correlationId } },
        };
      }
      const payload = JSON.parse(raw.toString('utf8')) as ShopifyOrderWebhookPayload;
      const order = parseShopifyOrderWebhook(payload, shopDomain);
      const autoConvert = connectionRecord.configuration.autoConvertReadyRequests !== false;
      const result = await processOrder(dependencies, {
        agencyId,
        order,
        propertyAddress: shopifyPropertyAddress(payload),
        accessInstructions: shopifyAccessInstructions(payload),
        deliveryId,
        actorId: 'system:shopify-webhook',
        autoConvert,
      });
      await updateDelivery(dependencies, delivery, agencyId, 'system:shopify-webhook', {
        status: result.mapping ? 'processed' : 'ignored',
        inspectionRequestId: result.request.id,
        ...(result.jobId ? { inspectionJobId: result.jobId } : {}),
        externalEventId: order.orderGid,
      });
      return {
        status: 200,
        body: {
          data: {
            accepted: true,
            inspectionRequestId: result.request.id,
            ...(result.jobId ? { inspectionJobId: result.jobId } : {}),
          },
          meta: { correlationId },
        },
      };
    } catch (error) {
      await updateDelivery(dependencies, delivery, agencyId, 'system:shopify-webhook', {
        status: 'failed',
        errorCode: (error as { code?: string }).code || 'SHOPIFY_WEBHOOK_PROCESSING_FAILED',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  const agencyId = agencyHeader(req);

  if (route.length === 4 && req.method === 'GET') {
    const principal = await authenticateAndAuthorise(
      req,
      dependencies,
      'agency.read',
      { agencyId },
      correlationId,
    );
    const connected = await connection(dependencies, agencyId);
    const mappingRecords = (await serviceMappings(dependencies, agencyId)).filter(
      (item) => item.provider === 'shopify',
    );
    return {
      status: 200,
      body: {
        data: {
          connection: connected
            ? {
                ...connected,
                credentialReference: connected.credentialReference ? 'configured' : undefined,
              }
            : null,
          mappings: mappingRecords,
        },
        meta: { correlationId, actor: principal.uid },
      },
    };
  }

  if (route[4] === 'connect' && req.method === 'POST') {
    const body = await readJson(req);
    const principal = await authenticateAndAuthorise(
      req,
      dependencies,
      'agency.manage',
      { agencyId },
      correlationId,
    );
    const shopDomain = canonicalDomain(typeof body.shopDomain === 'string' ? body.shopDomain : '');
    const accessToken = typeof body.accessToken === 'string' ? body.accessToken.trim() : '';
    if (!accessToken) throw new ApiError(400, 'SHOPIFY_ACCESS_TOKEN_REQUIRED', 'accessToken is required.');
    const credentials: ShopifyAdminCredentials = { shopDomain, accessToken };
    let identity;
    try {
      identity = await getShopifyShopIdentity(credentials);
    } catch (error) {
      throw new ApiError(
        422,
        'SHOPIFY_CONNECTION_FAILED',
        error instanceof Error ? error.message : 'Shopify connection failed.',
      );
    }
    const now = new Date().toISOString();
    const existing = await connection(dependencies, agencyId);
    const publicBaseUrl =
      (typeof body.publicApiBaseUrl === 'string' ? body.publicApiBaseUrl.trim() : '') ||
      process.env.PUBLIC_API_BASE_URL?.trim() ||
      '';
    const webhookUri = publicBaseUrl
      ? `${publicBaseUrl.replace(/\/$/u, '')}/api/v1/integrations/shopify/webhooks/${encodeURIComponent(agencyId)}`
      : undefined;
    const data = {
      provider: 'shopify',
      status: 'connected',
      externalAccountId: identity.myshopifyDomain,
      externalAccountLabel: identity.name,
      permissions: ['read_orders', 'read_customers', 'read_products'],
      configuration: {
        autoConvertReadyRequests: body.autoConvertReadyRequests !== false,
        ...(webhookUri ? { webhookUri } : {}),
        shopId: identity.id,
      },
      credentialReference: `integrationCredentials/${CONNECTION_ID}`,
      lastSuccessfulSyncAt: now,
      lastAttemptedSyncAt: now,
    };
    const stored = existing
      ? await dependencies.repository.update(
          'integrationConnections',
          agencyId,
          CONNECTION_ID,
          data,
          positiveVersion(body.expectedVersion),
          principal.uid,
        )
      : await dependencies.repository.create(
          'integrationConnections',
          agencyId,
          CONNECTION_ID,
          data,
          principal.uid,
        );
    await saveIntegrationCredentials(dependencies, {
      agencyId,
      connectionId: CONNECTION_ID,
      provider: 'shopify',
      credentials,
      actorId: principal.uid,
    });
    const currentMappings = (await serviceMappings(dependencies, agencyId)).filter(
      (item) => item.provider === 'shopify',
    );
    if (!currentMappings.length) {
      for (const mapping of defaultShopifyServiceMappings(agencyId, now)) {
        await dependencies.repository.create(
          'inspectionServiceMappings',
          agencyId,
          mapping.id,
          mapping as unknown as Record<string, unknown>,
          principal.uid,
        );
      }
    }
    let webhooks: Awaited<ReturnType<typeof ensureShopifyWebhookSubscriptions>> = [];
    if (webhookUri && body.registerWebhooks !== false) {
      webhooks = await ensureShopifyWebhookSubscriptions(credentials, webhookUri);
    }
    return {
      status: existing ? 200 : 201,
      body: {
        data: {
          connection: stored,
          shop: identity,
          webhookUri,
          webhooks,
        },
        meta: { correlationId },
      },
    };
  }

  if (route[4] === 'seed-mappings' && req.method === 'POST') {
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
    for (const mapping of defaultShopifyServiceMappings(agencyId)) {
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

  if (route[4] === 'reconcile' && req.method === 'POST') {
    const body = await readJson(req);
    const principal = await authenticateAndAuthorise(
      req,
      dependencies,
      'agency.manage',
      { agencyId },
      correlationId,
    );
    const connected = await connection(dependencies, agencyId);
    if (!connected || connected.status !== 'connected') {
      throw new ApiError(409, 'SHOPIFY_NOT_CONNECTED', 'Connect Shopify before reconciliation.');
    }
    const credentials = await loadIntegrationCredentials<ShopifyAdminCredentials>(
      dependencies,
      agencyId,
      CONNECTION_ID,
    );
    if (!credentials) throw new ApiError(409, 'SHOPIFY_CREDENTIALS_MISSING', 'Shopify credentials are unavailable.');
    const updatedSince =
      (typeof body.updatedSince === 'string' && body.updatedSince) ||
      connected.lastSuccessfulSyncAt ||
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const mappings = await serviceMappings(dependencies, agencyId);
    const processed: Array<{ orderId: string; requestId: string; jobId?: string }> = [];
    let cursor: string | undefined;
    let pageCount = 0;
    try {
      do {
        const page = await fetchShopifyOrders(credentials, updatedSince, cursor, 100);
        for (const order of page.orders) {
          const mapping = matchShopifyServiceMapping(order, mappings);
          const request = await upsertShopifyInspectionRequest(dependencies, {
            agencyId,
            order,
            mapping,
            actorId: principal.uid,
          });
          const conversion = await maybeAutoConvertInspectionRequest(dependencies, {
            agencyId,
            request,
            mapping,
            actorId: principal.uid,
            autoConvert: connected.configuration.autoConvertReadyRequests !== false,
          });
          await handleExternalCancellation(dependencies, agencyId, conversion.request);
          processed.push({
            orderId: order.orderGid,
            requestId: conversion.request.id,
            ...(conversion.job ? { jobId: conversion.job.id } : {}),
          });
        }
        cursor = page.endCursor;
        pageCount += 1;
        if (!page.hasNextPage || pageCount >= 20) break;
      } while (cursor);
      await dependencies.repository.update(
        'integrationConnections',
        agencyId,
        CONNECTION_ID,
        {
          lastAttemptedSyncAt: new Date().toISOString(),
          lastSuccessfulSyncAt: new Date().toISOString(),
          lastErrorCode: null,
          lastErrorMessage: null,
        },
        connected.version,
        principal.uid,
      );
    } catch (error) {
      await dependencies.repository.update(
        'integrationConnections',
        agencyId,
        CONNECTION_ID,
        {
          status: 'attention_required',
          lastAttemptedSyncAt: new Date().toISOString(),
          lastErrorCode: (error as { code?: string }).code || 'SHOPIFY_RECONCILIATION_FAILED',
          lastErrorMessage: error instanceof Error ? error.message : String(error),
        },
        connected.version,
        principal.uid,
      );
      throw error;
    }
    return {
      status: 200,
      body: { data: { updatedSince, processed, pages: pageCount }, meta: { correlationId } },
    };
  }

  if (route[4] === 'disconnect' && req.method === 'POST') {
    const body = await readJson(req);
    const principal = await authenticateAndAuthorise(
      req,
      dependencies,
      'agency.manage',
      { agencyId },
      correlationId,
    );
    const connected = await connection(dependencies, agencyId);
    if (!connected) throw new ApiError(404, 'SHOPIFY_NOT_CONNECTED', 'Shopify connection was not found.');
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
