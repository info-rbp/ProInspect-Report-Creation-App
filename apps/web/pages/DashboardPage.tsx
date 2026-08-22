import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { DashboardMetric, DashboardOverview, DashboardRange } from '@pcr/domain';
import { AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getDashboardOverview } from '../services/platform/dashboardService';

const ranges: Array<{ value: DashboardRange; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: 'quarter', label: 'Quarter' },
];

function severityClass(severity?: DashboardMetric['severity']): string {
  if (severity === 'critical') return 'border-red-200 bg-red-50';
  if (severity === 'warning') return 'border-amber-200 bg-amber-50';
  return 'border-gray-200 bg-white';
}

const MetricGrid: React.FC<{ title: string; metrics: DashboardMetric[] }> = ({ title, metrics }) => (
  <section>
    <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-500">{title}</h2>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
      {metrics.map((item) => {
        const card = (
          <div className={`h-full rounded-lg border p-4 shadow-sm transition hover:shadow ${severityClass(item.severity)}`}>
            <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-medium text-gray-600">{item.label}</p><p className="mt-1 text-2xl font-bold text-gray-950">{item.value}</p></div>{item.deepLink ? <ArrowRight size={16} className="mt-1 text-gray-400" /> : null}</div>
          </div>
        );
        return item.deepLink ? <Link key={item.key} to={item.deepLink}>{card}</Link> : <div key={item.key}>{card}</div>;
      })}
    </div>
  </section>
);

const DashboardPage: React.FC = () => {
  const [range, setRange] = useState<DashboardRange>('30d');
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setIsLoading(true);
    setError(null);
    try { setOverview(await getDashboardOverview(range, 'Australia/Perth')); }
    catch (err) { setError(err instanceof Error ? err.message : 'The dashboard could not be loaded.'); }
    finally { if (!quiet) setIsLoading(false); }
  }, [range]);
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(true), 60_000); return () => window.clearInterval(timer); }, [load]);
  const trendEntries = useMemo(() => Object.entries(overview?.trends || {}), [overview]);

  if (isLoading && !overview) return <div className="rounded-lg border border-gray-200 bg-white p-8 text-sm text-gray-600">Loading operational dashboard…</div>;

  return <div className="space-y-8">
    <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><h1 className="text-2xl font-bold text-gray-950">Operations Dashboard</h1><p className="text-sm text-gray-600">Live command centre for inspections, reporting, tenants, maintenance and commercial operations.</p>{overview ? <p className="mt-1 text-xs text-gray-500">Last updated {new Date(overview.generatedAt).toLocaleString('en-AU')} · {overview.role.replaceAll('_', ' ')}</p> : null}</div><div className="flex flex-wrap items-center gap-2"><select value={range} onChange={(event) => setRange(event.target.value as DashboardRange)} className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm">{ranges.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"><RefreshCw size={15} /> Refresh</button></div></header>

    {error ? <div className="flex items-center justify-between gap-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"><span className="flex items-center gap-2"><AlertTriangle size={16} /> {error}</span><button type="button" onClick={() => void load()} className="font-semibold underline">Retry</button></div> : null}

    {overview ? <>
      <MetricGrid title="Today & immediate risk" metrics={overview.today} />
      <MetricGrid title="Operational queues" metrics={overview.workQueues} />
      {overview.attention.length ? <section><div className="mb-3 flex items-center justify-between"><h2 className="text-xs font-bold uppercase tracking-wider text-gray-500">Needs attention</h2><span className="text-xs text-gray-500">Top {overview.attention.length} active exceptions</span></div><div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">{overview.attention.slice(0, 12).map((item) => <Link key={item.id} to={item.deepLink || '#'} className="flex items-center justify-between gap-4 border-b border-gray-100 px-4 py-3 last:border-b-0 hover:bg-gray-50"><div className="min-w-0"><div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${item.severity === 'critical' ? 'bg-red-500' : item.severity === 'warning' ? 'bg-amber-500' : 'bg-blue-500'}`} /><p className="truncate text-sm font-semibold text-gray-900">{item.label}</p></div><p className="mt-1 text-xs text-gray-500">{item.kind}{item.dueAt ? ` · due ${new Date(item.dueAt).toLocaleString('en-AU')}` : ''}</p></div><ArrowRight size={16} className="shrink-0 text-gray-400" /></Link>)}</div></section> : null}
      <div className="grid gap-8 2xl:grid-cols-2"><MetricGrid title="Portfolio & reports" metrics={overview.portfolio} /><MetricGrid title="Tenancies & tenant actions" metrics={overview.tenants} /></div>
      <MetricGrid title="Maintenance & approvals" metrics={overview.maintenance} />
      {overview.commercial ? <section><h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-500">Commercial operations</h2><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><div className="rounded-lg border border-gray-200 bg-white p-4"><p className="text-xs text-gray-500">Quotes awaiting approval</p><p className="mt-1 text-2xl font-bold">{overview.commercial.quotesAwaitingApproval}</p></div><div className="rounded-lg border border-gray-200 bg-white p-4"><p className="text-xs text-gray-500">Value awaiting approval</p><p className="mt-1 text-2xl font-bold">${overview.commercial.quoteValueAwaitingApproval.toLocaleString('en-AU')}</p></div><div className="rounded-lg border border-gray-200 bg-white p-4"><p className="text-xs text-gray-500">Accepted quote value</p><p className="mt-1 text-2xl font-bold">${overview.commercial.acceptedQuoteValue.toLocaleString('en-AU')}</p></div><div className="rounded-lg border border-gray-200 bg-white p-4"><p className="text-xs text-gray-500">Work orders in progress</p><p className="mt-1 text-2xl font-bold">{overview.commercial.workOrdersInProgress}</p></div><div className="rounded-lg border border-gray-200 bg-white p-4"><p className="text-xs text-gray-500">Integration exceptions</p><p className="mt-1 text-2xl font-bold">{overview.commercial.integrationExceptions}</p></div></div></section> : null}
      <section><h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-500">Performance for selected period</h2><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><div className="rounded-lg border border-gray-200 bg-white p-4"><p className="text-xs text-gray-500">Inspections completed</p><p className="mt-1 text-2xl font-bold">{overview.performance.inspectionsCompleted}</p></div><div className="rounded-lg border border-gray-200 bg-white p-4"><p className="text-xs text-gray-500">Reports finalised</p><p className="mt-1 text-2xl font-bold">{overview.performance.reportsFinalised}</p><p className="mt-1 text-xs text-gray-500">Avg {overview.performance.averageReportTurnaroundHours ?? '–'}h · SLA {overview.performance.reportSlaCompliancePercent ?? '–'}%</p></div><div className="rounded-lg border border-gray-200 bg-white p-4"><p className="text-xs text-gray-500">Maintenance closed</p><p className="mt-1 text-2xl font-bold">{overview.performance.maintenanceClosed}</p><p className="mt-1 text-xs text-gray-500">Avg {overview.performance.averageMaintenanceTurnaroundHours ?? '–'}h · SLA {overview.performance.maintenanceSlaCompliancePercent ?? '–'}%</p></div><div className="rounded-lg border border-gray-200 bg-white p-4"><p className="text-xs text-gray-500">Quote acceptance</p><p className="mt-1 text-2xl font-bold">{overview.performance.quoteAcceptancePercent ?? '–'}%</p></div></div></section>
      {overview.capacity.length ? <section><h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-500">Workload & capacity</h2><div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm"><table className="min-w-full text-sm"><thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500"><tr><th className="px-4 py-3">Role</th><th className="px-4 py-3">User</th><th className="px-4 py-3">Assigned</th><th className="px-4 py-3">Due today</th><th className="px-4 py-3">Overdue</th></tr></thead><tbody>{overview.capacity.slice(0, 12).map((row) => <tr key={`${row.role}-${row.userId}`} className="border-t border-gray-100"><td className="px-4 py-3 capitalize">{row.role}</td><td className="px-4 py-3 font-medium">{row.userId}</td><td className="px-4 py-3">{row.assigned}</td><td className="px-4 py-3">{row.dueToday}</td><td className="px-4 py-3 font-semibold text-red-700">{row.overdue}</td></tr>)}</tbody></table></div></section> : null}
      <section><h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-500">Period trends</h2><div className="grid gap-3 md:grid-cols-3">{trendEntries.map(([key, item]) => { const TrendIcon = item.direction === 'up' ? ArrowUpRight : item.direction === 'down' ? ArrowDownRight : ArrowRight; return <div key={key} className="rounded-lg border border-gray-200 bg-white p-4"><div className="flex items-center justify-between"><p className="text-sm font-semibold capitalize text-gray-800">{key.replaceAll(/([A-Z])/g, ' $1')}</p><TrendIcon size={18} className="text-gray-500" /></div><p className="mt-2 text-2xl font-bold">{item.current}</p><p className="mt-1 text-xs text-gray-500">Previous {item.previous} · {item.change >= 0 ? '+' : ''}{item.change}{item.changePercent !== undefined ? ` (${item.changePercent}%)` : ''}</p></div>; })}</div></section>
      <MetricGrid title="Integration health" metrics={overview.integrations} />
    </> : null}
  </div>;
};

export default DashboardPage;
