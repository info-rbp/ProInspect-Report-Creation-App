import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  Archive,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  FileCheck2,
  FileText,
  History,
  MessageSquare,
  Send,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import type { ReportDistributionRecipientRole, ReportLifecycleStatus } from '@pcr/domain';
import { canonicalInspectionType } from '@pcr/domain';
import { useAuth } from '../../contexts/AuthContext';
import {
  createReportDistribution,
  createReportReviewComment,
  getReportConsole,
  listReportAuditHistory,
  resolveReportRecipientResponse,
  reviewReportComponent,
  revokeReportDistribution,
  supersedeReport,
  updateReportReviewComment,
  type ReportConsoleData,
} from '../../services/platform/reportOperationsService';
import { transitionReportLifecycle } from '../../services/platform/reportWorkflowService';

type Tab = 'overview' | 'inspection' | 'qc' | 'review' | 'comparison' | 'tenant' | 'maintenance' | 'distribution' | 'versions' | 'documents' | 'audit';

const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'inspection', label: 'Inspection' },
  { id: 'qc', label: 'Quality Control' },
  { id: 'review', label: 'AI & Review' },
  { id: 'comparison', label: 'Comparison' },
  { id: 'tenant', label: 'Tenant Response' },
  { id: 'maintenance', label: 'Maintenance' },
  { id: 'distribution', label: 'Distribution' },
  { id: 'versions', label: 'Versions' },
  { id: 'documents', label: 'Final Documents' },
  { id: 'audit', label: 'Audit' },
];

function fieldLink(reportId: string, areaId?: string, componentId?: string): string {
  const params = new URLSearchParams();
  if (areaId) params.set('area', areaId);
  if (componentId) params.set('component', componentId);
  return `/app/admin/reports/${reportId}/edit${params.size ? `?${params.toString()}` : ''}`;
}

const ReportDetailPage: React.FC = () => {
  const { reportId } = useParams<{ reportId: string }>();
  const navigate = useNavigate();
  const { userProfile } = useAuth();
  const [data, setData] = useState<ReportConsoleData | null>(null);
  const [audit, setAudit] = useState<Array<Record<string, unknown>>>([]);
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commentBody, setCommentBody] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipientRole, setRecipientRole] = useState<ReportDistributionRecipientRole>('tenant');
  const [correctionReason, setCorrectionReason] = useState('');

  const load = async () => {
    if (!reportId) return;
    setLoading(true);
    setError(null);
    try {
      const next = await getReportConsole(reportId, userProfile?.agencyId);
      setData(next);
      if (userProfile?.role === 'reviewer' || userProfile?.role === 'proinspect_admin' || userProfile?.role === 'super_admin') {
        try { setAudit(await listReportAuditHistory(reportId, userProfile?.agencyId)); } catch { setAudit([]); }
      } else {
        setAudit([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Report console could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [reportId, userProfile?.agencyId]);

  const report = data?.aggregate.report;
  const allComponents = useMemo(() => data?.aggregate.areas.flatMap((area) => area.components.map((component) => ({ area, component }))) ?? [], [data]);
  const reviewQueue = useMemo(() => allComponents.filter(({ component }) => component.reviewStatus !== 'reviewer_approved' || component.aiSuggestion?.status === 'suggested'), [allComponents]);
  const comparisonQueue = useMemo(() => allComponents.filter(({ component }) => component.comparisonStatus && component.comparisonStatus !== 'not_compared' && component.comparisonStatus !== 'unchanged' && component.comparisonStatus !== 'no_material_change'), [allComponents]);
  const openComments = data?.comments.filter((comment) => comment.status === 'open').length ?? 0;
  const role = userProfile?.role;
  const canAnalystReview = role === 'analyst' || role === 'proinspect_admin';
  const canReviewerReview = role === 'reviewer' || role === 'proinspect_admin';
  const canIssue = role === 'operations' || role === 'proinspect_admin';
  const canFinalise = role === 'proinspect_admin';

  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await operation();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Report operation failed.');
    } finally {
      setBusy(false);
    }
  };

  const transition = async (status: ReportLifecycleStatus, reason?: string) => {
    if (!reportId || !report?.version || !userProfile?.agencyId) return;
    await run(() => transitionReportLifecycle(userProfile.agencyId, reportId, status, report.version!, reason));
  };

  if (loading) return <div className="rounded-xl border border-gray-200 bg-white p-8 text-sm text-gray-500">Loading Report Console...</div>;
  if (!data || !report) return <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">{error || 'Report not found.'}</div>;

  const inspectionType = canonicalInspectionType(report.reportType);
  const workflowReady = Object.entries(data.workflow.context).filter(([, value]) => value).length;
  const workflowTotal = Object.keys(data.workflow.context).length;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-gray-500">{report.reportType}</div>
            <h1 className="mt-1 text-2xl font-bold text-gray-950">{report.propertyAddress || 'Untitled report'}</h1>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-600">
              <span className="rounded bg-gray-100 px-2 py-1">{report.lifecycleStatus.replaceAll('_', ' ')}</span>
              <span className="rounded bg-gray-100 px-2 py-1">Inspection {report.inspectionDate || '-'}</span>
              <span className="rounded bg-gray-100 px-2 py-1">Template {report.templateId || 'missing'} v{report.templateVersion || '-'}</span>
              <span className="rounded bg-gray-100 px-2 py-1">Layout {report.propertyLayoutVersionId || 'missing'}</span>
              {report.currentVersionId && <span className="rounded bg-emerald-50 px-2 py-1 font-semibold text-emerald-800">Immutable version {report.currentVersionId.slice(0, 8)}</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {report.inspectionJobId && <Link to={`/app/admin/jobs/${report.inspectionJobId}`} className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700">Inspection Job</Link>}
            {report.propertyId && <Link to={`/app/admin/properties/${report.propertyId}`} className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700">Property</Link>}
            {!['approved_for_issue', 'issued_to_tenant', 'tenant_response_in_progress', 'tenant_submitted', 'agent_response_required', 'finalisation_ready', 'finalised', 'archived'].includes(report.lifecycleStatus) && <Link to={`/app/admin/reports/${report.id}/edit`} className="rounded-lg bg-gray-950 px-3 py-2 text-xs font-semibold text-white">Inspect / Edit</Link>}
            <Link to={`/app/admin/reports/${report.id}/preview`} className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700">Preview / Final Documents</Link>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 border-t border-gray-100 pt-4">
          {canAnalystReview && report.lifecycleStatus === 'analysis_complete' && <button disabled={busy} onClick={() => void transition('review_required')} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white">Send to Review</button>}
          {canReviewerReview && ['review_required', 'internal_review'].includes(report.lifecycleStatus) && (
            <>
              <button disabled={busy || data.qc.status === 'blocked' || openComments > 0} onClick={() => void transition('approved_for_issue')} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">Approve for Issue</button>
              <button disabled={busy} onClick={() => { const reason = window.prompt('Describe the changes required.'); if (reason?.trim()) void transition('changes_requested', reason.trim()); }} className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white">Request Changes</button>
            </>
          )}
          {canIssue && report.lifecycleStatus === 'tenant_submitted' && <button disabled={busy} onClick={() => void transition('agent_response_required')} className="rounded-lg bg-orange-600 px-3 py-2 text-xs font-semibold text-white">Begin Response Review</button>}
          {canIssue && report.lifecycleStatus === 'issued_to_tenant' && <button disabled={busy} onClick={() => void transition('finalisation_ready')} className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700">No Tenant Response Required</button>}
          {canFinalise && report.lifecycleStatus === 'finalisation_ready' && <Link to={`/app/admin/reports/${report.id}/preview`} className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white">Generate Verified PDF & Finalise</Link>}
        </div>
      </div>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}

      <div className="flex gap-1 overflow-x-auto rounded-xl border border-gray-200 bg-white p-2 shadow-sm">
        {tabs.map((item) => (
          <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold ${tab === item.id ? 'bg-gray-950 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
            {item.label}
            {item.id === 'qc' && data.qc.blockerCount > 0 ? ` (${data.qc.blockerCount})` : ''}
            {item.id === 'review' && openComments > 0 ? ` (${openComments})` : ''}
            {item.id === 'tenant' && data.recipientResponses.filter((response) => response.status !== 'resolved').length > 0 ? ` (${data.recipientResponses.filter((response) => response.status !== 'resolved').length})` : ''}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-3">
          <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm lg:col-span-2">
            <h2 className="text-sm font-bold text-gray-900">Authoritative context</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 text-sm">
              <div><span className="text-gray-500">Property:</span><div className="font-semibold">{report.propertyAddress}</div></div>
              <div><span className="text-gray-500">Tenancy:</span><div className="font-semibold">{report.tenantName || report.tenancyId || 'Not linked'}</div></div>
              <div><span className="text-gray-500">Client:</span><div className="font-semibold">{report.clientName || '-'}</div></div>
              <div><span className="text-gray-500">Inspection Job:</span><div className="font-semibold">{report.inspectionJobId || 'Missing'}</div></div>
              <div><span className="text-gray-500">Property Layout Version:</span><div className="font-semibold">{report.propertyLayoutVersionId || 'Missing'}</div></div>
              <div><span className="text-gray-500">Template:</span><div className="font-semibold">{report.templateId || 'Missing'} v{report.templateVersion || '-'}</div></div>
              {inspectionType === 'exit' && <div className="sm:col-span-2"><span className="text-gray-500">Entry baseline:</span><div className="font-semibold">{report.baselineReportId || 'Missing'} / {report.baselineReportVersionId || 'Missing version'}</div></div>}
              {inspectionType === 'maintenance' && <div className="sm:col-span-2"><span className="text-gray-500">Source Maintenance Items:</span><div className="font-semibold">{report.sourceMaintenanceItemIds?.join(', ') || 'See Maintenance tab'}</div></div>}
            </div>
          </section>
          <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2"><ShieldCheck size={18} className={data.qc.status === 'pass' ? 'text-emerald-600' : 'text-amber-600'} /><h2 className="text-sm font-bold">Readiness</h2></div>
            <div className="mt-3 text-3xl font-bold">{workflowReady}/{workflowTotal}</div>
            <div className="text-xs text-gray-500">authoritative workflow gates satisfied</div>
            <div className="mt-3 text-sm"><span className="font-semibold">QC score:</span> {data.qc.score}/100</div>
            <div className="mt-1 text-sm"><span className="font-semibold">QC status:</span> {data.qc.status}</div>
            <div className="mt-3 space-y-1 text-xs text-gray-600">
              {Object.entries(data.workflow.context).map(([gate, value]) => <div key={gate} className="flex items-center gap-2">{value ? <CheckCircle2 size={13} className="text-emerald-600" /> : <AlertTriangle size={13} className="text-amber-600" />}<span>{gate.replaceAll(/([A-Z])/g, ' $1')}</span></div>)}
            </div>
          </section>
        </div>
      )}

      {tab === 'inspection' && (
        <div className="space-y-3">
          {data.aggregate.areas.map((area) => (
            <section key={area.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between"><h2 className="font-bold text-gray-950">{area.name}</h2><Link to={fieldLink(report.id, area.id)} className="text-xs font-semibold text-blue-700">Open area</Link></div>
              <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {area.components.map((component) => (
                  <Link key={component.id} to={fieldLink(report.id, area.id, component.id)} className="rounded-lg border border-gray-200 p-3 hover:bg-gray-50">
                    <div className="text-sm font-semibold text-gray-900">{component.component}</div>
                    <div className="mt-1 text-xs text-gray-500">Condition: {component.conditionCategory.replaceAll('_', ' ')}</div>
                    <div className="text-xs text-gray-500">Cleanliness: {component.cleanlinessCategory.replaceAll('_', ' ')}</div>
                    <div className="text-xs text-gray-500">Working: {component.workingStatus.replaceAll('_', ' ')}</div>
                    <div className="mt-1 text-[11px] text-gray-500">Evidence {component.photoReferences?.length || 0} · Review {component.reviewStatus?.replaceAll('_', ' ')}</div>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {tab === 'qc' && (
        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between"><div><h2 className="text-sm font-bold">Deterministic Quality Control</h2><p className="text-xs text-gray-500">Server-side checks against the same structured report used by workflow decisions.</p></div><div className="text-right"><div className="text-2xl font-bold">{data.qc.score}</div><div className="text-xs uppercase text-gray-500">{data.qc.status}</div></div></div>
          <div className="mt-4 space-y-2">
            {data.qc.issues.length === 0 ? <div className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">No QC issues detected.</div> : data.qc.issues.map((issue) => (
              <div key={issue.id} className={`rounded-lg border p-3 text-sm ${issue.severity === 'blocker' || issue.severity === 'error' ? 'border-rose-200 bg-rose-50' : 'border-amber-200 bg-amber-50'}`}>
                <div className="flex items-start justify-between gap-3"><div><div className="font-semibold">{issue.code.replaceAll('_', ' ')}</div><div className="mt-1 text-xs text-gray-700">{issue.message}</div>{issue.recommendation && <div className="mt-1 text-xs text-gray-500">{issue.recommendation}</div>}</div>{(issue.areaId || issue.componentId) && <Link to={fieldLink(report.id, issue.areaId, issue.componentId)} className="shrink-0 text-xs font-semibold text-blue-700">Fix</Link>}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === 'review' && (
        <div className="grid gap-4 xl:grid-cols-2">
          <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2"><Bot size={18} className="text-purple-600" /><h2 className="text-sm font-bold">Component Review Queue</h2></div>
            <div className="mt-3 space-y-2 max-h-[720px] overflow-y-auto">
              {reviewQueue.length === 0 ? <div className="text-sm text-gray-500">All components have completed reviewer review.</div> : reviewQueue.map(({ area, component }) => (
                <div key={`${area.id}-${component.id}`} className="rounded-lg border border-gray-200 p-3">
                  <div className="flex justify-between gap-3"><div><div className="text-sm font-semibold">{area.name} · {component.component}</div><div className="text-xs text-gray-500">Review: {component.reviewStatus || 'draft'}{typeof component.aiConfidence === 'number' ? ` · AI ${Math.round(component.aiConfidence * 100)}%` : ''}</div></div><Link to={fieldLink(report.id, area.id, component.id)} className="text-xs font-semibold text-blue-700">Inspect</Link></div>
                  {component.aiSuggestion?.status === 'suggested' && <div className="mt-2 rounded bg-purple-50 p-2 text-xs text-purple-800">Pending AI suggestion requires an explicit human decision.</div>}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {canAnalystReview && component.reviewStatus !== 'analyst_reviewed' && component.reviewStatus !== 'reviewer_approved' && <button disabled={busy} onClick={() => void run(() => reviewReportComponent(report.id, area.id, component.id, 'analyst_review', report.version || 1, userProfile?.agencyId))} className="rounded bg-indigo-600 px-2 py-1 text-[11px] font-semibold text-white">Analyst Reviewed</button>}
                    {canReviewerReview && component.reviewStatus !== 'reviewer_approved' && <button disabled={busy} onClick={() => void run(() => reviewReportComponent(report.id, area.id, component.id, 'reviewer_approve', report.version || 1, userProfile?.agencyId))} className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white">Reviewer Approve</button>}
                    {canReviewerReview && <button disabled={busy} onClick={() => void run(() => reviewReportComponent(report.id, area.id, component.id, 'request_changes', report.version || 1, userProfile?.agencyId))} className="rounded bg-rose-600 px-2 py-1 text-[11px] font-semibold text-white">Request Change</button>}
                    {canAnalystReview && component.aiSuggestion?.status === 'suggested' && <><button disabled={busy} onClick={() => void run(() => reviewReportComponent(report.id, area.id, component.id, 'accept_ai', report.version || 1, userProfile?.agencyId))} className="rounded border border-purple-300 px-2 py-1 text-[11px] font-semibold text-purple-700">Accept AI</button><button disabled={busy} onClick={() => void run(() => reviewReportComponent(report.id, area.id, component.id, 'reject_ai', report.version || 1, userProfile?.agencyId))} className="rounded border border-gray-300 px-2 py-1 text-[11px] font-semibold text-gray-700">Reject AI</button></>}
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2"><MessageSquare size={18} /><h2 className="text-sm font-bold">Structured Review Comments</h2></div>
            {canReviewerReview && <form className="mt-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); if (!commentBody.trim()) return; void run(async () => { await createReportReviewComment(report.id, { scope: 'report', body: commentBody.trim(), category: 'other' }, userProfile?.agencyId); setCommentBody(''); }); }}><input value={commentBody} onChange={(event) => setCommentBody(event.target.value)} placeholder="Add review comment..." className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm" /><button disabled={busy || !commentBody.trim()} className="rounded-lg bg-gray-950 px-3 py-2 text-xs font-semibold text-white">Add</button></form>}
            <div className="mt-3 space-y-2">
              {data.comments.length === 0 ? <div className="text-sm text-gray-500">No structured review comments.</div> : data.comments.map((comment) => <div key={comment.id} className="rounded-lg border border-gray-200 p-3"><div className="flex justify-between gap-2"><div><div className="text-xs font-bold uppercase text-gray-500">{comment.scope} · {comment.status}</div><div className="mt-1 text-sm text-gray-800">{comment.body}</div><div className="mt-1 text-[11px] text-gray-500">{comment.createdByRole} · {new Date(comment.createdAt).toLocaleString()}</div></div>{canReviewerReview && <div className="flex gap-1">{comment.status === 'open' && <button disabled={busy} onClick={() => void run(() => updateReportReviewComment(report.id, comment.id, 'resolve', 'Resolved during report review.', userProfile?.agencyId))} className="text-xs font-semibold text-emerald-700">Resolve</button>}{comment.status === 'resolved' && <button disabled={busy} onClick={() => void run(() => updateReportReviewComment(report.id, comment.id, 'verify', undefined, userProfile?.agencyId))} className="text-xs font-semibold text-blue-700">Verify</button>}{comment.status !== 'open' && <button disabled={busy} onClick={() => void run(() => updateReportReviewComment(report.id, comment.id, 'reopen', undefined, userProfile?.agencyId))} className="text-xs font-semibold text-rose-700">Reopen</button>}</div>}</div></div>)}
            </div>
          </section>
        </div>
      )}

      {tab === 'comparison' && (
        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-bold">Baseline & Comparison</h2>
          <div className="mt-2 text-xs text-gray-600">Baseline: {report.baselineReportId || 'Not required / not linked'} {report.baselineReportVersionId ? `· Version ${report.baselineReportVersionId}` : ''}</div>
          <div className="mt-4 space-y-2">{comparisonQueue.length === 0 ? <div className="text-sm text-gray-500">No material comparison exceptions are currently recorded.</div> : comparisonQueue.map(({ area, component }) => <div key={`${area.id}-${component.id}`} className="rounded-lg border border-gray-200 p-3"><div className="flex justify-between"><div><div className="text-sm font-semibold">{area.name} · {component.component}</div><div className="text-xs text-gray-500">{component.comparisonStatus?.replaceAll('_', ' ')} · Review {component.comparisonReviewStatus || 'required'}</div><div className="mt-1 text-xs text-gray-700">{component.comparisonCommentary || component.comparisonUncertainty || 'No comparison commentary.'}</div></div><Link to={fieldLink(report.id, area.id, component.id)} className="text-xs font-semibold text-blue-700">Review</Link></div></div>)}</div>
        </section>
      )}

      {tab === 'tenant' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"><h2 className="text-sm font-bold">Recipient Responses</h2><div className="mt-3 space-y-2">{data.recipientResponses.length === 0 ? <div className="text-sm text-gray-500">No recipient responses submitted.</div> : data.recipientResponses.map((response) => <div key={response.id} className="rounded-lg border border-gray-200 p-3"><div className="text-xs font-bold uppercase text-gray-500">{response.recipientRole} · {response.status}</div><div className="mt-1 text-sm">{response.generalNote || `${response.comments.length} component response(s)`}</div><div className="mt-1 text-xs text-gray-500">Evidence {response.evidencePhotoIds.length} · Submitted {new Date(response.submittedAt).toLocaleString()}</div>{response.status !== 'resolved' && canIssue && <button disabled={busy} onClick={() => { const note = window.prompt('Resolution note'); if (note?.trim()) void run(() => resolveReportRecipientResponse(report.id, response.id, note.trim(), true, userProfile?.agencyId)); }} className="mt-2 rounded bg-emerald-600 px-2 py-1 text-xs font-semibold text-white">Resolve & Move Toward Finalisation</button>}</div>)}</div></section>
          <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"><h2 className="text-sm font-bold">Acknowledgements</h2><div className="mt-3 space-y-2">{data.acknowledgements.length === 0 ? <div className="text-sm text-gray-500">No acknowledgements recorded.</div> : data.acknowledgements.map((ack) => <div key={ack.id} className="rounded-lg border border-gray-200 p-3 text-sm"><div className="font-semibold capitalize">{ack.acknowledgementType}</div><div className="text-xs text-gray-500">{ack.recipientEmail} · {new Date(ack.createdAt).toLocaleString()}</div>{ack.note && <div className="mt-1 text-xs text-gray-700">{ack.note}</div>}</div>)}</div></section>
        </div>
      )}

      {tab === 'maintenance' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"><div className="flex items-center gap-2"><Wrench size={17} /><h2 className="text-sm font-bold">Maintenance Candidates</h2></div><div className="mt-3 space-y-2">{data.maintenanceCandidates.length === 0 ? <div className="text-sm text-gray-500">No Maintenance Candidates linked to this report yet.</div> : data.maintenanceCandidates.map((item) => <div key={String(item.id)} className="rounded-lg border border-gray-200 p-3 text-sm"><div className="font-semibold">{String(item.title || item.description || 'Maintenance candidate')}</div><div className="text-xs text-gray-500">{String(item.reviewStatus || item.status || '')} · {String(item.suggestedPriority || item.priority || '')}</div></div>)}</div></section>
          <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"><h2 className="text-sm font-bold">Confirmed Maintenance Items</h2><div className="mt-3 space-y-2">{data.maintenanceItems.length === 0 ? <div className="text-sm text-gray-500">No confirmed Maintenance Items linked to this report.</div> : data.maintenanceItems.map((item) => <Link to={`/app/admin/maintenance/${String(item.id)}`} key={String(item.id)} className="block rounded-lg border border-gray-200 p-3 text-sm hover:bg-gray-50"><div className="font-semibold">{String(item.title || item.description || 'Maintenance item')}</div><div className="text-xs text-gray-500">{String(item.status || '')} · {String(item.priority || '')}</div></Link>)}</div></section>
        </div>
      )}

      {tab === 'distribution' && (
        <div className="grid gap-4 xl:grid-cols-2">
          <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"><div className="flex items-center gap-2"><Send size={17} /><h2 className="text-sm font-bold">Send Immutable Report Version</h2></div>{canIssue ? <form className="mt-3 grid gap-2 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); if (!recipientEmail.trim()) return; void run(async () => { await createReportDistribution(report.id, { recipientName: recipientName.trim() || recipientEmail.trim(), recipientEmail: recipientEmail.trim(), recipientRole, expiryDays: 14 }, userProfile?.agencyId); setRecipientName(''); setRecipientEmail(''); }); }}><input value={recipientName} onChange={(event) => setRecipientName(event.target.value)} placeholder="Recipient name" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" /><input type="email" value={recipientEmail} onChange={(event) => setRecipientEmail(event.target.value)} placeholder="Recipient email" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" /><select value={recipientRole} onChange={(event) => setRecipientRole(event.target.value as ReportDistributionRecipientRole)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm"><option value="tenant">Tenant</option><option value="landlord">Landlord</option><option value="property_manager">Property Manager</option><option value="client">Client</option><option value="other">Other</option></select><button disabled={busy || !recipientEmail.trim() || !report.currentVersionId} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">Send Secure Report</button></form> : <p className="mt-3 text-sm text-gray-500">Your role does not have report-issue authority.</p>}<p className="mt-2 text-xs text-gray-500">Each link is bound to the exact immutable Report Version and can be revoked independently.</p></section>
          <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"><h2 className="text-sm font-bold">Distribution History</h2><div className="mt-3 space-y-2">{data.distributions.length === 0 ? <div className="text-sm text-gray-500">No report distributions.</div> : data.distributions.map((distribution) => <div key={distribution.id} className="rounded-lg border border-gray-200 p-3"><div className="flex justify-between gap-2"><div><div className="text-sm font-semibold">{distribution.recipientName}</div><div className="text-xs text-gray-500">{distribution.recipientEmail} · {distribution.recipientRole.replaceAll('_', ' ')}</div><div className="mt-1 text-xs text-gray-500">{distribution.status} · Version {distribution.reportVersionId.slice(0, 8)}</div></div>{canIssue && !['revoked', 'expired'].includes(distribution.status) && <button disabled={busy} onClick={() => void run(() => revokeReportDistribution(report.id, distribution.id, userProfile?.agencyId))} className="text-xs font-semibold text-rose-700">Revoke</button>}</div></div>)}</div></section>
        </div>
      )}

      {tab === 'versions' && (
        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"><div className="flex items-center gap-2"><History size={17} /><h2 className="text-sm font-bold">Immutable Version History</h2></div><div className="mt-3 space-y-2">{data.versions.length === 0 ? <div className="text-sm text-gray-500">No immutable version has been created yet.</div> : data.versions.map((version) => <div key={String(version.id)} className="rounded-lg border border-gray-200 p-3"><div className="flex justify-between"><div><div className="text-sm font-semibold">Version {String(version.sequence || '')} · {String(version.lifecycleStatus || '')}</div><div className="text-xs text-gray-500">Created {String(version.createdAt || '')} by {String(version.createdBy || '')}</div></div><div className="text-right text-[11px] text-gray-500">SHA {String(version.contentHash || '').slice(0, 16)}…</div></div></div>)}</div></section>
      )}

      {tab === 'documents' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"><div className="flex items-center gap-2"><FileCheck2 size={17} /><h2 className="text-sm font-bold">Verified Final Artifacts</h2></div><div className="mt-3 space-y-2 text-sm"><div><span className="text-gray-500">Current immutable version:</span><div className="font-mono text-xs">{report.currentVersionId || 'Not created'}</div></div><div><span className="text-gray-500">Final PDF version:</span><div className="font-mono text-xs">{report.finalPdfReportVersionId || 'Not generated'}</div></div><div><span className="text-gray-500">PDF SHA-256:</span><div className="break-all font-mono text-[11px]">{report.finalPdfSha256 || 'Not available'}</div></div><div><span className="text-gray-500">Render manifest:</span><div className="break-all font-mono text-[11px]">{report.renderManifestSha256 || 'Not available'}</div></div><div><span className="text-gray-500">Archive SHA-256:</span><div className="break-all font-mono text-[11px]">{report.archiveManifestSha256 || 'Not available'}</div></div></div><Link to={`/app/admin/reports/${report.id}/preview`} className="mt-4 inline-flex rounded-lg bg-gray-950 px-3 py-2 text-xs font-semibold text-white">Open finalisation workspace</Link></section>
          <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"><h2 className="text-sm font-bold">Correction / Superseding Report</h2><p className="mt-2 text-xs text-gray-500">Issued content is never edited in place. A correction creates a new draft linked back to this immutable version.</p><textarea value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} rows={3} placeholder="Reason for correction" className="mt-3 w-full rounded-lg border border-gray-300 p-3 text-sm" /><button disabled={busy || !correctionReason.trim() || !report.currentVersionId || !canReviewerReview} onClick={() => void run(async () => { const result = await supersedeReport(report.id, correctionReason.trim(), userProfile?.agencyId); navigate(`/app/admin/reports/${result.report.report.id}`); })} className="mt-2 rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">Create Superseding Draft</button></section>
        </div>
      )}

      {tab === 'audit' && (
        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"><div className="flex items-center gap-2"><Archive size={17} /><h2 className="text-sm font-bold">Audit History</h2></div>{audit.length === 0 ? <div className="mt-3 text-sm text-gray-500">Audit history is unavailable for this role or no matching events were found.</div> : <div className="mt-3 space-y-2">{audit.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || ''))).map((event, index) => <div key={String(event.id || index)} className="rounded-lg border border-gray-200 p-3"><div className="text-sm font-semibold">{String(event.eventType || event.reason || 'Report event')}</div><div className="text-xs text-gray-500">{String(event.timestamp || '')} · {String(event.actorId || '')} · {String(event.actorRole || '')}</div></div>)}</div>}</section>
      )}
    </div>
  );
};

export default ReportDetailPage;
