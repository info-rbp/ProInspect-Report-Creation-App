import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies, StoredRecord } from './types.js';

function adminApp() {
  return getApps()[0] ?? initializeApp({ credential: applicationDefault() });
}

function agencyHeader(req: IncomingMessage): string {
  const agencyId = req.headers['x-agency-id']?.toString().trim();
  if (!agencyId) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.');
  return agencyId;
}

async function readJson(req: IncomingMessage, maxBytes = 10 * 1024 * 1024): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > maxBytes) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Document request is too large.');
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Object required');
    return parsed as Record<string, unknown>;
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function ascii(value: string): string {
  return value
    .replace(/[‘’]/gu, "'")
    .replace(/[“”]/gu, '"')
    .replace(/[–—]/gu, '-')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E\n]/gu, '');
}

function pdfEscape(value: string): string {
  return ascii(value).replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}

function wrapText(source: string, width = 88): string[] {
  const output: string[] = [];
  for (const paragraph of ascii(source).replaceAll('\r\n', '\n').split('\n')) {
    if (!paragraph.trim()) {
      output.push('');
      continue;
    }
    let line = '';
    for (const word of paragraph.split(/\s+/u)) {
      if (!line) line = word;
      else if (`${line} ${word}`.length <= width) line += ` ${word}`;
      else {
        output.push(line);
        line = word;
      }
    }
    if (line) output.push(line);
  }
  return output;
}

function buildPdf(title: string, content: string): Buffer {
  const allLines = [ascii(title), '', ...wrapText(content || title)];
  const pageLines: string[][] = [];
  for (let index = 0; index < allLines.length; index += 48) pageLines.push(allLines.slice(index, index + 48));
  if (!pageLines.length) pageLines.push([ascii(title)]);

  const pageObjectIds = pageLines.map((_, index) => 5 + index * 2);
  const objectCount = 3 + pageLines.length * 2;
  const objects = new Map<number, string>();
  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objects.set(2, `<< /Type /Pages /Count ${pageObjectIds.length} /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] >>`);
  objects.set(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  pageLines.forEach((lines, pageIndex) => {
    const contentObjectId = 4 + pageIndex * 2;
    const pageObjectId = 5 + pageIndex * 2;
    const commands: string[] = ['BT', '/F1 11 Tf', '50 790 Td', '14 TL'];
    lines.forEach((line, lineIndex) => {
      if (lineIndex === 0) commands.push('/F1 16 Tf');
      else if (lineIndex === 1) commands.push('/F1 11 Tf');
      commands.push(`(${pdfEscape(line)}) Tj`, 'T*');
    });
    commands.push('ET');
    const stream = commands.join('\n');
    objects.set(contentObjectId, `<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}\nendstream`);
    objects.set(pageObjectId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectId} 0 R >>`);
  });

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = new Array(objectCount + 1).fill(0);
  for (let id = 1; id <= objectCount; id += 1) {
    const object = objects.get(id);
    if (!object) throw new Error(`Missing PDF object ${id}.`);
    offsets[id] = Buffer.byteLength(pdf, 'ascii');
    pdf += `${id} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'ascii');
  pdf += `xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= objectCount; id += 1) pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'ascii');
}

async function storeArtifact(agencyId: string, documentId: string, documentVersion: number, title: string, content: string, fileBase64?: string) {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT?.trim();
  const bucketName = process.env.REPORT_BUCKET?.trim() || (projectId ? `${projectId}-reports` : '');
  if (!bucketName) throw new ApiError(503, 'REPORT_BUCKET_REQUIRED', 'A tenancy document storage bucket is required.');
  let bytes: Buffer;
  if (fileBase64) {
    bytes = Buffer.from(fileBase64, 'base64');
    if (!bytes.length || bytes.length > 6 * 1024 * 1024) throw new ApiError(400, 'DOCUMENT_SIZE_INVALID', 'Uploaded PDF must be between 1 byte and 6 MB.');
    if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw new ApiError(400, 'DOCUMENT_PDF_REQUIRED', 'Uploaded tenancy documents must be PDF files.');
  } else {
    if (!content.trim()) throw new ApiError(400, 'DOCUMENT_CONTENT_REQUIRED', 'Document content is required when no PDF is uploaded.');
    bytes = buildPdf(title, content);
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const objectPath = `agencies/${agencyId}/tenancy-documents/${documentId}/v${documentVersion}-${sha256.slice(0, 16)}.pdf`;
  const file = getStorage(adminApp()).bucket(bucketName).file(objectPath);
  await file.save(bytes, {
    resumable: false,
    contentType: 'application/pdf',
    metadata: { cacheControl: 'private, max-age=0, no-store', metadata: { sha256, documentId, documentVersion: String(documentVersion) } },
  });
  const [metadata] = await file.getMetadata();
  return { objectPath, sha256, generation: String(metadata.generation || '') };
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

function webBaseUrl(): string {
  const configured = process.env.WEB_APP_BASE_URL?.trim().replace(/\/$/u, '');
  if (configured) return configured;
  const projectId = process.env.GOOGLE_CLOUD_PROJECT?.trim();
  return projectId ? `https://${projectId}.web.app` : '';
}

async function createPortalGrant(dependencies: ApiDependencies, agencyId: string, tenantId: string, tenancyId: string, recipientEmail: string, actorId: string) {
  const rawToken = `${randomUUID()}${randomUUID().replaceAll('-', '')}`;
  const grantId = randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 3_600_000).toISOString();
  await dependencies.repository.create('tenantPortalGrants', agencyId, grantId, {
    tenantId,
    tenancyId,
    recipientEmail,
    tokenHash: createHash('sha256').update(rawToken).digest('hex'),
    expiresAt,
  }, actorId);
  const relativeUrl = `/tenant-portal/${rawToken}`;
  return { grantId, rawToken, expiresAt, accessUrl: `${webBaseUrl()}${relativeUrl}` || relativeUrl };
}

async function queueNotification(dependencies: ApiDependencies, agencyId: string, actorId: string, input: {
  tenantId: string;
  tenancyId: string;
  propertyId: string;
  recipient: string;
  subject: string;
  message: string;
  documentId: string;
}) {
  const communicationId = randomUUID();
  await dependencies.repository.create('tenantCommunications', agencyId, communicationId, {
    tenantId: input.tenantId,
    tenancyId: input.tenancyId,
    propertyId: input.propertyId,
    channel: 'email',
    direction: 'outbound',
    subject: input.subject,
    message: input.message,
    status: 'queued',
    relatedEntityType: 'tenancy_document',
    relatedEntityId: input.documentId,
  }, actorId);
  const notificationId = randomUUID();
  const notification = await dependencies.repository.create('notificationJobs', agencyId, notificationId, {
    tenantId: input.tenantId,
    tenancyId: input.tenancyId,
    propertyId: input.propertyId,
    channel: 'email',
    recipient: input.recipient,
    subject: input.subject,
    message: input.message,
    communicationId,
    status: 'queued',
    queuedAt: new Date().toISOString(),
  }, actorId);
  await dependencies.tasks.dispatch('notification', agencyId, notificationId, notification);
}

async function generateDocument(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string, source?: StoredRecord): Promise<ApiResponse> {
  const agencyId = agencyHeader(req);
  const body = await readJson(req);
  const tenantId = text(body.tenantId) || text(source?.tenantId);
  const tenancyId = text(body.tenancyId) || text(source?.tenancyId);
  const propertyId = text(body.propertyId) || text(source?.propertyId);
  const title = text(body.title) || text(source?.title);
  const type = text(body.type) || text(source?.type) || 'other';
  const content = typeof body.content === 'string' ? body.content : text(source?.content);
  if (!tenancyId || !propertyId || !title) throw new ApiError(400, 'DOCUMENT_FIELDS_REQUIRED', 'tenancyId, propertyId and title are required.');
  const principal = await authenticateAndAuthorise(req, dependencies, 'tenant.document.manage', { agencyId, tenantId: tenantId || undefined, tenancyId, propertyId }, correlationId);
  const tenancy = await dependencies.repository.get('tenancies', agencyId, tenancyId);
  if (!tenancy || String(tenancy.propertyId) !== propertyId) throw new ApiError(409, 'TENANCY_PROPERTY_MISMATCH', 'Tenancy does not belong to the selected property.');
  const documentId = randomUUID();
  const documentVersion = source ? Number(source.documentVersion || 1) + 1 : 1;
  const artifact = await storeArtifact(agencyId, documentId, documentVersion, title, content, text(body.fileBase64) || undefined);
  const record = await dependencies.repository.create('tenancyDocuments', agencyId, documentId, {
    ...(tenantId ? { tenantId } : {}),
    tenancyId,
    propertyId,
    type,
    title,
    status: 'ready',
    content,
    contentType: 'application/pdf',
    ...(text(body.templateKey) || text(source?.templateKey) ? { templateKey: text(body.templateKey) || text(source?.templateKey) } : {}),
    objectPath: artifact.objectPath,
    sha256: artifact.sha256,
    generation: artifact.generation,
    documentVersion,
    immutable: false,
    ...(source ? { supersedesDocumentId: source.id } : {}),
    acknowledgementText: text(body.acknowledgementText) || text(source?.acknowledgementText) || 'I confirm that I have reviewed this document and agree that my typed name records my acknowledgement/signature.',
  }, principal.uid);
  if (source) {
    await dependencies.repository.update('tenancyDocuments', agencyId, source.id, {
      status: 'archived',
      archivedAt: new Date().toISOString(),
      supersededByDocumentId: documentId,
    }, Number(source.version || 1), principal.uid);
  }
  return { status: 201, body: { data: record, meta: { correlationId } } };
}

async function issueDocument(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string, documentId: string): Promise<ApiResponse> {
  const agencyId = agencyHeader(req);
  const body = await readJson(req);
  const principal = await authenticateAndAuthorise(req, dependencies, 'tenant.document.manage', { agencyId }, correlationId);
  const document = await dependencies.repository.get('tenancyDocuments', agencyId, documentId);
  if (!document) throw new ApiError(404, 'TENANCY_DOCUMENT_NOT_FOUND', 'Tenancy document was not found.');
  if (!['draft', 'ready'].includes(String(document.status))) throw new ApiError(409, 'DOCUMENT_ALREADY_ISSUED', 'Only draft or ready documents can be issued.');
  if (!document.objectPath || !document.sha256) throw new ApiError(409, 'DOCUMENT_ARTIFACT_REQUIRED', 'Generate the document PDF before issue.');

  const [participants, tenants] = await Promise.all([
    listAll(dependencies, 'tenancyParticipants', agencyId),
    listAll(dependencies, 'tenants', agencyId),
  ]);
  const requested = Array.isArray(body.tenantIds) ? new Set(body.tenantIds.filter((value): value is string => typeof value === 'string')) : undefined;
  const activeParticipants = participants.filter((item) => item.tenancyId === document.tenancyId && item.status !== 'ended' && ['primary_tenant', 'co_tenant'].includes(String(item.role)) && (!requested || requested.has(String(item.tenantId))));
  const tenantSigners: Array<Record<string, unknown>> = [];
  for (const participant of activeParticipants) {
    const tenant = tenants.find((candidate) => candidate.id === participant.tenantId);
    const recipient = text(tenant?.email).toLowerCase();
    if (!tenant || !recipient) continue;
    tenantSigners.push({ id: randomUUID(), kind: 'tenant', tenantId: tenant.id, name: text(tenant.fullName) || tenant.id, email: recipient, required: true, status: 'pending' });
  }
  if (!tenantSigners.length) throw new ApiError(409, 'VERIFIED_SIGNER_REQUIRED', 'At least one active tenancy participant with a verified email is required.');

  const signers: Array<Record<string, unknown>> = [...tenantSigners];
  const agentSignatureRequired = body.agentSignatureRequired === true || String(document.type) === 'tenancy_agreement';
  if (agentSignatureRequired) signers.push({ id: randomUUID(), kind: 'agent', userId: principal.uid, name: text(body.agentName) || 'Property Manager / Agent', required: true, status: 'pending' });
  const issuedAt = new Date().toISOString();
  const issued = await dependencies.repository.update('tenancyDocuments', agencyId, documentId, {
    status: 'signature_required',
    signers,
    issuedAt,
    issuedTo: tenantSigners.map((item) => item.email),
    immutable: true,
  }, Number(document.version || 1), principal.uid);

  for (const signer of tenantSigners) {
    const tenantId = String(signer.tenantId);
    const recipient = String(signer.email);
    const grant = await createPortalGrant(dependencies, agencyId, tenantId, String(document.tenancyId), recipient, principal.uid);
    await queueNotification(dependencies, agencyId, principal.uid, {
      tenantId,
      tenancyId: String(document.tenancyId),
      propertyId: String(document.propertyId),
      recipient,
      subject: `Document ready: ${String(document.title)}`,
      message: `A tenancy document is ready for your review and signature in ProInspect. Open your secure portal: ${grant.accessUrl}. The link expires ${grant.expiresAt}.`,
      documentId,
    });
  }
  await dependencies.audit.append({
    id: randomUUID(),
    timestamp: issuedAt,
    actorId: principal.uid,
    actorRole: principal.role,
    agencyId,
    capability: 'tenant.document.manage',
    outcome: 'allowed',
    reason: 'tenancy_document.issued',
    target: { agencyId, tenancyId: String(document.tenancyId) },
    correlationId,
    entityType: 'tenancy_document',
    entityId: documentId,
    eventType: 'tenancy_document.issued',
    metadata: { sha256: document.sha256, signerCount: signers.length },
  });
  return { status: 200, body: { data: issued, meta: { correlationId } } };
}

async function agentSign(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string, documentId: string): Promise<ApiResponse> {
  const agencyId = agencyHeader(req);
  const body = await readJson(req);
  const signatureName = text(body.signatureName);
  if (!signatureName) throw new ApiError(400, 'SIGNATURE_NAME_REQUIRED', 'Signature name is required.');
  const principal = await authenticateAndAuthorise(req, dependencies, 'tenant.document.manage', { agencyId }, correlationId);
  const document = await dependencies.repository.get('tenancyDocuments', agencyId, documentId);
  if (!document) throw new ApiError(404, 'TENANCY_DOCUMENT_NOT_FOUND', 'Tenancy document was not found.');
  const signers = Array.isArray(document.signers) ? document.signers.map((item) => ({ ...(item as Record<string, unknown>) })) : [];
  const index = signers.findIndex((item) => item.kind === 'agent' && item.userId === principal.uid && item.status !== 'signed');
  if (index < 0) throw new ApiError(409, 'AGENT_SIGNATURE_NOT_REQUIRED', 'This document is not awaiting your agent signature.');
  const signedAt = new Date().toISOString();
  signers[index] = { ...signers[index], status: 'signed', signedAt, signatureName };
  const complete = signers.filter((item) => item.required !== false).every((item) => item.status === 'signed');
  const signatureManifestSha256 = createHash('sha256').update(JSON.stringify({ documentSha256: document.sha256, signers })).digest('hex');
  const updated = await dependencies.repository.update('tenancyDocuments', agencyId, documentId, {
    signers,
    status: complete ? 'signed' : 'partially_signed',
    ...(complete ? { signedAt } : {}),
    signatureManifestSha256,
  }, Number(document.version || 1), principal.uid);
  return { status: 200, body: { data: updated, meta: { correlationId } } };
}

async function archive(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string, documentId: string): Promise<ApiResponse> {
  const agencyId = agencyHeader(req);
  const principal = await authenticateAndAuthorise(req, dependencies, 'tenant.document.manage', { agencyId }, correlationId);
  const document = await dependencies.repository.get('tenancyDocuments', agencyId, documentId);
  if (!document) throw new ApiError(404, 'TENANCY_DOCUMENT_NOT_FOUND', 'Tenancy document was not found.');
  const updated = await dependencies.repository.update('tenancyDocuments', agencyId, documentId, { status: 'archived', archivedAt: new Date().toISOString() }, Number(document.version || 1), principal.uid);
  return { status: 200, body: { data: updated, meta: { correlationId } } };
}

async function download(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string, documentId: string): Promise<ApiResponse> {
  const agencyId = agencyHeader(req);
  await authenticateAndAuthorise(req, dependencies, 'tenant.document.read', { agencyId }, correlationId);
  const document = await dependencies.repository.get('tenancyDocuments', agencyId, documentId);
  if (!document || !document.objectPath) throw new ApiError(404, 'DOCUMENT_ARTIFACT_NOT_FOUND', 'Document PDF was not found.');
  const projectId = process.env.GOOGLE_CLOUD_PROJECT?.trim();
  const bucketName = process.env.REPORT_BUCKET?.trim() || (projectId ? `${projectId}-reports` : '');
  if (!bucketName) throw new ApiError(503, 'REPORT_BUCKET_REQUIRED', 'A tenancy document storage bucket is required.');
  const [url] = await getStorage(adminApp()).bucket(bucketName).file(String(document.objectPath)).getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + 15 * 60 * 1000,
    responseDisposition: `attachment; filename="${text(document.title).replaceAll('"', '') || 'tenancy-document'}.pdf"`,
  });
  return { status: 200, body: { data: { url, expiresInSeconds: 900, sha256: document.sha256, documentVersion: document.documentVersion }, meta: { correlationId } } };
}

export async function routeTenantDocumentRequest(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string): Promise<ApiResponse | undefined> {
  const parts = new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean);
  if (parts[0] !== 'api' || parts[1] !== 'v1' || parts[2] !== 'tenancy-documents') return undefined;
  if (parts[3] === 'generate' && req.method === 'POST') return generateDocument(req, dependencies, correlationId);
  if (!parts[3]) return undefined;
  if (parts[4] === 'new-version' && req.method === 'POST') {
    const agencyId = agencyHeader(req);
    const source = await dependencies.repository.get('tenancyDocuments', agencyId, parts[3]);
    if (!source) throw new ApiError(404, 'TENANCY_DOCUMENT_NOT_FOUND', 'Tenancy document was not found.');
    return generateDocument(req, dependencies, correlationId, source);
  }
  if (parts[4] === 'issue' && req.method === 'POST') return issueDocument(req, dependencies, correlationId, parts[3]);
  if (parts[4] === 'agent-sign' && req.method === 'POST') return agentSign(req, dependencies, correlationId, parts[3]);
  if (parts[4] === 'archive' && req.method === 'POST') return archive(req, dependencies, correlationId, parts[3]);
  if (parts[4] === 'download' && req.method === 'GET') return download(req, dependencies, correlationId, parts[3]);
  return undefined;
}
