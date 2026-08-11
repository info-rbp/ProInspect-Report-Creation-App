import React from 'react';
import { InspectionItem, Photo, PreviousReportAttachment, Room } from '../../types';
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
    const remainingPhotos = area.photos.filter((p) => p.id !== photoId);
    const updatedItems = area.items.map((item) => ({
      ...item,
      photoReferences: (item.photoReferences || []).filter((ref) => ref.photoId !== photoId),
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

  const handleFocusBlocker = (componentId: string) => {
    const el = document.getElementById(`component-${componentId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <div className="space-y-6">
      <AreaHeader area={area} onDeleteArea={onDeleteArea} disabled={readOnly} />

      {analysisError && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200 flex items-center justify-between">
          <span>{analysisError}</span>
          <button onClick={clearAnalysisError} className="font-bold underline">Dismiss</button>
        </div>
      )}

      {!readOnly && (
        <AreaActionBar
          onAnalyseArea={handleRunAreaAnalysis}
          onGenerateSummary={handleGenerateAreaSummary}
          isAnalyzing={isBulkGenerating}
          disabled={readOnly}
        />
      )}

      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
        <PhotoUploadManager existingPhotos={area.photos} onPhotosAdded={handlePhotosAdded} disabled={readOnly} />
        <EvidenceGallery photos={area.photos} areaItems={area.items} onRemovePhoto={handleRemovePhoto} readOnly={readOnly} />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-900 space-y-3">
        <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
          Structured Component Assessments ({area.items.length})
        </h3>
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
        onChange={(val) => onUpdateArea({ ...area, overallComment: val })}
        onGenerateOverall={handleGenerateAreaSummary}
        isGenerating={!!generatingOverall}
        disabled={readOnly}
      />

      <AreaCompletenessPanel area={area} onFocusBlocker={handleFocusBlocker} />
    </div>
  );
};
