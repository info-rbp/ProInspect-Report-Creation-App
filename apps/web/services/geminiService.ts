import type {
  ComponentConditionCategory,
  ComponentCleanlinessCategory,
  ComponentWorkingStatus,
  ComponentTestStatus,
  ComponentReviewStatus,
  ComponentComparisonStatus,
  ReportPhotoReference,
} from '@pcr/domain';
import type { Photo, InspectionItem } from '../types';
import { fileToBase64 } from '../utils';
import { apiRequest } from './apiClient';

export interface PhotoVisualAnalysis {
  photoId: string;
  filename: string;
  tags: string[];
  aspectRatio: 'landscape' | 'portrait' | 'square';
  brightnessDescription: string;
  colorToneDescription: string;
  textureDescription: string;
  surfaceVarianceDescription: string;
}

export interface StructuredComponentAnalysis {
  id: string;
  name?: string;
  conditionCategory: ComponentConditionCategory;
  cleanlinessCategory: ComponentCleanlinessCategory;
  workingStatus: ComponentWorkingStatus;
  testStatus: ComponentTestStatus;
  defects: string[];
  maintenanceRequired: boolean;
  commentary: string;
  evidencePhotoIds?: string[];
  photoReferences?: ReportPhotoReference[];
  aiConfidence?: number;
  uncertainty?: string;
  reviewStatus?: ComponentReviewStatus;
  comparisonStatus?: ComponentComparisonStatus;
}

export interface BatchRoomResult {
  overallComment: string;
  items: StructuredComponentAnalysis[];
}

interface SerializedPhoto {
  id: string;
  filename: string;
  mimeType: string;
  base64Data?: string;
  tags: string[];
}

interface SerializedPreviousReport {
  filename?: string;
  mimeType?: string;
  base64Data?: string;
  notes?: string;
}

function currentAgencyId(): string {
  if (typeof window === 'undefined') return 'agency-demo';
  return window.localStorage.getItem('agencyId') || 'agency-demo';
}

const preparePhotoPayload = async (photo: Photo): Promise<SerializedPhoto> => {
  let base64Data: string | undefined;
  let mimeType = 'image/jpeg';

  if (photo.file && photo.file instanceof File && photo.file.size > 0) {
    base64Data = await fileToBase64(photo.file);
    mimeType = photo.file.type || mimeType;
  } else {
    const srcUrl = photo.previewUrl || photo.downloadUrl;
    if (srcUrl?.startsWith('data:')) {
      const parts = srcUrl.split(',');
      mimeType = parts[0]?.match(/:(.*?);/)?.[1] || mimeType;
      base64Data = parts[1];
    }
  }

  return {
    id: photo.id,
    filename: photo.file?.name || photo.id,
    mimeType,
    ...(base64Data ? { base64Data } : {}),
    tags: photo.tags || [],
  };
};

const preparePreviousReportPayload = async (
  file?: File,
  notes?: string
): Promise<SerializedPreviousReport | undefined> => {
  if (!file && !notes) return undefined;
  let base64Data: string | undefined;
  if (file && file.size > 0) base64Data = await fileToBase64(file);
  return {
    ...(file?.name ? { filename: file.name } : {}),
    ...(file?.type ? { mimeType: file.type } : { mimeType: 'application/pdf' }),
    ...(base64Data ? { base64Data } : {}),
    ...(notes ? { notes } : {}),
  };
};

async function callAnalysisApi<T>(endpoint: string, body: unknown): Promise<T> {
  const agencyId = currentAgencyId();
  return apiRequest<T>(agencyId, `/api/v1/analysis/${endpoint}`, {
    method: 'POST',
    body,
  });
}

/**
 * Retained for backwards-compatible imports only. Canvas heuristics must never be
 * treated as property-condition evidence, so this returns descriptive unknowns
 * rather than condition or cleanliness claims.
 */
export const analyzePhotoCanvas = async (photo: Photo): Promise<PhotoVisualAnalysis> => ({
  photoId: photo.id,
  filename: photo.file?.name || photo.id,
  tags: photo.tags || [],
  aspectRatio: 'landscape',
  brightnessDescription: 'not assessed',
  colorToneDescription: 'not assessed',
  textureDescription: 'not assessed',
  surfaceVarianceDescription: 'not assessed',
});

export const generateImageTags = async (photo: Photo): Promise<string[]> => {
  const photoPayload = await preparePhotoPayload(photo);
  return callAnalysisApi<string[]>('photo-tags', { photo: photoPayload });
};

export const discoverRoomItems = async (
  roomName: string,
  photos: Photo[]
): Promise<StructuredComponentAnalysis[]> => {
  const photoPayloads = await Promise.all(photos.map(preparePhotoPayload));
  return callAnalysisApi<StructuredComponentAnalysis[]>('discover-components', {
    roomName,
    photos: photoPayloads,
  });
};

export const generateOverallComment = async (
  roomName: string,
  photos: Photo[],
  currentComment: string,
  previousReportFile?: File,
  previousReportNotes?: string
): Promise<string> => {
  const photoPayloads = await Promise.all(photos.map(preparePhotoPayload));
  const previousReport = await preparePreviousReportPayload(previousReportFile, previousReportNotes);
  return callAnalysisApi<string>('overall-comment', {
    roomName,
    photos: photoPayloads,
    currentComment,
    previousReport,
  });
};

export const generateItemComment = async (
  itemName: string,
  roomName: string,
  photos: Photo[],
  currentComment: string,
  previousReportFile?: File,
  previousReportNotes?: string
): Promise<StructuredComponentAnalysis> => {
  const photoPayloads = await Promise.all(photos.map(preparePhotoPayload));
  const previousReport = await preparePreviousReportPayload(previousReportFile, previousReportNotes);
  return callAnalysisApi<StructuredComponentAnalysis>('component', {
    itemName,
    roomName,
    photos: photoPayloads,
    currentComment,
    previousReport,
  });
};

export const generateBatchRoomAnalysis = async (
  roomName: string,
  photos: Photo[],
  items: InspectionItem[],
  currentOverallComment: string,
  previousReportFile?: File,
  previousReportNotes?: string
): Promise<BatchRoomResult> => {
  const photoPayloads = await Promise.all(photos.map(preparePhotoPayload));
  const previousReport = await preparePreviousReportPayload(previousReportFile, previousReportNotes);
  const itemsPayload = items.map((item) => ({
    id: item.id,
    name: item.name,
    comment: item.comment,
  }));

  return callAnalysisApi<BatchRoomResult>('batch-room', {
    roomName,
    photos: photoPayloads,
    items: itemsPayload,
    currentOverallComment,
    previousReport,
  });
};
