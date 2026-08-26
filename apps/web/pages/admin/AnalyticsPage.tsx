import React, { useEffect, useMemo, useState } from 'react';
import type { DashboardSnapshot } from '@pcr/domain';
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

type AnalyticsRange = '7d' | '30d' | '90d' | 'all';

function Sparkline({ values }: { values: number[] }) {
  const width = 120;
  const height = 34;
  if (values.length < 2) return <div className="h-[34px] text-[11px] text-slate-400">Trend appears after two snapshots</div>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || 1;
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - 3 - ((value - min) / spread) * (height - 6);
    return `${x},${y}`;
  }).join(' ');
  return <svg viewBox={`0 0 ${width} ${height}`} className="h-[34px] w-full" role="img" aria-label="Metric trend"><polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" className="text-slate-600" /></svg>;
}

const AnalyticsPage: React.FC = () => {
  const [snapshots, setSnapshots] = useState<DashboardSnapshot[]>([]);
  const [range, setRange] = useState<AnalyticsRange>('30d');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError('');
    try { setSnapshots((await listDashboardSnapshots()) || []); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const ordered = useMemo(
    () => [...snapshots].sort((a, b) => (a.capturedAt || '').localeCompare(b.capturedAt || '')),
    [snapshots],
  );
  const filtered = useMemo(() => {
    if (range === 'all') return ordered;
    const days = Number(range.replace('d', ''));
    const cutoff = Date.now() - days * 86_400_000;
    return ordered.filter((snapshot) => snapshot.capturedAt && Date.parse(snapshot.capturedAt) >= cutoff);
  }, [ordered, range]);
  const latest = filtered.at(-1);
  const previous = filtered.at(-2);

  const metrics = Object.keys(LABELS).map((key) => {
    const current = Number(latest?.metrics?.[key] || 0);
    const prior = Number(previous?.metrics?.[key] || 0);
    const values = filtered.map((snapshot) => Number(snapshot.metrics?.[key] || 0));
    return { key, current, change: current - prior, values };
  });

  const exportCsv = () => {
    const metricKeys = Object.keys(LABELS);
    const header = ['captured_at', ...metricKeys];
    const rows = filtered.map((snapshot) => [snapshot.capturedAt || '', ...metricKeys.map((key) => String(snapshot.metrics?.[key] ?? 0))]);
    const csv = [header, ...rows].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `proinspect-operational-analytics-${range}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Operational Analytics</h1>
          <p className="text-sm text-slate-600">Inspection, evidence, document, maintenance, compliance and integration performance. No trust-balance or money-movement analytics.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={range} onChange={(event) => setRange(event.target.value as AnalyticsRange)}><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="90d">Last 90 days</option><option value="all">All snapshots</option></select>
          <button type="button" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40" disabled={!filtered.length} onClick={exportCsv}>Export CSV</button>
          <button type="button" className="rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white" onClick={() => void load()}>Refresh</button>
        </div>
      </header>
      {error && <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-800"><span>{error}</span><button type="button" className="font-semibold underline" onClick={() => void load()}>Retry</button></div>}
      {loading ? <div className="rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-500">Loading operational analytics...</div> : null}
      {!loading && filtered.length === 0 ? <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center"><div className="font-semibold text-slate-900">No analytics snapshots in this period</div><p className="mt-1 text-sm text-slate-500">Operational trends appear as scheduled dashboard snapshots accumulate. Choose a wider range or return after the next snapshot run.</p></div> : null}
      {!loading && filtered.length ? <>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric) => (
            <article key={metric.key} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-sm text-slate-500">{LABELS[metric.key]}</div>
              <div className="mt-1 flex items-end justify-between gap-4"><div><div className="text-2xl font-bold text-slate-900">{metric.current}</div><div className={`mt-1 text-xs font-medium ${metric.change > 0 ? 'text-amber-700' : metric.change < 0 ? 'text-emerald-700' : 'text-slate-500'}`}>{metric.change > 0 ? '+' : ''}{metric.change} vs previous snapshot</div></div><div className="w-28"><Sparkline values={metric.values} /></div></div>
            </article>
          ))}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold text-slate-900">Snapshot history</h2><p className="text-xs text-slate-500">{filtered.length} snapshot{filtered.length === 1 ? '' : 's'} in the selected range.</p></div><span className="text-xs text-slate-500">Latest {latest?.capturedAt ? new Date(latest.capturedAt).toLocaleString('en-AU') : 'N/A'}</span></div>
          <div className="mt-3 overflow-auto">
            <table className="w-full text-left text-sm">
              <thead><tr className="border-b border-slate-100 text-slate-600"><th className="p-2.5 font-semibold">Date</th><th className="p-2.5 font-semibold">Active jobs</th><th className="p-2.5 font-semibold">Open maintenance</th><th className="p-2.5 font-semibold">Overdue compliance</th><th className="p-2.5 font-semibold">Failed syncs</th></tr></thead>
              <tbody>{filtered.slice().reverse().map((snapshot) => <tr key={snapshot.id} className="border-t border-slate-100 text-slate-700 hover:bg-slate-50/50"><td className="p-2.5 font-medium text-slate-900">{snapshot.capturedAt ? new Date(snapshot.capturedAt).toLocaleString('en-AU') : 'N/A'}</td><td className="p-2.5">{snapshot.metrics?.inspection_jobs_active ?? 0}</td><td className="p-2.5">{snapshot.metrics?.maintenance_open ?? 0}</td><td className="p-2.5">{snapshot.metrics?.compliance_overdue ?? 0}</td><td className="p-2.5">{snapshot.metrics?.integration_sync_runs_failed ?? 0}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      </> : null}
    </section>
  );
};
export default AnalyticsPage;
