import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { AuthorisationTarget, SecurityCapability, SecurityRole } from '@pcr/domain';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies, IdempotencyResult, StoredRecord } from './types.js';

interface PlatformResourcePolicy {
  collection: string;
  readCapability: SecurityCapability;
  createCapability?: SecurityCapability;
  writeCapability?: SecurityCapability;
  requiredScope?: 'site' | 'client' | 'contractor' | 'assignment' | 'self' | 'none';
  selfField?: string;
  queryFields?: readonly string[];
}

const POLICIES: Readonly<Record<string, PlatformResourcePolicy>> = {
  'portal-entitlements': { collection: 'portalEntitlements', readCapability: 'portal.switch', createCapability: 'user.scope.manage', writeCapability: 'user.scope.manage', requiredScope: 'self', selfField: 'userId', queryFields: ['userId', 'status'] },
  'contractor-compliance': { collection: 'contractorCompliance', readCapability: 'contractor.compliance.read', createCapability: 'contractor.compliance.manage', writeCapability: 'contractor.compliance.manage', requiredScope: 'contractor', queryFields: ['contractorId', 'status'] },
  'offer-partners': { collection: 'offerPartners', readCapability: 'offer.read', createCapability: 'offer.manage', writeCapability: 'offer.manage', requiredScope: 'none', queryFields: ['status'] },
  offers: { collection: 'offers', readCapability: 'offer.read', createCapability: 'offer.manage', writeCapability: 'offer.manage', requiredScope: 'none', queryFields: ['status'] },
  'offer-redemptions': { collection: 'offerRedemptions', readCapability: 'offer.read', createCapability: 'offer.redeem', writeCapability: 'offer.manage', requiredScope: 'site', selfField: 'userId', queryFields: ['managedSiteId', 'userId', 'offerId', 'status'] },
  conversations: { collection: 'conversations', readCapability: 'communication.read', createCapability: 'communication.send', writeCapability: 'communication.manage', requiredScope: 'none', queryFields: ['managedSiteId', 'clientAccountId', 'status'] },
  'notification-preferences': { collection: 'notificationPreferences', readCapability: 'communication.read', createCapability: 'communication.send', writeCapability: 'communication.send', requiredScope: 'self', selfField: 'userId', queryFields: ['userId', 'status'] },
  'appointment-availability': { collection: 'appointmentAvailability', readCapability: 'building_calendar.read', createCapability: 'building_calendar.manage', writeCapability: 'building_calendar.manage', requiredScope: 'site', queryFields: ['managedSiteId', 'status'] },
  'appointment-bookings': { collection: 'appointmentBookings', readCapability: 'communication.read', createCapability: 'communication.send', writeCapability: 'building_calendar.manage', requiredScope: 'site', selfField: 'requestedByUserId', queryFields: ['managedSiteId', 'requestedByUserId', 'assignedUserId', 'status'] },
  'route-plans': { collection: 'routePlans', readCapability: 'job.read', createCapability: 'job.plan', writeCapability: 'job.plan', requiredScope: 'assignment', selfField: 'assignedUserId', queryFields: ['assignedUserId', 'status'] },
  'offline-sync-receipts': { collection: 'offlineSyncReceipts', readCapability: 'job.offline.sync', createCapability: 'job.offline.sync', writeCapability: 'job.offline.sync', requiredScope: 'self', selfField: 'userId', queryFields: ['userId', 'status'] },
};

const SITE_PORTAL_ROLES = new Set<SecurityRole>([
  'building_manager', 'relief_building_manager', 'strata_manager', 'council_member',
  'resident_owner', 'resident_tenant', 'contractor_admin', 'contractor_worker',
]);
const USER_SELF_SERVICE_ROLES = new Set<SecurityRole>([
  'resident_owner', 'resident_tenant', 'tenant', 'client_user', 'landlord',
  'contractor_worker', 'contractor_admin', 'inspector',
]);
const PORTAL_SELF_RESOURCES = new Set(['portal-entitlements', 'notification-preferences', 'offline-sync-receipts']);
const RESIDENT_SELF_RESOURCES = new Set(['offer-redemptions', 'appointment-bookings']);

function shouldSelfScope(resource: string, role: SecurityRole): boolean {
  if (PORTAL_SELF_RESOURCES.has(resource)) return role !== 'super_admin' && role !== 'proinspect_admin';
  if (RESIDENT_SELF_RESOURCES.has(resource)) return USER_SELF_SERVICE_ROLES.has(role);
  if (resource === 'route-plans') return role === 'inspector';
  return false;
}

function pathParts(req: IncomingMessage): string[] { return new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean); }
function agencyHeader(req: IncomingMessage): string {
  const agencyId = req.headers['x-agency-id']?.toString().trim();
  if (!agencyId) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.');
  return agencyId;
}
async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += value.length;
    if (total > 1_000_000) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 1 MB.');
    chunks.push(value);
  }
  if (!chunks.length) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required');
    return parsed as Record<string, unknown>;
  } catch { throw new ApiError(400, 'INVALID_JSON', 'Request body must be a JSON object.'); }
}
function expectedVersion(body: Record<string, unknown>): number {
  if (typeof body.expectedVersion !== 'number' || !Number.isInteger(body.expectedVersion) || body.expectedVersion < 1) throw new ApiError(400, 'EXPECTED_VERSION_REQUIRED', 'expectedVersion must be a positive integer.');
  return body.expectedVersion;
}
function idempotencyKey(req: IncomingMessage): string {
  const value = req.headers['idempotency-key']?.toString().trim();
  if (!value || value.length < 8 || value.length > 200) throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key is required.');
  return value;
}
function hash(body: Record<string, unknown>): string { return createHash('sha256').update(JSON.stringify(body)).digest('hex'); }
async function idempotent(deps: ApiDependencies, req: IncomingMessage, agencyId: string, operation: string, body: Record<string, unknown>, action: () => Promise<IdempotencyResult>): Promise<ApiResponse> {
  const result = await deps.idempotency.execute(agencyId, operation, idempotencyKey(req), hash(body), action);
  return { status: result.result.status, body: result.result.body, headers: { 'idempotency-replayed': String(result.replayed) } };
}
function clean(body: Record<string, unknown>): Record<string, unknown> {
  const value = { ...body };
  for (const field of ['id', 'agencyId', 'version', 'expectedVersion', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy']) delete value[field];
  return value;
}
function target(value: Record<string, unknown>, agencyId: string): AuthorisationTarget {
  return {
    agencyId,
    ...(typeof value.managedSiteId === 'string' ? { managedSiteId: value.managedSiteId } : {}),
    ...(typeof value.propertyId === 'string' ? { propertyId: value.propertyId } : {}),
    ...(typeof value.clientAccountId === 'string' ? { clientAccountId: value.clientAccountId } : {}),
    ...(typeof value.userId === 'string' ? { residentUserId: value.userId } : {}),
    ...(typeof value.requestedByUserId === 'string' ? { residentUserId: value.requestedByUserId } : {}),
    ...(typeof value.contractorId === 'string' ? { contractorId: value.contractorId, assignedContractorId: value.contractorId } : {}),
    ...(typeof value.assignedUserId === 'string' ? { assignedInspectorId: value.assignedUserId } : {}),
    ...(typeof value.status === 'string' ? { lifecycleStatus: value.status } : {}),
  };
}
function allScopeValues(url: URL): Record<string, string> {
  const keys = ['managedSiteId', 'propertyId', 'clientAccountId', 'contractorId', 'assignedUserId', 'userId', 'offerId', 'status'];
  return Object.fromEntries(keys.flatMap((key) => {
    const value = url.searchParams.get(key)?.trim();
    return value ? [[key, value]] : [];
  }));
}
function queryFilters(policy: PlatformResourcePolicy, values: Record<string, string>): Record<string, string> {
  const allowed = new Set(policy.queryFields ?? []);
  return Object.fromEntries(Object.entries(values).filter(([key]) => allowed.has(key)));
}
function requireScope(policy: PlatformResourcePolicy, value: Record<string, unknown>): void {
  if (policy.requiredScope === 'site' && typeof value.managedSiteId !== 'string') throw new ApiError(400, 'MANAGED_SITE_REQUIRED', 'managedSiteId is required.');
  if (policy.requiredScope === 'client' && typeof value.clientAccountId !== 'string') throw new ApiError(400, 'CLIENT_SCOPE_REQUIRED', 'clientAccountId is required.');
  if (policy.requiredScope === 'contractor' && typeof value.contractorId !== 'string') throw new ApiError(400, 'CONTRACTOR_SCOPE_REQUIRED', 'contractorId is required.');
  if (policy.requiredScope === 'assignment' && typeof value.assignedUserId !== 'string') throw new ApiError(400, 'ASSIGNMENT_REQUIRED', 'assignedUserId is required.');
}
function requireConversationScope(role: SecurityRole, value: Record<string, unknown>): void {
  if (SITE_PORTAL_ROLES.has(role) && typeof value.managedSiteId !== 'string') throw new ApiError(400, 'MANAGED_SITE_REQUIRED', 'managedSiteId is required for this portal.');
  if (['client_admin', 'client_user', 'landlord'].includes(role) && typeof value.clientAccountId !== 'string') throw new ApiError(400, 'CLIENT_SCOPE_REQUIRED', 'clientAccountId is required for this portal.');
}
function offerEligible(record: StoredRecord, managedSiteId: string | undefined): boolean {
  if (!managedSiteId) return true;
  if (record.status !== 'active') return false;
  try {
    const rules = typeof record.locationRules === 'string' ? JSON.parse(record.locationRules) as Record<string, unknown> : record.locationRules as Record<string, unknown> | undefined;
    const siteIds = Array.isArray(rules?.managedSiteIds) ? rules.managedSiteIds.map(String) : [];
    return siteIds.length === 0 || siteIds.includes(managedSiteId);
  } catch { return false; }
}
async function appendAudit(deps: ApiDependencies, principal: { uid: string; role: string; agencyId: string }, capability: SecurityCapability, eventType: string, entityType: string, entityId: string, correlationId: string, eventTarget: AuthorisationTarget): Promise<void> {
  await deps.audit.append({ id: randomUUID(), timestamp: new Date().toISOString(), actorId: principal.uid, actorRole: principal.role, agencyId: principal.agencyId, capability, outcome: 'allowed', reason: eventType, target: eventTarget, correlationId, eventType, entityType, entityId });
}

async function listResource(req: IncomingMessage, deps: ApiDependencies, correlationId: string, resource: string, policy: PlatformResourcePolicy): Promise<ApiResponse> {
  const agencyId = agencyHeader(req);
  const url = new URL(req.url ?? '/', 'http://localhost');
  const scopeValues = allScopeValues(url);
  requireScope(policy, scopeValues);
  const principal = await authenticateAndAuthorise(req, deps, policy.readCapability, target(scopeValues, agencyId), correlationId);
  if (resource === 'conversations') requireConversationScope(principal.role, scopeValues);
  const filters = queryFilters(policy, scopeValues);
  if (policy.selfField && shouldSelfScope(resource, principal.role)) filters[policy.selfField] = principal.uid;
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50), 1), 100);
  const page = await deps.repository.list(policy.collection, agencyId, limit, url.searchParams.get('cursor') ?? undefined, filters);
  const data = resource === 'offers' ? page.items.filter((item) => offerEligible(item, scopeValues.managedSiteId)) : page.items;
  return { status: 200, body: { data, meta: { correlationId, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) } } };
}

async function createResource(req: IncomingMessage, deps: ApiDependencies, correlationId: string, resource: string, policy: PlatformResourcePolicy, body: Record<string, unknown>): Promise<ApiResponse> {
  if (!policy.createCapability) throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'This resource cannot be created through this endpoint.');
  const agencyId = agencyHeader(req);
  const data = clean(body);
  requireScope(policy, data);
  const principal = await authenticateAndAuthorise(req, deps, policy.createCapability, target(data, agencyId), correlationId);
  if (resource === 'conversations') requireConversationScope(principal.role, data);
  if (policy.selfField && shouldSelfScope(resource, principal.role)) data[policy.selfField] = principal.uid;
  if (resource === 'offer-redemptions') {
    data.redeemedAt = new Date().toISOString();
    data.redemptionToken = typeof data.redemptionToken === 'string' ? data.redemptionToken : randomUUID();
    data.status = 'created';
  }
  if (resource === 'offline-sync-receipts') {
    data.firstReceivedAt = new Date().toISOString();
    data.attempts = typeof data.attempts === 'number' ? data.attempts : 1;
    data.syncState = typeof data.syncState === 'string' ? data.syncState : 'received';
  }
  const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : randomUUID();
  return idempotent(deps, req, agencyId, `platform:${resource}:create`, body, async () => {
    const created = await deps.repository.create(policy.collection, agencyId, id, data, principal.uid);
    await appendAudit(deps, principal, policy.createCapability as SecurityCapability, `platform.${resource}.created`, resource, id, correlationId, target(created, agencyId));
    return { status: 201, body: { data: created, meta: { correlationId } } };
  });
}

async function updateResource(req: IncomingMessage, deps: ApiDependencies, correlationId: string, resource: string, id: string, policy: PlatformResourcePolicy, body: Record<string, unknown>): Promise<ApiResponse> {
  if (!policy.writeCapability) throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'This resource is read-only.');
  const agencyId = agencyHeader(req);
  const existing = await deps.repository.get(policy.collection, agencyId, id);
  if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Record not found.');
  const principal = await authenticateAndAuthorise(req, deps, policy.writeCapability, target(existing, agencyId), correlationId);
  if (policy.selfField && shouldSelfScope(resource, principal.role) && existing[policy.selfField] !== principal.uid) throw new ApiError(403, 'FORBIDDEN', 'This record belongs to another user.');
  const version = expectedVersion(body);
  return idempotent(deps, req, agencyId, `platform:${resource}:${id}:update`, body, async () => {
    const updated = await deps.repository.update(policy.collection, agencyId, id, clean(body), version, principal.uid);
    await appendAudit(deps, principal, policy.writeCapability as SecurityCapability, `platform.${resource}.updated`, resource, id, correlationId, target(existing, agencyId));
    return { status: 200, body: { data: updated, meta: { correlationId } } };
  });
}

async function conversationMessages(req: IncomingMessage, deps: ApiDependencies, correlationId: string, conversationId: string): Promise<ApiResponse> {
  const agencyId = agencyHeader(req);
  const conversation = await deps.repository.get('conversations', agencyId, conversationId);
  if (!conversation) throw new ApiError(404, 'NOT_FOUND', 'Conversation not found.');
  const capability: SecurityCapability = req.method === 'GET' ? 'communication.read' : 'communication.send';
  const principal = await authenticateAndAuthorise(req, deps, capability, target(conversation, agencyId), correlationId);
  requireConversationScope(principal.role, conversation);
  if (req.method === 'GET') {
    const page = await deps.repository.list('conversationMessages', agencyId, 100, undefined, { conversationId });
    return { status: 200, body: { data: page.items, meta: { correlationId } } };
  }
  if (req.method === 'POST') {
    const body = await readJson(req);
    const messageBody = typeof body.body === 'string' ? body.body.trim() : '';
    if (!messageBody) throw new ApiError(400, 'MESSAGE_BODY_REQUIRED', 'Message body is required.');
    return idempotent(deps, req, agencyId, `platform:conversation:${conversationId}:message`, body, async () => {
      const id = randomUUID();
      const created = await deps.repository.create('conversationMessages', agencyId, id, {
        conversationId, senderType: 'user', senderId: principal.uid,
        channel: typeof body.channel === 'string' ? body.channel : 'portal', body: messageBody,
        attachmentFileIds: Array.isArray(body.attachmentFileIds) ? JSON.stringify(body.attachmentFileIds) : '[]',
        deliveryStatus: 'created', sentAt: new Date().toISOString(), status: 'active',
      }, principal.uid);
      await appendAudit(deps, principal, capability, 'platform.conversation.message.created', 'conversation_message', id, correlationId, target(conversation, agencyId));
      return { status: 201, body: { data: created, meta: { correlationId } } };
    });
  }
  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method is not supported.');
}

async function routePlanStops(req: IncomingMessage, deps: ApiDependencies, correlationId: string, routePlanId: string): Promise<ApiResponse> {
  const agencyId = agencyHeader(req);
  const routePlan = await deps.repository.get('routePlans', agencyId, routePlanId);
  if (!routePlan) throw new ApiError(404, 'NOT_FOUND', 'Route plan not found.');
  const capability: SecurityCapability = req.method === 'GET' ? 'job.read' : 'job.plan';
  const principal = await authenticateAndAuthorise(req, deps, capability, target(routePlan, agencyId), correlationId);
  if (req.method === 'GET') {
    const page = await deps.repository.list('routePlanStops', agencyId, 100, undefined, { routePlanId });
    return { status: 200, body: { data: page.items, meta: { correlationId } } };
  }
  if (req.method === 'POST') {
    const body = await readJson(req);
    return idempotent(deps, req, agencyId, `platform:route-plan:${routePlanId}:stop`, body, async () => {
      const id = typeof body.id === 'string' ? body.id : randomUUID();
      const created = await deps.repository.create('routePlanStops', agencyId, id, { ...clean(body), routePlanId, status: typeof body.status === 'string' ? body.status : 'planned' }, principal.uid);
      await appendAudit(deps, principal, capability, 'platform.route_plan.stop.created', 'route_plan_stop', id, correlationId, target(routePlan, agencyId));
      return { status: 201, body: { data: created, meta: { correlationId } } };
    });
  }
  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method is not supported.');
}

export async function routeUnifiedPlatformRequest(req: IncomingMessage, deps: ApiDependencies, correlationId: string): Promise<ApiResponse | undefined> {
  const parts = pathParts(req);
  if (parts[0] !== 'api' || parts[1] !== 'v1' || parts[2] !== 'platform') return undefined;
  const resource = parts[3];
  if (!resource) return { status: 200, body: { name: 'ProInspect Unified Platform API', version: 'v1', resources: Object.keys(POLICIES) } };
  if (resource === 'route-plans' && parts[4] && parts[5] === 'stops') return routePlanStops(req, deps, correlationId, parts[4]);
  const policy = POLICIES[resource];
  if (!policy) throw new ApiError(404, 'NOT_FOUND', 'Unified platform resource not found.');
  const id = parts[4];
  const nested = parts[5];
  if (resource === 'conversations' && id && nested === 'messages') return conversationMessages(req, deps, correlationId, id);

  if (req.method === 'GET' && !id) return listResource(req, deps, correlationId, resource, policy);
  if (req.method === 'GET' && id === 'me' && policy.selfField) {
    const agencyId = agencyHeader(req);
    const principal = await authenticateAndAuthorise(req, deps, policy.readCapability, { agencyId }, correlationId);
    const page = await deps.repository.list(policy.collection, agencyId, 100, undefined, { [policy.selfField]: principal.uid });
    return { status: 200, body: { data: page.items, meta: { correlationId } } };
  }
  if (req.method === 'GET' && id) {
    const agencyId = agencyHeader(req);
    const record = await deps.repository.get(policy.collection, agencyId, id);
    if (!record) throw new ApiError(404, 'NOT_FOUND', 'Record not found.');
    const scopeValues = allScopeValues(new URL(req.url ?? '/', 'http://localhost'));
    const principal = await authenticateAndAuthorise(req, deps, policy.readCapability, target({ ...record, ...scopeValues }, agencyId), correlationId);
    if (policy.selfField && shouldSelfScope(resource, principal.role) && record[policy.selfField] !== principal.uid) throw new ApiError(403, 'FORBIDDEN', 'This record belongs to another user.');
    return { status: 200, body: { data: record, meta: { correlationId } } };
  }
  if (req.method === 'POST' && !id) return createResource(req, deps, correlationId, resource, policy, await readJson(req));
  if ((req.method === 'PATCH' || req.method === 'PUT') && id) return updateResource(req, deps, correlationId, resource, id, policy, await readJson(req));
  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method is not supported for this unified platform resource.');
}
