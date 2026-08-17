import React from 'react';
import type { InspectionItem, Photo, PreviousReportAttachment, Room } from '../../types';
import { AreaHeader } from './AreaHeader';
import { PhotoUploadManager } from './evidence/PhotoUploadManager';
import { EvidenceGallery } from './evidence/EvidenceGallery';
import { ComponentAssessmentList } from './components/ComponentAssessmentList';
import { AreaCommentaryPanel } from './AreaCommentaryPanel';
import { AreaCompletenessPanel } from './AreaCompletenessPanel';
import { AreaActionBar } from './AreaActionBar';
import { useAreaAnalysis } from '../../hooks/inspection/useAreaAnalysis';

interface AreaWorkspaceProps {
  area: Room;
  onUpdateArea: (updatedArea: Room) => void;
  onDeleteArea?: () => void;
  previousReport?: PreviousReportAttachment;
  previousReportNotes?: string;
  agencyId?: string;
  inspectionType?: string;
  readOnly?: boolean;
}

function isRoutineType(inspectionType?: string): boolean {
  const value = inspectionType?.trim().toLowerCase() ?? '';
  return value === 'routine' || value === 'routine inspection';
}

function isException(item: InspectionItem): boolean {
  return Boolean(
    item.maintenanceRequired ||
    item.defects?.length ||
    item.conditionCategory === 'repair_required' ||
    item.conditionCategory === 'replacement_recommended' ||
    item.cleanlinessCategory === 'requires_cleaning' ||
    item.cleanlinessCategory === 'stained' ||
    item.workingStatus === 'not_working' ||
    item.testStatus === 'tested_failed'
  );
}

export const AreaWorkspace: React.FC<AreaWorkspaceProps> = ({
  area,
  onUpdateArea,
  onDeleteArea,
  previousReportNotes,
  agencyId,
  inspectionType,
  readOnly = false,
}) => {
  const {
    loadingItems,
    generatingOverall,
    isBulkGenerating,
    analyseArea,
    generateComponentCommentary,
    generateAreaOverallCommentary,
    clearAnalysisError,
    analysisError,
  } = useAreaAnalysis({ agencyId, inspectionType });

  const handlePhotosAdded = (newPhotos: Photo[]) => {
    onUpdateArea({ ...area, photos: [...area.photos, ...newPhotos], status: 'photos_uploaded' });
  };

  const handleRemovePhoto = (photoId: string) => {
    const remainingPhotos = area.photos.filter((photo) => photo.id !== photoId);
    const updatedItems = area.items.map((item) => ({
      ...item,
      photoReferences: (item.photoReferences || []).filter((reference) => reference.photoId !== photoId),
    }));
    onUpdateArea({ ...area, photos: remainingPhotos, items: updatedItems });
  };

  const handleUpdateComponent = (componentId: string, patch: Partial<InspectionItem>) => {
    onUpdateArea({
      ...area,
      items: area.items.map((item) => (item.id === componentId ? { ...item, ...patch } : item)),
    });
  };

  const handleAddComponent = (newItem: InspectionItem) => {
    onUpdateArea({ ...area, items: [...area.items, newItem] });
  };

  const handleRemoveComponent = (componentId: string) => {
    onUpdateArea({ ...area, items: area.items.filter((item) => item.id !== componentId) });
  };

  const handleRunAreaAnalysis = async () => {
    const result = await analyseArea(area, previousReportNotes);
    if (result) {
      onUpdateArea({
        ...area,
        overallComment: result.overallComment || area.overallComment,
        items: result.updatedItems || area.items,
        status: 'analyzed',
      });
    }
  };

  const handleRegenerateComponentComment = async (item: InspectionItem) => {
    const comment = await generateComponentCommentary(area.name, item, area.photos, previousReportNotes);
    if (comment) handleUpdateComponent(item.id, { comment });
  };

  const handleGenerateAreaSummary = async () => {
    const comment = await generateAreaOverallCommentary(area.name, area.items, area.photos);
    if (comment) onUpdateArea({ ...area, overallComment: comment });
  };

  const handleMarkRoutineOrdinary = () => {
    if (!isRoutineType(inspectionType) || area.photos.length === 0) return;
    onUpdateArea({
      ...area,
      items: area.items.map((item) => {
        if (isException(item)) return item;
        return {
          ...item,
          conditionCategory: item.conditionCategory === 'unable_to_confirm' ? 'intact' : item.conditionCategory,
          cleanlinessCategory: item.cleanlinessCategory === 'unable_to_confirm' ? 'clean' : item.cleanlinessCategory,
          // Deliberately preserve workingStatus and testStatus. An overview photograph is not an operational test.
        };
      }),
    });
  };

  const handleFocusBlocker = (componentId: string) => {
    const element = document.getElementById(`component-${componentId}`);
    if (element) element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <div className="space-y-6">
      <AreaHeader area={area} onDeleteArea={onDeleteArea} disabled={readOnly} />

      {analysisError ? (
        <div className="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          <span>{analysisError}</span>
          <button onClick={clearAnalysisError} className="font-bold underline">Dismiss</button>
        </div>
      ) : null}

      {!readOnly ? (
        <AreaActionBar
          onAnalyseArea={handleRunAreaAnalysis}
          onGenerateSummary={handleGenerateAreaSummary}
          onMarkRoutineOrdinary={isRoutineType(inspectionType) ? handleMarkRoutineOrdinary : undefined}
          routineQuickActionDisabled={area.photos.length === 0}
          isAnalyzing={isBulkGenerating}
          disabled={readOnly}
        />
      ) : null}

      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
        <PhotoUploadManager existingPhotos={area.photos} onPhotosAdded={handlePhotosAdded} disabled={readOnly} />
        <EvidenceGallery photos={area.photos} areaItems={area.items} onRemovePhoto={handleRemovePhoto} readOnly={readOnly} />
      </div>

      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">Structured Component Assessments ({area.items.length})</h3>
        <ComponentAssessmentList
          areaName={area.name}
          items={area.items}
          areaPhotos={area.photos}
          onUpdateComponent={handleUpdateComponent}
          onAddComponent={handleAddComponent}
          onRemoveComponent={handleRemoveComponent}
          onRegenerateComment={handleRegenerateComponentComment}
          loadingItems={loadingItems}
          disabled={readOnly}
        />
      </div>

      <AreaCommentaryPanel
        areaName={area.name}
        overallComment={area.overallComment}
        items={area.items}
        photos={area.photos}
        onChange={(value) => onUpdateArea({ ...area, overallComment: value })}
        onGenerateOverall={handleGenerateAreaSummary}
        isGenerating={Boolean(generatingOverall)}
        disabled={readOnly}
      />

      <AreaCompletenessPanel area={area} onFocusBlocker={handleFocusBlocker} />
    </div>
  );
};
