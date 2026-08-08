import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ReportData, Room, InspectionItem, Photo, PreviousReportAttachment } from '../../types';
import RoomForm from '../RoomForm';
import { generateId, getInitialItemsForRoom, ROOM_TYPES, processImageFile } from '../../utils';
import { FileText, Plus, Eye, CheckCircle2, Circle, Image as ImageIcon, Trash2, Upload, ChevronDown, ChevronUp, Save, FolderOpen, Loader2, X, Wand2, Cloud, HardDrive, Settings, Wifi, WifiOff, FileCheck, Building, Sparkles } from 'lucide-react';
import { saveReportToDB, getAllSavedReports, loadReportFromDB, deleteReportFromDB, isFirebaseConfigured } from '../../services/storageService';
import { generateBatchRoomAnalysis } from '../../services/geminiService';
import { RuntimeConfig, clearRuntimeConfig, getRuntimeConfig, isAiConfigured, isRuntimeFirebaseFallbackAllowed, saveRuntimeConfig } from '../../services/configService';
import { MAX_ROOMS_PER_REPORT, sanitizeReportData, validatePreviousReportFile, validateReport } from '../../services/validationService';
import { getReportDisplayTitle, supportsComparison } from '../../services/reportPresentation';
import { logAuditEvent } from '../../services/platform/auditService';
import { upsertReportIndexFromReport } from '../../services/platform/reportIndexService';
import { listProperties } from '../../services/platform/propertyService';
import type { PropertyRecord } from '../../types/platform';
import { seedReportFromProperty, seedRoomsFromProperty } from '../../services/platform/propertySeedingService';

const createInitialReport = (id = generateId()): ReportData => ({
  id,
  propertyAddress: '',
  agentName: 'Admin Team',
  agentCompany: 'ProInspect',
  agentAddress: 'Perth, WA',
  agentPhone: '0400 000 000',
  agentEmail: 'inspections@proinspect.com.au',
  clientName: '',
  inspectionDate: new Date().toISOString().split('T')[0],
  tenantName: '',
  reportType: 'Property Condition Report',
  lifecycleStatus: 'draft',
  rooms: [],
});

const ReportBuilder: React.FC = () => {
  const navigate = useNavigate();
  const { reportId } = useParams<{ reportId: string }>();
  const initialIdRef = useRef(reportId && reportId !== 'new' ? reportId : generateId());
  const [report, setReport] = useState<ReportData>(createInitialReport(initialIdRef.current));
  const [selectedRoomType, setSelectedRoomType] = useState<string>(ROOM_TYPES[0]);
  const [newRoomName, setNewRoomName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [savedReports, setSavedReports] = useState<ReportData[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isHydrating, setIsHydrating] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [configForm, setConfigForm] = useState<RuntimeConfig>(getRuntimeConfig());
  const [isGlobalGenerating, setIsGlobalGenerating] = useState(false);
  const [globalGenerationStatus, setGlobalGenerationStatus] = useState('');
  const [generationProgress, setGenerationProgress] = useState(0);
  const heroInputRef = useRef<HTMLInputElement>(null);
  const [isProcessingHero, setIsProcessingHero] = useState(false);
  const previousReportRef = useRef<HTMLInputElement>(null);

  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>('');
  const [importMessage, setImportMessage] = useState<string>('');

  const aiConfigured = isAiConfigured();
  const cloudConfigured = isFirebaseConfigured();
  const showFirebaseRuntimeFields = isRuntimeFirebaseFallbackAllowed();

  useEffect(() => {
    const fetchProperties = async () => {
      try {
        const records = await listProperties();
        setProperties(records);
        if (report.propertyId) {
          setSelectedPropertyId(report.propertyId);
        } else if (report.propertyAddress) {
          const match = records.find((p) => p.address && report.propertyAddress.includes(p.address));
          if (match) setSelectedPropertyId(match.id);
        }
      } catch (err) {
        console.warn('Failed to load properties in report builder:', err);
      }
    };
    fetchProperties();
  }, [report.propertyId, report.propertyAddress]);

  const handleImportProperty = (propertyIdToImport?: string) => {
    const targetId = propertyIdToImport || selectedPropertyId;
    if (!targetId) return;
    const prop = properties.find((p) => p.id === targetId);
    if (!prop) return;

    const seeded = seedReportFromProperty(prop, report);
    setReport(seeded);
    setSelectedPropertyId(targetId);
    setImportMessage(`Successfully pulled property details & seeded ${seeded.rooms.length} room templates for ${prop.address}.`);
    setTimeout(() => setImportMessage(''), 6000);
  };

  const handleSeedDefaultRooms = () => {
    const defaultProperty: PropertyRecord = {
      id: 'default',
      agencyId: report.agencyId || 'proinspect-agency',
      address: report.propertyAddress || 'Standard Property',
      bedrooms: 3,
      bathrooms: 2,
      livingAreas: 1,
      parking: 1,
      clientIds: [],
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const rooms = seedRoomsFromProperty(defaultProperty);
    setReport((prev) => ({ ...prev, rooms }));
    setImportMessage(`Auto-generated ${rooms.length} default room templates.`);
    setTimeout(() => setImportMessage(''), 6000);
  };

  useEffect(() => {
    const hydrateRouteReport = async () => {
      if (!reportId || reportId === 'new') {
        setReport(createInitialReport(initialIdRef.current));
        return;
      }

      setIsHydrating(true);
      try {
        const loadedReport = await loadReportFromDB(reportId);
        if (loadedReport) {
          setReport(loadedReport);
          await logAuditEvent({
            agencyId: loadedReport.agencyId,
            entityType: 'report',
            entityId: reportId,
            eventType: 'report_loaded',
            metadata: { source: 'report_edit_route' },
          });
        }
      } catch (error) {
        console.error('Failed to load route report', error);
      } finally {
        setIsHydrating(false);
      }
    };

    hydrateRouteReport();
  }, [reportId]);

  useEffect(() => {
    setNewRoomName(selectedRoomType);
  }, [selectedRoomType]);

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    let sentinel: WakeLockSentinel | null = null;

    const requestLock = async () => {
      if (isGlobalGenerating && 'wakeLock' in navigator && !document.hidden) {
        try {
          sentinel = await navigator.wakeLock.request('screen');
        } catch (error) {
          console.warn('Wake lock denied', error);
        }
      }
    };

    const handleVisibilityChange = () => {
      if (!document.hidden && isGlobalGenerating && !sentinel) {
        requestLock();
      }
      if (document.hidden && sentinel) {
        sentinel = null;
      }
    };

    if (isGlobalGenerating) {
      requestLock();
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      if (sentinel) sentinel.release();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isGlobalGenerating]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (isGlobalGenerating || isSaving) {
        const message = 'Work is in progress. Closing this window will stop the current task.';
        event.returnValue = message;
        return message;
      }
      return undefined;
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isGlobalGenerating, isSaving]);

  const updateReport = (updates: Partial<ReportData>) => {
    setReport((prev) => ({ ...prev, ...updates }));
  };

  const playCompletionSound = () => {
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) return;

      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(523.25, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(1046.5, context.currentTime + 0.1);
      gain.gain.setValueAtTime(0.1, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.8);
      oscillator.start(context.currentTime);
      oscillator.stop(context.currentTime + 0.8);
    } catch (error) {
      console.error('Audio playback failed', error);
    }
  };

  const handleConfigChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = event.target;
    setConfigForm((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const handleSaveConfig = (event: React.FormEvent) => {
    event.preventDefault();

    if (showFirebaseRuntimeFields && configForm.enableCloudSync) {
      const missingFields = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId']
        .filter((key) => !configForm[key as keyof RuntimeConfig]);

      if (missingFields.length > 0) {
        alert('Enable Cloud Sync only after all Firebase fields are provided.');
        return;
      }
    }

    saveRuntimeConfig(configForm);
    window.location.reload();
  };

  const handleClearConfig = () => {
    if (window.confirm('Clear stored AI and cloud settings from this device?')) {
      clearRuntimeConfig();
      window.location.reload();
    }
  };

  const handleSaveReport = async () => {
    const sanitizedReport = sanitizeReportData(report);
    const { errors } = validateReport(sanitizedReport);

    if (errors.length > 0) {
      alert(errors.join('\n'));
      return;
    }

    setIsSaving(true);
    setReport(sanitizedReport);

    try {
      const savedReport = await saveReportToDB(sanitizedReport);
      setReport(savedReport);
      await upsertReportIndexFromReport(savedReport);
      await logAuditEvent({
        agencyId: savedReport.agencyId,
        entityType: 'report',
        entityId: savedReport.id,
        eventType: savedReport.createdAt === savedReport.updatedAt ? 'report_created' : 'report_updated',
        metadata: {
          reportType: savedReport.reportType,
          lifecycleStatus: savedReport.lifecycleStatus || 'draft',
        },
      });
      const destination = cloudConfigured ? 'Cloud' : 'Device';
      alert(`Report saved to ${destination} successfully.`);
    } catch (error) {
      console.error('Save failed', error);
      alert('Failed to save the report. Review your runtime settings and try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const openLoadModal = async () => {
    setShowLoadModal(true);
    setIsLoadingList(true);
    try {
      setSavedReports(await getAllSavedReports());
    } catch (error) {
      console.error('Failed to list reports', error);
      alert('Failed to access saved reports.');
    } finally {
      setIsLoadingList(false);
    }
  };

  const handleLoadReport = async (id: string) => {
    if (!window.confirm('Loading a report will overwrite current unsaved changes. Continue?')) {
      return;
    }

    setIsHydrating(true);
    try {
      const loadedReport = await loadReportFromDB(id);
      if (!loadedReport) {
        alert('Report not found or failed to load.');
        return;
      }

      (report.rooms || []).forEach((room) => (room.photos || []).forEach((photo) => URL.revokeObjectURL(photo.previewUrl)));
      if (report.heroPhoto) {
        URL.revokeObjectURL(report.heroPhoto.previewUrl);
      }

      setReport(loadedReport);
      await logAuditEvent({
        agencyId: loadedReport.agencyId,
        entityType: 'report',
        entityId: loadedReport.id,
        eventType: 'report_loaded',
        metadata: { source: 'open_saved_report_modal' },
      });
      setShowLoadModal(false);
    } catch (error) {
      console.error('Load failed', error);
      alert('Failed to load the report.');
    } finally {
      setIsHydrating(false);
    }
  };

  const handleDeleteSavedReport = async (id: string, event: React.MouseEvent) => {
    event.stopPropagation();
    if (!window.confirm('Permanently delete this saved report?')) {
      return;
    }

    try {
      await deleteReportFromDB(id);
      setSavedReports((prev) => prev.filter((savedReport) => savedReport.id !== id));
    } catch (error) {
      console.error('Delete failed', error);
      alert('Failed to delete the report.');
    }
  };

  const handleGenerateFullReport = async () => {
    if (!aiConfigured) {
      alert('AI features are disabled until a Gemini API key is added in Settings.');
      return;
    }

    const roomsWithPhotos = (report.rooms || []).filter((room) => (room.photos || []).length > 0);
    if (roomsWithPhotos.length === 0) {
      alert('No rooms have photos. Upload room photos before running AI analysis.');
      return;
    }

    const comparisonMsg = (report.previousReport || report.previousReportNotes)
      ? 'Comparison mode is active. AI will compare current photos against the supplied previous report context.'
      : 'Standard AI generation';

    if (!window.confirm(`Ready to analyse ${roomsWithPhotos.length} room(s)?\n\n${comparisonMsg}`)) {
      return;
    }

    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }

    setIsGlobalGenerating(true);
    setGenerationProgress(0);

    try {
      const chunkSize = 5;
      const totalSteps = roomsWithPhotos.length;

      for (let index = 0; index < roomsWithPhotos.length; index += 1) {
        const room = roomsWithPhotos[index];
        const roomIndex = (report.rooms || []).findIndex((entry) => entry.id === room.id);
        if (roomIndex === -1) {
          continue;
        }

        const progressPercent = Math.round((index / totalSteps) * 100);
        setGenerationProgress(progressPercent);
        document.title = `(${progressPercent}%) Generating Report...`;

        const currentRoomState = { ...room };

        for (let photoIndex = 0; photoIndex < room.photos.length; photoIndex += chunkSize) {
          setGlobalGenerationStatus(
            `Room ${index + 1}/${roomsWithPhotos.length}: ${room.name}\n` +
            `Analysing photo batch ${Math.ceil((photoIndex + 1) / chunkSize)} of ${Math.ceil(room.photos.length / chunkSize)}...`,
          );

          const batchPhotos = room.photos.slice(photoIndex, photoIndex + chunkSize);
          const analysisResult = await generateBatchRoomAnalysis(
            room.name,
            batchPhotos,
            currentRoomState.items,
            currentRoomState.overallComment,
            report.previousReport?.file,
            report.previousReportNotes,
          );

          currentRoomState.overallComment = analysisResult.overallComment || currentRoomState.overallComment;
          if (analysisResult.items?.length) {
            currentRoomState.items = currentRoomState.items.map((item) => {
              const update = analysisResult.items.find((candidate) =>
                candidate.id.toLowerCase() === item.name.toLowerCase() || candidate.id === item.id
              );
              return update ? { ...item, comment: update.comment, isClean: update.isClean, isUndamaged: update.isUndamaged, isWorking: update.isWorking } : item;
            });
          }

          setReport((prev) => {
            const rooms = [...(prev.rooms || [])];
            rooms[roomIndex] = { ...currentRoomState };
            return { ...prev, rooms };
          });
        }

        setReport((prev) => {
          const rooms = [...(prev.rooms || [])];
          rooms[roomIndex] = { ...rooms[roomIndex], status: 'analyzed' };
          return { ...prev, rooms };
        });
      }

      setGlobalGenerationStatus('Complete');
      setGenerationProgress(100);
      document.title = 'Report Ready';
      playCompletionSound();

      if (document.hidden && Notification.permission === 'granted') {
        const notification = new Notification('Report generation complete', {
          body: 'Your AI-assisted report is ready for review.',
          requireInteraction: true,
        });
        notification.onclick = () => {
          window.focus();
          notification.close();
        };
      }
    } catch (error) {
      console.error('Global generation failed', error);
      alert('AI generation failed. Review your API key, image selection, and quota, then try again.');
    } finally {
      setIsGlobalGenerating(false);
      setGlobalGenerationStatus('');
      setGenerationProgress(0);
      document.title = 'Remote Business Partner Property Reports';
    }
  };

  const handleHeroPhotoSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      setIsProcessingHero(true);
      try {
        const processedFile = await processImageFile(event.target.files[0]);
        const newPhoto: Photo = {
          id: generateId(),
          file: processedFile,
          previewUrl: URL.createObjectURL(processedFile),
        };
        updateReport({ heroPhoto: newPhoto });
      } catch (error) {
        console.error('Hero upload failed', error);
        alert('Failed to process the cover photo.');
      } finally {
        setIsProcessingHero(false);
        if (heroInputRef.current) heroInputRef.current.value = '';
      }
    }
  };

  const removeHeroPhoto = () => {
    if (report.heroPhoto) {
      URL.revokeObjectURL(report.heroPhoto.previewUrl);
      updateReport({ heroPhoto: undefined });
    }
  };

  const handlePreviousReportSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      const file = event.target.files[0];
      const errors = validatePreviousReportFile(file);
      if (errors.length > 0) {
        alert(errors.join('\n'));
        return;
      }

      const newAttachment: PreviousReportAttachment = {
        id: generateId(),
        file,
        name: file.name,
        mimeType: file.type,
      };
      updateReport({ previousReport: newAttachment });
      if (previousReportRef.current) previousReportRef.current.value = '';
    }
  };

  const removePreviousReport = () => {
    updateReport({ previousReport: undefined });
  };

  const handleAddRoom = (event: React.FormEvent) => {
    event.preventDefault();
    if (!newRoomName.trim()) {
      return;
    }

    if ((report.rooms || []).length >= MAX_ROOMS_PER_REPORT) {
      alert(`A report can contain at most ${MAX_ROOMS_PER_REPORT} rooms or areas.`);
      return;
    }

    const initialItems: InspectionItem[] = getInitialItemsForRoom(selectedRoomType).map((name) => ({
      id: generateId(),
      name,
      isClean: true,
      isUndamaged: true,
      isWorking: true,
      comment: '',
    }));

    const newRoom: Room = {
      id: generateId(),
      name: newRoomName.trim(),
      status: 'draft',
      items: initialItems,
      photos: [],
      overallComment: '',
      isExpanded: true,
    };

    setReport((prev) => ({ ...prev, rooms: [...(prev.rooms || []), newRoom] }));
    setSelectedRoomType(ROOM_TYPES[0]);
    setNewRoomName(ROOM_TYPES[0]);
  };

  const updateRoom = (updatedRoom: Room) => {
    setReport((prev) => ({
      ...prev,
      rooms: (prev.rooms || []).map((room) => room.id === updatedRoom.id ? updatedRoom : room),
    }));
  };

  const deleteRoom = (roomId: string) => {
    if (!window.confirm('Are you sure you want to delete this room?')) {
      return;
    }

    setReport((prev) => ({
      ...prev,
      rooms: (prev.rooms || []).filter((room) => room.id !== roomId),
    }));
  };

  const expandAllRooms = () => {
    setReport((prev) => ({ ...prev, rooms: (prev.rooms || []).map((room) => ({ ...room, isExpanded: true })) }));
  };

  const collapseAllRooms = () => {
    setReport((prev) => ({ ...prev, rooms: (prev.rooms || []).map((room) => ({ ...room, isExpanded: false })) }));
  };

  const handlePreviewReport = () => {
    const sanitizedReport = sanitizeReportData(report);
    const { errors } = validateReport(sanitizedReport);

    if (errors.length > 0) {
      alert(errors.join('\n'));
      return;
    }

    setReport(sanitizedReport);
    navigate(`/app/admin/reports/${sanitizedReport.id}/preview`, { state: { report: sanitizedReport } });
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-20 relative">
      {isGlobalGenerating && (
        <div className="fixed inset-0 bg-black/70 z-50 flex flex-col items-center justify-center p-4 backdrop-blur-sm transition-opacity duration-300">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full text-center border-t-4 border-purple-600">
            <div className="mb-4 flex justify-center">
              <div className="relative">
                <div className="w-16 h-16 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin"></div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <Wand2 size={24} className="text-purple-600 animate-pulse" />
                </div>
              </div>
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">AI is generating report content</h3>
            <p className="text-sm text-gray-500 mb-4">{generationProgress}% complete</p>
            <div className="w-full bg-gray-200 rounded-full h-2 mb-6">
              <div className="bg-purple-600 h-2 rounded-full transition-all duration-300" style={{ width: `${generationProgress}%` }}></div>
            </div>
            <div className="bg-gray-100 rounded-lg p-4 font-mono text-xs text-left text-gray-700 h-24 overflow-hidden relative mb-4">
              <pre className="whitespace-pre-wrap break-words">{globalGenerationStatus}</pre>
            </div>
          </div>
        </div>
      )}

      {isHydrating && (
        <div className="fixed inset-0 bg-white/80 z-50 flex flex-col items-center justify-center p-4 backdrop-blur-sm">
          <Loader2 className="animate-spin text-blue-600 mb-2" size={40} />
          <h3 className="text-lg font-bold text-gray-800">Downloading report</h3>
          <p className="text-sm text-gray-500">Restoring report assets for editing...</p>
        </div>
      )}

      {showSettings && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl max-w-xl w-full p-6 animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6 border-b border-gray-100 pb-4">
              <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <Settings size={24} className="text-blue-600" /> Runtime Settings
              </h2>
              <button onClick={() => setShowSettings(false)} className="text-gray-400 hover:text-gray-600"><X size={24} /></button>
            </div>

            <p className="text-sm text-gray-500 mb-4 bg-blue-50 p-3 rounded-lg border border-blue-100">
              Gemini values are stored locally in this browser for the current operator. Firebase is normally configured from deployment environment variables.
            </p>

            <form onSubmit={handleSaveConfig} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1 uppercase">Gemini API Key</label>
                <input name="geminiApiKey" value={configForm.geminiApiKey} onChange={handleConfigChange} className="w-full border border-gray-300 rounded p-2 text-sm font-mono" placeholder="Enter your Gemini API key" />
              </div>

              {showFirebaseRuntimeFields && (
              <div className="border-t border-gray-100 pt-4">
                <label className="flex items-center gap-3 text-sm font-medium text-gray-800 mb-4">
                  <input type="checkbox" name="enableCloudSync" checked={configForm.enableCloudSync} onChange={handleConfigChange} className="accent-blue-600" />
                  Enable Firebase cloud sync for this development device
                </label>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1 uppercase">Firebase API Key</label>
                    <input name="apiKey" value={configForm.apiKey} onChange={handleConfigChange} className="w-full border border-gray-300 rounded p-2 text-sm font-mono" placeholder="AIza..." />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1 uppercase">Auth Domain</label>
                    <input name="authDomain" value={configForm.authDomain} onChange={handleConfigChange} className="w-full border border-gray-300 rounded p-2 text-sm font-mono" placeholder="project.firebaseapp.com" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1 uppercase">Project ID</label>
                    <input name="projectId" value={configForm.projectId} onChange={handleConfigChange} className="w-full border border-gray-300 rounded p-2 text-sm font-mono" placeholder="my-project-id" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1 uppercase">Storage Bucket</label>
                    <input name="storageBucket" value={configForm.storageBucket} onChange={handleConfigChange} className="w-full border border-gray-300 rounded p-2 text-sm font-mono" placeholder="project.appspot.com" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1 uppercase">Messaging Sender ID</label>
                    <input name="messagingSenderId" value={configForm.messagingSenderId} onChange={handleConfigChange} className="w-full border border-gray-300 rounded p-2 text-sm font-mono" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1 uppercase">App ID</label>
                    <input name="appId" value={configForm.appId} onChange={handleConfigChange} className="w-full border border-gray-300 rounded p-2 text-sm font-mono" />
                  </div>
                </div>
              </div>
              )}

              <div className="flex justify-between pt-4 border-t border-gray-100">
                <button type="button" onClick={handleClearConfig} className="text-red-600 text-sm hover:underline">Clear saved settings</button>
                <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-bold shadow-sm transition">Save & Reload</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <nav className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-slate-900 rounded text-white flex items-center justify-center font-bold">PI</div>
              <span className="font-bold text-xl text-gray-900 hidden sm:block">ProInspect Report Builder</span>
              <span className="font-bold text-xl text-gray-900 sm:hidden">PI</span>
              {cloudConfigured ? (
                <div className="ml-2 flex items-center gap-1 bg-green-50 text-green-700 text-[10px] px-2 py-0.5 rounded-full border border-green-200 font-bold" title="Cloud sync enabled">
                  <Cloud size={10} /> CLOUD
                </div>
              ) : (
                <div className="ml-2 flex items-center gap-1 bg-gray-100 text-gray-500 text-[10px] px-2 py-0.5 rounded-full border border-gray-200 font-bold" title="Local device storage only">
                  <HardDrive size={10} /> DEVICE
                </div>
              )}
              {aiConfigured ? (
                <div className="flex items-center gap-1 bg-blue-50 text-blue-700 text-[10px] px-2 py-0.5 rounded-full border border-blue-200 font-bold" title="AI configured">
                  <Wifi size={10} /> AI READY
                </div>
              ) : (
                <div className="flex items-center gap-1 bg-amber-50 text-amber-700 text-[10px] px-2 py-0.5 rounded-full border border-amber-200 font-bold" title="AI key missing">
                  <WifiOff size={10} /> AI DISABLED
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 md:gap-3">
              <button onClick={() => setShowSettings(true)} className="text-gray-500 hover:bg-gray-100 p-2 rounded-lg transition" title="Runtime Settings">
                <Settings size={20} />
              </button>
              <div className="h-6 w-px bg-gray-300 mx-1"></div>
              <button onClick={handleSaveReport} disabled={isSaving || isGlobalGenerating || isHydrating} className="bg-gray-100 text-gray-700 hover:bg-gray-200 px-3 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2 disabled:opacity-50" title="Save Report">
                {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                <span className="hidden sm:inline">{isSaving ? 'Saving...' : 'Save'}</span>
              </button>
              <button onClick={openLoadModal} disabled={isGlobalGenerating || isHydrating} className="bg-gray-100 text-gray-700 hover:bg-gray-200 px-3 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2 disabled:opacity-50" title="Open Saved Report">
                <FolderOpen size={16} />
                <span className="hidden sm:inline">Open</span>
              </button>
              <div className="h-6 w-px bg-gray-300 mx-1"></div>
              <button onClick={handlePreviewReport} disabled={isGlobalGenerating || isHydrating} className="bg-gray-900 text-white px-3 md:px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-800 transition flex items-center gap-2 disabled:opacity-50">
                <Eye size={16} /> <span className="hidden sm:inline">Preview Report</span>
                <span className="sm:hidden">Preview</span>
              </button>
            </div>
          </div>
        </div>
      </nav>

      {showLoadModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col">
            <div className="p-6 border-b border-gray-200 flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                {cloudConfigured ? <Cloud size={24} className="text-blue-500" /> : <HardDrive size={24} className="text-gray-500" />}
                {cloudConfigured ? 'Cloud Reports' : 'Local Device Reports'}
              </h2>
              <button onClick={() => setShowLoadModal(false)} className="text-gray-500 hover:text-gray-700"><X size={24} /></button>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              {isLoadingList ? (
                <div className="flex justify-center py-8"><Loader2 className="animate-spin text-blue-500" size={32} /></div>
              ) : savedReports.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <FolderOpen size={48} className="mx-auto mb-3 opacity-20" />
                  <p>No saved reports found {cloudConfigured ? 'in cloud storage' : 'on this device'}.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {savedReports.map((savedReport) => (
                    <div key={savedReport.id} onClick={() => handleLoadReport(savedReport.id)} className="border border-gray-200 rounded-lg p-4 hover:border-blue-500 hover:bg-blue-50 cursor-pointer transition group flex justify-between items-center">
                      <div>
                        <h3 className="font-bold text-gray-900">{savedReport.propertyAddress || 'Untitled Property'}</h3>
                        <p className="text-sm text-gray-500">Date: {savedReport.inspectionDate} • {(savedReport.rooms || []).length} Rooms • {savedReport.reportType}</p>
                      </div>
                      <button onClick={(event) => handleDeleteSavedReport(savedReport.id, event)} className="text-gray-400 hover:text-red-500 p-2 opacity-0 group-hover:opacity-100 transition" title="Delete">
                        <Trash2 size={18} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="p-4 bg-gray-50 border-t border-gray-200 text-xs text-gray-500 rounded-b-xl flex items-center gap-2">
              {cloudConfigured ? <><Cloud size={14} /> Protected with anonymous Firebase authentication and per-user ownership rules.</> : <><HardDrive size={14} /> Reports are stored only in this browser profile.</>}
            </div>
          </div>
        </div>
      )}

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-8 relative overflow-hidden">
          <div className="flex flex-col md:flex-row justify-between items-start mb-6 gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg text-blue-600"><FileText size={24} /></div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">{getReportDisplayTitle(report.reportType)}</h1>
                <p className="text-gray-500">Complete the report details, attach inspection photos, and generate structured commentary.</p>
              </div>
            </div>

            <button onClick={handleGenerateFullReport} disabled={isGlobalGenerating || !aiConfigured} className="bg-purple-600 hover:bg-purple-700 text-white px-5 py-3 rounded-lg shadow-md flex items-center gap-2 font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-all">
              {isGlobalGenerating ? <Loader2 size={20} className="animate-spin" /> : <Wand2 size={20} />}
              {isGlobalGenerating ? 'Analysing Report...' : 'Auto-Fill Report with AI'}
            </button>
          </div>

          <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50/70 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-lg text-blue-700">
                  <Building size={20} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-900">Property Integration & Room Seeding</h3>
                  <p className="text-xs text-gray-600">Pull property address, landlord, tenant, and configured room templates into this report.</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={selectedPropertyId}
                  onChange={(e) => {
                    setSelectedPropertyId(e.target.value);
                    if (e.target.value) handleImportProperty(e.target.value);
                  }}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">-- Select Property to Import --</option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.address}{p.suburb ? `, ${p.suburb}` : ''}
                    </option>
                  ))}
                </select>
                {selectedPropertyId && (
                  <button
                    type="button"
                    onClick={() => handleImportProperty(selectedPropertyId)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 transition"
                  >
                    <Sparkles size={14} /> Import Info & Rooms
                  </button>
                )}
              </div>
            </div>
            {importMessage && (
              <div className="mt-3 text-xs font-medium text-blue-800 bg-blue-100/80 px-3 py-1.5 rounded border border-blue-200">
                {importMessage}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Property Address</label>
              <input type="text" value={report.propertyAddress} onChange={(event) => updateReport({ propertyAddress: event.target.value })} className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 focus:outline-none" placeholder="e.g., 7 Riley St, Tuart Hill, WA 6060" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Client / Landlord</label>
              <input type="text" value={report.clientName} onChange={(event) => updateReport({ clientName: event.target.value })} className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 focus:outline-none" placeholder="On behalf of..." />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Inspector Name</label>
              <input type="text" value={report.agentName} onChange={(event) => updateReport({ agentName: event.target.value })} className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
              <input type="text" value={report.agentCompany} onChange={(event) => updateReport({ agentCompany: event.target.value })} className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Company Address</label>
              <input type="text" value={report.agentAddress || ''} onChange={(event) => updateReport({ agentAddress: event.target.value })} className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 focus:outline-none" placeholder="e.g. Perth, WA" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Company Phone/Email</label>
              <input type="text" value={report.agentPhone || ''} onChange={(event) => updateReport({ agentPhone: event.target.value })} className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 focus:outline-none" placeholder="Phone or Email" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Inspection Date</label>
              <input type="date" value={report.inspectionDate} onChange={(event) => updateReport({ inspectionDate: event.target.value })} className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tenant Name(s)</label>
              <input type="text" value={report.tenantName} onChange={(event) => updateReport({ tenantName: event.target.value })} className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 focus:outline-none" placeholder="e.g., John Doe" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Report Type</label>
              <select value={report.reportType} onChange={(event) => updateReport({ reportType: event.target.value })} className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white">
                <option value="Property Condition Report">Property Condition Report (Entry)</option>
                <option value="Routine Inspection">Routine Inspection</option>
                <option value="Exit Inspection">Exit Inspection</option>
              </select>
            </div>
          </div>

          {supportsComparison(report.reportType) && (
            <div className="border-t border-gray-100 pt-6 mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">Previous Report for Comparison (Optional)</label>
              <p className="text-xs text-gray-500 mb-3">Upload a PDF/Image or paste text notes from the previous report. AI will compare current photos against this baseline.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  {report.previousReport ? (
                    <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-lg p-3 h-full">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-amber-100 rounded text-amber-700"><FileCheck size={20} /></div>
                        <div>
                          <p className="text-sm font-bold text-gray-800">{report.previousReport.name}</p>
                          <p className="text-xs text-gray-500 uppercase">{report.previousReport.mimeType.split('/')[1]} file attached</p>
                        </div>
                      </div>
                      <button onClick={removePreviousReport} className="text-red-500 hover:text-red-700 p-2"><Trash2 size={18} /></button>
                    </div>
                  ) : (
                    <div onClick={() => previousReportRef.current?.click()} className="border-2 border-dashed border-gray-300 rounded-lg p-6 flex flex-col items-center justify-center cursor-pointer hover:border-amber-400 hover:bg-amber-50 transition h-full min-h-[100px]">
                      <input type="file" ref={previousReportRef} className="hidden" accept=".pdf,image/*" onChange={handlePreviousReportSelect} />
                      <Upload className="text-gray-400 mb-2" size={24} />
                      <span className="text-sm text-gray-600 font-medium">Upload File (PDF/Image)</span>
                    </div>
                  )}
                </div>
                <div className="flex flex-col">
                  <div className="border border-gray-300 rounded-lg p-3 h-full flex flex-col bg-white">
                    <label className="text-xs font-bold text-gray-500 mb-2 uppercase flex items-center gap-2"><FileText size={14} /> Text Notes (Optional)</label>
                    <textarea value={report.previousReportNotes || ''} onChange={(event) => updateReport({ previousReportNotes: event.target.value })} className="flex-1 w-full text-sm p-2 border border-gray-200 rounded resize-none focus:ring-2 focus:ring-blue-500 focus:outline-none" placeholder="e.g. Kitchen walls had minor scuff marks near entry." />
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="border-t border-gray-100 pt-6">
            <label className="block text-sm font-medium text-gray-700 mb-3">Main Property Photo (Cover Page)</label>
            {report.heroPhoto ? (
              <div className="relative w-64 aspect-video rounded-lg overflow-hidden border border-gray-200 group">
                <img src={report.heroPhoto.previewUrl} alt="Hero" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                  <button onClick={removeHeroPhoto} className="bg-red-500 text-white p-2 rounded-full hover:bg-red-600 transition"><Trash2 size={20} /></button>
                </div>
              </div>
            ) : (
              <div onClick={() => heroInputRef.current?.click()} className={`w-64 h-36 border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer transition ${isProcessingHero ? 'bg-gray-50 border-gray-300' : 'border-blue-300 bg-blue-50 hover:bg-blue-100'}`}>
                <input type="file" ref={heroInputRef} className="hidden" accept="image/*,.heic,.heif" onChange={handleHeroPhotoSelect} disabled={isProcessingHero} />
                {isProcessingHero ? <span className="text-sm text-gray-500 animate-pulse">Processing...</span> : <><ImageIcon className="text-blue-400 mb-2" size={24} /><span className="text-sm text-blue-600 font-medium">Upload Cover Photo</span></>}
              </div>
            )}
          </div>
        </div>

        <div className="mb-8">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-3">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-bold text-gray-900">Rooms & Areas</h2>
              <button
                type="button"
                onClick={handleSeedDefaultRooms}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 shadow-sm hover:bg-gray-50 transition"
                title="Populate standard inspection rooms (Entry, Kitchen, Living, Bedrooms, Bathrooms, Laundry, Garage)"
              >
                <Sparkles size={13} className="text-blue-600" /> Auto-Seed Rooms
              </button>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex gap-2 mr-4">
                <button onClick={expandAllRooms} className="text-xs bg-white border border-gray-300 px-2 py-1 rounded hover:bg-gray-50 flex items-center gap-1"><ChevronDown size={14} /> Expand All</button>
                <button onClick={collapseAllRooms} className="text-xs bg-white border border-gray-300 px-2 py-1 rounded hover:bg-gray-50 flex items-center gap-1"><ChevronUp size={14} /> Collapse All</button>
              </div>
              <div className="flex gap-4 text-xs font-medium text-gray-500">
                <div className="flex items-center gap-1"><Circle size={10} className="text-gray-300 fill-current" /> Draft</div>
                <div className="flex items-center gap-1"><Circle size={10} className="text-blue-500 fill-current" /> Ready</div>
                <div className="flex items-center gap-1"><CheckCircle2 size={12} className="text-green-500" /> Analysed</div>
              </div>
            </div>
          </div>

          {(!report.rooms || report.rooms.length === 0) ? (
            <div className="text-center py-12 bg-white border border-dashed border-gray-300 rounded-xl mb-6 px-4">
              <Building className="mx-auto h-10 w-10 text-gray-400 mb-3" />
              <p className="text-base font-semibold text-gray-800 mb-1">No rooms added to this report yet</p>
              <p className="text-sm text-gray-500 mb-6 max-w-md mx-auto">
                Quickly populate standard inspection areas (Entry, Living, Kitchen, Bedrooms, Bathrooms, Laundry, Garage) or import directly from a property record.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={handleSeedDefaultRooms}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 transition"
                >
                  <Sparkles size={16} /> Auto-Generate Default Rooms
                </button>
                {selectedPropertyId && (
                  <button
                    type="button"
                    onClick={() => handleImportProperty(selectedPropertyId)}
                    className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition"
                  >
                    <Building size={16} className="text-blue-600" /> Pull Rooms from Property
                  </button>
                )}
              </div>
            </div>
          ) : (report.rooms || []).map((room) => (
            <div key={room.id} className="relative">
              <div className={`absolute left-0 top-0 bottom-6 w-1 rounded-l-lg z-10 ${room.status === 'analyzed' ? 'bg-green-500' : room.status === 'photos_uploaded' ? 'bg-blue-500' : 'bg-gray-300'}`}></div>
              <RoomForm room={room} onUpdate={updateRoom} onDelete={() => deleteRoom(room.id)} previousReport={report.previousReport} previousReportNotes={report.previousReportNotes} />
            </div>
          ))}

          <div className="bg-gray-100 p-4 rounded-lg">
            <form onSubmit={handleAddRoom} className="flex flex-col md:flex-row gap-4 items-end md:items-center">
              <div className="flex-1 w-full">
                <label className="block text-xs font-bold text-gray-500 mb-1 uppercase">Area / Room Type</label>
                <select value={selectedRoomType} onChange={(event) => setSelectedRoomType(event.target.value)} className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white">
                  {ROOM_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </div>
              <div className="flex-1 w-full">
                <label className="block text-xs font-bold text-gray-500 mb-1 uppercase">Display Name (Editable)</label>
                <input type="text" value={newRoomName} onChange={(event) => setNewRoomName(event.target.value)} placeholder="e.g. Master Bedroom" className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 focus:outline-none" />
              </div>
              <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium flex items-center gap-2 disabled:opacity-50 h-10 w-full md:w-auto justify-center" disabled={!newRoomName.trim()}>
                <Plus size={20} /> Add Room
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReportBuilder;
