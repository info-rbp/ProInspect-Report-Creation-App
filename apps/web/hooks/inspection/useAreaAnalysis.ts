import { useState, useCallback } from 'react';
import { InspectionItem, Photo, Room } from '../../types';
import {
  generateBatchRoomAnalysis,
  generateItemComment,
  generateOverallComment,
  discoverRoomItems,
} from '../../services/geminiService';
import { isAiConfigured } from '../../services/configService';

export interface UseAreaAnalysisOptions {
  agencyId?: string;
}

export function useAreaAnalysis({ agencyId }: UseAreaAnalysisOptions = {}) {
  const [loadingItems, setLoadingItems] = useState<Record<string, string>>({});
  const [generatingOverall, setGeneratingOverall] = useState<string | null>(null);
  const [isBulkGenerating, setIsBulkGenerating] = useState(false);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const aiConfigured = isAiConfigured();

  const analyseArea = useCallback(
    async (area: Room, previousReportNotes?: string): Promise<{ overallComment?: string; updatedItems?: InspectionItem[] } | null> => {
      if (!aiConfigured) {
        setAnalysisError('AI is not configured. Please check server runtime settings.');
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
          previousReportNotes
        );

        const updatedItems = area.items.map((item) => {
          const match = result.items.find(
            (resItem) =>
              resItem.id === item.id ||
              (resItem.name && resItem.name.toLowerCase() === item.name.toLowerCase())
          );

          if (!match) return item;

          return {
            ...item,
            conditionCategory: match.conditionCategory || item.conditionCategory,
            cleanlinessCategory: match.cleanlinessCategory || item.cleanlinessCategory,
            workingStatus: match.workingStatus || item.workingStatus,
            testStatus: match.testStatus || item.testStatus,
            defects: match.defects || item.defects,
            maintenanceRequired: match.maintenanceRequired ?? item.maintenanceRequired,
            comment: match.commentary || item.comment,
            aiConfidence: match.aiConfidence ?? item.aiConfidence,
            photoReferences: match.photoReferences || item.photoReferences,
          };
        });

        return {
          overallComment: result.overallComment || area.overallComment,
          updatedItems,
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Area analysis failed.';
        setAnalysisError(msg);
        return null;
      } finally {
        setIsBulkGenerating(false);
      }
    },
    [aiConfigured, agencyId]
  );

  const generateComponentCommentary = useCallback(
    async (areaName: string, item: InspectionItem, photos: Photo[], previousReportNotes?: string): Promise<string | null> => {
      if (!aiConfigured) return null;

      setLoadingItems((prev) => ({ ...prev, [item.id]: 'AI is generating commentary...' }));
      try {
        const result = await generateItemComment(
          item.name,
          areaName,
          photos,
          item.comment || '',
          undefined,
          previousReportNotes
        );
        return result.commentary;
      } catch (err) {
        console.error('Failed to generate component comment:', err);
        return null;
      } finally {
        setLoadingItems((prev) => {
          const copy = { ...prev };
          delete copy[item.id];
          return copy;
        });
      }
    },
    [aiConfigured]
  );

  const generateAreaOverallCommentary = useCallback(
    async (areaName: string, items: InspectionItem[], photos: Photo[]): Promise<string | null> => {
      if (!aiConfigured) return null;

      setGeneratingOverall('AI is generating overall area summary...');
      try {
        const comment = await generateOverallComment(areaName, photos, '');
        return comment;
      } catch (err) {
        console.error('Failed to generate overall area comment:', err);
        return null;
      } finally {
        setGeneratingOverall(null);
      }
    },
    [aiConfigured]
  );

  const discoverNewComponents = useCallback(
    async (areaName: string, photos: Photo[]): Promise<InspectionItem[]> => {
      if (!aiConfigured) return [];

      setIsDiscovering(true);
      try {
        const discovered = await discoverRoomItems(areaName, photos);
        return discovered.map((sc, index) => ({
          id: sc.id || sc.name || `discovered-${Date.now()}-${index}`,
          name: sc.name || sc.id || 'Discovered Component',
          conditionCategory: sc.conditionCategory || 'intact',
          cleanlinessCategory: sc.cleanlinessCategory || 'clean',
          workingStatus: sc.workingStatus || 'not_applicable',
          testStatus: sc.testStatus || 'not_applicable',
          defects: sc.defects || [],
          maintenanceRequired: Boolean(sc.maintenanceRequired),
          comment: sc.commentary || '',
          aiConfidence: sc.aiConfidence ?? 0.85,
          photoReferences: sc.photoReferences || [],
        }));
      } catch (err) {
        console.error('Failed to discover components:', err);
        return [];
      } finally {
        setIsDiscovering(false);
      }
    },
    [aiConfigured]
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
