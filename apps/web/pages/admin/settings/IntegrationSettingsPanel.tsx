import React, { useEffect, useState } from 'react';
import { AlertTriangle, CalendarDays, CheckCircle2, ExternalLink, RefreshCw, ShoppingBag, WalletCards } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../../contexts/AuthContext';
import type { IntegrationHealth, SettingsOverview } from '../../../types/platform';
import { getSettingsOverview } from '../../../services/platform/agencySettingsService';
import { apiRequest } from '../../../services/apiClient';

function label(value: string): string { return value.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase()); }
function icon(provider: string) { return provider === 'shopify' ? <ShoppingBag size={19}/> : provider === 'google_calendar' ? <CalendarDays size={19}/> : <WalletCards size={19}/>; }
function badge(status: IntegrationHealth['status']) { return status === 'healthy' ? 'bg-emerald-50 text-emerald-700' : status === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-800'; }

const IntegrationSettingsPanel: React.FC = () => {
  const { userProfile } = useAuth();
  const [overview, setOverview] = useState<SettingsOverview | null>(null);
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = async () => { if (!userProfile?.agencyId) return; setOverview(await getSettingsOverview(userProfile.agencyId)); };
  useEffect(() => { void load().catch((e) => setError(e instanceof Error ? e.message : 'Integration health could not be loaded.')); }, [userProfile?.agencyId]);

  const refresh = async (provider: string) => {
    if (!userProfile?.agencyId) return;
    setBusyProvider(provider); setError(null);
    try {
      if (provider === 'shopify') await apiRequest(userProfile.agencyId, '/api/v1/integrations/shopify/sync', { method: 'POST', body: {} });
      else if (provider === 'google_calendar') await apiRequest(userProfile.agencyId, '/api/v1/integrations/google-calendar/sync', { method: 'POST', body: {} });
      else await apiRequest(userProfile.agencyId, '/api/v1/integrations/xero/sync', { method: 'POST', body: {} });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Integration refresh failed.'); }
    finally { setBusyProvider(null); }
  };

  if (!overview) return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-500">Loading integration health…</div>;
  return <div className="space-y-5">
    {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><div><h2 className="font-bold">Integration control centre</h2><p className="mt-1 text-xs text-slate-500">Connection health, sync activity and exception posture across external systems.</p></div><button onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold"><RefreshCw size={13}/>Refresh all</button></div></section>
    <div className="grid gap-4 xl:grid-cols-3">{overview.integrations.map((item) => <section key={item.provider} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between"><div className="flex items-center gap-2 font-bold">{icon(item.provider)}{label(item.provider)}</div><span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${badge(item.status)}`}>{label(item.status)}</span></div><div className="mt-4 space-y-2 text-xs text-slate-500"><div><b className="text-slate-700">Account:</b> {item.accountLabel || 'Not connected'}</div><div><b className="text-slate-700">Last successful sync:</b> {item.lastSuccessfulSyncAt ? new Date(item.lastSuccessfulSyncAt).toLocaleString() : 'Not recorded'}</div><div><b className="text-slate-700">Open exceptions:</b> {item.openExceptionCount}</div>{item.lastError && <div className="rounded-lg bg-rose-50 p-2 text-rose-700"><AlertTriangle size={12} className="mr-1 inline"/>{item.lastError}</div>}</div><div className="mt-4 flex flex-wrap gap-2"><button disabled={busyProvider === item.provider || item.status === 'not_configured'} onClick={() => void refresh(item.provider)} className="inline-flex items-center gap-1 rounded-lg bg-slate-950 px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-40"><RefreshCw size={12}/>{busyProvider === item.provider ? 'Syncing…' : 'Sync now'}</button><Link to={item.provider === 'xero' ? '/app/admin/maintenance/configuration' : '/app/admin/jobs?tab=sync'} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-[11px] font-semibold">Manage <ExternalLink size={11}/></Link></div></section>)}</div>
    <section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center gap-2">{overview.integrations.every((item) => item.openExceptionCount === 0) ? <CheckCircle2 className="text-emerald-600" size={18}/> : <AlertTriangle className="text-amber-600" size={18}/>}<h2 className="font-bold">Exception posture</h2></div><p className="mt-2 text-sm text-slate-500">{overview.integrations.reduce((sum, item) => sum + item.openExceptionCount, 0)} unresolved integration exception(s). Detailed remediation remains in the operational integration screens where the source records live.</p></section>
  </div>;
};

export default IntegrationSettingsPanel;
