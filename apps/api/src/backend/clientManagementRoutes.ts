import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import {
  CLIENT_ACCOUNT_TYPES,
  CLIENT_DOCUMENT_TYPES,
  CLIENT_ENTITY_TYPES,
  evaluateClientOnboarding,
  legacyClientType,
  type ClientAccount,
  type ClientAccountType,
  type ClientContact,
  type ClientDocument,
  type ClientDocumentType,
  type ClientEngagement,
  type ClientEntityType,
  type PropertyClientRelationship,
  type PropertyClientRelationshipType,
} from '@pcr/domain';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import {
  clientOverview,
  createLegacyLandlordClient,
  duplicateCandidates,
  listAllClientRecords,
  resolveMaintenanceClientContext,
  resolvePropertyClientContext,
  snapshotClientContextForJob,
  snapshotClientContextForReport,
  syncPropertyClientContext,
} from '../services/clientManagementService.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies, IdempotencyResult, StoredRecord } from './types.js';

const MAX_BODY_BYTES = 5_000_000;
const MAX_CLIENT_DOCUMENT_BYTES = 150 * 1024 * 1024;
const DOCUMENT_CONTENT_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

function adminApp() {
  return getApps()[0] ?? initializeApp({ credential: applicationDefault() });
}

function routeParts(req: IncomingMessage): string[] {
  return new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean).map(decodeURIComponent);
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
    if (size > MAX_BODY_BYTES) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Client command exceeds 5 MB.');
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

function payloadHash(body: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

async function idempotent(
  dependencies: ApiDependencies,
  req: IncomingMessage,
  agencyId: string,
  operation: string,
  body: Record<string, unknown>,
  action: () => Promise<IdempotencyResult>,
): Promise<ApiResponse> {
  const result = await dependencies.idempotency.execute(
    agencyId,
    operation,
    idempotencyKey(req),
    payloadHash(body),
    action,
  );
  return {
    status: result.result.status,
    body: result.result.body,
    headers: { 'idempotency-replayed': String(result.replayed) },
  };
}

function version(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new ApiError(400, 'EXPECTED_VERSION_REQUIRED', 'expectedVersion must be a positive integer.');
  }
  return value;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function email(value: unknown): string | undefined {
  const candidate = text(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(candidate) ? candidate : undefined;
}

function accountType(value: unknown): ClientAccountType {
  const candidate = text(value).toLowerCase().replace(/[\s-]+/gu, '_');
  return (CLIENT_ACCOUNT_TYPES as readonly string[]).includes(candidate)
    ? candidate as ClientAccountType
    : candidate.includes('property') && candidate.includes('management')
      ? 'property_management_firm'
      : candidate.includes('landlord') || candidate.includes('owner')
        ? 'private_landlord'
        : 'other';
}

function entityType(value: unknown, clientType: ClientAccountType): ClientEntityType {
  const candidate = text(value).toLowerCase().replace(/[\s-]+/gu, '_');
  if ((CLIENT_ENTITY_TYPES as readonly string[]).includes(candidate)) return candidate as ClientEntityType;
  if (clientType === 'property_management_firm') return 'property_management_agency';
  return clientType === 'private_landlord' ? 'individual' : 'company';
}

function relationshipType(value: unknown): PropertyClientRelationshipType {
  const candidate = text(value).toLowerCase().replace(/[\s-]+/gu, '_');
  const supported = new Set<PropertyClientRelationshipType>([
    'owner', 'managing_agent', 'engaging_client', 'billing_party', 'report_recipient',
    'maintenance_authority', 'strata_manager', 'owner_representative',
  ]);
  return supported.has(candidate as PropertyClientRelationshipType)
    ? candidate as PropertyClientRelationshipType
    : 'engaging_client';
}

function cleanFileName(value: string): string {
  const base = value.trim().split(/[\\/]/u).pop() || 'client-document';
  return base.replace(/[^a-zA-Z0-9._ -]+/gu, '_').slice(0, 180) || 'client-document';
}

function sha256(value: unknown): string {
  const candidate = text(value).toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(candidate)) throw new ApiError(400, 'SHA256_REQUIRED', 'A valid SHA-256 digest is required.');
  return candidate;
}

function documentType(value: unknown): ClientDocumentType {
  const candidate = text(value);
  return (CLIENT_DOCUMENT_TYPES as readonly string[]).includes(candidate)
    ? candidate as ClientDocumentType
    : 'other';
}

async function timeline(
  dependencies: ApiDependencies,
  agencyId: string,
  clientAccountId: string,
  actorId: string,
  type: string,
  summary: string,
  relatedEntityType?: string,
  relatedEntityId?: string,
): Promise<void> {
  const now = new Date().toISOString();
  await dependencies.repository.create(
    'clientTimelineEvents',
    agencyId,
    randomUUID(),
    {
      clientAccountId,
      type,
      summary,
      ...(relatedEntityType ? { relatedEntityType } : {}),
      ...(relatedEntityId ? { relatedEntityId } : {}),
      actorId,
      occurredAt: now,
    },
    actorId,
  );
}

async function activateClient(
  dependencies: ApiDependencies,
  agencyId: string,
  clientId: string,
  expectedVersion: number,
  actorId: string,
): Promise<StoredRecord> {
  const account = await dependencies.repository.get('clients', agencyId, clientId);
  if (!account) throw new ApiError(404, 'CLIENT_NOT_FOUND', 'Client Account was not found.');
  const [contacts, engagements] = await Promise.all([
    listAllClientRecords(dependencies, 'clientContacts', agencyId),
    listAllClientRecords(dependencies, 'clientEngagements', agencyId),
  ]);
  const readiness = evaluateClientOnboarding(
    account as unknown as ClientAccount,
    contacts.filter((item) => item.clientAccountId === clientId) as unknown as ClientContact[],
    engagements.filter((item) => item.clientAccountId === clientId) as unknown as ClientEngagement[],
  );
  if (!readiness.readyForActivation) {
    throw new ApiError(422, 'CLIENT_ONBOARDING_INCOMPLETE', 'Client Account cannot be activated until onboarding blockers are resolved.', {
      blockers: readiness.blockers,
      warnings: readiness.warnings,
    });
  }
  const now = new Date().toISOString();
  const updated = await dependencies.repository.update(
    'clients',
    agencyId,
    clientId,
    {
      status: 'active',
      activatedAt: now,
      onboardingCompletedSteps: readiness.completedSteps,
      onboardingBlockers: [],
    },
    expectedVersion,
    actorId,
  );
  await timeline(dependencies, agencyId, clientId, actorId, 'client_activated', 'Client onboarding completed and account activated.');
  return updated;
}

async function offboardClient(
  dependencies: ApiDependencies,
  agencyId: string,
  clientId: string,
  expectedVersion: number,
  actorId: string,
  reason?: string,
): Promise<StoredRecord> {
  const account = await dependencies.repository.get('clients', agencyId, clientId);
  if (!account) throw new ApiError(404, 'CLIENT_NOT_FOUND', 'Client Account was not found.');
  const now = new Date().toISOString();
  const relationshipRecords = await listAllClientRecords(dependencies, 'propertyClientRelationships', agencyId);
  const affectedProperties = new Set<string>();
  for (const relationship of relationshipRecords) {
    if (relationship.clientAccountId !== clientId || relationship.isCurrent !== true) continue;
    affectedProperties.add(String(relationship.propertyId || ''));
    await dependencies.repository.update(
      'propertyClientRelationships',
      agencyId,
      relationship.id,
      { isCurrent: false, endDate: now.slice(0, 10), offboardingReason: reason || 'Client offboarded.' },
      Number(relationship.version),
      actorId,
    );
  }
  const portalUsers = await listAllClientRecords(dependencies, 'clientPortalUsers', agencyId);
  for (const portalUser of portalUsers) {
    if (portalUser.clientAccountId !== clientId || portalUser.status === 'revoked') continue;
    await dependencies.repository.update(
      'clientPortalUsers',
      agencyId,
      portalUser.id,
      { status: 'revoked', revokedAt: now, revokeReason: reason || 'Client offboarded.' },
      Number(portalUser.version),
      actorId,
    );
  }
  const updated = await dependencies.repository.update(
    'clients',
    agencyId,
    clientId,
    { status: 'inactive', offboardedAt: now, ...(reason ? { offboardingReason: reason } : {}) },
    expectedVersion,
    actorId,
  );
  for (const propertyId of affectedProperties) {
    if (propertyId) await syncPropertyClientContext(dependencies, { agencyId, propertyId, actorId });
  }
  await timeline(dependencies, agencyId, clientId, actorId, 'client_offboarded', reason || 'Client account offboarded.');
  return updated;
}

async function mergeClient(
  dependencies: ApiDependencies,
  agencyId: string,
  sourceClientId: string,
  targetClientId: string,
  expectedVersion: number,
  actorId: string,
): Promise<{ source: StoredRecord; target: StoredRecord; moved: number }> {
  if (!targetClientId || targetClientId === sourceClientId) throw new ApiError(400, 'MERGE_TARGET_INVALID', 'A different target Client Account is required.');
  const [source, target] = await Promise.all([
    dependencies.repository.get('clients', agencyId, sourceClientId),
    dependencies.repository.get('clients', agencyId, targetClientId),
  ]);
  if (!source || !target) throw new ApiError(404, 'CLIENT_NOT_FOUND', 'Source or target Client Account was not found.');
  const collections = ['clientContacts', 'clientEngagements', 'propertyClientRelationships', 'clientDocuments', 'clientPortalUsers', 'clientTimelineEvents'];
  const affectedProperties = new Set<string>();
  let moved = 0;
  for (const collection of collections) {
    const records = await listAllClientRecords(dependencies, collection, agencyId);
    for (const record of records) {
      if (record.clientAccountId !== sourceClientId) continue;
      if (collection === 'propertyClientRelationships' && typeof record.propertyId === 'string') affectedProperties.add(record.propertyId);
      await dependencies.repository.update(collection, agencyId, record.id, { clientAccountId: targetClientId }, Number(record.version), actorId);
      moved += 1;
    }
  }
  const sourceUpdated = await dependencies.repository.update(
    'clients',
    agencyId,
    sourceClientId,
    { status: 'archived', mergedIntoClientId: targetClientId, mergedAt: new Date().toISOString() },
    expectedVersion,
    actorId,
  );
  for (const propertyId of affectedProperties) {
    await syncPropertyClientContext(dependencies, { agencyId, propertyId, actorId });
  }
  await timeline(dependencies, agencyId, targetClientId, actorId, 'client_merged', `Merged Client Account ${sourceClientId} into this account.`, 'client', sourceClientId);
  return { source: sourceUpdated, target, moved };
}

interface ImportResult {
  row: number;
  status: 'ready' | 'created' | 'linked_existing' | 'review_required' | 'rejected';
  clientAccountId?: string;
  propertyId?: string;
  messages: string[];
}

async function bulkImport(
  dependencies: ApiDependencies,
  agencyId: string,
  rows: unknown[],
  actorId: string,
  dryRun: boolean,
): Promise<{ results: ImportResult[]; created: number; linkedExisting: number; reviewRequired: number; rejected: number }> {
  if (!Array.isArray(rows) || !rows.length) throw new ApiError(400, 'IMPORT_ROWS_REQUIRED', 'At least one Client import row is required.');
  if (rows.length > 5_000) throw new ApiError(400, 'IMPORT_TOO_LARGE', 'Client bulk imports are limited to 5,000 rows per batch.');
  const results: ImportResult[] = [];
  let created = 0;
  let linkedExisting = 0;
  let reviewRequired = 0;
  let rejected = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const raw = rows[index];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      results.push({ row: index + 2, status: 'rejected', messages: ['Row is not a valid object.'] });
      rejected += 1;
      continue;
    }
    const row = raw as Record<string, unknown>;
    const legalName = text(row.legalName || row.client || row.clientName || row.landlord || row.agency || row.name);
    if (!legalName) {
      results.push({ row: index + 2, status: 'rejected', messages: ['Client legal name is required.'] });
      rejected += 1;
      continue;
    }
    const type = accountType(row.clientType || row.type);
    const entity = entityType(row.entityType, type);
    const primaryEmail = email(row.primaryEmail || row.email || row.clientEmail || row.ownerEmail);
    const candidate: Partial<ClientAccount> & { primaryEmail?: string } = {
      legalName,
      tradingName: text(row.tradingName) || undefined,
      clientType: type,
      entityType: entity,
      abn: text(row.abn) || undefined,
      acn: text(row.acn) || undefined,
      ...(primaryEmail ? { primaryEmail } : {}),
    };
    const duplicates = await duplicateCandidates(dependencies, agencyId, candidate);
    const strongDuplicate = duplicates.find((item) => item.score >= 0.8);
    const possibleDuplicate = duplicates.find((item) => item.score >= 0.5);
    const propertyId = text(row.propertyId);
    if (possibleDuplicate && !strongDuplicate) {
      results.push({ row: index + 2, status: 'review_required', clientAccountId: possibleDuplicate.clientAccountId, ...(propertyId ? { propertyId } : {}), messages: [`Possible duplicate requires review: ${possibleDuplicate.reasons.join(', ')}`] });
      reviewRequired += 1;
      continue;
    }
    if (dryRun) {
      results.push({ row: index + 2, status: strongDuplicate ? 'linked_existing' : 'ready', clientAccountId: strongDuplicate?.clientAccountId, ...(propertyId ? { propertyId } : {}), messages: strongDuplicate ? [`Will use existing Client: ${strongDuplicate.reasons.join(', ')}`] : ['Ready to create Client Account.'] });
      continue;
    }
    let clientId = strongDuplicate?.clientAccountId;
    if (!clientId) {
      clientId = randomUUID();
      const contactId = randomUUID();
      const phone = text(row.primaryPhone || row.phone || row.ownerPhone);
      const billingMethod = text(row.billingMethod) || 'invoice_per_inspection';
      await dependencies.repository.create('clients', agencyId, clientId, {
        legalName,
        ...(text(row.tradingName) ? { tradingName: text(row.tradingName) } : {}),
        clientType: type,
        entityType: entity,
        ...(text(row.abn) ? { abn: text(row.abn) } : {}),
        ...(text(row.acn) ? { acn: text(row.acn) } : {}),
        ...(primaryEmail ? { generalEmail: primaryEmail } : {}),
        ...(phone ? { mainPhone: phone } : {}),
        primaryContactId: contactId,
        billingProfile: {
          method: billingMethod,
          ...(email(row.invoiceRecipientEmail || row.accountsEmail) ? { invoiceRecipientEmail: email(row.invoiceRecipientEmail || row.accountsEmail) } : primaryEmail ? { invoiceRecipientEmail: primaryEmail } : {}),
          ...(text(row.xeroContactId) ? { xeroContactId: text(row.xeroContactId) } : {}),
          ...(Number.isFinite(Number(row.paymentTermsDays)) ? { paymentTermsDays: Number(row.paymentTermsDays) } : {}),
        },
        maintenancePolicy: {
          ...(Number.isFinite(Number(row.propertyManagerApprovalLimit)) ? { propertyManagerApprovalLimit: Number(row.propertyManagerApprovalLimit) } : {}),
          ...(Number.isFinite(Number(row.landlordApprovalThreshold)) ? { landlordApprovalThreshold: Number(row.landlordApprovalThreshold) } : {}),
          ...(Number.isFinite(Number(row.emergencyAuthorisationLimit)) ? { emergencyAuthorisationLimit: Number(row.emergencyAuthorisationLimit) } : {}),
          ownerApprovalContactId: contactId,
          quoteContactId: contactId,
        },
        externalReferences: {
          ...(text(row.shopifyCustomerId) ? { shopifyCustomerIds: [text(row.shopifyCustomerId)] } : {}),
          ...(text(row.xeroContactId) ? { xeroContactId: text(row.xeroContactId) } : {}),
        },
        status: 'onboarding',
        name: text(row.tradingName) || legalName,
        email: primaryEmail,
        phone,
        type: legacyClientType(type),
        shopifyCustomerId: text(row.shopifyCustomerId) || undefined,
        defaultApprovalEmail: primaryEmail,
      }, actorId);
      await dependencies.repository.create('clientContacts', agencyId, contactId, {
        clientAccountId: clientId,
        displayName: text(row.primaryContactName || row.contactName) || legalName,
        ...(primaryEmail ? { email: primaryEmail } : {}),
        ...(phone ? { phone } : {}),
        roles: type === 'property_management_firm' ? ['property_manager'] : ['owner_landlord'],
        isPrimary: true,
        receivesReports: true,
        receivesMaintenance: true,
        receivesAccounts: true,
        canApproveMaintenance: true,
        status: 'active',
      }, actorId);
      await timeline(dependencies, agencyId, clientId, actorId, 'client_created', 'Client Account created by bulk import.');
      created += 1;
    } else {
      linkedExisting += 1;
    }
    if (propertyId) {
      const property = await dependencies.repository.get('properties', agencyId, propertyId);
      if (property) {
        const relationshipId = randomUUID();
        await dependencies.repository.create('propertyClientRelationships', agencyId, relationshipId, {
          propertyId,
          clientAccountId: clientId,
          relationshipType: relationshipType(row.relationshipType),
          isCurrent: true,
          ...(text(row.relationshipStartDate) ? { startDate: text(row.relationshipStartDate) } : {}),
          ...(Number.isFinite(Number(row.propertyManagerApprovalLimit)) ? { propertyManagerApprovalLimit: Number(row.propertyManagerApprovalLimit) } : {}),
        }, actorId);
        await syncPropertyClientContext(dependencies, { agencyId, propertyId, actorId });
      }
    }
    results.push({ row: index + 2, status: strongDuplicate ? 'linked_existing' : 'created', clientAccountId: clientId, ...(propertyId ? { propertyId } : {}), messages: [] });
  }
  return { results, created, linkedExisting, reviewRequired, rejected };
}

export async function routeClientManagementRequest(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
): Promise<ApiResponse | undefined> {
  const parts = routeParts(req);
  if (parts[0] !== 'api' || parts[1] !== 'v1') return undefined;
  const agencyId = agencyHeader(req);

  if (parts[2] === 'client-management') {
    if (parts[3] === 'property-context' && parts[4] && req.method === 'GET') {
      const propertyId = parts[4];
      const principal = await authenticateAndAuthorise(req, dependencies, 'client.read', { agencyId, propertyId }, correlationId);
      const context = await resolvePropertyClientContext(dependencies, agencyId, propertyId);
      return { status: 200, body: { data: context, meta: { correlationId, actor: principal.uid } } };
    }
    if (parts[3] === 'property-context' && parts[4] && parts[5] === 'sync' && req.method === 'POST') {
      const propertyId = parts[4];
      const body = await readJson(req);
      const principal = await authenticateAndAuthorise(req, dependencies, 'client.relationship.manage', { agencyId, propertyId }, correlationId);
      return idempotent(dependencies, req, agencyId, `client-property:${propertyId}:sync`, body, async () => ({
        status: 200,
        body: { data: await syncPropertyClientContext(dependencies, { agencyId, propertyId, actorId: principal.uid }), meta: { correlationId } },
      }));
    }
    if (parts[3] === 'jobs' && parts[4] && parts[5] === 'snapshot' && req.method === 'POST') {
      const jobId = parts[4];
      const body = await readJson(req);
      const job = await dependencies.repository.get('inspectionJobs', agencyId, jobId);
      if (!job) throw new ApiError(404, 'JOB_NOT_FOUND', 'Inspection Job was not found.');
      const principal = await authenticateAndAuthorise(req, dependencies, 'job.manage', { agencyId, inspectionJobId: jobId, ...(typeof job.propertyId === 'string' ? { propertyId: job.propertyId } : {}) }, correlationId);
      return idempotent(dependencies, req, agencyId, `client-job:${jobId}:snapshot`, body, async () => ({ status: 200, body: { data: await snapshotClientContextForJob(dependencies, agencyId, jobId, principal.uid), meta: { correlationId } } }));
    }
    if (parts[3] === 'reports' && parts[4] && parts[5] === 'snapshot' && req.method === 'POST') {
      const reportId = parts[4];
      const body = await readJson(req);
      const report = await dependencies.repository.get('reports', agencyId, reportId);
      if (!report) throw new ApiError(404, 'REPORT_NOT_FOUND', 'Report was not found.');
      const principal = await authenticateAndAuthorise(req, dependencies, 'report.edit', { agencyId, reportId, ...(typeof report.propertyId === 'string' ? { propertyId: report.propertyId } : {}), ...(typeof report.lifecycleStatus === 'string' ? { lifecycleStatus: report.lifecycleStatus } : {}) }, correlationId);
      return idempotent(dependencies, req, agencyId, `client-report:${reportId}:snapshot`, body, async () => ({ status: 200, body: { data: await snapshotClientContextForReport(dependencies, agencyId, reportId, principal.uid), meta: { correlationId } } }));
    }
    if (parts[3] === 'maintenance' && parts[4] && parts[5] === 'context' && req.method === 'GET') {
      const maintenanceItemId = parts[4];
      const amount = Number(new URL(req.url ?? '/', 'http://localhost').searchParams.get('amount') || 0);
      const item = await dependencies.repository.get('maintenanceItems', agencyId, maintenanceItemId);
      if (!item) throw new ApiError(404, 'MAINTENANCE_ITEM_NOT_FOUND', 'Maintenance Item was not found.');
      const principal = await authenticateAndAuthorise(req, dependencies, 'maintenance.read', { agencyId, maintenanceItemId, ...(typeof item.propertyId === 'string' ? { propertyId: item.propertyId } : {}) }, correlationId);
      return { status: 200, body: { data: await resolveMaintenanceClientContext(dependencies, agencyId, maintenanceItemId, Number.isFinite(amount) ? amount : 0), meta: { correlationId, actor: principal.uid } } };
    }
    if (parts[3] === 'duplicates' && req.method === 'POST') {
      const body = await readJson(req);
      const principal = await authenticateAndAuthorise(req, dependencies, 'client.read', { agencyId }, correlationId);
      const result = await duplicateCandidates(dependencies, agencyId, body as Partial<ClientAccount> & { primaryEmail?: string });
      return { status: 200, body: { data: result, meta: { correlationId, actor: principal.uid } } };
    }
    if (parts[3] === 'bulk-import' && req.method === 'POST') {
      const body = await readJson(req);
      const principal = await authenticateAndAuthorise(req, dependencies, 'client.manage', { agencyId }, correlationId);
      const rows = Array.isArray(body.rows) ? body.rows : [];
      const dryRun = body.dryRun !== false;
      return idempotent(dependencies, req, agencyId, `clients:bulk-import:${dryRun ? 'dry-run' : 'commit'}`, body, async () => ({ status: 200, body: { data: await bulkImport(dependencies, agencyId, rows, principal.uid, dryRun), meta: { correlationId } } }));
    }
    if (parts[3] === 'clients' && parts[4] && parts[5] === 'overview' && req.method === 'GET') {
      const clientId = parts[4];
      const principal = await authenticateAndAuthorise(req, dependencies, 'client.read', { agencyId, clientAccountId: clientId }, correlationId);
      return { status: 200, body: { data: await clientOverview(dependencies, agencyId, clientId), meta: { correlationId, actor: principal.uid } } };
    }
    if (parts[3] === 'clients' && parts[4] && parts[5] === 'actions' && parts[6] && req.method === 'POST') {
      const clientId = parts[4];
      const action = parts[6];
      const body = await readJson(req);
      const principal = await authenticateAndAuthorise(req, dependencies, 'client.manage', { agencyId, clientAccountId: clientId }, correlationId);
      return idempotent(dependencies, req, agencyId, `client:${clientId}:${action}`, body, async () => {
        if (action === 'activate') {
          return { status: 200, body: { data: await activateClient(dependencies, agencyId, clientId, version(body.expectedVersion), principal.uid), meta: { correlationId } } };
        }
        if (action === 'offboard') {
          return { status: 200, body: { data: await offboardClient(dependencies, agencyId, clientId, version(body.expectedVersion), principal.uid, text(body.reason) || undefined), meta: { correlationId } } };
        }
        if (action === 'merge') {
          return { status: 200, body: { data: await mergeClient(dependencies, agencyId, clientId, text(body.targetClientId), version(body.expectedVersion), principal.uid), meta: { correlationId } } };
        }
        throw new ApiError(404, 'CLIENT_ACTION_NOT_FOUND', 'Client action was not found.');
      });
    }
    if (parts[3] === 'properties' && parts[4] && parts[5] === 'migrate-legacy' && req.method === 'POST') {
      const propertyId = parts[4];
      const body = await readJson(req);
      const principal = await authenticateAndAuthorise(req, dependencies, 'client.manage', { agencyId, propertyId }, correlationId);
      return idempotent(dependencies, req, agencyId, `client-property:${propertyId}:migrate-legacy`, body, async () => ({ status: 201, body: { data: await createLegacyLandlordClient(dependencies, { agencyId, propertyId, actorId: principal.uid }), meta: { correlationId } } }));
    }
    return undefined;
  }

  if (parts[2] === 'clients' && parts[3] && parts[4] === 'documents') {
    const clientId = parts[3];
    const client = await dependencies.repository.get('clients', agencyId, clientId);
    if (!client) throw new ApiError(404, 'CLIENT_NOT_FOUND', 'Client Account was not found.');

    if (req.method === 'POST' && parts[5] === 'upload-session' && parts.length === 6) {
      const body = await readJson(req);
      const principal = await authenticateAndAuthorise(req, dependencies, 'client.document.manage', { agencyId, clientAccountId: clientId }, correlationId);
      const fileName = cleanFileName(text(body.fileName));
      const contentType = text(body.contentType).toLowerCase();
      const fileSize = Number(body.fileSize);
      const hash = sha256(body.sha256);
      if (!DOCUMENT_CONTENT_TYPES.has(contentType)) throw new ApiError(400, 'CLIENT_DOCUMENT_CONTENT_TYPE_UNSUPPORTED', 'Client document type is not supported.');
      if (!Number.isInteger(fileSize) || fileSize < 1 || fileSize > MAX_CLIENT_DOCUMENT_BYTES) throw new ApiError(400, 'CLIENT_DOCUMENT_FILE_SIZE_INVALID', 'Client documents must be between 1 byte and 150 MB.');
      const bucketName = process.env.UPLOAD_BUCKET?.trim();
      if (!bucketName) throw new ApiError(503, 'UPLOAD_BUCKET_REQUIRED', 'UPLOAD_BUCKET is required before Client documents can be uploaded.');
      const uploadId = randomUUID();
      const extension = fileName.includes('.') ? fileName.split('.').pop() : 'bin';
      const objectPath = `client-documents/${agencyId}/${clientId}/${uploadId}/${hash}.${extension}`;
      const file = getStorage(adminApp()).bucket(bucketName).file(objectPath);
      const [resumableUploadUrl] = await file.createResumableUpload({
        metadata: { contentType, metadata: { agencyId, clientAccountId: clientId, uploadId, sha256: hash, immutableOriginal: 'true', clientDocument: 'true' } },
        preconditionOpts: { ifGenerationMatch: 0 },
      });
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      await dependencies.repository.create('clientDocumentUploads', agencyId, uploadId, { clientAccountId: clientId, fileName, contentType, fileSize, sha256: hash, objectPath, status: 'issued', expiresAt }, principal.uid);
      return { status: 201, body: { data: { uploadId, objectPath, resumableUploadUrl, expiresAt }, meta: { correlationId } } };
    }

    if (req.method === 'POST' && parts[5] && parts[6] === 'complete' && parts.length === 7) {
      const uploadId = parts[5];
      const body = await readJson(req);
      const principal = await authenticateAndAuthorise(req, dependencies, 'client.document.manage', { agencyId, clientAccountId: clientId }, correlationId);
      const upload = await dependencies.repository.get('clientDocumentUploads', agencyId, uploadId);
      if (!upload || upload.clientAccountId !== clientId) throw new ApiError(404, 'CLIENT_DOCUMENT_UPLOAD_NOT_FOUND', 'Client document upload session was not found.');
      if (upload.status === 'complete' && upload.documentId) {
        const existing = await dependencies.repository.get('clientDocuments', agencyId, String(upload.documentId));
        if (existing) return { status: 200, body: { data: existing, meta: { correlationId, replayed: true } } };
      }
      const bucketName = process.env.UPLOAD_BUCKET?.trim();
      if (!bucketName) throw new ApiError(503, 'UPLOAD_BUCKET_REQUIRED', 'UPLOAD_BUCKET is required.');
      const objectPath = String(upload.objectPath || '');
      const file = getStorage(adminApp()).bucket(bucketName).file(objectPath);
      const [metadata] = await file.getMetadata().catch(() => { throw new ApiError(422, 'CLIENT_DOCUMENT_OBJECT_NOT_FOUND', 'Uploaded Client document could not be verified.'); });
      const generation = String(metadata.generation || '');
      if (!generation || Number(metadata.size) !== Number(upload.fileSize)) throw new ApiError(422, 'CLIENT_DOCUMENT_SIZE_MISMATCH', 'Uploaded Client document does not match its upload session.');
      const [bytes] = await file.download({ validation: false });
      const actualHash = createHash('sha256').update(bytes).digest('hex');
      if (actualHash !== upload.sha256) throw new ApiError(422, 'CLIENT_DOCUMENT_HASH_MISMATCH', 'Uploaded Client document failed SHA-256 verification.');
      const now = new Date().toISOString();
      const documentId = randomUUID();
      const record: Omit<ClientDocument, 'createdAt' | 'updatedAt' | 'version'> = {
        id: documentId,
        agencyId,
        clientAccountId: clientId,
        type: documentType(body.type),
        title: text(body.title) || String(upload.fileName),
        fileName: String(upload.fileName),
        contentType: String(upload.contentType),
        fileSize: Number(upload.fileSize),
        objectPath,
        generation,
        sha256: actualHash,
        ...(text(body.effectiveFrom) ? { effectiveFrom: text(body.effectiveFrom) } : {}),
        ...(text(body.expiresAt) ? { expiresAt: text(body.expiresAt) } : {}),
        signedStatus: ['pending', 'signed', 'expired'].includes(text(body.signedStatus)) ? text(body.signedStatus) as 'pending' | 'signed' | 'expired' : 'not_required',
        ...(text(body.supersedesDocumentId) ? { supersedesDocumentId: text(body.supersedesDocumentId) } : {}),
        uploadedBy: principal.uid,
        uploadedAt: now,
        status: 'active',
      };
      const stored = await dependencies.repository.create('clientDocuments', agencyId, documentId, record as unknown as Record<string, unknown>, principal.uid);
      if (record.supersedesDocumentId) {
        const previous = await dependencies.repository.get('clientDocuments', agencyId, record.supersedesDocumentId);
        if (previous && previous.clientAccountId === clientId) {
          await dependencies.repository.update('clientDocuments', agencyId, previous.id, { status: 'superseded', supersededByDocumentId: documentId }, Number(previous.version), principal.uid);
        }
      }
      await dependencies.repository.update('clientDocumentUploads', agencyId, uploadId, { status: 'complete', documentId, generation, completedAt: now }, Number(upload.version), principal.uid);
      await timeline(dependencies, agencyId, clientId, principal.uid, 'document_uploaded', `Uploaded Client document: ${record.title}`, 'client_document', documentId);
      return { status: 201, body: { data: stored, meta: { correlationId } } };
    }
  }

  return undefined;
}
