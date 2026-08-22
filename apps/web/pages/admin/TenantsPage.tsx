import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Plus, RefreshCw, Search, Users } from 'lucide-react';
import type { PropertyRecord } from '../../types/platform';
import { useAuth } from '../../contexts/AuthContext';
import { listProperties } from '../../services/platform/propertyService';
import {
  createTenantWithTenancy,
  getTenantOverview,
  migrateLegacyTenancies,
  type TenantOverview,
} from '../../services/platform/tenantDirectoryService';

type Filter = 'all' | 'active' | 'upcoming' | 'vacating' | 'former' | 'attention';

function formatDate(value?: string): string {
  if (!value) return 'Not set';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}

const EMPTY_STATS: TenantOverview['stats'] = {
  activeTenants: 0,
  activeTenancies: 0,
  upcoming: 0,
  vacating: 0,
  awaitingTenant: 0,
  openMaintenance: 0,
};

const TenantsPage: React.FC = () => {
  const { hasRole } = useAuth();
  const canManage = hasRole('super_admin', 'proinspect_admin', 'operations');
  const [overview, setOverview] = useState<TenantOverview>({ rows: [], stats: EMPTY_STATS });
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [leaseType, setLeaseType] = useState<'fixed' | 'periodic'>('fixed');

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const [tenantOverview, propertyList] = await Promise.all([getTenantOverview(), canManage ? listProperties() : Promise.resolve([] as PropertyRecord[])]);
      setOverview(tenantOverview);
      setProperties(propertyList);
    } catch (err) { setError(err instanceof Error ? err.message : 'Tenant portfolio could not be loaded.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [canManage]);

  const filtered = useMemo(() => overview.rows.filter((row) => {
    const haystack = `${row.tenant.fullName} ${row.tenant.email || ''} ${row.tenant.phone || ''} ${row.property?.address || ''}`.toLowerCase();
    if (query && !haystack.includes(query.trim().toLowerCase())) return false;
    if (filter === 'active' && row.lifecycle !== 'active') return false;
    if (filter === 'upcoming' && row.lifecycle !== 'upcoming') return false;
    if (filter === 'vacating' && !['notice_given', 'vacating'].includes(row.lifecycle)) return false;
    if (filter === 'former' && !['ended', 'cancelled'].includes(row.lifecycle)) return false;
    if (filter === 'attention' && !row.overdue && row.openActionCount === 0 && row.openMaintenanceCount === 0) return false;
    return true;
  }), [filter, overview.rows, query]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManage || !name.trim() || !propertyId) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const created = await createTenantWithTenancy({
        fullName: name.trim(), email: email.trim() || undefined, phone: phone.trim() || undefined,
        propertyId, leaseStartDate: start || undefined, leaseEndDate: end || undefined, leaseType,
      });
      setShowCreate(false); setName(''); setEmail(''); setPhone(''); setPropertyId(''); setStart(''); setEnd(''); setLeaseType('fixed');
      window.location.assign(`/app/admin/tenants/${created.tenant.id}`);
    } catch (err) { setError(err instanceof Error ? err.message : 'Tenant and tenancy could not be created.'); }
    finally { setBusy(false); }
  };

  const migrate = async () => {
    if (!canManage) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await migrateLegacyTenancies();
      setNotice(`Import complete: ${result.tenantsCreated} tenant${result.tenantsCreated === 1 ? '' : 's'} and ${result.participantsCreated} tenancy link${result.participantsCreated === 1 ? '' : 's'} created${result.reviewRequired ? `; ${result.reviewRequired} record${result.reviewRequired === 1 ? '' : 's'} require review` : ''}.`);
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Existing tenancies could not be migrated.'); }
    finally { setBusy(false); }
  };

  const stats = overview.stats;
  return <div className="space-y-6 p-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-2xl font-black text-slate-950">Tenants</h1><p className="mt-1 text-sm text-slate-500">Tenant identities, tenancies, inspections, maintenance, actions, communications, documents and portal activity.</p></div>
      {canManage && <div className="flex flex-wrap gap-2"><button disabled={busy} onClick={() => void migrate()} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold disabled:opacity-50">Import Existing Tenancies</button><button onClick={() => setShowCreate(true)} className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-xs font-semibold text-white"><Plus size={15} /> Add Tenant & Tenancy</button></div>}
    </div>
    {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
    {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6"><Stat label="Active Tenants" value={stats.activeTenants} /><Stat label="Active Tenancies" value={stats.activeTenancies} /><Stat label="Upcoming" value={stats.upcoming} /><Stat label="Vacating" value={stats.vacating} /><Stat label="Awaiting Tenant" value={stats.awaitingTenant} /><Stat label="Open Maintenance" value={stats.openMaintenance} /></div>
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4"><div className="relative min-w-[260px] flex-1"><Search className="absolute left-3 top-2.5 text-slate-400" size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tenant, email, phone or property" className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm" /></div><div className="flex flex-wrap gap-1">{(['all', 'active', 'upcoming', 'vacating', 'former', 'attention'] as Filter[]).map((value) => <button key={value} onClick={() => setFilter(value)} className={`rounded-lg px-3 py-2 text-xs font-semibold capitalize ${filter === value ? 'bg-slate-950 text-white' : 'bg-slate-50 text-slate-600'}`}>{value.replace('_', ' ')}</button>)}</div><button onClick={() => void load()} className="rounded-lg border border-slate-200 p-2 text-slate-500"><RefreshCw size={16} /></button></div>
      {loading ? <div className="p-10 text-center text-sm text-slate-500">Loading tenant portfolio...</div> : filtered.length === 0 ? <div className="p-10 text-center"><Users className="mx-auto text-slate-300" size={32} /><div className="mt-2 text-sm font-semibold">No matching tenants</div><p className="mt-1 text-xs text-slate-500">The current filters do not match any canonical tenant records.</p></div> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-[11px] uppercase text-slate-500"><tr><th className="px-4 py-3">Tenant</th><th className="px-4 py-3">Property</th><th className="px-4 py-3">Tenancy</th><th className="px-4 py-3">Next Inspection</th><th className="px-4 py-3">Maintenance</th><th className="px-4 py-3">Actions</th><th className="px-4 py-3">Attention</th></tr></thead><tbody className="divide-y divide-slate-100">{filtered.map((row) => <tr key={row.tenant.id} className="hover:bg-slate-50"><td className="px-4 py-3"><Link to={`/app/admin/tenants/${row.tenant.id}`} className="font-bold text-slate-900 hover:text-blue-600">{row.tenant.fullName}</Link><div className="text-xs text-slate-500">{row.tenant.email || row.tenant.phone || 'No contact details'}</div></td><td className="px-4 py-3">{row.property ? <Link to={`/app/admin/properties/${row.property.id}`} className="text-blue-600">{row.property.address}</Link> : 'No current property'}</td><td className="px-4 py-3"><div className="capitalize">{row.lifecycle.replaceAll('_', ' ')}</div><div className="text-xs text-slate-500">{formatDate(row.tenancy?.leaseStartDate)} – {formatDate(row.tenancy?.leaseEndDate)}</div></td><td className="px-4 py-3 text-xs">{row.nextInspection ? formatDate(row.nextInspection.scheduledAt) : 'Not booked'}</td><td className="px-4 py-3">{row.openMaintenanceCount}</td><td className="px-4 py-3">{row.openActionCount}</td><td className="px-4 py-3">{row.overdue ? <span className="inline-flex items-center gap-1 rounded-lg bg-rose-50 px-2 py-1 text-xs font-bold text-rose-700"><AlertTriangle size={12} /> Overdue</span> : row.openActionCount || row.openMaintenanceCount ? <span className="rounded-lg bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700">Review</span> : <span className="text-xs text-slate-400">Clear</span>}</td></tr>)}</tbody></table></div>}
    </div>
    {showCreate && canManage && <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"><div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl"><h2 className="text-lg font-black">Add Tenant & Tenancy</h2><p className="mt-1 text-xs text-slate-500">Creates the canonical person, tenancy and primary participant as one workflow.</p><form onSubmit={create} className="mt-5 grid gap-3 sm:grid-cols-2"><Field label="Full name"><input required value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-slate-200 p-2 text-sm" /></Field><Field label="Email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-lg border border-slate-200 p-2 text-sm" /></Field><Field label="Phone"><input value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full rounded-lg border border-slate-200 p-2 text-sm" /></Field><Field label="Property"><select required value={propertyId} onChange={(e) => setPropertyId(e.target.value)} className="w-full rounded-lg border border-slate-200 p-2 text-sm"><option value="">Select property</option>{properties.map((property) => <option key={property.id} value={property.id}>{property.address}</option>)}</select></Field><Field label="Lease start"><input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="w-full rounded-lg border border-slate-200 p-2 text-sm" /></Field><Field label="Lease end"><input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="w-full rounded-lg border border-slate-200 p-2 text-sm" /></Field><Field label="Lease type"><select value={leaseType} onChange={(e) => setLeaseType(e.target.value as 'fixed' | 'periodic')} className="w-full rounded-lg border border-slate-200 p-2 text-sm"><option value="fixed">Fixed term</option><option value="periodic">Periodic</option></select></Field><div className="col-span-full mt-2 flex justify-end gap-2"><button type="button" onClick={() => setShowCreate(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold">Cancel</button><button disabled={busy} className="rounded-lg bg-slate-950 px-4 py-2 text-xs font-semibold text-white">{busy ? 'Creating...' : 'Create Tenant'}</button></div></form></div></div>}
  </div>;
};

const Stat: React.FC<{ label: string; value: number }> = ({ label, value }) => <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</div><div className="mt-1 text-2xl font-black text-slate-950">{value}</div></div>;
const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => <label className="text-xs font-semibold text-slate-700">{label}<div className="mt-1">{children}</div></label>;

export default TenantsPage;
