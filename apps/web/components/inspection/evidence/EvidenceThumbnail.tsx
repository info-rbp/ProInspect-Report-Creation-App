import React, { useState, useEffect } from 'react';
import { Photo } from '../../../types';
import { FileWarning, ImageOff, Loader2 } from 'lucide-react';

interface EvidenceThumbnailProps {
  photo: Photo;
  isPending?: boolean;
  showTags?: boolean;
}

export const EvidenceThumbnail: React.FC<EvidenceThumbnailProps> = ({ photo, isPending, showTags }) => {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error' | 'heic_fallback'>('loading');
  const name = photo.file ? photo.file.name.toLowerCase() : '';
  const isHeic =
    name.endsWith('.heic') ||
    name.endsWith('.heif') ||
    (photo.file && (photo.file.type === 'image/heic' || photo.file.type === 'image/heif'));

  useEffect(() => {
    if (!photo.previewUrl) {
      setStatus('error');
      return;
    }
    const img = new Image();
    img.src = photo.previewUrl;
    img.onload = () => setStatus('loaded');
    img.onerror = () => setStatus(isHeic ? 'heic_fallback' : 'error');
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [photo.previewUrl, isHeic]);

  if (status === 'heic_fallback') {
    return (
      <div
        className={`w-full h-full bg-amber-50 flex flex-col items-center justify-center text-amber-700 p-1 border border-amber-200 rounded select-none animate-pulse ${
          isPending ? 'opacity-90' : ''
        }`}
      >
        <FileWarning size={20} className="mb-1 opacity-75" />
        <span className="text-[9px] font-bold text-center leading-tight">
          HEIC
          <br />
          (No Preview)
        </span>
      </div>
    );
  }

  return (
    <div
      className={`w-full h-full relative bg-gray-50 rounded border ${
        isPending ? 'border-transparent' : 'border-gray-200 dark:border-slate-800'
      } overflow-hidden group-hover:border-blue-400 transition-colors`}
    >
      {status === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-gray-100 dark:bg-slate-800 text-blue-500">
          <Loader2 size={20} className="animate-spin mb-1" />
        </div>
      )}
      {status === 'error' ? (
        <div className="w-full h-full flex flex-col items-center justify-center text-red-500 p-1 bg-red-50 dark:bg-red-950/40">
          <ImageOff size={20} className="mb-1 opacity-75" />
          <span className="text-[9px] font-bold text-center leading-tight">
            Load
            <br />
            Error
          </span>
        </div>
      ) : (
        <>
          <img
            src={photo.previewUrl}
            className={`w-full h-full object-cover transition-opacity duration-300 ${
              status === 'loaded' ? 'opacity-100' : 'opacity-0'
            }`}
            alt="Evidence Thumbnail"
            loading="lazy"
          />
          {showTags && photo.tags && photo.tags.length > 0 && (
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent pt-4 pb-1 px-1">
              <div className="flex flex-wrap gap-1 justify-center">
                {photo.tags.slice(0, 2).map((tag, index) => (
                  <span
                    key={index}
                    className="text-[9px] bg-white/90 text-black px-1 rounded shadow-2xs leading-tight max-w-full truncate"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
