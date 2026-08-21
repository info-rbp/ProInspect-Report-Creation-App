import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Plus, RefreshCw, Search, Users } from 'lucide-react';
import type { PropertyRecord, Tenant, TenancyParticipant } from '../../types/platform';
import { listProperties } from '../../services/platform/propertyService';
import { listInspectionJobs } from '../../services/platform/inspectionJobService';
import { listMaintenanceItems, listTenantInstructions } from '../../services/platform/maintenanceService';
import {
  createTenantWithTenancy,
  listManagedTenancies,
  listTenancyParticipants,
  listTenants,
  migrateLegacyTenancies,
  type ManagedTenancy,
} from '../../services/platform/tenantDirectoryService';

const TERMINAL_MAINTENANCE = new Set(['closed', 'dismissed', 'cancelled', 'duplicate', 'not_actionable']);
const TERMINAL_ACTIONS = new Set(['resolved', 'closed', 'cancelled', 'withdrawn']);

type Filter = 'all' | 'active' | 'upcoming' | 'vacating' | 'former' | 'attention';

function formatDate(value?: string): string {
  if (!value) return 'Not set';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}

const TenantsPage: React.FC = () => {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenancies, setTenancies] = useState<ManagedTenancy[]>([]);
  const [participants, setParticipants] = useState<TenancyParticipant[]>([]);
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [jobs, setJobs] = useState<Awaited<ReturnType<typeof listInspectionJobs>>>([]);
  const [maintenance, setMaintenance] = useState<Awaited<ReturnType<typeof listMaintenanceItems>>>([]);
  const [actions, setActions] = useState<Awaited<ReturnType<typeof listTenantInstructions>>>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [tenantList, tenancyList, participantList, propertyList, jobList, maintenanceList, actionList] = await Promise.all([
        listTenants(), listManagedTenancies(), listTenancyParticipants(), listProperties(), listInspectionJobs(), listMaintenanceItems(), listTenantInstructions(),
      ]);
      setTenants(tenantList);
      setTenancies(tenancyList);
      setParticipants(participantList);
      setProperties(propertyList);
      setJobs(jobList);
      setMaintenance(maintenanceList);
      setActions(actionList);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Tenant portfolio could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const rows = useMemo(() => tenants.map((tenant) => {
    const links = participants.filter((item) => item.tenantId === tenant.id);
    const linkedTenancies = links.map((item) => tenancies.find((candidate) => candidate.id === item.tenancyId)).filter(Boolean) as ManagedTenancy[];
    const tenancy = linkedTenancies.find((item) => (item.lifecycleStatus || item.status) === 'active') || linkedTenancies[0];
    const property = tenancy ? properties.find((item) => item.id === tenancy.propertyId) : undefined;
    const openActions = tenancy ? actions.filter((item) => item.tenancyId === tenancy.id && !TERMINAL_ACTIONS.has(item.status)) : [];
    const openMaintenance = tenancy ? maintenance.filter((item) => item.tenancyId === tenancy.id && !TERMINAL_MAINTENANCE.has(item.status)) : [];
    const nextJob = tenancy ? jobs.filter((item) => item.tenancyId === tenancy.id && item.scheduledAt && !['finalised', 'archived', 'cancelled'].includes(item.status)).sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)))[0] : undefined;
    const lifecycle = tenancy?.lifecycleStatus || (tenancy?.status === 'inactive' ? 'ended' : 'active');
    const overdue = openActions.some((item) => item.dueDate && new Date(item.dueDate).getTime() < Date.now());
    return { tenant, tenancy, property, openActions, openMaintenance, nextJob, lifecycle, overdue };
  }), [tenants, participants, tenancies, properties, actions, maintenance, jobs]);

  const filtered = rows.filter((row) => {
    const text = `${row.tenant.fullName} ${row.tenant.email || ''} ${row.tenant.phone || ''} ${row.property?.address || ''}`.toLowerCase();
    if (query && !text.includes(query.toLowerCase())) return false;
    if (filter === 'active' && row.lifecycle !== 'active') return false;
    if (filter === 'upcoming' && row.lifecycle !== 'upcoming') return false;
    if (filter === 'vacating' && !['notice_given', 'vacating'].includes(row.lifecycle)) return false;
    if (filter === 'former' && row.lifecycle !== 'ended') return false;
    if (filter === 'attention' && !row.overdue && row.openActions.length === 0 && row.openMaintenance.length === 0) return false;
    return true;
  });

  const stats = {
    activeTenants: rows.filter((row) => row.lifecycle === 'active').length,
    activeTenancies: tenancies.filter((item) => (item.lifecycleStatus || item.status) === 'active').length,
    upcoming: tenancies.filter((item) => item.lifecycleStatus === 'upcoming').length,
    vacating: tenancies.filter((item) => ['notice_given', 'vacating'].includes(item.lifecycleStatus || '')).length,
    awaiting: actions.filter((item) => ['issued', 'viewed', 'awaiting_action'].includes(item.status)).length,
    maintenance: maintenance.filter((item) => !TERMINAL_MAINTENANCE.has(item.status)).length,
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !propertyId) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createTenantWithTenancy({ fullName: name.trim(), email: email.trim() || undefined, phone: phone.trim() || undefined, propertyId, leaseStartDate: start || undefined, leaseEndDate: end || undefined });
      setShowCreate(false);
      setName(''); setEmail(''); setPhone(''); setPropertyId(''); setStart(''); setEnd('');
      await load();
      window.location.assign(`/app/admin/tenants/${created.tenant.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Tenant and tenancy could not be created.');
    } finally {
      setBusy(false);
    }
  };

  const migrate = async () => {
    setBusy(true);
    setError(null);
    try {
      await migrateLegacyTenancies(tenancies);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Existing tenancies could not be migrated.');
    } finally {
      setBusy(false);
    }
  };

  return <div className="space-y-6 p-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-2xl font-black text-slate-950">Tenants</h1><p className="mt-1 text-sm text-slate-500">Tenant identities, tenancies, inspections, maintenance, actions, communications and documents.</p></div>
      <div className="flex gap-2"><button disabled={busy} onClick={() => void migrate()} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold">Import Existing Tenancies</button><button onClick={() => setShowCreate(true)} className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-xs font-semibold text-white"><Plus size={15} /> Add Tenant & Tenancy</button></div>
    </div>
    {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
      <Stat label="Active Tenants" value={stats.activeTenants} /><Stat label="Active Tenancies" value={stats.activeTenancies} /><Stat label="Upcoming" value={stats.upcoming} /><Stat label="Vacating" value={stats.vacating} /><Stat label="Awaiting Tenant" value={stats.awaiting} /><Stat label="Open Maintenance" value={stats.maintenance} />
    </div>
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4">
        <div className="relative min-w-[260px] flex-1"><Search className="absolute left-3 top-2.5 text-slate-400" size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tenant, email, phone or property" className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm" /></div>
        <div className="flex flex-wrap gap-1">{(['all', 'active', 'upcoming', 'vacating', 'former', 'attention'] as Filter[]).map((value) => <button key={value} onClick={() => setFilter(value)} className={`rounded-lg px-3 py-2 text-xs font-semibold capitalize ${filter === value ? 'bg-slate-950 text-white' : 'bg-slate-50 text-slate-600'}`}>{value.replace('_', ' ')}</button>)}</div>
        <button onClick={() => void load()} className="rounded-lg border border-slate-200 p-2 text-slate-500"><RefreshCw size={16} /></button>
      </div>
      {loading ? <div className="p-10 text-center text-sm text-slate-500">Loading tenant portfolio...</div> : filtered.length === 0 ? <div className="p-10 text-center"><Users className="mx-auto text-slate-300" size={32} /><div className="mt-2 text-sm font-semibold">No matching tenants</div><p className="mt-1 text-xs text-slate-500">Create a tenant or import the canonical tenancies already attached to properties.</p></div> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-[11px] uppercase text-slate-500"><tr><th className="px-4 py-3">Tenant</th><th className="px-4 py-3">Property</th><th className="px-4 py-3">Tenancy</th><th className="px-4 py-3">Next Inspection</th><th className="px-4 py-3">Maintenance</th><th className="px-4 py-3">Actions</th><th className="px-4 py-3">Attention</th></tr></thead><tbody className="divide-y divide-slate-100">{filtered.map((row) => <tr key={row.tenant.id} className="hover:bg-slate-50"><td className="px-4 py-3"><Link to={`/app/admin/tenants/${row.tenant.id}`} className="font-bold text-slate-900 hover:text-blue-600">{row.tenant.fullName}</Link><div className="text-xs text-slate-500">{row.tenant.email || row.tenant.phone || 'No contact details'}</div></td><td className="px-4 py-3">{row.property ? <Link to={`/app/admin/properties/${row.property.id}`} className="text-blue-600">{row.property.address}</Link> : 'No current property'}</td><td className="px-4 py-3"><div className="capitalize">{row.lifecycle.replaceAll('_', ' ')}</div><div className="text-xs text-slate-500">{formatDate(row.tenancy?.leaseStartDate)} – {formatDate(row.tenancy?.leaseEndDate)}</div></td><td className="px-4 py-3 text-xs">{row.nextJob ? formatDate(row.nextJob.scheduledAt) : 'Not booked'}</td><td className="px-4 py-3">{row.openMaintenance.length}</td><td className="px-4 py-3">{row.openActions.length}</td><td className="px-4 py-3">{row.overdue ? <span className="inline-flex items-center gap-1 rounded-lg bg-rose-50 px-2 py-1 text-xs font-bold text-rose-700"><AlertTriangle size={12} /> Overdue</span> : row.openActions.length || row.openMaintenance.length ? <span className="rounded-lg bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700">Review</span> : <span className="text-xs text-slate-400">Clear</span>}</td></tr>)}</tbody></table></div>}
    </div>
    {showCreate && <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"><div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl"><h2 className="text-lg font-black">Add Tenant & Tenancy</h2><p className="mt-1 text-xs text-slate-500">Creates a canonical person record, tenancy and primary tenancy participant in one workflow.</p><form onSubmit={create} className="mt-5 grid gap-3 sm:grid-cols-2"><Field label="Full name"><input required value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-slate-200 p-2 text-sm" /></Field><Field label="Email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-lg border border-slate-200 p-2 text-sm" /></Field><Field label="Phone"><input value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full rounded-lg border border-slate-200 p-2 text-sm" /></Field><Field label="Property"><select required value={propertyId} onChange={(e) => setPropertyId(e.target.value)} className="w-full rounded-lg border border-slate-200 p-2 text-sm"><option value="">Select property</option>{properties.map((property) => <option key={property.id} value={property.id}>{property.address}</option>)}</select></Field><Field label="Lease start"><input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="w-full rounded-lg border border-slate-200 p-2 text-sm" /></Field><Field label="Lease end"><input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="w-full rounded-lg border border-slate-200 p-2 text-sm" /></Field><div className="col-span-full mt-2 flex justify-end gap-2"><button type="button" onClick={() => setShowCreate(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold">Cancel</button><button disabled={busy} className="rounded-lg bg-slate-950 px-4 py-2 text-xs font-semibold text-white">{busy ? 'Creating...' : 'Create Tenant'}</button></div></form></div></div>}
  </div>;
};

const Stat: React.FC<{ label: string; value: number }> = ({ label, value }) => <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</div><div className="mt-1 text-2xl font-black text-slate-950">{value}</div></div>;
const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => <label className="text-xs font-semibold text-slate-700">{label}<div className="mt-1">{children}</div></label>;

export default TenantsPage;
