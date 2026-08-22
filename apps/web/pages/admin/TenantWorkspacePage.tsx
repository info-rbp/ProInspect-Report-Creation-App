import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CalendarDays, FileText, Hammer, KeyRound, Mail, MessageSquare, Plus, RefreshCw, UserRound } from 'lucide-react';
import type {
  ReportIndex,
  TenantInstruction,
  TenantInstructionType,
  TenantStatus,
  TenancyDocument,
  TenancyDocumentType,
  TenancyParticipant,
  TenancyParticipantRole,
} from '../../types/platform';
import { useAuth } from '../../contexts/AuthContext';
import {
  addTenancyParticipant,
  agentSignTenancyDocument,
  archiveTenancyDocument,
  createNewTenancyDocumentVersion,
  createTenant,
  generateTenancyDocument,
  getTenancyDocumentDownload,
  getTenantWorkspace,
  issueTenancyDocument,
  queueTenantCommunication,
  updateManagedTenancy,
  updateTenant,
  updateTenancyParticipant,
  type ManagedTenancy,
  type TenantWorkspace,
} from '../../services/platform/tenantDirectoryService';
import {
  createTenantInstruction,
  generateAccessGrant,
  transitionTenantInstruction,
} from '../../services/platform/maintenanceService';
import {
  getTenantActionReportSource,
  type TenantActionSourceOption,
} from '../../services/platform/tenantActionSourceService';

type Tab = 'overview' | 'tenancy' | 'inspections' | 'actions' | 'maintenance' | 'communications' | 'documents' | 'access' | 'timeline';
type ModalName = 'profile' | 'tenancy' | 'participant' | 'action' | 'message' | 'document' | null;

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
function reportLabel(report: ReportIndex): string { return `${label(String(report.reportType))} · ${date(report.inspectionDate)}`; }

const TenantWorkspacePage: React.FC = () => {
  const { tenantId } = useParams<{ tenantId: string }>();
  const { currentUser, userProfile, hasRole } = useAuth();
  const canManageTenant = hasRole('super_admin', 'proinspect_admin', 'operations');
  const canManageActions = hasRole('super_admin', 'proinspect_admin', 'operations', 'analyst', 'reviewer');
  const canCommunicate = hasRole('super_admin', 'proinspect_admin', 'operations');
  const canManageDocuments = hasRole('super_admin', 'proinspect_admin', 'operations');
  const canManagePortal = hasRole('super_admin', 'proinspect_admin', 'operations');

  const [workspace, setWorkspace] = useState<TenantWorkspace | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [modal, setModal] = useState<ModalName>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [profileName, setProfileName] = useState('');
  const [profilePreferredName, setProfilePreferredName] = useState('');
  const [profileEmail, setProfileEmail] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [profileCommunication, setProfileCommunication] = useState<'email' | 'sms' | 'portal'>('email');
  const [profileStatus, setProfileStatus] = useState<TenantStatus>('active');

  const [leaseStart, setLeaseStart] = useState('');
  const [leaseEnd, setLeaseEnd] = useState('');
  const [leaseType, setLeaseType] = useState<'fixed' | 'periodic'>('fixed');

  const [participantName, setParticipantName] = useState('');
  const [participantEmail, setParticipantEmail] = useState('');
  const [participantPhone, setParticipantPhone] = useState('');
  const [participantRole, setParticipantRole] = useState<TenancyParticipantRole>('co_tenant');

  const [actionType, setActionType] = useState<TenantInstructionType>('cleaning_request');
  const [actionTitle, setActionTitle] = useState('');
  const [actionInstruction, setActionInstruction] = useState('');
  const [actionDueDate, setActionDueDate] = useState('');
  const [actionSourceReportId, setActionSourceReportId] = useState('');
  const [actionSourceVersionId, setActionSourceVersionId] = useState<string | undefined>();
  const [actionSourceOptions, setActionSourceOptions] = useState<TenantActionSourceOption[]>([]);
  const [actionSourcePhotoId, setActionSourcePhotoId] = useState('');

  const [channel, setChannel] = useState<'email' | 'sms' | 'portal'>('email');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');

  const [documentSource, setDocumentSource] = useState<TenancyDocument | null>(null);
  const [documentTitle, setDocumentTitle] = useState('');
  const [documentType, setDocumentType] = useState<TenancyDocumentType>('tenancy_agreement');
  const [documentContent, setDocumentContent] = useState('');
  const [documentTemplateKey, setDocumentTemplateKey] = useState('');
  const [documentAcknowledgement, setDocumentAcknowledgement] = useState('I confirm that I have reviewed this document and agree that my typed name records my acknowledgement/signature.');
  const [documentFile, setDocumentFile] = useState<File | undefined>();

  const load = async () => {
    if (!tenantId) return;
    setLoading(true); setError(null);
    try { setWorkspace(await getTenantWorkspace(tenantId)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Tenant workspace could not be loaded.'); setWorkspace(null); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [tenantId]);

  const tenant = workspace?.tenant;
  const currentTenancy = workspace?.currentTenancy;
  const property = workspace?.property;
  const jobs = workspace?.jobs || [];
  const reports = workspace?.reports || [];
  const maintenance = workspace?.maintenance || [];
  const actions = workspace?.actions || [];
  const communications = workspace?.communications || [];
  const documents = workspace?.documents || [];
  const participants = workspace?.participants || [];
  const openMaintenance = maintenance.filter((item) => !TERMINAL_MAINTENANCE.has(item.status));
  const openActions = actions.filter((item) => !TERMINAL_ACTIONS.has(item.status));
  const nextJob = [...jobs].filter((item) => item.scheduledAt && !['finalised', 'archived', 'cancelled'].includes(item.status)).sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)))[0];
  const accessDevices = property?.accessDevices?.filter((item) => !item.tenancyId || item.tenancyId === currentTenancy?.id) || [];

  const timeline = useMemo(() => {
    if (!workspace) return [] as Array<{ id: string; at: string; title: string; detail: string; href?: string }>;
    const items: Array<{ id: string; at: string; title: string; detail: string; href?: string }> = [];
    for (const tenancy of workspace.linkedTenancies) items.push({ id: `tenancy-${tenancy.id}`, at: tenancy.leaseStartDate || tenancy.createdAt, title: 'Tenancy commenced', detail: `${label(tenancy.lifecycleStatus || tenancy.status)} tenancy` });
    for (const job of workspace.jobs) items.push({ id: `job-${job.id}`, at: job.scheduledAt || job.createdAt, title: `${job.reportType} inspection`, detail: label(job.status), href: `/app/admin/jobs/${job.id}` });
    for (const report of workspace.reports) items.push({ id: `report-${report.id}`, at: report.inspectionDate || report.updatedAt, title: `${report.reportType} report`, detail: label(report.lifecycleStatus), href: `/app/admin/reports/${report.reportId}` });
    for (const item of workspace.maintenance) items.push({ id: `maintenance-${item.id}`, at: item.updatedAt || item.createdAt, title: `Maintenance: ${item.title}`, detail: `${item.category} · ${label(item.status)}`, href: `/app/admin/maintenance/${item.id}` });
    for (const item of workspace.actions) items.push({ id: `action-${item.id}`, at: item.updatedAt || item.createdAt, title: `Tenant action: ${item.title}`, detail: label(item.status) });
    for (const item of workspace.communications) items.push({ id: `communication-${item.id}`, at: item.sentAt || item.createdAt, title: `${label(item.channel)} communication`, detail: item.subject || item.message.slice(0, 80) });
    for (const item of workspace.documents) items.push({ id: `document-${item.id}`, at: item.issuedAt || item.createdAt, title: `Document: ${item.title}`, detail: `${label(item.type)} · ${label(item.status)}` });
    return items.filter((item) => item.at).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }, [workspace]);

  const openProfile = () => {
    if (!tenant) return;
    setProfileName(tenant.fullName); setProfilePreferredName(tenant.preferredName || ''); setProfileEmail(tenant.email || ''); setProfilePhone(tenant.phone || ''); setProfileCommunication(tenant.preferredCommunication || 'email'); setProfileStatus(tenant.status); setModal('profile');
  };
  const openTenancy = () => {
    if (!currentTenancy) return;
    setLeaseStart(currentTenancy.leaseStartDate || ''); setLeaseEnd(currentTenancy.leaseEndDate || ''); setLeaseType(currentTenancy.leaseType || 'fixed'); setModal('tenancy');
  };

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault(); if (!tenant || !canManageTenant || !profileName.trim()) return;
    setBusy(true); setError(null);
    try {
      await updateTenant(tenant, { fullName: profileName.trim(), preferredName: profilePreferredName.trim() || undefined, email: profileEmail.trim().toLowerCase() || undefined, phone: profilePhone.trim() || undefined, preferredCommunication: profileCommunication, status: profileStatus });
      setModal(null); await load(); setNotice('Tenant profile updated.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Tenant profile could not be updated.'); }
    finally { setBusy(false); }
  };

  const saveTenancy = async (event: React.FormEvent) => {
    event.preventDefault(); if (!currentTenancy || !canManageTenant) return;
    setBusy(true); setError(null);
    try { await updateManagedTenancy(currentTenancy, { leaseStartDate: leaseStart || undefined, leaseEndDate: leaseEnd || undefined, leaseType }); setModal(null); await load(); setNotice('Tenancy details updated.'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Tenancy could not be updated.'); }
    finally { setBusy(false); }
  };

  const transitionTenancy = async (status: ManagedTenancy['lifecycleStatus']) => {
    if (!currentTenancy || !status || !canManageTenant) return;
    setBusy(true); setError(null);
    try {
      const today = new Date().toISOString().slice(0, 10);
      await updateManagedTenancy(currentTenancy, {
        lifecycleStatus: status,
        status: ['ended', 'cancelled'].includes(status) ? 'inactive' : 'active',
        ...(status === 'notice_given' ? { noticeDate: today } : {}),
        ...(status === 'vacating' ? { noticeDate: currentTenancy.noticeDate || today, vacateDate: currentTenancy.vacateDate || currentTenancy.leaseEndDate } : {}),
      });
      await load(); setNotice(`Tenancy marked ${label(status).toLowerCase()}.`);
    } catch (err) { setError(err instanceof Error ? err.message : 'Tenancy status could not be updated.'); }
    finally { setBusy(false); }
  };

  const assignManagerToMe = async () => {
    if (!currentTenancy || !currentUser || !canManageTenant) return;
    setBusy(true); setError(null);
    try { await updateManagedTenancy(currentTenancy, { assignedManagerId: currentUser.uid }); await load(); setNotice('Tenancy assigned to you.'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Property manager assignment failed.'); }
    finally { setBusy(false); }
  };

  const clearManager = async () => {
    if (!currentTenancy || !canManageTenant) return;
    setBusy(true); setError(null);
    try { await updateManagedTenancy(currentTenancy, { assignedManagerId: undefined }); await load(); setNotice('Property manager assignment cleared.'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Property manager assignment failed.'); }
    finally { setBusy(false); }
  };

  const addParticipant = async (event: React.FormEvent) => {
    event.preventDefault(); if (!currentTenancy || !participantName.trim() || !canManageTenant) return;
    setBusy(true); setError(null);
    try {
      const created = await createTenant({ fullName: participantName.trim(), email: participantEmail.trim().toLowerCase() || undefined, phone: participantPhone.trim() || undefined, preferredCommunication: participantEmail.trim() ? 'email' : 'portal' });
      await addTenancyParticipant(currentTenancy.id, created.id, participantRole);
      setParticipantName(''); setParticipantEmail(''); setParticipantPhone(''); setParticipantRole('co_tenant'); setModal(null); await load(); setNotice('Tenancy participant added.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Participant could not be added.'); }
    finally { setBusy(false); }
  };

  const changeParticipantRole = async (participant: TenancyParticipant, role: TenancyParticipantRole) => {
    if (!canManageTenant || !currentTenancy) return;
    setBusy(true); setError(null);
    try {
      if (role === 'primary_tenant') {
        for (const other of participants.filter((item) => item.tenancyId === currentTenancy.id && item.role === 'primary_tenant' && item.id !== participant.id && item.status !== 'ended')) {
          await updateTenancyParticipant(other, { role: 'co_tenant' });
        }
      }
      await updateTenancyParticipant(participant, { role }); await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Participant role could not be updated.'); }
    finally { setBusy(false); }
  };

  const endParticipant = async (participant: TenancyParticipant) => {
    if (!canManageTenant) return;
    setBusy(true); setError(null);
    try { await updateTenancyParticipant(participant, { status: 'ended', endDate: new Date().toISOString().slice(0, 10) }); await load(); setNotice('Participant ended for this tenancy.'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Participant could not be ended.'); }
    finally { setBusy(false); }
  };

  const selectActionReport = async (reportId: string) => {
    setActionSourceReportId(reportId); setActionSourcePhotoId(''); setActionSourceOptions([]); setActionSourceVersionId(undefined);
    if (!reportId) return;
    setBusy(true); setError(null);
    try {
      const source = await getTenantActionReportSource(reportId);
      setActionSourceOptions(source.evidence);
      setActionSourceVersionId(source.aggregate.report.currentVersionId);
    } catch (err) { setError(err instanceof Error ? err.message : 'Report evidence could not be loaded.'); }
    finally { setBusy(false); }
  };

  const createAction = async (event: React.FormEvent) => {
    event.preventDefault(); if (!tenant || !currentTenancy || !actionTitle.trim() || !actionInstruction.trim() || !canManageActions) return;
    const source = actionSourceOptions.find((item) => item.photoId === actionSourcePhotoId);
    setBusy(true); setError(null);
    try {
      await createTenantInstruction({
        propertyId: currentTenancy.propertyId,
        tenancyId: currentTenancy.id,
        type: actionType,
        title: actionTitle.trim(),
        instruction: actionInstruction.trim(),
        responseRequired: true,
        sourceEvidenceIds: source ? [source.photoId] : [],
        ...(actionDueDate ? { dueDate: actionDueDate } : {}),
        ...(actionSourceReportId ? { sourceReportId: actionSourceReportId } : {}),
        ...(actionSourceVersionId ? { sourceReportVersionId: actionSourceVersionId } : {}),
        ...(source?.areaId ? { sourceAreaId: source.areaId } : {}),
        ...(source?.componentId ? { sourceComponentId: source.componentId } : {}),
      });
      setActionTitle(''); setActionInstruction(''); setActionDueDate(''); setActionSourceReportId(''); setActionSourceVersionId(undefined); setActionSourcePhotoId(''); setActionSourceOptions([]); setModal(null); await load(); setTab('actions'); setNotice('Tenant action draft created.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Tenant action could not be created.'); }
    finally { setBusy(false); }
  };

  const runAction = async (item: TenantInstruction, action: Parameters<typeof transitionTenantInstruction>[1], body: Record<string, unknown> = {}) => {
    setBusy(true); setError(null);
    try { await transitionTenantInstruction(item.id, action, item.version, body); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : `Tenant action ${action} failed.`); }
    finally { setBusy(false); }
  };

  const issueAction = async (item: TenantInstruction) => {
    if (!tenant?.email) { setError('A verified tenant email is required before issuing this action.'); return; }
    setBusy(true); setError(null);
    try {
      const issued = await transitionTenantInstruction(item.id, 'issue', item.version);
      const grant = await generateAccessGrant('tenant_instruction', issued.id, tenant.email, 168);
      const url = `${window.location.origin}${grant.accessUrl}`;
      await queueTenantCommunication({ tenantId: tenant.id, tenancyId: currentTenancy?.id, propertyId: currentTenancy?.propertyId, channel: 'email', recipient: tenant.email, subject: `Action required: ${item.title}`, message: `${item.instruction}\n\nRespond securely: ${url}`, relatedEntityType: 'tenant_instruction', relatedEntityId: item.id });
      await load(); setNotice('Tenant action issued and delivery queued.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Tenant action could not be issued.'); }
    finally { setBusy(false); }
  };

  const actionControls = (item: TenantInstruction) => {
    if (!canManageActions) return null;
    if (item.status === 'draft') return <><SmallButton onClick={() => void runAction(item, 'request_approval')}>Request Approval</SmallButton><SmallButton danger onClick={() => void runAction(item, 'cancel', { reason: 'Cancelled before issue.' })}>Cancel</SmallButton></>;
    if (item.status === 'approval_required') return <SmallButton primary onClick={() => void runAction(item, 'approve')}>Approve</SmallButton>;
    if (item.status === 'approved') return <SmallButton primary onClick={() => void issueAction(item)}>Issue & Notify</SmallButton>;
    if (item.status === 'issued' || item.status === 'viewed') return <><SmallButton onClick={() => void runAction(item, 'await_action')}>Await Action</SmallButton><SmallButton danger onClick={() => { const reason = window.prompt('Withdrawal reason:')?.trim(); if (reason) void runAction(item, 'withdraw', { reason }); }}>Withdraw</SmallButton></>;
    if (item.status === 'tenant_responded') return <SmallButton primary onClick={() => void runAction(item, 'review_response')}>Review Response</SmallButton>;
    if (item.status === 'review_required') return <SmallButton primary onClick={() => { const reason = window.prompt('Resolution note:')?.trim(); if (reason) void runAction(item, 'resolve', { reason }); }}>Resolve</SmallButton>;
    if (item.status === 'resolved') return <SmallButton onClick={() => void runAction(item, 'close')}>Close</SmallButton>;
    return null;
  };

  const sendMessage = async (event: React.FormEvent) => {
    event.preventDefault(); if (!tenant || !message.trim() || !canCommunicate) return;
    const recipient = channel === 'sms' ? tenant.phone : channel === 'email' ? tenant.email : `portal:${tenant.id}`;
    if (!recipient) { setError(`Tenant has no ${channel === 'sms' ? 'phone number' : 'email address'}.`); return; }
    setBusy(true); setError(null);
    try { await queueTenantCommunication({ tenantId: tenant.id, tenancyId: currentTenancy?.id, propertyId: currentTenancy?.propertyId, channel, recipient, subject: subject.trim() || undefined, message: message.trim() }); setMessage(''); setSubject(''); setModal(null); await load(); setNotice('Communication queued.'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Communication could not be queued.'); }
    finally { setBusy(false); }
  };

  const openDocument = (source?: TenancyDocument) => {
    setDocumentSource(source || null); setDocumentTitle(source?.title || ''); setDocumentType(source?.type || 'tenancy_agreement'); setDocumentContent(source?.content || ''); setDocumentTemplateKey(source?.templateKey || ''); setDocumentAcknowledgement(source?.acknowledgementText || 'I confirm that I have reviewed this document and agree that my typed name records my acknowledgement/signature.'); setDocumentFile(undefined); setModal('document');
  };

  const saveDocument = async (event: React.FormEvent) => {
    event.preventDefault(); if (!tenant || !currentTenancy || !canManageDocuments || (!documentContent.trim() && !documentFile)) return;
    setBusy(true); setError(null);
    try {
      if (documentSource) await createNewTenancyDocumentVersion(documentSource.id, { title: documentTitle.trim() || documentSource.title, content: documentContent, file: documentFile, templateKey: documentTemplateKey.trim() || undefined, acknowledgementText: documentAcknowledgement.trim() || undefined });
      else await generateTenancyDocument({ tenantId: tenant.id, tenancyId: currentTenancy.id, propertyId: currentTenancy.propertyId, type: documentType, title: documentTitle.trim(), content: documentContent, file: documentFile, templateKey: documentTemplateKey.trim() || undefined, acknowledgementText: documentAcknowledgement.trim() || undefined });
      setModal(null); setDocumentSource(null); await load(); setNotice(documentSource ? 'New document version created; previous version archived.' : 'Document PDF generated and ready for review.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Document could not be generated.'); }
    finally { setBusy(false); }
  };

  const issueDocument = async (document: TenancyDocument) => {
    if (!canManageDocuments) return;
    setBusy(true); setError(null);
    try { await issueTenancyDocument(document.id, { agentSignatureRequired: document.type === 'tenancy_agreement', agentName: userProfile?.displayName || 'Property Manager / Agent' }); await load(); setNotice('Document issued to verified tenancy participants and invitations queued.'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Document could not be issued.'); }
    finally { setBusy(false); }
  };

  const agentSign = async (document: TenancyDocument) => {
    const signature = window.prompt('Type your full name to sign as the agent/property manager:', userProfile?.displayName || '')?.trim();
    if (!signature) return;
    setBusy(true); setError(null);
    try { await agentSignTenancyDocument(document.id, signature); await load(); setNotice('Agent signature recorded.'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Agent signature could not be recorded.'); }
    finally { setBusy(false); }
  };

  const downloadDocument = async (document: TenancyDocument) => {
    setBusy(true); setError(null);
    try { const download = await getTenancyDocumentDownload(document.id); window.open(download.url, '_blank', 'noopener,noreferrer'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Document PDF could not be opened.'); }
    finally { setBusy(false); }
  };

  const archiveDocument = async (document: TenancyDocument) => {
    if (!canManageDocuments) return;
    setBusy(true); setError(null);
    try { await archiveTenancyDocument(document.id); await load(); setNotice('Document archived.'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Document could not be archived.'); }
    finally { setBusy(false); }
  };

  if (loading) return <div className="flex h-64 items-center justify-center text-sm text-slate-500"><RefreshCw className="mr-2 animate-spin" size={16} /> Loading tenant workspace...</div>;
  if (!workspace || !tenant) return <div className="p-8 text-sm text-slate-500">{error || 'Tenant not found.'}</div>;

  return <div className="space-y-6 p-6 pb-16">
    <Link to="/app/admin/tenants" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500"><ArrowLeft size={14} /> Back to Tenants</Link>
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="text-[11px] font-bold uppercase text-blue-600">Tenant Workspace</div><h1 className="mt-1 text-3xl font-black text-slate-950">{tenant.fullName}</h1><p className="mt-1 text-sm text-slate-500">{property?.address || 'No current property'} · {tenant.email || tenant.phone || 'No contact details'}</p><div className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold uppercase"><span className="rounded-lg bg-emerald-50 px-2.5 py-1 text-emerald-700">{label(tenant.status)}</span>{currentTenancy && <span className="rounded-lg bg-blue-50 px-2.5 py-1 text-blue-700">{label(currentTenancy.lifecycleStatus || currentTenancy.status)}</span>}</div></div><div className="flex flex-wrap gap-2">{canCommunicate && <button onClick={() => setModal('message')} className="flex items-center gap-2 rounded-xl bg-slate-950 px-3 py-2 text-xs font-semibold text-white"><Mail size={14} /> Message</button>}{canManageActions && <button onClick={() => { setTab('actions'); setModal('action'); }} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold">New Action</button>}{canManagePortal && <Link to={`/app/admin/tenants/${tenant.id}/portal`} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold">Portal Access</Link>}{property && <Link to={`/app/admin/properties/${property.id}`} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold">Open Property</Link>}</div></div><div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-6"><Stat label="Current Tenancy" value={currentTenancy ? label(currentTenancy.lifecycleStatus || currentTenancy.status) : 'None'} /><Stat label="Next Inspection" value={nextJob ? date(nextJob.scheduledAt) : 'Not booked'} /><Stat label="Open Actions" value={String(openActions.length)} /><Stat label="Open Maintenance" value={String(openMaintenance.length)} /><Stat label="Documents" value={String(documents.length)} /><Stat label="Messages" value={String(communications.length)} /></div></section>
    {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
    {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}
    <nav className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">{TABS.map(([id, name]) => <button key={id} onClick={() => setTab(id)} className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold ${tab === id ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{name}</button>)}</nav>

    {tab === 'overview' && <div className="grid gap-5 lg:grid-cols-3"><Card title="Tenant Profile" icon={<UserRound size={17} />}><Info label="Preferred name" value={tenant.preferredName || tenant.fullName} /><Info label="Email" value={tenant.email || 'Not recorded'} /><Info label="Phone" value={tenant.phone || 'Not recorded'} /><Info label="Preferred contact" value={label(tenant.preferredCommunication)} />{canManageTenant && <button onClick={openProfile} className="mt-3 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold">Edit Profile</button>}</Card><Card title="Current Tenancy" icon={<CalendarDays size={17} />}><Info label="Property" value={property?.address || 'No current property'} /><Info label="Lease" value={currentTenancy ? `${date(currentTenancy.leaseStartDate)} – ${date(currentTenancy.leaseEndDate)}` : 'Not configured'} /><Info label="Type" value={label(currentTenancy?.leaseType)} /></Card><Card title="Attention Required" icon={<MessageSquare size={17} />}><Info label="Outstanding tenant actions" value={String(openActions.length)} /><Info label="Open maintenance" value={String(openMaintenance.length)} /><Info label="Next inspection" value={nextJob ? date(nextJob.scheduledAt) : 'Not booked'} /></Card></div>}

    {tab === 'tenancy' && <div className="grid gap-5 lg:grid-cols-2"><Card title="Tenancy Details" icon={<UserRound size={17} />}><Info label="Property" value={property?.address || 'Not linked'} /><Info label="Status" value={label(currentTenancy?.lifecycleStatus || currentTenancy?.status)} /><Info label="Lease type" value={label(currentTenancy?.leaseType)} /><Info label="Start" value={date(currentTenancy?.leaseStartDate)} /><Info label="End" value={date(currentTenancy?.leaseEndDate)} /><Info label="Notice date" value={date(currentTenancy?.noticeDate)} /><Info label="Vacate date" value={date(currentTenancy?.vacateDate)} /><Info label="Assigned manager" value={currentTenancy?.assignedManagerId === currentUser?.uid ? 'You' : currentTenancy?.assignedManagerId ? 'Assigned' : 'Unassigned'} />{canManageTenant && currentTenancy && <div className="mt-4 flex flex-wrap gap-2"><SmallButton onClick={openTenancy}>Edit Dates / Type</SmallButton><SmallButton onClick={() => void assignManagerToMe()}>Assign to Me</SmallButton>{currentTenancy.assignedManagerId && <SmallButton onClick={() => void clearManager()}>Clear Manager</SmallButton>}<SmallButton onClick={() => void transitionTenancy('notice_given')}>Notice Given</SmallButton><SmallButton onClick={() => void transitionTenancy('vacating')}>Vacating</SmallButton><SmallButton primary onClick={() => void transitionTenancy('active')}>Active</SmallButton><SmallButton danger onClick={() => void transitionTenancy('ended')}>End Tenancy</SmallButton><SmallButton danger onClick={() => void transitionTenancy('cancelled')}>Cancel</SmallButton></div>}</Card><Card title="Participants" icon={<UserRound size={17} />}><div className="space-y-2">{participants.filter((item) => item.tenancyId === currentTenancy?.id).map((participant) => <div key={participant.id} className="rounded-xl bg-slate-50 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><div className="text-sm font-semibold">{participant.tenant?.fullName || participant.tenantId}</div><div className="text-xs text-slate-500">{participant.tenant?.email || 'No email'} · {label(participant.status)}</div></div>{canManageTenant && participant.status !== 'ended' ? <div className="flex gap-2"><select value={participant.role} onChange={(e) => void changeParticipantRole(participant, e.target.value as TenancyParticipantRole)} className="rounded-lg border border-slate-200 bg-white p-2 text-xs"><option value="primary_tenant">Primary tenant</option><option value="co_tenant">Co-tenant</option><option value="approved_occupant">Approved occupant</option></select><SmallButton danger onClick={() => void endParticipant(participant)}>End</SmallButton></div> : <span className="text-xs font-semibold">{label(participant.role)}</span>}</div></div>)}</div>{canManageTenant && currentTenancy && <button onClick={() => setModal('participant')} className="mt-3 flex items-center gap-1 text-xs font-semibold text-blue-600"><Plus size={13} /> Add Participant</button>}</Card></div>}

    {tab === 'inspections' && <div className="grid gap-5 lg:grid-cols-2"><ListCard title="Inspection Jobs" icon={<CalendarDays size={17} />} empty="No inspections linked to this tenant.">{jobs.map((job) => <Link key={job.id} to={`/app/admin/jobs/${job.id}`} className="block rounded-xl border border-slate-200 p-3 hover:bg-slate-50"><div className="flex justify-between gap-2"><b className="text-sm">{job.reportType}</b><span className="text-xs text-slate-500">{label(job.status)}</span></div><div className="mt-1 text-xs text-slate-500">{date(job.scheduledAt)}</div></Link>)}</ListCard><ListCard title="Reports" icon={<FileText size={17} />} empty="No reports linked to this tenant.">{reports.map((report) => <Link key={report.id} to={`/app/admin/reports/${report.reportId}`} className="block rounded-xl border border-slate-200 p-3 hover:bg-slate-50"><div className="flex justify-between gap-2"><b className="text-sm">{report.reportType}</b><span className="text-xs text-slate-500">{label(report.lifecycleStatus)}</span></div><div className="mt-1 text-xs text-slate-500">{date(report.inspectionDate)}</div></Link>)}</ListCard></div>}

    {tab === 'actions' && <ListCard title="Actions & Follow-Up" icon={<MessageSquare size={17} />} empty="No tenant actions recorded.">{canManageActions && <button onClick={() => setModal('action')} className="mb-3 rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white">New Contextual Action</button>}{actions.map((item) => <div key={item.id} className="rounded-xl border border-slate-200 p-4"><div className="flex flex-wrap justify-between gap-2"><div><b className="text-sm">{item.title}</b><div className="mt-1 text-xs text-slate-500">{label(item.type)} · Due {date(item.dueDate)}</div></div><span className="rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase">{label(item.status)}</span></div><p className="mt-3 text-xs text-slate-700">{item.instruction}</p>{item.sourceReportId && <div className="mt-2 text-[11px] text-slate-500">Source: <Link className="text-blue-600" to={`/app/admin/reports/${item.sourceReportId}`}>report</Link>{item.sourceAreaId ? ` · area ${item.sourceAreaId}` : ''}{item.sourceComponentId ? ` · component ${item.sourceComponentId}` : ''} · {item.sourceEvidenceIds.length} evidence item{item.sourceEvidenceIds.length === 1 ? '' : 's'}</div>}{item.tenantResponseNote && <div className="mt-3 rounded-lg bg-blue-50 p-3 text-xs text-blue-900">Tenant response: {item.tenantResponseNote}</div>}<div className="mt-3 flex flex-wrap gap-2">{actionControls(item)}</div></div>)}</ListCard>}

    {tab === 'maintenance' && <ListCard title="Tenant-linked Maintenance" icon={<Hammer size={17} />} empty="No maintenance linked to this tenancy.">{maintenance.map((item) => <Link key={item.id} to={`/app/admin/maintenance/${item.id}`} className="block rounded-xl border border-slate-200 p-4 hover:bg-slate-50"><div className="flex justify-between gap-2"><b className="text-sm">{item.title}</b><span className="text-[10px] font-bold uppercase text-slate-500">{item.priority}</span></div><div className="mt-1 text-xs text-slate-500">{item.category} · {label(item.status)}</div></Link>)}</ListCard>}

    {tab === 'communications' && <ListCard title="Communication History" icon={<Mail size={17} />} empty="No tenant communications recorded.">{canCommunicate && <button onClick={() => setModal('message')} className="mb-3 rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white">New Message</button>}{[...communications].sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt))).map((item) => <div key={item.id} className="rounded-xl border border-slate-200 p-4"><div className="flex justify-between"><b className="text-sm">{item.subject || label(item.channel)}</b><span className="text-[10px] font-bold uppercase">{label(item.status)}</span></div><p className="mt-2 text-xs text-slate-600">{item.message}</p><div className="mt-2 text-[11px] text-slate-400">{label(item.direction)} · {label(item.channel)} · {date(item.sentAt || item.createdAt)}</div></div>)}</ListCard>}

    {tab === 'documents' && <ListCard title="Documents & Forms" icon={<FileText size={17} />} empty="No tenancy documents recorded.">{canManageDocuments && <button onClick={() => openDocument()} className="mb-3 rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white">Generate / Upload Document</button>}{[...documents].sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt))).map((item) => { const agentSigner = item.signers?.find((signer) => signer.kind === 'agent' && signer.userId === currentUser?.uid); return <div key={item.id} className="rounded-xl border border-slate-200 p-4"><div className="flex justify-between gap-2"><div><b className="text-sm">{item.title}</b><div className="text-xs text-slate-500">{label(item.type)} · Version {item.documentVersion || 1}{item.sha256 ? ` · SHA ${item.sha256.slice(0, 10)}…` : ''}</div></div><span className="rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase">{label(item.status)}</span></div>{item.signers?.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{item.signers.map((signer) => <div key={signer.id} className="rounded-lg bg-slate-50 p-2 text-xs"><div className="font-semibold">{signer.name || label(signer.kind)}</div><div className={signer.status === 'signed' ? 'text-emerald-700' : 'text-amber-700'}>{signer.status === 'signed' ? `Signed ${date(signer.signedAt)}` : 'Pending signature'}</div></div>)}</div> : null}<div className="mt-3 flex flex-wrap gap-2">{item.objectPath && <SmallButton onClick={() => void downloadDocument(item)}>Download PDF</SmallButton>}{canManageDocuments && item.status === 'ready' && <SmallButton primary onClick={() => void issueDocument(item)}>Issue & Send</SmallButton>}{canManageDocuments && agentSigner?.status === 'pending' && ['signature_required','partially_signed'].includes(item.status) && <SmallButton primary onClick={() => void agentSign(item)}>Sign as Agent</SmallButton>}{canManageDocuments && !['draft','ready'].includes(item.status) && <SmallButton onClick={() => openDocument(item)}>New Version</SmallButton>}{canManageDocuments && item.status !== 'archived' && <SmallButton danger onClick={() => void archiveDocument(item)}>Archive</SmallButton>}</div></div>; })}</ListCard>}

    {tab === 'access' && <ListCard title="Access & Keys" icon={<KeyRound size={17} />} empty="No access devices are linked to this property/tenancy.">{accessDevices.map((item) => <div key={item.id} className="grid gap-2 rounded-xl border border-slate-200 p-4 sm:grid-cols-[1fr_auto_auto]"><div><b className="text-sm">{item.name}</b><div className="text-xs text-slate-500">{label(item.type)} {item.identifier ? `· ${item.identifier}` : ''}</div></div><div className="text-xs">Qty {item.quantity}</div><div className="text-xs font-semibold">{label(item.status)}</div></div>)}</ListCard>}

    {tab === 'timeline' && <ListCard title="Tenant Timeline" icon={<CalendarDays size={17} />} empty="No timeline activity recorded.">{timeline.map((item) => <div key={item.id} className="flex gap-4 border-b border-slate-100 py-3 last:border-0"><div className="w-24 shrink-0 text-[11px] font-semibold text-slate-400">{date(item.at)}</div><div>{item.href ? <Link to={item.href} className="text-sm font-bold text-slate-900 hover:text-blue-600">{item.title}</Link> : <div className="text-sm font-bold">{item.title}</div>}<div className="text-xs text-slate-500">{item.detail}</div></div></div>)}</ListCard>}

    {modal === 'profile' && <Modal title="Edit Tenant Profile" onClose={() => setModal(null)}><form onSubmit={saveProfile} className="grid gap-3 sm:grid-cols-2"><Field label="Full name"><input required value={profileName} onChange={(e) => setProfileName(e.target.value)} className="control" /></Field><Field label="Preferred name"><input value={profilePreferredName} onChange={(e) => setProfilePreferredName(e.target.value)} className="control" /></Field><Field label="Email"><input type="email" value={profileEmail} onChange={(e) => setProfileEmail(e.target.value)} className="control" /></Field><Field label="Phone"><input value={profilePhone} onChange={(e) => setProfilePhone(e.target.value)} className="control" /></Field><Field label="Preferred communication"><select value={profileCommunication} onChange={(e) => setProfileCommunication(e.target.value as typeof profileCommunication)} className="control"><option value="email">Email</option><option value="sms">SMS</option><option value="portal">Portal</option></select></Field><Field label="Tenant status"><select value={profileStatus} onChange={(e) => setProfileStatus(e.target.value as TenantStatus)} className="control"><option value="active">Active</option><option value="inactive">Inactive</option><option value="archived">Archived</option></select></Field><Submit busy={busy}>Save Profile</Submit></form></Modal>}
    {modal === 'tenancy' && <Modal title="Edit Tenancy" onClose={() => setModal(null)}><form onSubmit={saveTenancy} className="grid gap-3 sm:grid-cols-2"><Field label="Lease start"><input type="date" value={leaseStart} onChange={(e) => setLeaseStart(e.target.value)} className="control" /></Field><Field label="Lease end"><input type="date" value={leaseEnd} onChange={(e) => setLeaseEnd(e.target.value)} className="control" /></Field><Field label="Lease type"><select value={leaseType} onChange={(e) => setLeaseType(e.target.value as typeof leaseType)} className="control"><option value="fixed">Fixed term</option><option value="periodic">Periodic</option></select></Field><Submit busy={busy}>Save Tenancy</Submit></form></Modal>}
    {modal === 'participant' && <Modal title="Add Tenancy Participant" onClose={() => setModal(null)}><form onSubmit={addParticipant} className="grid gap-3 sm:grid-cols-2"><Field label="Full name"><input required value={participantName} onChange={(e) => setParticipantName(e.target.value)} className="control" /></Field><Field label="Email"><input type="email" value={participantEmail} onChange={(e) => setParticipantEmail(e.target.value)} className="control" /></Field><Field label="Phone"><input value={participantPhone} onChange={(e) => setParticipantPhone(e.target.value)} className="control" /></Field><Field label="Role"><select value={participantRole} onChange={(e) => setParticipantRole(e.target.value as TenancyParticipantRole)} className="control"><option value="co_tenant">Co-tenant</option><option value="approved_occupant">Approved occupant</option><option value="primary_tenant">Primary tenant</option></select></Field><Submit busy={busy}>Add Participant</Submit></form></Modal>}
    {modal === 'action' && <Modal title="Create Tenant Action" onClose={() => setModal(null)}><form onSubmit={createAction} className="space-y-3"><div className="grid gap-3 sm:grid-cols-2"><Field label="Action type"><select value={actionType} onChange={(e) => setActionType(e.target.value as TenantInstructionType)} className="control"><option value="cleaning_request">Cleaning request</option><option value="access_request">Access request</option><option value="photo_request">Photo / evidence request</option><option value="info_request">Information request</option><option value="general_followup">General follow-up</option></select></Field><Field label="Due date"><input type="date" value={actionDueDate} onChange={(e) => setActionDueDate(e.target.value)} className="control" /></Field></div><Field label="Title"><input required value={actionTitle} onChange={(e) => setActionTitle(e.target.value)} className="control" /></Field><Field label="Instruction"><textarea required rows={4} value={actionInstruction} onChange={(e) => setActionInstruction(e.target.value)} className="control" /></Field><Field label="Source inspection report (optional)"><select value={actionSourceReportId} onChange={(e) => void selectActionReport(e.target.value)} className="control"><option value="">No source report</option>{reports.map((report) => <option key={report.id} value={report.reportId}>{reportLabel(report)}</option>)}</select></Field>{actionSourceReportId && <Field label="Source evidence (optional)"><select value={actionSourcePhotoId} onChange={(e) => setActionSourcePhotoId(e.target.value)} className="control"><option value="">No specific photo</option>{actionSourceOptions.map((option) => <option key={`${option.photoId}-${option.areaId}-${option.componentId || ''}`} value={option.photoId}>{option.label}</option>)}</select></Field>}<Submit busy={busy}>Create Draft</Submit></form></Modal>}
    {modal === 'message' && <Modal title="Send Tenant Communication" onClose={() => setModal(null)}><form onSubmit={sendMessage} className="space-y-3"><select value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)} className="control"><option value="email">Email</option><option value="sms">SMS</option><option value="portal">Portal message</option></select><input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className="control" /><textarea required rows={5} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Message" className="control" /><Submit busy={busy}>Queue Communication</Submit></form></Modal>}
    {modal === 'document' && <Modal title={documentSource ? `New Version: ${documentSource.title}` : 'Generate / Upload Tenancy Document'} onClose={() => setModal(null)}><form onSubmit={saveDocument} className="space-y-3"><div className="grid gap-3 sm:grid-cols-2"><Field label="Document type"><select disabled={Boolean(documentSource)} value={documentType} onChange={(e) => setDocumentType(e.target.value as TenancyDocumentType)} className="control"><option value="tenancy_agreement">Tenancy Agreement</option><option value="variation">Variation</option><option value="inspection_notice">Inspection Notice</option><option value="tenant_form">Tenant Form</option><option value="notice">Notice</option><option value="information_sheet">Information Sheet</option><option value="other">Other</option></select></Field><Field label="Template key"><input value={documentTemplateKey} onChange={(e) => setDocumentTemplateKey(e.target.value)} placeholder="Optional template/version reference" className="control" /></Field></div><Field label="Title"><input required value={documentTitle} onChange={(e) => setDocumentTitle(e.target.value)} className="control" /></Field><Field label="Author document content"><textarea rows={10} value={documentContent} onChange={(e) => setDocumentContent(e.target.value)} placeholder="Enter document/form content, or upload an existing PDF below." className="control" /></Field><Field label="Or upload PDF"><input type="file" accept="application/pdf,.pdf" onChange={(e) => setDocumentFile(e.target.files?.[0])} className="control" /></Field><Field label="Acknowledgement / signature statement"><textarea rows={3} value={documentAcknowledgement} onChange={(e) => setDocumentAcknowledgement(e.target.value)} className="control" /></Field><Submit busy={busy}>{documentSource ? 'Create New Version' : 'Generate Document PDF'}</Submit></form></Modal>}
  </div>;
};

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => <div className="rounded-xl bg-slate-50 p-3"><div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</div><div className="mt-1 text-sm font-bold text-slate-900">{value}</div></div>;
const Info: React.FC<{ label: string; value: string }> = ({ label, value }) => <div className="flex justify-between gap-4 border-b border-slate-100 py-2 text-xs last:border-0"><span className="text-slate-500">{label}</span><span className="text-right font-semibold text-slate-900">{value}</span></div>;
const Card: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode }> = ({ title, icon, children }) => <section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center gap-2"><span className="text-blue-600">{icon}</span><h2 className="font-bold">{title}</h2></div><div className="mt-3">{children}</div></section>;
const ListCard: React.FC<{ title: string; icon: React.ReactNode; empty: string; children: React.ReactNode }> = ({ title, icon, empty, children }) => { const array = React.Children.toArray(children); return <section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center gap-2"><span className="text-blue-600">{icon}</span><h2 className="font-bold">{title}</h2></div><div className="mt-4 space-y-3">{array.length ? children : <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">{empty}</div>}</div></section>; };
const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/40 p-4"><div className="my-8 w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl"><div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-lg font-black">{title}</h2><button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1 text-xs">Close</button></div>{children}</div></div>;
const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => <label className="block text-xs font-semibold text-slate-700">{label}<div className="mt-1">{children}</div></label>;
const Submit: React.FC<{ busy: boolean; children: React.ReactNode }> = ({ busy, children }) => <button disabled={busy} className="w-full rounded-lg bg-slate-950 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50">{busy ? 'Saving...' : children}</button>;
const SmallButton: React.FC<{ onClick: () => void; children: React.ReactNode; primary?: boolean; danger?: boolean }> = ({ onClick, children, primary, danger }) => <button disabled={false} type="button" onClick={onClick} className={`rounded-lg px-3 py-2 text-xs font-semibold ${primary ? 'bg-slate-950 text-white' : danger ? 'border border-rose-200 bg-rose-50 text-rose-700' : 'border border-slate-200 bg-white text-slate-700'}`}>{children}</button>;

export default TenantWorkspacePage;
