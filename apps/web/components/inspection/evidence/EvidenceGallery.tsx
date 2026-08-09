import React, { useState } from 'react';
import { InspectionItem, Photo } from '../../../types';
import { EvidenceThumbnail } from './EvidenceThumbnail';
import { EvidenceViewer } from './EvidenceViewer';
import { Image as ImageIcon, Trash2, Maximize2, Link2 } from 'lucide-react';

interface EvidenceGalleryProps {
  photos: Photo[];
  areaItems: InspectionItem[];
  onRemovePhoto?: (photoId: string) => void;
  readOnly?: boolean;
}

export const EvidenceGallery: React.FC<EvidenceGalleryProps> = ({
  photos,
  areaItems,
  onRemovePhoto,
  readOnly = false,
}) => {
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);

  if (photos.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-6 text-center text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/30 dark:text-slate-400">
        <ImageIcon className="mx-auto h-8 w-8 text-slate-400 mb-2 opacity-60" />
        <p className="font-semibold text-slate-700 dark:text-slate-300">No area evidence uploaded</p>
        <p className="mt-0.5 text-[11px]">Upload photographs above to attach evidence to this area.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
          <ImageIcon size={14} className="text-blue-600" />
          Area Photographs & Evidence ({photos.length})
        </span>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {photos.map((photo) => {
          // Check if photo is linked to any component
          const isLinked = areaItems.some((item) =>
            (item.photoReferences || []).some((ref) => ref.photoId === photo.id)
          );

          return (
            <div key={photo.id} className="relative group aspect-square">
              <button
                type="button"
                onClick={() => setSelectedPhoto(photo)}
                className="w-full h-full text-left rounded-xl overflow-hidden focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <EvidenceThumbnail photo={photo} showTags />
              </button>

              {/* Linked Badge */}
              <div className="absolute top-1.5 left-1.5 pointer-events-none">
                {isLinked ? (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-600/90 px-1.5 py-0.5 text-[9px] font-bold text-white shadow-2xs">
                    <Link2 size={9} />
                    Linked
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-slate-900/75 px-1.5 py-0.5 text-[9px] font-bold text-white shadow-2xs">
                    Unassigned
                  </span>
                )}
              </div>

              {/* Overlay Actions on Hover */}
              <div className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-xl flex items-center justify-center gap-2 pointer-events-none">
                <button
                  type="button"
                  onClick={() => setSelectedPhoto(photo)}
                  className="pointer-events-auto rounded-lg bg-white/90 p-1.5 text-slate-800 hover:bg-white shadow-sm"
                  title="View enlarged"
                >
                  <Maximize2 size={14} />
                </button>
                {!readOnly && onRemovePhoto && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemovePhoto(photo.id);
                    }}
                    className="pointer-events-auto rounded-lg bg-rose-600/90 p-1.5 text-white hover:bg-rose-600 shadow-sm"
                    title="Remove photograph"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Expanded Modal */}
      {selectedPhoto && (
        <EvidenceViewer
          photo={selectedPhoto}
          allPhotos={photos}
          areaItems={areaItems}
          onClose={() => setSelectedPhoto(null)}
          onSelectPhoto={(p) => setSelectedPhoto(p)}
          onRemovePhoto={onRemovePhoto}
          readOnly={readOnly}
        />
      )}
    </div>
  );
};
