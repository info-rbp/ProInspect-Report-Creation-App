import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image as ImageIcon, MapPinned, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import type {
  PropertyDocument,
  PropertyFloorPlanHotspot,
  PropertyFloorPlanMap,
  PropertyRecord,
} from '../../types/platform';
import { generateId } from '../../utils';
import { getProperty } from '../../services/platform/propertyService';
import { openLocalPropertyDocument } from '../../services/platform/propertyDocumentService';
import { getPropertyDocumentViewUrl } from '../../services/platform/propertyIntelligenceService';
import {
  createPropertyFloorPlan,
  listPropertyFloorPlans,
  updatePropertyFloorPlan,
} from '../../services/platform/propertyFloorPlanService';

interface Props {
  propertyId: string;
}

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.max(minimum, Math.min(maximum, value));
}

const PropertyFloorPlanPanel: React.FC<Props> = ({ propertyId }) => {
  const [property, setProperty] = useState<PropertyRecord | null>(null);
  const [maps, setMaps] = useState<PropertyFloorPlanMap[]>([]);
  const [selectedMapId, setSelectedMapId] = useState('');
  const [selectedDocumentId, setSelectedDocumentId] = useState('');
  const [selectedAreaId, setSelectedAreaId] = useState('');
  const [selectedHotspotId, setSelectedHotspotId] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imageFrameRef = useRef<HTMLDivElement | null>(null);

  const load = async () => {
    const record = await getProperty(propertyId);
    if (!record) {
      setProperty(null);
      return;
    }
    setProperty(record);
    const floorPlans = await listPropertyFloorPlans(record);
    setMaps(floorPlans.filter((map) => map.status === 'active'));
    if (!selectedMapId && floorPlans.length) setSelectedMapId(floorPlans[0].id);
  };

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : 'Floor plans could not be loaded.'));
  }, [propertyId]);

  const selectedMap = maps.find((map) => map.id === selectedMapId);
  const planDocuments = useMemo(
    () => (property?.documents || []).filter((document) => ['floor_plan', 'building_plan'].includes(document.type)),
    [property],
  );
  const selectedDocument = planDocuments.find((document) => document.id === (selectedMap?.documentId || selectedDocumentId));
  const selectedHotspot = selectedMap?.hotspots.find((hotspot) => hotspot.id === selectedHotspotId);

  useEffect(() => {
    let localObjectUrl = '';
    const resolve = async () => {
      setImageUrl('');
      if (!property || !selectedDocument || !selectedDocument.contentType.startsWith('image/')) return;
      if (selectedDocument.status === 'local_only') {
        localObjectUrl = await openLocalPropertyDocument(selectedDocument.id) || '';
        setImageUrl(localObjectUrl);
        return;
      }
      const signed = await getPropertyDocumentViewUrl(property, selectedDocument.id);
      setImageUrl(signed.url);
    };
    void resolve().catch((err) => setError(err instanceof Error ? err.message : 'Floor plan image could not be opened.'));
    return () => {
      if (localObjectUrl) URL.revokeObjectURL(localObjectUrl);
    };
  }, [property, selectedDocument?.id]);

  const setMap = (next: PropertyFloorPlanMap) => {
    setMaps((current) => current.map((map) => map.id === next.id ? next : map));
  };

  const createMap = async () => {
    if (!property || !selectedDocumentId) return;
    const document = planDocuments.find((item) => item.id === selectedDocumentId);
    if (!document || !document.contentType.startsWith('image/')) {
      setError('Choose a JPG, PNG, WebP or other image floor plan. PDF plans remain viewable documents but cannot receive graphical hotspots.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await createPropertyFloorPlan(property, {
        documentId: document.id,
        title: document.title || document.fileName,
      });
      setMaps((current) => [...current, created]);
      setSelectedMapId(created.id);
      setSelectedDocumentId('');
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Interactive floor plan could not be created.');
    } finally {
      setBusy(false);
    }
  };

  const addHotspot = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!selectedMap || !property || !selectedAreaId || !imageFrameRef.current) return;
    const area = (property.roomsConfig || []).find((candidate) => candidate.id === selectedAreaId);
    if (!area) return;
    const rect = imageFrameRef.current.getBoundingClientRect();
    const centreX = ((event.clientX - rect.left) / rect.width) * 100;
    const centreY = ((event.clientY - rect.top) / rect.height) * 100;
    const hotspot: PropertyFloorPlanHotspot = {
      id: `hotspot-${generateId()}`,
      areaId: area.id,
      areaName: area.name,
      x: clamp(centreX - 6, 0, 88),
      y: clamp(centreY - 4, 0, 92),
      width: 12,
      height: 8,
    };
    setMap({ ...selectedMap, hotspots: [...selectedMap.hotspots, hotspot] });
    setSelectedHotspotId(hotspot.id);
    setDirty(true);
  };

  const patchHotspot = (patch: Partial<PropertyFloorPlanHotspot>) => {
    if (!selectedMap || !selectedHotspotId) return;
    setMap({
      ...selectedMap,
      hotspots: selectedMap.hotspots.map((hotspot) => hotspot.id === selectedHotspotId ? { ...hotspot, ...patch } : hotspot),
    });
    setDirty(true);
  };

  const removeHotspot = () => {
    if (!selectedMap || !selectedHotspotId) return;
    setMap({ ...selectedMap, hotspots: selectedMap.hotspots.filter((hotspot) => hotspot.id !== selectedHotspotId) });
    setSelectedHotspotId('');
    setDirty(true);
  };

  const save = async () => {
    if (!property || !selectedMap) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await updatePropertyFloorPlan(property, selectedMap, { hotspots: selectedMap.hotspots, title: selectedMap.title });
      setMap(saved);
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Floor plan map could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  if (!property || planDocuments.length === 0) return null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
        <div>
          <div className="flex items-center gap-2"><MapPinned size={18} className="text-violet-600" /><h2 className="font-bold text-slate-950">Interactive Floor Plans</h2></div>
          <p className="mt-1 text-xs text-slate-500">Map stable property areas onto an uploaded plan image. Hotspots are property navigation metadata, not condition evidence.</p>
        </div>
        {selectedMap && <button disabled={busy || !dirty} onClick={() => void save()} className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">{busy ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />} Save Floor Plan</button>}
      </div>

      {error && <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</div>}

      <div className="mt-4 flex flex-wrap gap-2">
        {maps.map((map) => <button key={map.id} onClick={() => { setSelectedMapId(map.id); setSelectedHotspotId(''); setDirty(false); }} className={`rounded-xl px-3 py-2 text-xs font-semibold ${selectedMapId === map.id ? 'bg-slate-950 text-white' : 'border border-slate-200 bg-white text-slate-700'}`}>{map.title}</button>)}
      </div>

      {!selectedMap && (
        <div className="mt-4 flex flex-wrap gap-2 rounded-xl bg-slate-50 p-4">
          <select value={selectedDocumentId} onChange={(event) => setSelectedDocumentId(event.target.value)} className="min-w-64 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs">
            <option value="">Choose uploaded plan image...</option>
            {planDocuments.map((document) => <option key={document.id} value={document.id}>{document.title} ({document.contentType})</option>)}
          </select>
          <button disabled={busy || !selectedDocumentId} onClick={() => void createMap()} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"><Plus size={14} /> Create Interactive Map</button>
        </div>
      )}

      {selectedMap && (
        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div>
            {selectedMap.layoutVersionId && selectedMap.layoutVersionId !== property.currentLayoutVersionId && (
              <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">This floor plan was mapped against layout version {selectedMap.layoutVersionId}. The current property layout is {property.currentLayoutVersionId || 'unversioned'}; review hotspots before relying on it for navigation.</div>
            )}
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <select value={selectedAreaId} onChange={(event) => setSelectedAreaId(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs">
                <option value="">Select an area, then click the plan...</option>
                {(property.roomsConfig || []).map((area) => <option key={area.id} value={area.id}>{area.name}{area.floorLevel ? ` · ${area.floorLevel}` : ''}</option>)}
              </select>
              <span className="text-xs text-slate-500">Click the image to place a hotspot for the selected area.</span>
            </div>
            {imageUrl ? (
              <div ref={imageFrameRef} onClick={addHotspot} className="relative inline-block max-w-full cursor-crosshair overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                <img src={imageUrl} alt={selectedMap.title} className="block h-auto max-h-[760px] max-w-full select-none" draggable={false} />
                {selectedMap.hotspots.map((hotspot) => (
                  <button
                    type="button"
                    key={hotspot.id}
                    onClick={(event) => { event.stopPropagation(); setSelectedHotspotId(hotspot.id); }}
                    title={hotspot.areaName}
                    className={`absolute flex items-center justify-center overflow-hidden rounded-md border-2 px-1 text-[10px] font-bold shadow-sm ${selectedHotspotId === hotspot.id ? 'border-violet-700 bg-violet-500/45 text-violet-950' : 'border-blue-600 bg-blue-400/35 text-blue-950'}`}
                    style={{ left: `${hotspot.x}%`, top: `${hotspot.y}%`, width: `${hotspot.width}%`, height: `${hotspot.height}%` }}
                  >
                    {hotspot.label || hotspot.areaName}
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500"><ImageIcon size={18} className="mr-2" /> Plan image unavailable.</div>
            )}
          </div>

          <aside className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-bold text-slate-900">Hotspot Inspector</h3>
            {!selectedHotspot ? <p className="mt-2 text-xs text-slate-500">Select a hotspot to adjust its position and size.</p> : (
              <div className="mt-3 space-y-4">
                <div><div className="text-xs font-semibold text-slate-900">{selectedHotspot.areaName}</div><div className="text-[10px] text-slate-400">{selectedHotspot.areaId}</div></div>
                <Range label="Horizontal position" value={selectedHotspot.x} max={98} onChange={(value) => patchHotspot({ x: clamp(value, 0, 100 - selectedHotspot.width) })} />
                <Range label="Vertical position" value={selectedHotspot.y} max={98} onChange={(value) => patchHotspot({ y: clamp(value, 0, 100 - selectedHotspot.height) })} />
                <Range label="Width" value={selectedHotspot.width} min={2} max={50} onChange={(value) => patchHotspot({ width: value, x: clamp(selectedHotspot.x, 0, 100 - value) })} />
                <Range label="Height" value={selectedHotspot.height} min={2} max={50} onChange={(value) => patchHotspot({ height: value, y: clamp(selectedHotspot.y, 0, 100 - value) })} />
                <input value={selectedHotspot.label || ''} onChange={(event) => patchHotspot({ label: event.target.value })} placeholder="Optional display label" className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs" />
                <button onClick={removeHotspot} className="inline-flex items-center gap-2 text-xs font-semibold text-rose-600"><Trash2 size={14} /> Remove hotspot</button>
              </div>
            )}
          </aside>
        </div>
      )}
    </section>
  );
};

const Range: React.FC<{ label: string; value: number; min?: number; max?: number; onChange: (value: number) => void }> = ({ label, value, min = 0, max = 100, onChange }) => (
  <label className="block text-[11px] font-semibold text-slate-600">
    <span className="flex justify-between"><span>{label}</span><span>{Math.round(value)}%</span></span>
    <input type="range" min={min} max={max} step={0.5} value={value} onChange={(event) => onChange(Number(event.target.value))} className="mt-1 w-full" />
  </label>
);

export default PropertyFloorPlanPanel;
