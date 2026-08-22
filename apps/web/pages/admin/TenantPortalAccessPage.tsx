import React, { useEffect, useState } from 'react';
import { Copy, ExternalLink, RefreshCw, Send, ShieldOff } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import type { Tenant } from '../../types/platform';
import { getTenantWorkspace, type ManagedTenancy } from '../../services/platform/tenantDirectoryService';
import {
  generateTenantPortalGrant,
  listTenantPortalGrants,
  replaceTenantPortalGrant,
  revokeTenantPortalGrant,
  type TenantPortalGrantSummary,
} from '../../services/platform/tenantPortalService';

function status(grant: TenantPortalGrantSummary): 'active' | 'expired' | 'revoked' {
  if (grant.revokedAt) return 'revoked';
  return new Date(grant.expiresAt).getTime() <= Date.now() ? 'expired' : 'active';
}

const TenantPortalAccessPage: React.FC = () => {
  const { tenantId } = useParams<{ tenantId: string }>();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [tenancy, setTenancy] = useState<ManagedTenancy | null>(null);
  const [grants, setGrants] = useState<TenantPortalGrantSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  const load = async () => {
    if (!tenantId) return;
    setLoading(true); setError(null);
    try {
      const workspace = await getTenantWorkspace(tenantId);
      const activeTenancy = workspace.currentTenancy || workspace.linkedTenancies.find((item) => !['ended', 'cancelled'].includes(item.lifecycleStatus || '')) || workspace.linkedTenancies[0] || null;
      setTenant(workspace.tenant); setTenancy(activeTenancy);
      setGrants(await listTenantPortalGrants(tenantId, activeTenancy?.id));
    } catch (err) { setError(err instanceof Error ? err.message : 'Portal access context could not be loaded.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [tenantId]);

  const generate = async (sendInvitation: boolean) => {
    if (!tenant || !tenancy || !tenant.email) return;
    setBusyId(sendInvitation ? 'send' : 'generate'); setError(null); setNotice(null);
    try {
      const grant = await generateTenantPortalGrant(tenant.id, tenancy.id, tenant.email, 168, sendInvitation);
      setUrl(`${window.location.origin}${grant.accessUrl}`); setExpiresAt(grant.expiresAt);
      setNotice(sendInvitation ? 'Portal link generated and invitation queued for email delivery.' : 'Portal link generated. Copy it now; the raw token is not stored by ProInspect.');
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Tenant portal access could not be generated.'); }
    finally { setBusyId(null); }
  };

  const revoke = async (grantId: string) => {
    setBusyId(grantId); setError(null); setNotice(null);
    try { await revokeTenantPortalGrant(grantId); await load(); setNotice('Portal grant revoked.'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Portal grant could not be revoked.'); }
    finally { setBusyId(null); }
  };

  const replace = async (grantId: string) => {
    setBusyId(grantId); setError(null); setNotice(null);
    try {
      const grant = await replaceTenantPortalGrant(grantId, 168);
      setUrl(`${window.location.origin}${grant.accessUrl}`); setExpiresAt(grant.expiresAt);
      await load(); setNotice('Previous grant revoked. Replacement link generated and invitation queued.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Portal grant could not be replaced.'); }
    finally { setBusyId(null); }
  };

  if (loading) return <div className="flex h-64 items-center justify-center text-sm text-slate-500"><RefreshCw className="mr-2 animate-spin" size={16} /> Loading portal access...</div>;
  if (!tenant) return <div className="p-6 text-sm text-slate-500">Tenant not found.</div>;

  return <div className="space-y-5 p-6">
    <Link to={`/app/admin/tenants/${tenant.id}`} className="text-xs font-semibold text-blue-600">← Back to {tenant.fullName}</Link>
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="text-[11px] font-bold uppercase text-blue-600">Tenant Portal Access</div><h1 className="mt-1 text-2xl font-black">{tenant.fullName}</h1><p className="mt-2 max-w-3xl text-sm text-slate-500">Issue, replace and revoke tenancy-scoped portal access. Tokens are hashed at rest; a replacement creates a new token rather than attempting to recover an old one.</p>
      {error && <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
      {notice && <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}
      <div className="mt-5 grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-3"><div><span className="text-slate-500">Verified recipient</span><div className="font-bold">{tenant.email || 'No email recorded'}</div></div><div><span className="text-slate-500">Tenancy</span><div className="font-bold">{tenancy ? `${tenancy.leaseStartDate || 'Start not set'} – ${tenancy.leaseEndDate || 'Ongoing'}` : 'No active tenancy'}</div></div><div><span className="text-slate-500">Default expiry</span><div className="font-bold">7 days</div></div></div>
      <div className="mt-5 flex flex-wrap gap-2"><button disabled={Boolean(busyId) || !tenant.email || !tenancy} onClick={() => void generate(false)} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold disabled:opacity-50">{busyId === 'generate' ? 'Generating...' : 'Generate Link Only'}</button><button disabled={Boolean(busyId) || !tenant.email || !tenancy} onClick={() => void generate(true)} className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50"><Send size={14} /> {busyId === 'send' ? 'Sending...' : 'Generate & Send Email'}</button></div>
      {!tenant.email && <p className="mt-2 text-xs text-amber-700">A verified canonical tenant email is required. The backend also enforces this rule.</p>}
      {url && <div className="mt-5 rounded-xl border border-blue-200 bg-blue-50 p-4"><div className="text-xs font-bold text-blue-900">New portal link</div><div className="mt-2 flex items-center gap-2 rounded-lg bg-white p-3 font-mono text-xs"><span className="min-w-0 flex-1 break-all">{url}</span><button onClick={() => void navigator.clipboard.writeText(url)} title="Copy link"><Copy size={15} /></button><a href={url} target="_blank" rel="noreferrer" title="Open portal"><ExternalLink size={15} /></a></div><p className="mt-2 text-[11px] text-blue-700">Expires {expiresAt ? new Date(expiresAt).toLocaleString() : 'according to the grant policy'}.</p></div>}
    </section>

    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex items-center justify-between gap-3"><div><h2 className="font-black">Portal Grant History</h2><p className="mt-1 text-xs text-slate-500">Active, expired and revoked tenancy-scoped access grants.</p></div><button onClick={() => void load()} className="rounded-lg border border-slate-200 p-2"><RefreshCw size={15} /></button></div>{grants.length === 0 ? <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-7 text-center text-sm text-slate-500">No portal grants have been issued for this tenant.</div> : <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr><th className="px-3 py-2">Recipient</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Expires</th><th className="px-3 py-2">Last Access</th><th className="px-3 py-2 text-right">Controls</th></tr></thead><tbody className="divide-y divide-slate-100">{grants.map((grant) => { const grantStatus = status(grant); return <tr key={grant.id}><td className="px-3 py-3 font-semibold">{grant.recipientEmail}</td><td className="px-3 py-3"><span className={`rounded-lg px-2 py-1 font-bold uppercase ${grantStatus === 'active' ? 'bg-emerald-50 text-emerald-700' : grantStatus === 'revoked' ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>{grantStatus}</span></td><td className="px-3 py-3">{new Date(grant.expiresAt).toLocaleString()}</td><td className="px-3 py-3">{grant.lastAccessedAt ? new Date(grant.lastAccessedAt).toLocaleString() : 'Never'}</td><td className="px-3 py-3"><div className="flex justify-end gap-2">{grantStatus === 'active' && <button disabled={Boolean(busyId)} onClick={() => void revoke(grant.id)} className="flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 font-semibold text-rose-700"><ShieldOff size={12} /> Revoke</button>}<button disabled={Boolean(busyId)} onClick={() => void replace(grant.id)} className="rounded-lg border border-slate-200 px-2 py-1 font-semibold">Replace & Send</button></div></td></tr>; })}</tbody></table></div>}</section>
  </div>;
};

export default TenantPortalAccessPage;
