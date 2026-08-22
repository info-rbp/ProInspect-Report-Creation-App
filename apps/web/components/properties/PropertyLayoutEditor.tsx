import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Layers3, Plus, RefreshCw } from 'lucide-react';
import type { CatalogueAreaVersionView } from '@pcr/templates/catalogueAdmin';
import type { PropertyRecord, RoomConfigItem } from '../../types/platform';
import { getCatalogueAreas } from '../../services/catalogueStorage';
import {
  applyLayoutTemplate,
  cloneLayoutFromProperty,
  createLayoutVersion,
  createRoomFromCatalogueArea,
  hierarchyFromRooms,
  migrateTemplateBackedLayoutToCanonical,
  templatesForProperty,
} from '../../services/platform/propertyLayoutService';

function dateValue(value?: string): string {
  if (!value) return 'Not recorded';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}

function compatibleArea(area: CatalogueAreaVersionView, property: PropertyRecord): boolean {
  if (area.definition.status !== 'published' || !area.immutable) return false;
  const use = property.propertyUse;
  const physical = property.physicalPropertyType;
  return (!use || area.definition.applicability.propertyUses.includes(use))
    && (!physical || area.definition.applicability.physicalPropertyTypes.includes(physical));
}

const PropertyLayoutEditor: React.FC<{
  property: PropertyRecord;
  portfolio: PropertyRecord[];
  onSave: (patch: Partial<PropertyRecord>) => Promise<void>;
  busy: boolean;
}> = ({ property, portfolio, onSave, busy }) => {
  const templates = useMemo(() => templatesForProperty(property), [property.propertyUse, property.physicalPropertyType]);
  const [templateId, setTemplateId] = useState(property.layoutTemplateId || templates[0]?.id || '');
  const [cloneId, setCloneId] = useState('');
  const [catalogueAreas, setCatalogueAreas] = useState<CatalogueAreaVersionView[]>([]);
  const [catalogueLoading, setCatalogueLoading] = useState(false);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);
  const [areaKey, setAreaKey] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [newLevel, setNewLevel] = useState('Ground Floor');

  const migration = useMemo(() => migrateTemplateBackedLayoutToCanonical(property), [property]);
  const compatibleAreas = useMemo(
    () => catalogueAreas.filter((area) => compatibleArea(area, property))
      .sort((left, right) => left.definition.name.localeCompare(right.definition.name) || right.definition.version - left.definition.version),
    [catalogueAreas, property.propertyUse, property.physicalPropertyType],
  );

  useEffect(() => {
    setTemplateId((current) => templates.some((item) => item.id === current) ? current : property.layoutTemplateId || templates[0]?.id || '');
  }, [property.layoutTemplateId, templates]);

  useEffect(() => {
    let active = true;
    setCatalogueLoading(true);
    setCatalogueError(null);
    void getCatalogueAreas({ status: 'published' })
      .then((areas) => { if (active) setCatalogueAreas(areas); })
      .catch((error) => { if (active) setCatalogueError(error instanceof Error ? error.message : 'Catalogue Areas could not be loaded.'); })
      .finally(() => { if (active) setCatalogueLoading(false); });
    return () => { active = false; };
  }, []);

  const saveRooms = (rooms: RoomConfigItem[], reason: string, templateIdOverride = property.layoutTemplateId) => {
    const version = createLayoutVersion(property, rooms, reason, templateIdOverride);
    const previous = (property.layoutVersions || []).map((item) => item.effectiveTo ? item : { ...item, effectiveTo: version.effectiveFrom });
    return onSave({
      roomsConfig: rooms,
      layoutNodes: hierarchyFromRooms(rooms),
      layoutVersions: [...previous, version],
      currentLayoutVersionId: version.id,
      ...(templateIdOverride ? { layoutTemplateId: templateIdOverride } : {}),
    });
  };

  const selectedArea = compatibleAreas.find((area) => `${area.definition.id}@${area.definition.version}` === areaKey);
  const migrationNeedsSave = Boolean(property.layoutTemplateId && migration.migratedCount > 0);
  const migrationHasUnmapped = migration.unmappedCount > 0;

  return <div className="space-y-5">
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-center gap-2"><Layers3 size={18} /><h2 className="font-bold">Canonical Layout Templates & Versioning</h2></div>
      <p className="mt-1 text-xs text-slate-500">Templates now bind every Property Area and Component to an exact immutable catalogue version. Display labels can change without changing identity.</p>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="flex gap-2">
          <select value={templateId} onChange={(event) => setTemplateId(event.target.value)} className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm">
            {templates.length === 0 && <option value="">No compatible system template</option>}
            {templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <button disabled={busy || !templateId} onClick={() => { const template = templates.find((item) => item.id === templateId); if (template) void onSave(applyLayoutTemplate(property, template)); }} className="rounded-xl bg-blue-600 px-4 text-xs font-semibold text-white disabled:opacity-50">Apply as New Version</button>
        </div>
        <div className="flex gap-2">
          <select value={cloneId} onChange={(event) => setCloneId(event.target.value)} className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm">
            <option value="">Copy from another property...</option>
            {portfolio.map((item) => <option key={item.id} value={item.id}>{item.address}</option>)}
          </select>
          <button disabled={busy || !cloneId} onClick={() => { const source = portfolio.find((item) => item.id === cloneId); if (source) void onSave(cloneLayoutFromProperty(property, source)); }} className="rounded-xl border border-slate-200 px-4 text-xs font-semibold disabled:opacity-50">Copy Layout</button>
        </div>
      </div>
    </section>

    {migrationNeedsSave && <section className={`rounded-2xl border p-5 ${migrationHasUnmapped ? 'border-amber-200 bg-amber-50' : 'border-blue-200 bg-blue-50'}`}>
      <div className="flex gap-3">
        <AlertTriangle className={`mt-0.5 shrink-0 ${migrationHasUnmapped ? 'text-amber-700' : 'text-blue-700'}`} size={18} />
        <div className="flex-1">
          <h3 className={`font-bold ${migrationHasUnmapped ? 'text-amber-950' : 'text-blue-950'}`}>Legacy layout can be migrated to canonical references</h3>
          <p className={`mt-1 text-xs ${migrationHasUnmapped ? 'text-amber-800' : 'text-blue-800'}`}>
            The persisted template can deterministically migrate {migration.migratedCount} Area slot{migration.migratedCount === 1 ? '' : 's'} without using display-name guesses.
            {migrationHasUnmapped ? ` ${migration.unmappedCount} custom Area${migration.unmappedCount === 1 ? '' : 's'} will remain explicitly unmapped for human review.` : ' All existing Area slots can be migrated without an unresolved custom mapping.'}
          </p>
          <button disabled={busy} onClick={() => void saveRooms(migration.rooms, 'Migrated legacy template-backed layout to canonical Area and Component references', property.layoutTemplateId)} className={`mt-3 rounded-xl px-4 py-2 text-xs font-semibold text-white disabled:opacity-50 ${migrationHasUnmapped ? 'bg-amber-900' : 'bg-blue-700'}`}>Create Canonical Layout Version</button>
        </div>
      </div>
    </section>}

    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex justify-between gap-4"><div><h2 className="font-bold">Configured Areas</h2><p className="text-xs text-slate-500">Each row is a Property-owned Area instance backed by an exact Area definition and populated exact Component rules.</p></div><span className="text-xs font-semibold text-slate-500">{property.roomsConfig?.length || 0} areas</span></div>
      <div className="mt-4 space-y-2">{(property.roomsConfig || []).map((room, index) => <div key={room.id} className="rounded-xl border border-slate-200 p-3"><div className="grid gap-2 md:grid-cols-[36px_1fr_150px_160px_auto]"><div className="pt-2 text-xs text-slate-400">{index + 1}</div><input key={`${room.id}:${room.name}`} defaultValue={room.name} onBlur={(event) => { const nextName = event.currentTarget.value.trim(); if (!nextName || nextName === room.name) { event.currentTarget.value = room.name; return; } const rooms = (property.roomsConfig || []).map((item) => item.id === room.id ? { ...item, name: nextName } : item); void saveRooms(rooms, `Renamed Area display label ${room.name} to ${nextName}`); }} className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs" /><div className="pt-2 text-xs capitalize text-slate-500">{room.roomType}</div><div className="pt-2 text-xs text-slate-500">{room.floorLevel || 'Ground Floor'}</div><button disabled={busy} onClick={() => void saveRooms((property.roomsConfig || []).filter((item) => item.id !== room.id), `Removed Area ${room.name}`)} className="text-xs font-semibold text-rose-600">Remove</button></div><div className="mt-2 flex flex-wrap gap-2 pl-9 text-[10px] font-semibold"><span className={`rounded-lg px-2 py-1 ${room.canonicalAreaDefinitionId ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{room.canonicalAreaDefinitionId ? `${room.canonicalAreaDefinitionId} v${room.canonicalAreaDefinitionVersion}` : 'Legacy / unmapped Area'}</span><span className="rounded-lg bg-slate-100 px-2 py-1 text-slate-600">{room.componentRefs?.length || 0} canonical Components</span><span className="rounded-lg bg-slate-100 px-2 py-1 font-mono text-slate-500">{room.id}</span></div></div>)}</div>

      <div className="mt-5 border-t border-slate-100 pt-4">
        <div className="mb-2 flex items-center justify-between"><div><h3 className="text-sm font-bold">Add Published Catalogue Area</h3><p className="text-[11px] text-slate-500">Create custom Area definitions in Templates & Rules first, publish them, then add the exact published version here.</p></div>{catalogueLoading && <RefreshCw size={14} className="animate-spin text-slate-400" />}</div>
        {catalogueError && <div className="mb-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">{catalogueError}</div>}
        <div className="grid gap-2 md:grid-cols-[minmax(240px,1fr)_minmax(180px,1fr)_180px_auto]">
          <select value={areaKey} onChange={(event) => { setAreaKey(event.target.value); const area = compatibleAreas.find((candidate) => `${candidate.definition.id}@${candidate.definition.version}` === event.target.value); if (area) setDisplayName(area.definition.name); }} className="rounded-xl border border-slate-200 px-3 py-2 text-xs"><option value="">Select published Area...</option>{compatibleAreas.map((area) => <option key={`${area.definition.id}@${area.definition.version}`} value={`${area.definition.id}@${area.definition.version}`}>{area.definition.name} · v{area.definition.version} · {area.definition.category.replaceAll('_', ' ')}</option>)}</select>
          <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs" placeholder="Property display label" />
          <input value={newLevel} onChange={(event) => setNewLevel(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs" placeholder="Level" />
          <button disabled={busy || !selectedArea} onClick={() => { if (!selectedArea) return; const room = createRoomFromCatalogueArea(selectedArea, { name: displayName.trim() || selectedArea.definition.name, floorLevel: newLevel.trim() || 'Ground Floor', responsibility: property.propertyUse === 'strata_common_property' ? 'common_property' : 'lot' }); setAreaKey(''); setDisplayName(''); void saveRooms([...(property.roomsConfig || []), room], `Added canonical Area ${selectedArea.definition.id}@${selectedArea.definition.version}`); }} className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"><Plus size={14} className="inline" /> Add Area</button>
        </div>
      </div>
    </section>

    <section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-bold">Layout History</h2><div className="mt-3 space-y-2">{[...(property.layoutVersions || [])].reverse().map((version) => <div key={version.id} className="flex justify-between rounded-xl bg-slate-50 p-3 text-xs"><div><b>{version.label}</b><div className="text-slate-500">{version.changeReason || 'Layout snapshot'} · {version.roomsConfig.length} areas</div><div className="mt-1 font-mono text-[10px] text-slate-400">{version.canonicalCatalogueId ? `${version.canonicalCatalogueId} v${version.canonicalCatalogueVersion}` : 'Legacy catalogue binding'}</div></div><div className="text-right text-slate-500">Effective {dateValue(version.effectiveFrom)}{version.effectiveTo ? <div>to {dateValue(version.effectiveTo)}</div> : <div className="font-semibold text-emerald-600">Current</div>}</div></div>)}</div></section>
  </div>;
};

export default PropertyLayoutEditor;
