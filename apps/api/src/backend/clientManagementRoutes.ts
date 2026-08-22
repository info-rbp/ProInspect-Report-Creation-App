import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import {
  CLIENT_DOCUMENT_TYPES,
  type ClientAccount,
  type ClientDocument,
  type ClientDocumentType,
  type MaintenanceQuote,
} from '@pcr/domain';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import {
  activateClientAccount,
  appendClientTimelineEvent,
  bulkImportClientRows,
  mergeClientAccountsCommand,
  offboardClientAccount,
} from '../services/clientManagementCommands.js';
import {
  clientOverview,
  createLegacyLandlordClient,
  duplicateCandidates,
  resolveMaintenanceClientContext,
  resolvePropertyClientContext,
  snapshotClientContextForJob,
  snapshotClientContextForReport,
  syncPropertyClientContext,
} from '../services/clientManagementService.js';
import { sendMaintenanceQuoteForApproval } from '../services/maintenanceCommercialService.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies, IdempotencyResult } from './types.js';

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
  return new URL(req.url ?? '/', 'http://localhost')
    .pathname
    .split('/')
    .filter(Boolean)
    .map(decodeURIComponent);
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
    if (size > MAX_BODY_BYTES) {
      throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Client command exceeds 5 MB.');
    }
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

function expectedVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new ApiError(400, 'EXPECTED_VERSION_REQUIRED', 'expectedVersion must be a positive integer.');
  }
  return value;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanFileName(value: string): string {
  const base = value.trim().split(/[\\/]/u).pop() || 'client-document';
  return base.replace(/[^a-zA-Z0-9._ -]+/gu, '_').slice(0, 180) || 'client-document';
}

function validSha256(value: unknown): string {
  const candidate = text(value).toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(candidate)) {
    throw new ApiError(400, 'SHA256_REQUIRED', 'A valid SHA-256 digest is required.');
  }
  return candidate;
}

function clientDocumentType(value: unknown): ClientDocumentType {
  const candidate = text(value);
  return (CLIENT_DOCUMENT_TYPES as readonly string[]).includes(candidate)
    ? candidate as ClientDocumentType
    : 'other';
}

async function routeAutomaticMaintenanceApproval(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
  parts: string[],
  agencyId: string,
): Promise<ApiResponse | undefined> {
  if (
    parts[2] !== 'maintenance-quotes' ||
    !parts[3] ||
    parts[4] !== 'actions' ||
    parts[5] !== 'send'
  ) {
    return undefined;
  }
  if (req.method !== 'POST') {
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Maintenance quote sending requires POST.');
  }
  const quoteId = parts[3];
  const quoteRecord = await dependencies.repository.get('maintenanceQuotes', agencyId, quoteId);
  if (!quoteRecord) throw new ApiError(404, 'QUOTE_NOT_FOUND', 'Maintenance quote was not found.');
  const quote = quoteRecord as unknown as MaintenanceQuote;
  const item = await dependencies.repository.get('maintenanceItems', agencyId, quote.maintenanceItemId);
  if (!item) throw new ApiError(404, 'MAINTENANCE_ITEM_NOT_FOUND', 'Maintenance item was not found.');
  const principal = await authenticateAndAuthorise(
    req,
    dependencies,
    'maintenance.quote.send',
    {
      agencyId,
      propertyId: quote.propertyId,
      maintenanceItemId: quote.maintenanceItemId,
      maintenanceQuoteId: quoteId,
    },
    correlationId,
  );
  const body = await readJson(req);
  return idempotent(
    dependencies,
    req,
    agencyId,
    `maintenance-quote:${quoteId}:client-aware-send`,
    body,
    async () => {
      const clientContext = await resolveMaintenanceClientContext(
        dependencies,
        agencyId,
        quote.maintenanceItemId,
        Number(quote.total || 0),
      );
      const automaticRecipient = clientContext.approval.recipient;
      const explicitRecipientEmail = text(body.recipientEmail).toLowerCase();
      const recipientEmail = explicitRecipientEmail || automaticRecipient?.email || quote.recipientEmail || '';
      const result = await sendMaintenanceQuoteForApproval(dependencies, {
        agencyId,
        quoteId,
        expectedVersion: expectedVersion(body.expectedVersion),
        actorId: principal.uid,
        actorRole: principal.role,
        correlationId,
        recipientEmail,
      });

      const approvalContact = automaticRecipient?.contactId
        ? clientContext.context.contacts.find((contact) => contact.id === automaticRecipient.contactId)
        : undefined;
      let approval = result.approval;
      if (approvalContact) {
        const approvalRecord = await dependencies.repository.get('clientApprovals', agencyId, result.approval.id);
        if (approvalRecord) {
          approval = await dependencies.repository.update(
            'clientApprovals',
            agencyId,
            result.approval.id,
            {
              clientId: approvalContact.clientAccountId,
              clientContactId: approvalContact.id,
              approvalRoutingReasons: clientContext.approval.reasons,
            },
            Number(approvalRecord.version),
            principal.uid,
          ) as unknown as typeof result.approval;
        }
      }

      const sentQuoteRecord = await dependencies.repository.get('maintenanceQuotes', agencyId, quoteId);
      let sentQuote = result.quote;
      if (sentQuoteRecord && clientContext.context.snapshot) {
        sentQuote = await dependencies.repository.update(
          'maintenanceQuotes',
          agencyId,
          quoteId,
          {
            clientId: approvalContact?.clientAccountId || clientContext.context.snapshot.clientAccountId,
            ...(approvalContact ? { clientContactId: approvalContact.id } : {}),
            clientSnapshot: clientContext.context.snapshot,
            approvalRoutingReasons: clientContext.approval.reasons,
          },
          Number(sentQuoteRecord.version),
          principal.uid,
        ) as unknown as MaintenanceQuote;
      }

      return {
        status: 200,
        body: {
          data: {
            ...result,
            quote: sentQuote,
            approval,
            approvalRouting: {
              recipientType: clientContext.approval.recipientType,
              recipient: automaticRecipient,
              reasons: clientContext.approval.reasons,
              manuallyOverridden: Boolean(explicitRecipientEmail),
            },
          },
          meta: { correlationId },
        },
      };
    },
  );
}

async function routeClientDocuments(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
  parts: string[],
  agencyId: string,
): Promise<ApiResponse | undefined> {
  if (parts[2] !== 'clients' || !parts[3] || parts[4] !== 'documents') return undefined;
  const clientId = parts[3];
  const client = await dependencies.repository.get('clients', agencyId, clientId);
  if (!client) throw new ApiError(404, 'CLIENT_NOT_FOUND', 'Client Account was not found.');

  if (req.method === 'POST' && parts[5] === 'upload-session' && parts.length === 6) {
    const body = await readJson(req);
    const principal = await authenticateAndAuthorise(
      req,
      dependencies,
      'client.document.manage',
      { agencyId, clientAccountId: clientId },
      correlationId,
    );
    const fileName = cleanFileName(text(body.fileName));
    const contentType = text(body.contentType).toLowerCase();
    const fileSize = Number(body.fileSize);
    const hash = validSha256(body.sha256);
    if (!DOCUMENT_CONTENT_TYPES.has(contentType)) {
      throw new ApiError(400, 'CLIENT_DOCUMENT_CONTENT_TYPE_UNSUPPORTED', 'Client document type is not supported.');
    }
    if (!Number.isInteger(fileSize) || fileSize < 1 || fileSize > MAX_CLIENT_DOCUMENT_BYTES) {
      throw new ApiError(400, 'CLIENT_DOCUMENT_FILE_SIZE_INVALID', 'Client documents must be between 1 byte and 150 MB.');
    }
    const bucketName = process.env.UPLOAD_BUCKET?.trim();
    if (!bucketName) {
      throw new ApiError(503, 'UPLOAD_BUCKET_REQUIRED', 'UPLOAD_BUCKET is required before Client documents can be uploaded.');
    }
    const uploadId = randomUUID();
    const extension = fileName.includes('.') ? fileName.split('.').pop() : 'bin';
    const objectPath = `client-documents/${agencyId}/${clientId}/${uploadId}/${hash}.${extension}`;
    const file = getStorage(adminApp()).bucket(bucketName).file(objectPath);
    const [resumableUploadUrl] = await file.createResumableUpload({
      metadata: {
        contentType,
        metadata: {
          agencyId,
          clientAccountId: clientId,
          uploadId,
          sha256: hash,
          immutableOriginal: 'true',
          clientDocument: 'true',
        },
      },
      preconditionOpts: { ifGenerationMatch: 0 },
    });
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await dependencies.repository.create(
      'clientDocumentUploads',
      agencyId,
      uploadId,
      {
        clientAccountId: clientId,
        fileName,
        contentType,
        fileSize,
        sha256: hash,
        objectPath,
        status: 'issued',
        expiresAt,
      },
      principal.uid,
    );
    return {
      status: 201,
      body: { data: { uploadId, objectPath, resumableUploadUrl, expiresAt }, meta: { correlationId } },
    };
  }

  if (req.method === 'POST' && parts[5] && parts[6] === 'complete' && parts.length === 7) {
    const uploadId = parts[5];
    const body = await readJson(req);
    const principal = await authenticateAndAuthorise(
      req,
      dependencies,
      'client.document.manage',
      { agencyId, clientAccountId: clientId },
      correlationId,
    );
    const upload = await dependencies.repository.get('clientDocumentUploads', agencyId, uploadId);
    if (!upload || upload.clientAccountId !== clientId) {
      throw new ApiError(404, 'CLIENT_DOCUMENT_UPLOAD_NOT_FOUND', 'Client document upload session was not found.');
    }
    if (upload.status === 'complete' && upload.documentId) {
      const existing = await dependencies.repository.get('clientDocuments', agencyId, String(upload.documentId));
      if (existing) return { status: 200, body: { data: existing, meta: { correlationId, replayed: true } } };
    }
    const bucketName = process.env.UPLOAD_BUCKET?.trim();
    if (!bucketName) throw new ApiError(503, 'UPLOAD_BUCKET_REQUIRED', 'UPLOAD_BUCKET is required.');
    const objectPath = String(upload.objectPath || '');
    const file = getStorage(adminApp()).bucket(bucketName).file(objectPath);
    const [metadata] = await file.getMetadata().catch(() => {
      throw new ApiError(422, 'CLIENT_DOCUMENT_OBJECT_NOT_FOUND', 'Uploaded Client document could not be verified.');
    });
    const generation = String(metadata.generation || '');
    if (!generation || Number(metadata.size) !== Number(upload.fileSize)) {
      throw new ApiError(422, 'CLIENT_DOCUMENT_SIZE_MISMATCH', 'Uploaded Client document does not match its upload session.');
    }
    const [bytes] = await file.download({ validation: false });
    const actualHash = createHash('sha256').update(bytes).digest('hex');
    if (actualHash !== upload.sha256) {
      throw new ApiError(422, 'CLIENT_DOCUMENT_HASH_MISMATCH', 'Uploaded Client document failed SHA-256 verification.');
    }
    const now = new Date().toISOString();
    const documentId = randomUUID();
    const record: Omit<ClientDocument, 'createdAt' | 'updatedAt' | 'version'> = {
      id: documentId,
      agencyId,
      clientAccountId: clientId,
      type: clientDocumentType(body.type),
      title: text(body.title) || String(upload.fileName),
      fileName: String(upload.fileName),
      contentType: String(upload.contentType),
      fileSize: Number(upload.fileSize),
      objectPath,
      generation,
      sha256: actualHash,
      ...(text(body.effectiveFrom) ? { effectiveFrom: text(body.effectiveFrom) } : {}),
      ...(text(body.expiresAt) ? { expiresAt: text(body.expiresAt) } : {}),
      signedStatus: ['pending', 'signed', 'expired'].includes(text(body.signedStatus))
        ? text(body.signedStatus) as 'pending' | 'signed' | 'expired'
        : 'not_required',
      ...(text(body.supersedesDocumentId) ? { supersedesDocumentId: text(body.supersedesDocumentId) } : {}),
      uploadedBy: principal.uid,
      uploadedAt: now,
      status: 'active',
    };
    const stored = await dependencies.repository.create(
      'clientDocuments',
      agencyId,
      documentId,
      record as unknown as Record<string, unknown>,
      principal.uid,
    );
    if (record.supersedesDocumentId) {
      const previous = await dependencies.repository.get('clientDocuments', agencyId, record.supersedesDocumentId);
      if (previous && previous.clientAccountId === clientId) {
        await dependencies.repository.update(
          'clientDocuments',
          agencyId,
          previous.id,
          { status: 'superseded', supersededByDocumentId: documentId },
          Number(previous.version),
          principal.uid,
        );
      }
    }
    await dependencies.repository.update(
      'clientDocumentUploads',
      agencyId,
      uploadId,
      { status: 'complete', documentId, generation, completedAt: now },
      Number(upload.version),
      principal.uid,
    );
    await appendClientTimelineEvent(
      dependencies,
      agencyId,
      clientId,
      principal.uid,
      'document_uploaded',
      `Uploaded Client document: ${record.title}`,
      'client_document',
      documentId,
    );
    return { status: 201, body: { data: stored, meta: { correlationId } } };
  }

  return undefined;
}

export async function routeClientManagementRequest(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
): Promise<ApiResponse | undefined> {
  const parts = routeParts(req);
  if (parts[0] !== 'api' || parts[1] !== 'v1') return undefined;
  const agencyId = agencyHeader(req);

  const maintenanceSend = await routeAutomaticMaintenanceApproval(
    req,
    dependencies,
    correlationId,
    parts,
    agencyId,
  );
  if (maintenanceSend) return maintenanceSend;

  const clientDocumentResponse = await routeClientDocuments(
    req,
    dependencies,
    correlationId,
    parts,
    agencyId,
  );
  if (clientDocumentResponse) return clientDocumentResponse;

  if (parts[2] !== 'client-management') return undefined;

  if (parts[3] === 'property-context' && parts[4] && req.method === 'GET') {
    const propertyId = parts[4];
    const principal = await authenticateAndAuthorise(
      req,
      dependencies,
      'client.read',
      { agencyId, propertyId },
      correlationId,
    );
    const context = await resolvePropertyClientContext(dependencies, agencyId, propertyId);
    return { status: 200, body: { data: context, meta: { correlationId, actor: principal.uid } } };
  }

  if (parts[3] === 'property-context' && parts[4] && parts[5] === 'sync' && req.method === 'POST') {
    const propertyId = parts[4];
    const body = await readJson(req);
    const principal = await authenticateAndAuthorise(
      req,
      dependencies,
      'client.relationship.manage',
      { agencyId, propertyId },
      correlationId,
    );
    return idempotent(
      dependencies,
      req,
      agencyId,
      `client-property:${propertyId}:sync`,
      body,
      async () => ({
        status: 200,
        body: {
          data: await syncPropertyClientContext(dependencies, { agencyId, propertyId, actorId: principal.uid }),
          meta: { correlationId },
        },
      }),
    );
  }

  if (parts[3] === 'jobs' && parts[4] && parts[5] === 'snapshot' && req.method === 'POST') {
    const jobId = parts[4];
    const body = await readJson(req);
    const job = await dependencies.repository.get('inspectionJobs', agencyId, jobId);
    if (!job) throw new ApiError(404, 'JOB_NOT_FOUND', 'Inspection Job was not found.');
    const principal = await authenticateAndAuthorise(
      req,
      dependencies,
      'job.manage',
      {
        agencyId,
        inspectionJobId: jobId,
        ...(typeof job.propertyId === 'string' ? { propertyId: job.propertyId } : {}),
      },
      correlationId,
    );
    return idempotent(dependencies, req, agencyId, `client-job:${jobId}:snapshot`, body, async () => ({
      status: 200,
      body: {
        data: await snapshotClientContextForJob(dependencies, agencyId, jobId, principal.uid),
        meta: { correlationId },
      },
    }));
  }

  if (parts[3] === 'reports' && parts[4] && parts[5] === 'snapshot' && req.method === 'POST') {
    const reportId = parts[4];
    const body = await readJson(req);
    const report = await dependencies.repository.get('reports', agencyId, reportId);
    if (!report) throw new ApiError(404, 'REPORT_NOT_FOUND', 'Report was not found.');
    const principal = await authenticateAndAuthorise(
      req,
      dependencies,
      'report.edit',
      {
        agencyId,
        reportId,
        ...(typeof report.propertyId === 'string' ? { propertyId: report.propertyId } : {}),
        ...(typeof report.lifecycleStatus === 'string' ? { lifecycleStatus: report.lifecycleStatus } : {}),
      },
      correlationId,
    );
    return idempotent(dependencies, req, agencyId, `client-report:${reportId}:snapshot`, body, async () => ({
      status: 200,
      body: {
        data: await snapshotClientContextForReport(dependencies, agencyId, reportId, principal.uid),
        meta: { correlationId },
      },
    }));
  }

  if (parts[3] === 'maintenance' && parts[4] && parts[5] === 'context' && req.method === 'GET') {
    const maintenanceItemId = parts[4];
    const amount = Number(new URL(req.url ?? '/', 'http://localhost').searchParams.get('amount') || 0);
    const item = await dependencies.repository.get('maintenanceItems', agencyId, maintenanceItemId);
    if (!item) throw new ApiError(404, 'MAINTENANCE_ITEM_NOT_FOUND', 'Maintenance Item was not found.');
    const principal = await authenticateAndAuthorise(
      req,
      dependencies,
      'maintenance.read',
      {
        agencyId,
        maintenanceItemId,
        ...(typeof item.propertyId === 'string' ? { propertyId: item.propertyId } : {}),
      },
      correlationId,
    );
    return {
      status: 200,
      body: {
        data: await resolveMaintenanceClientContext(
          dependencies,
          agencyId,
          maintenanceItemId,
          Number.isFinite(amount) ? amount : 0,
        ),
        meta: { correlationId, actor: principal.uid },
      },
    };
  }

  if (parts[3] === 'duplicates' && req.method === 'POST') {
    const body = await readJson(req);
    const principal = await authenticateAndAuthorise(req, dependencies, 'client.read', { agencyId }, correlationId);
    const result = await duplicateCandidates(
      dependencies,
      agencyId,
      body as Partial<ClientAccount> & { primaryEmail?: string },
    );
    return { status: 200, body: { data: result, meta: { correlationId, actor: principal.uid } } };
  }

  if (parts[3] === 'bulk-import' && req.method === 'POST') {
    const body = await readJson(req);
    const principal = await authenticateAndAuthorise(req, dependencies, 'client.manage', { agencyId }, correlationId);
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const dryRun = body.dryRun !== false;
    return idempotent(
      dependencies,
      req,
      agencyId,
      `clients:bulk-import:${dryRun ? 'dry-run' : 'commit'}`,
      body,
      async () => ({
        status: 200,
        body: {
          data: await bulkImportClientRows(dependencies, agencyId, rows, principal.uid, dryRun),
          meta: { correlationId },
        },
      }),
    );
  }

  if (parts[3] === 'clients' && parts[4] && parts[5] === 'overview' && req.method === 'GET') {
    const clientId = parts[4];
    const principal = await authenticateAndAuthorise(
      req,
      dependencies,
      'client.read',
      { agencyId, clientAccountId: clientId },
      correlationId,
    );
    return {
      status: 200,
      body: {
        data: await clientOverview(dependencies, agencyId, clientId),
        meta: { correlationId, actor: principal.uid },
      },
    };
  }

  if (parts[3] === 'clients' && parts[4] && parts[5] === 'actions' && parts[6] && req.method === 'POST') {
    const clientId = parts[4];
    const action = parts[6];
    const body = await readJson(req);
    const principal = await authenticateAndAuthorise(
      req,
      dependencies,
      'client.manage',
      { agencyId, clientAccountId: clientId },
      correlationId,
    );
    return idempotent(dependencies, req, agencyId, `client:${clientId}:${action}`, body, async () => {
      if (action === 'activate') {
        return {
          status: 200,
          body: {
            data: await activateClientAccount(
              dependencies,
              agencyId,
              clientId,
              expectedVersion(body.expectedVersion),
              principal.uid,
            ),
            meta: { correlationId },
          },
        };
      }
      if (action === 'offboard') {
        return {
          status: 200,
          body: {
            data: await offboardClientAccount(
              dependencies,
              agencyId,
              clientId,
              expectedVersion(body.expectedVersion),
              principal.uid,
              text(body.reason) || undefined,
            ),
            meta: { correlationId },
          },
        };
      }
      if (action === 'merge') {
        return {
          status: 200,
          body: {
            data: await mergeClientAccountsCommand(
              dependencies,
              agencyId,
              clientId,
              text(body.targetClientId),
              expectedVersion(body.expectedVersion),
              principal.uid,
            ),
            meta: { correlationId },
          },
        };
      }
      throw new ApiError(404, 'CLIENT_ACTION_NOT_FOUND', 'Client action was not found.');
    });
  }

  if (parts[3] === 'properties' && parts[4] && parts[5] === 'migrate-legacy' && req.method === 'POST') {
    const propertyId = parts[4];
    const body = await readJson(req);
    const principal = await authenticateAndAuthorise(
      req,
      dependencies,
      'client.manage',
      { agencyId, propertyId },
      correlationId,
    );
    return idempotent(
      dependencies,
      req,
      agencyId,
      `client-property:${propertyId}:migrate-legacy`,
      body,
      async () => ({
        status: 201,
        body: {
          data: await createLegacyLandlordClient(dependencies, {
            agencyId,
            propertyId,
            actorId: principal.uid,
          }),
          meta: { correlationId },
        },
      }),
    );
  }

  return undefined;
}
