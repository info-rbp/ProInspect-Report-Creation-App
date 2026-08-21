import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies } from './types.js';

interface TenantPortalGrant {
  id: string;
  agencyId: string;
  tenantId: string;
  tenancyId: string;
  recipientEmail: string;
  tokenHash: string;
  expiresAt: string;
  revokedAt?: string;
  lastAccessedAt?: string;
  createdBy: string;
  createdAt: string;
  version?: number;
}

function adminApp() {
  return getApps()[0] ?? initializeApp({ credential: applicationDefault() });
}

function hashToken(value: string): string {
  return createHash('sha256').update(value.trim()).digest('hex');
}

function agencyHeader(req: IncomingMessage): string {
  const value = req.headers['x-agency-id']?.toString().trim();
  if (!value) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.');
  return value;
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 1_000_000) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Payload exceeds 1 MB.');
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

function requiredString(body: Record<string, unknown>, field: string): string {
  const value = typeof body[field] === 'string' ? body[field].trim() : '';
  if (!value) throw new ApiError(400, 'FIELD_REQUIRED', `${field} is required.`);
  return value;
}

function validEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) throw new ApiError(400, 'EMAIL_REQUIRED', 'A valid recipient email is required.');
  return email;
}

async function resolveGrant(rawToken: string): Promise<TenantPortalGrant> {
  const snapshot = await getFirestore(adminApp())
    .collectionGroup('tenantPortalGrants')
    .where('tokenHash', '==', hashToken(rawToken))
    .limit(2)
    .get();
  if (snapshot.empty || snapshot.size !== 1) throw new ApiError(401, 'INVALID_GRANT_TOKEN', 'Tenant portal link is invalid or expired.');
  const document = snapshot.docs[0];
  const grant = document.data() as TenantPortalGrant;
  if (grant.revokedAt) throw new ApiError(401, 'GRANT_TOKEN_REVOKED', 'Tenant portal link has been revoked.');
  if (new Date(grant.expiresAt).getTime() <= Date.now()) throw new ApiError(401, 'GRANT_TOKEN_EXPIRED', 'Tenant portal link has expired.');
  await document.ref.update({ lastAccessedAt: new Date().toISOString() });
  return grant;
}

async function generateGrant(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string): Promise<ApiResponse> {
  const agencyId = agencyHeader(req);
  const body = await readJson(req);
  const tenantId = requiredString(body, 'tenantId');
  const tenancyId = requiredString(body, 'tenancyId');
  const recipientEmail = validEmail(requiredString(body, 'recipientEmail'));
  const principal = await authenticateAndAuthorise(req, dependencies, 'tenant.portal.manage', { agencyId, tenantId, tenancyId }, correlationId);
  const tenant = await dependencies.repository.get('tenants', agencyId, tenantId);
  const tenancy = await dependencies.repository.get('tenancies', agencyId, tenancyId);
  if (!tenant || !tenancy) throw new ApiError(404, 'TENANT_OR_TENANCY_NOT_FOUND', 'Tenant or tenancy was not found.');
  if (typeof tenant.email === 'string' && tenant.email.trim() && tenant.email.trim().toLowerCase() !== recipientEmail) {
    throw new ApiError(400, 'RECIPIENT_SCOPE_MISMATCH', 'Recipient email must match the tenant profile email.');
  }
  const page = await dependencies.repository.list('tenancyParticipants', agencyId, 100);
  if (!page.items.some((item) => item.tenantId === tenantId && item.tenancyId === tenancyId && item.status !== 'ended')) {
    throw new ApiError(409, 'TENANT_NOT_LINKED_TO_TENANCY', 'Tenant is not an active participant in this tenancy.');
  }
  const expiresInHours = typeof body.expiresInHours === 'number' && Number.isFinite(body.expiresInHours)
    ? Math.min(Math.max(Math.floor(body.expiresInHours), 1), 24 * 30)
    : 24 * 7;
  const rawToken = `${randomUUID()}${randomUUID().replaceAll('-', '')}`;
  const grantId = randomUUID();
  const grant = await dependencies.repository.create('tenantPortalGrants', agencyId, grantId, {
    tenantId, tenancyId, recipientEmail, tokenHash: hashToken(rawToken),
    expiresAt: new Date(Date.now() + expiresInHours * 3_600_000).toISOString(),
  }, principal.uid);
  await dependencies.audit.append({
    id: randomUUID(), timestamp: new Date().toISOString(), actorId: principal.uid, actorRole: principal.role,
    agencyId, capability: 'tenant.portal.manage', outcome: 'allowed', reason: 'tenant_portal.grant_generated',
    target: { agencyId, tenancyId }, correlationId,
  });
  return { status: 201, body: { data: { grantId, grantToken: rawToken, expiresAt: grant.expiresAt, accessUrl: `/tenant-portal/${rawToken}` }, meta: { correlationId } } };
}

async function portalGet(grant: TenantPortalGrant, dependencies: ApiDependencies, correlationId: string): Promise<ApiResponse> {
  const [tenant, tenancy, property, jobs, reports, maintenance, actions, communications, documents] = await Promise.all([
    dependencies.repository.get('tenants', grant.agencyId, grant.tenantId),
    dependencies.repository.get('tenancies', grant.agencyId, grant.tenancyId),
    (async () => {
      const tenancyRecord = await dependencies.repository.get('tenancies', grant.agencyId, grant.tenancyId);
      return tenancyRecord?.propertyId ? dependencies.repository.get('properties', grant.agencyId, String(tenancyRecord.propertyId)) : undefined;
    })(),
    dependencies.repository.list('inspectionJobs', grant.agencyId, 100),
    dependencies.repository.list('reports', grant.agencyId, 100),
    dependencies.repository.list('maintenanceItems', grant.agencyId, 100),
    dependencies.repository.list('tenantInstructions', grant.agencyId, 100),
    dependencies.repository.list('tenantCommunications', grant.agencyId, 100),
    dependencies.repository.list('tenancyDocuments', grant.agencyId, 100),
  ]);
  if (!tenant || !tenancy) throw new ApiError(404, 'PORTAL_CONTEXT_NOT_FOUND', 'Tenant portal context no longer exists.');
  const safeProperty = property ? { id: property.id, address: property.address, suburb: property.suburb, state: property.state, postcode: property.postcode } : undefined;
  const safeTenant = { id: tenant.id, fullName: tenant.fullName, preferredName: tenant.preferredName, email: tenant.email, phone: tenant.phone };
  const safeTenancy = { id: tenancy.id, propertyId: tenancy.propertyId, leaseStartDate: tenancy.leaseStartDate, leaseEndDate: tenancy.leaseEndDate, lifecycleStatus: tenancy.lifecycleStatus || tenancy.status, leaseType: tenancy.leaseType };
  const response = {
    tenant: safeTenant,
    tenancy: safeTenancy,
    property: safeProperty,
    inspections: jobs.items.filter((item) => item.tenancyId === grant.tenancyId).map((item) => ({ id: item.id, reportType: item.reportType, scheduledAt: item.scheduledAt, status: item.status })),
    reports: reports.items.filter((item) => item.tenancyId === grant.tenancyId).map((item) => ({ id: item.id, reportId: item.reportId || item.id, reportType: item.reportType, inspectionDate: item.inspectionDate, lifecycleStatus: item.lifecycleStatus })),
    maintenance: maintenance.items.filter((item) => item.tenancyId === grant.tenancyId).map((item) => ({ id: item.id, title: item.title, description: item.description, category: item.category, priority: item.priority, status: item.status, dueDate: item.dueDate })),
    actions: actions.items.filter((item) => item.tenancyId === grant.tenancyId).map((item) => ({ id: item.id, type: item.type, title: item.title, instruction: item.instruction, status: item.status, dueDate: item.dueDate, tenantResponseNote: item.tenantResponseNote })),
    communications: communications.items.filter((item) => item.tenantId === grant.tenantId && item.tenancyId === grant.tenancyId).map((item) => ({ id: item.id, channel: item.channel, direction: item.direction, subject: item.subject, message: item.message, status: item.status, createdAt: item.createdAt })),
    documents: documents.items.filter((item) => item.tenancyId === grant.tenancyId && (!item.tenantId || item.tenantId === grant.tenantId)).map((item) => ({ id: item.id, type: item.type, title: item.title, status: item.status, issuedAt: item.issuedAt, signedAt: item.signedAt })),
  };
  await dependencies.audit.append({ id: randomUUID(), timestamp: new Date().toISOString(), actorId: `external:${grant.id}`, actorRole: 'external', agencyId: grant.agencyId, capability: 'tenant.portal.manage', outcome: 'allowed', reason: 'tenant_portal.viewed', target: { agencyId: grant.agencyId, tenancyId: grant.tenancyId }, correlationId });
  return { status: 200, body: { data: response, meta: { correlationId } } };
}

async function portalPost(req: IncomingMessage, grant: TenantPortalGrant, dependencies: ApiDependencies, correlationId: string, command: string): Promise<ApiResponse> {
  const body = await readJson(req);
  const actor = `external:${grant.id}`;
  if (command === 'message') {
    const message = requiredString(body, 'message');
    const record = await dependencies.repository.create('tenantCommunications', grant.agencyId, randomUUID(), {
      tenantId: grant.tenantId, tenancyId: grant.tenancyId, channel: 'portal', direction: 'inbound', message, status: 'received',
    }, actor);
    return { status: 201, body: { data: record, meta: { correlationId } } };
  }
  if (command === 'maintenance') {
    const title = requiredString(body, 'title');
    const description = requiredString(body, 'description');
    const tenancy = await dependencies.repository.get('tenancies', grant.agencyId, grant.tenancyId);
    if (!tenancy?.propertyId) throw new ApiError(409, 'TENANCY_PROPERTY_REQUIRED', 'Tenancy is not linked to a property.');
    const record = await dependencies.repository.create('maintenanceItems', grant.agencyId, randomUUID(), {
      propertyId: tenancy.propertyId, tenancyId: grant.tenancyId, title, description,
      category: typeof body.category === 'string' ? body.category : 'General Maintenance',
      priority: typeof body.priority === 'string' ? body.priority : 'routine',
      status: 'triage_required', sourceEvidenceIds: [], approvalRequired: false, approvalStatus: 'not_required',
      verificationStatus: 'unverified', source: 'tenant', createdBy: actor,
    }, actor);
    return { status: 201, body: { data: record, meta: { correlationId } } };
  }
  throw new ApiError(404, 'UNKNOWN_PORTAL_COMMAND', 'Unknown tenant portal action.');
}

export async function routeTenantPortalRequest(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string): Promise<ApiResponse | undefined> {
  const parts = new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean);
  if (parts[0] !== 'api' || parts[1] !== 'v1') return undefined;
  if (parts[2] === 'tenant-portal-grants' && parts[3] === 'generate' && req.method === 'POST') return generateGrant(req, dependencies, correlationId);
  if (parts[2] !== 'external' || parts[3] !== 'tenant-portal' || !parts[4]) return undefined;
  const grant = await resolveGrant(parts[4]);
  if (req.method === 'GET' && !parts[5]) return portalGet(grant, dependencies, correlationId);
  if (req.method === 'POST' && parts[5]) return portalPost(req, grant, dependencies, correlationId, parts[5]);
  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for tenant portal.');
}
