import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import {
  MAINTENANCE_CATEGORIES,
  MAINTENANCE_PRIORITIES,
  type AuthenticatedPrincipal,
  type MaintenanceCategory,
  type MaintenancePriority,
  type UploadSessionRecord,
} from '@pcr/domain';
import { firestoreDb } from '../firestoreDatabase.js';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { FirestorePhotoEvidenceStore } from './photoEvidenceStore.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies, StoredRecord } from './types.js';

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

async function listAll(dependencies: ApiDependencies, collection: string, agencyId: string): Promise<StoredRecord[]> {
  const result: StoredRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = await dependencies.repository.list(collection, agencyId, 100, cursor);
    result.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return result;
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

function evidenceIds(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()))] : [];
}

function externalPrincipal(grant: TenantPortalGrant): AuthenticatedPrincipal {
  return { uid: `external:${grant.id}`, agencyId: grant.agencyId, role: 'operations', mfaVerified: false, tokenIssuedAt: Math.floor(Date.now() / 1000) };
}

async function resolveGrant(rawToken: string): Promise<TenantPortalGrant> {
  const snapshot = await firestoreDb(adminApp()).collectionGroup('tenantPortalGrants').where('tokenHash', '==', hashToken(rawToken)).limit(2).get();
  if (snapshot.empty || snapshot.size !== 1) throw new ApiError(401, 'INVALID_GRANT_TOKEN', 'Tenant portal link is invalid or expired.');
  const document = snapshot.docs[0];
  const grant = document.data() as TenantPortalGrant;
  if (grant.revokedAt) throw new ApiError(401, 'GRANT_TOKEN_REVOKED', 'Tenant portal link has been revoked.');
  if (new Date(grant.expiresAt).getTime() <= Date.now()) throw new ApiError(401, 'GRANT_TOKEN_EXPIRED', 'Tenant portal link has expired.');
  await document.ref.update({ lastAccessedAt: new Date().toISOString() });
  return grant;
}

async function assertVerifiedParticipant(dependencies: ApiDependencies, agencyId: string, tenantId: string, tenancyId: string, recipientEmail: string) {
  const tenant = await dependencies.repository.get('tenants', agencyId, tenantId);
  const tenancy = await dependencies.repository.get('tenancies', agencyId, tenancyId);
  if (!tenant || !tenancy) throw new ApiError(404, 'TENANT_OR_TENANCY_NOT_FOUND', 'Tenant or tenancy was not found.');
  const verifiedEmail = typeof tenant.email === 'string' ? tenant.email.trim().toLowerCase() : '';
  if (!verifiedEmail) throw new ApiError(409, 'VERIFIED_TENANT_EMAIL_REQUIRED', 'A verified tenant profile email is required before portal access can be issued.');
  if (verifiedEmail !== recipientEmail) throw new ApiError(400, 'RECIPIENT_SCOPE_MISMATCH', 'Recipient email must match the verified tenant profile email.');
  const participants = await listAll(dependencies, 'tenancyParticipants', agencyId);
  if (!participants.some((item) => item.tenantId === tenantId && item.tenancyId === tenancyId && item.status !== 'ended')) {
    throw new ApiError(409, 'TENANT_NOT_LINKED_TO_TENANCY', 'Tenant is not an active participant in this tenancy.');
  }
  return { tenant, tenancy };
}

async function queueInvitation(dependencies: ApiDependencies, principalId: string, agencyId: string, tenantId: string, tenancyId: string, recipient: string, accessUrl: string, expiresAt: string) {
  const communicationId = randomUUID();
  await dependencies.repository.create('tenantCommunications', agencyId, communicationId, {
    tenantId, tenancyId, channel: 'email', direction: 'outbound', subject: 'Your ProInspect tenant portal',
    message: `Your secure ProInspect tenant portal is available at ${accessUrl}. This link expires ${expiresAt}.`, status: 'queued', relatedEntityType: 'general',
  }, principalId);
  const notificationId = randomUUID();
  const notification = await dependencies.repository.create('notificationJobs', agencyId, notificationId, {
    tenantId, tenancyId, channel: 'email', recipient, subject: 'Your ProInspect tenant portal',
    message: `Your secure ProInspect tenant portal is available at ${accessUrl}. This link expires ${expiresAt}.`, communicationId, status: 'queued', queuedAt: new Date().toISOString(),
  }, principalId);
  await dependencies.tasks.dispatch('notification', agencyId, notificationId, notification);
}

async function createGrant(dependencies: ApiDependencies, agencyId: string, tenantId: string, tenancyId: string, recipientEmail: string, expiresInHours: number, principalId: string) {
  const rawToken = `${randomUUID()}${randomUUID().replaceAll('-', '')}`;
  const grantId = randomUUID();
  const expiresAt = new Date(Date.now() + expiresInHours * 3_600_000).toISOString();
  const grant = await dependencies.repository.create('tenantPortalGrants', agencyId, grantId, {
    tenantId, tenancyId, recipientEmail, tokenHash: hashToken(rawToken), expiresAt,
  }, principalId);
  return { grant, rawToken, accessUrl: `/tenant-portal/${rawToken}` };
}

async function generateGrant(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string): Promise<ApiResponse> {
  const agencyId = agencyHeader(req);
  const body = await readJson(req);
  const tenantId = requiredString(body, 'tenantId');
  const tenancyId = requiredString(body, 'tenancyId');
  const recipientEmail = validEmail(requiredString(body, 'recipientEmail'));
  const principal = await authenticateAndAuthorise(req, dependencies, 'tenant.portal.manage', { agencyId, tenantId, tenancyId }, correlationId);
  await assertVerifiedParticipant(dependencies, agencyId, tenantId, tenancyId, recipientEmail);
  const expiresInHours = typeof body.expiresInHours === 'number' && Number.isFinite(body.expiresInHours) ? Math.min(Math.max(Math.floor(body.expiresInHours), 1), 24 * 30) : 24 * 7;
  const created = await createGrant(dependencies, agencyId, tenantId, tenancyId, recipientEmail, expiresInHours, principal.uid);
  if (body.sendInvitation === true) await queueInvitation(dependencies, principal.uid, agencyId, tenantId, tenancyId, recipientEmail, created.accessUrl, String(created.grant.expiresAt));
  await dependencies.audit.append({ id: randomUUID(), timestamp: new Date().toISOString(), actorId: principal.uid, actorRole: principal.role, agencyId, capability: 'tenant.portal.manage', outcome: 'allowed', reason: body.sendInvitation === true ? 'tenant_portal.grant_generated_and_sent' : 'tenant_portal.grant_generated', target: { agencyId, tenancyId }, correlationId });
  return { status: 201, body: { data: { grantId: created.grant.id, grantToken: created.rawToken, expiresAt: created.grant.expiresAt, accessUrl: created.accessUrl }, meta: { correlationId } } };
}

async function listGrants(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string): Promise<ApiResponse> {
  const agencyId = agencyHeader(req);
  const principal = await authenticateAndAuthorise(req, dependencies, 'tenant.portal.manage', { agencyId }, correlationId);
  const url = new URL(req.url ?? '/', 'http://localhost');
  const tenantId = url.searchParams.get('tenantId')?.trim();
  const tenancyId = url.searchParams.get('tenancyId')?.trim();
  let grants = await listAll(dependencies, 'tenantPortalGrants', agencyId);
  if (tenantId) grants = grants.filter((item) => item.tenantId === tenantId);
  if (tenancyId) grants = grants.filter((item) => item.tenancyId === tenancyId);
  const data = grants.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map((item) => ({ id: item.id, tenantId: item.tenantId, tenancyId: item.tenancyId, recipientEmail: item.recipientEmail, expiresAt: item.expiresAt, revokedAt: item.revokedAt, lastAccessedAt: item.lastAccessedAt, createdAt: item.createdAt }));
  void principal;
  return { status: 200, body: { data, meta: { correlationId, total: data.length } } };
}

async function revokeGrant(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string, grantId: string): Promise<ApiResponse> {
  const agencyId = agencyHeader(req);
  const principal = await authenticateAndAuthorise(req, dependencies, 'tenant.portal.manage', { agencyId }, correlationId);
  const grant = await dependencies.repository.get('tenantPortalGrants', agencyId, grantId);
  if (!grant) throw new ApiError(404, 'PORTAL_GRANT_NOT_FOUND', 'Tenant portal grant not found.');
  const updated = await dependencies.repository.update('tenantPortalGrants', agencyId, grantId, { revokedAt: new Date().toISOString() }, Number(grant.version || 1), principal.uid);
  return { status: 200, body: { data: updated, meta: { correlationId } } };
}

async function replaceGrant(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string, grantId: string): Promise<ApiResponse> {
  const agencyId = agencyHeader(req);
  const body = await readJson(req);
  const principal = await authenticateAndAuthorise(req, dependencies, 'tenant.portal.manage', { agencyId }, correlationId);
  const old = await dependencies.repository.get('tenantPortalGrants', agencyId, grantId);
  if (!old) throw new ApiError(404, 'PORTAL_GRANT_NOT_FOUND', 'Tenant portal grant not found.');
  const recipient = validEmail(String(old.recipientEmail || ''));
  await assertVerifiedParticipant(dependencies, agencyId, String(old.tenantId), String(old.tenancyId), recipient);
  await dependencies.repository.update('tenantPortalGrants', agencyId, grantId, { revokedAt: new Date().toISOString(), replacedAt: new Date().toISOString() }, Number(old.version || 1), principal.uid);
  const expiresInHours = typeof body.expiresInHours === 'number' && Number.isFinite(body.expiresInHours) ? Math.min(Math.max(Math.floor(body.expiresInHours), 1), 24 * 30) : 24 * 7;
  const created = await createGrant(dependencies, agencyId, String(old.tenantId), String(old.tenancyId), recipient, expiresInHours, principal.uid);
  await queueInvitation(dependencies, principal.uid, agencyId, String(old.tenantId), String(old.tenancyId), recipient, created.accessUrl, String(created.grant.expiresAt));
  return { status: 201, body: { data: { grantId: created.grant.id, grantToken: created.rawToken, expiresAt: created.grant.expiresAt, accessUrl: created.accessUrl }, meta: { correlationId } } };
}

async function documentDownloadUrl(document: StoredRecord): Promise<string | undefined> {
  if (typeof document.objectPath !== 'string' || !document.objectPath) return undefined;
  const projectId = process.env.GOOGLE_CLOUD_PROJECT?.trim();
  const bucketName = process.env.REPORT_BUCKET?.trim() || (projectId ? `${projectId}-reports` : '');
  if (!bucketName) return undefined;
  const [url] = await getStorage(adminApp()).bucket(bucketName).file(document.objectPath).getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + 15 * 60 * 1000 });
  return url;
}

async function portalGet(grant: TenantPortalGrant, dependencies: ApiDependencies, correlationId: string): Promise<ApiResponse> {
  const [tenant, tenancy, jobs, reports, maintenance, actions, communications, documents] = await Promise.all([
    dependencies.repository.get('tenants', grant.agencyId, grant.tenantId),
    dependencies.repository.get('tenancies', grant.agencyId, grant.tenancyId),
    listAll(dependencies, 'inspectionJobs', grant.agencyId),
    listAll(dependencies, 'reports', grant.agencyId),
    listAll(dependencies, 'maintenanceItems', grant.agencyId),
    listAll(dependencies, 'tenantInstructions', grant.agencyId),
    listAll(dependencies, 'tenantCommunications', grant.agencyId),
    listAll(dependencies, 'tenancyDocuments', grant.agencyId),
  ]);
  if (!tenant || !tenancy) throw new ApiError(404, 'PORTAL_CONTEXT_NOT_FOUND', 'Tenant portal context no longer exists.');
  const property = tenancy.propertyId ? await dependencies.repository.get('properties', grant.agencyId, String(tenancy.propertyId)) : undefined;
  const scopedDocuments = documents.filter((item) => item.tenancyId === grant.tenancyId && (!item.tenantId || item.tenantId === grant.tenantId));
  const documentData = await Promise.all(scopedDocuments.map(async (item) => ({
    id: item.id, type: item.type, title: item.title, status: item.status, content: item.content, contentType: item.contentType,
    acknowledgementText: item.acknowledgementText, issuedAt: item.issuedAt, signedAt: item.signedAt, signers: item.signers,
    downloadUrl: await documentDownloadUrl(item).catch(() => undefined),
  })));
  const response = {
    tenant: { id: tenant.id, fullName: tenant.fullName, preferredName: tenant.preferredName, email: tenant.email, phone: tenant.phone },
    tenancy: { id: tenancy.id, propertyId: tenancy.propertyId, leaseStartDate: tenancy.leaseStartDate, leaseEndDate: tenancy.leaseEndDate, lifecycleStatus: tenancy.lifecycleStatus || tenancy.status, leaseType: tenancy.leaseType },
    property: property ? { id: property.id, address: property.address, suburb: property.suburb, state: property.state, postcode: property.postcode } : undefined,
    inspections: jobs.filter((item) => item.tenancyId === grant.tenancyId).map((item) => ({ id: item.id, reportType: item.reportType, scheduledAt: item.scheduledAt, status: item.status })),
    reports: reports.filter((item) => item.tenancyId === grant.tenancyId).map((item) => ({ id: item.id, reportId: item.reportId || item.id, reportType: item.reportType, inspectionDate: item.inspectionDate, lifecycleStatus: item.lifecycleStatus })),
    maintenance: maintenance.filter((item) => item.tenancyId === grant.tenancyId).map((item) => ({ id: item.id, title: item.title, description: item.description, category: item.category, priority: item.priority, status: item.status, dueDate: item.dueDate, sourceEvidenceIds: item.sourceEvidenceIds, location: item.location, accessAvailability: item.accessAvailability })),
    actions: actions.filter((item) => item.tenancyId === grant.tenancyId).map((item) => ({ id: item.id, type: item.type, title: item.title, instruction: item.instruction, status: item.status, dueDate: item.dueDate, tenantResponseNote: item.tenantResponseNote, tenantEvidenceIds: item.tenantEvidenceIds, tenantResponseType: item.tenantResponseType })),
    communications: communications.filter((item) => item.tenantId === grant.tenantId && item.tenancyId === grant.tenancyId).map((item) => ({ id: item.id, channel: item.channel, direction: item.direction, subject: item.subject, message: item.message, status: item.status, createdAt: item.createdAt })),
    documents: documentData,
  };
  await dependencies.audit.append({ id: randomUUID(), timestamp: new Date().toISOString(), actorId: `external:${grant.id}`, actorRole: 'external', agencyId: grant.agencyId, capability: 'tenant.portal.manage', outcome: 'allowed', reason: 'tenant_portal.viewed', target: { agencyId: grant.agencyId, tenancyId: grant.tenancyId }, correlationId });
  return { status: 200, body: { data: response, meta: { correlationId } } };
}

async function portalPost(req: IncomingMessage, grant: TenantPortalGrant, dependencies: ApiDependencies, correlationId: string, command: string): Promise<ApiResponse> {
  const body = await readJson(req);
  const actor = `external:${grant.id}`;
  if (command === 'message') {
    const message = requiredString(body, 'message');
    const record = await dependencies.repository.create('tenantCommunications', grant.agencyId, randomUUID(), { tenantId: grant.tenantId, tenancyId: grant.tenancyId, channel: 'portal', direction: 'inbound', message, status: 'received' }, actor);
    await dependencies.audit.append({ id: randomUUID(), timestamp: new Date().toISOString(), actorId: actor, actorRole: 'external', agencyId: grant.agencyId, capability: 'tenant.portal.manage', outcome: 'allowed', reason: 'tenant_portal.message_received', target: { agencyId: grant.agencyId, tenancyId: grant.tenancyId }, correlationId });
    return { status: 201, body: { data: record, meta: { correlationId } } };
  }
  if (command === 'maintenance') {
    const title = requiredString(body, 'title');
    const description = requiredString(body, 'description');
    const category = typeof body.category === 'string' && MAINTENANCE_CATEGORIES.includes(body.category as MaintenanceCategory) ? body.category as MaintenanceCategory : 'General Maintenance';
    const priority = typeof body.priority === 'string' && MAINTENANCE_PRIORITIES.includes(body.priority as MaintenancePriority) ? body.priority as MaintenancePriority : 'routine';
    const tenancy = await dependencies.repository.get('tenancies', grant.agencyId, grant.tenancyId);
    if (!tenancy?.propertyId) throw new ApiError(409, 'TENANCY_PROPERTY_REQUIRED', 'Tenancy is not linked to a property.');
    const record = await dependencies.repository.create('maintenanceItems', grant.agencyId, randomUUID(), {
      propertyId: tenancy.propertyId, tenancyId: grant.tenancyId, title, description, category, priority,
      status: 'triage_required', sourceEvidenceIds: evidenceIds(body.sourceEvidenceIds), approvalRequired: false, approvalStatus: 'not_required',
      verificationStatus: 'unverified', source: 'tenant', location: typeof body.location === 'string' ? body.location.trim() : undefined,
      accessAvailability: typeof body.accessAvailability === 'string' ? body.accessAvailability.trim() : undefined,
    }, actor);
    await dependencies.audit.append({ id: randomUUID(), timestamp: new Date().toISOString(), actorId: actor, actorRole: 'external', agencyId: grant.agencyId, capability: 'tenant.portal.manage', outcome: 'allowed', reason: 'tenant_portal.maintenance_submitted', target: { agencyId: grant.agencyId, tenancyId: grant.tenancyId }, correlationId });
    return { status: 201, body: { data: record, meta: { correlationId } } };
  }
  if (command === 'respond-action') {
    const actionId = requiredString(body, 'actionId');
    const action = await dependencies.repository.get('tenantInstructions', grant.agencyId, actionId);
    if (!action || action.tenancyId !== grant.tenancyId) throw new ApiError(404, 'TENANT_ACTION_NOT_FOUND', 'Tenant action is not available in this portal.');
    if (!['issued', 'viewed', 'awaiting_action'].includes(String(action.status))) throw new ApiError(409, 'TENANT_ACTION_NOT_RESPONDABLE', `Action cannot be answered from ${String(action.status)}.`);
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    const supportingEvidence = evidenceIds(body.evidenceIds);
    const responseType = ['completed', 'clarification', 'request_more_time', 'response'].includes(String(body.responseType)) ? String(body.responseType) : 'response';
    if (!note && supportingEvidence.length === 0) throw new ApiError(400, 'TENANT_RESPONSE_REQUIRED', 'A response note or supporting evidence is required.');
    const submittedAt = new Date().toISOString();
    const updated = await dependencies.repository.update('tenantInstructions', grant.agencyId, actionId, { status: 'tenant_responded', tenantResponseNote: note, tenantEvidenceIds: supportingEvidence, tenantResponseType: responseType, tenantSubmittedAt: submittedAt }, Number(action.version || 1), actor);
    await dependencies.audit.append({ id: randomUUID(), timestamp: submittedAt, actorId: actor, actorRole: 'external', agencyId: grant.agencyId, capability: 'tenant.portal.manage', outcome: 'allowed', reason: `tenant_portal.action_${responseType}`, target: { agencyId: grant.agencyId, tenancyId: grant.tenancyId }, correlationId });
    return { status: 200, body: { data: updated, meta: { correlationId } } };
  }
  if (command === 'sign-document') {
    const documentId = requiredString(body, 'documentId');
    const signatureName = requiredString(body, 'signatureName');
    const document = await dependencies.repository.get('tenancyDocuments', grant.agencyId, documentId);
    if (!document || document.tenancyId !== grant.tenancyId || (document.tenantId && document.tenantId !== grant.tenantId)) throw new ApiError(404, 'DOCUMENT_NOT_FOUND', 'Document is not available in this tenant portal.');
    if (!['signature_required', 'partially_signed'].includes(String(document.status))) throw new ApiError(409, 'DOCUMENT_NOT_SIGNABLE', 'Document is not awaiting a portal signature.');
    const signers = Array.isArray(document.signers) ? document.signers.map((item) => ({ ...(item as Record<string, unknown>) })) : [];
    const index = signers.findIndex((item) => item.kind === 'tenant' && item.tenantId === grant.tenantId && item.status !== 'signed');
    if (index < 0) throw new ApiError(409, 'TENANT_SIGNATURE_NOT_REQUIRED', 'This document is not awaiting this tenant signature.');
    const signedAt = new Date().toISOString();
    signers[index] = { ...signers[index], status: 'signed', signedAt, signatureName };
    const complete = signers.filter((item) => item.required !== false).every((item) => item.status === 'signed');
    const signatureManifestSha256 = createHash('sha256').update(JSON.stringify({ documentSha256: document.sha256, signers })).digest('hex');
    const updated = await dependencies.repository.update('tenancyDocuments', grant.agencyId, documentId, { signers, status: complete ? 'signed' : 'partially_signed', ...(complete ? { signedAt } : {}), signedByTenantId: grant.tenantId, signatureMethod: 'portal_acknowledgement', signatureManifestSha256 }, Number(document.version || 1), actor);
    await dependencies.audit.append({ id: randomUUID(), timestamp: signedAt, actorId: actor, actorRole: 'external', agencyId: grant.agencyId, capability: 'tenant.portal.manage', outcome: 'allowed', reason: 'tenant_portal.document_signed', target: { agencyId: grant.agencyId, tenancyId: grant.tenancyId }, correlationId });
    return { status: 200, body: { data: updated, meta: { correlationId } } };
  }
  throw new ApiError(404, 'UNKNOWN_PORTAL_COMMAND', 'Unknown tenant portal action.');
}

function uploadInput(body: Record<string, unknown>) {
  const fileName = requiredString(body, 'fileName');
  const contentType = requiredString(body, 'contentType').toLowerCase();
  const size = typeof body.size === 'number' ? body.size : Number(body.size);
  const sha256 = requiredString(body, 'sha256').toLowerCase();
  if (!['image/jpeg', 'image/png', 'image/heic', 'image/heif'].includes(contentType)) throw new ApiError(400, 'CONTENT_TYPE_UNSUPPORTED', 'Evidence must be JPEG, PNG, HEIC or HEIF.');
  if (!Number.isFinite(size) || size <= 0 || size > 25 * 1024 * 1024) throw new ApiError(400, 'FILE_SIZE_INVALID', 'Evidence must be between 1 byte and 25 MB.');
  if (!/^[a-f0-9]{64}$/u.test(sha256)) throw new ApiError(400, 'SHA256_REQUIRED', 'A lowercase SHA-256 is required before evidence upload.');
  return { fileName, contentType, size, sha256 };
}

async function evidenceUploadSession(req: IncomingMessage, grant: TenantPortalGrant, dependencies: ApiDependencies, correlationId: string): Promise<ApiResponse> {
  const body = uploadInput(await readJson(req));
  const tenancy = await dependencies.repository.get('tenancies', grant.agencyId, grant.tenancyId);
  if (!tenancy?.propertyId) throw new ApiError(409, 'TENANCY_PROPERTY_REQUIRED', 'Tenancy is not linked to a property.');
  const uploadId = randomUUID();
  const session = await dependencies.uploads.create(grant.agencyId, uploadId, {
    propertyId: tenancy.propertyId, inspectionJobId: `tenant-portal-${grant.tenancyId}`, componentIds: [],
    fileName: body.fileName, contentType: body.contentType, size: body.size, sha256: body.sha256,
    externalGrantId: grant.id, externalResourceType: 'tenant_portal', externalResourceId: grant.tenancyId,
  }, externalPrincipal(grant));
  await dependencies.audit.append({ id: randomUUID(), timestamp: new Date().toISOString(), actorId: `external:${grant.id}`, actorRole: 'external', agencyId: grant.agencyId, capability: 'upload.create', outcome: 'allowed', reason: 'tenant_portal.evidence_session_created', target: { agencyId: grant.agencyId, tenancyId: grant.tenancyId }, correlationId });
  return { status: 201, body: { data: { ...session, photoId: uploadId }, meta: { correlationId } } };
}

async function evidenceComplete(grant: TenantPortalGrant, dependencies: ApiDependencies, correlationId: string, uploadId: string): Promise<ApiResponse> {
  const database = firestoreDb(adminApp());
  const snapshot = await database.doc(`agencies/${grant.agencyId}/uploadSessions/${uploadId}`).get();
  if (!snapshot.exists) throw new ApiError(404, 'UPLOAD_SESSION_NOT_FOUND', 'Evidence upload session was not found.');
  const session = snapshot.data() as UploadSessionRecord;
  if (session.externalGrantId !== grant.id || String(session.externalResourceType) !== 'tenant_portal' || session.externalResourceId !== grant.tenancyId) throw new ApiError(403, 'UPLOAD_SESSION_SCOPE_MISMATCH', 'Evidence upload session does not belong to this portal grant.');
  if (session.status === 'expired' || new Date(session.expiresAt).getTime() <= Date.now()) throw new ApiError(409, 'UPLOAD_SESSION_EXPIRED', 'Evidence upload session has expired.');
  const projectId = process.env.GOOGLE_CLOUD_PROJECT?.trim();
  const bucketName = process.env.UPLOAD_BUCKET?.trim() || (projectId ? `${projectId}-uploads` : '');
  if (!bucketName) throw new ApiError(503, 'UPLOAD_BUCKET_REQUIRED', 'UPLOAD_BUCKET is required before evidence completion.');
  const file = getStorage(adminApp()).bucket(bucketName).file(session.objectPath);
  const [metadata] = await file.getMetadata().catch(() => { throw new ApiError(422, 'EVIDENCE_OBJECT_NOT_FOUND', 'Uploaded evidence object could not be verified.'); });
  const actualSize = Number(metadata.size);
  if (!Number.isFinite(actualSize) || actualSize !== session.fileSize) throw new ApiError(422, 'EVIDENCE_SIZE_MISMATCH', 'Uploaded evidence size does not match the issued session.');
  const [bytes] = await file.download({ validation: false });
  const actualHash = createHash('sha256').update(bytes).digest('hex');
  if (actualHash !== session.sha256) throw new ApiError(422, 'EVIDENCE_HASH_MISMATCH', 'Uploaded evidence does not match its declared SHA-256.');
  const completedAt = new Date().toISOString();
  const evidence = await new FirestorePhotoEvidenceStore().complete(grant.agencyId, uploadId, { bucket: bucketName, objectPath: session.objectPath, generation: String(metadata.generation || ''), ...(metadata.metageneration ? { metageneration: String(metadata.metageneration) } : {}), contentType: String(metadata.contentType || session.contentType), size: actualSize, sha256: actualHash, completedAt });
  await database.doc(`agencies/${grant.agencyId}/photoEvidence/${evidence.id}`).set({ source: 'tenant_portal', externalGrantId: grant.id, externalResourceType: 'tenant_portal', externalResourceId: grant.tenancyId, updatedAt: completedAt }, { merge: true });
  return { status: 201, body: { data: { photoId: evidence.id, objectPath: evidence.objectPath, generation: evidence.generation, sha256: evidence.sha256, contentType: evidence.contentType }, meta: { correlationId } } };
}

export async function routeTenantPortalRequest(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string): Promise<ApiResponse | undefined> {
  const parts = new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean);
  if (parts[0] !== 'api' || parts[1] !== 'v1') return undefined;
  if (parts[2] === 'tenant-portal-grants' && parts.length === 3 && req.method === 'GET') return listGrants(req, dependencies, correlationId);
  if (parts[2] === 'tenant-portal-grants' && parts[3] === 'generate' && req.method === 'POST') return generateGrant(req, dependencies, correlationId);
  if (parts[2] === 'tenant-portal-grants' && parts[3] && parts[4] === 'revoke' && req.method === 'POST') return revokeGrant(req, dependencies, correlationId, parts[3]);
  if (parts[2] === 'tenant-portal-grants' && parts[3] && parts[4] === 'replace' && req.method === 'POST') return replaceGrant(req, dependencies, correlationId, parts[3]);
  if (parts[2] !== 'external' || parts[3] !== 'tenant-portal' || !parts[4]) return undefined;
  const grant = await resolveGrant(decodeURIComponent(parts[4]));
  if (req.method === 'GET' && !parts[5]) return portalGet(grant, dependencies, correlationId);
  if (req.method === 'POST' && parts[5] === 'evidence' && parts[6] === 'upload-session' && !parts[7]) return evidenceUploadSession(req, grant, dependencies, correlationId);
  if (req.method === 'POST' && parts[5] === 'evidence' && parts[6] === 'upload-session' && parts[7] && parts[8] === 'complete') return evidenceComplete(grant, dependencies, correlationId, decodeURIComponent(parts[7]));
  if (req.method === 'POST' && parts[5]) return portalPost(req, grant, dependencies, correlationId, parts[5]);
  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for tenant portal.');
}
