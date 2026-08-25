import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { firestoreDb } from './firestoreDatabase.js';

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

function app() { return getApps()[0] ?? initializeApp({ credential: applicationDefault() }); }
function json(res: ServerResponse, status: number, body: unknown) { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); }
async function body(req: IncomingMessage): Promise<unknown> { const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; }
function decode(input: unknown): DocumentTask { if (!input || typeof input !== 'object') throw new Error('Document task payload is required.'); const value = input as Record<string, unknown>; const envelope = value.message && typeof value.message === 'object' ? value.message as Record<string, unknown> : undefined; const payload = envelope?.data ? JSON.parse(Buffer.from(String(envelope.data), 'base64').toString('utf8')) as Record<string, unknown> : value; for (const required of ['taskId', 'agencyId', 'documentId', 'templateVersionId', 'tenancyId', 'propertyId', 'title']) if (!String(payload[required] || '').trim()) throw new Error(`${required} is required.`); return { taskId: String(payload.taskId), agencyId: String(payload.agencyId), documentId: String(payload.documentId), templateVersionId: String(payload.templateVersionId), packetId: typeof payload.packetId === 'string' ? payload.packetId : undefined, tenancyId: String(payload.tenancyId), propertyId: String(payload.propertyId), title: String(payload.title), fields: payload.fields && typeof payload.fields === 'object' && !Array.isArray(payload.fields) ? payload.fields as DocumentTask['fields'] : {}, appendixText: typeof payload.appendixText === 'string' ? payload.appendixText : undefined }; }
function digest(bytes: Uint8Array | Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }

async function render(task: DocumentTask) {
  const db = firestoreDb(app());
  const templateRef = db.doc(`agencies/${task.agencyId}/documentTemplateVersions/${task.templateVersionId}`);
  let templateSnap = await templateRef.get();
  if (!templateSnap.exists) templateSnap = await db.doc(`documentTemplateVersions/${task.templateVersionId}`).get();
  if (!templateSnap.exists) throw new Error(`Document template version ${task.templateVersionId} was not found.`);
  const template = templateSnap.data() as Record<string, unknown>;
  if (String(template.status) !== 'published') throw new Error('Only published document template versions may be rendered.');
  const sourceObjectPath = String(template.sourceObjectPath || ''); const sourceSha256 = String(template.sourceSha256 || '');
  if (!sourceObjectPath || !sourceSha256) throw new Error('Published template must contain sourceObjectPath and sourceSha256.');
  const projectId = process.env.GOOGLE_CLOUD_PROJECT?.trim(); const bucketName = process.env.DOCUMENT_BUCKET?.trim() || process.env.REPORT_BUCKET?.trim() || (projectId ? `${projectId}-reports` : ''); if (!bucketName) throw new Error('DOCUMENT_BUCKET or REPORT_BUCKET is required.');
  const bucket = getStorage(app()).bucket(bucketName); const [sourceBytes] = await bucket.file(sourceObjectPath).download(); if (digest(sourceBytes) !== sourceSha256) throw new Error('Template source hash does not match published provenance.');

  const pdf = await PDFDocument.load(sourceBytes); const form = pdf.getForm(); const schema = template.fieldSchema && typeof template.fieldSchema === 'object' ? template.fieldSchema as Record<string, unknown> : {};
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

  const bytes = await pdf.save(); const sha256 = digest(bytes); const objectPath = `agencies/${task.agencyId}/tenancy-documents/${task.documentId}/v1-${sha256.slice(0, 16)}.pdf`; const output = bucket.file(objectPath);
  await output.save(Buffer.from(bytes), { resumable: false, contentType: 'application/pdf', preconditionOpts: { ifGenerationMatch: 0 }, metadata: { cacheControl: 'private, max-age=0, no-store', metadata: { sha256, templateVersionId: task.templateVersionId, sourceTemplateSha256: sourceSha256, packetId: task.packetId || '' } } });
  const [meta] = await output.getMetadata(); const now = new Date().toISOString();
  await db.doc(`agencies/${task.agencyId}/tenancyDocuments/${task.documentId}`).set({ id: task.documentId, agencyId: task.agencyId, tenancyId: task.tenancyId, propertyId: task.propertyId, type: String(template.purpose || 'other'), title: task.title, status: 'ready', contentType: 'application/pdf', templateKey: task.templateVersionId, objectPath, sha256, generation: String(meta.generation || ''), documentVersion: 1, immutable: false, packetId: task.packetId || null, templateVersionId: task.templateVersionId, templateSourceSha256: sourceSha256, createdBy: 'system:document-worker', createdAt: now, updatedAt: now, version: 1 }, { merge: false });
  await db.doc(`agencies/${task.agencyId}/taskOutbox/${task.taskId}`).set({ status: 'completed', completedAt: now, result: { documentId: task.documentId, objectPath, sha256, generation: String(meta.generation || '') }, updatedAt: now }, { merge: true });
  return { documentId: task.documentId, objectPath, sha256, generation: String(meta.generation || '') };
}

const server = createServer(async (req, res) => { try { if (req.method === 'GET' && req.url === '/health') return json(res, 200, { status: 'ok', service: 'document-worker' }); if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' }); const task = decode(await body(req)); return json(res, 200, { data: await render(task) }); } catch (error) { console.error(JSON.stringify({ level: 'error', message: 'document-worker.failed', error: error instanceof Error ? error.message : String(error) })); return json(res, 500, { error: error instanceof Error ? error.message : String(error) }); } });
server.listen(Number(process.env.PORT || 8080), '0.0.0.0');
