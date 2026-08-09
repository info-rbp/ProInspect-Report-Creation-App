import React from 'react';
import { InspectionItem, Photo } from '../../../types';
import { ChevronLeft, ChevronRight, Trash2, X, Tag, Link2, CheckCircle } from 'lucide-react';

interface EvidenceViewerProps {
  photo: Photo;
  allPhotos: Photo[];
  areaItems: InspectionItem[];
  onClose: () => void;
  onSelectPhoto: (photo: Photo) => void;
  onRemovePhoto?: (photoId: string) => void;
  readOnly?: boolean;
}

export const EvidenceViewer: React.FC<EvidenceViewerProps> = ({
  photo,
  allPhotos,
  areaItems,
  onClose,
  onSelectPhoto,
  onRemovePhoto,
  readOnly = false,
}) => {
  const currentIndex = allPhotos.findIndex((p) => p.id === photo.id);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < allPhotos.length - 1;

  const prevPhoto = hasPrev ? allPhotos[currentIndex - 1] : null;
  const nextPhoto = hasNext ? allPhotos[currentIndex + 1] : null;

  // Find components assigned to this photo
  const assignedComponents = areaItems.filter((item) =>
    (item.photoReferences || []).some((ref) => ref.photoId === photo.id)
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900 border border-slate-800">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
              Evidence Detail ({currentIndex + 1} of {allPhotos.length})
            </span>
            <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
              ID: {photo.id.slice(0, 8)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {!readOnly && onRemovePhoto && (
              <button
                onClick={() => {
                  onRemovePhoto(photo.id);
                  onClose();
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300"
              >
                <Trash2 size={13} />
                <span>Delete Photo</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex flex-1 flex-col md:flex-row overflow-hidden">
          {/* Image Canvas */}
          <div className="relative flex flex-1 items-center justify-center bg-slate-950 p-4 min-h-[300px]">
            <img
              src={photo.previewUrl}
              alt="Evidence Full View"
              className="max-h-[60vh] max-w-full object-contain rounded-lg"
            />

            {/* Prev / Next Nav Buttons */}
            {hasPrev && (
              <button
                onClick={() => prevPhoto && onSelectPhoto(prevPhoto)}
                className="absolute left-3 rounded-full bg-slate-900/70 p-2 text-white hover:bg-slate-900 transition-colors"
                title="Previous photo"
              >
                <ChevronLeft size={20} />
              </button>
            )}
            {hasNext && (
              <button
                onClick={() => nextPhoto && onSelectPhoto(nextPhoto)}
                className="absolute right-3 rounded-full bg-slate-900/70 p-2 text-white hover:bg-slate-900 transition-colors"
                title="Next photo"
              >
                <ChevronRight size={20} />
              </button>
            )}
          </div>

          {/* Sidebar Metadata */}
          <div className="w-full md:w-80 border-t md:border-t-0 md:border-l border-slate-100 dark:border-slate-800 p-4 space-y-4 overflow-y-auto">
            <div>
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                File Details
              </span>
              <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                {photo.file?.name || 'Evidence Photograph'}
              </p>
            </div>

            {/* Tags */}
            {photo.tags && photo.tags.length > 0 && (
              <div>
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1 mb-1.5">
                  <Tag size={12} />
                  AI Visual Tags
                </span>
                <div className="flex flex-wrap gap-1">
                  {photo.tags.map((tag, i) => (
                    <span
                      key={i}
                      className="rounded-full bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-900 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-300"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Assigned Components */}
            <div>
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1 mb-1.5">
                <Link2 size={12} />
                Linked Components ({assignedComponents.length})
              </span>
              {assignedComponents.length > 0 ? (
                <ul className="space-y-1.5">
                  {assignedComponents.map((comp) => (
                    <li
                      key={comp.id}
                      className="flex items-center gap-2 text-xs font-medium text-slate-800 dark:text-slate-200 rounded-lg bg-slate-50 dark:bg-slate-800 p-2 border border-slate-100 dark:border-slate-700"
                    >
                      <CheckCircle size={13} className="text-emerald-500 shrink-0" />
                      <span className="truncate">{comp.name}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-500 italic">
                  Unassigned evidence — not linked to specific components yet.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
