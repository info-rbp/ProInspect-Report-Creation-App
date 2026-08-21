import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { FileText, Hammer, Home, MessageSquare, ShieldAlert } from 'lucide-react';
import {
  getTenantPortalContext,
  signTenantPortalDocument,
  submitTenantPortalMaintenance,
  submitTenantPortalMessage,
  type TenantPortalContext,
} from '../../services/platform/tenantPortalService';

type Tab = 'home' | 'actions' | 'maintenance' | 'documents' | 'messages';

function label(value?: string): string { return value ? value.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Not configured'; }
function date(value?: string): string { if (!value) return 'Not recorded'; const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString(); }

const TenantPortalPage: React.FC = () => {
  const { grantToken } = useParams<{ grantToken: string }>();
  const [context, setContext] = useState<TenantPortalContext | null>(null);
  const [tab, setTab] = useState<Tab>('home');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [maintenanceTitle, setMaintenanceTitle] = useState('');
  const [maintenanceDescription, setMaintenanceDescription] = useState('');

  const load = async () => {
    if (!grantToken) return;
    setLoading(true); setError(null);
    try { setContext(await getTenantPortalContext(grantToken)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Tenant portal could not be loaded.'); setContext(null); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [grantToken]);

  const sendMessage = async (event: React.FormEvent) => {
    event.preventDefault(); if (!grantToken || !message.trim()) return;
    setBusy(true); setError(null);
    try { await submitTenantPortalMessage(grantToken, message.trim()); setMessage(''); await load(); setTab('messages'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Message could not be sent.'); }
    finally { setBusy(false); }
  };

  const createMaintenance = async (event: React.FormEvent) => {
    event.preventDefault(); if (!grantToken || !maintenanceTitle.trim() || !maintenanceDescription.trim()) return;
    setBusy(true); setError(null);
    try { await submitTenantPortalMaintenance(grantToken, { title: maintenanceTitle.trim(), description: maintenanceDescription.trim(), category: 'General Maintenance', priority: 'routine' }); setMaintenanceTitle(''); setMaintenanceDescription(''); await load(); setTab('maintenance'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Maintenance request could not be submitted.'); }
    finally { setBusy(false); }
  };

  const signDocument = async (documentId: string) => {
    if (!grantToken || !context) return;
    const signatureName = window.prompt('Type your full name to acknowledge and sign this document:', context.tenant.fullName)?.trim();
    if (!signatureName) return;
    setBusy(true); setError(null);
    try { await signTenantPortalDocument(grantToken, documentId, signatureName); await load(); setTab('documents'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Document acknowledgement could not be recorded.'); }
    finally { setBusy(false); }
  };

  if (loading) return <div className="min-h-screen bg-slate-50 grid place-items-center text-sm text-slate-500">Loading tenant portal...</div>;
  if (!context) return <div className="min-h-screen bg-slate-50 grid place-items-center p-4"><div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center"><ShieldAlert className="mx-auto text-rose-500" size={34} /><h1 className="mt-3 text-lg font-black">Portal Link Invalid or Expired</h1><p className="mt-2 text-sm text-slate-500">{error || 'This tenant portal link is no longer available.'}</p></div></div>;

  const propertyAddress = [context.property?.address, context.property?.suburb, context.property?.state, context.property?.postcode].filter(Boolean).join(', ');
  const openActions = context.actions.filter((item) => !['resolved', 'closed', 'cancelled', 'withdrawn'].includes(item.status || ''));
  const openMaintenance = context.maintenance.filter((item) => !['closed', 'dismissed', 'cancelled', 'duplicate', 'not_actionable'].includes(item.status || ''));

  return <div className="min-h-screen bg-slate-50">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-6"><div><div className="text-xs font-black uppercase tracking-wide text-blue-600">ProInspect Tenant Portal</div><h1 className="mt-1 text-xl font-black text-slate-950">{context.tenant.preferredName || context.tenant.fullName}</h1><p className="text-sm text-slate-500">{propertyAddress || 'Current tenancy'}</p></div><div className="rounded-xl bg-slate-50 px-4 py-3 text-right"><div className="text-[10px] font-bold uppercase text-slate-400">Tenancy</div><div className="text-xs font-semibold">{date(context.tenancy.leaseStartDate)} – {date(context.tenancy.leaseEndDate)}</div></div></div></header>
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:px-6">
      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
      <nav className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5">{([['home','Home'],['actions','Actions'],['maintenance','Maintenance'],['documents','Documents'],['messages','Messages']] as Array<[Tab,string]>).map(([id,name]) => <button key={id} onClick={() => setTab(id)} className={`whitespace-nowrap rounded-lg px-4 py-2 text-xs font-semibold ${tab === id ? 'bg-slate-950 text-white' : 'text-slate-600'}`}>{name}</button>)}</nav>

      {tab === 'home' && <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4"><Stat icon={<Home size={17} />} label="Property" value={context.property?.address || 'Linked tenancy'} /><Stat icon={<MessageSquare size={17} />} label="Outstanding Actions" value={String(openActions.length)} /><Stat icon={<Hammer size={17} />} label="Open Maintenance" value={String(openMaintenance.length)} /><Stat icon={<FileText size={17} />} label="Documents" value={String(context.documents.length)} /><section className="rounded-2xl border border-slate-200 bg-white p-5 md:col-span-2 lg:col-span-4"><h2 className="font-black">Upcoming Inspections</h2><div className="mt-3 grid gap-3 md:grid-cols-2">{context.inspections.length ? context.inspections.map((item) => <div key={item.id} className="rounded-xl bg-slate-50 p-4"><div className="text-sm font-bold">{item.reportType}</div><div className="mt-1 text-xs text-slate-500">{date(item.scheduledAt)} · {label(item.status)}</div></div>) : <div className="text-sm text-slate-500">No upcoming inspections are currently recorded.</div>}</div></section></div>}

      {tab === 'actions' && <section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-black">Actions & Follow-Up</h2><div className="mt-4 space-y-3">{context.actions.length ? context.actions.map((item) => <div key={item.id} className="rounded-xl border border-slate-200 p-4"><div className="flex justify-between gap-3"><div><div className="text-sm font-bold">{item.title}</div><div className="mt-1 text-xs text-slate-500">{label(item.type)} · Due {date(item.dueDate)}</div></div><span className="h-fit rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase">{label(item.status)}</span></div>{item.instruction && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{item.instruction}</p>}{item.tenantResponseNote && <p className="mt-2 text-xs text-blue-700">Your response: {item.tenantResponseNote}</p>}</div>) : <Empty text="No tenant actions are currently recorded." />}</div></section>}

      {tab === 'maintenance' && <div className="grid gap-5 lg:grid-cols-2"><section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-black">Maintenance</h2><div className="mt-4 space-y-3">{context.maintenance.length ? context.maintenance.map((item) => <div key={item.id} className="rounded-xl border border-slate-200 p-4"><div className="flex justify-between gap-3"><div className="text-sm font-bold">{item.title}</div><span className="text-[10px] font-bold uppercase text-slate-500">{label(item.status)}</span></div><div className="mt-1 text-xs text-slate-500">{item.category} · {label(item.priority)}</div>{item.description && <p className="mt-2 text-xs text-slate-600">{item.description}</p>}</div>) : <Empty text="No maintenance is currently linked to this tenancy." />}</div></section><section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-black">Report Maintenance</h2><p className="mt-1 text-xs text-slate-500">Submit an issue directly into the property maintenance triage workflow.</p><form onSubmit={createMaintenance} className="mt-4 space-y-3"><input required value={maintenanceTitle} onChange={(e) => setMaintenanceTitle(e.target.value)} placeholder="Issue title" className="w-full rounded-lg border border-slate-200 p-3 text-sm" /><textarea required rows={5} value={maintenanceDescription} onChange={(e) => setMaintenanceDescription(e.target.value)} placeholder="Describe the issue and where it is located" className="w-full rounded-lg border border-slate-200 p-3 text-sm" /><button disabled={busy} className="w-full rounded-lg bg-slate-950 py-3 text-xs font-semibold text-white">Submit Maintenance Request</button></form></section></div>}

      {tab === 'documents' && <section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-black">Documents & Forms</h2><div className="mt-4 space-y-3">{context.documents.length ? context.documents.map((item) => <div key={item.id} className="rounded-xl border border-slate-200 p-4"><div className="flex justify-between gap-3"><div><div className="text-sm font-bold">{item.title}</div><div className="text-xs text-slate-500">{label(item.type)}</div></div><span className="h-fit text-[10px] font-bold uppercase">{label(item.status)}</span></div>{item.content && <div className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-sm text-slate-700">{item.content}</div>}{item.acknowledgementText && <p className="mt-3 text-xs text-slate-500">{item.acknowledgementText}</p>}{['signature_required','partially_signed'].includes(item.status || '') && <button disabled={busy} onClick={() => void signDocument(item.id)} className="mt-3 rounded-lg bg-slate-950 px-4 py-2 text-xs font-semibold text-white">Acknowledge & Sign</button>}{item.status === 'signed' && <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-xs font-semibold text-emerald-800">Signed by {item.signatureName || 'tenant'} on {date(item.signedAt)}.</div>}</div>) : <Empty text="No tenancy documents have been shared yet." />}</div><div className="mt-5 border-t border-slate-100 pt-5"><h3 className="text-sm font-black">Inspection Reports</h3><div className="mt-3 grid gap-3 md:grid-cols-2">{context.reports.map((item) => <div key={item.id} className="rounded-xl bg-slate-50 p-4"><div className="text-sm font-bold">{item.reportType}</div><div className="mt-1 text-xs text-slate-500">{date(item.inspectionDate)} · {label(item.lifecycleStatus)}</div></div>)}</div></div></section>}

      {tab === 'messages' && <div className="grid gap-5 lg:grid-cols-2"><section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-black">Conversation History</h2><div className="mt-4 space-y-3">{context.communications.length ? [...context.communications].sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt))).map((item) => <div key={item.id} className={`rounded-xl p-4 ${item.direction === 'inbound' ? 'bg-blue-50' : 'bg-slate-50'}`}><div className="text-xs font-bold">{item.subject || label(item.channel)}</div><p className="mt-2 text-sm text-slate-700">{item.message}</p><div className="mt-2 text-[10px] text-slate-400">{label(item.direction)} · {date(item.createdAt)}</div></div>) : <Empty text="No messages have been recorded." />}</div></section><section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-black">Send a Message</h2><form onSubmit={sendMessage} className="mt-4 space-y-3"><textarea required rows={6} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Message your property manager" className="w-full rounded-lg border border-slate-200 p-3 text-sm" /><button disabled={busy} className="w-full rounded-lg bg-slate-950 py-3 text-xs font-semibold text-white">Send Message</button></form></section></div>}
    </main>
  </div>;
};

const Stat: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => <div className="rounded-2xl border border-slate-200 bg-white p-5"><div className="text-blue-600">{icon}</div><div className="mt-3 text-[10px] font-bold uppercase text-slate-400">{label}</div><div className="mt-1 text-sm font-black">{value}</div></div>;
const Empty: React.FC<{ text: string }> = ({ text }) => <div className="rounded-xl border border-dashed border-slate-300 p-7 text-center text-sm text-slate-500">{text}</div>;

export default TenantPortalPage;
