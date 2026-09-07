import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { SecurityCapability } from '@pcr/domain';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies, StoredRecord } from './types.js';

function parts(req: IncomingMessage): string[] { return new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean); }
function agencyId(req: IncomingMessage): string { const value = req.headers['x-agency-id']?.toString().trim(); if (!value) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.'); return value; }
async function readJson(req: IncomingMessage, maxBytes = 2_000_000): Promise<Record<string, unknown>> { const chunks: Buffer[] = []; let size = 0; for await (const chunk of req) { const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += buffer.length; if (size > maxBytes) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.'); chunks.push(buffer); } if (!chunks.length) return {}; const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'INVALID_JSON', 'Request body must be a JSON object.'); return value as Record<string, unknown>; }
async function listAll(deps: ApiDependencies, collection: string, agency: string): Promise<StoredRecord[]> { const out: StoredRecord[] = []; let cursor: string | undefined; do { const page = await deps.repository.list(collection, agency, 100, cursor); out.push(...page.items); cursor = page.nextCursor; } while (cursor); return out; }
function expected(body: Record<string, unknown>): number { const value = Number(body.expectedVersion); if (!Number.isInteger(value) || value < 1) throw new ApiError(400, 'EXPECTED_VERSION_REQUIRED', 'expectedVersion must be a positive integer.'); return value; }
async function authorise(req: IncomingMessage, deps: ApiDependencies, capability: SecurityCapability, agency: string, correlationId: string, target: Record<string, string | undefined> = {}) { return authenticateAndAuthorise(req, deps, capability, { agencyId: agency, ...target }, correlationId); }
function sha(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function num(value: unknown): number | undefined { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : undefined; }
function haversine(a: { latitude?: number; longitude?: number }, b: { latitude?: number; longitude?: number }): number { if (a.latitude == null || a.longitude == null || b.latitude == null || b.longitude == null) return Number.MAX_SAFE_INTEGER / 4; const rad = Math.PI / 180; const dLat = (b.latitude - a.latitude) * rad; const dLon = (b.longitude - a.longitude) * rad; const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2; return 6_371_000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)); }

async function collectionCrud(req: IncomingMessage, deps: ApiDependencies, correlationId: string, input: { segment: string; collection: string; read: SecurityCapability; write: SecurityCapability }): Promise<ApiResponse | undefined> {
  const route = parts(req); if (route[0] !== 'api' || route[1] !== 'v1' || route[2] !== input.segment) return undefined;
  const agency = agencyId(req); const principal = await authorise(req, deps, req.method === 'GET' ? input.read : input.write, agency, correlationId); const id = route[3];
  if (req.method === 'GET' && !id) return { status: 200, body: { data: await listAll(deps, input.collection, agency), meta: { correlationId } } };
  if (req.method === 'GET' && id) { const record = await deps.repository.get(input.collection, agency, id); if (!record) throw new ApiError(404, 'NOT_FOUND', `${input.segment} record was not found.`); return { status: 200, body: { data: record, meta: { correlationId } } }; }
  const body = await readJson(req);
  if (req.method === 'POST' && !id) { const recordId = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : randomUUID(); const record = await deps.repository.create(input.collection, agency, recordId, { ...body, id: undefined, agencyId: undefined }, principal.uid); return { status: 201, body: { data: record, meta: { correlationId } } }; }
  if (req.method === 'PATCH' && id) { const record = await deps.repository.update(input.collection, agency, id, { ...body, expectedVersion: undefined }, expected(body), principal.uid); return { status: 200, body: { data: record, meta: { correlationId } } }; }
  return undefined;
}

async function routeDocumentPackets(req: IncomingMessage, deps: ApiDependencies, correlationId: string): Promise<ApiResponse | undefined> {
  const route = parts(req); if (route[0] !== 'api' || route[1] !== 'v1' || route[2] !== 'document-packets') return undefined;
  const agency = agencyId(req); const id = route[3]; const action = route[4]; if (!id || !action) return collectionCrud(req, deps, correlationId, { segment: 'document-packets', collection: 'documentPackets', read: 'document.packet.read', write: 'document.packet.manage' });
  const body = req.method === 'POST' || req.method === 'PATCH' ? await readJson(req) : {}; const capability: SecurityCapability = action === 'approve' ? 'document.packet.approve' : action === 'issue' ? 'document.packet.issue' : 'document.packet.manage'; const principal = await authorise(req, deps, capability, agency, correlationId); const current = await deps.repository.get('documentPackets', agency, id); if (!current) throw new ApiError(404, 'DOCUMENT_PACKET_NOT_FOUND', 'Document packet was not found.'); if (req.method !== 'POST') return undefined;
  if (action === 'render') {
    const requests = Array.isArray(body.renderRequests) ? body.renderRequests.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item))) : [];
    if (!requests.length) throw new ApiError(400, 'RENDER_REQUESTS_REQUIRED', 'renderRequests are required.'); const documentIds: string[] = [];
    for (const request of requests) { const documentId = typeof request.documentId === 'string' && request.documentId ? request.documentId : randomUUID(); const templateVersionId = String(request.templateVersionId || ''); if (!templateVersionId) throw new ApiError(400, 'TEMPLATE_VERSION_REQUIRED', 'Each render request needs templateVersionId.'); const taskId = `document-${documentId}`; await deps.tasks.dispatch('document', agency, taskId, { documentId, templateVersionId, packetId: id, tenancyId: current.tenancyId, propertyId: current.propertyId, title: String(request.title || current.packetType || 'Tenancy document'), fields: request.fields && typeof request.fields === 'object' ? request.fields : current.dataSnapshot || {}, appendixText: request.appendixText }); documentIds.push(documentId); }
    const updated = await deps.repository.update('documentPackets', agency, id, { documentIds, renderingTaskCount: documentIds.length, status: 'validation_required' }, Number(current.version), principal.uid); return { status: 202, body: { data: updated, meta: { correlationId, documentIds } } };
  }
  if (action === 'validate') { const documents = Array.isArray(current.documentIds) ? current.documentIds : []; const recipients = Array.isArray(current.recipients) ? current.recipients : []; const existing = await Promise.all(documents.map((documentId) => deps.repository.get('tenancyDocuments', agency, String(documentId)))); const blockers = [...(!documents.length ? ['At least one document is required.'] : []), ...(existing.some((item) => !item || !item.sha256) ? ['Every document must be rendered successfully.'] : []), ...(!recipients.length ? ['At least one recipient is required.'] : [])]; const next = blockers.length ? 'validation_required' : 'approval_required'; const updated = await deps.repository.update('documentPackets', agency, id, { status: next, validationBlockers: blockers }, Number(current.version), principal.uid); return { status: 200, body: { data: updated, meta: { correlationId, blockers } } }; }
  if (action === 'approve') { const updated = await deps.repository.update('documentPackets', agency, id, { status: 'ready_to_issue', approvedAt: new Date().toISOString(), approvedBy: principal.uid }, expected(body), principal.uid); return { status: 200, body: { data: updated, meta: { correlationId } } }; }
  if (action === 'issue') { if (String(current.status) !== 'ready_to_issue') throw new ApiError(409, 'PACKET_NOT_READY', 'Only a ready_to_issue packet may be issued.'); const updated = await deps.repository.update('documentPackets', agency, id, { status: 'issued', issuedAt: new Date().toISOString(), issuedBy: principal.uid, dataSnapshotSha256: String(current.dataSnapshotSha256 || sha(current.dataSnapshot || {})) }, expected(body), principal.uid); return { status: 200, body: { data: updated, meta: { correlationId } } }; }
  if (action === 'void') { const updated = await deps.repository.update('documentPackets', agency, id, { status: 'voided', voidedAt: new Date().toISOString(), voidedBy: principal.uid, voidReason: body.reason }, expected(body), principal.uid); return { status: 200, body: { data: updated, meta: { correlationId } } }; }
  return undefined;
}

async function routeOffline(req: IncomingMessage, deps: ApiDependencies, correlationId: string): Promise<ApiResponse | undefined> {
  const route = parts(req);
  if (
    route[0] !== 'api'
    || route[1] !== 'v1'
    || route[2] !== 'inspection-jobs'
    || !route[3]
    || !['offline-package', 'offline-sync', 'sync-status'].includes(route[4] || '')
  ) return undefined;

  const agency = agencyId(req);
  const jobId = route[3];
  const action = route[4];
  const principal = await authorise(
    req,
    deps,
    'job.offline.sync',
    agency,
    correlationId,
    { inspectionJobId: jobId },
  );
  const job = await deps.repository.get('inspectionJobs', agency, jobId);
  if (!job) throw new ApiError(404, 'INSPECTION_JOB_NOT_FOUND', 'Inspection job was not found.');

  if (req.method === 'GET' && action === 'offline-package') {
    const propertyId = String(job.propertyId || (job.propertySnapshot as Record<string, unknown> | undefined)?.propertyId || '');
    const reportId = String(job.reportId || '');
    const layoutId = String(job.propertyLayoutVersionId || (job.propertySnapshot as Record<string, unknown> | undefined)?.propertyLayoutVersionId || '');
    const templateId = String(job.templateVersionId || job.templateId || '');
    const baselineId = String(job.entryBaselineReportId || '');
    const [property, report, tenancy, layout, template, baseline] = await Promise.all([
      propertyId ? deps.repository.get('properties', agency, propertyId) : undefined,
      reportId ? deps.repository.get('reports', agency, reportId) : undefined,
      job.tenancyId ? deps.repository.get('tenancies', agency, String(job.tenancyId)) : undefined,
      layoutId ? deps.repository.get('propertyLayoutVersions', agency, layoutId) : undefined,
      templateId ? deps.repository.get('templates', agency, templateId) : undefined,
      baselineId ? deps.repository.get('reports', agency, baselineId) : undefined,
    ]);
    const data = { job, property, report, tenancy, layout, template, baseline, downloadedAt: new Date().toISOString() };
    return {
      status: 200,
      body: { data: { ...data, packageHash: sha(data) }, meta: { correlationId, actor: principal.uid } },
    };
  }

  if (req.method === 'GET' && action === 'sync-status') {
    const uploads = (await listAll(deps, 'uploadSessions', agency))
      .filter((item) => item.inspectionJobId === jobId);
    const pending = uploads.filter((item) => !['completed', 'duplicate'].includes(String(item.status))).length;
    return {
      status: 200,
      body: {
        data: {
          inspectionJobId: jobId,
          cloudVersion: job.version,
          pendingUploads: pending,
          ready: pending === 0,
        },
        meta: { correlationId },
      },
    };
  }

  if (req.method === 'POST' && action === 'offline-sync') {
    const body = await readJson(req);
    const operationId = typeof body.operationId === 'string' ? body.operationId.trim() : '';
    const operation = typeof body.operation === 'string' ? body.operation.trim() : '';
    const baseVersion = Number(body.baseVersion);
    const patch = body.patch && typeof body.patch === 'object' && !Array.isArray(body.patch)
      ? body.patch as Record<string, unknown>
      : {};

    if (!operationId || operationId.length > 128) {
      throw new ApiError(400, 'OFFLINE_OPERATION_ID_REQUIRED', 'operationId must be a non-empty string of at most 128 characters.');
    }
    if (operation !== 'job.patch') {
      throw new ApiError(400, 'OFFLINE_OPERATION_UNSUPPORTED', 'Only job.patch is supported for offline mutation replay.');
    }
    if (!Number.isInteger(baseVersion) || baseVersion < 1) {
      throw new ApiError(400, 'OFFLINE_BASE_VERSION_REQUIRED', 'baseVersion must be a positive integer.');
    }

    const payloadHash = sha({ operation, jobId, baseVersion, patch });
    const receiptId = `offline_${createHash('sha256').update(`${agency}:${operationId}`).digest('hex').slice(0, 28)}`;
    const existingReceipt = await deps.repository.get('offlineSyncReceipts', agency, receiptId);
    if (existingReceipt) {
      if (
        String(existingReceipt.operationId || '') !== operationId
        || String(existingReceipt.payloadHash || '') !== payloadHash
      ) {
        throw new ApiError(
          409,
          'OFFLINE_OPERATION_REUSE',
          'The offline operation ID was already used with a different payload.',
        );
      }
      return {
        status: 200,
        body: {
          data: {
            ...job,
            version: Number(existingReceipt.resultVersion || job.version),
            offlineOperationId: operationId,
            replayed: true,
          },
          meta: { correlationId, replayed: true, operationId },
        },
      };
    }

    const execution = await deps.idempotency.execute(
      agency,
      'offline.job.patch',
      operationId,
      payloadHash,
      async () => {
        const current = await deps.repository.get('inspectionJobs', agency, jobId);
        if (!current) {
          throw new ApiError(404, 'INSPECTION_JOB_NOT_FOUND', 'Inspection job was not found.');
        }
        if (baseVersion !== Number(current.version)) {
          throw new ApiError(
            409,
            'OFFLINE_CONFLICT',
            'The cloud inspection job changed after the offline package was downloaded.',
            { cloudVersion: current.version, baseVersion },
          );
        }
        const updated = await deps.repository.update(
          'inspectionJobs',
          agency,
          jobId,
          { ...patch, lastOfflineSyncAt: new Date().toISOString() },
          baseVersion,
          principal.uid,
        );
        return {
          status: 200,
          body: {
            data: updated,
            meta: { correlationId, operationId },
          },
        };
      },
    );

    const resultBody = execution.result.body as { data?: Record<string, unknown>; meta?: Record<string, unknown> };
    const resultVersion = Number(resultBody.data?.version || baseVersion + 1);
    const now = new Date().toISOString();
    const receipt = await deps.repository.get('offlineSyncReceipts', agency, receiptId);
    if (!receipt) {
      await deps.repository.create(
        'offlineSyncReceipts',
        agency,
        receiptId,
        {
          inspectionJobId: jobId,
          operationId,
          operation,
          userId: principal.uid,
          entityType: 'inspection_job',
          entityId: jobId,
          baseVersion,
          resultVersion,
          payloadHash,
          resultHash: sha(execution.result.body),
          receivedAt: now,
          appliedAt: now,
        },
        principal.uid,
      );
    }

    return {
      status: execution.result.status,
      body: {
        ...resultBody,
        data: {
          ...(resultBody.data || {}),
          offlineOperationId: operationId,
          replayed: execution.replayed,
        },
        meta: {
          ...(resultBody.meta || {}),
          correlationId,
          operationId,
          replayed: execution.replayed,
        },
      },
    };
  }

  return undefined;
}

async function routePlanning(req: IncomingMessage, deps: ApiDependencies, correlationId: string): Promise<ApiResponse | undefined> {
  const route = parts(req); if (route[0] !== 'api' || route[1] !== 'v1' || route[2] !== 'inspection-route-plans' || !route[3] || !route[4] || req.method !== 'POST') return undefined; const agency = agencyId(req); const action = route[4]; const capability: SecurityCapability = action === 'publish' ? 'job.plan.publish' : 'job.plan'; const principal = await authorise(req, deps, capability, agency, correlationId); const plan = await deps.repository.get('inspectionRoutePlans', agency, route[3]); if (!plan) throw new ApiError(404, 'ROUTE_PLAN_NOT_FOUND', 'Inspection route plan was not found.'); const body = await readJson(req);
  if (action === 'optimise') { const original = Array.isArray(plan.stops) ? plan.stops.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object')) : []; if (original.length < 2) return { status: 200, body: { data: plan, meta: { correlationId } } }; const remaining = [...original]; const ordered: Record<string, unknown>[] = [remaining.shift()!]; const travel: Array<Record<string, unknown>> = []; while (remaining.length) { const current = ordered[ordered.length - 1]; let bestIndex = 0; let bestDistance = Number.MAX_SAFE_INTEGER; remaining.forEach((candidate, index) => { const distance = haversine({ latitude: num(current.latitude), longitude: num(current.longitude) }, { latitude: num(candidate.latitude), longitude: num(candidate.longitude) }); if (distance < bestDistance) { bestDistance = distance; bestIndex = index; } }); const next = remaining.splice(bestIndex, 1)[0]; travel.push({ fromStopId: current.id, toStopId: next.id, distanceMetres: Math.round(bestDistance === Number.MAX_SAFE_INTEGER / 4 ? 0 : bestDistance), durationSeconds: Math.round(bestDistance === Number.MAX_SAFE_INTEGER / 4 ? 0 : bestDistance / 13.9) }); ordered.push(next); } const updated = await deps.repository.update('inspectionRoutePlans', agency, plan.id, { stops: ordered, travel, status: 'proposed', optimisationProvider: 'proinspect-nearest-neighbour-v1', totalDistanceMetres: travel.reduce((sum, item) => sum + Number(item.distanceMetres || 0), 0), totalTravelSeconds: travel.reduce((sum, item) => sum + Number(item.durationSeconds || 0), 0) }, Number(plan.version), principal.uid); return { status: 200, body: { data: updated, meta: { correlationId } } }; }
  if (action === 'publish') { const stops = Array.isArray(plan.stops) ? plan.stops.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object')) : []; for (const stop of stops) { const jobId = String(stop.inspectionJobId || ''); if (!jobId) continue; const job = await deps.repository.get('inspectionJobs', agency, jobId); if (!job) continue; await deps.repository.update('inspectionJobs', agency, jobId, { requestedStartAt: stop.scheduledStartAt, requestedEndAt: stop.scheduledEndAt, assignedInspectorId: plan.inspectorId, routePlanId: plan.id, bookingStatus: 'booked' }, Number(job.version), principal.uid); } const updated = await deps.repository.update('inspectionRoutePlans', agency, plan.id, { status: 'published', publishedAt: new Date().toISOString(), publishedBy: principal.uid }, expected(body), principal.uid); return { status: 200, body: { data: updated, meta: { correlationId, jobsUpdated: stops.length } } }; }
  return undefined;
}

async function routePmsSync(req: IncomingMessage, deps: ApiDependencies, correlationId: string): Promise<ApiResponse | undefined> {
  const route = parts(req); if (route[0] !== 'api' || route[1] !== 'v1' || route[2] !== 'pms-connections' || !route[3] || route[4] !== 'sync' || req.method !== 'POST') return undefined; const agency = agencyId(req); const principal = await authorise(req, deps, 'integration.sync', agency, correlationId); const connection = await deps.repository.get('pmsConnections', agency, route[3]); if (!connection) throw new ApiError(404, 'PMS_CONNECTION_NOT_FOUND', 'PMS connection was not found.'); const body = await readJson(req); const direction = String(body.direction || ''); const resource = String(body.resource || ''); if (!['import', 'publish'].includes(direction) || !resource) throw new ApiError(400, 'SYNC_FIELDS_REQUIRED', 'direction and resource are required.'); const forbidden = ['transactions', 'payments', 'receipts', 'trust_ledger', 'rent_ledger', 'bank_accounts', 'disbursements', 'reconciliations']; if (forbidden.includes(resource)) throw new ApiError(409, 'FINANCIAL_BOUNDARY', `${resource} is outside the ProInspect licensing boundary.`); const syncRunId = randomUUID(); const run = await deps.repository.create('integrationSyncRuns', agency, syncRunId, { connectionId: connection.id, direction, resource, status: 'queued', processed: 0, failed: 0, entityId: body.entityId }, principal.uid); await deps.tasks.dispatch('integration', agency, `integration-${syncRunId}`, { connectionId: connection.id, syncRunId, direction, resource, entityId: body.entityId }); return { status: 202, body: { data: run, meta: { correlationId } } };
}

async function routeComplianceAssessment(req: IncomingMessage, deps: ApiDependencies, correlationId: string): Promise<ApiResponse | undefined> { const route = parts(req); if (route[0] !== 'api' || route[1] !== 'v1' || route[2] !== 'compliance-assessments' || !route[3] || !route[4] || req.method !== 'GET') return undefined; const agency = agencyId(req); await authorise(req, deps, 'compliance.read', agency, correlationId); const [entityType, entityId] = [route[3], route[4]]; const obligations = (await listAll(deps, 'complianceObligations', agency)).filter((item) => item.entityType === entityType && item.entityId === entityId); const now = Date.now(); const normalized = obligations.map((item) => ({ ...item, effectiveStatus: item.status === 'open' && item.dueAt && Date.parse(String(item.dueAt)) < now ? 'overdue' : item.status })); return { status: 200, body: { data: { evaluatedAt: new Date().toISOString(), entityType, entityId, open: normalized.filter((item) => item.effectiveStatus === 'open').length, overdue: normalized.filter((item) => item.effectiveStatus === 'overdue').length, critical: normalized.filter((item) => item.effectiveStatus === 'overdue' && (item as Record<string, unknown>).severity === 'critical').length, obligations: normalized }, meta: { correlationId } } }; }

async function routeCommunicationSend(req: IncomingMessage, deps: ApiDependencies, correlationId: string): Promise<ApiResponse | undefined> { const route = parts(req); if (route[0] !== 'api' || route[1] !== 'v1' || route[2] !== 'communication-threads' || !route[3] || route[4] !== 'messages' || req.method !== 'POST') return undefined; const agency = agencyId(req); const principal = await authorise(req, deps, 'communication.send', agency, correlationId); const thread = await deps.repository.get('communicationThreads', agency, route[3]); if (!thread) throw new ApiError(404, 'COMMUNICATION_THREAD_NOT_FOUND', 'Communication thread was not found.'); const body = await readJson(req); const recipients = Array.isArray(body.recipients) ? body.recipients.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []; const channel = String(body.channel || 'email'); if (!['email', 'sms', 'portal'].includes(channel) || !recipients.length || !String(body.body || '').trim()) throw new ApiError(400, 'MESSAGE_FIELDS_REQUIRED', 'channel, recipients and body are required.'); const messageId = randomUUID(); const message = await deps.repository.create('communicationMessages', agency, messageId, { threadId: thread.id, channel, direction: 'outbound', senderParticipantId: principal.uid, recipientParticipantIds: recipients, subject: body.subject, body: body.body, status: 'queued' }, principal.uid); for (const recipient of recipients) { const taskId = `communication-${messageId}-${sha(recipient).slice(0, 12)}`; await deps.tasks.dispatch('notification', agency, taskId, { channel, recipient, subject: body.subject, message: body.body, communicationId: messageId }); } await deps.repository.update('communicationThreads', agency, thread.id, { lastMessageAt: new Date().toISOString() }, Number(thread.version), principal.uid); return { status: 201, body: { data: message, meta: { correlationId } } }; }

async function routeKeyEvents(req: IncomingMessage, deps: ApiDependencies, correlationId: string): Promise<ApiResponse | undefined> { const route = parts(req); if (route[0] !== 'api' || route[1] !== 'v1' || route[2] !== 'key-register' || !route[3] || route[4] !== 'events' || req.method !== 'POST') return undefined; const agency = agencyId(req); const principal = await authorise(req, deps, 'key.manage', agency, correlationId); const body = await readJson(req); const item = await deps.repository.get('accessDeviceRegister', agency, route[3]); if (!item) throw new ApiError(404, 'ACCESS_DEVICE_NOT_FOUND', 'Access device was not found.'); const eventType = String(body.eventType || ''); if (!['checked_out', 'transferred', 'returned', 'lost', 'replaced', 'deactivated'].includes(eventType)) throw new ApiError(400, 'KEY_EVENT_INVALID', 'Unsupported key custody event.'); const event = await deps.repository.create('accessDeviceCustodyEvents', agency, randomUUID(), { accessDeviceId: item.id, propertyId: item.propertyId, inspectionJobId: body.inspectionJobId, eventType, fromHolderId: item.currentHolderId, toHolderId: body.toHolderId, notes: body.notes, occurredAt: new Date().toISOString(), actorId: principal.uid }, principal.uid); const status = eventType === 'returned' ? 'available' : eventType === 'lost' ? 'lost' : eventType === 'replaced' ? 'replaced' : eventType === 'deactivated' ? 'deactivated' : 'checked_out'; const updated = await deps.repository.update('accessDeviceRegister', agency, item.id, { status, currentHolderId: eventType === 'returned' ? null : body.toHolderId || item.currentHolderId, currentInspectionJobId: eventType === 'returned' ? null : body.inspectionJobId || item.currentInspectionJobId, lastEventAt: new Date().toISOString() }, Number(item.version), principal.uid); return { status: 201, body: { data: { item: updated, event }, meta: { correlationId } } }; }

export async function routePlatformEnhancementRequest(req: IncomingMessage, deps: ApiDependencies, correlationId: string): Promise<ApiResponse | undefined> {
  const handlers = [routeDocumentPackets, routeOffline, routePlanning, routePmsSync, routeComplianceAssessment, routeCommunicationSend, routeKeyEvents] as const; for (const handler of handlers) { const response = await handler(req, deps, correlationId); if (response) return response; }
  const specs = [
    { segment: 'jurisdiction-policies', collection: 'jurisdictionPolicyVersions', read: 'document.policy.read', write: 'document.policy.manage' }, { segment: 'document-template-versions', collection: 'documentTemplateVersions', read: 'document.policy.read', write: 'document.policy.manage' }, { segment: 'esign-envelopes', collection: 'esignEnvelopes', read: 'document.packet.read', write: 'document.sign.manage' },
    { segment: 'communication-threads', collection: 'communicationThreads', read: 'communication.read', write: 'communication.manage' }, { segment: 'communication-messages', collection: 'communicationMessages', read: 'communication.read', write: 'communication.send' }, { segment: 'compliance-rules', collection: 'complianceRuleVersions', read: 'compliance.read', write: 'compliance.rule.manage' }, { segment: 'compliance-obligations', collection: 'complianceObligations', read: 'compliance.read', write: 'compliance.manage' },
    { segment: 'inspection-route-plans', collection: 'inspectionRoutePlans', read: 'job.read', write: 'job.plan' }, { segment: 'key-register', collection: 'accessDeviceRegister', read: 'key.read', write: 'key.manage' }, { segment: 'key-custody-events', collection: 'accessDeviceCustodyEvents', read: 'key.read', write: 'key.manage' },
    { segment: 'pms-connections', collection: 'pmsConnections', read: 'integration.read', write: 'integration.manage' }, { segment: 'integration-sync-runs', collection: 'integrationSyncRuns', read: 'integration.read', write: 'integration.sync' }, { segment: 'external-references', collection: 'externalReferences', read: 'integration.read', write: 'integration.sync' },
    { segment: 'remote-inspection-assignments', collection: 'remoteInspectionAssignments', read: 'job.read', write: 'job.remote.manage' }, { segment: 'remote-inspection-submissions', collection: 'remoteInspectionSubmissions', read: 'job.read', write: 'job.remote.manage' }, { segment: 'service-records', collection: 'serviceRecords', read: 'document.packet.read', write: 'service_record.manage' },
  ] as const;
  for (const spec of specs) { const response = await collectionCrud(req, deps, correlationId, spec); if (response) return response; }
  return undefined;
}
