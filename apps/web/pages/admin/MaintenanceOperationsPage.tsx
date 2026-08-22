import React, { useEffect, useMemo, useState } from 'react';
import { BadgeDollarSign, CalendarClock, Plus, RefreshCw, Search, Settings2, Wrench, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import type {
  MaintenanceCandidate,
  MaintenanceEstimate,
  MaintenanceItem,
  MaintenanceQuote,
  MaintenanceQuoteVersion,
  MaintenanceWorkOrder,
  PreventiveMaintenanceSchedule,
  PriceBook,
  PropertyRecord,
} from '../../types/platform';
import MaintenanceCandidatesPanel from '../../components/maintenance/MaintenanceCandidatesPanel';
import MaintenanceOperationsMetrics from '../../components/maintenance/MaintenanceOperationsMetrics';
import MaintenanceQuotesPanel from '../../components/maintenance/MaintenanceQuotesPanel';
import { createMaintenanceItem, listMaintenanceCandidates, listMaintenanceItems } from '../../services/platform/maintenanceService';
import {
  generateMaintenanceEstimate,
  getMaintenanceOperationsOverview,
  listMaintenanceEstimates,
  listMaintenanceQuoteVersions,
  listMaintenanceQuotes,
  listMaintenanceWorkOrders,
  listPreventiveMaintenanceSchedules,
  listPriceBooks,
  runMaintenanceAutomation,
  type MaintenanceOperationsOverview,
} from '../../services/platform/maintenanceCommercialService';
import { listProperties } from '../../services/platform/propertyService';

const TABS = [
  ['items', 'Maintenance Items'],
  ['candidates', 'Triage'],
  ['pricing', 'Estimates'],
  ['quotes', 'Quotes & Approval'],
  ['work', 'Work Orders'],
  ['preventive', 'Preventive'],
] as const;
type Tab = (typeof TABS)[number][0];

function label(value?: string): string {
  return value ? value.replaceAll('_', ' ').replace(/\b\w/gu, (character) => character.toUpperCase()) : 'Not set';
}
function money(value?: number, currency = 'AUD'): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(value || 0);
}
function badgeClass(value?: string): string {
  if (['accepted', 'approved', 'verified', 'closed', 'complete'].includes(value || '')) return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (['urgent', 'overdue', 'failed', 'declined', 'cancelled'].includes(value || '')) return 'border-rose-200 bg-rose-50 text-rose-700';
  if (['high', 'review_required', 'pending', 'at_risk'].includes(value || '')) return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-slate-200 bg-slate-50 text-slate-700';
}
const Badge: React.FC<{ value?: string }> = ({ value }) => <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${badgeClass(value)}`}>{label(value)}</span>;

const MaintenanceOperationsPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('items');
  const [overview, setOverview] = useState<MaintenanceOperationsOverview | null>(null);
  const [items, setItems] = useState<MaintenanceItem[]>([]);
  const [candidates, setCandidates] = useState<MaintenanceCandidate[]>([]);
  const [estimates, setEstimates] = useState<MaintenanceEstimate[]>([]);
  const [quotes, setQuotes] = useState<MaintenanceQuote[]>([]);
  const [quoteVersions, setQuoteVersions] = useState<MaintenanceQuoteVersion[]>([]);
  const [workOrders, setWorkOrders] = useState<MaintenanceWorkOrder[]>([]);
  const [preventive, setPreventive] = useState<PreventiveMaintenanceSchedule[]>([]);
  const [priceBooks, setPriceBooks] = useState<PriceBook[]>([]);
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newItem, setNewItem] = useState({ propertyId: '', title: '', description: '', category: 'General Maintenance', priority: 'routine' });

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const [nextOverview, nextItems, nextCandidates, nextEstimates, nextQuotes, nextVersions, nextWorkOrders, nextPreventive, nextPriceBooks, nextProperties] = await Promise.all([
        getMaintenanceOperationsOverview(), listMaintenanceItems(), listMaintenanceCandidates(), listMaintenanceEstimates(), listMaintenanceQuotes(), listMaintenanceQuoteVersions(), listMaintenanceWorkOrders(), listPreventiveMaintenanceSchedules(), listPriceBooks(), listProperties(),
      ]);
      setOverview(nextOverview); setItems(nextItems); setCandidates(nextCandidates); setEstimates(nextEstimates); setQuotes(nextQuotes); setQuoteVersions(nextVersions); setWorkOrders(nextWorkOrders); setPreventive(nextPreventive); setPriceBooks(nextPriceBooks); setProperties(nextProperties);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Maintenance operations could not be loaded.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const propertyMap = useMemo(() => new Map(properties.map((property) => [property.id, property])), [properties]);
  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) => {
      const property = propertyMap.get(item.propertyId);
      return [item.title, item.description, item.category, item.issueType, property?.address, property?.suburb].filter(Boolean).join(' ').toLowerCase().includes(query);
    });
  }, [items, propertyMap, search]);
  const estimateByItem = useMemo(() => new Map(estimates.map((estimate) => [estimate.maintenanceItemId, estimate])), [estimates]);

  const runAutomation = async () => {
    setBusy(true); setError(null);
    try { await runMaintenanceAutomation(); await load(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Maintenance automation failed.'); }
    finally { setBusy(false); }
  };
  const generate = async (item: MaintenanceItem) => {
    setBusy(true); setError(null);
    try { await generateMaintenanceEstimate(item, { preferredPriceBookId: priceBooks[0]?.id }); await load(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Estimate could not be generated.'); }
    finally { setBusy(false); }
  };
  const createItem = async () => {
    if (!newItem.propertyId || !newItem.title.trim()) return;
    setBusy(true); setError(null);
    try {
      await createMaintenanceItem({
        propertyId: newItem.propertyId,
        title: newItem.title.trim(),
        description: newItem.description.trim() || newItem.title.trim(),
        category: newItem.category as MaintenanceItem['category'],
        priority: newItem.priority as MaintenanceItem['priority'],
        status: 'triage_required',
        source: 'manual',
      });
      setShowCreate(false); setNewItem({ propertyId: '', title: '', description: '', category: 'General Maintenance', priority: 'routine' }); await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Maintenance item could not be created.'); }
    finally { setBusy(false); }
  };

  if (loading) return <div className="flex h-64 items-center justify-center text-sm text-slate-500"><RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Loading maintenance operations...</div>;

  return <div className="space-y-6 pb-16">
    <header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between"><div><h1 className="text-3xl font-black text-slate-950">Maintenance Operations</h1><p className="mt-1 text-sm text-slate-500">Convert inspection evidence into scoped work, commercial approval, contractor execution and completion verification. Financial settlement remains in the connected PMS or accounting system.</p></div><div className="flex flex-wrap gap-2"><button disabled={busy} onClick={() => void runAutomation()} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold disabled:opacity-50"><RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> Run Automation</button><Link to="/app/admin/maintenance/configuration" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold"><Settings2 size={14} /> Pricing & Integrations</Link><button onClick={() => setShowCreate(true)} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-xs font-semibold text-white"><Plus size={14} /> New Item</button></div></header>
    {error && <div className="flex items-start justify-between rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"><span>{error}</span><button onClick={() => setError(null)}><XCircle size={16} /></button></div>}
    <MaintenanceOperationsMetrics overview={overview} />
    <nav className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">{TABS.map(([id,title]) => <button key={id} onClick={() => setTab(id)} className={`whitespace-nowrap rounded-lg px-4 py-2 text-xs font-semibold ${tab === id ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{title}</button>)}</nav>

    {tab === 'items' && <div className="space-y-4"><div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search maintenance..." className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-9 pr-3 text-sm" /></div><div className="overflow-hidden rounded-2xl border border-slate-200 bg-white"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-4 py-3">Issue</th><th className="px-4 py-3">Property</th><th className="px-4 py-3">Priority</th><th className="px-4 py-3">Status</th><th className="px-4 py-3"></th></tr></thead><tbody className="divide-y divide-slate-100">{filteredItems.map((item) => <tr key={item.id}><td className="px-4 py-3"><div className="font-semibold">{item.title}</div><div className="max-w-md truncate text-slate-400">{item.description}</div></td><td className="px-4 py-3">{propertyMap.get(item.propertyId)?.address || item.propertyId}</td><td className="px-4 py-3"><Badge value={item.priority} /></td><td className="px-4 py-3"><Badge value={item.status} /></td><td className="px-4 py-3 text-right"><Link to={`/app/admin/maintenance/${encodeURIComponent(item.id)}`} className="font-semibold text-blue-600">Open</Link></td></tr>)}</tbody></table></div></div>}
    {tab === 'candidates' && <MaintenanceCandidatesPanel candidates={candidates} onChanged={load} />}
    {tab === 'pricing' && <div className="grid gap-3 lg:grid-cols-2">{items.map((item) => { const estimate = estimateByItem.get(item.id); return <section key={item.id} className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-start justify-between gap-3"><div><div className="font-bold">{item.title}</div><div className="mt-1 text-xs text-slate-500">{propertyMap.get(item.propertyId)?.address || item.propertyId}</div></div><Badge value={estimate?.status || item.pricingStatus || 'not_started'} /></div>{estimate ? <div className="mt-4 grid grid-cols-2 gap-3 text-xs"><div><b>Confidence</b><br />{Math.round(estimate.confidence * 100)}%</div><div><b>Recommended total</b><br />{money(estimate.options.find((option) => option.id === estimate.selectedOptionId)?.total || estimate.options[0]?.total, estimate.currency)}</div></div> : <button disabled={busy} onClick={() => void generate(item)} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"><BadgeDollarSign size={14} /> Generate estimate</button>}</section>; })}</div>}
    {tab === 'quotes' && <MaintenanceQuotesPanel quotes={quotes} quoteVersions={quoteVersions} items={items} onChanged={load} />}
    {tab === 'work' && <div className="grid gap-3 lg:grid-cols-2">{workOrders.map((order) => <section key={order.id} className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between gap-3"><div className="font-bold">{order.workOrderNumber}</div><Badge value={order.status} /></div><p className="mt-2 text-sm text-slate-600">{order.scope}</p><div className="mt-3 text-xs text-slate-500">Approved operational amount {money(order.approvedAmount, order.currency)} · supplier {order.externalContactId || 'not assigned'}</div></section>)}{!workOrders.length && <div className="rounded-2xl border border-dashed border-slate-300 p-12 text-center text-sm text-slate-500">No work orders yet.</div>}</div>}
    {tab === 'preventive' && <div className="space-y-3">{preventive.map((schedule) => <section key={schedule.id} className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><CalendarClock size={16} /><b>{String((schedule as unknown as Record<string, unknown>).name || (schedule as unknown as Record<string, unknown>).title || 'Preventive maintenance')}</b></div><Badge value={String((schedule as unknown as Record<string, unknown>).status || 'active')} /></div><div className="mt-2 text-xs text-slate-500">Property {String((schedule as unknown as Record<string, unknown>).propertyId || 'portfolio')} · next due {String((schedule as unknown as Record<string, unknown>).nextDueAt || (schedule as unknown as Record<string, unknown>).nextDueDate || 'not scheduled')}</div></section>)}{!preventive.length && <div className="rounded-2xl border border-dashed border-slate-300 p-12 text-center text-sm text-slate-500">No preventive schedules have been configured.</div>}</div>}

    {showCreate && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4"><div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl"><div className="flex items-center gap-2"><Wrench size={18} /><h2 className="text-lg font-black">New maintenance item</h2></div><div className="mt-4 grid gap-3"><select value={newItem.propertyId} onChange={(e) => setNewItem((current) => ({ ...current, propertyId: e.target.value }))} className="rounded-xl border border-slate-200 px-3 py-2 text-sm"><option value="">Select property</option>{properties.map((property) => <option key={property.id} value={property.id}>{property.address}</option>)}</select><input value={newItem.title} onChange={(e) => setNewItem((current) => ({ ...current, title: e.target.value }))} placeholder="Issue title" className="rounded-xl border border-slate-200 px-3 py-2 text-sm" /><textarea value={newItem.description} onChange={(e) => setNewItem((current) => ({ ...current, description: e.target.value }))} placeholder="Description" className="min-h-24 rounded-xl border border-slate-200 px-3 py-2 text-sm" /><div className="grid gap-3 sm:grid-cols-2"><input value={newItem.category} onChange={(e) => setNewItem((current) => ({ ...current, category: e.target.value }))} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" /><select value={newItem.priority} onChange={(e) => setNewItem((current) => ({ ...current, priority: e.target.value }))} className="rounded-xl border border-slate-200 px-3 py-2 text-sm"><option value="monitor">Monitor</option><option value="routine">Routine</option><option value="high">High</option><option value="urgent">Urgent</option></select></div></div><div className="mt-5 flex justify-end gap-2"><button onClick={() => setShowCreate(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm">Cancel</button><button disabled={busy || !newItem.propertyId || !newItem.title.trim()} onClick={() => void createItem()} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Create</button></div></div></div>}
  </div>;
};

export default MaintenanceOperationsPage;
