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

const AnalyticsPage: React.FC = () => {
  const [snapshots, setSnapshots] = useState<DashboardSnapshot[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    void listDashboardSnapshots()
      .then((data) => {
        setSnapshots(data || []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const ordered = useMemo(
    () => [...snapshots].sort((a, b) => (a.capturedAt || '').localeCompare(b.capturedAt || '')),
    [snapshots],
  );
  const latest = ordered.at(-1);
  const previous = ordered.at(-2);

  const metrics = Object.keys(LABELS).map((key) => {
    const current = Number(latest?.metrics?.[key] || 0);
    const prior = Number(previous?.metrics?.[key] || 0);
    return { key, current, change: current - prior };
  });

  return (
    <section className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Operational Analytics</h1>
        <p className="text-sm text-slate-600">
          Inspection, evidence, document, maintenance, compliance and integration performance. No trust-balance or money-movement analytics.
        </p>
      </header>
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-800">
          {error}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <article key={metric.key} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-sm text-slate-500">{LABELS[metric.key]}</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">{metric.current}</div>
            <div
              className={`mt-1 text-xs font-medium ${
                metric.change > 0 ? 'text-amber-700' : metric.change < 0 ? 'text-emerald-700' : 'text-slate-500'
              }`}
            >
              {metric.change > 0 ? '+' : ''}
              {metric.change} vs previous snapshot
            </div>
          </article>
        ))}
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="font-semibold text-slate-900">Snapshot history</h2>
        <div className="mt-3 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-slate-600">
                <th className="p-2.5 font-semibold">Date</th>
                <th className="p-2.5 font-semibold">Active jobs</th>
                <th className="p-2.5 font-semibold">Open maintenance</th>
                <th className="p-2.5 font-semibold">Overdue compliance</th>
                <th className="p-2.5 font-semibold">Failed syncs</th>
              </tr>
            </thead>
            <tbody>
              {ordered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-4 text-center text-slate-400">
                    No snapshots recorded yet.
                  </td>
                </tr>
              ) : (
                ordered
                  .slice(-30)
                  .reverse()
                  .map((snapshot) => (
                    <tr key={snapshot.id} className="border-t border-slate-100 text-slate-700 hover:bg-slate-50/50">
                      <td className="p-2.5 font-medium text-slate-900">
                        {snapshot.capturedAt ? new Date(snapshot.capturedAt).toLocaleDateString() : 'N/A'}
                      </td>
                      <td className="p-2.5">{snapshot.metrics?.inspection_jobs_active ?? 0}</td>
                      <td className="p-2.5">{snapshot.metrics?.maintenance_open ?? 0}</td>
                      <td className="p-2.5">{snapshot.metrics?.compliance_overdue ?? 0}</td>
                      <td className="p-2.5">{snapshot.metrics?.integration_sync_runs_failed ?? 0}</td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
};
export default AnalyticsPage;

