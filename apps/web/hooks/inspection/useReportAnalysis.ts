import { useState, useCallback } from 'react';
import type { InspectionType } from '@pcr/domain';
import { generateCommentary, type StructuredInspectionFact, type ConditionState, type WorkingState } from '@pcr/templates';
import { ReportData, Room } from '../../types';
import { generateBatchRoomAnalysis, type StructuredComponentAnalysis } from '../../services/geminiService';
import { isAiConfigured } from '../../services/configService';
import { getActiveTemplateForType } from '../../services/templateStorage';

export interface ReportAnalysisState {
  isAnalyzing: boolean;
  statusMessage: string;
  progressPercent: number;
  currentAreaName?: string;
  completedAreasCount: number;
  totalAreasCount: number;
  error?: string;
}

function inspectionTypeFor(reportType: string): InspectionType {
  const value = reportType.toLowerCase();
  if (value.includes('routine')) return 'routine';
  if (value.includes('exit')) return 'exit';
  if (value.includes('comparison')) return 'comparison';
  if (value.includes('maintenance') || value.includes('follow-up') || value.includes('follow up')) return 'maintenance';
  return 'entry';
}

function conditionFor(value: StructuredComponentAnalysis['conditionCategory']): ConditionState {
  if (value === 'intact') return 'clean_intact';
  if (value === 'minor_wear') return 'minor_wear';
  if (value === 'repair_required') return 'repair_required';
  if (value === 'replacement_recommended') return 'damaged';
  return 'unable_to_confirm';
}

function workingFor(value: StructuredComponentAnalysis['testStatus']): WorkingState {
  if (value === 'tested_passed') return 'tested_working';
  if (value === 'tested_failed') return 'tested_not_working';
  if (value === 'not_applicable') return 'not_relevant';
  return 'not_tested';
}

export function useReportAnalysis(agencyId?: string) {
  const [analysisState, setAnalysisState] = useState<ReportAnalysisState>({
    isAnalyzing: false,
    statusMessage: '',
    progressPercent: 0,
    completedAreasCount: 0,
    totalAreasCount: 0,
  });

  const analyseFullReport = useCallback(
    async (
      report: ReportData,
      onReportUpdated: (updatedReport: ReportData) => void
    ): Promise<boolean> => {
      if (!isAiConfigured()) {
        setAnalysisState((prev) => ({
          ...prev,
          error: 'AI is not configured. Existing inspection assessments have been preserved.',
        }));
        return false;
      }

      const areas = report.rooms || [];
      if (areas.length === 0) return false;

      const inspectionType = inspectionTypeFor(report.reportType);
      const template = await getActiveTemplateForType(inspectionType);

      setAnalysisState({
        isAnalyzing: true,
        statusMessage: 'Starting global report analysis...',
        progressPercent: 0,
        completedAreasCount: 0,
        totalAreasCount: areas.length,
      });

      let updatedRooms: Room[] = [...areas];
      let failedAreas = 0;

      for (let i = 0; i < areas.length; i++) {
        const area = areas[i];
        const progress = Math.round(((i + 1) / areas.length) * 100);

        setAnalysisState({
          isAnalyzing: true,
          statusMessage: `Analysing area ${i + 1} of ${areas.length}: ${area.name}...`,
          progressPercent: progress,
          currentAreaName: area.name,
          completedAreasCount: i,
          totalAreasCount: areas.length,
        });

        try {
          const result = await generateBatchRoomAnalysis(
            area.name,
            area.photos || [],
            area.items || [],
            area.overallComment || '',
            undefined,
            report.previousReportNotes
          );

          const updatedItems = area.items.map((item) => {
            const match = result.items.find(
              (resItem) =>
                resItem.id === item.id ||
                (resItem.name && resItem.name.toLowerCase() === item.name.toLowerCase())
            );
            if (!match) return item;

            const permittedPhotoIds = new Set(match.evidencePhotoIds || []);
            const photoReferences = area.photos
              .filter((photo) => permittedPhotoIds.has(photo.id))
              .map((photo) => ({
                photoId: photo.id,
                objectPath: photo.objectPath || photo.downloadUrl || `photos/${photo.id}`,
                ...(photo.thumbnailObjectPath ? { thumbnailObjectPath: photo.thumbnailObjectPath } : {}),
              }));

            const fact: StructuredInspectionFact = {
              area: area.name,
              component: item.name,
              ...(item.subComponent ? { subComponent: item.subComponent } : {}),
              ...(item.material ? { material: item.material } : {}),
              ...(item.colour ? { colour: item.colour } : {}),
              ...(item.type ? { type: item.type } : {}),
              ...(item.quantity ? { quantity: item.quantity } : {}),
              visibility: photoReferences.length > 0 ? 'visible' : 'not_visible',
              condition: conditionFor(match.conditionCategory),
              cleanliness: match.cleanlinessCategory,
              ...(match.cleanlinessCategory === 'requires_cleaning' || match.cleanlinessCategory === 'heavy_soiling'
                ? { cleanlinessIssue: match.cleanlinessCategory.replaceAll('_', ' ') }
                : {}),
              ...(match.defects?.length ? { conditionIssue: match.defects.join('; ') } : {}),
              workingState: workingFor(match.testStatus),
              photoReferences: photoReferences.map((reference) => reference.photoId),
              inspectionType,
            };

            const commentary = generateCommentary(template, fact).commentary;

            return {
              ...item,
              conditionCategory: match.conditionCategory,
              cleanlinessCategory: match.cleanlinessCategory,
              workingStatus: match.workingStatus,
              testStatus: match.testStatus,
              defects: match.defects || [],
              maintenanceRequired: Boolean(match.maintenanceRequired),
              comment: commentary,
              aiConfidence: match.aiConfidence ?? item.aiConfidence,
              photoReferences,
              reviewStatus: match.reviewStatus || 'ai_generated',
            };
          });

          updatedRooms = updatedRooms.map((candidate) =>
            candidate.id === area.id
              ? {
                  ...candidate,
                  overallComment: result.overallComment || candidate.overallComment,
                  items: updatedItems,
                  status: 'analyzed' as const,
                }
              : candidate
          );

          onReportUpdated({ ...report, rooms: updatedRooms });
        } catch (err) {
          failedAreas += 1;
          console.error(`Failed AI analysis for area "${area.name}":`, err);
        }
      }

      setAnalysisState({
        isAnalyzing: false,
        statusMessage: failedAreas > 0
          ? `Report analysis completed with ${failedAreas} area(s) requiring retry.`
          : 'Report AI analysis completed.',
        progressPercent: 100,
        completedAreasCount: areas.length - failedAreas,
        totalAreasCount: areas.length,
        ...(failedAreas > 0 ? { error: `${failedAreas} area(s) were not changed because analysis failed.` } : {}),
      });

      return failedAreas === 0;
    },
    [agencyId]
  );

  return {
    analysisState,
    analyseFullReport,
  };
}
