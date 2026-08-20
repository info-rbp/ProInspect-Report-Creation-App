import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileText,
  Filter,
  Grid3X3,
  Link2,
  List,
  MapPin,
  Plus,
  RefreshCw,
  Repeat2,
  Search,
  Settings2,
  ShieldAlert,
  ShoppingBag,
  Sparkles,
  UserCheck,
  Users,
  XCircle,
} from 'lucide-react';
import type {
  InspectionJob,
  InspectionReportType,
  InspectionRequest,
  IntegrationConnection,
  IntegrationSyncException,
  PropertyRecord,
  RecurringInspectionSchedule,
  UserProfile,
} from '../../types/platform';
import { InspectionJobFormModal } from '../../components/jobs/InspectionJobFormModal';
import {
  createInspectionJob,
  listInspectionJobs,
  updateInspectionJob,
} from '../../services/platform/inspectionJobService';
import { createInspectionReportForJob } from '../../services/platform/inspectionReportService';
import { listProperties } from '../../services/platform/propertyService';
import {
  beginGoogleCalendarConnection,
  cancelInspectionRequest,
  configureGoogleCalendar,
  connectShopify,
  convertInspectionRequest,
  createGoogleCalendarWatch,
  getAssignmentSuggestions,
  getGoogleCalendarIntegrationStatus,
  getInspectionOperationsOverview,
  getShopifyIntegrationStatus,
  linkInspectionRequestProperty,
  listConnectedGoogleCalendars,
  listInspectionRequests,
  listIntegrationSyncExceptions,
  listRecurringInspectionSchedules,
  materialiseRecurringInspection,
  reconcileGoogleCalendar,
  reconcileShopify,
  resolveIntegrationSyncException,
  saveRecurringInspectionSchedule,
  seedGoogleCalendarMappings,
  seedShopifyMappings,
  syncInspectionJobCalendar,
  type GoogleCalendarIntegrationStatus,
  type InspectionOperationsOverview,
  type ShopifyIntegrationStatus,
} from '../../services/platform/inspectionOperationsService';
import {
  listAvailableInspectors,
  listAvailableReviewers,
} from '../../services/platform/userDirectoryService';
import { DEFAULT_AGENCY_ID } from '../../services/platform/userProfileService';

const TABS = [
  ['jobs', 'Jobs'],
  ['intake', 'Intake Queue'],
  ['schedule', 'Schedule'],
  ['assignment', 'Assignment'],
  ['recurring', 'Recurring'],
  ['sync', 'Sync & Exceptions'],
] as const;

type Tab = (typeof TABS)[number][0];
type JobView = 'list' | 'kanban' | 'calendar';

const KANBAN_COLUMNS: Array<{ id: string; label: string; statuses: string[] }> = [
  { id: 'planning', label: 'Booked / Assigned', statuses: ['draft', 'booked', 'assigned'] },
  { id: 'field', label: 'Field Inspection', statuses: ['inspection_started', 'photos_uploading', 'photos_uploaded', 'inspection_submitted'] },
  { id: 'review', label: 'AI & Review', statuses: ['analysis_queued', 'analysis_running', 'analysis_failed', 'analysis_complete', 'analyst_review_in_progress', 'review_required', 'reviewer_review_in_progress', 'changes_requested'] },
  { id: 'approved', label: 'Approved / Issue', statuses: ['reviewer_approved', 'ready_to_issue', 'issued_to_tenant'] },
  { id: 'closed', label: 'Finalised', statuses: ['tenant_viewed', 'tenant_response_in_progress', 'tenant_submitted', 'agent_response_required', 'finalisation_ready', 'finalised', 'archived'] },
  { id: 'exceptions', label: 'Exceptions', statuses: ['on_hold', 'cancelled'] },
];

const REPORT_TYPES: InspectionReportType[] = [
  'Property Condition Report',
  'Routine Inspection',
  'Exit Inspection',
  'Maintenance and Follow-Up Report',
];

function label(value?: string): string {
  return value
    ? value.replaceAll('_', ' ').replace(/\b\w/gu, (character) => character.toUpperCase())
    : 'Not set';
}

function dateTime(value?: string): string {
  if (!value) return 'Not scheduled';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function dateOnly(value?: string): string {
  if (!value) return 'Unscheduled';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value.slice(0, 10) : parsed.toLocaleDateString();
}

function userLabel(user: UserProfile): string {
  return user.displayName?.trim() || user.email;
}

function sourceIcon(source?: string): React.ReactNode {
  if (source === 'shopify') return <ShoppingBag size={14} />;
  if (source === 'google_calendar') return <CalendarDays size={14} />;
  if (source === 'recurring_schedule') return <Repeat2 size={14} />;
  return <FileText size={14} />;
}

function statusClass(value?: string): string {
  if (['paid', 'booked', 'matched', 'converted', 'ready_for_job', 'confirmed', 'synchronised', 'connected'].includes(value || '')) {
    return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  }
  if (['pending', 'awaiting_payment', 'awaiting_booking', 'awaiting_property', 'possible_match', 'attention_required', 'at_risk'].includes(value || '')) {
    return 'bg-amber-50 text-amber-800 border-amber-200';
  }
  if (['failed', 'cancelled', 'refunded', 'overdue', 'critical', 'unable_to_access'].includes(value || '')) {
    return 'bg-rose-50 text-rose-700 border-rose-200';
  }
  return 'bg-slate-50 text-slate-700 border-slate-200';
}

const Badge: React.FC<{ value?: string }> = ({ value }) => (
  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${statusClass(value)}`}>
    {label(value)}
  </span>
);

const Metric: React.FC<{ label: string; value: number; tone?: 'default' | 'warning' | 'danger' }> = ({
  label: title,
  value,
  tone = 'default',
}) => (
  <div className={`rounded-xl border p-4 ${tone === 'danger' ? 'border-rose-200 bg-rose-50/60' : tone === 'warning' ? 'border-amber-200 bg-amber-50/60' : 'border-slate-200 bg-white'}`}>
    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{title}</div>
    <div className="mt-1 text-2xl font-black text-slate-950">{value}</div>
  </div>
);

export const InspectionOperationsPage: React.FC = () => {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('jobs');
  const [view, setView] = useState<JobView>('list');
  const [overview, setOverview] = useState<InspectionOperationsOverview | null>(null);
  const [jobs, setJobs] = useState<InspectionJob[]>([]);
  const [requests, setRequests] = useState<InspectionRequest[]>([]);
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [inspectors, setInspectors] = useState<UserProfile[]>([]);
  const [reviewers, setReviewers] = useState<UserProfile[]>([]);
  const [schedules, setSchedules] = useState<RecurringInspectionSchedule[]>([]);
  const [exceptions, setExceptions] = useState<IntegrationSyncException[]>([]);
  const [shopify, setShopify] = useState<ShopifyIntegrationStatus | null>(null);
  const [google, setGoogle] = useState<GoogleCalendarIntegrationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [matchSelections, setMatchSelections] = useState<Record<string, string>>({});
  const [assignmentSuggestions, setAssignmentSuggestions] = useState<Record<string, Awaited<ReturnType<typeof getAssignmentSuggestions>>>>({});

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextOverview, nextJobs, nextRequests, nextProperties, nextInspectors, nextReviewers, nextSchedules, nextExceptions, nextShopify, nextGoogle] = await Promise.all([
        getInspectionOperationsOverview(),
        listInspectionJobs(),
        listInspectionRequests(),
        listProperties(),
        listAvailableInspectors(),
        listAvailableReviewers(),
        listRecurringInspectionSchedules(),
        listIntegrationSyncExceptions(),
        getShopifyIntegrationStatus().catch(() => ({ connection: null, mappings: [] })),
        getGoogleCalendarIntegrationStatus().catch(() => ({ connection: null, mappings: [] })),
      ]);
      setOverview(nextOverview);
      setJobs(nextJobs);
      setRequests(nextRequests);
      setProperties(nextProperties);
      setInspectors(nextInspectors);
      setReviewers(nextReviewers);
      setSchedules(nextSchedules);
      setExceptions(nextExceptions);
      setShopify(nextShopify);
      setGoogle(nextGoogle);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Inspection operations could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const propertyMap = useMemo(
    () => new Map(properties.map((property) => [property.id, property])),
    [properties],
  );

  const filteredJobs = useMemo(() => {
    const query = search.trim().toLowerCase();
    return jobs.filter((job) => {
      const property = propertyMap.get(job.propertyId);
      const haystack = [
        job.id,
        property?.address,
        property?.suburb,
        job.reportType,
        job.assignedInspectorId,
        job.assignedReviewerId,
        job.shopifyOrder?.orderNumber,
        job.notes,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return (
        (!query || haystack.includes(query)) &&
        (sourceFilter === 'all' || job.source === sourceFilter) &&
        (statusFilter === 'all' || job.status === statusFilter)
      );
    });
  }, [jobs, propertyMap, search, sourceFilter, statusFilter]);

  const handleCreateManualJob = async (jobData: Partial<InspectionJob>) => {
    await createInspectionJob({
      agencyId: jobData.agencyId || DEFAULT_AGENCY_ID,
      propertyId: jobData.propertyId || '',
      reportType: jobData.reportType || 'Property Condition Report',
      scheduledAt: jobData.scheduledAt,
      assignedInspectorId: jobData.assignedInspectorId,
      assignedReviewerId: jobData.assignedReviewerId,
      tenancyId: jobData.tenancyId,
      notes: jobData.notes,
      durationMinutes: jobData.durationMinutes,
      scheduledEndAt: jobData.scheduledEndAt,
      timezone: jobData.timezone || 'Australia/Perth',
      source: 'manual',
      paymentStatus: 'not_required',
      bookingStatus: jobData.scheduledAt ? 'booked' : 'awaiting_booking',
      propertyMatchStatus: 'matched',
      priority: jobData.priority || 'normal',
      accessStatus: jobData.accessStatus || 'unknown',
      status: jobData.assignedInspectorId ? 'assigned' : jobData.scheduledAt ? 'booked' : 'draft',
    });
    await load();
  };

  const handleReport = async (job: InspectionJob) => {
    if (job.reportId) return navigate(`/app/admin/reports/${job.reportId}/edit`);
    const property = propertyMap.get(job.propertyId);
    if (!property) return setError('The linked property must exist before creating the report.');
    setBusy(true);
    try {
      const aggregate = await createInspectionReportForJob(job, property, {
        clientName: property.landlordDetails?.name || '',
        inspectionDate: job.scheduledAt?.slice(0, 10) || new Date().toISOString().slice(0, 10),
      });
      navigate(`/app/admin/reports/${aggregate.report.id}/edit`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The linked report could not be created.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="flex h-64 items-center justify-center text-sm text-slate-500"><RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Loading inspection operations...</div>;
  }

  return (
    <div className="space-y-6 pb-16">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-3xl font-black text-slate-950">Inspection Operations</h1>
          <p className="mt-1 text-sm text-slate-500">Convert orders and bookings into controlled inspection jobs, schedule field work and resolve integration exceptions.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold"><RefreshCw size={14} /> Refresh</button>
          <button onClick={() => setIsModalOpen(true)} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white"><Plus size={14} /> New Manual Job</button>
        </div>
      </header>

      {error && <div className="flex items-start justify-between rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"><span>{error}</span><button onClick={() => setError(null)}><XCircle size={16} /></button></div>}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Metric label="New Intake" value={overview?.intake.new || 0} />
        <Metric label="Awaiting Booking" value={overview?.intake.awaitingBooking || 0} tone="warning" />
        <Metric label="Property Match" value={overview?.intake.propertyMatchRequired || 0} tone="warning" />
        <Metric label="Unassigned Jobs" value={overview?.jobs.unassigned || 0} tone="warning" />
        <Metric label="Sync Exceptions" value={overview?.integrations.openExceptions || 0} tone={overview?.integrations.criticalExceptions ? 'danger' : 'default'} />
      </section>

      <nav className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">
        {TABS.map(([id, title]) => (
          <button key={id} onClick={() => setTab(id)} className={`whitespace-nowrap rounded-lg px-4 py-2 text-xs font-semibold ${tab === id ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{title}</button>
        ))}
      </nav>

      {tab === 'jobs' && (
        <JobsTab
          jobs={filteredJobs}
          properties={propertyMap}
          inspectors={inspectors}
          reviewers={reviewers}
          search={search}
          sourceFilter={sourceFilter}
          statusFilter={statusFilter}
          view={view}
          busy={busy}
          onSearch={setSearch}
          onSourceFilter={setSourceFilter}
          onStatusFilter={setStatusFilter}
          onView={setView}
          onReload={load}
          onReport={handleReport}
          onError={setError}
        />
      )}

      {tab === 'intake' && (
        <IntakeTab
          requests={requests}
          properties={properties}
          matchSelections={matchSelections}
          busy={busy}
          onSelection={(requestId, propertyId) => setMatchSelections((current) => ({ ...current, [requestId]: propertyId }))}
          onLink={async (request) => {
            const propertyId = matchSelections[request.id] || request.propertyMatchCandidates?.[0]?.propertyId;
            if (!propertyId) return setError('Select a property before linking this intake request.');
            setBusy(true);
            try {
              await linkInspectionRequestProperty(request, propertyId);
              await load();
            } catch (failure) {
              setError(failure instanceof Error ? failure.message : 'Property could not be linked.');
            } finally {
              setBusy(false);
            }
          }}
          onConvert={async (request) => {
            setBusy(true);
            try {
              const result = await convertInspectionRequest(request);
              await load();
              navigate(`/app/admin/jobs/${result.job.id}`);
            } catch (failure) {
              setError(failure instanceof Error ? failure.message : 'Request could not be converted.');
            } finally {
              setBusy(false);
            }
          }}
          onCancel={async (request) => {
            setBusy(true);
            try {
              await cancelInspectionRequest(request, 'Cancelled from Inspection Intake.');
              await load();
            } catch (failure) {
              setError(failure instanceof Error ? failure.message : 'Request could not be cancelled.');
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {tab === 'schedule' && <ScheduleTab jobs={jobs} properties={propertyMap} />}

      {tab === 'assignment' && (
        <AssignmentTab
          jobs={jobs.filter((job) => !job.assignedInspectorId && !['cancelled', 'finalised', 'archived'].includes(job.status))}
          properties={propertyMap}
          inspectors={inspectors}
          suggestions={assignmentSuggestions}
          onSuggest={async (job) => {
            try {
              const values = await getAssignmentSuggestions(job.id);
              setAssignmentSuggestions((current) => ({ ...current, [job.id]: values }));
            } catch (failure) {
              setError(failure instanceof Error ? failure.message : 'Assignment suggestions could not be loaded.');
            }
          }}
          onAssign={async (job, inspectorId) => {
            setBusy(true);
            try {
              await updateInspectionJob(job.id, { assignedInspectorId: inspectorId, status: job.status === 'booked' ? 'assigned' : job.status });
              await load();
            } catch (failure) {
              setError(failure instanceof Error ? failure.message : 'Inspector could not be assigned.');
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {tab === 'recurring' && (
        <RecurringTab
          schedules={schedules}
          properties={properties}
          onCreate={async (input) => {
            setBusy(true);
            try {
              await saveRecurringInspectionSchedule(input);
              await load();
            } catch (failure) {
              setError(failure instanceof Error ? failure.message : 'Recurring schedule could not be created.');
            } finally {
              setBusy(false);
            }
          }}
          onMaterialise={async (schedule) => {
            setBusy(true);
            try {
              await materialiseRecurringInspection(schedule);
              await load();
            } catch (failure) {
              setError(failure instanceof Error ? failure.message : 'Recurring inspection could not be materialised.');
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {tab === 'sync' && (
        <SyncTab
          shopify={shopify}
          google={google}
          exceptions={exceptions}
          busy={busy}
          onBusy={setBusy}
          onError={setError}
          onReload={load}
        />
      )}

      <InspectionJobFormModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleCreateManualJob}
        properties={properties}
      />
    </div>
  );
};

const JobsTab: React.FC<{
  jobs: InspectionJob[];
  properties: Map<string, PropertyRecord>;
  inspectors: UserProfile[];
  reviewers: UserProfile[];
  search: string;
  sourceFilter: string;
  statusFilter: string;
  view: JobView;
  busy: boolean;
  onSearch: (value: string) => void;
  onSourceFilter: (value: string) => void;
  onStatusFilter: (value: string) => void;
  onView: (value: JobView) => void;
  onReload: () => Promise<void>;
  onReport: (job: InspectionJob) => Promise<void>;
  onError: (message: string) => void;
}> = ({ jobs, properties, inspectors, reviewers, search, sourceFilter, statusFilter, view, busy, onSearch, onSourceFilter, onStatusFilter, onView, onReload, onReport, onError }) => (
  <div className="space-y-4">
    <section className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 lg:flex-row lg:items-center">
      <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search property, order, inspector or job..." className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-xs" /></div>
      <select value={sourceFilter} onChange={(event) => onSourceFilter(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs"><option value="all">All sources</option><option value="shopify">Shopify</option><option value="google_calendar">Google Calendar</option><option value="manual">Manual</option><option value="property">Property</option><option value="maintenance">Maintenance</option><option value="recurring_schedule">Recurring</option></select>
      <select value={statusFilter} onChange={(event) => onStatusFilter(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs"><option value="all">All statuses</option><option value="booked">Booked</option><option value="assigned">Assigned</option><option value="inspection_started">Field inspection</option><option value="review_required">Review required</option><option value="on_hold">On hold</option><option value="finalised">Finalised</option></select>
      <div className="flex rounded-xl border border-slate-200 p-1"><button onClick={() => onView('list')} className={`rounded-lg p-1.5 ${view === 'list' ? 'bg-slate-900 text-white' : 'text-slate-500'}`}><List size={15} /></button><button onClick={() => onView('kanban')} className={`rounded-lg p-1.5 ${view === 'kanban' ? 'bg-slate-900 text-white' : 'text-slate-500'}`}><Grid3X3 size={15} /></button><button onClick={() => onView('calendar')} className={`rounded-lg p-1.5 ${view === 'calendar' ? 'bg-slate-900 text-white' : 'text-slate-500'}`}><CalendarDays size={15} /></button></div>
    </section>

    {view === 'list' && <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white"><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Job</th><th className="px-4 py-3">Schedule</th><th className="px-4 py-3">Commercial</th><th className="px-4 py-3">Team</th><th className="px-4 py-3">Readiness</th><th className="px-4 py-3 text-right">Actions</th></tr></thead><tbody className="divide-y divide-slate-100">{jobs.map((job) => {
      const property = properties.get(job.propertyId);
      const readinessErrors = job.readiness?.blockers.filter((item) => item.severity === 'error').length || 0;
      return <tr key={job.id} className="align-top hover:bg-slate-50"><td className="px-4 py-4"><div className="flex items-center gap-2 font-bold text-slate-900">{sourceIcon(job.source)}<Link to={`/app/admin/jobs/${job.id}`} className="hover:text-blue-600">{property?.address || job.propertyId}</Link></div><div className="mt-1 text-slate-500">{job.reportType} · {job.id}</div><div className="mt-2 flex flex-wrap gap-1"><Badge value={job.status} /><Badge value={job.source || 'manual'} /><Badge value={job.priority || 'normal'} /></div></td><td className="px-4 py-4"><div className="font-semibold">{dateTime(job.scheduledAt)}</div><div className="mt-1 text-slate-500">{job.durationMinutes || 60} min · {job.timezone || 'Australia/Perth'}</div>{job.googleCalendar?.htmlLink && <a href={job.googleCalendar.htmlLink} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 font-semibold text-blue-600"><CalendarDays size={12} /> Open event</a>}</td><td className="px-4 py-4"><div className="flex flex-wrap gap-1"><Badge value={job.paymentStatus || 'not_required'} /><Badge value={job.bookingStatus || (job.scheduledAt ? 'booked' : 'awaiting_booking')} /></div><div className="mt-2 text-slate-500">{job.shopifyOrder?.orderNumber || 'No Shopify order'}</div></td><td className="px-4 py-4"><select value={job.assignedInspectorId || ''} onChange={async (event) => { try { await updateInspectionJob(job.id, { assignedInspectorId: event.target.value || undefined, status: event.target.value && job.status === 'booked' ? 'assigned' : job.status }); await onReload(); } catch (failure) { onError(failure instanceof Error ? failure.message : 'Inspector could not be assigned.'); } }} className="w-48 rounded-lg border border-slate-200 px-2 py-1.5"><option value="">Unassigned inspector</option>{inspectors.map((user) => <option key={user.id} value={user.id}>{userLabel(user)}</option>)}</select><select value={job.assignedReviewerId || ''} onChange={async (event) => { try { await updateInspectionJob(job.id, { assignedReviewerId: event.target.value || undefined }); await onReload(); } catch (failure) { onError(failure instanceof Error ? failure.message : 'Reviewer could not be assigned.'); } }} className="mt-2 w-48 rounded-lg border border-slate-200 px-2 py-1.5"><option value="">Unassigned reviewer</option>{reviewers.map((user) => <option key={user.id} value={user.id}>{userLabel(user)}</option>)}</select></td><td className="px-4 py-4"><div className="flex items-center gap-2"><Badge value={job.slaStatus || 'on_track'} />{readinessErrors ? <span className="font-semibold text-rose-600">{readinessErrors} blocker{readinessErrors === 1 ? '' : 's'}</span> : <span className="font-semibold text-emerald-600">Ready</span>}</div><div className="mt-2 flex flex-wrap gap-1"><Badge value={job.accessStatus || 'unknown'} /><Badge value={job.lastCalendarSyncStatus || (job.googleCalendar ? 'synchronised' : 'not_required')} /></div></td><td className="px-4 py-4"><div className="flex justify-end gap-2"><Link to={`/app/admin/jobs/${job.id}`} className="rounded-lg border border-slate-200 px-2.5 py-1.5 font-semibold">Open</Link><button disabled={busy} onClick={() => void syncInspectionJobCalendar(job).then(onReload).catch((failure) => onError(failure instanceof Error ? failure.message : 'Calendar sync failed.'))} className="rounded-lg border border-slate-200 px-2.5 py-1.5 font-semibold">Calendar</button><button disabled={busy} onClick={() => void onReport(job)} className="rounded-lg bg-blue-600 px-2.5 py-1.5 font-semibold text-white">{job.reportId ? 'Report' : 'Create report'}</button></div></td></tr>;
    })}</tbody></table></div>{jobs.length === 0 && <div className="p-10 text-center text-sm text-slate-500">No inspection jobs match the selected filters.</div>}</div>}

    {view === 'kanban' && <div className="grid gap-3 xl:grid-cols-3 2xl:grid-cols-6">{KANBAN_COLUMNS.map((column) => <section key={column.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3"><div className="mb-3 flex justify-between text-xs font-bold"><span>{column.label}</span><span>{jobs.filter((job) => column.statuses.includes(job.status)).length}</span></div><div className="space-y-2">{jobs.filter((job) => column.statuses.includes(job.status)).map((job) => <Link key={job.id} to={`/app/admin/jobs/${job.id}`} className="block rounded-xl border border-slate-200 bg-white p-3 shadow-sm"><div className="font-bold">{properties.get(job.propertyId)?.address || job.propertyId}</div><div className="mt-1 text-[11px] text-slate-500">{job.reportType}</div><div className="mt-2 flex items-center justify-between"><Badge value={job.source || 'manual'} /><span className="text-[10px] text-slate-500">{dateOnly(job.scheduledAt)}</span></div></Link>)}</div></section>)}</div>}

    {view === 'calendar' && <ScheduleTab jobs={jobs} properties={properties} />}
  </div>
);

const IntakeTab: React.FC<{
  requests: InspectionRequest[];
  properties: PropertyRecord[];
  matchSelections: Record<string, string>;
  busy: boolean;
  onSelection: (requestId: string, propertyId: string) => void;
  onLink: (request: InspectionRequest) => Promise<void>;
  onConvert: (request: InspectionRequest) => Promise<void>;
  onCancel: (request: InspectionRequest) => Promise<void>;
}> = ({ requests, properties, matchSelections, busy, onSelection, onLink, onConvert, onCancel }) => (
  <div className="space-y-3">{requests.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((request) => <section key={request.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-col justify-between gap-4 xl:flex-row"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="inline-flex items-center gap-1 font-bold text-slate-950">{sourceIcon(request.source)} {request.customerName || request.shopifyOrder?.orderNumber || request.googleCalendar?.summary || request.id}</span><Badge value={request.intakeStatus} /><Badge value={request.paymentStatus} /><Badge value={request.bookingStatus} /><Badge value={request.propertyMatchStatus} /></div><div className="mt-2 grid gap-3 text-xs text-slate-600 md:grid-cols-4"><div><b>Service</b><br />{request.reportType || request.serviceCode || 'Mapping required'}</div><div><b>Property candidate</b><br />{request.propertyAddressCandidate || 'Not supplied'}</div><div><b>Appointment</b><br />{dateTime(request.requestedStartAt)}</div><div><b>External reference</b><br />{request.shopifyOrder?.orderNumber || request.googleCalendar?.eventId || request.sourceExternalId}</div></div>{request.propertyMatchCandidates?.length ? <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs"><b>Suggested matches:</b> {request.propertyMatchCandidates.map((candidate) => `${candidate.address} (${Math.round(candidate.score * 100)}%)`).join(' · ')}</div> : null}</div><div className="flex w-full flex-col gap-2 xl:w-72"><select value={matchSelections[request.id] || request.propertyId || request.propertyMatchCandidates?.[0]?.propertyId || ''} onChange={(event) => onSelection(request.id, event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs"><option value="">Select property...</option>{properties.map((property) => <option key={property.id} value={property.id}>{property.address}{property.suburb ? `, ${property.suburb}` : ''}</option>)}</select><div className="grid grid-cols-3 gap-2"><button disabled={busy || request.propertyMatchStatus === 'matched'} onClick={() => void onLink(request)} className="rounded-lg border border-slate-200 px-2 py-2 text-[11px] font-semibold">Link</button><button disabled={busy || request.intakeStatus !== 'ready_for_job'} onClick={() => void onConvert(request)} className="rounded-lg bg-blue-600 px-2 py-2 text-[11px] font-semibold text-white disabled:opacity-40">Convert</button><button disabled={busy || ['converted', 'cancelled'].includes(request.intakeStatus)} onClick={() => void onCancel(request)} className="rounded-lg border border-rose-200 px-2 py-2 text-[11px] font-semibold text-rose-700">Cancel</button></div></div></div></section>)}{requests.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 p-12 text-center text-sm text-slate-500">No intake requests have been received yet. Shopify orders and Google Calendar bookings will appear here after their integrations are connected.</div>}</div>
);

const ScheduleTab: React.FC<{ jobs: InspectionJob[]; properties: Map<string, PropertyRecord> }> = ({ jobs, properties }) => {
  const grouped = [...jobs].filter((job) => job.scheduledAt && !['cancelled', 'archived'].includes(job.status)).sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt))).reduce<Record<string, InspectionJob[]>>((accumulator, job) => {
    const key = job.scheduledAt?.slice(0, 10) || 'unscheduled';
    (accumulator[key] ||= []).push(job);
    return accumulator;
  }, {});
  return <div className="space-y-4">{Object.entries(grouped).map(([date, dayJobs]) => <section key={date} className="rounded-2xl border border-slate-200 bg-white p-5"><div className="mb-4 flex items-center gap-2 font-bold"><CalendarDays size={17} /> {dateOnly(date)}</div><div className="space-y-2">{dayJobs.map((job) => <Link key={job.id} to={`/app/admin/jobs/${job.id}`} className="grid gap-3 rounded-xl border border-slate-200 p-3 md:grid-cols-[140px_1fr_180px_140px]"><div className="font-bold">{new Date(job.scheduledAt || '').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div><div><b>{properties.get(job.propertyId)?.address || job.propertyId}</b><div className="text-xs text-slate-500">{job.reportType}</div></div><div className="text-xs text-slate-600">{job.assignedInspectorId || 'Unassigned inspector'}</div><Badge value={job.status} /></Link>)}</div></section>)}{Object.keys(grouped).length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 p-12 text-center text-sm text-slate-500">No scheduled inspections.</div>}</div>;
};

const AssignmentTab: React.FC<{
  jobs: InspectionJob[];
  properties: Map<string, PropertyRecord>;
  inspectors: UserProfile[];
  suggestions: Record<string, Awaited<ReturnType<typeof getAssignmentSuggestions>>>;
  onSuggest: (job: InspectionJob) => Promise<void>;
  onAssign: (job: InspectionJob, inspectorId: string) => Promise<void>;
}> = ({ jobs, properties, inspectors, suggestions, onSuggest, onAssign }) => (
  <div className="space-y-3">{jobs.map((job) => <section key={job.id} className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex flex-col justify-between gap-4 lg:flex-row"><div><h3 className="font-bold">{properties.get(job.propertyId)?.address || job.propertyId}</h3><p className="mt-1 text-xs text-slate-500">{job.reportType} · {dateTime(job.scheduledAt)}</p><div className="mt-2 flex gap-1"><Badge value={job.priority || 'normal'} /><Badge value={job.accessStatus || 'unknown'} /></div></div><div className="flex flex-wrap items-start gap-2"><select className="rounded-xl border border-slate-200 px-3 py-2 text-xs" defaultValue="" onChange={(event) => event.target.value && void onAssign(job, event.target.value)}><option value="">Assign inspector...</option>{inspectors.map((user) => <option key={user.id} value={user.id}>{userLabel(user)}</option>)}</select><button onClick={() => void onSuggest(job)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold"><Sparkles size={14} className="inline" /> Suggest</button></div></div>{suggestions[job.id]?.length ? <div className="mt-4 grid gap-2 md:grid-cols-3">{suggestions[job.id].slice(0, 3).map((candidate) => <button key={candidate.userId} onClick={() => void onAssign(job, candidate.userId)} className="rounded-xl border border-slate-200 p-3 text-left"><div className="flex justify-between"><b className="text-xs">{candidate.displayName}</b><span className="text-xs font-bold text-blue-600">{candidate.score}</span></div><div className="mt-1 text-[10px] text-slate-500">{candidate.reasons.join(' ')}</div></button>)}</div> : null}</section>)}{jobs.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 p-12 text-center text-sm text-slate-500">All active inspections have an assigned inspector.</div>}</div>
);

const RecurringTab: React.FC<{
  schedules: RecurringInspectionSchedule[];
  properties: PropertyRecord[];
  onCreate: (input: Omit<RecurringInspectionSchedule, 'id' | 'createdAt' | 'updatedAt'> & Partial<Pick<RecurringInspectionSchedule, 'id'>>) => Promise<void>;
  onMaterialise: (schedule: RecurringInspectionSchedule) => Promise<void>;
}> = ({ schedules, properties, onCreate, onMaterialise }) => {
  const [propertyId, setPropertyId] = useState(properties[0]?.id || '');
  const [reportType, setReportType] = useState<InspectionReportType>('Routine Inspection');
  const [cadence, setCadence] = useState<RecurringInspectionSchedule['cadence']>('quarterly');
  const [nextDueAt, setNextDueAt] = useState(new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10));
  return <div className="space-y-5"><section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-bold">Create Recurring Inspection</h2><div className="mt-4 grid gap-3 md:grid-cols-5"><select value={propertyId} onChange={(event) => setPropertyId(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs">{properties.map((property) => <option key={property.id} value={property.id}>{property.address}</option>)}</select><select value={reportType} onChange={(event) => setReportType(event.target.value as InspectionReportType)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs">{REPORT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select><select value={cadence} onChange={(event) => setCadence(event.target.value as RecurringInspectionSchedule['cadence'])} className="rounded-xl border border-slate-200 px-3 py-2 text-xs"><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="six_monthly">Six monthly</option><option value="annual">Annual</option></select><input type="date" value={nextDueAt} onChange={(event) => setNextDueAt(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs" /><button disabled={!propertyId} onClick={() => void onCreate({ agencyId: properties.find((property) => property.id === propertyId)?.agencyId || DEFAULT_AGENCY_ID, propertyId, reportType, cadence, nextDueAt: new Date(`${nextDueAt}T09:00:00`).toISOString(), bookingLeadDays: 21, noticeLeadDays: 14, autoCreateRequest: true, autoConvertToJob: false, paused: false })} className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white">Create</button></div></section><div className="space-y-3">{schedules.map((schedule) => <section key={schedule.id} className="flex flex-col justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5 md:flex-row"><div><div className="flex items-center gap-2 font-bold"><Repeat2 size={16} /> {properties.find((property) => property.id === schedule.propertyId)?.address || schedule.propertyId}</div><div className="mt-1 text-xs text-slate-500">{schedule.reportType} · {label(schedule.cadence)} · next due {dateOnly(schedule.nextDueAt)}</div></div><div className="flex gap-2"><Badge value={schedule.paused ? 'paused' : 'active'} /><button onClick={() => void onMaterialise(schedule)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold">Create intake now</button></div></section>)}</div></div>;
};

const SyncTab: React.FC<{
  shopify: ShopifyIntegrationStatus | null;
  google: GoogleCalendarIntegrationStatus | null;
  exceptions: IntegrationSyncException[];
  busy: boolean;
  onBusy: (value: boolean) => void;
  onError: (message: string) => void;
  onReload: () => Promise<void>;
}> = ({ shopify, google, exceptions, busy, onBusy, onError, onReload }) => {
  const [shopDomain, setShopDomain] = useState('');
  const [shopToken, setShopToken] = useState('');
  const [calendarOptions, setCalendarOptions] = useState<Array<{ id: string; summary?: string }>>([]);
  const [calendarId, setCalendarId] = useState('');
  const [bookingPages, setBookingPages] = useState('');
  const action = async (run: () => Promise<unknown>) => {
    onBusy(true);
    try {
      await run();
      await onReload();
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : 'Integration action failed.');
    } finally {
      onBusy(false);
    }
  };
  return <div className="space-y-5"><div className="grid gap-5 xl:grid-cols-2"><section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between"><div className="flex items-center gap-2"><ShoppingBag size={18} /><h2 className="font-bold">Shopify Orders</h2></div><Badge value={shopify?.connection?.status || 'disconnected'} /></div>{shopify?.connection ? <div className="mt-4 space-y-3 text-xs"><div><b>Store:</b> {shopify.connection.externalAccountLabel || shopify.connection.externalAccountId}</div><div><b>Last sync:</b> {dateTime(shopify.connection.lastSuccessfulSyncAt)}</div><div><b>Service mappings:</b> {shopify.mappings.length}</div><div className="flex flex-wrap gap-2"><button disabled={busy} onClick={() => void action(() => reconcileShopify())} className="rounded-lg bg-slate-900 px-3 py-2 font-semibold text-white">Sync orders now</button><button disabled={busy} onClick={() => void action(() => seedShopifyMappings(true))} className="rounded-lg border border-slate-200 px-3 py-2 font-semibold">Refresh mappings</button></div></div> : <div className="mt-4 space-y-3"><input value={shopDomain} onChange={(event) => setShopDomain(event.target.value)} placeholder="store.myshopify.com" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs" /><input type="password" value={shopToken} onChange={(event) => setShopToken(event.target.value)} placeholder="Shopify Admin access token" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs" /><button disabled={busy || !shopDomain || !shopToken} onClick={() => void action(() => connectShopify({ shopDomain, accessToken: shopToken, publicApiBaseUrl: import.meta.env.VITE_API_BASE_URL, autoConvertReadyRequests: true }))} className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">Connect Shopify</button></div>}</section><section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between"><div className="flex items-center gap-2"><CalendarDays size={18} /><h2 className="font-bold">Google Calendar</h2></div><Badge value={google?.connection?.status || 'disconnected'} /></div>{google?.connection ? <div className="mt-4 space-y-3 text-xs"><div><b>Calendar:</b> {google.connection.externalAccountLabel || String(google.connection.configuration.calendarLabel || google.connection.configuration.calendarId || 'Not selected')}</div><div><b>Last sync:</b> {dateTime(google.connection.lastSuccessfulSyncAt)}</div><div><b>Watch expires:</b> {dateTime(String(google.connection.configuration.watchExpiration || ''))}</div><div className="flex gap-2"><button onClick={() => void action(async () => { const values = await listConnectedGoogleCalendars(); setCalendarOptions(values); })} className="rounded-lg border border-slate-200 px-3 py-2 font-semibold">Choose calendar</button><button onClick={() => void action(() => reconcileGoogleCalendar())} className="rounded-lg bg-slate-900 px-3 py-2 font-semibold text-white">Sync bookings</button><button onClick={() => void action(() => createGoogleCalendarWatch(import.meta.env.VITE_API_BASE_URL))} className="rounded-lg border border-slate-200 px-3 py-2 font-semibold">Renew watch</button></div>{calendarOptions.length > 0 && <div className="grid gap-2"><select value={calendarId} onChange={(event) => setCalendarId(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2"><option value="">Select calendar...</option>{calendarOptions.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.summary || calendar.id}</option>)}</select><textarea value={bookingPages} onChange={(event) => setBookingPages(event.target.value)} placeholder="One appointment-schedule booking-page URL per line" className="rounded-xl border border-slate-200 px-3 py-2" /><button disabled={!calendarId} onClick={() => void action(() => configureGoogleCalendar({ expectedVersion: google.connection?.version || 1, calendarId, calendarLabel: calendarOptions.find((item) => item.id === calendarId)?.summary, timezone: 'Australia/Perth', autoConvertReadyRequests: true, bookingPages: bookingPages.split('\n').map((item) => item.trim()).filter(Boolean) }))} className="rounded-lg bg-blue-600 px-3 py-2 font-semibold text-white">Save calendar</button></div>}</div> : <div className="mt-4"><p className="text-xs text-slate-500">Authorise the ProInspect calendar connection, then select the dedicated bookings calendar and register its watch channel.</p><button disabled={busy} onClick={() => void action(async () => { const url = await beginGoogleCalendarConnection(`${window.location.origin}/app/admin/jobs?tab=sync`); window.location.assign(url); })} className="mt-3 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white">Connect Google Calendar</button></div>}</section></div><section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between"><div className="flex items-center gap-2"><ShieldAlert size={18} /><h2 className="font-bold">Sync Exceptions</h2></div><span className="text-xs font-semibold text-slate-500">{exceptions.filter((item) => item.status === 'open').length} open</span></div><div className="mt-4 space-y-2">{exceptions.map((exception) => <div key={exception.id} className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 p-3 md:flex-row"><div><div className="flex items-center gap-2"><Badge value={exception.severity} /><b className="text-xs">{exception.title}</b></div><p className="mt-1 text-xs text-slate-500">{exception.detail}</p></div>{exception.status === 'open' && <div className="flex gap-2"><button onClick={() => void action(() => resolveIntegrationSyncException(exception, 'Resolved by operator.'))} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">Resolve</button><button onClick={() => void action(() => resolveIntegrationSyncException(exception, 'Ignored by operator.', true))} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold">Ignore</button></div>}</div>)}</div></section></div>;
};

export default InspectionOperationsPage;
