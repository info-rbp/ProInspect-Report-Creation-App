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
  RefreshCw,
  ShoppingBag,
  Trash2,
} from 'lucide-react';
import type { AuditEvent, InspectionJob, InspectionJobStatus, PropertyRecord } from '../../types/platform';
import {
  deleteInspectionJob,
  getInspectionJob,
  updateInspectionJob,
  updateInspectionJobStatus,
} from '../../services/platform/inspectionJobService';
import { getProperty } from '../../services/platform/propertyService';
import { listAuditEventsForEntity } from '../../services/platform/auditService';
import { InspectionJobFormModal } from '../../components/jobs/InspectionJobFormModal';
import { generateId } from '../../utils';
import { saveReportToDB } from '../../services/storageService';
import { upsertReportIndexFromReport } from '../../services/platform/reportIndexService';
import { seedReportFromProperty } from '../../services/platform/propertySeedingService';
import type { ReportData } from '../../types';

const WORKFLOW_STEPS: { id: string; label: string; statuses: InspectionJobStatus[] }[] = [
  { id: '1', label: 'Booked / Scheduled', statuses: ['draft', 'booked', 'assigned'] },
  { id: '2', label: 'Field Inspection', statuses: ['inspection_started', 'photos_uploading', 'photos_uploaded', 'inspection_submitted'] },
  { id: '3', label: 'AI & Review', statuses: ['analysis_queued', 'analysis_running', 'review_required', 'analyst_review_in_progress', 'reviewer_review_in_progress', 'changes_requested'] },
  { id: '4', label: 'Approved', statuses: ['reviewer_approved', 'ready_to_issue'] },
  { id: '5', label: 'Issued & Finalised', statuses: ['issued_to_tenant', 'tenant_viewed', 'tenant_submitted', 'finalised'] },
];

export const InspectionJobDetailPage: React.FC = () => {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();

  const [job, setJob] = useState<InspectionJob | null>(null);
  const [property, setProperty] = useState<PropertyRecord | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesText, setNotesText] = useState('');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [propertiesList, setPropertiesList] = useState<PropertyRecord[]>([]);

  const loadJobData = async () => {
    if (!jobId) return;
    setLoading(true);
    try {
      const nextJob = await getInspectionJob(jobId);
      if (nextJob) {
        setJob(nextJob);
        setNotesText(nextJob.notes || '');
        const prop = await getProperty(nextJob.propertyId);
        setProperty(prop || null);
        setPropertiesList(prop ? [prop] : []);

        const events = await listAuditEventsForEntity('inspection_job', jobId);
        setAuditEvents(events);
      } else {
        setJob(null);
      }
    } catch (err) {
      console.error('Failed to load inspection job detail:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadJobData();
  }, [jobId]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center rounded-2xl border border-slate-200 bg-white p-8 text-slate-500 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2 text-sm">
          <RefreshCw className="h-4 w-4 animate-spin text-blue-600" />
          <span>Loading inspection job details...</span>
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="space-y-4">
        <Link
          to="/app/admin/jobs"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-blue-600 dark:text-slate-400"
        >
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

  const handleStatusChange = async (newStatus: InspectionJobStatus) => {
    if (!job) return;
    try {
      const updated = await updateInspectionJobStatus(job.id, newStatus);
      setJob(updated);
      await loadJobData();
    } catch (err) {
      console.error('Failed to update status:', err);
    }
  };

  const handleSaveNotes = async () => {
    if (!job) return;
    setSavingNotes(true);
    try {
      const updated = await updateInspectionJob(job.id, { notes: notesText.trim() });
      setJob(updated);
    } catch (err) {
      console.error('Failed to save notes:', err);
    } finally {
      setSavingNotes(false);
    }
  };

  const handleDelete = async () => {
    if (!job) return;
    await deleteInspectionJob(job.id);
    navigate('/app/admin/jobs');
  };

  const handleCreateOrOpenReport = async () => {
    if (!job) return;
    if (job.reportId) {
      navigate(`/app/admin/reports/${job.reportId}/edit`);
      return;
    }

    const newReportId = `rep-${generateId().slice(0, 8)}`;
    let newReport: ReportData;

    if (property) {
      newReport = seedReportFromProperty(property, {
        id: newReportId,
        agencyId: job.agencyId,
        inspectionJobId: job.id,
        reportType: job.reportType,
        agentName: job.assignedInspectorId || 'Assigned Inspector',
        agentCompany: 'ProInspect',
        inspectionDate: job.scheduledAt ? new Date(job.scheduledAt).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
      });
    } else {
      newReport = {
        id: newReportId,
        agencyId: job.agencyId,
        inspectionJobId: job.id,
        reportType: job.reportType,
        propertyAddress: 'Property Address',
        agentName: job.assignedInspectorId || 'Assigned Inspector',
        agentCompany: 'ProInspect',
        clientName: '',
        inspectionDate: job.scheduledAt ? new Date(job.scheduledAt).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
        tenantName: '',
        rooms: [],
        lifecycleStatus: 'draft',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    await saveReportToDB(newReport);
    await upsertReportIndexFromReport(newReport);

    const updated = await updateInspectionJob(job.id, {
      reportId: newReportId,
      status: job.status === 'booked' || job.status === 'assigned' ? 'inspection_started' : job.status,
    });
    setJob(updated);

    navigate(`/app/admin/reports/${newReportId}/edit`);
  };

  // Find active workflow step index
  const getCurrentStepIndex = () => {
    const stepIdx = WORKFLOW_STEPS.findIndex((s) => s.statuses.includes(job.status));
    return stepIdx !== -1 ? stepIdx : 0;
  };

  const currentStepIdx = getCurrentStepIndex();

  return (
    <div className="space-y-6">
      {/* Top Breadcrumb & Navigation */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <Link
            to="/app/admin/jobs"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-blue-600 dark:text-slate-400"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Inspection Jobs Queue
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              {property?.address || 'Inspection Job Console'}
            </h1>
            <span className="rounded-full bg-slate-100 px-3 py-1 font-mono text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              #{job.id}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {job.reportType} • Agency: {job.agencyId}
          </p>
        </div>

        {/* Top Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleCreateOrOpenReport}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
          >
            <FileText className="h-4 w-4" />
            <span>{job.reportId ? 'Open Report Editor' : 'Generate Linked Report'}</span>
          </button>
          <button
            onClick={() => setIsEditModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <Edit3 className="h-3.5 w-3.5" />
            Edit Job
          </button>
          <button
            onClick={() => setIsDeleting(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      </div>

      {/* Visual Workflow Stepper Bar */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Live Inspection Lifecycle
          </h2>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Current Status: <span className="capitalize text-blue-600 dark:text-blue-400">{job.status.replaceAll('_', ' ')}</span>
            </span>
          </div>
        </div>

        {/* Progress Bar / Steps */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
          {WORKFLOW_STEPS.map((step, idx) => {
            const isDone = idx < currentStepIdx;
            const isCurrent = idx === currentStepIdx;

            return (
              <div
                key={step.id}
                className={`relative flex flex-col justify-between rounded-xl p-3 border text-xs transition-all ${
                  isCurrent
                    ? 'border-blue-500 bg-blue-50/60 text-blue-900 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-200 font-semibold'
                    : isDone
                      ? 'border-emerald-200 bg-emerald-50/40 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300'
                      : 'border-slate-100 bg-slate-50/50 text-slate-400 dark:border-slate-800 dark:bg-slate-800/40'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono font-bold uppercase opacity-70">Stage 0{step.id}</span>
                  {isDone ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  ) : isCurrent ? (
                    <Clock className="h-4 w-4 text-blue-600 animate-pulse dark:text-blue-400" />
                  ) : null}
                </div>
                <div className="mt-2 text-xs font-bold">{step.label}</div>
              </div>
            );
          })}
        </div>

        {/* Quick Transition Controls */}
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
          <span className="text-xs font-semibold text-slate-500 mr-2">Transition Job Status:</span>
          {[
            { status: 'booked', label: 'Mark Booked' },
            { status: 'assigned', label: 'Assign Inspector' },
            { status: 'inspection_started', label: 'Start Inspection' },
            { status: 'photos_uploaded', label: 'Photos Uploaded' },
            { status: 'review_required', label: 'Submit for Review' },
            { status: 'reviewer_approved', label: 'Approve Job' },
            { status: 'finalised', label: 'Finalise Job' },
            { status: 'on_hold', label: 'Put On Hold' },
          ].map((item) => (
            <button
              key={item.status}
              onClick={() => handleStatusChange(item.status as InspectionJobStatus)}
              disabled={job.status === item.status}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
                job.status === item.status
                  ? 'bg-slate-900 text-white dark:bg-blue-600'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Detail Cards Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Card 1: Job & Scheduling Parameters */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
            <Clock className="h-4 w-4 text-blue-500" />
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Schedule & Parameters</h2>
          </div>
          <dl className="mt-4 space-y-3 text-xs">
            <div className="flex justify-between">
              <dt className="text-slate-400">Scheduled Time:</dt>
              <dd className="font-semibold text-slate-900 dark:text-white">
                {job.scheduledAt ? new Date(job.scheduledAt).toLocaleString() : 'Not Scheduled'}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-400">Report Type:</dt>
              <dd className="font-semibold text-slate-900 dark:text-white">{job.reportType}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-400">Assigned Inspector:</dt>
              <dd className="font-semibold text-blue-600 dark:text-blue-400">
                {job.assignedInspectorId || 'Unassigned'}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-400">Assigned Reviewer:</dt>
              <dd className="font-semibold text-purple-600 dark:text-purple-400">
                {job.assignedReviewerId || 'Unassigned'}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-400">Tenancy Reference:</dt>
              <dd className="font-mono text-slate-700 dark:text-slate-300">{job.tenancyId || 'N/A'}</dd>
            </div>
            <div className="flex justify-between border-t border-slate-100 pt-2 dark:border-slate-800">
              <dt className="text-slate-400">Created At:</dt>
              <dd className="text-slate-500">{new Date(job.createdAt).toLocaleDateString()}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-400">Last Updated:</dt>
              <dd className="text-slate-500">{new Date(job.updatedAt).toLocaleDateString()}</dd>
            </div>
          </dl>
        </div>

        {/* Card 2: Property & Contact Context */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <Building className="h-4 w-4 text-emerald-500" />
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">Property & Contacts</h2>
            </div>
            {property && (
              <Link
                to={`/app/admin/properties/${property.id}`}
                className="text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400 flex items-center gap-1"
              >
                View Property <ExternalLink className="h-3 w-3" />
              </Link>
            )}
          </div>
          {property ? (
            <div className="mt-4 space-y-3 text-xs">
              <div>
                <span className="text-slate-400">Full Address:</span>
                <p className="mt-0.5 font-semibold text-slate-900 dark:text-white">
                  {property.address}, {property.suburb} {property.state} {property.postcode}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-2 text-center text-[11px] font-semibold text-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                <div>Beds: {property.bedrooms ?? '-'}</div>
                <div>Baths: {property.bathrooms ?? '-'}</div>
                <div>Type: {property.propertyType ?? 'House'}</div>
              </div>
              {property.landlordDetails?.name && (
                <div>
                  <span className="text-slate-400">Landlord:</span>
                  <p className="font-medium text-slate-800 dark:text-slate-200">
                    {property.landlordDetails.name} ({property.landlordDetails.phone || property.landlordDetails.email || 'No contact'})
                  </p>
                </div>
              )}
              {property.tenantDetails?.primaryTenantName && (
                <div>
                  <span className="text-slate-400">Primary Tenant:</span>
                  <p className="font-medium text-slate-800 dark:text-slate-200">
                    {property.tenantDetails.primaryTenantName} ({property.tenantDetails.primaryTenantPhone || property.tenantDetails.primaryTenantEmail || 'No contact'})
                  </p>
                </div>
              )}
            </div>
          ) : (
            <p className="mt-4 text-xs text-slate-400 italic">No linked property record found.</p>
          )}
        </div>

        {/* Card 3: Report & External Integrations */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
            <FileText className="h-4 w-4 text-purple-500" />
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Linked Assets & Integrations</h2>
          </div>
          <div className="mt-4 space-y-3.5 text-xs">
            {/* Report Link */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3 dark:border-slate-800 dark:bg-slate-800/40">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-700 dark:text-slate-300">Inspection Report</span>
                {job.reportId ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    Linked
                  </span>
                ) : (
                  <span className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold">Not Linked</span>
                )}
              </div>
              <p className="mt-1 font-mono text-[11px] text-slate-500">
                {job.reportId ? `Report ID: ${job.reportId}` : 'No inspection condition report created yet.'}
              </p>
              <button
                onClick={handleCreateOrOpenReport}
                className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:underline dark:text-blue-400"
              >
                {job.reportId ? 'Open Report Editor' : 'Build & Link Report Now'} <ExternalLink className="h-3 w-3" />
              </button>
            </div>

            {/* Google Drive */}
            <div className="flex items-center justify-between rounded-xl border border-slate-200 p-3 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Folder className="h-4 w-4 text-amber-500" />
                <div>
                  <div className="font-semibold text-slate-800 dark:text-slate-200">Google Drive Folder</div>
                  <div className="font-mono text-[11px] text-slate-400">{job.googleDriveFolderId || 'Unset'}</div>
                </div>
              </div>
            </div>

            {/* Shopify Order */}
            <div className="flex items-center justify-between rounded-xl border border-slate-200 p-3 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <ShoppingBag className="h-4 w-4 text-emerald-500" />
                <div>
                  <div className="font-semibold text-slate-800 dark:text-slate-200">Shopify Order</div>
                  <div className="font-mono text-[11px] text-slate-400">{job.shopifyOrderId || 'None'}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Notes & Special Instructions Section */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">Field Notes & Access Instructions</h2>
          <button
            onClick={handleSaveNotes}
            disabled={savingNotes}
            className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-700"
          >
            {savingNotes ? 'Saving...' : 'Save Notes'}
          </button>
        </div>
        <textarea
          rows={3}
          value={notesText}
          onChange={(e) => setNotesText(e.target.value)}
          placeholder="Add specific access notes, key codes, tenant entry instructions..."
          className="w-full rounded-xl border border-slate-200 bg-slate-50/50 p-3 text-xs text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-800/50 dark:text-white dark:focus:bg-slate-900"
        />
      </div>

      {/* Audit History Timeline */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-4">Audit & Event Log</h2>
        {auditEvents.length === 0 ? (
          <p className="text-xs text-slate-400 italic">No audit events logged for this job yet.</p>
        ) : (
          <div className="space-y-3">
            {auditEvents.map((evt) => (
              <div key={evt.id} className="flex items-start gap-3 text-xs">
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  <Clock className="h-3.5 w-3.5" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-800 dark:text-slate-200">{evt.eventType}</span>
                    <span className="text-[11px] text-slate-400">{new Date(evt.timestamp).toLocaleString()}</span>
                  </div>
                  <p className="text-slate-500 dark:text-slate-400 mt-0.5">
                    Actor: {evt.actorId || 'System'} {evt.actorRole ? `(${evt.actorRole})` : ''}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Edit Job Modal */}
      <InspectionJobFormModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        onSave={async (updatedData) => {
          if (!job) return;
          const updated = await updateInspectionJob(job.id, updatedData);
          setJob(updated);
          await loadJobData();
        }}
        properties={propertiesList}
        initialJob={job}
      />

      {/* Delete Confirmation Modal */}
      {isDeleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">Delete Inspection Job</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">This action is permanent.</p>
              </div>
            </div>
            <p className="mt-4 text-xs text-slate-600 dark:text-slate-300">
              Are you sure you want to delete this inspection job (#{job.id})? Associated condition reports will remain in your reports index.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setIsDeleting(false)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700"
              >
                Delete Job
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InspectionJobDetailPage;
