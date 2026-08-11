import { useState, useCallback, useMemo } from 'react';
import type { ComponentComparisonStatus } from '@pcr/domain';
import { InspectionItem, Photo, ReportData, Room } from '../../types';
import { generateId } from '../../utils';

export function useReportWorkspace(initialReport: ReportData) {
  const [report, setReport] = useState<ReportData>(initialReport);
  const [activeAreaId, setActiveAreaId] = useState<string>(() => (
    initialReport.rooms && initialReport.rooms.length > 0 ? initialReport.rooms[0].id : ''
  ));
  const [isDirty, setIsDirty] = useState(false);

  const activeArea = useMemo(() => (
    report.rooms.find((room) => room.id === activeAreaId) || report.rooms[0] || null
  ), [report.rooms, activeAreaId]);

  const updateReport = useCallback((updater: ReportData | ((prev: ReportData) => ReportData)) => {
    setReport((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      setIsDirty(true);
      return next;
    });
  }, []);

  const selectArea = useCallback((areaId: string) => setActiveAreaId(areaId), []);

  const updateArea = useCallback((areaId: string, updatedArea: Room) => {
    setReport((prev) => {
      const rooms = prev.rooms.map((room) => (room.id === areaId ? updatedArea : room));
      setIsDirty(true);
      return { ...prev, rooms };
    });
  }, []);

  const addArea = useCallback((name: string, items: InspectionItem[] = []) => {
    const newArea: Room = {
      id: generateId(),
      name,
      status: 'draft',
      items,
      photos: [],
      overallComment: '',
      isExpanded: true,
    };

    setReport((prev) => {
      setIsDirty(true);
      return { ...prev, rooms: [...prev.rooms, newArea] };
    });
    setActiveAreaId(newArea.id);
  }, []);

  const removeArea = useCallback((areaId: string) => {
    setReport((prev) => {
      const remaining = prev.rooms.filter((room) => room.id !== areaId);
      setIsDirty(true);
      return { ...prev, rooms: remaining };
    });
    setActiveAreaId((current) => {
      if (current !== areaId) return current;
      const remaining = report.rooms.filter((room) => room.id !== areaId);
      return remaining[0]?.id || '';
    });
  }, [report.rooms]);

  const updateComponent = useCallback((areaId: string, componentId: string, patch: Partial<InspectionItem>) => {
    setReport((prev) => {
      const rooms = prev.rooms.map((room) => {
        if (room.id !== areaId) return room;
        return {
          ...room,
          items: room.items.map((item) => (item.id === componentId ? { ...item, ...patch } : item)),
        };
      });
      setIsDirty(true);
      return { ...prev, rooms };
    });
  }, []);

  const addComponentToArea = useCallback((areaId: string, newItem: InspectionItem) => {
    setReport((prev) => {
      const rooms = prev.rooms.map((room) => (
        room.id === areaId ? { ...room, items: [...room.items, newItem] } : room
      ));
      setIsDirty(true);
      return { ...prev, rooms };
    });
  }, []);

  const removeComponentFromArea = useCallback((areaId: string, componentId: string) => {
    setReport((prev) => {
      const rooms = prev.rooms.map((room) => (
        room.id === areaId ? { ...room, items: room.items.filter((item) => item.id !== componentId) } : room
      ));
      setIsDirty(true);
      return { ...prev, rooms };
    });
  }, []);

  const addPhotosToArea = useCallback((areaId: string, newPhotos: Photo[]) => {
    setReport((prev) => {
      const rooms = prev.rooms.map((room) => {
        if (room.id !== areaId) return room;
        return { ...room, photos: [...room.photos, ...newPhotos], status: 'photos_uploaded' as const };
      });
      setIsDirty(true);
      return { ...prev, rooms };
    });
  }, []);

  const removePhotoFromArea = useCallback((areaId: string, photoId: string) => {
    setReport((prev) => {
      const rooms = prev.rooms.map((room) => {
        if (room.id !== areaId) return room;
        const remainingPhotos = room.photos.filter((photo) => photo.id !== photoId);
        const items = room.items.map((item) => ({
          ...item,
          photoReferences: (item.photoReferences || []).filter((reference) => reference.photoId !== photoId),
        }));
        return { ...room, photos: remainingPhotos, items };
      });
      setIsDirty(true);
      return { ...prev, rooms };
    });
  }, []);

  const markSaved = useCallback(() => setIsDirty(false), []);

  const applyExitComparison = useCallback(async () => {
    const { compareComponentEntryToExit } = await import('@pcr/domain');
    setReport((prev) => {
      const rooms = prev.rooms.map((room) => {
        const items = room.items.map((item) => {
          if (!item.baselineComponentData) return item;
          const comparison = compareComponentEntryToExit(
            item.baselineComponentData,
            {
              id: item.id,
              component: item.name,
              conditionCategory: item.conditionCategory,
              cleanlinessCategory: item.cleanlinessCategory,
              workingStatus: item.workingStatus,
              testStatus: item.testStatus,
              defects: item.defects,
              commentary: item.comment,
              photoReferences: item.photoReferences,
            },
          );
          return {
            ...item,
            comparisonStatus: comparison.comparisonStatus as ComponentComparisonStatus,
            presenceComparison: comparison.presenceComparison,
            conditionComparison: comparison.conditionComparison,
            cleanlinessComparison: comparison.cleanlinessComparison,
            workingComparison: comparison.workingComparison,
            comparisonCommentary: comparison.comparisonCommentary,
            evidencePairs: comparison.evidencePairs,
            comparisonConfidence: comparison.comparisonConfidence,
            ...(comparison.comparisonUncertainty ? { comparisonUncertainty: comparison.comparisonUncertainty } : {}),
          };
        });
        return { ...room, items };
      });
      setIsDirty(true);
      return { ...prev, rooms };
    });
  }, []);

  return {
    report,
    setReport,
    activeAreaId,
    activeArea,
    isDirty,
    selectArea,
    updateReport,
    updateArea,
    addArea,
    removeArea,
    updateComponent,
    addComponentToArea,
    removeComponentFromArea,
    addPhotosToArea,
    removePhotoFromArea,
    applyExitComparison,
    markSaved,
  };
}
