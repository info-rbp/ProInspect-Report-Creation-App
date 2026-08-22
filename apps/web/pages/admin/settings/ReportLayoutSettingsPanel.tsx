import React, { useEffect, useMemo, useState } from 'react';
import { Archive, ArrowDown, ArrowUp, Copy, FileText, Plus, Save, Send } from 'lucide-react';
import type { ReportPresentationSection, ReportPresentationTemplate } from '@pcr/report-presentation';
import { presentationTemplateForReportType } from '@pcr/report-presentation/presets';
import { useAuth } from '../../../contexts/AuthContext';
import {
  createReportLayout,
  listReportLayouts,
  publishReportLayout,
  retireReportLayout,
  updateReportLayout,
} from '../../../services/platform/reportPresentationService';

const field = 'mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500';
const REPORT_TYPES = ['entry', 'routine', 'exit', 'comparison', 'maintenance'] as const;
type ReportType = (typeof REPORT_TYPES)[number];

function reportTypeLabel(value: ReportType): string {
  return value === 'entry' ? 'Entry / Property Condition' : value === 'maintenance' ? 'Maintenance / Follow-Up' : `${value[0].toUpperCase()}${value.slice(1)}`;
}

function presetReportName(value: ReportType): string {
  if (value === 'routine') return 'Routine Inspection';
  if (value === 'exit') return 'Exit Inspection';
  if (value === 'comparison') return 'Inspection Comparison Report';
  if (value === 'maintenance') return 'Maintenance and Follow-Up Report';
  return 'Property Condition Report';
}

function statusClass(status: ReportPresentationTemplate['status']): string {
  if (status === 'published') return 'bg-emerald-50 text-emerald-700';
  if (status === 'retired') return 'bg-slate-100 text-slate-500';
  return 'bg-amber-50 text-amber-800';
}

const ReportLayoutSettingsPanel: React.FC = () => {
  const { userProfile } = useAuth();
  const agencyId = userProfile?.agencyId;
  const [layouts, setLayouts] = useState<ReportPresentationTemplate[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [selected, setSelected] = useState<ReportPresentationTemplate | null>(null);
  const [newType, setNewType] = useState<ReportType>('entry');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async (preferredId?: string) => {
    if (!agencyId) return;
    const values = await listReportLayouts(agencyId);
    const ordered = [...values].sort((a, b) => `${a.status}:${a.name}`.localeCompare(`${b.status}:${b.name}`));
    setLayouts(ordered);
    const id = preferredId || selectedId || ordered[0]?.id || '';
    setSelectedId(id);
    setSelected(ordered.find((item) => item.id === id) || null);
  };

  useEffect(() => { void load().catch((caught) => setError(caught instanceof Error ? caught.message : 'Report layouts could not be loaded.')); }, [agencyId]);
  useEffect(() => { setSelected(layouts.find((item) => item.id === selectedId) || null); }, [selectedId, layouts]);

  const editable = selected?.status === 'draft';
  const previewSections = useMemo(() => selected?.sections.filter((section) => section.visible) || [], [selected]);

  const create = async (source?: ReportPresentationTemplate) => {
    if (!agencyId) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const now = new Date().toISOString();
      const base = source ? structuredClone(source) : presentationTemplateForReportType(presetReportName(newType), now);
      const id = source
        ? `${source.id.replace(/-draft-[a-z0-9]+$/u, '')}-draft-${Date.now().toString(36)}`
        : `layout-${newType}-${Date.now().toString(36)}`;
      const draft: ReportPresentationTemplate = {
        ...base,
        id,
        version: 1,
        status: 'draft',
        name: source ? `${source.name} - New Draft` : base.name,
        supportedInspectionTypes: source ? [...source.supportedInspectionTypes] : [newType],
        createdAt: now,
        publishedAt: undefined,
        retiredAt: undefined,
      };
      const created = await createReportLayout(agencyId, draft);
      setNotice('Draft report layout created. It will not affect final reports until published.');
      await load(created.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Report layout could not be created.');
    } finally { setBusy(false); }
  };

  const save = async () => {
    if (!agencyId || !selected || !editable) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const updated = await updateReportLayout(agencyId, selected);
      setNotice('Draft report layout saved as a new governed revision.');
      await load(updated.id);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Report layout could not be saved.'); }
    finally { setBusy(false); }
  };

  const publish = async () => {
    if (!agencyId || !selected || !editable) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const updated = await publishReportLayout(agencyId, selected);
      setNotice('Report layout published. New final reports can now pin this exact version.');
      await load(updated.id);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Report layout could not be published.'); }
    finally { setBusy(false); }
  };

  const retire = async () => {
    if (!agencyId || !selected || selected.status !== 'published') return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const updated = await retireReportLayout(agencyId, selected);
      setNotice('Report layout retired. Historic reports retain their pinned version.');
      await load(updated.id);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Report layout could not be retired.'); }
    finally { setBusy(false); }
  };

  const patch = (value: Partial<ReportPresentationTemplate>) => selected && editable && setSelected({ ...selected, ...value });
  const patchSection = (index: number, value: Partial<ReportPresentationSection>) => {
    if (!selected || !editable) return;
    const sections = [...selected.sections];
    sections[index] = { ...sections[index]!, ...value };
    setSelected({ ...selected, sections });
  };
  const moveSection = (index: number, direction: -1 | 1) => {
    if (!selected || !editable) return;
    const target = index + direction;
    if (target < 0 || target >= selected.sections.length) return;
    const sections = [...selected.sections];
    [sections[index], sections[target]] = [sections[target]!, sections[index]!];
    setSelected({ ...selected, sections });
  };

  return <div className="space-y-5">
    {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
    {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</div>}

    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="font-bold">Report Layouts</h2><p className="mt-1 text-xs text-slate-500">Versioned presentation policy for final PDFs. Published layouts are pinned by exact version at finalisation.</p></div>
        <div className="flex flex-wrap items-end gap-2"><label className="text-xs font-semibold">New layout type<select className={field} value={newType} onChange={(event) => setNewType(event.target.value as ReportType)}>{REPORT_TYPES.map((type) => <option key={type} value={type}>{reportTypeLabel(type)}</option>)}</select></label><button disabled={busy} onClick={() => void create()} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-40"><Plus size={14}/>New draft</button></div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <label className="text-xs font-semibold">Layout<select className={field} value={selectedId} onChange={(event) => setSelectedId(event.target.value)}><option value="">Select a report layout</option>{layouts.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.status} · v{item.version}</option>)}</select></label>
        {selected && <div className="flex items-end gap-2"><span className={`mb-0.5 rounded-full px-2.5 py-1.5 text-[10px] font-bold uppercase ${statusClass(selected.status)}`}>{selected.status} · v{selected.version}</span></div>}
      </div>
    </section>

    {!selected ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">Create or select a report layout.</div> : <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-bold">Layout identity</h3><p className="text-xs text-slate-500">Published records are immutable. Create a new draft to change a published layout.</p></div><div className="flex gap-2">{selected.status !== 'draft' && <button disabled={busy} onClick={() => void create(selected)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold"><Copy size={13}/>New draft from this</button>}{editable && <><button disabled={busy} onClick={() => void save()} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold"><Save size={13}/>Save draft</button><button disabled={busy} onClick={() => void publish()} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white"><Send size={13}/>Publish</button></>}{selected.status === 'published' && <button disabled={busy} onClick={() => void retire()} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold"><Archive size={13}/>Retire</button>}</div></div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="text-xs font-semibold md:col-span-2">Layout name<input disabled={!editable} className={field} value={selected.name} onChange={(event) => patch({ name: event.target.value })}/></label>
            <label className="text-xs font-semibold">Cover style<select disabled={!editable} className={field} value={selected.cover.style} onChange={(event) => patch({ cover: { ...selected.cover, style: event.target.value as ReportPresentationTemplate['cover']['style'] } })}><option value="hero">Hero</option><option value="minimal">Minimal</option><option value="corporate">Corporate</option></select></label>
            <label className="text-xs font-semibold">Page margin (mm)<input disabled={!editable} className={field} type="number" min={5} max={40} value={selected.page.marginMm} onChange={(event) => patch({ page: { ...selected.page, marginMm: Number(event.target.value) || 12 } })}/></label>
            <label className="text-xs font-semibold">Heading font<input disabled={!editable} className={field} value={selected.typography.headingFont} onChange={(event) => patch({ typography: { ...selected.typography, headingFont: event.target.value } })}/></label>
            <label className="text-xs font-semibold">Body font<input disabled={!editable} className={field} value={selected.typography.bodyFont} onChange={(event) => patch({ typography: { ...selected.typography, bodyFont: event.target.value } })}/></label>
            <label className="text-xs font-semibold">Base font size<input disabled={!editable} className={field} type="number" min={7} max={14} value={selected.typography.baseFontSizePt} onChange={(event) => patch({ typography: { ...selected.typography, baseFontSizePt: Number(event.target.value) || 9 } })}/></label>
            <div className="flex flex-wrap items-end gap-4 pb-2 text-xs font-semibold"><label className="inline-flex items-center gap-2"><input disabled={!editable} type="checkbox" checked={selected.page.showPageNumbers} onChange={(event) => patch({ page: { ...selected.page, showPageNumbers: event.target.checked } })}/>Page numbers</label><label className="inline-flex items-center gap-2"><input disabled={!editable} type="checkbox" checked={selected.page.showRunningHeader} onChange={(event) => patch({ page: { ...selected.page, showRunningHeader: event.target.checked } })}/>Running header</label></div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-2"><FileText size={17}/><h3 className="font-bold">Section composition</h3></div><p className="mt-1 text-xs text-slate-500">Order, visibility and density are part of the immutable published presentation version.</p><div className="mt-4 space-y-2">{selected.sections.map((section, index) => <div key={section.id} className="grid gap-3 rounded-xl border border-slate-200 p-3 md:grid-cols-[auto_minmax(0,1fr)_180px_110px_auto] md:items-center"><input disabled={!editable} type="checkbox" checked={section.visible} onChange={(event) => patchSection(index, { visible: event.target.checked })}/><div><div className="text-sm font-semibold">{section.type.replaceAll('_', ' ')}</div><div className="text-[10px] text-slate-400">{section.id}</div></div><select disabled={!editable} className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs" value={section.style || 'standard'} onChange={(event) => patchSection(index, { style: event.target.value as ReportPresentationSection['style'] })}><option value="standard">Standard</option><option value="compact">Compact</option><option value="detailed">Detailed</option><option value="comparison">Comparison</option><option value="exception_first">Exception first</option></select><input disabled={!editable} className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs" type="number" min={0} max={12} value={section.maxPhotosPerComponent ?? ''} onChange={(event) => patchSection(index, { maxPhotosPerComponent: event.target.value ? Number(event.target.value) : undefined })} placeholder="Photos"/><div className="flex gap-1"><button disabled={!editable || index === 0} onClick={() => moveSection(index, -1)} className="rounded-lg border border-slate-200 p-1.5 disabled:opacity-30"><ArrowUp size={12}/></button><button disabled={!editable || index === selected.sections.length - 1} onClick={() => moveSection(index, 1)} className="rounded-lg border border-slate-200 p-1.5 disabled:opacity-30"><ArrowDown size={12}/></button></div></div>)}</div></section>
      </div>

      <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Layout preview</p><div className="mt-3 overflow-hidden rounded-xl border border-slate-200"><div className="bg-slate-950 px-4 py-5 text-white"><div className="text-xs opacity-70">Agency branding snapshot</div><div className="mt-4 text-xl font-black">{selected.name}</div><div className="mt-2 text-xs opacity-70">Property address · Inspection date</div></div><div className="space-y-2 p-4">{previewSections.map((section) => <div key={section.id} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"><div className="text-[11px] font-bold capitalize">{section.type.replaceAll('_', ' ')}</div><div className="text-[10px] text-slate-400">{section.style || 'standard'}{section.maxPhotosPerComponent !== undefined ? ` · max ${section.maxPhotosPerComponent} photos/component` : ''}</div></div>)}</div></div><p className="mt-3 text-[11px] leading-5 text-slate-500">The final PDF renderer applies the published section model, page policy and branding snapshot. Custom font names are versioned now; embedded full-Unicode font files remain a separate renderer capability.</p></aside>
    </div>}
  </div>;
};

export default ReportLayoutSettingsPanel;
