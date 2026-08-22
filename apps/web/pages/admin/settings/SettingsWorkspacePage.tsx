import React, { useMemo } from 'react';
import { Building2, Cable, MessageSquareText, Palette, Settings2, ShieldCheck, SlidersHorizontal, Wrench } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { isAiConfigured } from '../../../services/configService';
import { isFirebaseConfigured } from '../../../services/storageService';
import BrandingSettingsPanel from './BrandingSettingsPanel';
import CommunicationSettingsPanel from './CommunicationSettingsPanel';
import InspectionDefaultsPanel from './InspectionDefaultsPanel';
import IntegrationSettingsPanel from './IntegrationSettingsPanel';
import MaintenancePolicyPanel from './MaintenancePolicyPanel';
import OrganisationSettingsPanel from './OrganisationSettingsPanel';
import SecurityAuditPanel from './SecurityAuditPanel';

const TABS = [
  ['overview', 'Overview', Settings2],
  ['organisation', 'Organisation', Building2],
  ['branding', 'Branding', Palette],
  ['inspection', 'Inspection Defaults', SlidersHorizontal],
  ['communications', 'Communications', MessageSquareText],
  ['integrations', 'Integrations', Cable],
  ['maintenance', 'Maintenance Policies', Wrench],
  ['security', 'Security & Audit', ShieldCheck],
] as const;
type Tab = (typeof TABS)[number][0];

function OverviewPanel() {
  const services = [
    ['Firebase', isFirebaseConfigured(), 'Identity, Firestore and platform persistence'],
    ['AI service', isAiConfigured(), 'Server-side inspection analysis'],
    ['API environment', Boolean(import.meta.env.VITE_API_BASE_URL?.trim()), 'Server-authoritative application API'],
  ] as const;
  return <div className="grid gap-4 md:grid-cols-3">{services.map(([name, ready, description]) => <section key={name} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${ready ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{ready ? 'Ready' : 'Needs attention'}</span><h2 className="mt-4 font-bold text-slate-950">{name}</h2><p className="mt-1 text-sm text-slate-500">{description}</p></section>)}</div>;
}

const SettingsWorkspacePage: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab') as Tab | null;
  const validTabs = useMemo(() => new Set(TABS.map(([id]) => id)), []);
  const tab: Tab = requested && validTabs.has(requested) ? requested : 'overview';
  const panels: Record<Tab, React.ReactNode> = {
    overview: <OverviewPanel />,
    organisation: <OrganisationSettingsPanel />,
    branding: <BrandingSettingsPanel />,
    inspection: <InspectionDefaultsPanel />,
    communications: <CommunicationSettingsPanel />,
    integrations: <IntegrationSettingsPanel />,
    maintenance: <MaintenancePolicyPanel />,
    security: <SecurityAuditPanel />,
  };
  return <div className="space-y-6 pb-16"><header><h1 className="text-3xl font-black text-slate-950">Settings</h1><p className="mt-1 text-sm text-slate-500">Govern organisation-wide identity, policy, presentation, integrations and security.</p></header><nav className="flex gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">{TABS.map(([id, label, Icon]) => <button key={id} onClick={() => setParams(id === 'overview' ? {} : { tab: id })} className={`inline-flex items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-xs font-semibold ${tab === id ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-slate-50'}`}><Icon size={14}/>{label}</button>)}</nav>{panels[tab]}</div>;
};

export default SettingsWorkspacePage;
