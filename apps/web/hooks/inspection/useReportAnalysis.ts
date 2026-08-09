import { useState, useCallback } from 'react';
import { ReportData, Room } from '../../types';
import { generateBatchRoomAnalysis } from '../../services/geminiService';
import { isAiConfigured } from '../../services/configService';

export interface ReportAnalysisState {
  isAnalyzing: boolean;
  statusMessage: string;
  progressPercent: number;
  currentAreaName?: string;
  completedAreasCount: number;
  totalAreasCount: number;
  error?: string;
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
          error: 'AI is not configured. Please check server settings.',
        }));
        return false;
      }

      const areas = report.rooms || [];
      if (areas.length === 0) return false;

      setAnalysisState({
        isAnalyzing: true,
        statusMessage: 'Starting global report analysis...',
        progressPercent: 0,
        completedAreasCount: 0,
        totalAreasCount: areas.length,
      });

      let updatedRooms: Room[] = [...areas];

      for (let i = 0; i < areas.length; i++) {
        const area = areas[i];
        const progress = Math.round(((i + 1) / areas.length) * 100);

        setAnalysisState({
          isAnalyzing: true,
          statusMessage: `Analyzing area ${i + 1} of ${areas.length}: ${area.name}...`,
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

          updatedRooms = updatedRooms.map((r) =>
            r.id === area.id
              ? {
                  ...r,
                  overallComment: result.overallComment || r.overallComment,
                  items: updatedItems,
                  status: 'analyzed' as const,
                }
              : r
          );

          onReportUpdated({
            ...report,
            rooms: updatedRooms,
          });
        } catch (err) {
          console.error(`Failed AI analysis for area "${area.name}":`, err);
        }
      }

      setAnalysisState({
        isAnalyzing: false,
        statusMessage: 'Report AI analysis completed.',
        progressPercent: 100,
        completedAreasCount: areas.length,
        totalAreasCount: areas.length,
      });

      return true;
    },
    [agencyId]
  );

  return {
    analysisState,
    analyseFullReport,
  };
}
