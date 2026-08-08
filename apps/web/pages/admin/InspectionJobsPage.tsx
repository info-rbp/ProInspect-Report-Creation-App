import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  CheckCircle2,
  Clock,
  Edit3,
  FileText,
  Filter,
  Grid,
  List,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  User,
  X,
} from 'lucide-react';
import type { InspectionJob, InspectionJobStatus, PropertyRecord } from '../../types/platform';
import {
  createInspectionJob,
  deleteInspectionJob,
  listInspectionJobs,
  updateInspectionJob,
} from '../../services/platform/inspectionJobService';
import { listProperties } from '../../services/platform/propertyService';
import { InspectionJobFormModal } from '../../components/jobs/InspectionJobFormModal';
import { generateId } from '../../utils';
import { saveReportToDB } from '../../services/storageService';
import { upsertReportIndexFromReport } from '../../services/platform/reportIndexService';
import { seedReportFromProperty } from '../../services/platform/propertySeedingService';
import type { ReportData } from '../../types';

export const InspectionJobsPage: React.FC = () => {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<InspectionJob[]>([]);
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [reportTypeFilter, setReportTypeFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');
  
  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<InspectionJob | null>(null);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [nextJobs, nextProperties] = await Promise.all([
        listInspectionJobs(),
        listProperties(),
      ]);
      setJobs(nextJobs);
      setProperties(nextProperties);
    } catch (err) {
      console.error('Failed to load inspection jobs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const getPropertyAddress = (propertyId: string) => {
    const prop = properties.find((p) => p.id === propertyId);
    if (!prop) return propertyId;
    return `${prop.address}${prop.suburb ? `, ${prop.suburb}` : ''}`;
  };

  const getPropertyRecord = (propertyId: string) => {
    return properties.find((p) => p.id === propertyId);
  };

  // Filtered Jobs
  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      const propAddress = getPropertyAddress(job.propertyId).toLowerCase();
      const inspector = (job.assignedInspectorId || '').toLowerCase();
      const reviewer = (job.assignedReviewerId || '').toLowerCase();
      const notes = (job.notes || '').toLowerCase();
      const q = searchQuery.toLowerCase();

      const matchesSearch =
        !searchQuery ||
        propAddress.includes(q) ||
        inspector.includes(q) ||
        reviewer.includes(q) ||
        job.id.toLowerCase().includes(q) ||
        notes.includes(q);

      const matchesStatus =
        statusFilter === 'all'
          ? true
          : statusFilter === 'scheduled'
            ? ['booked', 'assigned', 'draft'].includes(job.status)
            : statusFilter === 'in_progress'
              ? ['inspection_started', 'photos_uploading', 'photos_uploaded', 'inspection_submitted'].includes(job.status)
              : statusFilter === 'review'
                ? ['analysis_running', 'review_required', 'reviewer_review_in_progress', 'changes_requested', 'reviewer_approved'].includes(job.status)
                : statusFilter === 'finalised'
                  ? ['ready_to_issue', 'issued_to_tenant', 'finalised'].includes(job.status)
                  : statusFilter === 'exceptions'
                    ? ['on_hold', 'cancelled', 'analysis_failed'].includes(job.status)
                    : job.status === statusFilter;

      const matchesReportType =
        reportTypeFilter === 'all' || job.reportType === reportTypeFilter;

      return matchesSearch && matchesStatus && matchesReportType;
    });
  }, [jobs, properties, searchQuery, statusFilter, reportTypeFilter]);

  // Statistics Summary
  const stats = useMemo(() => {
    const total = jobs.length;
    const scheduled = jobs.filter((j) => ['booked', 'assigned', 'draft'].includes(j.status)).length;
    const inProgress = jobs.filter((j) =>
      ['inspection_started', 'photos_uploading', 'photos_uploaded', 'inspection_submitted', 'analysis_running'].includes(j.status)
    ).length;
    const reviewRequired = jobs.filter((j) => ['review_required', 'changes_requested'].includes(j.status)).length;
    const finalised = jobs.filter((j) => ['ready_to_issue', 'issued_to_tenant', 'finalised'].includes(j.status)).length;

    return { total, scheduled, inProgress, reviewRequired, finalised };
  }, [jobs]);

  const handleSaveJob = async (jobData: Partial<InspectionJob>) => {
    if (editingJob) {
      await updateInspectionJob(editingJob.id, jobData);
    } else {
      await createInspectionJob({
        agencyId: jobData.agencyId || 'proinspect-agency',
        propertyId: jobData.propertyId || '',
        reportType: jobData.reportType || 'Property Condition Report',
        scheduledAt: jobData.scheduledAt,
        assignedInspectorId: jobData.assignedInspectorId,
        assignedReviewerId: jobData.assignedReviewerId,
        tenancyId: jobData.tenancyId,
        googleDriveFolderId: jobData.googleDriveFolderId,
        shopifyOrderId: jobData.shopifyOrderId,
        notes: jobData.notes,
        status: jobData.status || 'booked',
      });
    }
    await loadData();
  };

  const handleDelete = async (id: string) => {
    await deleteInspectionJob(id);
    setDeletingJobId(null);
    await loadData();
  };

  const handleCreateOrOpenReport = async (job: InspectionJob) => {
    if (job.reportId) {
      navigate(`/app/admin/reports/${job.reportId}/edit`);
      return;
    }

    // Create a new report bound to this property and job
    const newReportId = `rep-${generateId().slice(0, 8)}`;
    const prop = getPropertyRecord(job.propertyId);

    let newReport: ReportData;
    if (prop) {
      newReport = seedReportFromProperty(prop, {
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

    // Link report to job and update job status
    await updateInspectionJob(job.id, {
      reportId: newReportId,
      status: job.status === 'booked' || job.status === 'assigned' ? 'inspection_started' : job.status,
    });

    navigate(`/app/admin/reports/${newReportId}/edit`);
  };

  const renderStatusBadge = (status: InspectionJobStatus) => {
    switch (status) {
      case 'booked':
      case 'assigned':
      case 'draft':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
            <Clock className="h-3 w-3" />
            {status.replaceAll('_', ' ')}
          </span>
        );
      case 'inspection_started':
      case 'photos_uploading':
      case 'photos_uploaded':
      case 'inspection_submitted':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
            <Clock className="h-3 w-3" />
            {status.replaceAll('_', ' ')}
          </span>
        );
      case 'analysis_running':
      case 'review_required':
      case 'reviewer_review_in_progress':
      case 'changes_requested':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2.5 py-1 text-xs font-semibold text-purple-700 dark:bg-purple-950/60 dark:text-purple-300">
            <Sparkles className="h-3 w-3" />
            {status.replaceAll('_', ' ')}
          </span>
        );
      case 'ready_to_issue':
      case 'issued_to_tenant':
      case 'finalised':
      case 'reviewer_approved':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
            <CheckCircle2 className="h-3 w-3" />
            {status.replaceAll('_', ' ')}
          </span>
        );
      case 'on_hold':
      case 'cancelled':
      case 'analysis_failed':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
            <AlertTriangle className="h-3 w-3" />
            {status.replaceAll('_', ' ')}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            {status.replaceAll('_', ' ')}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Inspection Jobs Queue
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Schedule field jobs, assign inspectors and reviewers, and manage live lifecycle workflows.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadData}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => {
              setEditingJob(null);
              setIsModalOpen(true);
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            Schedule Inspection Job
          </button>
        </div>
      </div>

      {/* Stats Summary Bar */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Jobs</div>
          <div className="mt-1 text-2xl font-extrabold text-slate-900 dark:text-white">{stats.total}</div>
        </div>
        <div className="rounded-xl border border-blue-200/60 bg-blue-50/40 p-4 shadow-sm dark:border-blue-900/40 dark:bg-blue-950/20">
          <div className="text-xs font-medium text-blue-700 dark:text-blue-300">Scheduled / Booked</div>
          <div className="mt-1 text-2xl font-extrabold text-blue-900 dark:text-blue-100">{stats.scheduled}</div>
        </div>
        <div className="rounded-xl border border-amber-200/60 bg-amber-50/40 p-4 shadow-sm dark:border-amber-900/40 dark:bg-amber-950/20">
          <div className="text-xs font-medium text-amber-700 dark:text-amber-300">In Progress</div>
          <div className="mt-1 text-2xl font-extrabold text-amber-900 dark:text-amber-100">{stats.inProgress}</div>
        </div>
        <div className="rounded-xl border border-purple-200/60 bg-purple-50/40 p-4 shadow-sm dark:border-purple-900/40 dark:bg-purple-950/20">
          <div className="text-xs font-medium text-purple-700 dark:text-purple-300">Review Required</div>
          <div className="mt-1 text-2xl font-extrabold text-purple-900 dark:text-purple-100">{stats.reviewRequired}</div>
        </div>
        <div className="rounded-xl border border-emerald-200/60 bg-emerald-50/40 p-4 shadow-sm dark:border-emerald-900/40 dark:bg-emerald-950/20">
          <div className="text-xs font-medium text-emerald-700 dark:text-emerald-300">Finalised / Completed</div>
          <div className="mt-1 text-2xl font-extrabold text-emerald-900 dark:text-emerald-100">{stats.finalised}</div>
        </div>
      </div>

      {/* Control Bar: Search, Status Filters, View Toggle */}
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          {/* Search Box */}
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by property address, inspector, reviewer, job ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50/50 pl-10 pr-4 py-2 text-xs text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-800/50 dark:text-white"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Filters & View Toggles */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50/80 p-1 dark:border-slate-800 dark:bg-slate-800/50">
              <Filter className="ml-2 h-3.5 w-3.5 text-slate-400" />
              <select
                value={reportTypeFilter}
                onChange={(e) => setReportTypeFilter(e.target.value)}
                className="bg-transparent pr-2 py-1 text-xs font-medium text-slate-700 focus:outline-none dark:text-slate-300"
              >
                <option value="all">All Report Types</option>
                <option value="Property Condition Report">Property Condition Report</option>
                <option value="Routine Inspection">Routine Inspection</option>
                <option value="Exit Inspection">Exit Inspection</option>
                <option value="Inspection Comparison Report">Inspection Comparison Report</option>
                <option value="Maintenance and Follow-Up Report">Maintenance and Follow-Up Report</option>
              </select>
            </div>

            <div className="flex items-center rounded-xl border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-800">
              <button
                onClick={() => setViewMode('table')}
                className={`rounded-lg p-1.5 text-xs font-semibold transition-all ${
                  viewMode === 'table'
                    ? 'bg-white text-blue-600 shadow-sm dark:bg-slate-900 dark:text-blue-400'
                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
                }`}
                title="Table View"
              >
                <List className="h-4 w-4" />
              </button>
              <button
                onClick={() => setViewMode('grid')}
                className={`rounded-lg p-1.5 text-xs font-semibold transition-all ${
                  viewMode === 'grid'
                    ? 'bg-white text-blue-600 shadow-sm dark:bg-slate-900 dark:text-blue-400'
                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
                }`}
                title="Grid Cards View"
              >
                <Grid className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Status Quick Filter Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3 dark:border-slate-800">
          {[
            { id: 'all', label: 'All Jobs' },
            { id: 'scheduled', label: 'Scheduled / Booked' },
            { id: 'in_progress', label: 'In Progress' },
            { id: 'review', label: 'Under Review' },
            { id: 'finalised', label: 'Finalised' },
            { id: 'exceptions', label: 'On Hold / Exceptions' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setStatusFilter(tab.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                statusFilter === tab.id
                  ? 'bg-slate-900 text-white shadow-sm dark:bg-blue-600'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="flex h-64 items-center justify-center rounded-2xl border border-slate-200 bg-white p-8 text-slate-500 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2 text-sm">
            <RefreshCw className="h-4 w-4 animate-spin text-blue-600" />
            <span>Loading inspection jobs...</span>
          </div>
        </div>
      ) : filteredJobs.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center dark:border-slate-800 dark:bg-slate-900">
          <Calendar className="mb-3 h-10 w-10 text-slate-300 dark:text-slate-600" />
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">No Inspection Jobs Found</h3>
          <p className="mt-1 max-w-sm text-xs text-slate-500 dark:text-slate-400">
            {searchQuery || statusFilter !== 'all' || reportTypeFilter !== 'all'
              ? 'Try adjusting your search criteria or clear status filters.'
              : 'There are no active inspection jobs scheduled. Create a new job to start tracking field inspections.'}
          </p>
          <button
            onClick={() => {
              setSearchQuery('');
              setStatusFilter('all');
              setReportTypeFilter('all');
              setEditingJob(null);
              setIsModalOpen(true);
            }}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            Schedule First Inspection Job
          </button>
        </div>
      ) : viewMode === 'table' ? (
        /* Table View */
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:bg-slate-800/80 dark:text-slate-400">
                <tr>
                  <th className="p-3.5 pl-5">Property Address</th>
                  <th className="p-3.5">Report Type</th>
                  <th className="p-3.5">Scheduled</th>
                  <th className="p-3.5">Status</th>
                  <th className="p-3.5">Inspector</th>
                  <th className="p-3.5">Reviewer</th>
                  <th className="p-3.5 pr-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredJobs.map((job) => (
                  <tr key={job.id} className="transition-colors hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                    <td className="p-3.5 pl-5">
                      <Link
                        to={`/app/admin/jobs/${job.id}`}
                        className="font-semibold text-slate-900 hover:text-blue-600 dark:text-white dark:hover:text-blue-400"
                      >
                        {getPropertyAddress(job.propertyId)}
                      </Link>
                      <div className="mt-0.5 text-[11px] text-slate-400 font-mono">Job #{job.id}</div>
                    </td>
                    <td className="p-3.5">
                      <span className="font-medium text-slate-700 dark:text-slate-300">{job.reportType}</span>
                    </td>
                    <td className="p-3.5 text-slate-600 dark:text-slate-300">
                      {job.scheduledAt ? (
                        <div>
                          <div className="font-medium">{new Date(job.scheduledAt).toLocaleDateString()}</div>
                          <div className="text-[11px] text-slate-400">
                            {new Date(job.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-400">Unscheduled</span>
                      )}
                    </td>
                    <td className="p-3.5">{renderStatusBadge(job.status)}</td>
                    <td className="p-3.5 text-slate-600 dark:text-slate-300">
                      {job.assignedInspectorId ? (
                        <div className="flex items-center gap-1.5">
                          <User className="h-3.5 w-3.5 text-slate-400" />
                          <span>{job.assignedInspectorId}</span>
                        </div>
                      ) : (
                        <span className="text-slate-400 italic">Unassigned</span>
                      )}
                    </td>
                    <td className="p-3.5 text-slate-600 dark:text-slate-300">
                      {job.assignedReviewerId ? (
                        <span>{job.assignedReviewerId}</span>
                      ) : (
                        <span className="text-slate-400 italic">Unassigned</span>
                      )}
                    </td>
                    <td className="p-3.5 pr-5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleCreateOrOpenReport(job)}
                          className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-100 dark:bg-blue-950/60 dark:text-blue-300 dark:hover:bg-blue-900/60"
                          title={job.reportId ? 'Open Associated Report' : 'Create Report for Job'}
                        >
                          <FileText className="h-3.5 w-3.5" />
                          <span>{job.reportId ? 'Report' : 'Build Report'}</span>
                        </button>
                        <button
                          onClick={() => {
                            setEditingJob(job);
                            setIsModalOpen(true);
                          }}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                          title="Edit Job Parameters"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setDeletingJobId(job.id)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
                          title="Delete Job"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Grid View */
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredJobs.map((job) => (
            <div
              key={job.id}
              className="group flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:border-blue-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-blue-800"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  {renderStatusBadge(job.status)}
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        setEditingJob(job);
                        setIsModalOpen(true);
                      }}
                      className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setDeletingJobId(job.id)}
                      className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div className="mt-3">
                  <Link
                    to={`/app/admin/jobs/${job.id}`}
                    className="text-sm font-bold text-slate-900 hover:text-blue-600 dark:text-white dark:hover:text-blue-400"
                  >
                    {getPropertyAddress(job.propertyId)}
                  </Link>
                  <p className="mt-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                    {job.reportType}
                  </p>
                </div>

                <div className="mt-4 space-y-2 border-t border-slate-100 pt-3 text-xs dark:border-slate-800">
                  <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                    <span className="flex items-center gap-1.5 text-slate-400">
                      <Clock className="h-3.5 w-3.5 text-amber-500" />
                      Scheduled:
                    </span>
                    <span className="font-semibold">
                      {job.scheduledAt ? new Date(job.scheduledAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : 'Not Scheduled'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                    <span className="flex items-center gap-1.5 text-slate-400">
                      <User className="h-3.5 w-3.5 text-blue-500" />
                      Inspector:
                    </span>
                    <span className="font-medium truncate max-w-[140px]">{job.assignedInspectorId || 'Unassigned'}</span>
                  </div>

                  {job.notes && (
                    <p className="line-clamp-2 rounded-lg bg-slate-50 p-2 text-[11px] text-slate-500 italic dark:bg-slate-800/60 dark:text-slate-400">
                      "{job.notes}"
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-5 flex items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                <Link
                  to={`/app/admin/jobs/${job.id}`}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 hover:text-blue-600 dark:text-slate-300 dark:hover:text-blue-400"
                >
                  View Details <ArrowRight className="h-3 w-3" />
                </Link>

                <button
                  onClick={() => handleCreateOrOpenReport(job)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
                >
                  <FileText className="h-3.5 w-3.5" />
                  <span>{job.reportId ? 'Open Report' : 'Create Report'}</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingJobId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">Delete Inspection Job</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">This action cannot be undone.</p>
              </div>
            </div>
            <p className="mt-4 text-xs text-slate-600 dark:text-slate-300">
              Are you sure you want to permanently delete this inspection job? Associated reports will not be deleted.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setDeletingJobId(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deletingJobId)}
                className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700"
              >
                Delete Job
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Schedule / Edit Modal */}
      <InspectionJobFormModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingJob(null);
        }}
        onSave={handleSaveJob}
        properties={properties}
        initialJob={editingJob}
      />
    </div>
  );
};

export default InspectionJobsPage;
