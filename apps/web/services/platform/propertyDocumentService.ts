import type { PropertyDocument, PropertyDocumentType, PropertyRecord } from '../../types/platform';
import { generateId } from '../../utils';
import { apiRequest } from '../apiClient';
import { isFirebaseConfigured } from '../storageService';
import { localGet, localPut } from './localPlatformStore';
import { getProperty, updateProperty } from './propertyService';

const CHUNK_SIZE = 8 * 1024 * 1024;

export interface PropertyDocumentUploadMetadata {
  type: PropertyDocumentType;
  title?: string;
  source?: PropertyDocument['source'];
  sourceSystem?: string;
  inspectionType?: PropertyDocument['inspectionType'];
  inspectionDate?: string;
  tenancyId?: string;
  description?: string;
  useAsBaseline?: boolean;
}

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

async function sha256(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function uploadChunks(file: File, uploadUrl: string): Promise<void> {
  let start = 0;
  while (start < file.size) {
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'content-type': file.type || 'application/octet-stream',
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
  metadata: PropertyDocumentUploadMetadata,
  digest: string,
): Promise<PropertyDocument> {
  const id = `document-${generateId()}`;
  const now = new Date().toISOString();
  const document: PropertyDocument = {
    id,
    type: metadata.type,
    title: metadata.title?.trim() || file.name,
    fileName: file.name,
    contentType: file.type || 'application/octet-stream',
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
  const digest = await sha256(file);
  if (!apiEnabled()) return localUpload(property, file, metadata, digest);

  const session = await apiRequest<UploadSession>(
    property.agencyId,
    `/api/v1/properties/${encodeURIComponent(property.id)}/documents/upload-session`,
    {
      method: 'POST',
      body: {
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
        fileSize: file.size,
        sha256: digest,
      },
    },
  );
  await uploadChunks(file, session.resumableUploadUrl);
  return apiRequest<PropertyDocument>(
    property.agencyId,
    `/api/v1/properties/${encodeURIComponent(property.id)}/documents/${encodeURIComponent(session.uploadId)}/complete`,
    {
      method: 'POST',
      body: {
        ...metadata,
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
