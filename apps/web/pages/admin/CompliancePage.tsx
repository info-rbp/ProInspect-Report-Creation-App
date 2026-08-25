import React, { useEffect, useMemo, useState } from 'react';
import type { ComplianceAssessment, ComplianceObligation, PropertyRecord } from '@pcr/domain';
import { assessCompliance, listComplianceObligations } from '../../services/platform/enhancementService';
import { listProperties } from '../../services/platform/propertyService';

function propertyLabel(property: PropertyRecord): string {
  return [property.address, property.suburb, property.state, property.postcode].filter(Boolean).join(', ');
}

const CompliancePage: React.FC = () => {
  const [items, setItems] = useState<ComplianceObligation[]>([]);
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [filter, setFilter] = useState<'all' | 'open' | 'overdue' | 'satisfied'>('all');
  const [selectedPropertyId, setSelectedPropertyId] = useState('');
  const [assessment, setAssessment] = useState<ComplianceAssessment | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [assessing, setAssessing] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [nextItems, nextProperties] = await Promise.all([listComplianceObligations(), listProperties()]);
      setItems(nextItems);
      setProperties(nextProperties);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const now = Date.now();
  const rows = useMemo(() => items.map((item) => ({ ...item, effectiveStatus: item.status === 'open' && item.dueAt && Date.parse(item.dueAt) < now ? 'overdue' : item.status })).filter((item) => filter === 'all' || item.effectiveStatus === filter).sort((a, b) => String(a.dueAt || '9999').localeCompare(String(b.dueAt || '9999'))), [filter, items, now]);
  const overdue = items.filter((item) => item.status === 'open' && item.dueAt && Date.parse(item.dueAt) < now).length;

  const runAssessment = async () => {
    if (!selectedPropertyId) return setError('Select a property to assess.');
    setAssessing(true);
    setError('');
    try {
      const result = await assessCompliance('property', selectedPropertyId);
      setAssessment(result);
      setItems(result.obligations);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setAssessing(false);
    }
  };

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-bold">Compliance Register</h1><p className="text-sm text-gray-600">Operational obligations with versioned rules and evidence, excluding trust-accounting and financial compliance.</p></div><button type="button" className="rounded border bg-white px-3 py-2 text-sm font-semibold" onClick={() => void load()}>Refresh</button></header>
      {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl border bg-white p-4"><div className="text-xs uppercase text-gray-500">Open</div><div className="text-2xl font-bold">{items.filter((item) => item.status === 'open').length}</div></div><div className="rounded-xl border bg-white p-4"><div className="text-xs uppercase text-gray-500">Overdue</div><div className="text-2xl font-bold">{overdue}</div></div><div className="rounded-xl border bg-white p-4"><div className="text-xs uppercase text-gray-500">Satisfied</div><div className="text-2xl font-bold">{items.filter((item) => item.status === 'satisfied').length}</div></div></div>

      <div className="rounded-xl border bg-white p-4">
        <h2 className="font-semibold text-gray-950">Assess a property</h2>
        <p className="mt-1 text-sm text-gray-500">Evaluate the selected property against the published compliance rules and refresh its obligation view.</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row"><select className="min-w-0 flex-1 rounded border px-3 py-2 text-sm" value={selectedPropertyId} onChange={(event) => { setSelectedPropertyId(event.target.value); setAssessment(null); }}><option value="">Select property</option>{properties.map((property) => <option key={property.id} value={property.id}>{propertyLabel(property)}</option>)}</select><button type="button" className="rounded bg-gray-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40" disabled={assessing || !selectedPropertyId} onClick={() => void runAssessment()}>{assessing ? 'Assessing...' : 'Run assessment'}</button></div>
        {assessment ? <div className="mt-3 grid gap-2 sm:grid-cols-3"><div className="rounded bg-gray-50 p-3 text-sm"><span className="block text-xs text-gray-500">Open</span><strong>{assessment.open}</strong></div><div className="rounded bg-gray-50 p-3 text-sm"><span className="block text-xs text-gray-500">Overdue</span><strong>{assessment.overdue}</strong></div><div className="rounded bg-gray-50 p-3 text-sm"><span className="block text-xs text-gray-500">Critical</span><strong>{assessment.critical}</strong></div></div> : null}
      </div>

      <div className="flex flex-wrap gap-2">{(['all', 'open', 'overdue', 'satisfied'] as const).map((value) => <button key={value} className={`rounded px-3 py-1.5 text-sm capitalize ${filter === value ? 'bg-gray-950 text-white' : 'border bg-white'}`} onClick={() => setFilter(value)}>{value}</button>)}</div>
      {loading ? <div className="rounded-xl border bg-white p-6 text-sm text-gray-500">Loading compliance obligations...</div> : rows.length === 0 ? <div className="rounded-xl border border-dashed bg-white p-8 text-center"><div className="font-semibold text-gray-900">No compliance obligations in this view</div><p className="mt-1 text-sm text-gray-500">Run a property assessment to evaluate published rules. If no rules apply, the correct result is an empty obligation set rather than an unexplained blank table.</p></div> : <div className="overflow-x-auto rounded-xl border bg-white"><table className="min-w-full text-left text-sm"><thead className="bg-gray-50"><tr><th className="p-3">Obligation</th><th className="p-3">Entity</th><th className="p-3">Evidence</th><th className="p-3">Due</th><th className="p-3">Status</th></tr></thead><tbody>{rows.map((item) => <tr key={item.id} className="border-t"><td className="p-3 font-medium">{item.label}</td><td className="p-3 text-gray-600">{item.entityType} · {item.entityId}</td><td className="p-3">{item.evidenceIds.length}</td><td className="p-3">{item.dueAt ? new Date(item.dueAt).toLocaleDateString('en-AU') : 'No date'}</td><td className="p-3 capitalize">{item.effectiveStatus.replaceAll('_', ' ')}</td></tr>)}</tbody></table></div>}
    </section>
  );
};
export default CompliancePage;
