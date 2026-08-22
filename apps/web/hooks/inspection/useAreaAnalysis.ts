import { useState, useCallback } from 'react';
import type { InspectionType } from '@pcr/domain';
import {
  generateCommentary,
  type ConditionState,
  type StructuredInspectionFact,
  type WorkingState,
} from '@pcr/templates';
import { InspectionItem, Photo, Room } from '../../types';
import {
  generateBatchRoomAnalysis,
  generateItemComment,
  generateOverallComment,
  discoverRoomItems,
  type StructuredComponentAnalysis,
} from '../../services/geminiService';
import { isAiConfigured } from '../../services/configService';
import { getActiveTemplateForType } from '../../services/templateStorage';

export interface UseAreaAnalysisOptions {
  agencyId?: string;
  inspectionType?: string;
}

function canonicalInspectionType(value?: string): InspectionType {
  const normalised = (value || '').toLowerCase();
  if (normalised.includes('routine')) return 'routine';
  if (normalised.includes('exit')) return 'exit';
  if (normalised.includes('comparison')) return 'comparison';
  if (normalised.includes('maintenance') || normalised.includes('follow-up') || normalised.includes('follow up')) return 'maintenance';
  return 'entry';
}

function conditionState(value: StructuredComponentAnalysis['conditionCategory']): ConditionState {
  switch (value) {
    case 'intact': return 'clean_intact';
    case 'minor_wear': return 'minor_wear';
    case 'repair_required': return 'repair_required';
    case 'replacement_recommended': return 'damaged';
    case 'unable_to_confirm':
    default: return 'unable_to_confirm';
  }
}

function workingState(value: StructuredComponentAnalysis['testStatus']): WorkingState {
  switch (value) {
    case 'tested_passed': return 'tested_working';
    case 'tested_failed': return 'tested_not_working';
    case 'not_applicable': return 'not_relevant';
    case 'untested':
    default: return 'not_tested';
  }
}

function humanise(value: string): string {
  return value.replaceAll('_', ' ');
}

function photoReferencesFor(evidencePhotoIds: string[] | undefined, photos: Photo[]) {
  if (!evidencePhotoIds?.length) return [];
  const permitted = new Set(evidencePhotoIds);
  return photos
    .filter((photo) => permitted.has(photo.id))
    .map((photo) => ({
      photoId: photo.id,
      objectPath: photo.objectPath || photo.downloadUrl || `photos/${photo.id}`,
      ...(photo.thumbnailObjectPath ? { thumbnailObjectPath: photo.thumbnailObjectPath } : {}),
    }));
}

async function commentaryFromStructuredAnalysis(input: {
  area: Pick<Room, 'name' | 'canonicalAreaDefinitionId' | 'canonicalAreaDefinitionVersion'>;
  item: InspectionItem;
  analysis: StructuredComponentAnalysis;
  photos: Photo[];
  inspectionType: InspectionType;
}): Promise<{ commentary: string; photoReferences: NonNullable<InspectionItem['photoReferences']> }> {
  const { area, item, analysis, photos, inspectionType } = input;
  const photoReferences = photoReferencesFor(analysis.evidencePhotoIds, photos);
  const template = await getActiveTemplateForType(inspectionType);

  const fact: StructuredInspectionFact = {
    area: area.name,
    component: item.name,
    ...(area.canonicalAreaDefinitionId ? {
      canonicalAreaDefinitionId: area.canonicalAreaDefinitionId,
      canonicalAreaDefinitionVersion: area.canonicalAreaDefinitionVersion,
    } : {}),
    ...(item.canonicalComponentDefinitionId ? {
      canonicalComponentDefinitionId: item.canonicalComponentDefinitionId,
      canonicalComponentDefinitionVersion: item.canonicalComponentDefinitionVersion,
    } : {}),
    ...(item.subComponent ? { subComponent: item.subComponent } : {}),
    ...(item.material ? { material: item.material } : {}),
    ...(item.colour ? { colour: item.colour } : {}),
    ...(item.type ? { type: item.type } : {}),
    ...(item.quantity ? { quantity: item.quantity } : {}),
    visibility: photoReferences.length > 0 ? 'visible' : 'not_visible',
    condition: conditionState(analysis.conditionCategory),
    cleanliness: analysis.cleanlinessCategory,
    ...(analysis.cleanlinessCategory === 'requires_cleaning' || analysis.cleanlinessCategory === 'stained'
      ? { cleanlinessIssue: humanise(analysis.cleanlinessCategory) }
      : {}),
    ...(analysis.defects?.length ? { conditionIssue: analysis.defects.join('; ') } : {}),
    workingState: workingState(analysis.testStatus),
    photoReferences: photoReferences.map((reference) => reference.photoId),
    inspectionType,
  };

  const generated = generateCommentary(template, fact);
  return { commentary: generated.commentary, photoReferences };
}

export function useAreaAnalysis({ agencyId, inspectionType }: UseAreaAnalysisOptions = {}) {
  const [loadingItems, setLoadingItems] = useState<Record<string, string>>({});
  const [generatingOverall, setGeneratingOverall] = useState<string | null>(null);
  const [isBulkGenerating, setIsBulkGenerating] = useState(false);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const aiConfigured = isAiConfigured();
  const activeInspectionType = canonicalInspectionType(inspectionType);

  const analyseArea = useCallback(
    async (area: Room, previousReportNotes?: string): Promise<{ overallComment?: string; updatedItems?: InspectionItem[] } | null> => {
      if (!aiConfigured) {
        setAnalysisError('AI is not configured. Existing inspection assessments have been preserved.');
        return null;
      }

      setIsBulkGenerating(true);
      setAnalysisError(null);

      try {
        const result = await generateBatchRoomAnalysis(
          area.name,
          area.photos || [],
          area.items || [],
          area.overallComment || '',
          undefined,
          previousReportNotes,
        );

        const updatedItems = await Promise.all(area.items.map(async (item) => {
          const match = result.items.find(
            (resItem) => resItem.id === item.id || (resItem.name && resItem.name.toLowerCase() === item.name.toLowerCase()),
          );
          if (!match) return item;

          const generated = await commentaryFromStructuredAnalysis({
            area,
            item,
            analysis: match,
            photos: area.photos,
            inspectionType: activeInspectionType,
          });

          return {
            ...item,
            conditionCategory: match.conditionCategory,
            cleanlinessCategory: match.cleanlinessCategory,
            workingStatus: match.workingStatus,
            testStatus: match.testStatus,
            defects: match.defects || [],
            maintenanceRequired: Boolean(match.maintenanceRequired),
            comment: generated.commentary,
            aiConfidence: match.aiConfidence ?? item.aiConfidence,
            photoReferences: generated.photoReferences,
            reviewStatus: match.reviewStatus || 'ai_generated',
          };
        }));

        return { overallComment: result.overallComment || area.overallComment, updatedItems };
      } catch (err: unknown) {
        setAnalysisError(err instanceof Error ? err.message : 'Area analysis failed.');
        return null;
      } finally {
        setIsBulkGenerating(false);
      }
    },
    [aiConfigured, agencyId, activeInspectionType],
  );

  const generateComponentCommentary = useCallback(
    async (
      area: Pick<Room, 'name' | 'canonicalAreaDefinitionId' | 'canonicalAreaDefinitionVersion'>,
      item: InspectionItem,
      photos: Photo[],
      previousReportNotes?: string,
    ): Promise<string | null> => {
      if (!aiConfigured) {
        setAnalysisError('AI is not configured. Existing commentary has been preserved.');
        return null;
      }

      setLoadingItems((prev) => ({ ...prev, [item.id]: 'AI is analysing component evidence...' }));
      setAnalysisError(null);
      try {
        const result = await generateItemComment(item.name, area.name, photos, item.comment || '', undefined, previousReportNotes);
        const generated = await commentaryFromStructuredAnalysis({
          area,
          item,
          analysis: result,
          photos,
          inspectionType: activeInspectionType,
        });
        return generated.commentary;
      } catch (err) {
        setAnalysisError(err instanceof Error ? err.message : 'Component analysis failed.');
        return null;
      } finally {
        setLoadingItems((prev) => {
          const copy = { ...prev };
          delete copy[item.id];
          return copy;
        });
      }
    },
    [aiConfigured, activeInspectionType],
  );

  const generateAreaOverallCommentary = useCallback(
    async (areaName: string, _items: InspectionItem[], photos: Photo[]): Promise<string | null> => {
      if (!aiConfigured) {
        setAnalysisError('AI is not configured. Existing area commentary has been preserved.');
        return null;
      }
      setGeneratingOverall('AI is generating overall area summary...');
      setAnalysisError(null);
      try {
        return await generateOverallComment(areaName, photos, '');
      } catch (err) {
        setAnalysisError(err instanceof Error ? err.message : 'Area commentary generation failed.');
        return null;
      } finally {
        setGeneratingOverall(null);
      }
    },
    [aiConfigured],
  );

  const discoverNewComponents = useCallback(
    async (areaName: string, photos: Photo[]): Promise<InspectionItem[]> => {
      if (!aiConfigured) return [];
      setIsDiscovering(true);
      setAnalysisError(null);
      try {
        const discovered = await discoverRoomItems(areaName, photos);
        return discovered.map((analysis, index) => ({
          id: analysis.id || analysis.name || `discovered-${Date.now()}-${index}`,
          name: analysis.name || analysis.id || 'Discovered Component',
          conditionCategory: analysis.conditionCategory || 'unable_to_confirm',
          cleanlinessCategory: analysis.cleanlinessCategory || 'unable_to_confirm',
          workingStatus: analysis.workingStatus || 'not_applicable',
          testStatus: analysis.testStatus || 'not_applicable',
          defects: analysis.defects || [],
          maintenanceRequired: Boolean(analysis.maintenanceRequired),
          comment: '',
          aiConfidence: analysis.aiConfidence,
          photoReferences: photoReferencesFor(analysis.evidencePhotoIds, photos),
          reviewStatus: analysis.reviewStatus || 'ai_generated',
          comparisonStatus: 'not_compared',
        }));
      } catch (err) {
        setAnalysisError(err instanceof Error ? err.message : 'Component discovery failed.');
        return [];
      } finally {
        setIsDiscovering(false);
      }
    },
    [aiConfigured],
  );

  const isAnalyzing = isBulkGenerating || isDiscovering || !!generatingOverall || Object.keys(loadingItems).length > 0;

  return {
    loadingItems,
    generatingOverall,
    isBulkGenerating,
    isDiscovering,
    isAnalyzing,
    analysisError,
    analyseArea,
    generateComponentCommentary,
    generateAreaOverallCommentary,
    discoverNewComponents,
    clearAnalysisError: () => setAnalysisError(null),
  };
}
