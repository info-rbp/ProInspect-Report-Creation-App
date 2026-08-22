import React, { useMemo, useState } from 'react';
import { Boxes, Link2, Plus } from 'lucide-react';
import type { PropertyAsset, PropertyAssetCategory, PropertyRecord } from '../../types/platform';
import { generateId } from '../../utils';

const CATEGORIES: PropertyAssetCategory[] = [
  'appliance', 'hvac', 'hot_water', 'solar', 'security', 'pool', 'fire_safety',
  'electrical', 'plumbing', 'fixture', 'commercial_equipment', 'other',
];

function dateValue(value?: string): string {
  if (!value) return 'Not recorded';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}

function canonicaliseExistingAsset(property: PropertyRecord, asset: PropertyAsset): PropertyAsset {
  if (!asset.areaId) return asset;
  const area = (property.roomsConfig || []).find((candidate) => candidate.id === asset.areaId);
  if (!area?.canonicalAreaDefinitionId) return asset;
  const component = asset.componentInstanceId
    ? area.componentRefs?.find((candidate) => candidate.id === asset.componentInstanceId)
    : asset.canonicalComponentDefinitionId
      ? area.componentRefs?.find((candidate) => candidate.canonicalComponentDefinitionId === asset.canonicalComponentDefinitionId)
      : undefined;
  return {
    ...asset,
    canonicalAreaDefinitionId: area.canonicalAreaDefinitionId,
    canonicalAreaDefinitionVersion: area.canonicalAreaDefinitionVersion,
    ...(component ? {
      componentInstanceId: component.id,
      canonicalComponentDefinitionId: component.canonicalComponentDefinitionId,
      canonicalComponentDefinitionVersion: component.canonicalComponentDefinitionVersion,
    } : {}),
  };
}

const PropertyAssetsPanel: React.FC<{
  property: PropertyRecord;
  onSave: (patch: Partial<PropertyRecord>) => Promise<void>;
  busy: boolean;
}> = ({ property, onSave, busy }) => {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<PropertyAssetCategory>('appliance');
  const [areaId, setAreaId] = useState('');
  const [componentInstanceId, setComponentInstanceId] = useState('');

  const selectedArea = useMemo(
    () => (property.roomsConfig || []).find((area) => area.id === areaId),
    [property.roomsConfig, areaId],
  );
  const selectedComponent = useMemo(
    () => selectedArea?.componentRefs?.find((component) => component.id === componentInstanceId),
    [selectedArea, componentInstanceId],
  );
  const migratableLegacyAssets = useMemo(
    () => (property.assets || []).filter((asset) => {
      if (!asset.areaId || asset.canonicalAreaDefinitionId) return false;
      return (property.roomsConfig || []).some((area) => area.id === asset.areaId && area.canonicalAreaDefinitionId);
    }),
    [property.assets, property.roomsConfig],
  );

  const saveAssets = (assets: PropertyAsset[]) => onSave({ assets });

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><Boxes size={18} /><h2 className="font-bold">Asset & Appliance Register</h2></div>
          <p className="mt-1 text-xs text-slate-500">Assets can be bound to the exact Property Area occurrence and canonical Component identity. Display labels may change without breaking asset history.</p>
        </div>
        {migratableLegacyAssets.length > 0 && (
          <button
            disabled={busy}
            onClick={() => void saveAssets((property.assets || []).map((asset) => canonicaliseExistingAsset(property, asset)))}
            className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 disabled:opacity-50"
          >
            <Link2 size={14} /> Upgrade {migratableLegacyAssets.length} exact Area binding{migratableLegacyAssets.length === 1 ? '' : 's'}
          </button>
        )}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(property.assets || []).map((asset) => {
          const area = asset.areaId ? (property.roomsConfig || []).find((candidate) => candidate.id === asset.areaId) : undefined;
          const component = asset.componentInstanceId && area
            ? area.componentRefs?.find((candidate) => candidate.id === asset.componentInstanceId)
            : undefined;
          return (
            <div key={asset.id} className="rounded-xl border border-slate-200 p-4">
              <div className="flex justify-between gap-3">
                <div><div className="font-semibold">{asset.name}</div><div className="text-xs capitalize text-slate-500">{asset.category.replaceAll('_', ' ')}</div></div>
                <span className="text-[10px] font-bold uppercase text-emerald-600">{asset.status}</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-slate-400">Brand</span><div className="font-medium">{asset.brand || 'Not recorded'}</div></div>
                <div><span className="text-slate-400">Model</span><div className="font-medium">{asset.model || 'Not recorded'}</div></div>
                <div><span className="text-slate-400">Serial</span><div className="font-medium">{asset.serialNumber || 'Not recorded'}</div></div>
                <div><span className="text-slate-400">Last tested</span><div className="font-medium">{dateValue(asset.lastWorkingConfirmationAt)}</div></div>
              </div>
              <div className="mt-3 space-y-1 rounded-lg bg-slate-50 p-2 text-[10px] text-slate-600">
                <div><b>Area occurrence:</b> {area?.name || asset.areaId || 'Not linked'}</div>
                <div><b>Canonical Area:</b> {asset.canonicalAreaDefinitionId ? `${asset.canonicalAreaDefinitionId}@${asset.canonicalAreaDefinitionVersion}` : 'Not linked'}</div>
                <div><b>Component:</b> {component?.name || asset.canonicalComponentDefinitionId || 'Not linked'}</div>
                <div><b>Canonical Component:</b> {asset.canonicalComponentDefinitionId ? `${asset.canonicalComponentDefinitionId}@${asset.canonicalComponentDefinitionVersion}` : 'Not linked'}</div>
              </div>
              <button
                disabled={busy}
                onClick={() => void saveAssets((property.assets || []).map((item) => item.id === asset.id ? { ...item, status: 'removed' } : item))}
                className="mt-3 text-xs font-semibold text-rose-600 disabled:opacity-50"
              >Mark removed</button>
            </div>
          );
        })}
      </div>

      <div className="mt-5 grid gap-2 lg:grid-cols-[minmax(180px,1fr)_170px_minmax(180px,1fr)_minmax(200px,1fr)_auto]">
        <input value={name} onChange={(event) => setName(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs" placeholder="Asset / appliance name" />
        <select value={category} onChange={(event) => setCategory(event.target.value as PropertyAssetCategory)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs">
          {CATEGORIES.map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}
        </select>
        <select value={areaId} onChange={(event) => { setAreaId(event.target.value); setComponentInstanceId(''); }} className="rounded-xl border border-slate-200 px-3 py-2 text-xs">
          <option value="">No Area binding</option>
          {(property.roomsConfig || []).map((area) => <option key={area.id} value={area.id}>{area.name}{area.canonicalAreaDefinitionId ? ` · ${area.canonicalAreaDefinitionId}` : ' · legacy'}</option>)}
        </select>
        <select disabled={!selectedArea} value={componentInstanceId} onChange={(event) => setComponentInstanceId(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs disabled:bg-slate-50">
          <option value="">No Component binding</option>
          {(selectedArea?.componentRefs || []).map((component) => <option key={component.id} value={component.id}>{component.name} · {component.canonicalComponentDefinitionId}</option>)}
        </select>
        <button
          disabled={busy || !name.trim() || Boolean(areaId && !selectedArea?.canonicalAreaDefinitionId)}
          onClick={() => {
            const asset: PropertyAsset = {
              id: `asset-${generateId()}`,
              name: name.trim(),
              category,
              status: 'active',
              ...(selectedArea ? {
                areaId: selectedArea.id,
                canonicalAreaDefinitionId: selectedArea.canonicalAreaDefinitionId,
                canonicalAreaDefinitionVersion: selectedArea.canonicalAreaDefinitionVersion,
              } : {}),
              ...(selectedComponent ? {
                componentInstanceId: selectedComponent.id,
                canonicalComponentDefinitionId: selectedComponent.canonicalComponentDefinitionId,
                canonicalComponentDefinitionVersion: selectedComponent.canonicalComponentDefinitionVersion,
              } : {}),
            };
            setName('');
            setAreaId('');
            setComponentInstanceId('');
            void saveAssets([...(property.assets || []), asset]);
          }}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
        ><Plus size={14} /> Add Asset</button>
      </div>
    </section>
  );
};

export default PropertyAssetsPanel;
