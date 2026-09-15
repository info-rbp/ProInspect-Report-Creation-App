import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { InputFile, createAppwriteServerServices, loadAppwriteServerConfig } from '@pcr/appwrite-server';
import { PDFDocument, StandardFonts } from 'pdf-lib';

interface DocumentTask {
  taskId: string;
  agencyId: string;
  documentId: string;
  templateVersionId: string;
  packetId?: string;
  tenancyId: string;
  propertyId: string;
  title: string;
  fields: Record<string, string | number | boolean | null | undefined>;
  appendixText?: string;
}

type Row = Record<string, unknown> & { $id: string; agencyId?: string };

const services = createAppwriteServerServices(loadAppwriteServerConfig());
const SYSTEM_ACTOR = 'system:document-worker';
const DEFAULT_BUCKET = 'property-documents';

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}
async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}
function decode(input: unknown): DocumentTask {
  if (!input || typeof input !== 'object') throw new Error('Document task payload is required.');
  const value = input as Record<string, unknown>;
  const envelope = value.message && typeof value.message === 'object' ? value.message as Record<string, unknown> : undefined;
  const payload = envelope?.data ? JSON.parse(Buffer.from(String(envelope.data), 'base64').toString('utf8')) as Record<string, unknown> : value;
  for (const required of ['taskId', 'agencyId', 'documentId', 'templateVersionId', 'tenancyId', 'propertyId', 'title']) {
    if (!String(payload[required] || '').trim()) throw new Error(`${required} is required.`);
  }
  return {
    taskId: String(payload.taskId), agencyId: String(payload.agencyId), documentId: String(payload.documentId),
    templateVersionId: String(payload.templateVersionId), packetId: typeof payload.packetId === 'string' ? payload.packetId : undefined,
    tenancyId: String(payload.tenancyId), propertyId: String(payload.propertyId), title: String(payload.title),
    fields: payload.fields && typeof payload.fields === 'object' && !Array.isArray(payload.fields) ? payload.fields as DocumentTask['fields'] : {},
    appendixText: typeof payload.appendixText === 'string' ? payload.appendixText : undefined,
  };
}
function digest(bytes: Uint8Array | Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }
function deterministicId(prefix: string, input: string): string { return `${prefix}${createHash('sha256').update(input).digest('hex').slice(0, 35)}`; }
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function nowIso(): string { return new Date().toISOString(); }
function appwriteCode(error: unknown): number | undefined { return error && typeof error === 'object' && 'code' in error ? Number((error as { code?: unknown }).code) : undefined; }

async function getRow(tableId: string, rowId: string): Promise<Row | undefined> {
  try { return await services.tables.getRow({ databaseId: services.databaseId, tableId, rowId }) as unknown as Row; }
  catch (error) { if (appwriteCode(error) === 404) return undefined; throw error; }
}
async function getAgencyRow(tableId: string, rowId: string, agencyId: string): Promise<Row | undefined> {
  const row = await getRow(tableId, rowId);
  return row && row.agencyId === agencyId ? row : undefined;
}
async function markOutbox(task: DocumentTask, state: string, result?: Record<string, unknown>): Promise<void> {
  const existing = await getAgencyRow('integration_outbox', task.taskId, task.agencyId);
  if (!existing) return;
  let payload: Record<string, unknown> = {};
  try { payload = text(existing.payload) ? JSON.parse(text(existing.payload)) as Record<string, unknown> : {}; } catch { payload = {}; }
  await services.tables.updateRow({
    databaseId: services.databaseId, tableId: 'integration_outbox', rowId: task.taskId,
    data: { deliveryStatus: state, lastAttemptedAt: nowIso(), updatedAt: nowIso(), updatedBy: SYSTEM_ACTOR, ...(result ? { payload: JSON.stringify({ ...payload, result }) } : {}) },
  });
}

async function publishedTemplate(task: DocumentTask): Promise<Row> {
  const template = await getRow('document_template_versions', task.templateVersionId);
  if (!template) throw new Error(`Document template version ${task.templateVersionId} was not found.`);
  if (template.agencyId && template.agencyId !== task.agencyId) throw new Error('Document template belongs to another agency.');
  if (text(template.status) !== 'published' || template.immutable !== true) throw new Error('Only immutable published document template versions may be rendered.');
  if (!text(template.sourceFileId) || !text(template.sourceSha256)) throw new Error('Published template must contain sourceFileId and sourceSha256.');
  return template;
}

async function downloadVerified(bucketId: string, fileId: string, expectedSha: string, label: string): Promise<Buffer> {
  const bytes = Buffer.from(await services.storage.getFileDownload({ bucketId, fileId }));
  const actual = digest(bytes);
  if (actual !== expectedSha.toLowerCase()) throw new Error(`${label} hash does not match published provenance.`);
  return bytes;
}

async function saveImmutablePdf(fileId: string, bytes: Uint8Array, sha256: string): Promise<void> {
  try {
    await services.storage.createFile({ bucketId: DEFAULT_BUCKET, fileId, file: InputFile.fromBuffer(Buffer.from(bytes), `${fileId}.pdf`), permissions: [] });
  } catch (error) {
    if (appwriteCode(error) !== 409) throw error;
    await downloadVerified(DEFAULT_BUCKET, fileId, sha256, 'Existing generated document');
  }
}

async function render(task: DocumentTask) {
  const existingDocument = await getAgencyRow('tenancy_documents', task.documentId, task.agencyId);
  if (existingDocument && text(existingDocument.status) === 'ready') {
    const evidence = await getAgencyRow('evidence_files', text(existingDocument.evidenceFileId), task.agencyId);
    if (!evidence) throw new Error('Completed tenancy document is missing its evidence record.');
    return { documentId: task.documentId, fileId: evidence.fileId, sha256: existingDocument.contentHash, replayed: true };
  }

  await markOutbox(task, 'processing');
  const template = await publishedTemplate(task);
  const sourceBucketId = text(template.sourceBucketId) || DEFAULT_BUCKET;
  const sourceFileId = text(template.sourceFileId);
  const sourceSha256 = text(template.sourceSha256).toLowerCase();
  const sourceBytes = await downloadVerified(sourceBucketId, sourceFileId, sourceSha256, 'Template source');

  const pdf = await PDFDocument.load(sourceBytes);
  const form = pdf.getForm();
  let schema: Record<string, unknown> = {};
  try { schema = text(template.fieldSchema) ? JSON.parse(text(template.fieldSchema)) as Record<string, unknown> : {}; }
  catch { throw new Error('Published template fieldSchema is not valid JSON.'); }
  for (const [name, raw] of Object.entries(task.fields)) {
    if (!(name in schema)) continue;
    const value = raw == null ? '' : String(raw);
    try { form.getTextField(name).setText(value); continue; } catch { /* not text */ }
    try { const check = form.getCheckBox(name); if (['true','yes','1','checked'].includes(value.toLowerCase())) check.check(); else check.uncheck(); continue; } catch { /* not checkbox */ }
    try { form.getDropdown(name).select(value); } catch { /* unsupported field type remains unchanged */ }
  }
  form.flatten();

  if (task.appendixText?.trim()) {
    const page = pdf.addPage(); const font = await pdf.embedFont(StandardFonts.Helvetica); const margin = 48; let y = page.getHeight() - margin;
    page.drawText('Additional schedule', { x: margin, y, size: 14, font }); y -= 28;
    for (const paragraph of task.appendixText.split(/\r?\n/u)) {
      const words = paragraph.split(/\s+/u); let line = '';
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, 10) <= page.getWidth() - margin * 2) line = candidate;
        else { if (line) page.drawText(line, { x: margin, y, size: 10, font }); y -= 14; line = word; if (y < margin) y = margin; }
      }
      if (line) { page.drawText(line, { x: margin, y, size: 10, font }); y -= 18; }
    }
  }

  const bytes = await pdf.save();
  const sha256 = digest(bytes);
  const fileId = deterministicId('f', `${task.agencyId}:${task.documentId}:${sha256}`);
  await saveImmutablePdf(fileId, bytes, sha256);
  const now = nowIso();
  const evidenceId = deterministicId('e', `${task.agencyId}:${task.documentId}:${fileId}`);
  const evidenceData = {
    agencyId: task.agencyId, status: 'active', bucketId: DEFAULT_BUCKET, fileId, propertyId: task.propertyId,
    entityType: 'tenancy_document', entityId: task.documentId, category: 'generated_document', mimeType: 'application/pdf',
    originalFilename: `${task.title.replace(/[^A-Za-z0-9._-]+/gu, '-').slice(0, 120) || 'document'}.pdf`, size: bytes.length,
    checksum: sha256, uploadedBy: SYSTEM_ACTOR, capturedAt: now, storageVersion: 'appwrite-v1',
    createdAt: now, updatedAt: now, createdBy: SYSTEM_ACTOR, updatedBy: SYSTEM_ACTOR,
  };
  const existingEvidence = await getAgencyRow('evidence_files', evidenceId, task.agencyId);
  if (!existingEvidence) await services.tables.createRow({ databaseId: services.databaseId, tableId: 'evidence_files', rowId: evidenceId, permissions: [], data: evidenceData });
  else if (text(existingEvidence.checksum) !== sha256 || text(existingEvidence.fileId) !== fileId) throw new Error('Evidence record conflicts with generated document.');

  const documentData = {
    agencyId: task.agencyId, status: 'ready', tenancyId: task.tenancyId, documentType: text(template.purpose) || 'other', evidenceFileId: evidenceId,
    version: 1, contentHash: sha256, issuedAt: now, immutable: false,
    signers: JSON.stringify([]), createdAt: now, updatedAt: now, createdBy: SYSTEM_ACTOR, updatedBy: SYSTEM_ACTOR,
    legacySystem: 'document-worker-v1', legacyId: task.packetId || task.templateVersionId,
  };
  const current = await getAgencyRow('tenancy_documents', task.documentId, task.agencyId);
  if (current) {
    if (text(current.contentHash) !== sha256) throw new Error('Document ID already exists with different immutable content.');
  } else {
    await services.tables.createRow({ databaseId: services.databaseId, tableId: 'tenancy_documents', rowId: task.documentId, permissions: [], data: documentData });
  }
  const result = { documentId: task.documentId, fileId, evidenceFileId: evidenceId, sha256, replayed: false };
  await markOutbox(task, 'completed', result);
  return result;
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') return json(res, 200, { status: 'ok', service: 'document-worker', authority: 'appwrite' });
    if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
    const task = decode(await body(req));
    return json(res, 200, { data: await render(task) });
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', message: 'document-worker.failed', error: error instanceof Error ? error.message : String(error) }));
    return json(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});
server.listen(Number(process.env.PORT || 8080), '0.0.0.0');
