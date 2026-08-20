import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import type { PropertyDocument, PropertyDocumentType } from '@pcr/domain';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies } from './types.js';

const ALLOWED_CONTENT_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);
const MAX_DOCUMENT_BYTES = 150 * 1024 * 1024;

function adminApp() {
  return getApps()[0] ?? initializeApp({ credential: applicationDefault() });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Property document command exceeds 1 MB.');
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required');
    return parsed as Record<string, unknown>;
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }
}

function agencyId(req: IncomingMessage): string {
  const value = req.headers['x-agency-id']?.toString().trim();
  if (!value) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.');
  return value;
}

function cleanFileName(value: string): string {
  const base = value.trim().split(/[\\/]/u).pop() || 'document';
  return base.replace(/[^a-zA-Z0-9._ -]+/gu, '_').slice(0, 180) || 'document';
}

function validHash(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/iu.test(value.trim())) {
    throw new ApiError(400, 'SHA256_REQUIRED', 'A valid SHA-256 digest is required.');
  }
  return value.trim().toLowerCase();
}

function documentType(value: unknown): PropertyDocumentType {
  const supported = new Set<PropertyDocumentType>([
    'entry_report', 'routine_report', 'exit_report', 'maintenance_report', 'comparison_report',
    'floor_plan', 'building_plan', 'property_photo', 'owner_instruction', 'furnishing_inventory',
    'appliance_schedule', 'key_schedule', 'contractor_report', 'quote', 'invoice', 'completion_report',
    'warranty', 'compliance_certificate', 'appliance_manual', 'strata_plan', 'exclusive_use_plan',
    'strata_bylaw', 'other',
  ]);
  return typeof value === 'string' && supported.has(value as PropertyDocumentType)
    ? (value as PropertyDocumentType)
    : 'other';
}

function expectedVersion(body: Record<string, unknown>): number {
  const value = body.expectedVersion;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new ApiError(400, 'EXPECTED_VERSION_REQUIRED', 'expectedVersion must be a positive integer.');
  }
  return value;
}

export async function routePropertyDocumentRequest(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
): Promise<ApiResponse | undefined> {
  const parts = new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean);
  if (parts[0] !== 'api' || parts[1] !== 'v1' || parts[2] !== 'properties' || !parts[3] || parts[4] !== 'documents') {
    return undefined;
  }

  const propertyId = decodeURIComponent(parts[3]);
  const agency = agencyId(req);
  const property = await dependencies.repository.get('properties', agency, propertyId);
  if (!property) throw new ApiError(404, 'PROPERTY_NOT_FOUND', 'Property record was not found.');

  if (req.method === 'POST' && parts[5] === 'upload-session' && parts.length === 6) {
    const body = await readJson(req);
    const principal = await authenticateAndAuthorise(
      req,
      dependencies,
      'property.manage',
      { agencyId: agency, propertyId },
      correlationId,
    );
    const fileName = cleanFileName(typeof body.fileName === 'string' ? body.fileName : '');
    const contentType = typeof body.contentType === 'string' ? body.contentType.trim().toLowerCase() : '';
    const fileSize = typeof body.fileSize === 'number' ? body.fileSize : Number(body.fileSize);
    const sha256 = validHash(body.sha256);
    if (!fileName) throw new ApiError(400, 'FILE_NAME_REQUIRED', 'fileName is required.');
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      throw new ApiError(400, 'CONTENT_TYPE_UNSUPPORTED', 'Property document type is not supported.');
    }
    if (!Number.isInteger(fileSize) || fileSize < 1 || fileSize > MAX_DOCUMENT_BYTES) {
      throw new ApiError(400, 'FILE_SIZE_INVALID', 'Property documents must be between 1 byte and 150 MB.');
    }

    const uploadId = randomUUID();
    const bucketName = process.env.UPLOAD_BUCKET?.trim();
    if (!bucketName) {
      throw new ApiError(503, 'UPLOAD_BUCKET_REQUIRED', 'UPLOAD_BUCKET is required before property documents can be uploaded.');
    }
    const extension = fileName.includes('.') ? fileName.split('.').pop() : 'bin';
    const objectPath = `property-documents/${agency}/${propertyId}/${uploadId}/${sha256}.${extension}`;
    const file = getStorage(adminApp()).bucket(bucketName).file(objectPath);
    const [resumableUploadUrl] = await file.createResumableUpload({
      metadata: {
        contentType,
        metadata: {
          agencyId: agency,
          propertyId,
          uploadId,
          sha256,
          immutableOriginal: 'true',
          propertyDocument: 'true',
        },
      },
      preconditionOpts: { ifGenerationMatch: 0 },
    });

    await dependencies.repository.create('propertyDocumentUploads', agency, uploadId, {
      propertyId,
      fileName,
      contentType,
      fileSize,
      sha256,
      objectPath,
      status: 'issued',
      issuedTo: principal.uid,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }, principal.uid);

    return {
      status: 201,
      body: { data: { uploadId, objectPath, resumableUploadUrl, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() }, meta: { correlationId } },
    };
  }

  if (req.method === 'POST' && parts[5] && parts[6] === 'complete' && parts.length === 7) {
    const uploadId = decodeURIComponent(parts[5]);
    const body = await readJson(req);
    const principal = await authenticateAndAuthorise(
      req,
      dependencies,
      'property.manage',
      { agencyId: agency, propertyId },
      correlationId,
    );
    const upload = await dependencies.repository.get('propertyDocumentUploads', agency, uploadId);
    if (!upload || upload.propertyId !== propertyId) {
      throw new ApiError(404, 'PROPERTY_DOCUMENT_UPLOAD_NOT_FOUND', 'Property document upload session was not found.');
    }
    if (upload.status === 'complete') {
      const existingDocuments = Array.isArray(property.documents) ? property.documents : [];
      const existing = existingDocuments.find((candidate) => candidate && typeof candidate === 'object' && (candidate as Record<string, unknown>).id === upload.documentId);
      if (existing) return { status: 200, body: { data: existing, meta: { correlationId, replayed: true } } };
    }

    const bucketName = process.env.UPLOAD_BUCKET?.trim();
    if (!bucketName) throw new ApiError(503, 'UPLOAD_BUCKET_REQUIRED', 'UPLOAD_BUCKET is required.');
    const objectPath = String(upload.objectPath || '');
    const file = getStorage(adminApp()).bucket(bucketName).file(objectPath);
    const [metadata] = await file.getMetadata().catch(() => {
      throw new ApiError(422, 'PROPERTY_DOCUMENT_OBJECT_NOT_FOUND', 'Uploaded property document could not be verified.');
    });
    const generation = String(metadata.generation || '');
    const actualSize = Number(metadata.size);
    if (!generation || actualSize !== Number(upload.fileSize)) {
      throw new ApiError(422, 'PROPERTY_DOCUMENT_SIZE_MISMATCH', 'Uploaded property document does not match the issued upload session.');
    }
    const [bytes] = await file.download({ validation: false });
    const actualHash = createHash('sha256').update(bytes).digest('hex');
    if (actualHash !== upload.sha256) {
      throw new ApiError(422, 'PROPERTY_DOCUMENT_HASH_MISMATCH', 'Uploaded property document failed SHA-256 verification.');
    }

    const now = new Date().toISOString();
    const id = randomUUID();
    const record: PropertyDocument = {
      id,
      type: documentType(body.type),
      title: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : String(upload.fileName),
      fileName: String(upload.fileName),
      contentType: String(upload.contentType),
      fileSize: Number(upload.fileSize),
      sha256: actualHash,
      objectPath,
      generation,
      source: body.source === 'external_system' || body.source === 'google_drive' || body.source === 'other' ? body.source : 'legacy_upload',
      ...(typeof body.sourceSystem === 'string' && body.sourceSystem.trim() ? { sourceSystem: body.sourceSystem.trim() } : {}),
      ...(typeof body.inspectionType === 'string' ? { inspectionType: body.inspectionType as PropertyDocument['inspectionType'] } : {}),
      ...(typeof body.inspectionDate === 'string' && body.inspectionDate ? { inspectionDate: body.inspectionDate } : {}),
      ...(typeof body.tenancyId === 'string' && body.tenancyId ? { tenancyId: body.tenancyId } : {}),
      ...(typeof body.description === 'string' && body.description.trim() ? { description: body.description.trim() } : {}),
      uploadedBy: principal.uid,
      uploadedAt: now,
      status: 'active',
      importStatus: ['entry_report', 'routine_report', 'exit_report', 'maintenance_report', 'comparison_report'].includes(documentType(body.type)) ? 'analysis_pending' : 'not_applicable',
      useAsBaseline: body.useAsBaseline === true,
    };

    const documents = [...(Array.isArray(property.documents) ? property.documents : []), record];
    await dependencies.repository.update(
      'properties',
      agency,
      propertyId,
      { documents, updatedAt: now },
      expectedVersion(body),
      principal.uid,
    );
    await dependencies.repository.update(
      'propertyDocumentUploads',
      agency,
      uploadId,
      { status: 'complete', documentId: id, generation, completedAt: now },
      Number(upload.version),
      principal.uid,
    );
    await dependencies.audit.append({
      id: randomUUID(),
      timestamp: now,
      actorId: principal.uid,
      actorRole: principal.role,
      agencyId: agency,
      capability: 'property.manage',
      outcome: 'allowed',
      reason: 'property.document_uploaded',
      target: { agencyId: agency, propertyId },
      correlationId,
      entityType: 'property_document',
      entityId: id,
      eventType: 'property.document_uploaded',
      metadata: { objectPath, generation, sha256: actualHash, type: record.type },
    });
    return { status: 201, body: { data: record, meta: { correlationId } } };
  }

  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Unsupported property document command.');
}
