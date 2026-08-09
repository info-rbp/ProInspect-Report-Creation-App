import React, { useRef, useState } from 'react';
import { Upload, Loader2, AlertCircle, X } from 'lucide-react';
import { usePhotoUploadQueue } from '../../../hooks/inspection/usePhotoUploadQueue';
import { Photo } from '../../../types';

interface PhotoUploadManagerProps {
  existingPhotos: Photo[];
  onPhotosAdded: (newPhotos: Photo[]) => void;
  disabled?: boolean;
}

export const PhotoUploadManager: React.FC<PhotoUploadManagerProps> = ({
  existingPhotos,
  onPhotosAdded,
  disabled = false,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const {
    isProcessing,
    uploadProgressPercent,
    completedBatchCount,
    activeBatchTotal,
    validationErrors,
    enqueueFiles,
    clearErrors,
  } = usePhotoUploadQueue({
    existingPhotos,
    onPhotosAdded,
  });

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (disabled) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      enqueueFiles(e.dataTransfer.files);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      enqueueFiles(e.target.files);
      e.target.value = '';
    }
  };

  return (
    <div className="space-y-3">
      {/* Upload Dropzone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !disabled && fileInputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all ${
          isDragging
            ? 'border-blue-500 bg-blue-50/80 dark:bg-blue-950/30'
            : disabled
            ? 'border-slate-200 bg-slate-50 cursor-not-allowed dark:border-slate-800 dark:bg-slate-900/50'
            : 'border-slate-300 hover:border-blue-400 bg-slate-50/50 hover:bg-white dark:border-slate-700 dark:bg-slate-900/30 dark:hover:border-blue-500'
        }`}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          multiple
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          className="hidden"
          disabled={disabled}
        />

        <div className="flex flex-col items-center justify-center gap-2">
          <div className="rounded-full bg-blue-100 p-2.5 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
            {isProcessing ? <Loader2 size={20} className="animate-spin" /> : <Upload size={20} />}
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              {disabled
                ? 'Report locked — uploads disabled'
                : 'Click or drag & drop photographs for this area'}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              Supports JPG, PNG, WEBP, HEIC (Max 15MB each, up to 100 photos per area)
            </p>
          </div>
        </div>
      </div>

      {/* Validation Errors */}
      {validationErrors.length > 0 && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200 flex items-start justify-between">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
            <div className="space-y-0.5">
              <span className="font-bold block">File Upload Notice:</span>
              <ul className="list-disc list-inside space-y-0.5">
                {validationErrors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          </div>
          <button onClick={clearErrors} className="text-rose-600 hover:text-rose-800 dark:text-rose-400">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Active Processing Queue Progress */}
      {isProcessing && (
        <div className="rounded-xl border border-blue-200 bg-blue-50/80 p-3 text-xs dark:border-blue-900/60 dark:bg-blue-950/40">
          <div className="flex items-center justify-between font-semibold text-blue-900 dark:text-blue-300 mb-1.5">
            <span className="flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />
              Preprocessing photographs ({completedBatchCount} / {activeBatchTotal})
            </span>
            <span className="font-mono">{uploadProgressPercent}%</span>
          </div>
          <div className="h-1.5 w-full bg-blue-200 rounded-full overflow-hidden dark:bg-blue-900">
            <div
              className="h-full bg-blue-600 transition-all duration-300"
              style={{ width: `${uploadProgressPercent}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
