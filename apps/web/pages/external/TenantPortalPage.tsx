import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { FileText, Hammer, Home, ImagePlus, MessageSquare, ShieldAlert } from 'lucide-react';
import {
  getTenantPortalContext,
  signTenantPortalDocument,
  submitTenantPortalActionResponse,
  submitTenantPortalMaintenance,
  submitTenantPortalMessage,
  uploadTenantPortalEvidence,
  type TenantPortalContext,
} from '../../services/platform/tenantPortalService';

type Tab = 'home' | 'actions' | 'maintenance' | 'documents' | 'messages';
type ResponseType = 'completed' | 'clarification' | 'request_more_time' | 'response';
const ACCEPTED_EVIDENCE = '.jpg,.jpeg,.png,.heic,.heif,image/jpeg,image/png,image/heic,image/heif';

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
  const [actionId, setActionId] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState('');
  const [actionType, setActionType] = useState<ResponseType>('completed');
  const [actionEvidence, setActionEvidence] = useState<File[]>([]);
  const [maintenanceTitle, setMaintenanceTitle] = useState('');
  const [maintenanceDescription, setMaintenanceDescription] = useState('');
  const [maintenanceCategory, setMaintenanceCategory] = useState('General Maintenance');
  const [maintenancePriority, setMaintenancePriority] = useState('routine');
  const [maintenanceLocation, setMaintenanceLocation] = useState('');
  const [accessAvailability, setAccessAvailability] = useState('');
  const [maintenanceEvidence, setMaintenanceEvidence] = useState<File[]>([]);

  const load = async () => {
    if (!grantToken) return;
    setLoading(true); setError(null);
    try { setContext(await getTenantPortalContext(grantToken)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Tenant portal could not be loaded.'); setContext(null); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [grantToken]);

  const uploadEvidence = async (files: File[]) => {
    if (!grantToken) return [] as string[];
    const ids: string[] = [];
    for (const file of files) ids.push((await uploadTenantPortalEvidence(grantToken, file)).photoId);
    return ids;
  };

  const sendMessage = async (event: React.FormEvent) => {
    event.preventDefault(); if (!grantToken || !message.trim()) return;
    setBusy(true); setError(null);
    try { await submitTenantPortalMessage(grantToken, message.trim()); setMessage(''); await load(); setTab('messages'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Message could not be sent.'); }
    finally { setBusy(false); }
  };

  const submitAction = async (event: React.FormEvent) => {
    event.preventDefault(); if (!grantToken || !actionId || (!actionNote.trim() && actionEvidence.length === 0)) return;
    setBusy(true); setError(null);
    try {
      const evidenceIds = await uploadEvidence(actionEvidence);
      await submitTenantPortalActionResponse(grantToken, { actionId, responseType: actionType, note: actionNote.trim() || undefined, evidenceIds });
      setActionId(null); setActionNote(''); setActionEvidence([]); setActionType('completed'); await load(); setTab('actions');
    } catch (err) { setError(err instanceof Error ? err.message : 'Action response could not be submitted.'); }
    finally { setBusy(false); }
  };

  const createMaintenance = async (event: React.FormEvent) => {
    event.preventDefault(); if (!grantToken || !maintenanceTitle.trim() || !maintenanceDescription.trim()) return;
    setBusy(true); setError(null);
    try {
      const sourceEvidenceIds = await uploadEvidence(maintenanceEvidence);
      await submitTenantPortalMaintenance(grantToken, {
        title: maintenanceTitle.trim(), description: maintenanceDescription.trim(), category: maintenanceCategory,
        priority: maintenancePriority, sourceEvidenceIds, location: maintenanceLocation.trim() || undefined,
        accessAvailability: accessAvailability.trim() || undefined,
      });
      setMaintenanceTitle(''); setMaintenanceDescription(''); setMaintenanceLocation(''); setAccessAvailability(''); setMaintenanceEvidence([]); await load(); setTab('maintenance');
    } catch (err) { setError(err instanceof Error ? err.message : 'Maintenance request could not be submitted.'); }
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

      {tab === 'actions' && <section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-black">Actions & Follow-Up</h2><div className="mt-4 space-y-3">{context.actions.length ? context.actions.map((item) => <div key={item.id} className="rounded-xl border border-slate-200 p-4"><div className="flex justify-between gap-3"><div><div className="text-sm font-bold">{item.title}</div><div className="mt-1 text-xs text-slate-500">{label(item.type)} · Due {date(item.dueDate)}</div></div><span className="h-fit rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase">{label(item.status)}</span></div>{item.instruction && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{item.instruction}</p>}{item.tenantResponseNote && <p className="mt-2 text-xs text-blue-700">Your response: {item.tenantResponseNote}</p>}{['issued','viewed','awaiting_action'].includes(item.status || '') && <button onClick={() => setActionId(item.id)} className="mt-3 rounded-lg bg-slate-950 px-4 py-2 text-xs font-semibold text-white">Respond</button>}{actionId === item.id && <form onSubmit={submitAction} className="mt-4 space-y-3 rounded-xl bg-slate-50 p-4"><select value={actionType} onChange={(e) => setActionType(e.target.value as ResponseType)} className="w-full rounded-lg border border-slate-200 p-2 text-sm"><option value="completed">Completed</option><option value="response">Provide update</option><option value="clarification">Request clarification</option><option value="request_more_time">Request more time</option></select><textarea rows={4} value={actionNote} onChange={(e) => setActionNote(e.target.value)} placeholder="Response or update" className="w-full rounded-lg border border-slate-200 p-3 text-sm" /><EvidenceInput files={actionEvidence} onChange={setActionEvidence} /><div className="flex gap-2"><button disabled={busy} className="rounded-lg bg-slate-950 px-4 py-2 text-xs font-semibold text-white">Submit Response</button><button type="button" onClick={() => setActionId(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold">Cancel</button></div></form>}</div>) : <Empty text="No tenant actions are currently recorded." />}</div></section>}

      {tab === 'maintenance' && <div className="grid gap-5 lg:grid-cols-2"><section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-black">Maintenance</h2><div className="mt-4 space-y-3">{context.maintenance.length ? context.maintenance.map((item) => <div key={item.id} className="rounded-xl border border-slate-200 p-4"><div className="flex justify-between gap-3"><div className="text-sm font-bold">{item.title}</div><span className="text-[10px] font-bold uppercase text-slate-500">{label(item.status)}</span></div><div className="mt-1 text-xs text-slate-500">{item.category} · {label(item.priority)}</div>{item.description && <p className="mt-2 text-xs text-slate-600">{item.description}</p>}{item.location && <div className="mt-2 text-xs text-slate-500">Location: {item.location}</div>}</div>) : <Empty text="No maintenance is currently linked to this tenancy." />}</div></section><section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-black">Report Maintenance</h2><p className="mt-1 text-xs text-slate-500">Submit an issue with evidence and access information directly into maintenance triage.</p><form onSubmit={createMaintenance} className="mt-4 space-y-3"><input required value={maintenanceTitle} onChange={(e) => setMaintenanceTitle(e.target.value)} placeholder="Issue title" className="w-full rounded-lg border border-slate-200 p-3 text-sm" /><textarea required rows={4} value={maintenanceDescription} onChange={(e) => setMaintenanceDescription(e.target.value)} placeholder="Describe the issue" className="w-full rounded-lg border border-slate-200 p-3 text-sm" /><input value={maintenanceLocation} onChange={(e) => setMaintenanceLocation(e.target.value)} placeholder="Location / room" className="w-full rounded-lg border border-slate-200 p-3 text-sm" /><div className="grid gap-3 sm:grid-cols-2"><select value={maintenanceCategory} onChange={(e) => setMaintenanceCategory(e.target.value)} className="rounded-lg border border-slate-200 p-3 text-sm"><option>General Maintenance</option><option>Plumbing</option><option>Electrical</option><option>Appliance</option><option>Cleaning</option><option>Doors / Locks</option></select><select value={maintenancePriority} onChange={(e) => setMaintenancePriority(e.target.value)} className="rounded-lg border border-slate-200 p-3 text-sm"><option value="routine">Routine</option><option value="high">High</option><option value="urgent">Urgent</option></select></div><textarea rows={2} value={accessAvailability} onChange={(e) => setAccessAvailability(e.target.value)} placeholder="Access availability / preferred times" className="w-full rounded-lg border border-slate-200 p-3 text-sm" /><EvidenceInput files={maintenanceEvidence} onChange={setMaintenanceEvidence} /><button disabled={busy} className="w-full rounded-lg bg-slate-950 py-3 text-xs font-semibold text-white">Submit Maintenance Request</button></form></section></div>}

      {tab === 'documents' && <section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-black">Documents & Forms</h2><div className="mt-4 space-y-3">{context.documents.length ? context.documents.map((item) => { const mySigner = item.signers?.find((signer) => signer.kind === 'tenant' && signer.tenantId === context.tenant.id); return <div key={item.id} className="rounded-xl border border-slate-200 p-4"><div className="flex justify-between gap-3"><div><div className="text-sm font-bold">{item.title}</div><div className="text-xs text-slate-500">{label(item.type)}</div></div><span className="h-fit text-[10px] font-bold uppercase">{label(item.status)}</span></div>{item.content && <div className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-sm text-slate-700">{item.content}</div>}{item.acknowledgementText && <p className="mt-3 text-xs text-slate-500">{item.acknowledgementText}</p>}<div className="mt-3 flex flex-wrap gap-2">{item.downloadUrl && <a href={item.downloadUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold">Download PDF</a>}{mySigner && mySigner.status !== 'signed' && ['signature_required','partially_signed'].includes(item.status || '') && <button disabled={busy} onClick={() => void signDocument(item.id)} className="rounded-lg bg-slate-950 px-4 py-2 text-xs font-semibold text-white">Acknowledge & Sign</button>}</div>{item.signers?.length ? <div className="mt-3 space-y-1 rounded-lg bg-slate-50 p-3">{item.signers.map((signer) => <div key={signer.id} className="flex justify-between text-xs"><span>{signer.name || label(signer.kind)}</span><b className={signer.status === 'signed' ? 'text-emerald-700' : 'text-amber-700'}>{signer.status === 'signed' ? `Signed ${date(signer.signedAt)}` : 'Pending'}</b></div>)}</div> : null}</div>; }) : <Empty text="No tenancy documents have been shared yet." />}</div><div className="mt-5 border-t border-slate-100 pt-5"><h3 className="text-sm font-black">Inspection Reports</h3><div className="mt-3 grid gap-3 md:grid-cols-2">{context.reports.map((item) => <div key={item.id} className="rounded-xl bg-slate-50 p-4"><div className="text-sm font-bold">{item.reportType}</div><div className="mt-1 text-xs text-slate-500">{date(item.inspectionDate)} · {label(item.lifecycleStatus)}</div></div>)}</div></div></section>}

      {tab === 'messages' && <div className="grid gap-5 lg:grid-cols-2"><section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-black">Conversation History</h2><div className="mt-4 space-y-3">{context.communications.length ? [...context.communications].sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt))).map((item) => <div key={item.id} className={`rounded-xl p-4 ${item.direction === 'inbound' ? 'bg-blue-50' : 'bg-slate-50'}`}><div className="text-xs font-bold">{item.subject || label(item.channel)}</div><p className="mt-2 text-sm text-slate-700">{item.message}</p><div className="mt-2 text-[10px] text-slate-400">{label(item.direction)} · {date(item.createdAt)}</div></div>) : <Empty text="No messages have been recorded." />}</div></section><section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-black">Send a Message</h2><form onSubmit={sendMessage} className="mt-4 space-y-3"><textarea required rows={6} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Message your property manager" className="w-full rounded-lg border border-slate-200 p-3 text-sm" /><button disabled={busy} className="w-full rounded-lg bg-slate-950 py-3 text-xs font-semibold text-white">Send Message</button></form></section></div>}
    </main>
  </div>;
};

const EvidenceInput: React.FC<{ files: File[]; onChange: (files: File[]) => void }> = ({ files, onChange }) => <div className="rounded-lg border border-slate-200 bg-white p-3"><div className="flex items-center gap-2 text-xs font-semibold"><ImagePlus size={15} /> Photo evidence</div><input type="file" multiple accept={ACCEPTED_EVIDENCE} onChange={(e) => onChange(Array.from(e.target.files || []))} className="mt-2 block w-full text-xs" />{files.length > 0 && <div className="mt-2 text-[11px] text-slate-500">{files.length} file{files.length === 1 ? '' : 's'} selected.</div>}</div>;
const Stat: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => <div className="rounded-2xl border border-slate-200 bg-white p-5"><div className="text-blue-600">{icon}</div><div className="mt-3 text-[10px] font-bold uppercase text-slate-400">{label}</div><div className="mt-1 text-sm font-black">{value}</div></div>;
const Empty: React.FC<{ text: string }> = ({ text }) => <div className="rounded-xl border border-dashed border-slate-300 p-7 text-center text-sm text-slate-500">{text}</div>;

export default TenantPortalPage;
