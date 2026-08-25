import type {
  ComponentConditionCategory,
  ComponentCleanlinessCategory,
  ComponentWorkingStatus,
  ComponentTestStatus,
  ComponentReviewStatus,
  ComponentComparisonStatus,
  PresenceComparison,
  ConditionComparison,
  CleanlinessComparison,
  WorkingComparison,
  ComponentEvidencePair,
  BaselineComponentSnapshot,
  ReportPhotoReference,
} from '@pcr/domain';
import type { Photo, InspectionItem } from '../types';
import { fileToBase64 } from '../utils';
import { isOperationalItem } from './platform/propertySeedingService';
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
  presenceComparison?: PresenceComparison;
  conditionComparison?: ConditionComparison;
  cleanlinessComparison?: CleanlinessComparison;
  workingComparison?: WorkingComparison;
  comparisonCommentary?: string;
  baselineComponentData?: BaselineComponentSnapshot;
  evidencePairs?: ComponentEvidencePair[];
  comparisonConfidence?: number;
  comparisonUncertainty?: string;
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

const preparePhotoPayload = async (photo: Photo): Promise<SerializedPhoto> => {
  let base64Data: string | undefined;
  let mimeType = 'image/jpeg';

  if (photo.file && photo.file instanceof File) {
    try {
      base64Data = await fileToBase64(photo.file);
      mimeType = photo.file.type || 'image/jpeg';
    } catch {
      base64Data = undefined;
    }
  } else {
    const srcUrl = photo.previewUrl || photo.downloadUrl;
    if (srcUrl) {
      if (srcUrl.startsWith('data:')) {
        const parts = srcUrl.split(',');
        mimeType = parts[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
        base64Data = parts[1];
      } else {
        try {
          const response = await fetch(srcUrl);
          const blob = await response.blob();
          mimeType = blob.type || 'image/jpeg';
          base64Data = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              if (typeof reader.result === 'string') resolve(reader.result.split(',')[1]);
              else reject(new Error('Failed base64 conversion'));
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        } catch {
          base64Data = undefined;
        }
      }
    }
  }

  return {
    id: photo.id,
    filename: photo.file?.name || photo.id,
    mimeType,
    base64Data,
    tags: photo.tags || [],
  };
};

const preparePreviousReportPayload = async (
  file?: File,
  notes?: string,
): Promise<SerializedPreviousReport | undefined> => {
  if (!file && !notes) return undefined;
  let base64Data: string | undefined;
  if (file) {
    try {
      base64Data = await fileToBase64(file);
    } catch {
      base64Data = undefined;
    }
  }
  return {
    filename: file?.name,
    mimeType: file?.type || 'application/pdf',
    base64Data,
    notes,
  };
};

async function callAnalysisApi<T>(endpoint: string, body: unknown): Promise<T> {
  const agencyId = typeof window !== 'undefined'
    ? window.localStorage.getItem('agencyId') || window.localStorage.getItem('pcr_agency_id') || undefined
    : undefined;
  return apiRequest<T>(agencyId, `/api/v1/analysis/${endpoint}`, { method: 'POST', body });
}

export const analyzePhotoCanvas = async (photo: Photo): Promise<PhotoVisualAnalysis> => {
  const filename = photo.file?.name || photo.id;
  const tags = photo.tags || [];
  return {
    photoId: photo.id,
    filename,
    tags,
    aspectRatio: 'landscape',
    brightnessDescription: 'visual preview available',
    colorToneDescription: 'not used for condition assessment',
    textureDescription: 'not used for condition assessment',
    surfaceVarianceDescription: 'not used for condition assessment',
  };
};

export const generateImageTags = async (photo: Photo): Promise<string[]> => {
  const payload = await preparePhotoPayload(photo);
  return callAnalysisApi<string[]>('photo-tags', { photo: payload });
};

export const discoverRoomItems = async (
  roomName: string,
  photos: Photo[],
): Promise<StructuredComponentAnalysis[]> => {
  const photoPayload = await Promise.all(photos.map(preparePhotoPayload));
  return callAnalysisApi<StructuredComponentAnalysis[]>('discover-components', { roomName, photos: photoPayload });
};

export const generateOverallComment = async (
  roomName: string,
  photos: Photo[],
  currentComment: string,
  previousReportFile?: File,
  previousReportNotes?: string,
): Promise<string> => {
  const photoPayload = await Promise.all(photos.map(preparePhotoPayload));
  const previousReport = await preparePreviousReportPayload(previousReportFile, previousReportNotes);
  return callAnalysisApi<string>('overall-comment', {
    roomName,
    photos: photoPayload,
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
  previousReportNotes?: string,
): Promise<StructuredComponentAnalysis> => {
  const photoPayload = await Promise.all(photos.map(preparePhotoPayload));
  const previousReport = await preparePreviousReportPayload(previousReportFile, previousReportNotes);
  const result = await callAnalysisApi<StructuredComponentAnalysis>('component', {
    itemName,
    roomName,
    photos: photoPayload,
    currentComment,
    previousReport,
  });
  return enforceClientWorkingRules(result, itemName);
};

export const generateBatchRoomAnalysis = async (
  roomName: string,
  photos: Photo[],
  items: InspectionItem[],
  currentOverallComment: string,
  previousReportFile?: File,
  previousReportNotes?: string,
): Promise<BatchRoomResult> => {
  const photoPayload = await Promise.all(photos.map(preparePhotoPayload));
  const previousReport = await preparePreviousReportPayload(previousReportFile, previousReportNotes);
  const result = await callAnalysisApi<BatchRoomResult>('batch-room', {
    roomName,
    photos: photoPayload,
    items: items.map((item) => ({ id: item.id, name: item.name, comment: item.comment })),
    currentOverallComment,
    previousReport,
  });
  return {
    ...result,
    items: result.items.map((item) => enforceClientWorkingRules(item, item.name || item.id)),
  };
};

function enforceClientWorkingRules(
  analysis: StructuredComponentAnalysis,
  itemName: string,
): StructuredComponentAnalysis {
  if (isOperationalItem(itemName)) {
    return { ...analysis, workingStatus: 'untested', testStatus: 'untested' };
  }
  return { ...analysis, workingStatus: 'not_applicable', testStatus: 'not_applicable' };
}

export async function generateExitComparison(
  roomName: string,
  item: InspectionItem,
  photos: Photo[],
): Promise<StructuredComponentAnalysis> {
  if (!item.baselineComponentData) {
    throw new Error(`No immutable Entry baseline is linked to ${item.name}.`);
  }
  const photoPayload = await Promise.all(photos.map(preparePhotoPayload));
  return callAnalysisApi<StructuredComponentAnalysis>('exit-comparison', {
    roomName,
    itemName: item.name,
    baselineComponent: item.baselineComponentData,
    currentExitComponent: {
      conditionCategory: item.conditionCategory,
      cleanlinessCategory: item.cleanlinessCategory,
      workingStatus: item.workingStatus,
      testStatus: item.testStatus,
      commentary: item.comment,
      defects: item.defects,
      photoReferences: item.photoReferences || [],
    },
    photos: photoPayload,
  });
}
