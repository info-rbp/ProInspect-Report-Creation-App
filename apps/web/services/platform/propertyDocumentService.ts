import type { PropertyDocument, PropertyDocumentType, PropertyRecord } from '../../types/platform';
import { generateId } from '../../utils';
import { apiRequest } from '../apiClient';
import { isFirebaseConfigured } from '../storageService';
import { localGet, localPut } from './localPlatformStore';
import { getProperty, updateProperty } from './propertyService';

const CHUNK_SIZE = 8 * 1024 * 1024;
const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
};

const PROPERTY_DOCUMENT_TYPES = new Set<PropertyDocumentType>([
  'entry_report',
  'routine_report',
  'exit_report',
  'maintenance_report',
  'comparison_report',
  'floor_plan',
  'building_plan',
  'property_photo',
  'owner_instruction',
  'furnishing_inventory',
  'appliance_schedule',
  'key_schedule',
  'contractor_report',
  'quote',
  'invoice',
  'completion_report',
  'warranty',
  'compliance_certificate',
  'appliance_manual',
  'strata_plan',
  'exclusive_use_plan',
  'strata_bylaw',
  'other',
]);

const PROPERTY_DOCUMENT_SOURCES = new Set<PropertyDocument['source']>([
  'proinspect',
  'legacy_upload',
  'external_system',
  'google_drive',
  'other',
]);

/**
 * This is a browser form boundary, so raw string values from selects are accepted
 * here and narrowed before either local persistence or an API command is issued.
 */
export interface PropertyDocumentUploadMetadata {
  type: PropertyDocumentType | string;
  title?: string;
  source?: PropertyDocument['source'] | string;
  sourceSystem?: string;
  inspectionType?: PropertyDocument['inspectionType'];
  inspectionDate?: string;
  tenancyId?: string;
  description?: string;
  useAsBaseline?: boolean;
}

type NormalisedUploadMetadata = Omit<PropertyDocumentUploadMetadata, 'type' | 'source'> & {
  type: PropertyDocumentType;
  source?: PropertyDocument['source'];
};

interface UploadSession {
  uploadId: string;
  objectPath: string;
  resumableUploadUrl: string;
  expiresAt: string;
}

interface LocalPropertyDocumentBlob {
  id: string;
  propertyId: string;
  fileName: string;
  contentType: string;
  blob: Blob;
  createdAt: string;
}

function apiEnabled(): boolean {
  return isFirebaseConfigured() && Boolean(import.meta.env.VITE_API_BASE_URL?.trim());
}

function normaliseMetadata(metadata: PropertyDocumentUploadMetadata): NormalisedUploadMetadata {
  if (!PROPERTY_DOCUMENT_TYPES.has(metadata.type as PropertyDocumentType)) {
    throw new Error(`Unsupported property document category: ${metadata.type || 'empty'}.`);
  }
  if (metadata.source && !PROPERTY_DOCUMENT_SOURCES.has(metadata.source as PropertyDocument['source'])) {
    throw new Error(`Unsupported property document source: ${metadata.source}.`);
  }
  return {
    ...metadata,
    type: metadata.type as PropertyDocumentType,
    ...(metadata.source ? { source: metadata.source as PropertyDocument['source'] } : {}),
  };
}

function contentType(file: File): string {
  if (file.type && file.type !== 'application/octet-stream') return file.type.toLowerCase();
  const extension = file.name.toLowerCase().split('.').pop() || '';
  const inferred = MIME_BY_EXTENSION[extension];
  if (!inferred) throw new Error(`Unsupported property document file type: .${extension || 'unknown'}`);
  return inferred;
}

async function sha256(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function uploadChunks(file: File, uploadUrl: string, mimeType: string): Promise<void> {
  let start = 0;
  while (start < file.size) {
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'content-type': mimeType,
        'content-range': `bytes ${start}-${end - 1}/${file.size}`,
      },
      body: file.slice(start, end),
    });
    if (response.status === 308) {
      const range = response.headers.get('range');
      start = range ? Number(range.split('-').pop()) + 1 : end;
      continue;
    }
    if (!response.ok) throw new Error(`Property document upload failed with ${response.status}.`);
    start = file.size;
  }
}

async function localUpload(
  property: PropertyRecord,
  file: File,
  metadata: NormalisedUploadMetadata,
  digest: string,
  mimeType: string,
): Promise<PropertyDocument> {
  const id = `document-${generateId()}`;
  const now = new Date().toISOString();
  const document: PropertyDocument = {
    id,
    type: metadata.type,
    title: metadata.title?.trim() || file.name,
    fileName: file.name,
    contentType: mimeType,
    fileSize: file.size,
    sha256: digest,
    source: metadata.source || 'legacy_upload',
    sourceSystem: metadata.sourceSystem,
    inspectionType: metadata.inspectionType,
    inspectionDate: metadata.inspectionDate,
    tenancyId: metadata.tenancyId,
    description: metadata.description,
    uploadedAt: now,
    status: 'local_only',
    importStatus: ['entry_report', 'routine_report', 'exit_report', 'maintenance_report', 'comparison_report'].includes(metadata.type)
      ? 'analysis_pending'
      : 'not_applicable',
    useAsBaseline: metadata.useAsBaseline,
  };
  await localPut<LocalPropertyDocumentBlob>('propertyDocuments', {
    id,
    propertyId: property.id,
    fileName: file.name,
    contentType: document.contentType,
    blob: file,
    createdAt: now,
  });
  await updateProperty(property.id, { documents: [...(property.documents || []), document] });
  return document;
}

export async function uploadPropertyDocument(
  property: PropertyRecord,
  file: File,
  metadata: PropertyDocumentUploadMetadata,
): Promise<PropertyDocument> {
  const normalisedMetadata = normaliseMetadata(metadata);
  const mimeType = contentType(file);
  const digest = await sha256(file);
  if (!apiEnabled()) return localUpload(property, file, normalisedMetadata, digest, mimeType);

  const session = await apiRequest<UploadSession>(
    property.agencyId,
    `/api/v1/properties/${encodeURIComponent(property.id)}/documents/upload-session`,
    {
      method: 'POST',
      body: {
        fileName: file.name,
        contentType: mimeType,
        fileSize: file.size,
        sha256: digest,
      },
    },
  );
  await uploadChunks(file, session.resumableUploadUrl, mimeType);
  return apiRequest<PropertyDocument>(
    property.agencyId,
    `/api/v1/properties/${encodeURIComponent(property.id)}/documents/${encodeURIComponent(session.uploadId)}/complete`,
    {
      method: 'POST',
      body: {
        ...normalisedMetadata,
        expectedVersion: property.version ?? 1,
      },
    },
  );
}

export async function openLocalPropertyDocument(documentId: string): Promise<string | undefined> {
  const stored = await localGet<LocalPropertyDocumentBlob>('propertyDocuments', documentId);
  return stored?.blob ? URL.createObjectURL(stored.blob) : undefined;
}

export async function refreshPropertyDocuments(propertyId: string): Promise<PropertyDocument[]> {
  return (await getProperty(propertyId))?.documents || [];
}
