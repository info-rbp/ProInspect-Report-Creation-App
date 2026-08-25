import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { createPriceBookImport } from '../services/maintenanceCommercialService.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies } from './types.js';

const ALLOWED_CONTENT_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'application/csv',
]);
const MAX_PRICE_BOOK_BYTES = 50 * 1024 * 1024;

function adminApp() {
  return getApps()[0] ?? initializeApp({ credential: applicationDefault() });
}

function parts(req: IncomingMessage): string[] {
  return new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean);
}

function agencyHeader(req: IncomingMessage): string {
  const value = req.headers['x-agency-id']?.toString().trim();
  if (!value) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.');
  return value;
}

async function readJson(req: IncomingMessage, maxBytes = 10 * 1024 * 1024): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Price-book command is too large.');
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

function cleanFileName(value: string): string {
  const base = value.trim().split(/[\\/]/u).pop() || 'price-book.xlsx';
  return base.replace(/[^a-zA-Z0-9._ -]+/gu, '_').slice(0, 180) || 'price-book.xlsx';
}

function validHash(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/iu.test(value.trim())) {
    throw new ApiError(400, 'SHA256_REQUIRED', 'A valid SHA-256 digest is required.');
  }
  return value.trim().toLowerCase();
}

export async function routePriceBookUploadRequest(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
): Promise<ApiResponse | undefined> {
  const route = parts(req);
  if (route[0] !== 'api' || route[1] !== 'v1' || route[2] !== 'price-book-imports') return undefined;
  const agencyId = agencyHeader(req);

  if (req.method === 'POST' && route[3] === 'upload-session' && route.length === 4) {
    const body = await readJson(req);
    const principal = await authenticateAndAuthorise(
      req,
      dependencies,
      'price_book.manage',
      { agencyId },
      correlationId,
    );
    const fileName = cleanFileName(typeof body.fileName === 'string' ? body.fileName : '');
    const contentType = typeof body.contentType === 'string' ? body.contentType.trim().toLowerCase() : '';
    const fileSize = typeof body.fileSize === 'number' ? body.fileSize : Number(body.fileSize);
    const sha256 = validHash(body.sha256);
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      throw new ApiError(400, 'PRICE_BOOK_CONTENT_TYPE_UNSUPPORTED', 'Price books must be XLSX or CSV files.');
    }
    if (!Number.isInteger(fileSize) || fileSize < 1 || fileSize > MAX_PRICE_BOOK_BYTES) {
      throw new ApiError(400, 'PRICE_BOOK_FILE_SIZE_INVALID', 'Price-book source files must be between 1 byte and 50 MB.');
    }
    const bucketName = process.env.UPLOAD_BUCKET?.trim();
    if (!bucketName) throw new ApiError(503, 'UPLOAD_BUCKET_REQUIRED', 'UPLOAD_BUCKET is required for price-book imports.');
    const uploadId = randomUUID();
    const extension = fileName.includes('.') ? fileName.split('.').pop() : 'bin';
    const objectPath = `maintenance-price-books/${agencyId}/${uploadId}/${sha256}.${extension}`;
    const file = getStorage(adminApp()).bucket(bucketName).file(objectPath);
    const [resumableUploadUrl] = await file.createResumableUpload({
      metadata: {
        contentType,
        metadata: {
          agencyId,
          uploadId,
          sha256,
          immutableOriginal: 'true',
          maintenancePriceBook: 'true',
        },
      },
      preconditionOpts: { ifGenerationMatch: 0 },
    });
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await dependencies.repository.create(
      'priceBookUploads',
      agencyId,
      uploadId,
      {
        fileName,
        contentType,
        fileSize,
        sha256,
        objectPath,
        status: 'issued',
        issuedTo: principal.uid,
        expiresAt,
      },
      principal.uid,
    );
    return {
      status: 201,
      body: {
        data: { uploadId, objectPath, resumableUploadUrl, expiresAt },
        meta: { correlationId },
      },
    };
  }

  if (req.method === 'POST' && route[3] && route[4] === 'complete' && route.length === 5) {
    const uploadId = decodeURIComponent(route[3]);
    const body = await readJson(req);
    const principal = await authenticateAndAuthorise(
      req,
      dependencies,
      'price_book.manage',
      { agencyId },
      correlationId,
    );
    const upload = await dependencies.repository.get('priceBookUploads', agencyId, uploadId);
    if (!upload) throw new ApiError(404, 'PRICE_BOOK_UPLOAD_NOT_FOUND', 'Price-book upload session was not found.');
    if (upload.status === 'complete' && typeof upload.importId === 'string') {
      const existing = await dependencies.repository.get('priceBookImports', agencyId, upload.importId);
      if (existing) return { status: 200, body: { data: existing, meta: { correlationId, replayed: true } } };
    }
    if (typeof upload.expiresAt === 'string' && Date.parse(upload.expiresAt) <= Date.now()) {
      throw new ApiError(410, 'PRICE_BOOK_UPLOAD_EXPIRED', 'Price-book upload session has expired.');
    }
    const rows = Array.isArray(body.rows)
      ? body.rows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object' && !Array.isArray(row))
      : [];
    if (!rows.length || rows.length > 20_000) {
      throw new ApiError(400, 'PRICE_BOOK_ROWS_REQUIRED', 'Select a spreadsheet containing between 1 and 20,000 data rows.');
    }
    const bucketName = process.env.UPLOAD_BUCKET?.trim();
    if (!bucketName) throw new ApiError(503, 'UPLOAD_BUCKET_REQUIRED', 'UPLOAD_BUCKET is required.');
    const objectPath = String(upload.objectPath || '');
    const file = getStorage(adminApp()).bucket(bucketName).file(objectPath);
    const [metadata] = await file.getMetadata().catch(() => {
      throw new ApiError(422, 'PRICE_BOOK_OBJECT_NOT_FOUND', 'Uploaded price-book source could not be verified.');
    });
    const generation = String(metadata.generation || '');
    if (!generation || Number(metadata.size) !== Number(upload.fileSize)) {
      throw new ApiError(422, 'PRICE_BOOK_SIZE_MISMATCH', 'Uploaded price-book source does not match its issued upload session.');
    }
    const [bytes] = await file.download({ validation: false });
    const actualHash = createHash('sha256').update(bytes).digest('hex');
    if (actualHash !== upload.sha256) {
      throw new ApiError(422, 'PRICE_BOOK_HASH_MISMATCH', 'Uploaded price-book source failed SHA-256 verification.');
    }
    const imported = await createPriceBookImport(dependencies, {
      agencyId,
      actorId: principal.uid,
      fileName: String(upload.fileName),
      contentType: String(upload.contentType),
      fileSize: Number(upload.fileSize),
      sha256: actualHash,
      ...(typeof body.sheetName === 'string' ? { sheetName: body.sheetName } : {}),
      ...(typeof body.proposedPriceBookName === 'string' ? { proposedPriceBookName: body.proposedPriceBookName } : {}),
      rows,
    });
    const importRecord = await dependencies.repository.get('priceBookImports', agencyId, imported.id);
    if (!importRecord) throw new ApiError(500, 'PRICE_BOOK_IMPORT_NOT_FOUND', 'Created price-book import could not be reloaded.');
    const source = importRecord.source && typeof importRecord.source === 'object'
      ? importRecord.source as Record<string, unknown>
      : {};
    const updatedImport = await dependencies.repository.update(
      'priceBookImports',
      agencyId,
      imported.id,
      {
        source: { ...source, objectPath, generation },
      },
      Number(importRecord.version),
      principal.uid,
    );
    await dependencies.repository.update(
      'priceBookUploads',
      agencyId,
      uploadId,
      { status: 'complete', importId: imported.id, generation, completedAt: new Date().toISOString() },
      Number(upload.version),
      principal.uid,
    );
    await dependencies.audit.append({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      actorId: principal.uid,
      actorRole: principal.role,
      agencyId,
      capability: 'price_book.manage',
      outcome: 'allowed',
      reason: 'price_book.source_verified',
      target: { agencyId, priceBookId: imported.id },
      correlationId,
      entityType: 'price_book_import',
      entityId: imported.id,
      eventType: 'price_book.source_verified',
      metadata: { uploadId, objectPath, generation, sha256: actualHash, rows: rows.length },
    });
    return { status: 201, body: { data: updatedImport, meta: { correlationId } } };
  }

  return undefined;
}
