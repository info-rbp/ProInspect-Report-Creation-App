import React, { useEffect, useMemo, useState } from 'react';
import { Building2, Cable, MessageSquareText, Palette, Save, Settings2, ShieldCheck, SlidersHorizontal, Wrench } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../../contexts/AuthContext';
import type { AgencyOrganisationSettings } from '../../../types/platform';
import { getOrganisationSettings, saveOrganisationSettings } from '../../../services/platform/agencySettingsService';
import { isAiConfigured } from '../../../services/configService';
import { isFirebaseConfigured } from '../../../services/storageService';
import BrandingSettingsPanel from './BrandingSettingsPanel';

const TABS = [
  ['overview', 'Overview', Settings2], ['organisation', 'Organisation', Building2], ['branding', 'Branding', Palette],
  ['inspection', 'Inspection Defaults', SlidersHorizontal], ['communications', 'Communications', MessageSquareText],
  ['integrations', 'Integrations', Cable], ['maintenance', 'Maintenance Policies', Wrench], ['security', 'Security & Audit', ShieldCheck],
] as const;
type Tab = (typeof TABS)[number][0];

const EMPTY: Omit<AgencyOrganisationSettings, 'id' | 'agencyId' | 'createdAt' | 'updatedAt'> = {
  version: undefined, status: 'active', registeredName: '', tradingName: '', abn: '', website: '', contactEmail: '', contactPhone: '',
  timezone: 'Australia/Perth', locale: 'en-AU', currency: 'AUD', countryCode: 'AU', financialYearStartMonth: 7, taxLabel: 'GST', defaultTaxRate: 10,
  defaultReplyToEmail: '', supportEmail: '', privacyEmail: '',
};

function Placeholder({ title }: { title: string }) {
  return <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"><h2 className="font-bold text-slate-900">{title}</h2><p className="mt-2 text-sm text-slate-500">This control surface is implemented in the next staged Settings tranche.</p></section>;
}

function OverviewPanel() {
  const services = [['Firebase', isFirebaseConfigured(), 'Identity, Firestore and platform persistence'], ['AI service', isAiConfigured(), 'Server-side inspection analysis'], ['API environment', Boolean(import.meta.env.VITE_API_BASE_URL?.trim()), 'Server-authoritative application API']] as const;
  return <div className="grid gap-4 md:grid-cols-3">{services.map(([name, ready, description]) => <section key={name} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${ready ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{ready ? 'Ready' : 'Needs attention'}</span><h2 className="mt-4 font-bold text-slate-950">{name}</h2><p className="mt-1 text-sm text-slate-500">{description}</p></section>)}</div>;
}

function OrganisationPanel() {
  const { userProfile } = useAuth();
  const [form, setForm] = useState(EMPTY); const [loaded, setLoaded] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!userProfile?.agencyId) return;
    void getOrganisationSettings(userProfile.agencyId).then((value) => { if (value) { const { id: _id, agencyId: _agencyId, createdAt: _createdAt, updatedAt: _updatedAt, ...editable } = value; setForm(editable); } setLoaded(true); }).catch((failure) => { setError(failure instanceof Error ? failure.message : 'Organisation settings could not be loaded.'); setLoaded(true); });
  }, [userProfile?.agencyId]);
  const set = (field: keyof typeof form, value: string | number) => setForm((current) => ({ ...current, [field]: value }));
  const save = async () => { if (!userProfile?.agencyId) return; setBusy(true); setError(null); setSaved(false); try { const next = await saveOrganisationSettings(userProfile.agencyId, form); const { id: _id, agencyId: _agencyId, createdAt: _createdAt, updatedAt: _updatedAt, ...editable } = next; setForm(editable); setSaved(true); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Organisation settings could not be saved.'); } finally { setBusy(false); } };
  if (!loaded) return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-500">Loading organisation settings…</div>;
  const fieldClass = 'mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500';
  return <div className="space-y-5">{error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}{saved && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">Organisation settings saved.</div>}
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-bold">Business identity</h2><p className="text-xs text-slate-500">{form.version ? `Editing version ${form.version}` : 'New organisation profile'}</p></div><button disabled={busy || !form.registeredName.trim()} onClick={() => void save()} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"><Save size={14}/>{busy ? 'Saving…' : 'Save changes'}</button></div><div className="mt-5 grid gap-4 md:grid-cols-2">
      <label className="text-xs font-semibold text-slate-700">Registered name<input className={fieldClass} value={form.registeredName} onChange={(e) => set('registeredName', e.target.value)} /></label><label className="text-xs font-semibold text-slate-700">Trading name<input className={fieldClass} value={form.tradingName || ''} onChange={(e) => set('tradingName', e.target.value)} /></label><label className="text-xs font-semibold text-slate-700">ABN<input className={fieldClass} value={form.abn || ''} onChange={(e) => set('abn', e.target.value)} /></label><label className="text-xs font-semibold text-slate-700">Website<input className={fieldClass} value={form.website || ''} onChange={(e) => set('website', e.target.value)} /></label><label className="text-xs font-semibold text-slate-700">Primary email<input className={fieldClass} type="email" value={form.contactEmail || ''} onChange={(e) => set('contactEmail', e.target.value)} /></label><label className="text-xs font-semibold text-slate-700">Primary phone<input className={fieldClass} value={form.contactPhone || ''} onChange={(e) => set('contactPhone', e.target.value)} /></label><label className="text-xs font-semibold text-slate-700">Support email<input className={fieldClass} type="email" value={form.supportEmail || ''} onChange={(e) => set('supportEmail', e.target.value)} /></label><label className="text-xs font-semibold text-slate-700">Reply-to email<input className={fieldClass} type="email" value={form.defaultReplyToEmail || ''} onChange={(e) => set('defaultReplyToEmail', e.target.value)} /></label>
    </div></section>
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-lg font-bold">Regional & financial defaults</h2><div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><label className="text-xs font-semibold text-slate-700">Timezone<input className={fieldClass} value={form.timezone} onChange={(e) => set('timezone', e.target.value)} /></label><label className="text-xs font-semibold text-slate-700">Locale<input className={fieldClass} value={form.locale} onChange={(e) => set('locale', e.target.value)} /></label><label className="text-xs font-semibold text-slate-700">Currency<input className={fieldClass} maxLength={3} value={form.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} /></label><label className="text-xs font-semibold text-slate-700">Country<input className={fieldClass} maxLength={2} value={form.countryCode} onChange={(e) => set('countryCode', e.target.value.toUpperCase())} /></label><label className="text-xs font-semibold text-slate-700">Financial year start month<input className={fieldClass} type="number" min={1} max={12} value={form.financialYearStartMonth} onChange={(e) => set('financialYearStartMonth', Number(e.target.value))} /></label><label className="text-xs font-semibold text-slate-700">Tax label<input className={fieldClass} value={form.taxLabel} onChange={(e) => set('taxLabel', e.target.value)} /></label><label className="text-xs font-semibold text-slate-700">Default tax rate %<input className={fieldClass} type="number" min={0} max={100} step="0.01" value={form.defaultTaxRate} onChange={(e) => set('defaultTaxRate', Number(e.target.value))} /></label><label className="text-xs font-semibold text-slate-700">Privacy email<input className={fieldClass} type="email" value={form.privacyEmail || ''} onChange={(e) => set('privacyEmail', e.target.value)} /></label></div></section>
  </div>;
}

const SettingsWorkspacePage: React.FC = () => {
  const [params, setParams] = useSearchParams(); const requested = params.get('tab') as Tab | null; const validTabs = useMemo(() => new Set(TABS.map(([id]) => id)), []); const tab: Tab = requested && validTabs.has(requested) ? requested : 'overview';
  const content = tab === 'overview' ? <OverviewPanel /> : tab === 'organisation' ? <OrganisationPanel /> : tab === 'branding' ? <BrandingSettingsPanel /> : <Placeholder title={TABS.find(([id]) => id === tab)?.[1] || 'Settings'} />;
  return <div className="space-y-6 pb-16"><header><h1 className="text-3xl font-black text-slate-950">Settings</h1><p className="mt-1 text-sm text-slate-500">Govern organisation-wide identity, policy, presentation, integrations and security.</p></header><nav className="flex gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">{TABS.map(([id, label, Icon]) => <button key={id} onClick={() => setParams(id === 'overview' ? {} : { tab: id })} className={`inline-flex items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-xs font-semibold ${tab === id ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-slate-50'}`}><Icon size={14}/>{label}</button>)}</nav>{content}</div>;
};
export default SettingsWorkspacePage;
