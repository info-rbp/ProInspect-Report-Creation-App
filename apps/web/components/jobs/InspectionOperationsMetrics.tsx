import React from 'react';
import type { InspectionOperationsOverview } from '../../services/platform/inspectionOperationsService';

interface Props {
  overview: InspectionOperationsOverview | null;
}

const Metric: React.FC<{
  label: string;
  value: number;
  tone?: 'default' | 'warning' | 'danger';
}> = ({ label, value, tone = 'default' }) => (
  <div
    className={`rounded-xl border p-4 ${
      tone === 'danger'
        ? 'border-rose-200 bg-rose-50/60'
        : tone === 'warning'
          ? 'border-amber-200 bg-amber-50/60'
          : 'border-slate-200 bg-white'
    }`}
  >
    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
      {label}
    </div>
    <div className="mt-1 text-2xl font-black text-slate-950">{value}</div>
  </div>
);

const InspectionOperationsMetrics: React.FC<Props> = ({ overview }) => (
  <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
    <Metric label="New Intake" value={overview?.intake.new ?? 0} />
    <Metric
      label="Awaiting Booking"
      value={overview?.intake.awaitingBooking ?? 0}
      tone="warning"
    />
    <Metric
      label="Property Match"
      value={overview?.intake.propertyMatchRequired ?? 0}
      tone="warning"
    />
    <Metric
      label="Unassigned Jobs"
      value={overview?.jobs.unassigned ?? 0}
      tone="warning"
    />
    <Metric
      label="Sync Exceptions"
      value={overview?.integrations.openExceptions ?? 0}
      tone={overview?.integrations.criticalExceptions ? 'danger' : 'default'}
    />
  </section>
);

export default InspectionOperationsMetrics;
