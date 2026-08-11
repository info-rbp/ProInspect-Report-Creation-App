import { useState, useCallback, useMemo } from 'react';
import { InspectionItem, Photo, ReportData, Room } from '../../types';
import { generateId } from '../../utils';

export function useReportWorkspace(initialReport: ReportData) {
  const [report, setReport] = useState<ReportData>(initialReport);
  const [activeAreaId, setActiveAreaId] = useState<string>(() => {
    return initialReport.rooms && initialReport.rooms.length > 0 ? initialReport.rooms[0].id : '';
  });
  const [isDirty, setIsDirty] = useState(false);

  // Sync activeAreaId if rooms change or selected area was deleted
  const activeArea = useMemo(() => {
    return report.rooms.find((r) => r.id === activeAreaId) || report.rooms[0] || null;
  }, [report.rooms, activeAreaId]);

  const updateReport = useCallback((updater: ReportData | ((prev: ReportData) => ReportData)) => {
    setReport((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      setIsDirty(true);
      return next;
    });
  }, []);

  const selectArea = useCallback((areaId: string) => {
    setActiveAreaId(areaId);
  }, []);

  const updateArea = useCallback((areaId: string, updatedArea: Room) => {
    setReport((prev) => {
      const rooms = prev.rooms.map((r) => (r.id === areaId ? updatedArea : r));
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
      return {
        ...prev,
        rooms: [...prev.rooms, newArea],
      };
    });

    setActiveAreaId(newArea.id);
  }, []);

  const removeArea = useCallback((areaId: string) => {
    setReport((prev) => {
      const remaining = prev.rooms.filter((r) => r.id !== areaId);
      setIsDirty(true);
      return { ...prev, rooms: remaining };
    });

    setActiveAreaId((prev) => {
      if (prev === areaId) {
        const remaining = report.rooms.filter((r) => r.id !== areaId);
        return remaining.length > 0 ? remaining[0].id : '';
      }
      return prev;
    });
  }, [report.rooms]);

  const updateComponent = useCallback((areaId: string, componentId: string, patch: Partial<InspectionItem>) => {
    setReport((prev) => {
      const rooms = prev.rooms.map((r) => {
        if (r.id !== areaId) return r;
        const items = r.items.map((item) => (item.id === componentId ? { ...item, ...patch } : item));
        return { ...r, items };
      });
      setIsDirty(true);
      return { ...prev, rooms };
    });
  }, []);

  const addComponentToArea = useCallback((areaId: string, newItem: InspectionItem) => {
    setReport((prev) => {
      const rooms = prev.rooms.map((r) => {
        if (r.id !== areaId) return r;
        return { ...r, items: [...r.items, newItem] };
      });
      setIsDirty(true);
      return { ...prev, rooms };
    });
  }, []);

  const removeComponentFromArea = useCallback((areaId: string, componentId: string) => {
    setReport((prev) => {
      const rooms = prev.rooms.map((r) => {
        if (r.id !== areaId) return r;
        return { ...r, items: r.items.filter((item) => item.id !== componentId) };
      });
      setIsDirty(true);
      return { ...prev, rooms };
    });
  }, []);

  const addPhotosToArea = useCallback((areaId: string, newPhotos: Photo[]) => {
    setReport((prev) => {
      const rooms = prev.rooms.map((r) => {
        if (r.id !== areaId) return r;
        return {
          ...r,
          photos: [...r.photos, ...newPhotos],
          status: 'photos_uploaded' as const,
        };
      });
      setIsDirty(true);
      return { ...prev, rooms };
    });
  }, []);

  const removePhotoFromArea = useCallback((areaId: string, photoId: string) => {
    setReport((prev) => {
      const rooms = prev.rooms.map((r) => {
        if (r.id !== areaId) return r;
        const remainingPhotos = r.photos.filter((p) => p.id !== photoId);
        // Clean up photo references in components
        const items = r.items.map((item) => ({
          ...item,
          photoReferences: (item.photoReferences || []).filter((ref) => ref.photoId !== photoId),
        }));
        return { ...r, photos: remainingPhotos, items };
      });
      setIsDirty(true);
      return { ...prev, rooms };
    });
  }, []);

  const markSaved = useCallback(() => {
    setIsDirty(false);
  }, []);

  const applyExitComparison = useCallback(async () => {
    const { compareComponentEntryToExit } = await import('@pcr/domain');
    setReport((prev) => {
      const rooms = prev.rooms.map((room) => {
        const items = room.items.map((item) => {
          if (!item.baselineComponentData) return item;
          const compResult = compareComponentEntryToExit(item.baselineComponentData, item);
          return {
            ...item,
            comparisonStatus: compResult.comparisonStatus as any,
            presenceComparison: compResult.presenceComparison,
            conditionComparison: compResult.conditionComparison,
            cleanlinessComparison: compResult.cleanlinessComparison,
            workingComparison: compResult.workingComparison,
            comparisonCommentary: compResult.comparisonCommentary,
            evidencePairs: compResult.evidencePairs,
            comparisonConfidence: compResult.comparisonConfidence,
            ...(compResult.comparisonUncertainty ? { comparisonUncertainty: compResult.comparisonUncertainty } : {}),
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
