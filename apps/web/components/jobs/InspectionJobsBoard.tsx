import React from 'react';
import { CalendarDays, Grid3X3, List, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import type {
  InspectionJob,
  PropertyRecord,
  UserProfile,
} from '../../types/platform';
import { updateInspectionJob } from '../../services/platform/inspectionJobService';
import { syncInspectionJobCalendar } from '../../services/platform/inspectionOperationsService';
import {
  OperationBadge,
  operationDate,
  operationDateTime,
  sourceIcon,
} from './inspectionOperationsUi';

export type InspectionJobsView = 'list' | 'kanban' | 'calendar';

interface Props {
  jobs: InspectionJob[];
  properties: Map<string, PropertyRecord>;
  inspectors: UserProfile[];
  reviewers: UserProfile[];
  search: string;
  sourceFilter: string;
  statusFilter: string;
  view: InspectionJobsView;
  busy: boolean;
  onSearch: (value: string) => void;
  onSourceFilter: (value: string) => void;
  onStatusFilter: (value: string) => void;
  onView: (value: InspectionJobsView) => void;
  onReload: () => Promise<void>;
  onReport: (job: InspectionJob) => Promise<void>;
  onError: (message: string) => void;
}

const COLUMNS: Array<{ id: string; label: string; statuses: string[] }> = [
  { id: 'planning', label: 'Booked / Assigned', statuses: ['draft', 'booked', 'assigned'] },
  {
    id: 'field',
    label: 'Field Inspection',
    statuses: [
      'inspection_started',
      'photos_uploading',
      'photos_uploaded',
      'inspection_submitted',
    ],
  },
  {
    id: 'review',
    label: 'AI & Review',
    statuses: [
      'analysis_queued',
      'analysis_running',
      'analysis_failed',
      'analysis_complete',
      'analyst_review_in_progress',
      'review_required',
      'reviewer_review_in_progress',
      'changes_requested',
    ],
  },
  {
    id: 'approved',
    label: 'Approved / Issue',
    statuses: ['reviewer_approved', 'ready_to_issue', 'issued_to_tenant'],
  },
  {
    id: 'closed',
    label: 'Finalised',
    statuses: [
      'tenant_viewed',
      'tenant_response_in_progress',
      'tenant_submitted',
      'agent_response_required',
      'finalisation_ready',
      'finalised',
      'archived',
    ],
  },
  { id: 'exceptions', label: 'Exceptions', statuses: ['on_hold', 'cancelled'] },
];

function userName(user: UserProfile): string {
  return user.displayName?.trim() || user.email;
}

const ScheduleView: React.FC<{
  jobs: InspectionJob[];
  properties: Map<string, PropertyRecord>;
}> = ({ jobs, properties }) => {
  const grouped = [...jobs]
    .filter((job) => job.scheduledAt && !['cancelled', 'archived'].includes(job.status))
    .sort((left, right) => String(left.scheduledAt).localeCompare(String(right.scheduledAt)))
    .reduce<Record<string, InspectionJob[]>>((result, job) => {
      const key = job.scheduledAt?.slice(0, 10) || 'unscheduled';
      (result[key] ||= []).push(job);
      return result;
    }, {});

  if (!Object.keys(grouped).length) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 p-12 text-center text-sm text-slate-500">
        No scheduled inspections.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {Object.entries(grouped).map(([date, dayJobs]) => (
        <section key={date} className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-4 flex items-center gap-2 font-bold">
            <CalendarDays size={17} /> {operationDate(date)}
          </div>
          <div className="space-y-2">
            {dayJobs.map((job) => (
              <Link
                key={job.id}
                to={`/app/admin/jobs/${job.id}`}
                className="grid gap-3 rounded-xl border border-slate-200 p-3 md:grid-cols-[140px_1fr_180px_140px]"
              >
                <div className="font-bold">
                  {new Date(job.scheduledAt || '').toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
                <div>
                  <b>{properties.get(job.propertyId)?.address || job.propertyId}</b>
                  <div className="text-xs text-slate-500">{job.reportType}</div>
                </div>
                <div className="text-xs text-slate-600">
                  {job.assignedInspectorId || 'Unassigned inspector'}
                </div>
                <OperationBadge value={job.status} />
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
};

const InspectionJobsBoard: React.FC<Props> = ({
  jobs,
  properties,
  inspectors,
  reviewers,
  search,
  sourceFilter,
  statusFilter,
  view,
  busy,
  onSearch,
  onSourceFilter,
  onStatusFilter,
  onView,
  onReload,
  onReport,
  onError,
}) => (
  <div className="space-y-4">
    <section className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 lg:flex-row lg:items-center">
      <div className="relative flex-1">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          size={15}
        />
        <input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Search property, order, inspector or job..."
          className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-xs"
        />
      </div>
      <select
        value={sourceFilter}
        onChange={(event) => onSourceFilter(event.target.value)}
        className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
      >
        <option value="all">All sources</option>
        <option value="shopify">Shopify</option>
        <option value="google_calendar">Google Calendar</option>
        <option value="manual">Manual</option>
        <option value="property">Property</option>
        <option value="maintenance">Maintenance</option>
        <option value="recurring_schedule">Recurring</option>
      </select>
      <select
        value={statusFilter}
        onChange={(event) => onStatusFilter(event.target.value)}
        className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
      >
        <option value="all">All statuses</option>
        <option value="booked">Booked</option>
        <option value="assigned">Assigned</option>
        <option value="inspection_started">Field inspection</option>
        <option value="review_required">Review required</option>
        <option value="on_hold">On hold</option>
        <option value="finalised">Finalised</option>
      </select>
      <div className="flex rounded-xl border border-slate-200 p-1">
        <button
          type="button"
          onClick={() => onView('list')}
          className={`rounded-lg p-1.5 ${view === 'list' ? 'bg-slate-900 text-white' : 'text-slate-500'}`}
        >
          <List size={15} />
        </button>
        <button
          type="button"
          onClick={() => onView('kanban')}
          className={`rounded-lg p-1.5 ${view === 'kanban' ? 'bg-slate-900 text-white' : 'text-slate-500'}`}
        >
          <Grid3X3 size={15} />
        </button>
        <button
          type="button"
          onClick={() => onView('calendar')}
          className={`rounded-lg p-1.5 ${view === 'calendar' ? 'bg-slate-900 text-white' : 'text-slate-500'}`}
        >
          <CalendarDays size={15} />
        </button>
      </div>
    </section>

    {view === 'list' && (
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Job</th>
                <th className="px-4 py-3">Schedule</th>
                <th className="px-4 py-3">Commercial</th>
                <th className="px-4 py-3">Team</th>
                <th className="px-4 py-3">Readiness</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {jobs.map((job) => {
                const property = properties.get(job.propertyId);
                const readinessErrors =
                  job.readiness?.blockers.filter((item) => item.severity === 'error')
                    .length || 0;
                return (
                  <tr key={job.id} className="align-top hover:bg-slate-50">
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2 font-bold text-slate-900">
                        {sourceIcon(job.source)}
                        <Link
                          to={`/app/admin/jobs/${job.id}`}
                          className="hover:text-blue-600"
                        >
                          {property?.address || job.propertyId}
                        </Link>
                      </div>
                      <div className="mt-1 text-slate-500">
                        {job.reportType} · {job.id}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <OperationBadge value={job.status} />
                        <OperationBadge value={job.source || 'manual'} />
                        <OperationBadge value={job.priority || 'normal'} />
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="font-semibold">
                        {operationDateTime(job.scheduledAt)}
                      </div>
                      <div className="mt-1 text-slate-500">
                        {job.durationMinutes || 60} min ·{' '}
                        {job.timezone || 'Australia/Perth'}
                      </div>
                      {job.googleCalendar?.htmlLink ? (
                        <a
                          href={job.googleCalendar.htmlLink}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 inline-flex items-center gap-1 font-semibold text-blue-600"
                        >
                          <CalendarDays size={12} /> Open event
                        </a>
                      ) : null}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-1">
                        <OperationBadge value={job.paymentStatus || 'not_required'} />
                        <OperationBadge
                          value={
                            job.bookingStatus ||
                            (job.scheduledAt ? 'booked' : 'awaiting_booking')
                          }
                        />
                      </div>
                      <div className="mt-2 text-slate-500">
                        {job.shopifyOrder?.orderNumber || 'No Shopify order'}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <select
                        value={job.assignedInspectorId || ''}
                        onChange={async (event) => {
                          try {
                            await updateInspectionJob(job.id, {
                              assignedInspectorId: event.target.value || undefined,
                              status:
                                event.target.value && job.status === 'booked'
                                  ? 'assigned'
                                  : job.status,
                            });
                            await onReload();
                          } catch (error) {
                            onError(
                              error instanceof Error
                                ? error.message
                                : 'Inspector could not be assigned.',
                            );
                          }
                        }}
                        className="w-48 rounded-lg border border-slate-200 px-2 py-1.5"
                      >
                        <option value="">Unassigned inspector</option>
                        {inspectors.map((user) => (
                          <option key={user.id} value={user.id}>
                            {userName(user)}
                          </option>
                        ))}
                      </select>
                      <select
                        value={job.assignedReviewerId || ''}
                        onChange={async (event) => {
                          try {
                            await updateInspectionJob(job.id, {
                              assignedReviewerId: event.target.value || undefined,
                            });
                            await onReload();
                          } catch (error) {
                            onError(
                              error instanceof Error
                                ? error.message
                                : 'Reviewer could not be assigned.',
                            );
                          }
                        }}
                        className="mt-2 w-48 rounded-lg border border-slate-200 px-2 py-1.5"
                      >
                        <option value="">Unassigned reviewer</option>
                        {reviewers.map((user) => (
                          <option key={user.id} value={user.id}>
                            {userName(user)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2">
                        <OperationBadge value={job.slaStatus || 'on_track'} />
                        {readinessErrors ? (
                          <span className="font-semibold text-rose-600">
                            {readinessErrors} blocker{readinessErrors === 1 ? '' : 's'}
                          </span>
                        ) : (
                          <span className="font-semibold text-emerald-600">Ready</span>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <OperationBadge value={job.accessStatus || 'unknown'} />
                        <OperationBadge
                          value={
                            job.lastCalendarSyncStatus ||
                            (job.googleCalendar ? 'synchronised' : 'not_required')
                          }
                        />
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex justify-end gap-2">
                        <Link
                          to={`/app/admin/jobs/${job.id}`}
                          className="rounded-lg border border-slate-200 px-2.5 py-1.5 font-semibold"
                        >
                          Open
                        </Link>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void syncInspectionJobCalendar(job)
                              .then(onReload)
                              .catch((error: unknown) =>
                                onError(
                                  error instanceof Error
                                    ? error.message
                                    : 'Calendar sync failed.',
                                ),
                              )
                          }
                          className="rounded-lg border border-slate-200 px-2.5 py-1.5 font-semibold"
                        >
                          Calendar
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void onReport(job)}
                          className="rounded-lg bg-blue-600 px-2.5 py-1.5 font-semibold text-white"
                        >
                          {job.reportId ? 'Report' : 'Create report'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!jobs.length ? (
          <div className="p-10 text-center text-sm text-slate-500">
            No inspection jobs match the selected filters.
          </div>
        ) : null}
      </div>
    )}

    {view === 'kanban' ? (
      <div className="grid gap-3 xl:grid-cols-3 2xl:grid-cols-6">
        {COLUMNS.map((column) => {
          const items = jobs.filter((job) => column.statuses.includes(job.status));
          return (
            <section
              key={column.id}
              className="rounded-2xl border border-slate-200 bg-slate-50 p-3"
            >
              <div className="mb-3 flex justify-between text-xs font-bold">
                <span>{column.label}</span>
                <span>{items.length}</span>
              </div>
              <div className="space-y-2">
                {items.map((job) => (
                  <Link
                    key={job.id}
                    to={`/app/admin/jobs/${job.id}`}
                    className="block rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
                  >
                    <div className="font-bold">
                      {properties.get(job.propertyId)?.address || job.propertyId}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">
                      {job.reportType}
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <OperationBadge value={job.source || 'manual'} />
                      <span className="text-[10px] text-slate-500">
                        {operationDate(job.scheduledAt)}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    ) : null}

    {view === 'calendar' ? (
      <ScheduleView jobs={jobs} properties={properties} />
    ) : null}
  </div>
);

export { ScheduleView };
export default InspectionJobsBoard;
