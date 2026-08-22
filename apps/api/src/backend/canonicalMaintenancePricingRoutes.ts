import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { SecurityCapability } from '@pcr/domain';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import {
  enrichPublishedPriceBookCanonicalBindings,
  generateCanonicalMaintenanceEstimate,
} from '../services/canonicalMaintenancePricingService.js';
import { extractCanonicalMaintenanceForReport } from '../services/canonicalMaintenanceExtractionService.js';
import { publishPriceBookImport } from '../services/maintenanceCommercialService.js';
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
    if (size > 2_000_000) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Canonical maintenance pricing payload exceeds 2 MB.');
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

async function principal(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  capability: SecurityCapability,
  agencyId: string,
  correlationId: string,
  target: Record<string, unknown> = {},
) {
  return authenticateAndAuthorise(
    req,
    dependencies,
    capability,
    { agencyId, ...target },
    correlationId,
  );
}

export async function routeCanonicalMaintenancePricingRequest(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
): Promise<ApiResponse | undefined> {
  const route = parts(req);
  if (route[0] !== 'api' || route[1] !== 'v1') return undefined;
  const agencyId = agencyHeader(req);

  if (
    route[2] === 'maintenance-candidates' &&
    route[3] === 'extract-automatic' &&
    route.length === 4 &&
    req.method === 'POST'
  ) {
    const body = await readJson(req);
    const reportId = typeof body.reportId === 'string' ? body.reportId.trim() : '';
    if (!reportId) throw new ApiError(400, 'REPORT_ID_REQUIRED', 'reportId is required for maintenance extraction.');
    const actor = await principal(req, dependencies, 'maintenance.triage', agencyId, correlationId, { reportId });
    return idempotent(dependencies, req, agencyId, `maintenance-extraction:${reportId}:canonical`, body, async () => ({
      status: 200,
      body: {
        data: await extractCanonicalMaintenanceForReport(dependencies, {
          agencyId,
          reportId,
          actorId: actor.uid,
          actorRole: actor.role,
          correlationId,
          preliminary: body.preliminary === true,
        }),
        meta: { correlationId, identityMode: 'canonical_first' },
      },
    }));
  }

  if (
    route[2] === 'maintenance-items' &&
    route[3] &&
    route[4] === 'estimate' &&
    route.length === 5 &&
    req.method === 'POST'
  ) {
    const maintenanceItemId = decodeURIComponent(route[3]);
    const body = await readJson(req);
    const item = await dependencies.repository.get('maintenanceItems', agencyId, maintenanceItemId);
    if (!item) throw new ApiError(404, 'MAINTENANCE_ITEM_NOT_FOUND', 'Maintenance item not found.');
    const actor = await principal(req, dependencies, 'maintenance.quote.prepare', agencyId, correlationId, {
      propertyId: item.propertyId,
      maintenanceItemId: item.id,
    });
    return idempotent(dependencies, req, agencyId, `maintenance-item:${maintenanceItemId}:canonical-estimate`, body, async () => ({
      status: 201,
      body: {
        data: await generateCanonicalMaintenanceEstimate(dependencies, {
          agencyId,
          maintenanceItemId,
          actorId: actor.uid,
          ...(typeof body.preferredPriceBookId === 'string' ? { preferredPriceBookId: body.preferredPriceBookId } : {}),
          ...(typeof body.quantity === 'number' ? { quantity: body.quantity } : {}),
          afterHours: body.afterHours === true,
          saturday: body.saturday === true,
          sunday: body.sunday === true,
          publicHoliday: body.publicHoliday === true,
        }),
        meta: { correlationId, pricingIdentityMode: 'canonical_first' },
      },
    }));
  }

  if (
    route[2] === 'price-book-imports' &&
    route[3] &&
    route[4] === 'publish' &&
    route.length === 5 &&
    req.method === 'POST'
  ) {
    const importId = decodeURIComponent(route[3]);
    const body = await readJson(req);
    const actor = await principal(req, dependencies, 'price_book.manage', agencyId, correlationId);
    return idempotent(dependencies, req, agencyId, `price-book-import:${importId}:canonical-publish`, body, async () => {
      const published = await publishPriceBookImport(dependencies, {
        agencyId,
        importId,
        actorId: actor.uid,
        ...(typeof body.name === 'string' ? { name: body.name } : {}),
        ...(typeof body.currency === 'string' ? { currency: body.currency } : {}),
        ...(typeof body.effectiveFrom === 'string' ? { effectiveFrom: body.effectiveFrom } : {}),
      });
      const version = await enrichPublishedPriceBookCanonicalBindings(dependencies, {
        agencyId,
        importId,
        version: published.version,
        actorId: actor.uid,
      });
      return {
        status: 201,
        body: {
          data: { priceBook: published.priceBook, version },
          meta: {
            correlationId,
            canonicalBindingVersion: 1,
            canonicalBindingCount: Number((version as unknown as Record<string, unknown>).canonicalBindingCount ?? 0),
          },
        },
      };
    });
  }

  return undefined;
}
