import React, { useEffect, useMemo, useState } from 'react';
import type { DashboardSnapshot } from '@pcr/domain';
import { Link } from 'react-router-dom';
import { listDashboardSnapshots } from '../../services/platform/dashboardService';

const LABELS: Record<string, string> = {
  inspections_today: 'Inspections today',
  reports_review_required: 'Reports awaiting review',
  maintenance_open: 'Open maintenance',
  compliance_overdue: 'Overdue compliance',
  communications_failed: 'Communication failures',
  document_packets_awaiting_signature: 'Packets awaiting signature',
  tenant_assisted_inspections_open: 'Tenant-assisted inspections open',
  evidence_processing_failed: 'Evidence processing failures',
  integration_sync_runs_failed: 'Integration sync failures',
  keys_checked_out: 'Keys checked out',
};

const LINKS: Record<string, string> = {
  inspections_today: '/app/admin/jobs', reports_review_required: '/app/admin/reports', maintenance_open: '/app/admin/maintenance', compliance_overdue: '/app/admin/compliance', communications_failed: '/app/admin/communications', document_packets_awaiting_signature: '/app/admin/tenants/documents', keys_checked_out: '/app/admin/keys', integration_sync_runs_failed: '/app/admin/settings/integrations',
};
type Range = '7d' | '30d' | '90d' | 'all';

const AnalyticsPage: React.FC = () => {
  const [snapshots, setSnapshots] = useState<DashboardSnapshot[]>([]);
  const [range, setRange] = useState<Range>('30d');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try { setSnapshots((await listDashboardSnapshots()) || []); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const ordered = useMemo(() => [...snapshots].sort((a, b) => (a.capturedAt || '').localeCompare(b.capturedAt || '')), [snapshots]);
  const visible = useMemo(() => {
    if (range === 'all') return ordered;
    const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
    const cutoff = Date.now() - days * 86_400_000;
    return ordered.filter((snapshot) => snapshot.capturedAt && Date.parse(snapshot.capturedAt) >= cutoff);
  }, [ordered, range]);
  const latest = visible.at(-1) || ordered.at(-1);
  const previous = visible.at(-2) || ordered.at(-2);
  const metrics = Object.keys(LABELS).map((key) => {
    const current = Number(latest?.metrics?.[key] || 0);
    const prior = Number(previous?.metrics?.[key] || 0);
    const history = visible.map((snapshot) => Number(snapshot.metrics?.[key] || 0));
    return { key, current, prior, change: current - prior, history };
  });

  const exportCsv = () => {
    if (!visible.length) return;
    const keys = Object.keys(LABELS);
    const rows = [['capturedAt', ...keys], ...visible.map((snapshot) => [snapshot.capturedAt || '', ...keys.map((key) => String(snapshot.metrics?.[key] ?? 0))])];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `proinspect-analytics-${range}.csv`; anchor.click(); URL.revokeObjectURL(url);
  };

  return (
    <section className="space-y-5">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"><div><h1 className="text-2xl font-bold text-slate-900">Operational Analytics</h1><p className="text-sm text-slate-600">Inspection, evidence, document, maintenance, compliance and integration trends. No trust-balance or money-movement analytics.</p></div><div className="flex flex-wrap gap-2"><label className="text-xs font-semibold text-slate-600">Range<select value={range} onChange={(event) => setRange(event.target.value as Range)} className="ml-2 rounded-lg border bg-white px-3 py-2 text-sm font-normal"><option value="7d">7 days</option><option value="30d">30 days</option><option value="90d">90 days</option><option value="all">All history</option></select></label><button type="button" onClick={() => void load()} className="rounded-lg border bg-white px-3 py-2 text-sm font-semibold">Refresh</button><button type="button" onClick={exportCsv} disabled={!visible.length} className="rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">Export CSV</button></div></header>
      {error && <div className="flex justify-between rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-800"><span>{error}</span><button type="button" onClick={() => void load()} className="font-semibold underline">Retry</button></div>}
      {loading ? <div className="rounded-xl border bg-white p-6 text-sm text-slate-500">Loading analytics snapshots…</div> : !ordered.length ? <div className="rounded-xl border border-dashed bg-white p-8 text-center"><div className="font-semibold text-slate-800">No analytics snapshots recorded yet</div><p className="mt-1 text-sm text-slate-500">The dashboard worker must capture snapshots before trend analysis becomes meaningful. Current operational data remains available on the Dashboard.</p></div> : <>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metrics.map((metric) => { const max = Math.max(1, ...metric.history); const content = <article className="h-full rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-sm text-slate-500">{LABELS[metric.key]}</div><div className="mt-1 flex items-end justify-between gap-3"><div className="text-2xl font-bold text-slate-900">{metric.current}</div><div className={`text-xs font-semibold ${metric.change > 0 ? 'text-amber-700' : metric.change < 0 ? 'text-emerald-700' : 'text-slate-500'}`}>{metric.change > 0 ? '+' : ''}{metric.change} vs previous</div></div><div className="mt-4 flex h-10 items-end gap-1" aria-label={`${LABELS[metric.key]} trend`}>{metric.history.slice(-14).map((value, index) => <span key={`${metric.key}-${index}`} className="min-w-1 flex-1 rounded-t bg-slate-300" style={{ height: `${Math.max(8, (value / max) * 100)}%` }} title={String(value)} />)}</div></article>; return LINKS[metric.key] ? <Link key={metric.key} to={LINKS[metric.key]} className="block rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/30">{content}</Link> : <div key={metric.key}>{content}</div>; })}</div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold text-slate-900">Snapshot history</h2><p className="text-xs text-slate-500">{visible.length} snapshot(s) in the selected range</p></div></div><div className="mt-3 overflow-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-slate-100 text-slate-600"><th className="p-2.5 font-semibold">Date</th><th className="p-2.5 font-semibold">Active jobs</th><th className="p-2.5 font-semibold">Open maintenance</th><th className="p-2.5 font-semibold">Overdue compliance</th><th className="p-2.5 font-semibold">Failed syncs</th></tr></thead><tbody>{visible.slice(-90).reverse().map((snapshot) => <tr key={snapshot.id} className="border-t border-slate-100 text-slate-700 hover:bg-slate-50/50"><td className="p-2.5 font-medium text-slate-900">{snapshot.capturedAt ? new Date(snapshot.capturedAt).toLocaleString() : 'N/A'}</td><td className="p-2.5">{snapshot.metrics?.inspection_jobs_active ?? 0}</td><td className="p-2.5">{snapshot.metrics?.maintenance_open ?? 0}</td><td className="p-2.5">{snapshot.metrics?.compliance_overdue ?? 0}</td><td className="p-2.5">{snapshot.metrics?.integration_sync_runs_failed ?? 0}</td></tr>)}</tbody></table></div></div>
      </>}
    </section>
  );
};
export default AnalyticsPage;
