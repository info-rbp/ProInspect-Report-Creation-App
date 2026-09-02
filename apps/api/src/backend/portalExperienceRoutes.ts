import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { AuthenticatedPrincipal, AuthorisationTarget, SecurityCapability, SecurityRole } from '@pcr/domain';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies, IdempotencyResult, StoredRecord } from './types.js';

const RESIDENT_ROLES = new Set<SecurityRole>(['resident_owner', 'resident_tenant', 'tenant']);
const CONTRACTOR_ROLES = new Set<SecurityRole>(['contractor_admin', 'contractor_worker']);
const SITE_ROLES = new Set<SecurityRole>(['building_manager', 'relief_building_manager', 'strata_manager', 'council_member']);
const INTERNAL_ROLES = new Set<SecurityRole>(['super_admin', 'proinspect_admin', 'operations']);

function parts(req: IncomingMessage): string[] { return new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean); }
function agencyId(req: IncomingMessage): string { const value = req.headers['x-agency-id']?.toString().trim(); if (!value) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.'); return value; }
function url(req: IncomingMessage): URL { return new URL(req.url ?? '/', 'http://localhost'); }
function requiredParam(req: IncomingMessage, key: string): string { const value = url(req).searchParams.get(key)?.trim(); if (!value) throw new ApiError(400, `${key.toUpperCase()}_REQUIRED`, `${key} is required.`); return value; }
async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> { const chunks: Buffer[] = []; let bytes = 0; for await (const chunk of req) { const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); bytes += value.length; if (bytes > 1_000_000) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 1 MB.'); chunks.push(value); } if (!chunks.length) return {}; try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required'); return value as Record<string, unknown>; } catch { throw new ApiError(400, 'INVALID_JSON', 'Request body must be a JSON object.'); } }
function idempotencyKey(req: IncomingMessage): string { const value = req.headers['idempotency-key']?.toString().trim(); if (!value || value.length < 8 || value.length > 200) throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key is required.'); return value; }
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
async function idempotent(deps: ApiDependencies, req: IncomingMessage, agency: string, operation: string, body: Record<string, unknown>, action: () => Promise<IdempotencyResult>): Promise<ApiResponse> { const result = await deps.idempotency.execute(agency, operation, idempotencyKey(req), hash(body), action); return { status: result.result.status, body: result.result.body, headers: { 'idempotency-replayed': String(result.replayed) } }; }
async function list(deps: ApiDependencies, collection: string, agency: string, filters: Record<string, string | number | boolean> = {}, limit = 100): Promise<StoredRecord[]> { return (await deps.repository.list(collection, agency, limit, undefined, filters)).items; }
function target(agency: string, fields: Partial<AuthorisationTarget> = {}): AuthorisationTarget { return { agencyId: agency, ...fields }; }
async function audit(deps: ApiDependencies, principal: AuthenticatedPrincipal, capability: SecurityCapability, eventType: string, entityType: string, entityId: string, correlationId: string, eventTarget: AuthorisationTarget): Promise<void> { await deps.audit.append({ id: randomUUID(), timestamp: new Date().toISOString(), actorId: principal.uid, actorRole: principal.role, agencyId: principal.agencyId, capability, outcome: 'allowed', reason: eventType, target: eventTarget, correlationId, eventType, entityType, entityId }); }
function assertRole(principal: AuthenticatedPrincipal, roles: Set<SecurityRole>, message: string): void { if (!roles.has(principal.role) && !INTERNAL_ROLES.has(principal.role)) throw new ApiError(403, 'PORTAL_ROLE_REQUIRED', message); }
function assertSite(principal: AuthenticatedPrincipal, site: string): void { if (!INTERNAL_ROLES.has(principal.role) && !principal.siteIds?.includes(site)) throw new ApiError(403, 'MANAGED_SITE_SCOPE_REQUIRED', 'The selected site is not assigned to this account.'); }

async function residentPrincipal(req: IncomingMessage, deps: ApiDependencies, correlationId: string, agency: string, site: string): Promise<AuthenticatedPrincipal> { const principal = await authenticateAndAuthorise(req, deps, 'portal.switch', target(agency, { managedSiteId: site }), correlationId); assertRole(principal, RESIDENT_ROLES, 'A resident portal role is required.'); assertSite(principal, site); return principal; }
async function contractorPrincipal(req: IncomingMessage, deps: ApiDependencies, correlationId: string, agency: string, site: string): Promise<AuthenticatedPrincipal> { const principal = await authenticateAndAuthorise(req, deps, 'portal.switch', target(agency, { managedSiteId: site }), correlationId); assertRole(principal, CONTRACTOR_ROLES, 'A contractor portal role is required.'); assertSite(principal, site); if (!principal.contractorId) throw new ApiError(403, 'CONTRACTOR_SCOPE_REQUIRED', 'No contractor profile is assigned to this account.'); return principal; }
async function sitePrincipal(req: IncomingMessage, deps: ApiDependencies, correlationId: string, agency: string, site: string): Promise<AuthenticatedPrincipal> { const principal = await authenticateAndAuthorise(req, deps, 'portal.switch', target(agency, { managedSiteId: site }), correlationId); assertRole(principal, SITE_ROLES, 'A Building Management or Strata role is required.'); assertSite(principal, site); return principal; }

async function residentConversationAccess(deps: ApiDependencies, agency: string, principal: AuthenticatedPrincipal, site: string, conversationId: string): Promise<StoredRecord> {
  const conversation = await deps.repository.get('conversations', agency, conversationId);
  if (!conversation || conversation.managedSiteId !== site) throw new ApiError(404, 'CONVERSATION_NOT_FOUND', 'Conversation was not found in this portal context.');
  const participants = await list(deps, 'conversationParticipants', agency, { participantId: principal.uid });
  const participant = participants.find((item) => item.conversationId === conversationId && item.participantType === 'user' && !item.leftAt);
  if (!participant) throw new ApiError(403, 'CONVERSATION_PARTICIPANT_REQUIRED', 'You are not a participant in this conversation.');
  return conversation;
}

async function residentConversations(req: IncomingMessage, deps: ApiDependencies, correlationId: string, route: string[]): Promise<ApiResponse> {
  const agency = agencyId(req); const site = requiredParam(req, 'managedSiteId'); const principal = await residentPrincipal(req, deps, correlationId, agency, site);
  const conversationId = route[5]; const nested = route[6];
  if (conversationId && nested === 'messages') {
    await residentConversationAccess(deps, agency, principal, site, conversationId);
    if (req.method === 'GET') return { status: 200, body: { data: await list(deps, 'conversationMessages', agency, { conversationId }), meta: { correlationId } } };
    if (req.method === 'POST') {
      const body = await readJson(req); const message = typeof body.body === 'string' ? body.body.trim() : ''; if (!message) throw new ApiError(400, 'MESSAGE_BODY_REQUIRED', 'Message body is required.');
      return idempotent(deps, req, agency, `portal:resident:conversation:${conversationId}:message`, body, async () => {
        const id = randomUUID(); const created = await deps.repository.create('conversationMessages', agency, id, { conversationId, senderType: 'user', senderId: principal.uid, channel: 'portal', body: message, attachmentFileIds: '[]', deliveryStatus: 'created', sentAt: new Date().toISOString(), status: 'active' }, principal.uid);
        await audit(deps, principal, 'communication.send', 'portal.resident.message.created', 'conversation_message', id, correlationId, target(agency, { managedSiteId: site, residentUserId: principal.uid }));
        return { status: 201, body: { data: created, meta: { correlationId } } };
      });
    }
  }
  if (req.method === 'GET' && !conversationId) {
    const participants = await list(deps, 'conversationParticipants', agency, { participantId: principal.uid });
    const rows: StoredRecord[] = [];
    for (const participant of participants.filter((item) => item.participantType === 'user' && !item.leftAt)) { const conversation = await deps.repository.get('conversations', agency, String(participant.conversationId ?? '')); if (conversation?.managedSiteId === site) rows.push(conversation); }
    return { status: 200, body: { data: rows, meta: { correlationId } } };
  }
  if (req.method === 'POST' && !conversationId) {
    const body = await readJson(req); const subject = typeof body.subject === 'string' ? body.subject.trim() : ''; const linkedEntityType = typeof body.linkedEntityType === 'string' ? body.linkedEntityType.trim() : ''; const linkedEntityId = typeof body.linkedEntityId === 'string' ? body.linkedEntityId.trim() : ''; if (!subject || !linkedEntityType || !linkedEntityId) throw new ApiError(400, 'CONVERSATION_DETAILS_REQUIRED', 'subject, linkedEntityType and linkedEntityId are required.');
    return idempotent(deps, req, agency, 'portal:resident:conversation:create', body, async () => {
      const id = randomUUID(); const created = await deps.repository.create('conversations', agency, id, { subject, linkedEntityType, linkedEntityId, managedSiteId: site, ...(typeof body.propertyId === 'string' && principal.propertyIds?.includes(body.propertyId) ? { propertyId: body.propertyId } : {}), conversationState: 'open', lastMessageAt: new Date().toISOString(), status: 'active' }, principal.uid);
      await deps.repository.create('conversationParticipants', agency, randomUUID(), { conversationId: id, participantType: 'user', participantId: principal.uid, role: principal.role, joinedAt: new Date().toISOString(), canReply: true, status: 'active' }, principal.uid);
      await audit(deps, principal, 'communication.send', 'portal.resident.conversation.created', 'conversation', id, correlationId, target(agency, { managedSiteId: site, residentUserId: principal.uid }));
      return { status: 201, body: { data: created, meta: { correlationId } } };
    });
  }
  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method is not supported for resident conversations.');
}

async function contractorExtras(req: IncomingMessage, deps: ApiDependencies, correlationId: string, resource: string): Promise<ApiResponse> {
  const agency = agencyId(req); const site = requiredParam(req, 'managedSiteId'); const principal = await contractorPrincipal(req, deps, correlationId, agency, site); const contractorId = principal.contractorId as string;
  if (resource === 'site-access' && req.method === 'GET') {
    const settings = await list(deps, 'propertyOperatingSettings', agency, { managedSiteId: site });
    const keys = (await list(deps, 'keyRegister', agency, { managedSiteId: site })).filter((item) => item.currentHolderId === contractorId || (item.currentHolderType === 'contractor' && item.currentHolderName));
    return { status: 200, body: { data: [...settings.map((item) => ({ ...item, portalRecordType: 'site_settings' })), ...keys.map((item) => ({ ...item, portalRecordType: 'held_key' }))], meta: { correlationId } } };
  }
  if (resource === 'notifications' && req.method === 'GET') {
    const rows = await list(deps, 'notifications', agency, { userId: principal.uid });
    return { status: 200, body: { data: rows.filter((item) => !item.managedSiteId || item.managedSiteId === site), meta: { correlationId } } };
  }
  throw new ApiError(404, 'PORTAL_RESOURCE_NOT_FOUND', 'Contractor experience resource not found.');
}

async function siteContractors(req: IncomingMessage, deps: ApiDependencies, correlationId: string): Promise<ApiResponse> {
  const agency = agencyId(req); const site = requiredParam(req, 'managedSiteId'); await sitePrincipal(req, deps, correlationId, agency, site);
  const [attendance, workOrders, contractors] = await Promise.all([list(deps, 'contractorAttendance', agency, { managedSiteId: site }), list(deps, 'operationalWorkOrders', agency, { managedSiteId: site }), list(deps, 'contractors', agency)]);
  const relevant = new Set<string>([...attendance.map((item) => String(item.contractorId ?? '')), ...workOrders.map((item) => String(item.contractorId ?? item.assignedContractorId ?? ''))].filter(Boolean));
  const rows = contractors.filter((item) => {
    if (relevant.has(item.id)) return true;
    const covered = item.sitesCovered;
    if (Array.isArray(covered)) return covered.map(String).includes(site);
    if (typeof covered === 'string') { try { const values = JSON.parse(covered) as unknown; return Array.isArray(values) && values.map(String).includes(site); } catch { return covered.split(',').map((value) => value.trim()).includes(site); } }
    return false;
  });
  return { status: 200, body: { data: rows, meta: { correlationId } } };
}

async function clientPropertyIds(deps: ApiDependencies, agency: string, clientId: string): Promise<Set<string>> {
  const relationships = await list(deps, 'propertyClientRelationships', agency);
  return new Set(relationships.filter((item) => (item.clientId === clientId || item.clientAccountId === clientId) && item.status !== 'ended' && item.isCurrent !== false).map((item) => String(item.propertyId ?? '')).filter(Boolean));
}
async function clientPrincipal(req: IncomingMessage, deps: ApiDependencies, correlationId: string, agency: string, clientId: string): Promise<AuthenticatedPrincipal> {
  const principal = await authenticateAndAuthorise(req, deps, 'client.portal.read', target(agency, { clientAccountId: clientId }), correlationId);
  await authenticateAndAuthorise(req, deps, 'communication.send', target(agency, { clientAccountId: clientId }), correlationId);
  return principal;
}

async function clientServiceRequests(req: IncomingMessage, deps: ApiDependencies, correlationId: string, clientId: string): Promise<ApiResponse> {
  const agency = agencyId(req); const principal = await clientPrincipal(req, deps, correlationId, agency, clientId);
  if (req.method === 'GET') return { status: 200, body: { data: (await list(deps, 'serviceRequests', agency)).filter((item) => item.clientId === clientId || item.clientAccountId === clientId), meta: { correlationId } } };
  if (req.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method is not supported.');
  const body = await readJson(req); const serviceDefinitionId = typeof body.serviceDefinitionId === 'string' ? body.serviceDefinitionId.trim() : ''; const propertyId = typeof body.propertyId === 'string' ? body.propertyId.trim() : ''; if (!serviceDefinitionId || !propertyId) throw new ApiError(400, 'SERVICE_REQUEST_DETAILS_REQUIRED', 'serviceDefinitionId and propertyId are required.'); const properties = await clientPropertyIds(deps, agency, clientId); if (!properties.has(propertyId)) throw new ApiError(403, 'CLIENT_PROPERTY_SCOPE_REQUIRED', 'The property is not assigned to this client account.');
  return idempotent(deps, req, agency, `portal:client:${clientId}:service-request`, body, async () => {
    const id = randomUUID(); const created = await deps.repository.create('serviceRequests', agency, id, { clientId, propertyId, serviceDefinitionId, source: 'client_portal', sourceReference: `client_portal:${id}`, requestedByUserId: principal.uid, paymentStatus: 'pending', schedulingStatus: 'requested', priority: typeof body.priority === 'string' ? body.priority : 'normal', requestedDate: new Date().toISOString(), ...(typeof body.notes === 'string' ? { notes: body.notes.trim() } : {}), ...(typeof body.accessInstructions === 'string' ? { accessInstructions: body.accessInstructions.trim() } : {}), status: 'requested' }, principal.uid);
    await audit(deps, principal, 'communication.send', 'portal.client.service_request.created', 'service_request', id, correlationId, target(agency, { clientAccountId: clientId, propertyId }));
    return { status: 201, body: { data: created, meta: { correlationId } } };
  });
}

async function clientBookings(req: IncomingMessage, deps: ApiDependencies, correlationId: string, clientId: string): Promise<ApiResponse> {
  const agency = agencyId(req); const principal = await clientPrincipal(req, deps, correlationId, agency, clientId);
  if (req.method === 'GET') return { status: 200, body: { data: await list(deps, 'appointmentBookings', agency, { clientAccountId: clientId }), meta: { correlationId } } };
  if (req.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method is not supported.');
  const body = await readJson(req); const propertyId = typeof body.propertyId === 'string' ? body.propertyId.trim() : ''; const startAt = typeof body.startAt === 'string' ? body.startAt : ''; const endAt = typeof body.endAt === 'string' ? body.endAt : ''; if (!propertyId || !startAt || !endAt) throw new ApiError(400, 'BOOKING_DETAILS_REQUIRED', 'propertyId, startAt and endAt are required.'); const properties = await clientPropertyIds(deps, agency, clientId); if (!properties.has(propertyId)) throw new ApiError(403, 'CLIENT_PROPERTY_SCOPE_REQUIRED', 'The property is not assigned to this client account.');
  return idempotent(deps, req, agency, `portal:client:${clientId}:booking`, body, async () => {
    const id = randomUUID(); const created = await deps.repository.create('appointmentBookings', agency, id, { clientAccountId: clientId, propertyId, requestedByUserId: principal.uid, ...(typeof body.serviceRequestId === 'string' ? { serviceRequestId: body.serviceRequestId } : {}), startAt, endAt, bookingState: 'requested', ...(typeof body.accessInstructions === 'string' ? { accessInstructions: body.accessInstructions.trim() } : {}), status: 'active' }, principal.uid);
    await audit(deps, principal, 'communication.send', 'portal.client.booking.created', 'appointment_booking', id, correlationId, target(agency, { clientAccountId: clientId, propertyId }));
    return { status: 201, body: { data: created, meta: { correlationId } } };
  });
}

async function clientConversations(req: IncomingMessage, deps: ApiDependencies, correlationId: string, clientId: string, route: string[]): Promise<ApiResponse> {
  const agency = agencyId(req); const principal = await clientPrincipal(req, deps, correlationId, agency, clientId); const conversationId = route[5]; const nested = route[6];
  if (conversationId && nested === 'messages') {
    const conversation = await deps.repository.get('conversations', agency, conversationId); if (!conversation || conversation.clientAccountId !== clientId) throw new ApiError(404, 'CONVERSATION_NOT_FOUND', 'Conversation was not found for this client.'); await authenticateAndAuthorise(req, deps, 'client.portal.read', target(agency, { clientAccountId: clientId, ...(typeof conversation.propertyId === 'string' ? { propertyId: conversation.propertyId } : {}) }), correlationId);
    if (req.method === 'GET') return { status: 200, body: { data: await list(deps, 'conversationMessages', agency, { conversationId }), meta: { correlationId } } };
    if (req.method === 'POST') { const body = await readJson(req); const message = typeof body.body === 'string' ? body.body.trim() : ''; if (!message) throw new ApiError(400, 'MESSAGE_BODY_REQUIRED', 'Message body is required.'); return idempotent(deps, req, agency, `portal:client:${clientId}:conversation:${conversationId}:message`, body, async () => { const id = randomUUID(); const created = await deps.repository.create('conversationMessages', agency, id, { conversationId, senderType: 'user', senderId: principal.uid, channel: 'portal', body: message, attachmentFileIds: '[]', deliveryStatus: 'created', sentAt: new Date().toISOString(), status: 'active' }, principal.uid); await audit(deps, principal, 'communication.send', 'portal.client.message.created', 'conversation_message', id, correlationId, target(agency, { clientAccountId: clientId })); return { status: 201, body: { data: created, meta: { correlationId } } }; }); }
  }
  if (req.method === 'GET' && !conversationId) return { status: 200, body: { data: await list(deps, 'conversations', agency, { clientAccountId: clientId }), meta: { correlationId } } };
  if (req.method === 'POST' && !conversationId) {
    const body = await readJson(req); const subject = typeof body.subject === 'string' ? body.subject.trim() : ''; const linkedEntityType = typeof body.linkedEntityType === 'string' ? body.linkedEntityType.trim() : ''; const linkedEntityId = typeof body.linkedEntityId === 'string' ? body.linkedEntityId.trim() : ''; if (!subject || !linkedEntityType || !linkedEntityId) throw new ApiError(400, 'CONVERSATION_DETAILS_REQUIRED', 'subject, linkedEntityType and linkedEntityId are required.'); const propertyId = typeof body.propertyId === 'string' ? body.propertyId.trim() : undefined; if (propertyId && !(await clientPropertyIds(deps, agency, clientId)).has(propertyId)) throw new ApiError(403, 'CLIENT_PROPERTY_SCOPE_REQUIRED', 'The property is not assigned to this client account.');
    return idempotent(deps, req, agency, `portal:client:${clientId}:conversation:create`, body, async () => { const id = randomUUID(); const created = await deps.repository.create('conversations', agency, id, { clientAccountId: clientId, subject, linkedEntityType, linkedEntityId, ...(propertyId ? { propertyId } : {}), conversationState: 'open', lastMessageAt: new Date().toISOString(), status: 'active' }, principal.uid); await deps.repository.create('conversationParticipants', agency, randomUUID(), { conversationId: id, participantType: 'user', participantId: principal.uid, role: principal.role, joinedAt: new Date().toISOString(), canReply: true, status: 'active' }, principal.uid); await audit(deps, principal, 'communication.send', 'portal.client.conversation.created', 'conversation', id, correlationId, target(agency, { clientAccountId: clientId, ...(propertyId ? { propertyId } : {}) })); return { status: 201, body: { data: created, meta: { correlationId } } }; });
  }
  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method is not supported for client conversations.');
}

async function adminServiceRequests(req: IncomingMessage, deps: ApiDependencies, correlationId: string): Promise<ApiResponse> {
  const agency = agencyId(req); await authenticateAndAuthorise(req, deps, 'client.read', { agencyId: agency }, correlationId); if (req.method !== 'GET') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Admin service requests are created through intake workflows.'); return { status: 200, body: { data: await list(deps, 'serviceRequests', agency), meta: { correlationId } } };
}

export async function routePortalExperienceRequest(req: IncomingMessage, deps: ApiDependencies, correlationId: string): Promise<ApiResponse | undefined> {
  const route = parts(req);
  if (route[0] !== 'api' || route[1] !== 'v1' || route[2] !== 'portal-experience') return undefined;
  const audience = route[3]; const resource = route[4];
  if (audience === 'resident' && resource === 'conversations') return residentConversations(req, deps, correlationId, route);
  if (audience === 'contractor' && resource) return contractorExtras(req, deps, correlationId, resource);
  if (audience === 'site' && resource === 'contractors' && req.method === 'GET') return siteContractors(req, deps, correlationId);
  if (audience === 'client' && route[4]) {
    const clientId = route[4]; const subresource = route[5];
    if (subresource === 'service-requests') return clientServiceRequests(req, deps, correlationId, clientId);
    if (subresource === 'bookings') return clientBookings(req, deps, correlationId, clientId);
    if (subresource === 'conversations') return clientConversations(req, deps, correlationId, clientId, route.slice(0, 5).concat(route.slice(5)));
  }
  if (audience === 'admin' && resource === 'service-requests') return adminServiceRequests(req, deps, correlationId);
  return undefined;
}
