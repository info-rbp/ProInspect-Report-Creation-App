import React, { useEffect, useState } from 'react';
import { Copy, ExternalLink, RefreshCw } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import type { Tenant } from '../../types/platform';
import { getTenant, listManagedTenancies, listTenancyParticipants, type ManagedTenancy } from '../../services/platform/tenantDirectoryService';
import { generateTenantPortalGrant } from '../../services/platform/tenantPortalService';

const TenantPortalAccessPage: React.FC = () => {
  const { tenantId } = useParams<{ tenantId: string }>();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [tenancy, setTenancy] = useState<ManagedTenancy | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  const load = async () => {
    if (!tenantId) return;
    setLoading(true); setError(null);
    try {
      const [person, tenancies, participants] = await Promise.all([getTenant(tenantId), listManagedTenancies(), listTenancyParticipants()]);
      const links = participants.filter((item) => item.tenantId === tenantId && item.status !== 'ended');
      const linked = links.map((item) => tenancies.find((candidate) => candidate.id === item.tenancyId)).filter(Boolean) as ManagedTenancy[];
      setTenant(person);
      setTenancy(linked.find((item) => (item.lifecycleStatus || item.status) === 'active') || linked[0] || null);
    } catch (err) { setError(err instanceof Error ? err.message : 'Portal access context could not be loaded.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [tenantId]);

  const generate = async () => {
    if (!tenant || !tenancy || !tenant.email) return;
    setBusy(true); setError(null);
    try {
      const grant = await generateTenantPortalGrant(tenant.id, tenancy.id, tenant.email, 168);
      setUrl(`${window.location.origin}${grant.accessUrl}`);
      setExpiresAt(grant.expiresAt);
    } catch (err) { setError(err instanceof Error ? err.message : 'Tenant portal access could not be generated.'); }
    finally { setBusy(false); }
  };

  if (loading) return <div className="flex h-64 items-center justify-center text-sm text-slate-500"><RefreshCw className="mr-2 animate-spin" size={16} /> Loading portal access...</div>;
  if (!tenant) return <div className="p-6 text-sm text-slate-500">Tenant not found.</div>;

  return <div className="space-y-5 p-6">
    <Link to={`/app/admin/tenants/${tenant.id}`} className="text-xs font-semibold text-blue-600">← Back to {tenant.fullName}</Link>
    <section className="max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="text-[11px] font-bold uppercase text-blue-600">Tenant Portal Access</div>
      <h1 className="mt-1 text-2xl font-black">{tenant.fullName}</h1>
      <p className="mt-2 text-sm text-slate-500">Generate a tenancy-scoped, time-limited portal link. The token exposes only this tenant's linked tenancy context, actions, maintenance, documents and messages.</p>
      {error && <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
      <div className="mt-5 space-y-3 rounded-xl bg-slate-50 p-4 text-sm">
        <div><span className="text-slate-500">Recipient:</span> <b>{tenant.email || 'No email recorded'}</b></div>
        <div><span className="text-slate-500">Tenancy:</span> <b>{tenancy?.id || 'No active tenancy'}</b></div>
        <div><span className="text-slate-500">Default expiry:</span> <b>7 days</b></div>
      </div>
      <button disabled={busy || !tenant.email || !tenancy} onClick={() => void generate()} className="mt-5 rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50">{busy ? 'Generating...' : 'Generate Portal Link'}</button>
      {!tenant.email && <p className="mt-2 text-xs text-amber-700">A verified tenant email is required before portal access can be issued.</p>}
      {url && <div className="mt-5 rounded-xl border border-blue-200 bg-blue-50 p-4"><div className="text-xs font-bold text-blue-900">Portal link generated</div><div className="mt-2 flex items-center gap-2 rounded-lg bg-white p-3 font-mono text-xs"><span className="min-w-0 flex-1 break-all">{url}</span><button onClick={() => void navigator.clipboard.writeText(url)} title="Copy link"><Copy size={15} /></button><a href={url} target="_blank" rel="noreferrer" title="Open portal"><ExternalLink size={15} /></a></div><p className="mt-2 text-[11px] text-blue-700">Expires {expiresAt ? new Date(expiresAt).toLocaleString() : 'according to the grant policy'}.</p></div>}
    </section>
  </div>;
};

export default TenantPortalAccessPage;
