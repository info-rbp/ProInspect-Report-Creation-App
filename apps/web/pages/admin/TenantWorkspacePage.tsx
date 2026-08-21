import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CalendarDays, FileText, Hammer, KeyRound, Mail, MessageSquare, Plus, RefreshCw, UserRound } from 'lucide-react';
import type { PropertyRecord, ReportIndex, Tenant, TenantCommunication, TenancyDocument, TenancyParticipant } from '../../types/platform';
import { listProperties } from '../../services/platform/propertyService';
import { listInspectionJobs } from '../../services/platform/inspectionJobService';
import { listReportIndexes } from '../../services/platform/reportIndexService';
import { listMaintenanceItems, listTenantInstructions } from '../../services/platform/maintenanceService';
import {
  addTenancyParticipant,
  createTenant,
  createTenancyDocument,
  getTenant,
  listManagedTenancies,
  listTenantCommunications,
  listTenancyDocuments,
  listTenancyParticipants,
  queueTenantCommunication,
  updateManagedTenancy,
  type ManagedTenancy,
} from '../../services/platform/tenantDirectoryService';

type Tab = 'overview' | 'tenancy' | 'inspections' | 'actions' | 'maintenance' | 'communications' | 'documents' | 'access' | 'timeline';
const TABS: Array<[Tab, string]> = [
  ['overview', 'Overview'], ['tenancy', 'Tenancy'], ['inspections', 'Inspections & Reports'], ['actions', 'Actions & Follow-Up'],
  ['maintenance', 'Maintenance'], ['communications', 'Communications'], ['documents', 'Documents & Forms'], ['access', 'Access & Keys'], ['timeline', 'Timeline'],
];
const TERMINAL_MAINTENANCE = new Set(['closed', 'dismissed', 'cancelled', 'duplicate', 'not_actionable']);
const TERMINAL_ACTIONS = new Set(['resolved', 'closed', 'cancelled', 'withdrawn']);

function date(value?: string): string {
  if (!value) return 'Not recorded';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}
function label(value?: string): string { return value ? value.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Not configured'; }

const TenantWorkspacePage: React.FC = () => {
  const { tenantId } = useParams<{ tenantId: string }>();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [tenancies, setTenancies] = useState<ManagedTenancy[]>([]);
  const [participants, setParticipants] = useState<TenancyParticipant[]>([]);
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [jobs, setJobs] = useState<Awaited<ReturnType<typeof listInspectionJobs>>>([]);
  const [reports, setReports] = useState<ReportIndex[]>([]);
  const [maintenance, setMaintenance] = useState<Awaited<ReturnType<typeof listMaintenanceItems>>>([]);
  const [actions, setActions] = useState<Awaited<ReturnType<typeof listTenantInstructions>>>([]);
  const [communications, setCommunications] = useState<TenantCommunication[]>([]);
  const [documents, setDocuments] = useState<TenancyDocument[]>([]);
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMessage, setShowMessage] = useState(false);
  const [message, setMessage] = useState('');
  const [subject, setSubject] = useState('');
  const [channel, setChannel] = useState<'email' | 'sms' | 'portal'>('email');
  const [showDocument, setShowDocument] = useState(false);
  const [documentTitle, setDocumentTitle] = useState('');
  const [documentType, setDocumentType] = useState<TenancyDocument['type']>('tenancy_agreement');
  const [showParticipant, setShowParticipant] = useState(false);
  const [participantName, setParticipantName] = useState('');
  const [participantEmail, setParticipantEmail] = useState('');

  const load = async () => {
    if (!tenantId) return;
    setLoading(true); setError(null);
    try {
      const [tenantRecord, tenancyList, participantList, propertyList, jobList, reportList, maintenanceList, actionList, communicationList, documentList] = await Promise.all([
        getTenant(tenantId), listManagedTenancies(), listTenancyParticipants(), listProperties(), listInspectionJobs(), listReportIndexes(), listMaintenanceItems(), listTenantInstructions(), listTenantCommunications(), listTenancyDocuments(),
      ]);
      setTenant(tenantRecord); setTenancies(tenancyList); setParticipants(participantList); setProperties(propertyList); setJobs(jobList); setReports(reportList); setMaintenance(maintenanceList); setActions(actionList); setCommunications(communicationList); setDocuments(documentList);
    } catch (err) { setError(err instanceof Error ? err.message : 'Tenant workspace could not be loaded.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [tenantId]);

  const tenantParticipants = participants.filter((item) => item.tenantId === tenantId);
  const linkedTenancies = tenantParticipants.map((item) => tenancies.find((candidate) => candidate.id === item.tenancyId)).filter(Boolean) as ManagedTenancy[];
  const currentTenancy = linkedTenancies.find((item) => (item.lifecycleStatus || item.status) === 'active') || linkedTenancies[0];
  const property = currentTenancy ? properties.find((item) => item.id === currentTenancy.propertyId) : undefined;
  const tenancyIds = new Set(linkedTenancies.map((item) => item.id));
  const tenantJobs = jobs.filter((item) => item.tenancyId && tenancyIds.has(item.tenancyId));
  const tenantReports = reports.filter((item) => item.tenancyId && tenancyIds.has(item.tenancyId));
  const tenantMaintenance = maintenance.filter((item) => item.tenancyId && tenancyIds.has(item.tenancyId));
  const tenantActions = actions.filter((item) => tenancyIds.has(item.tenancyId));
  const tenantCommunications = communications.filter((item) => item.tenantId === tenantId);
  const tenantDocuments = documents.filter((item) => item.tenantId === tenantId || tenancyIds.has(item.tenancyId));
  const openMaintenance = tenantMaintenance.filter((item) => !TERMINAL_MAINTENANCE.has(item.status));
  const openActions = tenantActions.filter((item) => !TERMINAL_ACTIONS.has(item.status));
  const nextJob = [...tenantJobs].filter((item) => item.scheduledAt && !['finalised', 'archived', 'cancelled'].includes(item.status)).sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)))[0];
  const accessDevices = property?.accessDevices?.filter((item) => !item.tenancyId || tenancyIds.has(item.tenancyId)) || [];

  const timeline = useMemo(() => {
    const items: Array<{ id: string; at: string; title: string; detail: string; href?: string }> = [];
    for (const tenancy of linkedTenancies) items.push({ id: `tenancy-${tenancy.id}`, at: tenancy.leaseStartDate || tenancy.createdAt, title: 'Tenancy commenced', detail: `${propertyFor(tenancy.propertyId)?.address || 'Property'} · ${label(tenancy.lifecycleStatus || tenancy.status)}` });
    for (const job of tenantJobs) items.push({ id: `job-${job.id}`, at: job.scheduledAt || job.createdAt, title: `${job.reportType} inspection`, detail: label(job.status), href: `/app/admin/jobs/${job.id}` });
    for (const report of tenantReports) items.push({ id: `report-${report.id}`, at: report.inspectionDate || report.updatedAt, title: `${report.reportType} report`, detail: label(report.lifecycleStatus), href: `/app/admin/reports/${report.reportId}` });
    for (const item of tenantMaintenance) items.push({ id: `maintenance-${item.id}`, at: item.updatedAt || item.createdAt, title: `Maintenance: ${item.title}`, detail: `${item.category} · ${label(item.status)}`, href: `/app/admin/maintenance/${item.id}` });
    for (const item of tenantActions) items.push({ id: `action-${item.id}`, at: item.updatedAt || item.createdAt, title: `Tenant action: ${item.title}`, detail: label(item.status) });
    for (const item of tenantCommunications) items.push({ id: `communication-${item.id}`, at: item.sentAt || item.createdAt, title: `${label(item.channel)} communication`, detail: item.subject || item.message.slice(0, 80) });
    for (const item of tenantDocuments) items.push({ id: `document-${item.id}`, at: item.issuedAt || item.createdAt, title: `Document: ${item.title}`, detail: `${label(item.type)} · ${label(item.status)}` });
    return items.filter((item) => item.at).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }, [linkedTenancies, tenantJobs, tenantReports, tenantMaintenance, tenantActions, tenantCommunications, tenantDocuments, properties]);

  function propertyFor(propertyId: string) { return properties.find((item) => item.id === propertyId); }

  const sendMessage = async (event: React.FormEvent) => {
    event.preventDefault(); if (!tenant || !message.trim()) return;
    const recipient = channel === 'sms' ? tenant.phone : tenant.email;
    if (channel !== 'portal' && !recipient) { setError(`Tenant has no ${channel === 'sms' ? 'phone number' : 'email address'}.`); return; }
    setBusy(true); setError(null);
    try { await queueTenantCommunication({ tenantId: tenant.id, tenancyId: currentTenancy?.id, propertyId: currentTenancy?.propertyId, channel, recipient: recipient || `portal:${tenant.id}`, subject: subject.trim() || undefined, message: message.trim() }); setShowMessage(false); setMessage(''); setSubject(''); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Communication could not be queued.'); }
    finally { setBusy(false); }
  };

  const createDocument = async (event: React.FormEvent) => {
    event.preventDefault(); if (!currentTenancy || !documentTitle.trim()) return;
    setBusy(true); setError(null);
    try { await createTenancyDocument({ tenantId: tenantId!, tenancyId: currentTenancy.id, propertyId: currentTenancy.propertyId, type: documentType, title: documentTitle.trim(), status: documentType === 'tenancy_agreement' ? 'signature_required' : 'draft' }); setShowDocument(false); setDocumentTitle(''); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Tenancy document could not be created.'); }
    finally { setBusy(false); }
  };

  const addParticipant = async (event: React.FormEvent) => {
    event.preventDefault(); if (!currentTenancy || !participantName.trim()) return;
    setBusy(true); setError(null);
    try { const created = await createTenant({ fullName: participantName.trim(), email: participantEmail.trim() || undefined }); await addTenancyParticipant(currentTenancy.id, created.id, 'co_tenant'); setShowParticipant(false); setParticipantName(''); setParticipantEmail(''); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Participant could not be added.'); }
    finally { setBusy(false); }
  };

  const markVacating = async () => {
    if (!currentTenancy) return; setBusy(true); setError(null);
    try { await updateManagedTenancy(currentTenancy, { lifecycleStatus: 'vacating', noticeDate: new Date().toISOString().slice(0, 10) }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Tenancy could not be updated.'); }
    finally { setBusy(false); }
  };

  if (loading) return <div className="flex h-64 items-center justify-center text-sm text-slate-500"><RefreshCw className="mr-2 animate-spin" size={16} /> Loading tenant workspace...</div>;
  if (!tenant) return <div className="p-8 text-sm text-slate-500">Tenant not found.</div>;

  return <div className="space-y-6 p-6 pb-16">
    <Link to="/app/admin/tenants" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500"><ArrowLeft size={14} /> Back to Tenants</Link>
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="text-[11px] font-bold uppercase text-blue-600">Tenant Workspace</div><h1 className="mt-1 text-3xl font-black text-slate-950">{tenant.fullName}</h1><p className="mt-1 text-sm text-slate-500">{property?.address || 'No current property'} · {tenant.email || tenant.phone || 'No contact details'}</p><div className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold uppercase"><span className="rounded-lg bg-emerald-50 px-2.5 py-1 text-emerald-700">{label(tenant.status)}</span>{currentTenancy && <span className="rounded-lg bg-blue-50 px-2.5 py-1 text-blue-700">{label(currentTenancy.lifecycleStatus || currentTenancy.status)}</span>}</div></div><div className="flex flex-wrap gap-2"><button onClick={() => setShowMessage(true)} className="flex items-center gap-2 rounded-xl bg-slate-950 px-3 py-2 text-xs font-semibold text-white"><Mail size={14} /> Message</button><button onClick={() => setTab('actions')} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold">Open Actions</button>{property && <Link to={`/app/admin/properties/${property.id}`} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold">Open Property</Link>}</div></div><div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-6"><Stat label="Current Tenancy" value={currentTenancy ? label(currentTenancy.lifecycleStatus || currentTenancy.status) : 'None'} /><Stat label="Next Inspection" value={nextJob ? date(nextJob.scheduledAt) : 'Not booked'} /><Stat label="Open Actions" value={String(openActions.length)} /><Stat label="Open Maintenance" value={String(openMaintenance.length)} /><Stat label="Documents" value={String(tenantDocuments.length)} /><Stat label="Messages" value={String(tenantCommunications.length)} /></div></section>
    {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
    <nav className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">{TABS.map(([id, name]) => <button key={id} onClick={() => setTab(id)} className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold ${tab === id ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{name}</button>)}</nav>

    {tab === 'overview' && <div className="grid gap-5 lg:grid-cols-3"><Card title="Current Tenancy" icon={<UserRound size={17} />}><Info label="Property" value={property?.address || 'No current property'} /><Info label="Lease" value={currentTenancy ? `${date(currentTenancy.leaseStartDate)} – ${date(currentTenancy.leaseEndDate)}` : 'Not configured'} /><Info label="Type" value={label(currentTenancy?.leaseType)} /></Card><Card title="Attention Required" icon={<CalendarDays size={17} />}><Info label="Outstanding tenant actions" value={String(openActions.length)} /><Info label="Open maintenance" value={String(openMaintenance.length)} /><Info label="Next inspection" value={nextJob ? date(nextJob.scheduledAt) : 'Not booked'} /></Card><Card title="Recent Activity" icon={<MessageSquare size={17} />}>{timeline.slice(0, 5).map((item) => <div key={item.id} className="border-b border-slate-100 py-2 last:border-0"><div className="text-xs font-semibold">{item.title}</div><div className="text-[11px] text-slate-500">{date(item.at)} · {item.detail}</div></div>)}</Card></div>}

    {tab === 'tenancy' && <div className="grid gap-5 lg:grid-cols-2"><Card title="Tenancy Details" icon={<UserRound size={17} />}><Info label="Property" value={property?.address || 'Not linked'} /><Info label="Status" value={label(currentTenancy?.lifecycleStatus || currentTenancy?.status)} /><Info label="Lease type" value={label(currentTenancy?.leaseType)} /><Info label="Start" value={date(currentTenancy?.leaseStartDate)} /><Info label="End" value={date(currentTenancy?.leaseEndDate)} /><div className="mt-4 flex gap-2"><button disabled={busy || !currentTenancy} onClick={() => void markVacating()} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">Mark Vacating</button></div></Card><Card title="Participants" icon={<UserRound size={17} />}><div className="space-y-2">{currentTenancy && participants.filter((item) => item.tenancyId === currentTenancy.id).map((participant) => { const person = participant.tenantId === tenant.id ? tenant : null; return <div key={participant.id} className="rounded-xl bg-slate-50 p-3"><div className="text-sm font-semibold">{person?.fullName || participant.tenantId}</div><div className="text-xs text-slate-500">{label(participant.role)} · {label(participant.status)}</div></div>; })}</div><button onClick={() => setShowParticipant(true)} className="mt-3 flex items-center gap-1 text-xs font-semibold text-blue-600"><Plus size={13} /> Add Co-Tenant</button></Card></div>}

    {tab === 'inspections' && <div className="grid gap-5 lg:grid-cols-2"><ListCard title="Inspection Jobs" icon={<CalendarDays size={17} />} empty="No inspections linked to this tenant.">{tenantJobs.map((job) => <Link key={job.id} to={`/app/admin/jobs/${job.id}`} className="block rounded-xl border border-slate-200 p-3 hover:bg-slate-50"><div className="flex justify-between gap-2"><b className="text-sm">{job.reportType}</b><span className="text-xs text-slate-500">{label(job.status)}</span></div><div className="mt-1 text-xs text-slate-500">{date(job.scheduledAt)}</div></Link>)}</ListCard><ListCard title="Reports" icon={<FileText size={17} />} empty="No reports linked to this tenant.">{tenantReports.map((report) => <Link key={report.id} to={`/app/admin/reports/${report.reportId}`} className="block rounded-xl border border-slate-200 p-3 hover:bg-slate-50"><div className="flex justify-between gap-2"><b className="text-sm">{report.reportType}</b><span className="text-xs text-slate-500">{label(report.lifecycleStatus)}</span></div><div className="mt-1 text-xs text-slate-500">{date(report.inspectionDate)}</div></Link>)}</ListCard></div>}

    {tab === 'actions' && <ListCard title="Actions & Follow-Up" icon={<MessageSquare size={17} />} empty="No tenant actions recorded.">{tenantActions.map((item) => <div key={item.id} className="rounded-xl border border-slate-200 p-4"><div className="flex flex-wrap justify-between gap-2"><div><b className="text-sm">{item.title}</b><div className="mt-1 text-xs text-slate-500">{label(item.type)} · Due {date(item.dueDate)}</div></div><span className="rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase">{label(item.status)}</span></div>{item.tenantResponseNote && <div className="mt-3 rounded-lg bg-blue-50 p-3 text-xs text-blue-900">Tenant response: {item.tenantResponseNote}</div>}<div className="mt-2 text-[11px] text-slate-400">Existing approval, secure-link, evidence and resolution lifecycle is preserved for this action.</div></div>)}</ListCard>}

    {tab === 'maintenance' && <ListCard title="Tenant-linked Maintenance" icon={<Hammer size={17} />} empty="No maintenance linked to this tenancy.">{tenantMaintenance.map((item) => <Link key={item.id} to={`/app/admin/maintenance/${item.id}`} className="block rounded-xl border border-slate-200 p-4 hover:bg-slate-50"><div className="flex justify-between gap-2"><b className="text-sm">{item.title}</b><span className="text-[10px] font-bold uppercase text-slate-500">{item.priority}</span></div><div className="mt-1 text-xs text-slate-500">{item.category} · {label(item.status)}</div></Link>)}</ListCard>}

    {tab === 'communications' && <ListCard title="Communication History" icon={<Mail size={17} />} empty="No tenant communications recorded."><button onClick={() => setShowMessage(true)} className="mb-3 rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white">New Message</button>{[...tenantCommunications].sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt))).map((item) => <div key={item.id} className="rounded-xl border border-slate-200 p-4"><div className="flex justify-between"><b className="text-sm">{item.subject || label(item.channel)}</b><span className="text-[10px] font-bold uppercase">{label(item.status)}</span></div><p className="mt-2 text-xs text-slate-600">{item.message}</p><div className="mt-2 text-[11px] text-slate-400">{label(item.direction)} · {label(item.channel)} · {date(item.sentAt || item.createdAt)}</div></div>)}</ListCard>}

    {tab === 'documents' && <ListCard title="Documents & Forms" icon={<FileText size={17} />} empty="No tenancy documents recorded."><button onClick={() => setShowDocument(true)} className="mb-3 rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white">New Document</button>{tenantDocuments.map((item) => <div key={item.id} className="rounded-xl border border-slate-200 p-4"><div className="flex justify-between gap-2"><div><b className="text-sm">{item.title}</b><div className="text-xs text-slate-500">{label(item.type)}</div></div><span className="rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase">{label(item.status)}</span></div>{item.status === 'signature_required' && <div className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">Electronic signature workflow is ready to bind an immutable generated document and signing envelope to this record.</div>}</div>)}</ListCard>}

    {tab === 'access' && <ListCard title="Access & Keys" icon={<KeyRound size={17} />} empty="No access devices are linked to this property/tenancy.">{accessDevices.map((item) => <div key={item.id} className="grid gap-2 rounded-xl border border-slate-200 p-4 sm:grid-cols-[1fr_auto_auto]"><div><b className="text-sm">{item.name}</b><div className="text-xs text-slate-500">{label(item.type)} {item.identifier ? `· ${item.identifier}` : ''}</div></div><div className="text-xs">Qty {item.quantity}</div><div className="text-xs font-semibold">{label(item.status)}</div></div>)}</ListCard>}

    {tab === 'timeline' && <ListCard title="Tenant Timeline" icon={<CalendarDays size={17} />} empty="No timeline activity recorded.">{timeline.map((item) => <div key={item.id} className="flex gap-4 border-b border-slate-100 py-3 last:border-0"><div className="w-24 shrink-0 text-[11px] font-semibold text-slate-400">{date(item.at)}</div><div>{item.href ? <Link to={item.href} className="text-sm font-bold text-slate-900 hover:text-blue-600">{item.title}</Link> : <div className="text-sm font-bold">{item.title}</div>}<div className="text-xs text-slate-500">{item.detail}</div></div></div>)}</ListCard>}

    {showMessage && <Modal title="Send Tenant Communication" onClose={() => setShowMessage(false)}><form onSubmit={sendMessage} className="space-y-3"><select value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)} className="w-full rounded-lg border border-slate-200 p-2 text-sm"><option value="email">Email</option><option value="sms">SMS</option><option value="portal">Portal message</option></select><input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className="w-full rounded-lg border border-slate-200 p-2 text-sm" /><textarea required rows={5} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Message" className="w-full rounded-lg border border-slate-200 p-2 text-sm" /><button disabled={busy} className="w-full rounded-lg bg-slate-950 py-2 text-xs font-semibold text-white">Queue Communication</button></form></Modal>}
    {showDocument && <Modal title="Create Tenancy Document" onClose={() => setShowDocument(false)}><form onSubmit={createDocument} className="space-y-3"><select value={documentType} onChange={(e) => setDocumentType(e.target.value as TenancyDocument['type'])} className="w-full rounded-lg border border-slate-200 p-2 text-sm"><option value="tenancy_agreement">Tenancy Agreement</option><option value="variation">Variation</option><option value="inspection_notice">Inspection Notice</option><option value="tenant_form">Tenant Form</option><option value="notice">Notice</option><option value="information_sheet">Information Sheet</option><option value="other">Other</option></select><input required value={documentTitle} onChange={(e) => setDocumentTitle(e.target.value)} placeholder="Document title" className="w-full rounded-lg border border-slate-200 p-2 text-sm" /><button disabled={busy} className="w-full rounded-lg bg-slate-950 py-2 text-xs font-semibold text-white">Create Document Record</button></form></Modal>}
    {showParticipant && <Modal title="Add Co-Tenant" onClose={() => setShowParticipant(false)}><form onSubmit={addParticipant} className="space-y-3"><input required value={participantName} onChange={(e) => setParticipantName(e.target.value)} placeholder="Full name" className="w-full rounded-lg border border-slate-200 p-2 text-sm" /><input type="email" value={participantEmail} onChange={(e) => setParticipantEmail(e.target.value)} placeholder="Email" className="w-full rounded-lg border border-slate-200 p-2 text-sm" /><button disabled={busy} className="w-full rounded-lg bg-slate-950 py-2 text-xs font-semibold text-white">Add Participant</button></form></Modal>}
  </div>;
};

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => <div className="rounded-xl bg-slate-50 p-3"><div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</div><div className="mt-1 text-sm font-bold text-slate-900">{value}</div></div>;
const Info: React.FC<{ label: string; value: string }> = ({ label, value }) => <div className="flex justify-between gap-4 border-b border-slate-100 py-2 text-xs last:border-0"><span className="text-slate-500">{label}</span><span className="text-right font-semibold text-slate-900">{value}</span></div>;
const Card: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode }> = ({ title, icon, children }) => <section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center gap-2"><span className="text-blue-600">{icon}</span><h2 className="font-bold">{title}</h2></div><div className="mt-3">{children}</div></section>;
const ListCard: React.FC<{ title: string; icon: React.ReactNode; empty: string; children: React.ReactNode }> = ({ title, icon, empty, children }) => { const array = React.Children.toArray(children); return <section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center gap-2"><span className="text-blue-600">{icon}</span><h2 className="font-bold">{title}</h2></div><div className="mt-4 space-y-3">{array.length ? children : <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">{empty}</div>}</div></section>; };
const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"><div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"><div className="flex items-center justify-between"><h2 className="text-lg font-black">{title}</h2><button onClick={onClose} className="text-xs font-semibold text-slate-500">Close</button></div><div className="mt-4">{children}</div></div></div>;

export default TenantWorkspacePage;
