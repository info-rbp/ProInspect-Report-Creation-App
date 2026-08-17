import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Building,
  CheckCircle2,
  Clock,
  Edit3,
  ExternalLink,
  FileText,
  Folder,
  Lock,
  RefreshCw,
  ShieldAlert,
  ShoppingBag,
  Trash2,
  X,
} from 'lucide-react';
import type { AuditEvent, InspectionJob, InspectionJobStatus, PropertyRecord } from '../../types/platform';
import {
  deleteInspectionJob,
  getInspectionJob,
  getInspectionJobWorkflow,
  updateInspectionJob,
  updateInspectionJobStatus,
  type InspectionJobWorkflowInfo,
  type WorkflowAction,
} from '../../services/platform/inspectionJobService';
import { createInspectionReportForJob } from '../../services/platform/inspectionReportService';
import { getProperty } from '../../services/platform/propertyService';
import { listAuditEventsForEntity } from '../../services/platform/auditService';
import { InspectionJobFormModal } from '../../components/jobs/InspectionJobFormModal';

const WORKFLOW_STEPS: { id: string; label: string; statuses: InspectionJobStatus[] }[] = [
  { id: '1', label: 'Booked / Scheduled', statuses: ['draft', 'booked', 'assigned'] },
  { id: '2', label: 'Field Inspection', statuses: ['inspection_started', 'photos_uploading', 'photos_uploaded', 'inspection_submitted'] },
  { id: '3', label: 'AI & Review', statuses: ['analysis_queued', 'analysis_running', 'analysis_failed', 'analysis_complete', 'review_required', 'analyst_review_in_progress', 'reviewer_review_in_progress', 'changes_requested'] },
  { id: '4', label: 'Approved', statuses: ['reviewer_approved', 'ready_to_issue'] },
  { id: '5', label: 'Issued & Finalised', statuses: ['issued_to_tenant', 'tenant_viewed', 'tenant_response_in_progress', 'tenant_submitted', 'agent_response_required', 'finalisation_ready', 'finalised', 'archived'] },
];

function inspectionDate(job: InspectionJob): string {
  if (!job.scheduledAt) return new Date().toISOString().slice(0, 10);
  const value = new Date(job.scheduledAt);
  return Number.isNaN(value.getTime()) ? new Date().toISOString().slice(0, 10) : value.toISOString().slice(0, 10);
}

function errorText(error: unknown, fallback: string): string {
  const apiError = error as { message?: string; details?: { blockers?: Array<{ message?: string }> } };
  const blockers = apiError.details?.blockers?.map((blocker) => blocker.message).filter(Boolean) ?? [];
  return blockers.length ? `${apiError.message || fallback} Blockers: ${blockers.join(' ')}` : apiError.message || fallback;
}

export const InspectionJobDetailPage: React.FC = () => {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();

  const [job, setJob] = useState<InspectionJob | null>(null);
  const [property, setProperty] = useState<PropertyRecord | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [workflowInfo, setWorkflowInfo] = useState<InspectionJobWorkflowInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [transitioning, setTransitioning] = useState(false);
  const [creatingReport, setCreatingReport] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesText, setNotesText] = useState('');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [propertiesList, setPropertiesList] = useState<PropertyRecord[]>([]);
  const [pendingAction, setPendingAction] = useState<WorkflowAction | null>(null);
  const [transitionReason, setTransitionReason] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadJobData = async () => {
    if (!jobId) return;
    setLoading(true);
    try {
      const nextJob = await getInspectionJob(jobId);
      if (!nextJob) {
        setJob(null);
        return;
      }
      setJob(nextJob);
      setNotesText(nextJob.notes || '');
      const nextProperty = await getProperty(nextJob.propertyId);
      setProperty(nextProperty || null);
      setPropertiesList(nextProperty ? [nextProperty] : []);
      const [events, workflow] = await Promise.all([
        listAuditEventsForEntity('inspection_job', jobId),
        getInspectionJobWorkflow(jobId),
      ]);
      setAuditEvents(events);
      setWorkflowInfo(workflow ?? null);
    } catch (error) {
      console.error('Failed to load inspection job detail:', error);
      setErrorMessage(errorText(error, 'Inspection job details could not be loaded.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadJobData();
  }, [jobId]);

  const handleExecuteTransition = async (targetStatus: string, reason?: string) => {
    if (!job) return;
    setTransitioning(true);
    setErrorMessage(null);
    try {
      const updated = await updateInspectionJobStatus(job.id, targetStatus as InspectionJobStatus, reason);
      setJob(updated);
      setPendingAction(null);
      setTransitionReason('');
      await loadJobData();
    } catch (error) {
      setErrorMessage(errorText(error, 'Workflow transition failed.'));
    } finally {
      setTransitioning(false);
    }
  };

  const handleActionClick = (action: WorkflowAction) => {
    if (action.reasonRequired) {
      setPendingAction(action);
      setTransitionReason('');
      return;
    }
    void handleExecuteTransition(action.targetStatus);
  };

  const handleSaveNotes = async () => {
    if (!job) return;
    setSavingNotes(true);
    setErrorMessage(null);
    try {
      setJob(await updateInspectionJob(job.id, { notes: notesText.trim() }));
    } catch (error) {
      setErrorMessage(errorText(error, 'Notes could not be saved.'));
    } finally {
      setSavingNotes(false);
    }
  };

  const handleDelete = async () => {
    if (!job) return;
    try {
      await deleteInspectionJob(job.id);
      navigate('/app/admin/jobs');
    } catch (error) {
      setIsDeleting(false);
      setErrorMessage(errorText(error, 'Inspection job could not be deleted.'));
    }
  };

  const handleCreateOrOpenReport = async () => {
    if (!job) return;
    if (job.reportId) {
      navigate(`/app/admin/reports/${job.reportId}/edit`);
      return;
    }
    if (!property) {
      setErrorMessage('A linked property record is required before an inspection report can be created.');
      return;
    }

    setCreatingReport(true);
    setErrorMessage(null);
    try {
      const aggregate = await createInspectionReportForJob(job, property, {
        clientName: property.landlordDetails?.name || '',
        inspectionDate: inspectionDate(job),
      });
      navigate(`/app/admin/reports/${aggregate.report.id}/edit`);
    } catch (error) {
      setErrorMessage(errorText(error, 'The linked report could not be created.'));
    } finally {
      setCreatingReport(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center rounded-2xl border border-slate-200 bg-white p-8 text-slate-500 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2 text-sm"><RefreshCw className="h-4 w-4 animate-spin text-blue-600" /> Loading inspection job details...</div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="space-y-4">
        <Link to="/app/admin/jobs" className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-blue-600 dark:text-slate-400">
          <ArrowLeft className="h-4 w-4" /> Back to Inspection Jobs
        </Link>
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500 dark:border-slate-800 dark:bg-slate-900">
          <AlertCircle className="mx-auto mb-3 h-10 w-10 text-slate-300" />
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">Inspection Job Not Found</h3>
          <p className="mt-1 text-xs text-slate-500">The requested inspection job ID does not exist or has been deleted.</p>
        </div>
      </div>
    );
  }

  const currentStepIndex = Math.max(0, WORKFLOW_STEPS.findIndex((step) => step.statuses.includes(job.status)));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <Link to="/app/admin/jobs" className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-blue-600 dark:text-slate-400">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Inspection Jobs Queue
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{property?.address || 'Inspection Job Console'}</h1>
            <span className="rounded-full bg-slate-100 px-3 py-1 font-mono text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">#{job.id}</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">{job.reportType} • Agency: {job.agencyId}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => void handleCreateOrOpenReport()}
            disabled={creatingReport}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {creatingReport ? <RefreshCw className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            <span>{job.reportId ? 'Open Report Editor' : creatingReport ? 'Creating Report...' : 'Create Linked Report'}</span>
          </button>
          <button onClick={() => setIsEditModalOpen(true)} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800">
            <Edit3 className="h-3.5 w-3.5" /> Edit Job
          </button>
          <button onClick={() => setIsDeleting(true)} className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="flex items-start justify-between rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-200">
          <div className="flex items-start gap-2.5"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /><span>{errorMessage}</span></div>
          <button onClick={() => setErrorMessage(null)}><X className="h-4 w-4" /></button>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Live Inspection Lifecycle</h2>
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Current: <span className="capitalize text-blue-600 dark:text-blue-400">{job.status.replaceAll('_', ' ')}</span></span>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
          {WORKFLOW_STEPS.map((step, index) => {
            const done = index < currentStepIndex;
            const current = index === currentStepIndex;
            return (
              <div key={step.id} className={`rounded-xl border p-3 text-xs ${current ? 'border-blue-500 bg-blue-50/60 text-blue-900 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-200' : done ? 'border-emerald-200 bg-emerald-50/40 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300' : 'border-slate-100 bg-slate-50/50 text-slate-400 dark:border-slate-800 dark:bg-slate-800/40'}`}>
                <div className="flex items-center justify-between"><span className="text-[10px] font-mono font-bold uppercase opacity-70">Stage 0{step.id}</span>{done ? <CheckCircle2 className="h-4 w-4" /> : current ? <Clock className="h-4 w-4 animate-pulse" /> : null}</div>
                <div className="mt-2 font-bold">{step.label}</div>
              </div>
            );
          })}
        </div>

        <div className="mt-5 space-y-4 border-t border-slate-100 pt-4 dark:border-slate-800">
          <div>
            <span className="mb-2 block text-xs font-bold text-slate-700 dark:text-slate-300">Permitted Workflow Transitions (Server-Authoritative)</span>
            {workflowInfo?.availableActions.length ? (
              <div className="flex flex-wrap gap-2">
                {workflowInfo.availableActions.map((action) => (
                  <button key={action.targetStatus} onClick={() => handleActionClick(action)} disabled={transitioning} className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50">
                    {transitioning ? <RefreshCw className="h-3 w-3 animate-spin" /> : null}{action.label}
                  </button>
                ))}
              </div>
            ) : <p className="text-xs italic text-slate-500">No additional permitted transitions are available for the current role and gate state.</p>}
          </div>

          {workflowInfo?.blockedActions.length ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 text-xs dark:border-amber-900/40 dark:bg-amber-950/20">
              <div className="mb-2 flex items-center gap-2 font-bold text-amber-900 dark:text-amber-300"><Lock className="h-3.5 w-3.5" /> Gated Workflow Actions ({workflowInfo.blockedActions.length})</div>
              <div className="space-y-2">
                {workflowInfo.blockedActions.map((blocked) => (
                  <div key={blocked.targetStatus} className="rounded-lg border border-amber-200/80 bg-white p-2.5 dark:border-slate-800 dark:bg-slate-900">
                    <div className="font-semibold text-slate-900 dark:text-white">{blocked.label}</div>
                    {blocked.blockers.length ? <ul className="mt-1 space-y-1 text-[11px] text-amber-800 dark:text-amber-400">{blocked.blockers.map((blocker, index) => <li key={`${blocked.targetStatus}-${index}`}>• {blocker.message}</li>)}</ul> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3 dark:border-slate-800"><Clock className="h-4 w-4 text-blue-500" /><h2 className="text-sm font-bold text-slate-900 dark:text-white">Schedule & Parameters</h2></div>
          <dl className="mt-4 space-y-3 text-xs">
            <div className="flex justify-between"><dt className="text-slate-400">Scheduled:</dt><dd className="font-semibold text-slate-900 dark:text-white">{job.scheduledAt ? new Date(job.scheduledAt).toLocaleString() : 'Not Scheduled'}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-400">Report Type:</dt><dd className="font-semibold text-slate-900 dark:text-white">{job.reportType}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-400">Inspector:</dt><dd className="font-semibold text-blue-600">{job.assignedInspectorId || 'Unassigned'}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-400">Reviewer:</dt><dd className="font-semibold text-purple-600">{job.assignedReviewerId || 'Unassigned'}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-400">Tenancy:</dt><dd className="font-mono text-slate-700 dark:text-slate-300">{job.tenancyId || 'N/A'}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-400">Version:</dt><dd className="font-mono text-slate-700 dark:text-slate-300">{job.version ?? 'Local'}</dd></div>
          </dl>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800"><div className="flex items-center gap-2"><Building className="h-4 w-4 text-emerald-500" /><h2 className="text-sm font-bold text-slate-900 dark:text-white">Property & Contacts</h2></div>{property ? <Link to={`/app/admin/properties/${property.id}`} className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline">View <ExternalLink className="h-3 w-3" /></Link> : null}</div>
          {property ? <div className="mt-4 space-y-3 text-xs"><div><span className="text-slate-400">Address</span><p className="font-semibold text-slate-900 dark:text-white">{[property.address, property.suburb, property.state, property.postcode].filter(Boolean).join(', ')}</p></div><div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-2 text-center text-[11px] font-semibold dark:bg-slate-800/60"><div>Beds: {property.bedrooms ?? '-'}</div><div>Baths: {property.bathrooms ?? '-'}</div><div>Type: {property.propertyType ?? 'House'}</div></div>{property.landlordDetails?.name ? <div><span className="text-slate-400">Landlord</span><p className="font-medium">{property.landlordDetails.name}</p></div> : null}{property.tenantDetails?.primaryTenantName ? <div><span className="text-slate-400">Primary Tenant</span><p className="font-medium">{property.tenantDetails.primaryTenantName}</p></div> : null}</div> : <p className="mt-4 text-xs italic text-slate-400">No linked property record found.</p>}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3 dark:border-slate-800"><FileText className="h-4 w-4 text-purple-500" /><h2 className="text-sm font-bold text-slate-900 dark:text-white">Linked Assets</h2></div>
          <div className="mt-4 space-y-3 text-xs">
            <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3 dark:border-slate-800 dark:bg-slate-800/40"><div className="flex items-center justify-between"><span className="font-semibold">Inspection Report</span><span className={job.reportId ? 'text-emerald-700' : 'text-amber-600'}>{job.reportId ? 'Linked' : 'Not Linked'}</span></div><p className="mt-1 font-mono text-[11px] text-slate-500">{job.reportId || 'Created only through the server-authoritative inspection command.'}</p><button onClick={() => void handleCreateOrOpenReport()} disabled={creatingReport} className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:underline disabled:opacity-50">{job.reportId ? 'Open Report Editor' : 'Create & Link Report'} <ExternalLink className="h-3 w-3" /></button></div>
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800"><Folder className="h-4 w-4 text-amber-500" /><div><div className="font-semibold">Google Drive Folder</div><div className="font-mono text-[11px] text-slate-400">{job.googleDriveFolderId || 'Unset'}</div></div></div>
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800"><ShoppingBag className="h-4 w-4 text-emerald-500" /><div><div className="font-semibold">Shopify Order</div><div className="font-mono text-[11px] text-slate-400">{job.shopifyOrderId || 'None'}</div></div></div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-bold text-slate-900 dark:text-white">Field Notes & Access Instructions</h2><button onClick={() => void handleSaveNotes()} disabled={savingNotes} className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 dark:bg-blue-600">{savingNotes ? 'Saving...' : 'Save Notes'}</button></div>
        <textarea rows={3} value={notesText} onChange={(event) => setNotesText(event.target.value)} placeholder="Add specific access notes, key codes, tenant entry instructions..." className="w-full rounded-xl border border-slate-200 bg-slate-50/50 p-3 text-xs focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-800/50" />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h2 className="mb-4 text-sm font-bold text-slate-900 dark:text-white">Audit & Event Log</h2>
        {auditEvents.length ? <div className="space-y-3">{auditEvents.map((event) => <div key={event.id} className="flex items-start gap-3 text-xs"><div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800"><Clock className="h-3.5 w-3.5" /></div><div className="flex-1"><div className="flex justify-between"><span className="font-semibold">{event.eventType}</span><span className="text-[11px] text-slate-400">{new Date(event.timestamp).toLocaleString()}</span></div><p className="text-slate-500">Actor: {event.actorId || 'System'} {event.actorRole ? `(${event.actorRole})` : ''}</p></div></div>)}</div> : <p className="text-xs italic text-slate-400">No audit events logged for this job yet.</p>}
      </div>

      <InspectionJobFormModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        onSave={async (updatedData) => {
          const updated = await updateInspectionJob(job.id, updatedData);
          setJob(updated);
          await loadJobData();
        }}
        properties={propertiesList}
        initialJob={job}
      />

      {pendingAction ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800"><h3 className="text-sm font-bold">Reason Required: {pendingAction.label}</h3><button onClick={() => setPendingAction(null)}><X className="h-4 w-4" /></button></div>
            <p className="mt-3 text-xs text-slate-600 dark:text-slate-400">Provide the required audit reason for this workflow transition.</p>
            <textarea rows={3} value={transitionReason} onChange={(event) => setTransitionReason(event.target.value)} className="mt-3 w-full rounded-xl border border-slate-200 p-3 text-xs dark:border-slate-800 dark:bg-slate-800" />
            <div className="mt-4 flex justify-end gap-2"><button onClick={() => setPendingAction(null)} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold">Cancel</button><button onClick={() => void handleExecuteTransition(pendingAction.targetStatus, transitionReason)} disabled={!transitionReason.trim() || transitioning} className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">Confirm Transition</button></div>
          </div>
        </div>
      ) : null}

      {isDeleting ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
            <div className="flex items-center gap-3"><div className="rounded-full bg-rose-100 p-2 text-rose-600"><AlertTriangle className="h-5 w-5" /></div><div><h3 className="text-sm font-bold">Delete Inspection Job</h3><p className="text-xs text-slate-500">This removes the job record. Linked reports remain retained.</p></div></div>
            <p className="mt-4 text-xs text-slate-600 dark:text-slate-300">Delete inspection job #{job.id}?</p>
            <div className="mt-6 flex justify-end gap-3"><button onClick={() => setIsDeleting(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold">Cancel</button><button onClick={() => void handleDelete()} className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white">Delete Job</button></div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default InspectionJobDetailPage;
