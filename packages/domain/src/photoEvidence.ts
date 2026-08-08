export const PHOTO_STORAGE_AREAS = {
  originals: 'inspection-originals',
  derived: 'inspection-derived',
  temporary: 'temporary-uploads',
  finalAssets: 'final-report-assets',
  finalArchives: 'final-report-archives',
} as const;

export type PhotoStorageArea = typeof PHOTO_STORAGE_AREAS[keyof typeof PHOTO_STORAGE_AREAS];
export type PhotoAssetKind = 'original' | 'thumbnail' | 'analysis' | 'final_report_asset' | 'final_report_archive';
export type PhotoProcessingStatus = 'upload_pending' | 'uploading' | 'uploaded' | 'validating' | 'processing' | 'available' | 'duplicate' | 'rejected' | 'failed';

export interface PhotoEvidenceRecord {
  id: string;
  agencyId: string;
  propertyId: string;
  inspectionJobId: string;
  reportId?: string;
  areaId?: string;
  componentIds: string[];
  originalFilename: string;
  objectPath: string;
  storageArea: PhotoStorageArea;
  contentType: string;
  fileSize: number;
  sha256: string;
  captureTimestamp?: string;
  uploadTimestamp: string;
  uploadedBy: string;
  assetKind: PhotoAssetKind;
  sourcePhotoId?: string;
  processingStatus: PhotoProcessingStatus;
  generation?: string;
  metageneration?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UploadSessionRecord {
  id: string;
  agencyId: string;
  propertyId: string;
  inspectionJobId: string;
  reportId?: string;
  areaId?: string;
  componentIds: string[];
  originalFilename: string;
  contentType: string;
  fileSize: number;
  sha256: string;
  objectPath: string;
  resumableUploadUrl?: string;
  status: 'issued' | 'uploading' | 'completed' | 'expired' | 'cancelled' | 'duplicate';
  issuedTo: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface EvidenceUploadCompletion {
  bucket: string;
  objectPath: string;
  generation: string;
  metageneration?: string;
  contentType?: string;
  size?: number;
  sha256?: string;
  completedAt: string;
}

export function originalObjectPath(input: {
  agencyId: string;
  inspectionJobId: string;
  uploadSessionId: string;
  sha256: string;
  extension: string;
}): string {
  const extension = input.extension.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
  return `${PHOTO_STORAGE_AREAS.originals}/agencies/${input.agencyId}/jobs/${input.inspectionJobId}/${input.uploadSessionId}/${input.sha256}.${extension}`;
}
