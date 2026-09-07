import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { AuthenticatedPrincipal, AuthorisationTarget, SecurityCapability } from '@pcr/domain';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies, IdempotencyResult, StoredRecord } from './types.js';

function parts(req: IncomingMessage): string[] { return new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean); }
function agencyId(req: IncomingMessage): string { const value = req.headers['x-agency-id']?.toString().trim(); if (!value) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.'); return value; }
async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> { const chunks: Buffer[] = []; let bytes = 0; for await (const chunk of req) { const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); bytes += value.length; if (bytes > 1_000_000) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 1 MB.'); chunks.push(value); } if (!chunks.length) return {}; try { const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required'); return parsed as Record<string, unknown>; } catch { throw new ApiError(400, 'INVALID_JSON', 'Request body must be a JSON object.'); } }
function idempotencyKey(req: IncomingMessage): string { const value = req.headers['idempotency-key']?.toString().trim(); if (!value || value.length < 8 || value.length > 200) throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key is required.'); return value; }
function payloadHash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
async function idempotent(deps: ApiDependencies, req: IncomingMessage, agency: string, operation: string, body: Record<string, unknown>, action: () => Promise<IdempotencyResult>): Promise<ApiResponse> { const execution = await deps.idempotency.execute(agency, operation, idempotencyKey(req), payloadHash(body), action); return { status: execution.result.status, body: execution.result.body, headers: { 'idempotency-replayed': String(execution.replayed) } }; }
async function list(deps: ApiDependencies, collection: string, agency: string, filters: Record<string, string | number | boolean> = {}, limit = 100): Promise<StoredRecord[]> { return (await deps.repository.list(collection, agency, limit, undefined, filters)).items; }
function target(agency: string, clientAccountId: string, propertyId?: string): AuthorisationTarget { return { agencyId: agency, clientAccountId, ...(propertyId ? { propertyId } : {}) }; }
async function appendAudit(deps: ApiDependencies, principal: AuthenticatedPrincipal, capability: SecurityCapability, eventType: string, entityType: string, entityId: string, correlationId: string, eventTarget: AuthorisationTarget): Promise<void> { await deps.audit.append({ id: randomUUID(), timestamp: new Date().toISOString(), actorId: principal.uid, actorRole: principal.role, agencyId: principal.agencyId, capability, outcome: 'allowed', reason: eventType, target: eventTarget, correlationId, eventType, entityType, entityId }); }

async function principalFor(req: IncomingMessage, deps: ApiDependencies, correlationId: string, agency: string, clientAccountId: string, propertyId?: string): Promise<AuthenticatedPrincipal> {
  const principal = await authenticateAndAuthorise(req, deps, 'client.portal.read', target(agency, clientAccountId, propertyId), correlationId);
  if (req.method !== 'GET') await authenticateAndAuthorise(req, deps, 'communication.send', target(agency, clientAccountId, propertyId), correlationId);
  return principal;
}
async function propertyIds(deps: ApiDependencies, agency: string, clientAccountId: string): Promise<Set<string>> {
  const rows = await list(deps, 'propertyClientRelationships', agency);
  return new Set(rows.filter((item) => (item.clientId === clientAccountId || item.clientAccountId === clientAccountId) && item.isCurrent !== false && item.status !== 'ended').map((item) => String(item.propertyId ?? '')).filter(Boolean));
}
async function assertProperty(deps: ApiDependencies, agency: string, clientAccountId: string, propertyId: string): Promise<void> { if (!(await propertyIds(deps, agency, clientAccountId)).has(propertyId)) throw new ApiError(403, 'CLIENT_PROPERTY_SCOPE_REQUIRED', 'The selected property is not assigned to this client account.'); }

async function serviceRequests(req: IncomingMessage, deps: ApiDependencies, correlationId: string, clientAccountId: string): Promise<ApiResponse> {
  const agency = agencyId(req); const principal = await principalFor(req, deps, correlationId, agency, clientAccountId);
  if (req.method === 'GET') return { status: 200, body: { data: (await list(deps, 'serviceRequests', agency)).filter((item) => item.clientId === clientAccountId || item.clientAccountId === clientAccountId), meta: { correlationId } } };
  if (req.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method is not supported.');
  const body = await readJson(req); const serviceDefinitionId = typeof body.serviceDefinitionId === 'string' ? body.serviceDefinitionId.trim() : ''; const propertyId = typeof body.propertyId === 'string' ? body.propertyId.trim() : ''; if (!serviceDefinitionId || !propertyId) throw new ApiError(400, 'SERVICE_REQUEST_DETAILS_REQUIRED', 'serviceDefinitionId and propertyId are required.'); await assertProperty(deps, agency, clientAccountId, propertyId);
  return idempotent(deps, req, agency, `client-portal:${clientAccountId}:service-request`, body, async () => {
    const id = randomUUID(); const created = await deps.repository.create('serviceRequests', agency, id, { clientId: clientAccountId, propertyId, serviceDefinitionId, source: 'client_portal', sourceReference: `client_portal:${id}`, requestedByUserId: principal.uid, paymentStatus: 'pending', schedulingStatus: 'requested', priority: typeof body.priority === 'string' ? body.priority : 'normal', requestedDate: new Date().toISOString(), ...(typeof body.notes === 'string' ? { notes: body.notes.trim() } : {}), ...(typeof body.accessInstructions === 'string' ? { accessInstructions: body.accessInstructions.trim() } : {}), status: 'requested' }, principal.uid);
    await appendAudit(deps, principal, 'communication.send', 'client_portal.service_request.created', 'service_request', id, correlationId, target(agency, clientAccountId, propertyId));
    return { status: 201, body: { data: created, meta: { correlationId } } };
  });
}

async function bookings(req: IncomingMessage, deps: ApiDependencies, correlationId: string, clientAccountId: string): Promise<ApiResponse> {
  const agency = agencyId(req); const principal = await principalFor(req, deps, correlationId, agency, clientAccountId);
  if (req.method === 'GET') return { status: 200, body: { data: await list(deps, 'appointmentBookings', agency, { clientAccountId }), meta: { correlationId } } };
  if (req.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method is not supported.');
  const body = await readJson(req); const propertyId = typeof body.propertyId === 'string' ? body.propertyId.trim() : ''; const startAt = typeof body.startAt === 'string' ? body.startAt : ''; const endAt = typeof body.endAt === 'string' ? body.endAt : ''; if (!propertyId || !startAt || !endAt) throw new ApiError(400, 'BOOKING_DETAILS_REQUIRED', 'propertyId, startAt and endAt are required.'); await assertProperty(deps, agency, clientAccountId, propertyId);
  return idempotent(deps, req, agency, `client-portal:${clientAccountId}:booking`, body, async () => {
    const id = randomUUID(); const created = await deps.repository.create('appointmentBookings', agency, id, { clientAccountId, propertyId, requestedByUserId: principal.uid, ...(typeof body.serviceRequestId === 'string' ? { serviceRequestId: body.serviceRequestId } : {}), startAt, endAt, bookingState: 'requested', ...(typeof body.accessInstructions === 'string' ? { accessInstructions: body.accessInstructions.trim() } : {}), status: 'active' }, principal.uid);
    await appendAudit(deps, principal, 'communication.send', 'client_portal.booking.created', 'appointment_booking', id, correlationId, target(agency, clientAccountId, propertyId));
    return { status: 201, body: { data: created, meta: { correlationId } } };
  });
}

async function conversations(req: IncomingMessage, deps: ApiDependencies, correlationId: string, clientAccountId: string, conversationId?: string, nested?: string): Promise<ApiResponse> {
  const agency = agencyId(req); const principal = await principalFor(req, deps, correlationId, agency, clientAccountId);
  if (conversationId && nested === 'messages') {
    const conversation = await deps.repository.get('conversations', agency, conversationId); if (!conversation || conversation.clientAccountId !== clientAccountId) throw new ApiError(404, 'CONVERSATION_NOT_FOUND', 'Conversation was not found for this client.'); if (typeof conversation.propertyId === 'string') await assertProperty(deps, agency, clientAccountId, conversation.propertyId);
    if (req.method === 'GET') return { status: 200, body: { data: await list(deps, 'conversationMessages', agency, { conversationId }), meta: { correlationId } } };
    if (req.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method is not supported.'); const body = await readJson(req); const message = typeof body.body === 'string' ? body.body.trim() : ''; if (!message) throw new ApiError(400, 'MESSAGE_BODY_REQUIRED', 'Message body is required.');
    return idempotent(deps, req, agency, `client-portal:${clientAccountId}:conversation:${conversationId}:message`, body, async () => { const id = randomUUID(); const created = await deps.repository.create('conversationMessages', agency, id, { conversationId, senderType: 'user', senderId: principal.uid, channel: 'portal', body: message, attachmentFileIds: '[]', deliveryStatus: 'created', sentAt: new Date().toISOString(), status: 'active' }, principal.uid); const conversationPropertyId = typeof conversation.propertyId === 'string' ? conversation.propertyId : undefined; await appendAudit(deps, principal, 'communication.send', 'client_portal.message.created', 'conversation_message', id, correlationId, target(agency, clientAccountId, conversationPropertyId)); return { status: 201, body: { data: created, meta: { correlationId } } }; });
  }
  if (req.method === 'GET') return { status: 200, body: { data: await list(deps, 'conversations', agency, { clientAccountId }), meta: { correlationId } } };
  if (req.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method is not supported.'); const body = await readJson(req); const subject = typeof body.subject === 'string' ? body.subject.trim() : ''; const linkedEntityType = typeof body.linkedEntityType === 'string' ? body.linkedEntityType.trim() : ''; const linkedEntityId = typeof body.linkedEntityId === 'string' ? body.linkedEntityId.trim() : ''; const propertyId = typeof body.propertyId === 'string' ? body.propertyId.trim() : undefined; if (!subject || !linkedEntityType || !linkedEntityId) throw new ApiError(400, 'CONVERSATION_DETAILS_REQUIRED', 'subject, linkedEntityType and linkedEntityId are required.'); if (propertyId) await assertProperty(deps, agency, clientAccountId, propertyId);
  return idempotent(deps, req, agency, `client-portal:${clientAccountId}:conversation`, body, async () => { const id = randomUUID(); const created = await deps.repository.create('conversations', agency, id, { clientAccountId, subject, linkedEntityType, linkedEntityId, ...(propertyId ? { propertyId } : {}), conversationState: 'open', lastMessageAt: new Date().toISOString(), status: 'active' }, principal.uid); await deps.repository.create('conversationParticipants', agency, randomUUID(), { conversationId: id, participantType: 'user', participantId: principal.uid, role: principal.role, joinedAt: new Date().toISOString(), canReply: true, status: 'active' }, principal.uid); await appendAudit(deps, principal, 'communication.send', 'client_portal.conversation.created', 'conversation', id, correlationId, target(agency, clientAccountId, propertyId)); return { status: 201, body: { data: created, meta: { correlationId } } }; });
}

async function quoteDecision(req: IncomingMessage, deps: ApiDependencies, correlationId: string, clientAccountId: string, quoteId: string): Promise<ApiResponse> {
  const agency = agencyId(req); const principal = await principalFor(req, deps, correlationId, agency, clientAccountId); if (principal.role !== 'client_admin' && !['super_admin', 'proinspect_admin', 'operations'].includes(principal.role)) throw new ApiError(403, 'CLIENT_ADMIN_REQUIRED', 'Only a client administrator can make a quote decision from the persistent portal.');
  const quote = await deps.repository.get('maintenanceQuotes', agency, quoteId); if (!quote) throw new ApiError(404, 'QUOTE_NOT_FOUND', 'Quote was not found.'); const itemId = String(quote.maintenanceItemId ?? ''); const item = itemId ? await deps.repository.get('maintenanceItems', agency, itemId) : undefined; const propertyId = item && typeof item.propertyId === 'string' ? item.propertyId : undefined; if (!item || !propertyId) throw new ApiError(409, 'QUOTE_SCOPE_UNRESOLVED', 'The quote is not linked to a client property.'); await assertProperty(deps, agency, clientAccountId, propertyId);
  if (req.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method is not supported.'); const body = await readJson(req); const decision = typeof body.decision === 'string' ? body.decision : ''; if (!['approved', 'declined', 'more_information'].includes(decision)) throw new ApiError(400, 'DECISION_INVALID', 'decision must be approved, declined or more_information.');
  return idempotent(deps, req, agency, `client-portal:${clientAccountId}:quote:${quoteId}:decision`, body, async () => {
    const approvalId = randomUUID(); const approval = await deps.repository.create('maintenanceApprovals', agency, approvalId, { maintenanceItemId: itemId, quoteId, approvedBy: principal.uid, decision, ...(typeof body.reason === 'string' ? { reason: body.reason.trim() } : {}), decidedAt: new Date().toISOString(), status: 'recorded' }, principal.uid);
    await deps.repository.update('maintenanceQuotes', agency, quoteId, { approvalStatus: decision }, quote.version, principal.uid);
    await appendAudit(deps, principal, 'communication.send', 'client_portal.quote.decision', 'maintenance_quote', quoteId, correlationId, target(agency, clientAccountId, propertyId));
    return { status: 201, body: { data: approval, meta: { correlationId } } };
  });
}

export async function routeClientPortalActionRequest(req: IncomingMessage, deps: ApiDependencies, correlationId: string): Promise<ApiResponse | undefined> {
  const route = parts(req); if (route[0] !== 'api' || route[1] !== 'v1' || route[2] !== 'client-portal' || !route[3]) return undefined;
  const clientAccountId = route[3];
  if (route[4] === 'service-requests') return serviceRequests(req, deps, correlationId, clientAccountId);
  if (route[4] === 'bookings') return bookings(req, deps, correlationId, clientAccountId);
  if (route[4] === 'conversations') return conversations(req, deps, correlationId, clientAccountId, route[5], route[6]);
  if (route[4] === 'quotes' && route[5] && route[6] === 'decision') return quoteDecision(req, deps, correlationId, clientAccountId, route[5]);
  return undefined;
}
