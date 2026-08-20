import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type {
  InspectionCommunication,
  InspectionRequest,
  InspectionServiceMapping,
} from '@pcr/domain';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { listAllRecords } from '../services/inspectionIntakeService.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies, IdempotencyResult, StoredRecord } from './types.js';

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
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
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

function secureEqual(left?: string, right?: string): boolean {
  if (!left || !right) return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function actor(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  agencyId: string,
  correlationId: string,
): Promise<{ uid: string; role: string; agencyId: string }> {
  if (
    secureEqual(
      req.headers['x-proinspect-automation-secret']?.toString(),
      process.env.AUTOMATION_RUNNER_SECRET?.trim(),
    )
  ) {
    return { uid: 'system:booking-automation', role: 'operations', agencyId };
  }
  return authenticateAndAuthorise(
    req,
    dependencies,
    'job.manage',
    { agencyId },
    correlationId,
  );
}

function idempotencyKey(req: IncomingMessage): string {
  const value = req.headers['idempotency-key']?.toString().trim();
  if (!value || value.length < 8 || value.length > 200) {
    throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key is required.');
  }
  return value;
}

function record<T>(value: StoredRecord): T {
  return value as unknown as T;
}

function communicationId(requestId: string, bookingPageUrl: string): string {
  return `booking-invitation-${createHash('sha256')
    .update(`${requestId}:${bookingPageUrl}`)
    .digest('hex')
    .slice(0, 28)}`;
}

export async function routeInspectionBookingAutomationRequest(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
): Promise<ApiResponse | undefined> {
  const route = routeParts(req);
  if (
    route[0] !== 'api' ||
    route[1] !== 'v1' ||
    route[2] !== 'inspection-operations' ||
    route[3] !== 'run-booking-invitations'
  ) {
    return undefined;
  }
  if (req.method !== 'POST') {
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Booking automation requires POST.');
  }

  const agencyId = agencyHeader(req);
  const body = await readJson(req);
  const principal = await actor(req, dependencies, agencyId, correlationId);
  const result = await dependencies.idempotency.execute(
    agencyId,
    'inspection-operations:run-booking-invitations',
    idempotencyKey(req),
    createHash('sha256').update(JSON.stringify(body)).digest('hex'),
    async (): Promise<IdempotencyResult> => {
      const [requestRecords, mappingRecords] = await Promise.all([
        listAllRecords(dependencies, 'inspectionRequests', agencyId),
        listAllRecords(dependencies, 'inspectionServiceMappings', agencyId),
      ]);
      const mappings = mappingRecords.map((item) => record<InspectionServiceMapping>(item));
      const queued: string[] = [];
      const skipped: Array<{ requestId: string; reason: string }> = [];

      for (const requestRecord of requestRecords) {
        const request = record<InspectionRequest>(requestRecord);
        if (request.intakeStatus !== 'awaiting_booking') continue;
        if (request.bookingLinkSentAt || request.bookingLinkCommunicationId) continue;
        if (!request.customerEmail?.trim()) {
          skipped.push({ requestId: request.id, reason: 'customer_email_missing' });
          continue;
        }
        const mapping = mappings.find(
          (candidate) =>
            candidate.active &&
            candidate.serviceCode === request.serviceCode &&
            Boolean(candidate.bookingPageUrl),
        );
        const bookingPageUrl = mapping?.bookingPageUrl?.trim();
        if (!bookingPageUrl) {
          skipped.push({ requestId: request.id, reason: 'booking_page_not_configured' });
          continue;
        }

        const id = communicationId(request.id, bookingPageUrl);
        const existing = await dependencies.repository.get(
          'inspectionCommunications',
          agencyId,
          id,
        );
        const now = new Date().toISOString();
        const communication = existing ||
          (await dependencies.repository.create(
            'inspectionCommunications',
            agencyId,
            id,
            {
              inspectionRequestId: request.id,
              type: 'booking_link_sent',
              channel: 'email',
              recipient: request.customerEmail,
              subject: `Book your ${request.reportType || mapping?.label || 'property inspection'}`,
              summary: `Booking invitation queued. Booking page: ${bookingPageUrl}`,
              status: 'queued',
              occurredAt: now,
              createdBy: principal.uid,
              createdAt: now,
              updatedAt: now,
            } satisfies Omit<InspectionCommunication, 'id'> as unknown as Record<
              string,
              unknown
            >,
            principal.uid,
          ));

        await dependencies.tasks.dispatch('notification', agencyId, id, {
          notificationType: 'inspection_booking_invitation',
          inspectionRequestId: request.id,
          communicationId: id,
          recipient: request.customerEmail,
          customerName: request.customerName,
          reportType: request.reportType,
          bookingPageUrl,
          shopifyOrderNumber: request.shopifyOrder?.orderNumber,
        });

        await dependencies.repository.update(
          'inspectionRequests',
          agencyId,
          request.id,
          {
            bookingPageUrl,
            bookingLinkSentAt: now,
            bookingLinkCommunicationId: communication.id,
          },
          Number(requestRecord.version),
          principal.uid,
        );
        queued.push(request.id);
      }

      await dependencies.audit.append({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        actorId: principal.uid,
        actorRole: principal.role,
        agencyId,
        capability: 'job.manage',
        outcome: 'allowed',
        reason: 'inspection.booking_invitations_processed',
        target: { agencyId },
        correlationId,
        entityType: 'system',
        entityId: `booking-automation-${new Date().toISOString()}`,
        eventType: 'inspection.booking_invitations_processed',
        metadata: { queued, skipped },
      });

      return {
        status: 200,
        body: { data: { queued, skipped }, meta: { correlationId } },
      };
    },
  );

  return {
    status: result.result.status,
    body: result.result.body,
    headers: { 'idempotency-replayed': String(result.replayed) },
  };
}
