import React, { useRef, useState, useEffect } from 'react';
import { Room, InspectionItem, Photo, PreviousReportAttachment } from '../types';
import { Trash2, Plus, Sparkles, Loader2, Image as ImageIcon, Check, X, ImageOff, FileWarning, RefreshCw, Wand2, ChevronDown, ChevronUp, Clock, ScanEye, FileText, Upload, CheckCircle2, ShieldCheck } from 'lucide-react';
import { generateId, processImageFile } from '../utils';
import { generateItemComment, generateOverallComment, generateImageTags, generateBatchRoomAnalysis, discoverRoomItems } from '../services/geminiService';
import { isAiConfigured } from '../services/configService';
import { validateImageFiles } from '../services/validationService';

interface RoomFormProps {
  room: Room;
  onUpdate: (updatedRoom: Room) => void;
  onDelete: () => void;
  previousReport?: PreviousReportAttachment;
  previousReportNotes?: string;
}

interface QueueItem {
  id: string;
  file: File;
  status: 'pending' | 'processing';
}

const AIGeneratingOverlay = ({ mode, message }: { mode: 'create' | 'refine'; message?: string }) => (
  <div className="absolute inset-0 bg-white/90 backdrop-blur-[1px] flex flex-col items-center justify-center z-20 rounded border border-purple-100 shadow-inner animate-in fade-in duration-300">
    <div className="flex items-center gap-2 text-purple-700 mb-2">
      {mode === 'refine' ? <RefreshCw size={16} className="text-purple-600 animate-spin" /> : <Sparkles size={16} className="text-purple-600 animate-pulse" />}
      <span className="text-xs font-bold text-purple-900 tracking-wide">
        {mode === 'refine' ? 'AI is building comment...' : 'AI is generating...'}
      </span>
    </div>
    {message && <div className="text-[10px] text-purple-600 font-medium mb-1">{message}</div>}
    <div className="w-1/3 h-1 bg-gray-200 rounded-full overflow-hidden">
      <div className="h-full bg-gradient-to-r from-purple-400 to-purple-600 w-full animate-pulse origin-left"></div>
    </div>
  </div>
);

const PhotoThumbnail: React.FC<{ photo: Photo; isPending?: boolean; showTags?: boolean }> = ({ photo, isPending, showTags }) => {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error' | 'heic_fallback'>('loading');
  const name = photo.file.name.toLowerCase();
  const isHeic = name.endsWith('.heic') || name.endsWith('.heif') || photo.file.type === 'image/heic' || photo.file.type === 'image/heif';

  useEffect(() => {
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
      <div className={`w-full h-full bg-amber-50 flex flex-col items-center justify-center text-amber-700 p-1 border border-amber-200 rounded select-none animate-pulse ${isPending ? 'opacity-90' : ''}`}>
        <FileWarning size={20} className="mb-1 opacity-75" />
        <span className="text-[9px] font-bold text-center leading-tight">HEIC<br />(No Preview)</span>
      </div>
    );
  }

  return (
    <div className={`w-full h-full relative bg-gray-50 rounded border ${isPending ? 'border-transparent' : 'border-gray-200'} overflow-hidden group-hover:border-blue-300 transition-colors`}>
      {status === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-gray-100 text-blue-400">
          <Loader2 size={20} className="animate-spin mb-1" />
        </div>
      )}
      {status === 'error' ? (
        <div className="w-full h-full flex flex-col items-center justify-center text-red-400 p-1 bg-red-50">
          <ImageOff size={20} className="mb-1 opacity-75" />
          <span className="text-[9px] font-bold text-center leading-tight">Load<br />Error</span>
        </div>
      ) : (
        <>
          <img src={photo.previewUrl} className={`w-full h-full object-cover transition-opacity duration-500 ${status === 'loaded' ? 'opacity-100' : 'opacity-0'}`} alt="Thumbnail" loading="lazy" />
          {showTags && photo.tags && photo.tags.length > 0 && (
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent pt-4 pb-1 px-1">
              <div className="flex flex-wrap gap-1 justify-center">
                {photo.tags.slice(0, 2).map((tag, index) => (
                  <span key={index} className="text-[9px] bg-white/90 text-black px-1 rounded shadow-sm leading-tight max-w-full truncate">{tag}</span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

const RoomForm: React.FC<RoomFormProps> = ({ room, onUpdate, onDelete, previousReport, previousReportNotes }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const processingRef = useRef(false);
  const [loadingItems, setLoadingItems] = useState<Record<string, string>>({});
  const [generatingOverall, setGeneratingOverall] = useState<string | null>(null);
  const [isBulkGenerating, setIsBulkGenerating] = useState(false);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [pendingPhotos, setPendingPhotos] = useState<Photo[]>([]);
  const [processingQueue, setProcessingQueue] = useState<QueueItem[]>([]);
  const [totalBatchCount, setTotalBatchCount] = useState<number>(0);
  const [isAutoTagging, setIsAutoTagging] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const aiConfigured = isAiConfigured();
  const isProcessing = processingQueue.length > 0;
  const isBlockingUI = isFinalizing || isProcessing || isAutoTagging || !!generatingOverall || Object.keys(loadingItems).length > 0 || isBulkGenerating || isDiscovering;
  const isExpanded = room.isExpanded !== false;
  const pendingPhotosRef = useRef<Photo[]>(pendingPhotos);

  // Active batch progress calculations
  const activeBatchTotal = Math.max(totalBatchCount, pendingPhotos.length + processingQueue.length);
  const completedBatchCount = pendingPhotos.length;
  const uploadProgressPercent = activeBatchTotal > 0 ? Math.min(100, Math.round((completedBatchCount / activeBatchTotal) * 100)) : 0;
  const isBatchUploadComplete = processingQueue.length === 0 && pendingPhotos.length > 0;

  useEffect(() => {
    pendingPhotosRef.current = pendingPhotos;
  }, [pendingPhotos]);

  useEffect(() => {
    return () => pendingPhotosRef.current.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
  }, []);

  useEffect(() => {
    const processQueueBatch = async () => {
      if (processingQueue.length === 0 || processingRef.current) return;
      processingRef.current = true;
      try {
        const batch = processingQueue.filter((item) => item.status === 'pending').slice(0, 3);
        if (batch.length === 0) return;

        setProcessingQueue((prev) => prev.map((item) => batch.find((candidate) => candidate.id === item.id) ? { ...item, status: 'processing' } : item));
        const results = await Promise.all(batch.map(async (item) => {
          try {
            const processedFile = await processImageFile(item.file);
            return { id: generateId(), file: processedFile, previewUrl: URL.createObjectURL(processedFile), originalItemId: item.id };
          } catch {
            return { id: generateId(), file: item.file, previewUrl: URL.createObjectURL(item.file), originalItemId: item.id };
          }
        }));

        setPendingPhotos((prev) => [...prev, ...results.map((result) => ({ id: result.id, file: result.file, previewUrl: result.previewUrl }))]);
        const processedIds = new Set(results.map((result) => result.originalItemId));
        setProcessingQueue((prev) => prev.filter((item) => !processedIds.has(item.id)));
      } finally {
        processingRef.current = false;
      }
    };

    processQueueBatch();
  }, [processingQueue]);

  const requireAi = (): boolean => {
    if (aiConfigured) return true;
    alert('AI features are disabled until a Gemini API key is added in Settings.');
    return false;
  };

  const addFilesToQueue = (files: File[]) => {
    const { validFiles, errors } = validateImageFiles(files, room.photos.length + pendingPhotos.length + processingQueue.length);
    if (errors.length > 0) {
      alert(errors.join('\n'));
    }
    if (validFiles.length === 0) return;
    const newQueueItems: QueueItem[] = validFiles.map((file) => ({ id: generateId(), file, status: 'pending' }));
    setProcessingQueue((prev) => [...prev, ...newQueueItems]);
    setTotalBatchCount((prev) => prev + validFiles.length);
  };

  const toggleExpand = () => onUpdate({ ...room, isExpanded: !isExpanded });
  const handleAddItem = () => onUpdate({ ...room, items: [...room.items, { id: generateId(), name: 'New Item', isClean: true, isUndamaged: true, isWorking: true, comment: '' }] });
  const updateItem = (itemId: string, updates: Partial<InspectionItem>) => onUpdate({ ...room, items: room.items.map((item) => item.id === itemId ? { ...item, ...updates } : item) });
  const deleteItem = (itemId: string) => onUpdate({ ...room, items: room.items.filter((item) => item.id !== itemId) });

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files?.length) {
      addFilesToQueue(Array.from(event.target.files));
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDragEnter = (event: React.DragEvent) => { event.preventDefault(); event.stopPropagation(); setIsDragging(true); };
  const handleDragLeave = (event: React.DragEvent) => { event.preventDefault(); event.stopPropagation(); setIsDragging(false); };
  const handleDragOver = (event: React.DragEvent) => { event.preventDefault(); event.stopPropagation(); if (!isDragging) setIsDragging(true); };
  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    if (event.dataTransfer.files?.length) addFilesToQueue(Array.from(event.dataTransfer.files));
  };

  const finalizeUpload = async () => {
    setIsFinalizing(true);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const newPhotos = [...pendingPhotos];
    onUpdate({ ...room, photos: [...room.photos, ...newPhotos], status: 'photos_uploaded' });
    setPendingPhotos([]);
    setTotalBatchCount(0);
    setIsFinalizing(false);
  };

  const cancelUpload = () => {
    pendingPhotos.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
    setPendingPhotos([]);
    setProcessingQueue([]);
    setTotalBatchCount(0);
  };

  const removePendingPhoto = (photoId: string) => {
    const photoToRemove = pendingPhotos.find((photo) => photo.id === photoId);
    if (photoToRemove) URL.revokeObjectURL(photoToRemove.previewUrl);
    setPendingPhotos((prev) => prev.filter((photo) => photo.id !== photoId));
    setTotalBatchCount((prev) => Math.max(0, prev - 1));
  };

  const removePhoto = (photoId: string) => {
    const photo = room.photos.find((entry) => entry.id === photoId);
    if (photo) URL.revokeObjectURL(photo.previewUrl);
    const remainingPhotos = room.photos.filter((entry) => entry.id !== photoId);
    onUpdate({ ...room, photos: remainingPhotos, status: remainingPhotos.length === 0 ? 'draft' : room.status });
  };

  const handleAutoTag = async () => {
    if (!requireAi() || room.photos.length === 0) return;
    setIsAutoTagging(true);
    try {
      const photosToTag = room.photos.filter((photo) => !photo.tags || photo.tags.length === 0);
      const targetPhotos = photosToTag.length > 0 ? photosToTag : room.photos;
      let updatedPhotos = [...room.photos];
      for (const photo of targetPhotos) {
        const tags = await generateImageTags(photo);
        updatedPhotos = updatedPhotos.map((candidate) => candidate.id === photo.id ? { ...candidate, tags } : candidate);
      }
      onUpdate({ ...room, photos: updatedPhotos });
    } catch (error) {
      console.error('Auto-tagging failed', error);
      alert('Auto-tagging failed. Review the AI key and try again.');
    } finally {
      setIsAutoTagging(false);
    }
  };

  const handleAutoDetectItems = async () => {
    if (!requireAi() || room.photos.length === 0) {
      if (room.photos.length === 0) alert('Upload room photos before running item detection.');
      return;
    }
    if (!window.confirm('Scan room photos for visible fixtures and update the item list automatically?')) return;

    setIsDiscovering(true);
    setGeneratingOverall('Scanning photos for visible items...');
    try {
      const discoveredItems = await discoverRoomItems(room.name, room.photos);
      if (discoveredItems.length === 0) {
        alert('No items were confidently detected. Try using clearer photos.');
        return;
      }

      let addedCount = 0;
      let updatedCount = 0;
      const currentItems = [...room.items];

      discoveredItems.forEach((newItem) => {
        const existingIndex = currentItems.findIndex((item) => item.name.toLowerCase() === newItem.id.toLowerCase());
        if (existingIndex > -1) {
          const existing = currentItems[existingIndex];
          if (!existing.comment && newItem.comment) {
            currentItems[existingIndex] = { ...existing, comment: newItem.comment, isClean: newItem.isClean, isUndamaged: newItem.isUndamaged, isWorking: newItem.isWorking };
            updatedCount += 1;
          }
        } else {
          currentItems.push({ id: generateId(), name: newItem.id, comment: newItem.comment || '', isClean: newItem.isClean, isUndamaged: newItem.isUndamaged, isWorking: newItem.isWorking });
          addedCount += 1;
        }
      });

      onUpdate({ ...room, items: currentItems });
      alert(`Scan complete. Added: ${addedCount}. Updated: ${updatedCount}.`);
    } catch (error) {
      console.error('Discovery failed', error);
      alert('Item discovery failed. Review the AI configuration and try again.');
    } finally {
      setIsDiscovering(false);
      setGeneratingOverall(null);
    }
  };

  const handleBulkGenerate = async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (room.photos.length === 0) {
      alert('Please upload photos to this room first to generate commentary.');
      return;
    }

    setLoadingItems({});
    setGeneratingOverall(null);
    setIsBulkGenerating(true);
    try {
      let currentRoomState = { ...room };
      const syncUpdate = (updates: Partial<Room>) => {
        currentRoomState = { ...currentRoomState, ...updates };
        onUpdate(currentRoomState);
      };

      for (let index = 0; index < currentRoomState.photos.length; index += 5) {
        const batchPhotos = currentRoomState.photos.slice(index, index + 5);
        setGeneratingOverall(`Analysing photo batch ${Math.ceil((index + 1) / 5)} of ${Math.ceil(currentRoomState.photos.length / 5)}...`);
        const analysisResult = await generateBatchRoomAnalysis(currentRoomState.name, batchPhotos, currentRoomState.items, currentRoomState.overallComment, previousReport?.file, previousReportNotes);
        const newOverall = analysisResult.overallComment || currentRoomState.overallComment;
        const newItems = currentRoomState.items.map((item) => {
          const update = analysisResult.items?.find((candidate) => candidate.id.toLowerCase() === item.name.toLowerCase() || candidate.id === item.id);
          return update ? { ...item, comment: update.comment, isClean: update.isClean, isUndamaged: update.isUndamaged, isWorking: update.isWorking } : item;
        });
        syncUpdate({ overallComment: newOverall, items: newItems });
      }

      syncUpdate({ status: 'analyzed' });
    } catch (error) {
      console.error('Bulk generation failed', error);
      alert('Bulk generation encountered an error. Please try again.');
    } finally {
      setIsBulkGenerating(false);
      setGeneratingOverall(null);
      setLoadingItems({});
    }
  };

  const generateAIComment = async (item: InspectionItem) => {
    if (!requireAi()) return;
    if (room.photos.length === 0) {
      alert('Please upload photos first.');
      return;
    }

    let currentText = item.comment;
    try {
      for (let index = 0; index < room.photos.length; index += 5) {
        setLoadingItems((prev) => ({ ...prev, [item.id]: `Analysing photos ${index + 1}-${Math.min(index + 5, room.photos.length)} of ${room.photos.length}...` }));
        const batchPhotos = room.photos.slice(index, index + 5);
        const result = await generateItemComment(item.name, room.name, batchPhotos, currentText, previousReport?.file, previousReportNotes);
        currentText = result.comment;
        updateItem(item.id, { comment: result.comment, isClean: result.isClean, isUndamaged: result.isUndamaged, isWorking: result.isWorking });
      }
    } catch (error) {
      console.error('Item generation failed', error);
      alert('Failed to generate the item comment.');
    } finally {
      setLoadingItems((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    }
  };

  const handleGenerateOverall = async () => {
    if (!requireAi()) return;
    if (room.photos.length === 0) {
      alert('Please upload photos first.');
      return;
    }

    let currentText = room.overallComment;
    try {
      for (let index = 0; index < room.photos.length; index += 5) {
        setGeneratingOverall(`Analysing photos ${index + 1}-${Math.min(index + 5, room.photos.length)} of ${room.photos.length}...`);
        const batchPhotos = room.photos.slice(index, index + 5);
        currentText = await generateOverallComment(room.name, batchPhotos, currentText, previousReport?.file, previousReportNotes);
        onUpdate({ ...room, overallComment: currentText });
      }
    } catch (error) {
      console.error('Overall generation failed', error);
      alert('Failed to generate the room overview.');
    } finally {
      setGeneratingOverall(null);
    }
  };

  return (
    <div className={`bg-white rounded-lg shadow-sm border border-gray-200 mb-6 overflow-hidden relative transition-all duration-300 ${!isExpanded ? 'h-auto' : ''}`}>
      <div className="bg-gray-50 p-4 border-b border-gray-200 flex justify-between items-center cursor-pointer hover:bg-gray-100 transition-colors select-none" onClick={toggleExpand}>
        <div className="flex items-center gap-3">
          <div className="text-gray-400">{isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}</div>
          <h3 className="text-lg font-semibold text-gray-800">{room.name}</h3>
          <span className="text-xs bg-white border border-gray-200 text-gray-600 px-2 py-1 rounded-full shadow-sm">{room.items.length} items</span>
          <span className="text-xs bg-white border border-gray-200 text-gray-600 px-2 py-1 rounded-full shadow-sm">{room.photos.length} photos</span>
        </div>
        <button type="button" onClick={(event) => { event.stopPropagation(); onDelete(); }} disabled={isBlockingUI} className="bg-blue-500 hover:bg-blue-600 text-white w-8 h-8 rounded-full flex items-center justify-center shadow transition-all hover:shadow-md disabled:opacity-50" title="Delete Area">
          <Trash2 size={16} className="text-white" />
        </button>
      </div>

      {isExpanded && (
        <div className="p-4 animate-in slide-in-from-top-2 duration-200">
          <div className={`mb-6 p-4 rounded-lg border-2 transition-all duration-200 relative ${isDragging ? 'border-blue-500 bg-blue-50 scale-[1.01]' : 'border-transparent'}`} onDragEnter={handleDragEnter} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
            {isDragging && (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-blue-50/90 rounded-lg pointer-events-none">
                <div className="text-center text-blue-600 animate-in zoom-in-95">
                  <Upload size={48} className="mx-auto mb-2 animate-bounce" />
                  <h3 className="text-lg font-bold">Drop Photos Here</h3>
                  <p className="text-sm opacity-75">Release to add to queue</p>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5"><ImageIcon size={16} className="text-blue-600" /> Saved Photos ({room.photos.length})</h4>
                {room.photos.length > 0 && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    {room.photos.length} Photo(s) Ready for AI Analysis
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                {(previousReport || previousReportNotes) && <span className="text-xs bg-amber-50 text-amber-700 px-2 py-1 rounded border border-amber-200 flex items-center gap-1 font-bold"><FileText size={12} /> Compare Mode Ready</span>}
                <button type="button" onClick={() => !isProcessing && fileInputRef.current?.click()} disabled={isBlockingUI} className={`text-sm flex items-center gap-1 font-medium hover:underline ${isBlockingUI ? 'text-gray-400 cursor-not-allowed' : 'text-blue-600'}`}>
                  {isProcessing ? <><Loader2 size={14} className="animate-spin" /> Processing Batch...</> : <><Plus size={14} /> Add Photos</>}
                </button>
              </div>
              <input type="file" multiple accept="image/*,.heic,.heif" className="hidden" ref={fileInputRef} onChange={handleFileSelect} />
            </div>

            {(pendingPhotos.length > 0 || processingQueue.length > 0) && (
              <div className={`mb-4 rounded-xl p-4 border transition-all duration-300 ${
                isBatchUploadComplete
                  ? 'bg-emerald-50/90 border-emerald-300 shadow-sm'
                  : 'bg-amber-50/90 border-amber-300 shadow-sm'
              }`}>
                {/* Header with Title and Status Badge */}
                <div className="flex flex-wrap justify-between items-center gap-2 mb-3">
                  <div className="flex items-center gap-2.5">
                    {isBatchUploadComplete ? (
                      <div className="w-8 h-8 rounded-full bg-emerald-100 border border-emerald-300 flex items-center justify-center text-emerald-700 shadow-xs">
                        <CheckCircle2 size={18} className="animate-bounce" />
                      </div>
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-amber-100 border border-amber-300 flex items-center justify-center text-amber-700 shadow-xs">
                        <Loader2 size={18} className="animate-spin text-amber-600" />
                      </div>
                    )}
                    <div>
                      <h5 className={`text-xs font-bold ${isBatchUploadComplete ? 'text-emerald-900' : 'text-amber-900'} flex items-center gap-1.5`}>
                        {isBatchUploadComplete ? (
                          <>
                            <span>All {pendingPhotos.length} Photo(s) Successfully Arrived</span>
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-200 text-emerald-800 font-extrabold uppercase tracking-wide">
                              100% Ready
                            </span>
                          </>
                        ) : (
                          <>
                            <span>Batch Uploading & Processing ({completedBatchCount} / {activeBatchTotal})</span>
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-200 text-amber-800 font-extrabold uppercase tracking-wide">
                              {uploadProgressPercent}%
                            </span>
                          </>
                        )}
                      </h5>
                      <p className={`text-[11px] ${isBatchUploadComplete ? 'text-emerald-700' : 'text-amber-700'} mt-0.5`}>
                        {isBatchUploadComplete
                          ? 'All photo files have arrived and verified. Save them to the room to start AI analysis.'
                          : `Converting and processing image files (${processingQueue.length} remaining)...`}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={cancelUpload}
                      disabled={isBlockingUI}
                      className="text-xs text-red-600 hover:text-red-800 px-2.5 py-1 rounded border border-red-200 hover:bg-red-50 flex items-center gap-1 transition disabled:opacity-50"
                    >
                      <X size={12} /> Discard
                    </button>
                    <button
                      type="button"
                      onClick={finalizeUpload}
                      disabled={isBlockingUI || processingQueue.length > 0}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3.5 py-1.5 rounded-lg shadow-xs flex items-center gap-1.5 transition disabled:opacity-50 disabled:bg-gray-400"
                    >
                      {isFinalizing ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                      {isFinalizing ? 'Saving...' : `Finalize & Attach ${pendingPhotos.length} Photo(s)`}
                    </button>
                  </div>
                </div>

                {/* Overall Progress Bar */}
                <div className="mb-3">
                  <div className="flex justify-between items-center text-[10px] font-semibold text-gray-500 mb-1">
                    <span>Batch Arrival Progress</span>
                    <span>{completedBatchCount} of {activeBatchTotal} completed ({uploadProgressPercent}%)</span>
                  </div>
                  <div className="w-full h-3 bg-gray-200/80 rounded-full overflow-hidden p-0.5 border border-gray-300/50 shadow-inner">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        isBatchUploadComplete
                          ? 'bg-emerald-500'
                          : 'bg-gradient-to-r from-blue-500 to-indigo-600 animate-pulse'
                      }`}
                      style={{ width: `${uploadProgressPercent}%` }}
                    />
                  </div>
                </div>

                {/* Visual Status Indicator Banner when complete */}
                {isBatchUploadComplete && (
                  <div className="mb-3 p-2.5 bg-emerald-100/90 border border-emerald-300 rounded-lg flex items-center gap-2 text-emerald-900 text-xs font-medium animate-in fade-in slide-in-from-top-1">
                    <ShieldCheck className="text-emerald-700 flex-shrink-0" size={16} />
                    <span>
                      <strong>Visual Verification Complete:</strong> Photos successfully arrived and are verified for Gemini multi-image visual inspection.
                    </span>
                  </div>
                )}

                {/* Thumbnails list */}
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {pendingPhotos.map((photo) => (
                    <div key={photo.id} className="relative flex-shrink-0 w-20 h-20 group border-2 border-emerald-400 rounded-lg overflow-hidden bg-white shadow-xs">
                      <PhotoThumbnail photo={photo} isPending={true} />
                      <button type="button" onClick={() => removePendingPhoto(photo.id)} disabled={isBlockingUI} className="absolute top-0 right-0 bg-red-500 text-white p-1 z-30 rounded-bl hover:bg-red-600">
                        <Trash2 size={10} />
                      </button>
                    </div>
                  ))}
                  {processingQueue.map((item) => (
                    <div key={item.id} className="relative flex-shrink-0 w-20 h-20 bg-white border border-gray-200 rounded-lg flex flex-col items-center justify-center p-2 shadow-xs">
                      <div className="mb-1 text-blue-500">{item.status === 'processing' ? <Loader2 size={18} className="animate-spin text-blue-600" /> : <Clock size={18} className="text-gray-400" />}</div>
                      <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden mb-1">
                        <div className={`h-full rounded-full transition-all duration-300 ${item.status === 'processing' ? 'bg-blue-500 w-full animate-pulse' : 'bg-gray-300 w-0'}`}></div>
                      </div>
                      <span className="text-[8px] text-gray-600 font-bold uppercase tracking-wider">{item.status === 'processing' ? 'Converting' : 'Queued'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {room.photos.length > 0 ? (
              <div className="flex flex-col gap-3">
                <div className="flex gap-2 overflow-x-auto pb-2 min-h-[100px]">
                  {room.photos.map((photo) => (
                    <div key={photo.id} className="relative flex-shrink-0 w-24 h-24 group border border-gray-200 rounded bg-gray-50">
                      <PhotoThumbnail photo={photo} showTags={true} />
                      <button type="button" onClick={() => removePhoto(photo.id)} disabled={isBlockingUI} className="absolute top-0 right-0 bg-red-500 text-white p-1 opacity-0 group-hover:opacity-100 transition z-20"><Trash2 size={12} /></button>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 pt-2">
                  <button type="button" onClick={handleAutoDetectItems} disabled={isDiscovering || isBlockingUI} className="flex items-center gap-1 text-xs bg-indigo-50 border border-indigo-200 text-indigo-700 rounded px-3 py-1 hover:bg-indigo-100 disabled:opacity-50 disabled:bg-gray-50 disabled:text-gray-400">
                    {isDiscovering ? <Loader2 size={12} className="animate-spin" /> : <ScanEye size={12} />} {isDiscovering ? 'Scanning...' : 'Auto-Detect Items from Photos'}
                  </button>
                  <button type="button" onClick={handleAutoTag} disabled={isBlockingUI} className="flex items-center gap-1 text-xs border border-gray-300 rounded px-3 py-1 hover:bg-gray-50 disabled:opacity-50">
                    {isAutoTagging ? <Loader2 size={12} className="animate-spin" /> : <ImageIcon size={12} />} {isAutoTagging ? 'Tagging...' : 'Auto-Tag Photos'}
                  </button>
                  <button type="button" onClick={handleBulkGenerate} disabled={isBulkGenerating} className="flex items-center gap-1 text-xs bg-purple-50 border border-purple-200 text-purple-700 rounded px-3 py-1 hover:bg-purple-100 disabled:opacity-50 disabled:bg-gray-50 disabled:text-gray-400">
                    {isBulkGenerating ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />} {isBulkGenerating ? 'Generating All...' : 'Bulk Auto-Generate Commentary'}
                  </button>
                </div>
              </div>
            ) : pendingPhotos.length === 0 && processingQueue.length === 0 && (
              <div onClick={() => !isProcessing && fileInputRef.current?.click()} className="border-2 border-dashed border-gray-300 rounded p-6 text-center cursor-pointer hover:border-blue-400 text-gray-400">
                <p className="text-sm">Click to select photos (supports HEIC & standard images)</p>
                <p className="text-xs text-gray-300 mt-1">or drag and drop them here</p>
              </div>
            )}
          </div>

          <div className="mb-6 bg-gray-50 p-3 rounded border border-gray-200 relative group/overview">
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                Room General Overview
                {(previousReport || previousReportNotes) && <span className="text-[10px] bg-amber-100 text-amber-800 px-1 rounded normal-case">Comparing vs Previous Report</span>}
              </label>
            </div>
            <div className="relative">
              <textarea value={room.overallComment} onChange={(event) => onUpdate({ ...room, overallComment: event.target.value })} className={`w-full text-sm p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-200 focus:border-blue-400 min-h-[60px] ${generatingOverall ? 'text-transparent' : ''}`} placeholder="General comments..." disabled={isBlockingUI} />
              {generatingOverall ? <AIGeneratingOverlay mode={room.overallComment ? 'refine' : 'create'} message={generatingOverall} /> : (
                <button type="button" onClick={handleGenerateOverall} disabled={isBlockingUI} className="absolute top-2 right-2 text-purple-600 bg-purple-50 p-1 rounded-full opacity-0 group-hover/overview:opacity-100 transition border border-purple-200 flex items-center gap-1 pr-2 hover:bg-purple-100">
                  {room.overallComment ? <RefreshCw size={14} /> : <Sparkles size={14} />}
                  {room.overallComment && <span className="text-[10px] font-bold">Refine</span>}
                </button>
              )}
            </div>
          </div>

          <div className="space-y-3">
            {room.items.map((item) => (
              <div key={item.id} className="grid grid-cols-12 gap-4 items-start bg-gray-50 p-2 rounded hover:bg-gray-100 transition">
                <div className="col-span-3"><input type="text" value={item.name} onChange={(event) => updateItem(item.id, { name: event.target.value })} className="w-full bg-transparent border-b border-transparent focus:border-blue-500 focus:outline-none text-sm font-medium" disabled={isBlockingUI} /></div>
                <div className="col-span-2 flex justify-between px-2 pt-1">
                  <input type="checkbox" checked={item.isClean} onChange={(event) => updateItem(item.id, { isClean: event.target.checked })} className="accent-green-600 w-4 h-4" disabled={isBlockingUI} />
                  <input type="checkbox" checked={item.isUndamaged} onChange={(event) => updateItem(item.id, { isUndamaged: event.target.checked })} className="accent-green-600 w-4 h-4" disabled={isBlockingUI} />
                  <input type="checkbox" checked={item.isWorking} onChange={(event) => updateItem(item.id, { isWorking: event.target.checked })} className="accent-green-600 w-4 h-4" disabled={isBlockingUI} />
                </div>
                <div className="col-span-6 relative group/comment">
                  <textarea value={item.comment} onChange={(event) => updateItem(item.id, { comment: event.target.value })} className={`w-full text-sm p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-200 focus:border-blue-400 min-h-[60px] ${loadingItems[item.id] ? 'text-transparent' : ''}`} placeholder="Condition..." disabled={isBlockingUI} />
                  {loadingItems[item.id] ? <AIGeneratingOverlay mode={item.comment ? 'refine' : 'create'} message={loadingItems[item.id]} /> : (
                    <button type="button" onClick={() => generateAIComment(item)} disabled={isBlockingUI} className="absolute top-2 right-2 text-purple-600 bg-purple-50 p-1 rounded-full opacity-0 group-hover/comment:opacity-100 transition border border-purple-200 flex items-center gap-1 pr-2 hover:bg-purple-100">
                      {item.comment ? <RefreshCw size={14} /> : <Sparkles size={14} />}
                      {item.comment && <span className="text-[10px] font-bold">Refine</span>}
                    </button>
                  )}
                </div>
                <div className="col-span-1 flex justify-end"><button type="button" onClick={() => deleteItem(item.id)} disabled={isBlockingUI} className="text-gray-400 hover:text-red-500 pt-2"><Trash2 size={16} /></button></div>
              </div>
            ))}
          </div>

          <div className="flex justify-between items-center mt-6">
            <button type="button" onClick={handleAddItem} disabled={isBlockingUI} className="flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50"><Plus size={16} /> Add Item</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default RoomForm;
