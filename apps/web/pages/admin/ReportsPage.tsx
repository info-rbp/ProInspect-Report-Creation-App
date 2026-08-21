import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { reportLifecycleGroup } from '@pcr/domain';
import { AlertTriangle, Archive, CheckCircle2, ClipboardCheck, FileClock, FileText, Search, Send, Users } from 'lucide-react';
import type { ReportIndex } from '../../types/platform';
import { listReportIndexes } from '../../services/platform/reportIndexService';
import { useAuth } from '../../contexts/AuthContext';

type RegisterView = 'all' | 'my_work' | 'review' | 'changes_requested' | 'ready_to_issue' | 'tenant_response' | 'finalisation' | 'archived';
type ExtendedReportIndex = ReportIndex & {
  assignedUserId?: string;
  assignedInspectorId?: string;
  assignedAnalystId?: string;
  assignedReviewerId?: string;
  currentVersionId?: string;
  qcStatus?: 'pass' | 'warnings' | 'blocked';
  distributionStatus?: string;
  maintenanceExtractionStatus?: string;
  finalPdfReportVersionId?: string;
  archiveReportVersionId?: string;
  version?: number;
};

const views: Array<{ id: RegisterView; label: string }> = [
  { id: 'all', label: 'All Reports' },
  { id: 'my_work', label: 'My Work' },
  { id: 'review', label: 'Review Queue' },
  { id: 'changes_requested', label: 'Changes Requested' },
  { id: 'ready_to_issue', label: 'Ready to Issue' },
  { id: 'tenant_response', label: 'Tenant Responses' },
  { id: 'finalisation', label: 'Finalisation' },
  { id: 'archived', label: 'Archived' },
];

const statusTone: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700',
  photos_uploaded: 'bg-sky-100 text-sky-800',
  analysis_queued: 'bg-purple-100 text-purple-800',
  analysis_running: 'bg-purple-100 text-purple-800',
  analysis_complete: 'bg-indigo-100 text-indigo-800',
  internal_review: 'bg-amber-100 text-amber-800',
  review_required: 'bg-amber-100 text-amber-800',
  changes_requested: 'bg-rose-100 text-rose-800',
  approved_for_issue: 'bg-emerald-100 text-emerald-800',
  issued_to_tenant: 'bg-blue-100 text-blue-800',
  tenant_response_in_progress: 'bg-blue-100 text-blue-800',
  tenant_submitted: 'bg-cyan-100 text-cyan-800',
  agent_response_required: 'bg-orange-100 text-orange-800',
  finalisation_ready: 'bg-violet-100 text-violet-800',
  finalised: 'bg-emerald-100 text-emerald-800',
  archived: 'bg-gray-900 text-white',
  cancelled: 'bg-gray-100 text-gray-500',
};

const ReportsPage: React.FC = () => {
  const { currentUser, userProfile } = useAuth();
  const [reports, setReports] = useState<ExtendedReportIndex[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<RegisterView>('all');
  const [search, setSearch] = useState('');
  const [reportType, setReportType] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setReports((await listReportIndexes()) as ExtendedReportIndex[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reports could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const currentUid = currentUser?.uid || userProfile?.id;
  const matchesView = (report: ExtendedReportIndex): boolean => {
    const group = reportLifecycleGroup(report.lifecycleStatus);
    if (view === 'all') return true;
    if (view === 'my_work') {
      if (!currentUid) return false;
      return [report.assignedUserId, report.assignedInspectorId, report.assignedAnalystId, report.assignedReviewerId].includes(currentUid);
    }
    if (view === 'review') return group === 'review';
    if (view === 'changes_requested') return group === 'changes_requested';
    if (view === 'ready_to_issue') return group === 'ready_to_issue';
    if (view === 'tenant_response') return group === 'tenant_response';
    if (view === 'finalisation') return group === 'finalisation';
    return group === 'archived';
  };

  const filtered = useMemo(() => reports
    .filter(matchesView)
    .filter((report) => reportType === 'all' || report.reportType === reportType)
    .filter((report) => {
      const query = search.trim().toLowerCase();
      if (!query) return true;
      return [report.propertyAddress, report.reportType, report.clientName, report.tenantName, report.reportId]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    })
    .filter((report) => !dateFrom || !report.inspectionDate || report.inspectionDate >= dateFrom)
    .filter((report) => !dateTo || !report.inspectionDate || report.inspectionDate <= dateTo)
    .sort((a, b) => String(b.updatedAt || b.inspectionDate || '').localeCompare(String(a.updatedAt || a.inspectionDate || ''))),
  [reports, reportType, search, dateFrom, dateTo, view, currentUid]);

  const counts = useMemo(() => {
    const result = {
      total: reports.length,
      review: 0,
      changes: 0,
      ready: 0,
      tenant: 0,
      finalisation: 0,
      archived: 0,
    };
    for (const report of reports) {
      const group = reportLifecycleGroup(report.lifecycleStatus);
      if (group === 'review') result.review += 1;
      if (group === 'changes_requested') result.changes += 1;
      if (group === 'ready_to_issue') result.ready += 1;
      if (group === 'tenant_response') result.tenant += 1;
      if (group === 'finalisation') result.finalisation += 1;
      if (group === 'archived') result.archived += 1;
    }
    return result;
  }, [reports]);

  const types = useMemo(() => [...new Set(reports.map((report) => report.reportType).filter(Boolean))].sort(), [reports]);

  const metrics = [
    { label: 'All Reports', value: counts.total, icon: FileText },
    { label: 'Awaiting Review', value: counts.review, icon: ClipboardCheck },
    { label: 'Changes Requested', value: counts.changes, icon: AlertTriangle },
    { label: 'Ready to Issue', value: counts.ready, icon: Send },
    { label: 'Tenant Response', value: counts.tenant, icon: Users },
    { label: 'Finalisation', value: counts.finalisation, icon: FileClock },
    { label: 'Archived', value: counts.archived, icon: Archive },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-950">Reports</h1>
          <p className="text-sm text-gray-600">Authoritative inspection reports, review, issue, recipient response and finalisation.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void load()} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">Refresh</button>
          <Link to="/app/admin/jobs" className="rounded-lg bg-gray-950 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800">Create via Inspection Job</Link>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {metrics.map(({ label, value, icon: Icon }) => (
          <div key={label} className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
            <div className="flex items-center justify-between text-xs font-semibold text-gray-500"><span>{label}</span><Icon size={15} /></div>
            <div className="mt-2 text-2xl font-bold text-gray-950">{value}</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm space-y-3">
        <div className="flex gap-1 overflow-x-auto pb-1">
          {views.map((item) => (
            <button key={item.id} type="button" onClick={() => setView(item.id)} className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold ${view === item.id ? 'bg-gray-950 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
              {item.label}
            </button>
          ))}
        </div>
        <div className="grid gap-2 md:grid-cols-5">
          <label className="relative md:col-span-2">
            <Search size={15} className="absolute left-3 top-2.5 text-gray-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search property, tenant, client or report ID" className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm" />
          </label>
          <select value={reportType} onChange={(event) => setReportType(event.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
            <option value="all">All report types</option>
            {types.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
          <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" title="Inspection date from" />
          <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" title="Inspection date to" />
        </div>
      </div>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-500">Loading authoritative report register...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">No reports match this view.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="p-3">Property</th>
                  <th className="p-3">Type</th>
                  <th className="p-3">Workflow</th>
                  <th className="p-3">Inspection</th>
                  <th className="p-3">Version</th>
                  <th className="p-3">Operational state</th>
                  <th className="p-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((report) => (
                  <tr key={report.id} className="hover:bg-gray-50">
                    <td className="p-3">
                      <Link to={`/app/admin/reports/${report.reportId}`} className="font-semibold text-gray-950 hover:underline">{report.propertyAddress || 'Untitled property'}</Link>
                      <div className="mt-1 text-[11px] text-gray-500">{report.tenantName || report.clientName || report.reportId}</div>
                    </td>
                    <td className="p-3 text-gray-700">{report.reportType}</td>
                    <td className="p-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusTone[report.lifecycleStatus] || 'bg-gray-100 text-gray-700'}`}>{report.lifecycleStatus.replaceAll('_', ' ')}</span></td>
                    <td className="p-3 text-gray-600">{report.inspectionDate || '-'}</td>
                    <td className="p-3 text-xs text-gray-600">{report.currentVersionId ? <span className="inline-flex items-center gap-1"><CheckCircle2 size={13} className="text-emerald-600" /> Immutable</span> : 'Draft'}</td>
                    <td className="p-3 text-xs text-gray-600">
                      <div>{report.distributionStatus ? `Distribution: ${report.distributionStatus.replaceAll('_', ' ')}` : 'Distribution: not started'}</div>
                      <div>{report.maintenanceExtractionStatus ? `Maintenance: ${report.maintenanceExtractionStatus.replaceAll('_', ' ')}` : 'Maintenance: pending lifecycle'}</div>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-2 text-xs font-semibold">
                        <Link className="text-blue-700 hover:underline" to={`/app/admin/reports/${report.reportId}`}>Open console</Link>
                        {!['approved_for_issue', 'issued_to_tenant', 'tenant_response_in_progress', 'tenant_submitted', 'agent_response_required', 'finalisation_ready', 'finalised', 'archived'].includes(report.lifecycleStatus) && (
                          <Link className="text-blue-700 hover:underline" to={`/app/admin/reports/${report.reportId}/edit`}>Inspect/Edit</Link>
                        )}
                        <Link className="text-blue-700 hover:underline" to={`/app/admin/reports/${report.reportId}/preview`}>Preview</Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-gray-500">Operational reports are created through Inspection Jobs so Property, tenancy, layout, Template Version and any required Entry baseline are bound by the server. The Reports register no longer creates independent browser-only reports.</p>
    </div>
  );
};

export default ReportsPage;
