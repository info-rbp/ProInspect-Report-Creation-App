import React, { useEffect, useMemo, useState } from 'react';
import type { ComplianceAssessment, ComplianceObligation } from '@pcr/domain';
import type { PropertyRecord } from '../../types/platform';
import { assessCompliance, createComplianceObligation, listComplianceObligations, updateComplianceObligation } from '../../services/platform/enhancementService';
import { listProperties } from '../../services/platform/propertyService';

const CompliancePage: React.FC = () => {
  const [items, setItems] = useState<ComplianceObligation[]>([]);
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [filter, setFilter] = useState<'all' | 'open' | 'overdue' | 'satisfied'>('all');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [propertyId, setPropertyId] = useState('');
  const [label, setLabel] = useState('');
  const [ruleVersionId, setRuleVersionId] = useState('manual-operational');
  const [dueAt, setDueAt] = useState('');
  const [evidence, setEvidence] = useState('');
  const [assessment, setAssessment] = useState<ComplianceAssessment | null>(null);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const [nextItems, nextProperties] = await Promise.all([listComplianceObligations(), listProperties()]);
      setItems(nextItems);
      setProperties(nextProperties);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const now = Date.now();
  const propertyMap = useMemo(() => new Map(properties.map((property) => [property.id, property])), [properties]);
  const rows = useMemo(() => items.map((item) => ({ ...item, effectiveStatus: item.status === 'open' && item.dueAt && Date.parse(item.dueAt) < now ? 'overdue' : item.status })).filter((item) => {
    const query = search.trim().toLowerCase();
    const property = item.entityType === 'property' ? propertyMap.get(item.entityId) : undefined;
    const matchesSearch = !query || [item.label, item.entityType, item.entityId, property?.address, property?.suburb].filter(Boolean).join(' ').toLowerCase().includes(query);
    return matchesSearch && (filter === 'all' || item.effectiveStatus === filter);
  }).sort((a, b) => String(a.dueAt || '9999').localeCompare(String(b.dueAt || '9999'))), [filter, items, now, propertyMap, search]);
  const overdue = items.filter((item) => item.status === 'open' && item.dueAt && Date.parse(item.dueAt) < now).length;

  const create = async () => {
    if (!propertyId) return setError('Choose a property for the compliance obligation.');
    if (!label.trim()) return setError('Enter a clear obligation label.');
    setBusy(true); setError('');
    try {
      await createComplianceObligation({
        ruleVersionId: ruleVersionId.trim() || 'manual-operational',
        entityType: 'property',
        entityId: propertyId,
        label: label.trim(),
        status: 'open',
        ...(dueAt ? { dueAt: new Date(`${dueAt}T23:59:59`).toISOString() } : {}),
        evidenceIds: [],
      });
      setShowCreate(false); setPropertyId(''); setLabel(''); setDueAt(''); setEvidence(''); await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const markSatisfied = async (item: ComplianceObligation) => {
    const evidenceIds = evidence.split(',').map((value) => value.trim()).filter(Boolean);
    if (!evidenceIds.length && !window.confirm('No evidence reference has been entered. Mark this obligation satisfied without evidence?')) return;
    setBusy(true); setError('');
    try {
      await updateComplianceObligation(item, { status: 'satisfied', evidenceIds: evidenceIds.length ? evidenceIds : item.evidenceIds, satisfiedAt: new Date().toISOString() });
      setEvidence(''); await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const assess = async (item: ComplianceObligation) => {
    setBusy(true); setError('');
    try { setAssessment(await assessCompliance(item.entityType, item.entityId)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const entityLabel = (item: ComplianceObligation) => {
    if (item.entityType === 'property') {
      const property = propertyMap.get(item.entityId);
      return property ? `${property.address}, ${property.suburb}` : item.entityId;
    }
    return `${item.entityType.replaceAll('_', ' ')} · ${item.entityId}`;
  };

  return (
    <section className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h1 className="text-2xl font-bold">Compliance Register</h1><p className="text-sm text-gray-600">Operational obligations with due dates, evidence and remediation status. Trust-accounting and financial compliance remain out of scope.</p></div><button type="button" onClick={() => { setError(''); setShowCreate(true); }} className="rounded-lg bg-gray-950 px-4 py-2 text-sm font-semibold text-white">New obligation</button></header>
      {error && <div className="flex justify-between gap-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800"><span>{error}</span><button type="button" className="font-semibold underline" onClick={() => setError('')}>Dismiss</button></div>}
      <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl border bg-white p-4"><div className="text-xs uppercase text-gray-500">Open</div><div className="text-2xl font-bold">{items.filter((item) => item.status === 'open').length}</div></div><div className="rounded-xl border bg-white p-4"><div className="text-xs uppercase text-gray-500">Overdue</div><div className="text-2xl font-bold text-rose-700">{overdue}</div></div><div className="rounded-xl border bg-white p-4"><div className="text-xs uppercase text-gray-500">Satisfied</div><div className="text-2xl font-bold text-emerald-700">{items.filter((item) => item.status === 'satisfied').length}</div></div></div>
      <div className="grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-[1fr_auto]"><label className="text-xs font-semibold text-gray-600">Search obligations<input value={search} onChange={(event) => setSearch(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-normal" placeholder="Obligation, property or entity" /></label><div className="flex items-end gap-2">{(['all', 'open', 'overdue', 'satisfied'] as const).map((value) => <button key={value} className={`rounded px-3 py-2 text-sm ${filter === value ? 'bg-gray-950 text-white' : 'border bg-white'}`} onClick={() => setFilter(value)}>{value}</button>)}</div></div>

      {loading ? <div className="rounded-xl border bg-white p-6 text-sm text-gray-500">Loading compliance obligations…</div> : rows.length ? <div className="overflow-x-auto rounded-xl border bg-white"><table className="min-w-full text-left text-sm"><thead className="bg-gray-50"><tr><th className="p-3">Obligation</th><th className="p-3">Entity</th><th className="p-3">Due</th><th className="p-3">Evidence</th><th className="p-3">Status</th><th className="p-3">Actions</th></tr></thead><tbody>{rows.map((item) => <tr key={item.id} className="border-t align-top"><td className="p-3 font-medium">{item.label}</td><td className="p-3 text-gray-600">{entityLabel(item)}</td><td className="p-3">{item.dueAt ? new Date(item.dueAt).toLocaleDateString() : 'No date'}</td><td className="p-3 text-gray-600">{item.evidenceIds.length ? `${item.evidenceIds.length} reference(s)` : 'None'}</td><td className="p-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${item.effectiveStatus === 'overdue' ? 'bg-rose-50 text-rose-700' : item.effectiveStatus === 'satisfied' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{item.effectiveStatus}</span></td><td className="p-3"><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => void assess(item)} className="rounded border px-2 py-1 text-xs">Assess entity</button>{item.status === 'open' && <button type="button" disabled={busy} onClick={() => void markSatisfied(item)} className="rounded bg-gray-950 px-2 py-1 text-xs text-white">Mark satisfied</button>}</div></td></tr>)}</tbody></table></div> : <div className="rounded-xl border border-dashed bg-white p-8 text-center"><div className="font-semibold">No compliance obligations match this view</div><p className="mt-1 text-sm text-gray-500">Create an operational obligation, add a due date and capture evidence references as it is remediated.</p></div>}

      <div className="rounded-xl border bg-white p-4"><label className="text-xs font-semibold text-gray-600">Evidence references for next completion<input value={evidence} onChange={(event) => setEvidence(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-normal" placeholder="Evidence IDs, comma separated" /></label><p className="mt-1 text-xs text-gray-500">Use immutable document/evidence identifiers. This register does not store financial evidence or money movements.</p></div>

      {assessment && <div className="rounded-xl border bg-white p-4"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">Compliance assessment</h2><p className="text-sm text-gray-500">{assessment.entityType} · {assessment.entityId} · {new Date(assessment.evaluatedAt).toLocaleString()}</p></div><button type="button" onClick={() => setAssessment(null)} className="rounded border px-2 py-1 text-xs">Close</button></div><div className="mt-3 grid gap-3 sm:grid-cols-3"><div className="rounded bg-gray-50 p-3"><div className="text-xs text-gray-500">Open</div><div className="text-xl font-bold">{assessment.open}</div></div><div className="rounded bg-gray-50 p-3"><div className="text-xs text-gray-500">Overdue</div><div className="text-xl font-bold">{assessment.overdue}</div></div><div className="rounded bg-gray-50 p-3"><div className="text-xs text-gray-500">Critical</div><div className="text-xl font-bold">{assessment.critical}</div></div></div></div>}

      {showCreate && <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="compliance-create-title"><div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl"><h2 id="compliance-create-title" className="text-lg font-bold">New compliance obligation</h2><div className="mt-4 space-y-3"><label className="block text-sm font-medium">Property<select value={propertyId} onChange={(event) => setPropertyId(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2"><option value="">Select property</option>{properties.map((property) => <option key={property.id} value={property.id}>{property.address}, {property.suburb}</option>)}</select></label><label className="block text-sm font-medium">Obligation<label className="sr-only" htmlFor="compliance-label">Obligation label</label><input id="compliance-label" value={label} onChange={(event) => setLabel(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" placeholder="e.g. Smoke alarm evidence due" /></label><label className="block text-sm font-medium">Rule/version reference<input value={ruleVersionId} onChange={(event) => setRuleVersionId(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" /></label><label className="block text-sm font-medium">Due date<input type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" /></label></div><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setShowCreate(false)} className="rounded-lg border px-4 py-2 text-sm font-semibold">Cancel</button><button type="button" disabled={busy || !propertyId || !label.trim()} onClick={() => void create()} className="rounded-lg bg-gray-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy ? 'Creating…' : 'Create obligation'}</button></div></div></div>}
    </section>
  );
};
export default CompliancePage;
