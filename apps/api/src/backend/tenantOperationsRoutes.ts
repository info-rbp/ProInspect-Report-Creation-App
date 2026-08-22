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

async function readJson(req: IncomingMessage, maxBytes = 8 * 1024 * 1024): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > maxBytes) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request payload is too large.');
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

async function listAll(dependencies: ApiDependencies, collection: string, agencyId: string): Promise<StoredRecord[]> {
  const items: StoredRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = await dependencies.repository.list(collection, agencyId, 100, cursor);
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function lifecycle(record: StoredRecord | undefined): string {
  if (!record) return 'unknown';
  return String(record.lifecycleStatus || (record.status === 'inactive' ? 'ended' : record.status) || 'active');
}

function isTerminalMaintenance(status: unknown): boolean {
  return ['closed', 'dismissed', 'cancelled', 'duplicate', 'not_actionable'].includes(String(status));
}

function isTerminalAction(status: unknown): boolean {
  return ['resolved', 'closed', 'cancelled', 'withdrawn'].includes(String(status));
}

function pdfEscape(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}

function wrapText(source: string, width = 88): string[] {
  const output: string[] = [];
  for (const paragraph of source.replaceAll('\r\n', '\n').split('\n')) {
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

function plainTextPdf(title: string, content: string): Buffer {
  const lines = [title, '', ...wrapText(content || title)];
  const pages: string[][] = [];
  for (let index = 0; index < lines.length; index += 48) pages.push(lines.slice(index, index + 48));
  if (!pages.length) pages.push([title]);

  const objects: string[] = [];
  const add = (value: string) => {
    objects.push(value);
    return objects.length;
  };
  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageIds: number[] = [];
  const contentIds: number[] = [];
  const pagesId = 2;
  for (const page of pages) {
    const stream = [
      'BT',
      '/F1 11 Tf',
      '50 790 Td',
      '14 TL',
      ...page.flatMap((line, index) => [index === 0 ? '/F1 16 Tf' : index === 1 ? '/F1 11 Tf' : '', `(${pdfEscape(line)}) Tj`, 'T*']).filter(Boolean),
      'ET',
    ].join('\n');
    const contentId = add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    contentIds.push(contentId);
    const pageId = add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }
  objects.splice(1, 0, `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id + 1} 0 R`).join(' ')}] >>`);
  const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'utf8');
}

async function persistDocumentArtifact(agencyId: string, documentId: string, title: string, content: string, fileBase64?: string) {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT?.trim();
  const bucketName = process.env.REPORT_BUCKET?.trim() || (projectId ? `${projectId}-reports` : '');
  if (!bucketName) throw new ApiError(503, 'REPORT_BUCKET_REQUIRED', 'A document storage bucket is required.');
  let bytes: Buffer;
  if (fileBase64) {
    try { bytes = Buffer.from(fileBase64, 'base64'); }
    catch { throw new ApiError(400, 'INVALID_DOCUMENT_FILE', 'Uploaded document is not valid base64.'); }
    if (!bytes.length || bytes.length > 6 * 1024 * 1024) throw new ApiError(400, 'DOCUMENT_SIZE_INVALID', 'Uploaded PDF must be between 1 byte and 6 MB.');
    if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw new ApiError(400, 'DOCUMENT_PDF_REQUIRED', 'Uploaded tenancy documents must be PDF files.');
  } else {
    bytes = plainTextPdf(title, content);
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const objectPath = `agencies/${agencyId}/tenancy-documents/${documentId}/document-v1-${sha256.slice(0, 12)}.pdf`;
  const file = getStorage(adminApp()).bucket(bucketName).file(objectPath);
  await file.save(bytes, { resumable: false, contentType: 'application/pdf', metadata: { cacheControl: 'private, max-age=0, no-store', metadata: { sha256, documentId } } });
  const [metadata] = await file.getMetadata();
  return { objectPath, sha256, generation: String(metadata.generation || ''), bucketName };
}

async function signedDownloadUrl(document: StoredRecord): Promise<string | undefined> {
  const objectPath = text(document.objectPath);
  if (!objectPath) return undefined;
  const projectId = process.env.GOOGLE_CLOUD_PROJECT?.trim();
  const bucketName = process.env.REPORT_BUCKET?.trim() || (projectId ? `${projectId}-reports` : '');
  if (!bucketName) return undefined;
  const [url] = await getStorage(adminApp()).bucket(bucketName).file(objectPath).getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + 15 * 60 * 1000,
    responseDisposition: `attachment; filename="${text(document.title).replaceAll('"', '') || 'tenancy-document'}.pdf"`,
  });
  return url;
}

async function tenantOverview(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string): Promise<ApiResponse> {
  const agencyId = agencyHeader(req);
  await authenticateAndAuthorise(req, dependencies, 'tenant.read', { agencyId }, correlationId);
  const [tenants, tenancies, participants, properties, jobs, maintenance, actions] = await Promise.all([
    listAll(dependencies, 'tenants', agencyId),
    listAll(dependencies, 'tenancies', agencyId),
    listAll(dependencies, 'tenancyParticipants', agencyId),
    listAll(dependencies, 'properties', agencyId),
    listAll(dependencies, 'inspectionJobs', agencyId),
    listAll(dependencies, 'maintenanceItems', agencyId),
    listAll(dependencies, 'tenantInstructions', agencyId),
  ]);
  const rows = tenants.map((tenant) => {
    const links = participants.filter((item) => item.tenantId === tenant.id && item.status !== 'ended');
    const linked = links.map((item) => tenancies.find((candidate) => candidate.id === item.tenancyId)).filter(Boolean) as StoredRecord[];
    const tenancy = linked.find((item) => lifecycle(item) === 'active') || linked.find((item) => !['ended', 'cancelled'].includes(lifecycle(item))) || linked[0];
    const property = tenancy ? properties.find((item) => item.id === tenancy.propertyId) : undefined;
    const openActions = tenancy ? actions.filter((item) => item.tenancyId === tenancy.id && !isTerminalAction(item.status)) : [];
    const openMaintenance = tenancy ? maintenance.filter((item) => item.tenancyId === tenancy.id && !isTerminalMaintenance(item.status)) : [];
    const nextInspection = tenancy ? jobs.filter((item) => item.tenancyId === tenancy.id && item.scheduledAt && !['finalised', 'archived', 'cancelled'].includes(String(item.status))).sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)))[0] : undefined;
    const overdue = openActions.some((item) => item.dueDate && new Date(String(item.dueDate)).getTime() < Date.now());
    return { tenant, tenancy, property: property ? { id: property.id, address: property.address, suburb: property.suburb, state: property.state, postcode: property.postcode } : undefined, lifecycle: lifecycle(tenancy), openActionCount: openActions.length, openMaintenanceCount: openMaintenance.length, nextInspection: nextInspection ? { id: nextInspection.id, reportType: nextInspection.reportType, scheduledAt: nextInspection.scheduledAt, status: nextInspection.status } : undefined, overdue };
  });
  const stats = {
    activeTenants: rows.filter((row) => row.lifecycle === 'active').length,
    activeTenancies: tenancies.filter((item) => lifecycle(item) === 'active').length,
    upcoming: tenancies.filter((item) => lifecycle(item) === 'upcoming').length,
    vacating: tenancies.filter((item) => ['notice_given', 'vacating'].includes(lifecycle(item))).length,
    awaitingTenant: actions.filter((item) => ['issued', 'viewed', 'awaiting_action'].includes(String(item.status))).length,
    openMaintenance: maintenance.filter((item) => !isTerminalMaintenance(item.status)).length,
  };
  return { status: 200, body: { data: { rows, stats }, meta: { correlationId, total: rows.length } } };
}

async function tenantWorkspace(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string, tenantId: string): Promise<ApiResponse> {
  const agencyId = agencyHeader(req);
  await authenticateAndAuthorise(req, dependencies, 'tenant.read', { agencyId, tenantId }, correlationId);
  const tenant = await dependencies.repository.get('tenants', agencyId, tenantId);
  if (!tenant) throw new ApiError(404, 'TENANT_NOT_FOUND', 'Tenant not found.');
  const participants = (await listAll(dependencies, 'tenancyParticipants', agencyId)).filter((item) => item.tenantId === tenantId || item.status !== 'ended');
  const tenantLinks = participants.filter((item) => item.tenantId === tenantId);
  const allTenancies = await listAll(dependencies, 'tenancies', agencyId);
  const linkedTenancies = tenantLinks.map((item) => allTenancies.find((candidate) => candidate.id === item.tenancyId)).filter(Boolean) as StoredRecord[];
  const tenancyIds = new Set(linkedTenancies.map((item) => item.id));
  const relatedParticipants = participants.filter((item) => tenancyIds.has(String(item.tenancyId)));
  const participantTenantIds = new Set(relatedParticipants.map((item) => String(item.tenantId)));
  const participantTenants = (await listAll(dependencies, 'tenants', agencyId)).filter((item) => participantTenantIds.has(item.id));
  const [properties, jobs, reports, maintenance, actions, communications, documents] = await Promise.all([
    listAll(dependencies, 'properties', agencyId),
    listAll(dependencies, 'inspectionJobs', agencyId),
    listAll(dependencies, 'reports', agencyId),
    listAll(dependencies, 'maintenanceItems', agencyId),
    listAll(dependencies, 'tenantInstructions', agencyId),
    listAll(dependencies, 'tenantCommunications', agencyId),
    listAll(dependencies, 'tenancyDocuments', agencyId),
  ]);
  const currentTenancy = linkedTenancies.find((item) => lifecycle(item) === 'active') || linkedTenancies.find((item) => !['ended', 'cancelled'].includes(lifecycle(item))) || linkedTenancies[0];
  const property = currentTenancy ? properties.find((item) => item.id === currentTenancy.propertyId) : undefined;
  return {
    status: 200,
    body: {
      data: {
        tenant,
        linkedTenancies,
        currentTenancy,
        property,
        participants: relatedParticipants.map((item) => ({ ...item, tenant: participantTenants.find((candidate) => candidate.id === item.tenantId) })),
        jobs: jobs.filter((item) => tenancyIds.has(String(item.tenancyId))),
        reports: reports.filter((item) => tenancyIds.has(String(item.tenancyId))),
        maintenance: maintenance.filter((item) => tenancyIds.has(String(item.tenancyId))),
        actions: actions.filter((item) => tenancyIds.has(String(item.tenancyId))),
        communications: communications.filter((item) => item.tenantId === tenantId || tenancyIds.has(String(item.tenancyId))),
        documents: documents.filter((item) => item.tenantId === tenantId || tenancyIds.has(String(item.tenancyId))),
      },
      meta: { correlationId },
    },
  };
}

async function generateDocument(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string): Promise<ApiResponse> {
  const agencyId = agencyHeader(req);
  const body = await readJson(req);
  const tenantId = text(body.tenantId);
  const tenancyId = text(body.tenancyId);
  const propertyId = text(body.propertyId);
  const title = text(body.title);
  const type = text(body.type) || 'other';
  const content = typeof body.content === 'string' ? body.content : '';
  if (!tenancyId || !propertyId || !title) throw new ApiError(400, 'DOCUMENT_FIELDS_REQUIRED', 'tenancyId, propertyId and title are required.');
  const principal = await authenticateAndAuthorise(req, dependencies, 'tenant.document.manage', { agencyId, tenantId: tenantId || undefined, tenancyId, propertyId }, correlationId);
  const tenancy = await dependencies.repository.get('tenancies', agencyId, tenancyId);
  if (!tenancy || String(tenancy.propertyId) !== propertyId) throw new ApiError(409, 'TENANCY_PROPERTY_MISMATCH', 'Tenancy does not belong to the selected property.');
  const documentId = randomUUID();
  const artifact = await persistDocumentArtifact(agencyId, documentId, title, content, text(body.fileBase64) || undefined);
  const record = await dependencies.repository.create('tenancyDocuments', agencyId, documentId, {
    ...(tenantId ? { tenantId } : {}), tenancyId, propertyId, type, title, status: 'ready', content, contentType: 'application/pdf',
    ...(text(body.templateKey) ? { templateKey: text(body.templateKey) } : {}),
    objectPath: artifact.objectPath, sha256: artifact.sha256, generation: artifact.generation, documentVersion: 1, immutable: false,
    acknowledgementText: text(body.acknowledgementText) || 'I confirm that I have reviewed this document and agree that my typed name records my acknowledgement/signature.',
  }, principal.uid);
  return { status: 201, body: { data: record, meta: { correlationId } } };
}

async function issueDocument(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string, documentId: string): Promise<ApiResponse> {
  const agencyId = agencyHeader(req);
  const body = await readJson(req);
  const principal = await authenticateAndAuthorise(req, dependencies, 'tenant.document.manage', { agencyId }, correlationId);
  let document = await dependencies.repository.get('tenancyDocuments', agencyId, documentId);
  if (!document) throw new ApiError(404, 'TENANCY_DOCUMENT_NOT_FOUND', 'Tenancy document was not found.');
  if (!['draft', 'ready'].includes(String(document.status))) throw new ApiError(409, 'DOCUMENT_ALREADY_ISSUED', 'Only draft or ready documents can be issued.');
  if (!document.objectPath || !document.sha256) {
    const artifact = await persistDocumentArtifact(agencyId, documentId, text(document.title), text(document.content));
    document = await dependencies.repository.update('tenancyDocuments', agencyId, documentId, { objectPath: artifact.objectPath, sha256: artifact.sha256, generation: artifact.generation, contentType: 'application/pdf' }, Number(document.version || 1), principal.uid);
  }
  const [participants, tenants] = await Promise.all([listAll(dependencies, 'tenancyParticipants', agencyId), listAll(dependencies, 'tenants', agencyId)]);
  const active = participants.filter((item) => item.tenancyId === document!.tenancyId && item.status !== 'ended' && ['primary_tenant', 'co_tenant'].includes(String(item.role)));
  const requested = Array.isArray(body.tenantIds) ? new Set(body.tenantIds.filter((value): value is string => typeof value === 'string')) : undefined;
  const tenantSigners = active.filter((item) => !requested || requested.has(String(item.tenantId))).map((item) => {
    const tenant = tenants.find((candidate) => candidate.id === item.tenantId);
    const email = text(tenant?.email).toLowerCase();
    if (!tenant || !email) return undefined;
    return { id: randomUUID(), kind: 'tenant', tenantId: tenant.id, name: text(tenant.fullName) || tenant.id, email, required: true, status: 'pending' };
  }).filter(Boolean) as Array<Record<string, unknown>>;
  if (!tenantSigners.length) throw new ApiError(409, 'VERIFIED_SIGNER_REQUIRED', 'At least one active tenancy participant with a verified email is required.');
  const agentSignatureRequired = body.agentSignatureRequired === true || String(document.type) === 'tenancy_agreement';
  const signers: Array<Record<string, unknown>> = [...tenantSigners];
  if (agentSignatureRequired) signers.push({ id: randomUUID(), kind: 'agent', userId: principal.uid, name: text(body.agentName) || 'Property Manager / Agent', required: true, status: 'pending' });
  const issuedAt = new Date().toISOString();
  const issued = await dependencies.repository.update('tenancyDocuments', agencyId, documentId, {
    status: 'signature_required', signers, issuedAt, issuedTo: tenantSigners.map((item) => item.email), immutable: true,
  }, Number(document.version || 1), principal.uid);
  for (const signer of tenantSigners) {
    const tenantId = String(signer.tenantId);
    const recipient = String(signer.email);
    const communicationId = randomUUID();
    await dependencies.repository.create('tenantCommunications', agencyId, communicationId, {
      tenantId, tenancyId: document.tenancyId, propertyId: document.propertyId, channel: 'email', direction: 'outbound',
      subject: `Document ready: ${String(document.title)}`, message: `A tenancy document is ready for your review and signature in the ProInspect tenant portal.`, status: 'queued', relatedEntityType: 'tenancy_document', relatedEntityId: documentId,
    }, principal.uid);
    const notificationId = randomUUID();
    const notification = await dependencies.repository.create('notificationJobs', agencyId, notificationId, {
      tenantId, tenancyId: document.tenancyId, propertyId: document.propertyId, channel: 'email', recipient,
      subject: `Document ready: ${String(document.title)}`, message: `A tenancy document is ready for your review and signature in the ProInspect tenant portal.`, communicationId, status: 'queued', queuedAt: issuedAt,
    }, principal.uid);
    await dependencies.tasks.dispatch('notification', agencyId, notificationId, notification);
  }
  return { status: 200, body: { data: issued, meta: { correlationId } } };
}

async function agentSignDocument(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string, documentId: string): Promise<ApiResponse> {
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
    signers, status: complete ? 'signed' : 'partially_signed', ...(complete ? { signedAt } : {}), signatureManifestSha256,
  }, Number(document.version || 1), principal.uid);
  return { status: 200, body: { data: updated, meta: { correlationId } } };
}

async function archiveDocument(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string, documentId: string): Promise<ApiResponse> {
  const agencyId = agencyHeader(req);
  const principal = await authenticateAndAuthorise(req, dependencies, 'tenant.document.manage', { agencyId }, correlationId);
  const document = await dependencies.repository.get('tenancyDocuments', agencyId, documentId);
  if (!document) throw new ApiError(404, 'TENANCY_DOCUMENT_NOT_FOUND', 'Tenancy document was not found.');
  const updated = await dependencies.repository.update('tenancyDocuments', agencyId, documentId, { status: 'archived', archivedAt: new Date().toISOString() }, Number(document.version || 1), principal.uid);
  return { status: 200, body: { data: updated, meta: { correlationId } } };
}

async function downloadDocument(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string, documentId: string): Promise<ApiResponse> {
  const agencyId = agencyHeader(req);
  await authenticateAndAuthorise(req, dependencies, 'tenant.document.read', { agencyId }, correlationId);
  const document = await dependencies.repository.get('tenancyDocuments', agencyId, documentId);
  if (!document) throw new ApiError(404, 'TENANCY_DOCUMENT_NOT_FOUND', 'Tenancy document was not found.');
  const url = await signedDownloadUrl(document);
  if (!url) throw new ApiError(409, 'DOCUMENT_ARTIFACT_NOT_READY', 'Document PDF is not available.');
  return { status: 200, body: { data: { url, expiresInSeconds: 900 }, meta: { correlationId } } };
}

export async function routeTenantOperationsRequest(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string): Promise<ApiResponse | undefined> {
  const parts = new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean);
  if (parts[0] !== 'api' || parts[1] !== 'v1') return undefined;
  if (parts[2] === 'tenants' && parts[3] === 'overview' && req.method === 'GET') return tenantOverview(req, dependencies, correlationId);
  if (parts[2] === 'tenants' && parts[3] && parts[4] === 'workspace' && req.method === 'GET') return tenantWorkspace(req, dependencies, correlationId, parts[3]);
  if (parts[2] === 'tenancy-documents' && parts[3] === 'generate' && req.method === 'POST') return generateDocument(req, dependencies, correlationId);
  if (parts[2] === 'tenancy-documents' && parts[3] && parts[4] === 'issue' && req.method === 'POST') return issueDocument(req, dependencies, correlationId, parts[3]);
  if (parts[2] === 'tenancy-documents' && parts[3] && parts[4] === 'agent-sign' && req.method === 'POST') return agentSignDocument(req, dependencies, correlationId, parts[3]);
  if (parts[2] === 'tenancy-documents' && parts[3] && parts[4] === 'archive' && req.method === 'POST') return archiveDocument(req, dependencies, correlationId, parts[3]);
  if (parts[2] === 'tenancy-documents' && parts[3] && parts[4] === 'download' && req.method === 'GET') return downloadDocument(req, dependencies, correlationId, parts[3]);
  return undefined;
}
