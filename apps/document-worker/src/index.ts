import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { downloadWorkerEvidence, saveWorkerArtifact, workerDatabase } from '@pcr/appwrite-server';

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

function json(res: ServerResponse, status: number, body: unknown) { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); }
async function body(req: IncomingMessage): Promise<unknown> { const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; }
function decode(input: unknown): DocumentTask { if (!input || typeof input !== 'object') throw new Error('Document task payload is required.'); const value = input as Record<string, unknown>; const envelope = value.message && typeof value.message === 'object' ? value.message as Record<string, unknown> : undefined; const payload = envelope?.data ? JSON.parse(Buffer.from(String(envelope.data), 'base64').toString('utf8')) as Record<string, unknown> : value; for (const required of ['taskId', 'agencyId', 'documentId', 'templateVersionId', 'tenancyId', 'propertyId', 'title']) if (!String(payload[required] || '').trim()) throw new Error(`${required} is required.`); return { taskId: String(payload.taskId), agencyId: String(payload.agencyId), documentId: String(payload.documentId), templateVersionId: String(payload.templateVersionId), packetId: typeof payload.packetId === 'string' ? payload.packetId : undefined, tenancyId: String(payload.tenancyId), propertyId: String(payload.propertyId), title: String(payload.title), fields: payload.fields && typeof payload.fields === 'object' && !Array.isArray(payload.fields) ? payload.fields as DocumentTask['fields'] : {}, appendixText: typeof payload.appendixText === 'string' ? payload.appendixText : undefined }; }
function digest(bytes: Uint8Array | Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }

export async function render(task: DocumentTask) {
  const db = workerDatabase();
  const templateRef = db.doc(`agencies/${task.agencyId}/documentTemplateVersions/${task.templateVersionId}`);
  const templateSnap = await templateRef.get();
  if (!templateSnap.exists) throw new Error(`Document template version ${task.templateVersionId} was not found.`);
  const template = templateSnap.data() as Record<string, unknown>;
  if (String(template.status) !== 'published') throw new Error('Only published document template versions may be rendered.');
  const sourceObjectPath = String(template.sourceObjectPath || ''); const sourceSha256 = String(template.sourceSha256 || '');
  if (!sourceObjectPath || !sourceSha256) throw new Error('Published template must contain sourceObjectPath and sourceSha256.');
  const sourceEvidenceFileId = String(template.sourceEvidenceFileId || '');
  if (!sourceEvidenceFileId) throw new Error('Template requires a canonical sourceEvidenceFileId.');
  const { bytes: sourceBytes } = await downloadWorkerEvidence(task.agencyId, sourceEvidenceFileId, db.services);
  if (digest(sourceBytes) !== sourceSha256) throw new Error('Template source hash does not match published provenance.');

  const pdf = await PDFDocument.load(sourceBytes);
  const approvedAt = new Date(String(template.publishedAt || template.createdAt));
  if (!Number.isFinite(approvedAt.getTime())) throw new Error('Template publication timestamp is required.');
  pdf.setCreationDate(approvedAt); pdf.setModificationDate(approvedAt); const form = pdf.getForm(); const schema = template.fieldSchema && typeof template.fieldSchema === 'object' ? template.fieldSchema as Record<string, unknown> : {};
  for (const [name, raw] of Object.entries(task.fields)) {
    if (!(name in schema)) continue;
    const value = raw == null ? '' : String(raw);
    try {
      form.getTextField(name).setText(value);
      continue;
    } catch {
      // Field is not a text field, continue matching other form field types
    }
    try {
      const check = form.getCheckBox(name);
      if (['true', 'yes', '1', 'checked'].includes(value.toLowerCase())) {
        check.check();
      } else {
        check.uncheck();
      }
      continue;
    } catch {
      // Field is not a checkbox
    }
    try {
      form.getDropdown(name).select(value);
      continue;
    } catch {
      // Field is not a dropdown
    }
  }
  form.flatten();

  if (task.appendixText?.trim()) {
    const page = pdf.addPage(); const font = await pdf.embedFont(StandardFonts.Helvetica); const margin = 48; let y = page.getHeight() - margin; page.drawText('Additional schedule', { x: margin, y, size: 14, font }); y -= 28;
    for (const paragraph of task.appendixText.split(/\r?\n/u)) { const words = paragraph.split(/\s+/u); let line = ''; for (const word of words) { const candidate = line ? `${line} ${word}` : word; if (font.widthOfTextAtSize(candidate, 10) <= page.getWidth() - margin * 2) line = candidate; else { page.drawText(line, { x: margin, y, size: 10, font }); y -= 14; line = word; if (y < margin) y = margin; } } if (line) { page.drawText(line, { x: margin, y, size: 10, font }); y -= 18; } }
  }

  const bytes = await pdf.save(); const sha256 = digest(bytes);
  const stored = await saveWorkerArtifact(db.services, { bucketId: 'property-documents', path: `agencies/${task.agencyId}/documents/${task.documentId}/${task.templateVersionId}`, bytes, sha256, contentType: 'application/pdf' });
  const evidenceId = stored.fileId; const now = new Date().toISOString();
  await db.runTransaction(async (tx) => {
    const document = db.doc(`agencies/${task.agencyId}/tenancyDocuments/${task.documentId}`);
    const existing = await tx.get(document);
    if (existing.exists) {
      if (existing.get('contentHash') !== sha256 || existing.get('templateVersionId') !== task.templateVersionId) throw new Error('Document immutable version conflict');
      return;
    }
    tx.create(db.doc(`agencies/${task.agencyId}/evidenceFiles/${evidenceId}`), { agencyId: task.agencyId, bucketId: 'property-documents', fileId: stored.fileId, propertyId: task.propertyId, entityType: 'tenancy_document', entityId: task.documentId, mimeType: 'application/pdf', originalFilename: `${task.documentId}.pdf`, size: bytes.length, checksum: sha256, uploadedBy: 'system:document-worker', storageVersion: stored.generation });
    tx.create(document, { tenancyId: task.tenancyId, documentType: String(template.purpose || 'other'), evidenceFileId: evidenceId, version: 1, contentHash: sha256, immutable: true, status: 'ready', templateVersionId: task.templateVersionId, templateSourceSha256: sourceSha256, packetId: task.packetId || null, title: task.title, propertyId: task.propertyId, issuedAt: now });
    tx.set(db.doc(`agencies/${task.agencyId}/taskOutbox/${task.taskId}`), { eventType: 'document', status: 'completed', completedAt: now, result: { documentId: task.documentId, fileId: stored.fileId, sha256 }, updatedAt: now }, { merge: true });
  });
  return { documentId: task.documentId, fileId: stored.fileId, sha256, generation: stored.generation };

}

const server = createServer(async (req, res) => { try { if (req.method === 'GET' && req.url === '/health') return json(res, 200, { status: 'ok', authority: 'appwrite', version: process.env.APP_VERSION, service: 'document-worker' }); if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' }); const task = decode(await body(req)); return json(res, 200, { data: await render(task) }); } catch (error) { console.error(JSON.stringify({ level: 'error', message: 'document-worker.failed', error: error instanceof Error ? error.message : String(error) })); return json(res, 500, { error: error instanceof Error ? error.message : String(error) }); } });
if (process.env.NODE_ENV !== 'test') server.listen(Number(process.env.PORT || 8080), '0.0.0.0');
