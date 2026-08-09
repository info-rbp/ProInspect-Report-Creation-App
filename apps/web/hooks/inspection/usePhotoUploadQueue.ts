import { useState, useEffect, useRef, useCallback } from 'react';
import { Photo } from '../../types';
import { generateId, processImageFile } from '../../utils';
import { validateImageFiles } from '../../services/validationService';

export interface QueueItem {
  id: string;
  file: File;
  status: 'pending' | 'processing';
}

export interface UsePhotoUploadQueueOptions {
  existingPhotos: Photo[];
  onPhotosAdded: (newPhotos: Photo[]) => void;
}

export function usePhotoUploadQueue({ existingPhotos, onPhotosAdded }: UsePhotoUploadQueueOptions) {
  const [processingQueue, setProcessingQueue] = useState<QueueItem[]>([]);
  const [pendingPhotos, setPendingPhotos] = useState<Photo[]>([]);
  const [totalBatchCount, setTotalBatchCount] = useState<number>(0);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const processingRef = useRef(false);
  const pendingPhotosRef = useRef<Photo[]>(pendingPhotos);

  useEffect(() => {
    pendingPhotosRef.current = pendingPhotos;
  }, [pendingPhotos]);

  // Revoke preview URLs on unmount
  useEffect(() => {
    return () => {
      pendingPhotosRef.current.forEach((photo) => {
        if (photo.previewUrl && photo.previewUrl.startsWith('blob:')) {
          URL.revokeObjectURL(photo.previewUrl);
        }
      });
    };
  }, []);

  // Process queue concurrently in small batches
  useEffect(() => {
    const processQueueBatch = async () => {
      if (processingQueue.length === 0 || processingRef.current) return;
      processingRef.current = true;

      try {
        const batch = processingQueue.filter((item) => item.status === 'pending').slice(0, 3);
        if (batch.length === 0) return;

        setProcessingQueue((prev) =>
          prev.map((item) => (batch.some((b) => b.id === item.id) ? { ...item, status: 'processing' } : item))
        );

        const results = await Promise.all(
          batch.map(async (item) => {
            try {
              const processedFile = await processImageFile(item.file);
              return {
                id: generateId(),
                file: processedFile,
                previewUrl: URL.createObjectURL(processedFile),
                originalItemId: item.id,
              };
            } catch {
              return {
                id: generateId(),
                file: item.file,
                previewUrl: URL.createObjectURL(item.file),
                originalItemId: item.id,
              };
            }
          })
        );

        const newPhotoObjects: Photo[] = results.map((res) => ({
          id: res.id,
          file: res.file,
          previewUrl: res.previewUrl,
        }));

        setPendingPhotos((prev) => [...prev, ...newPhotoObjects]);
        onPhotosAdded(newPhotoObjects);

        const processedIds = new Set(results.map((res) => res.originalItemId));
        setProcessingQueue((prev) => prev.filter((item) => !processedIds.has(item.id)));
      } finally {
        processingRef.current = false;
      }
    };

    processQueueBatch();
  }, [processingQueue, onPhotosAdded]);

  const enqueueFiles = useCallback(
    (files: FileList | File[]) => {
      setValidationErrors([]);
      const fileArray = Array.from(files);
      if (fileArray.length === 0) return;

      const currentTotal = existingPhotos.length + pendingPhotos.length + processingQueue.length;
      const { validFiles, errors } = validateImageFiles(fileArray, currentTotal);

      if (errors.length > 0) {
        setValidationErrors(errors);
      }

      if (validFiles.length === 0) return;

      const itemsToEnqueue: QueueItem[] = validFiles.map((file) => ({
        id: generateId(),
        file,
        status: 'pending',
      }));

      setTotalBatchCount((prev) => (processingQueue.length === 0 ? validFiles.length : prev + validFiles.length));
      setProcessingQueue((prev) => [...prev, ...itemsToEnqueue]);
    },
    [existingPhotos.length, pendingPhotos.length, processingQueue.length]
  );

  const clearQueue = useCallback(() => {
    setProcessingQueue([]);
    setPendingPhotos([]);
    setTotalBatchCount(0);
    setValidationErrors([]);
  }, []);

  const clearErrors = useCallback(() => {
    setValidationErrors([]);
  }, []);

  const isProcessing = processingQueue.length > 0;
  const activeBatchTotal = Math.max(totalBatchCount, pendingPhotos.length + processingQueue.length);
  const completedBatchCount = pendingPhotos.length;
  const uploadProgressPercent =
    activeBatchTotal > 0 ? Math.min(100, Math.round((completedBatchCount / activeBatchTotal) * 100)) : 0;

  return {
    processingQueue,
    pendingPhotos,
    isProcessing,
    uploadProgressPercent,
    completedBatchCount,
    activeBatchTotal,
    validationErrors,
    enqueueFiles,
    clearQueue,
    clearErrors,
  };
}
