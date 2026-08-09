import React, { useState } from 'react';
import { InspectionItem, Photo } from '../../../types';
import { EvidenceThumbnail } from '../evidence/EvidenceThumbnail';
import { Plus, Check, X, AlertTriangle, Link2 } from 'lucide-react';

interface ComponentEvidencePanelProps {
  item: InspectionItem;
  areaPhotos: Photo[];
  onChange: (patch: Partial<InspectionItem>) => void;
  disabled?: boolean;
}

export const ComponentEvidencePanel: React.FC<ComponentEvidencePanelProps> = ({
  item,
  areaPhotos,
  onChange,
  disabled = false,
}) => {
  const [isLinkingModalOpen, setIsLinkingModalOpen] = useState(false);

  const linkedPhotoRefs = item.photoReferences || [];
  const linkedPhotos = areaPhotos.filter((p) =>
    linkedPhotoRefs.some((ref) => ref.photoId === p.id)
  );

  const isDamaged =
    item.conditionCategory === 'repair_required' ||
    item.conditionCategory === 'replacement_recommended' ||
    item.workingStatus === 'not_working' ||
    (item.defects && item.defects.length > 0);

  const missingEvidenceWarning = isDamaged && linkedPhotos.length === 0;

  const toggleLinkPhoto = (photoId: string) => {
    if (disabled) return;
    const exists = linkedPhotoRefs.some((ref) => ref.photoId === photoId);
    let updatedRefs;
    if (exists) {
      updatedRefs = linkedPhotoRefs.filter((ref) => ref.photoId !== photoId);
    } else {
      const matchPhoto = areaPhotos.find((p) => p.id === photoId);
      updatedRefs = [
        ...linkedPhotoRefs,
        { photoId, objectPath: matchPhoto?.objectPath || `photos/${photoId}` },
      ];
    }
    onChange({ photoReferences: updatedRefs });
  };

  return (
    <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
          <Link2 size={13} className="text-blue-500" />
          Component Evidence ({linkedPhotos.length})
        </span>

        {!disabled && areaPhotos.length > 0 && (
          <button
            type="button"
            onClick={() => setIsLinkingModalOpen(true)}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800 dark:text-blue-400"
          >
            <Plus size={12} />
            <span>Link / Assign Photo</span>
          </button>
        )}
      </div>

      {missingEvidenceWarning && (
        <div className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          <AlertTriangle size={13} className="shrink-0 text-amber-600 dark:text-amber-400" />
          <span>Defect or damage recorded without supporting evidence photo.</span>
        </div>
      )}

      {/* Linked Thumbnails Row */}
      {linkedPhotos.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {linkedPhotos.map((photo) => (
            <div key={photo.id} className="relative h-14 w-14 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
              <EvidenceThumbnail photo={photo} />
              {!disabled && (
                <button
                  type="button"
                  onClick={() => toggleLinkPhoto(photo.id)}
                  className="absolute top-0.5 right-0.5 rounded-full bg-slate-900/80 p-0.5 text-white hover:bg-rose-600"
                  title="Unlink photo"
                >
                  <X size={10} />
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-slate-500 dark:text-slate-400 italic">
          No specific photographs assigned to this component.
        </p>
      )}

      {/* Link Photo Modal */}
      {isLinkingModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                Assign Evidence Photos to &quot;{item.name}&quot;
              </h4>
              <button onClick={() => setIsLinkingModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={16} />
              </button>
            </div>

            <div className="my-4 max-h-60 overflow-y-auto grid grid-cols-4 gap-2.5 p-1">
              {areaPhotos.map((photo) => {
                const isSelected = linkedPhotoRefs.some((ref) => ref.photoId === photo.id);
                return (
                  <button
                    key={photo.id}
                    type="button"
                    onClick={() => toggleLinkPhoto(photo.id)}
                    className={`relative aspect-square rounded-xl overflow-hidden border-2 transition-all ${
                      isSelected ? 'border-blue-600 ring-2 ring-blue-500/20' : 'border-transparent opacity-80 hover:opacity-100'
                    }`}
                  >
                    <EvidenceThumbnail photo={photo} />
                    {isSelected && (
                      <div className="absolute inset-0 bg-blue-600/30 flex items-center justify-center">
                        <Check className="h-5 w-5 text-white drop-shadow-md" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setIsLinkingModalOpen(false)}
                className="rounded-xl bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
