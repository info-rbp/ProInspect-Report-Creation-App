import React, { useEffect, useMemo, useState } from 'react';
import { Building2, CircleAlert, FileUp, Plus, Search, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ClientAccount, PropertyClientRelationship } from '../../types/platform';
import { listClientAccounts, listPropertyClientRelationships } from '../../services/platform/clientManagementService';

function label(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/gu, (character) => character.toUpperCase());
}

const ClientsPage: React.FC = () => {
  const [clients, setClients] = useState<ClientAccount[]>([]);
  const [relationships, setRelationships] = useState<PropertyClientRelationship[]>([]);
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void Promise.all([listClientAccounts(), listPropertyClientRelationships()])
      .then(([nextClients, nextRelationships]) => {
        setClients(nextClients);
        setRelationships(nextRelationships);
      })
      .catch((failure) => setError(failure instanceof Error ? failure.message : 'Clients could not be loaded.'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => clients.filter((client) => {
    const search = query.trim().toLowerCase();
    const matchesSearch = !search || [client.legalName, client.tradingName, client.generalEmail, client.abn, client.name]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(search));
    return matchesSearch && (type === 'all' || client.clientType === type) && (status === 'all' || client.status === status);
  }), [clients, query, status, type]);

  const currentRelationships = relationships.filter((relationship) => relationship.isCurrent);
  const counts = {
    total: clients.length,
    firms: clients.filter((client) => client.clientType === 'property_management_firm').length,
    landlords: clients.filter((client) => client.clientType === 'private_landlord').length,
    onboarding: clients.filter((client) => client.status === 'onboarding' || client.status === 'prospect').length,
    action: clients.filter((client) => (client.onboardingBlockers?.length || 0) > 0).length,
  };
  const metrics: Array<{ title: string; value: number; Icon: React.ComponentType<{ size?: number; className?: string }> }> = [
    { title: 'Total clients', value: counts.total, Icon: Building2 },
    { title: 'PM firms', value: counts.firms, Icon: Building2 },
    { title: 'Private landlords', value: counts.landlords, Icon: UserRound },
    { title: 'Onboarding', value: counts.onboarding, Icon: CircleAlert },
    { title: 'Action required', value: counts.action, Icon: CircleAlert },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Client accounts</div>
          <h1 className="mt-1 text-3xl font-black text-slate-950">Clients</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">Manage private landlords, Property Management Firms, owners, strata clients, commercial accounts and the people authorised to act for them.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/app/admin/clients/import" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"><FileUp size={16} /> Bulk import</Link>
          <Link to="/app/admin/clients/new" className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white"><Plus size={16} /> New client</Link>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {metrics.map(({ title, value, Icon }) => (
          <div key={title} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between"><span className="text-xs font-semibold text-slate-500">{title}</span><Icon size={16} className="text-slate-400" /></div>
            <div className="mt-3 text-2xl font-black text-slate-950">{value}</div>
          </div>
        ))}
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="grid gap-3 border-b border-slate-200 p-4 lg:grid-cols-[1fr_220px_200px]">
          <label className="relative"><Search size={16} className="absolute left-3 top-3 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, email or ABN" className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm" /></label>
          <select value={type} onChange={(event) => setType(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm"><option value="all">All client types</option><option value="property_management_firm">Property Management Firms</option><option value="private_landlord">Private Landlords</option><option value="commercial_property_owner">Commercial Owners</option><option value="strata_owners_corporation">Strata / Owners Corporations</option><option value="strata_manager">Strata Managers</option><option value="corporate_client">Corporate Clients</option><option value="other">Other</option></select>
          <select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm"><option value="all">All statuses</option>{['prospect','onboarding','active','on_hold','offboarding','inactive','archived'].map((value) => <option key={value} value={value}>{label(value)}</option>)}</select>
        </div>
        {error && <div className="border-b border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Client</th><th className="px-5 py-3">Type</th><th className="px-5 py-3">Contact</th><th className="px-5 py-3">Properties</th><th className="px-5 py-3">Billing</th><th className="px-5 py-3">Status</th><th className="px-5 py-3" /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {!loading && filtered.map((client) => {
                const propertyCount = new Set(currentRelationships.filter((relationship) => relationship.clientAccountId === client.id).map((relationship) => relationship.propertyId)).size;
                return <tr key={client.id} className="hover:bg-slate-50/70"><td className="px-5 py-4"><div className="font-bold text-slate-950">{client.tradingName || client.legalName || client.name}</div><div className="mt-1 text-xs text-slate-400">{client.legalName}{client.abn ? ` · ABN ${client.abn}` : ''}</div></td><td className="px-5 py-4 text-slate-600">{label(client.clientType || 'other')}</td><td className="px-5 py-4"><div>{client.generalEmail || client.email || 'No email'}</div><div className="text-xs text-slate-400">{client.mainPhone || client.phone || ''}</div></td><td className="px-5 py-4 font-semibold">{propertyCount}</td><td className="px-5 py-4 text-slate-600">{client.billingProfile?.method ? label(client.billingProfile.method) : 'Not configured'}</td><td className="px-5 py-4"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{label(client.status)}</span></td><td className="px-5 py-4 text-right"><Link to={`/app/admin/clients/${encodeURIComponent(client.id)}`} className="font-semibold text-blue-600 hover:text-blue-800">Open</Link></td></tr>;
              })}
              {loading && <tr><td colSpan={7} className="px-5 py-10 text-center text-slate-400">Loading Client Accounts…</td></tr>}
              {!loading && !filtered.length && <tr><td colSpan={7} className="px-5 py-10 text-center text-slate-400">No Clients match the current view.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export default ClientsPage;
