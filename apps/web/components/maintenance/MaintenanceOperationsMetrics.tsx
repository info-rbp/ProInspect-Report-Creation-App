import React from 'react';
import {
  AlertTriangle,
  BadgeDollarSign,
  ClipboardCheck,
  ClockAlert,
  FileCheck2,
  ReceiptText,
  ShieldAlert,
  Wrench,
} from 'lucide-react';
import type { MaintenanceOperationsOverview } from '../../services/platform/maintenanceCommercialService';

const Metric: React.FC<{
  label: string;
  value: number | string;
  icon: React.ReactNode;
  tone?: 'default' | 'warning' | 'danger' | 'success';
}> = ({ label, value, icon, tone = 'default' }) => {
  const className =
    tone === 'danger'
      ? 'border-rose-200 bg-rose-50/70'
      : tone === 'warning'
        ? 'border-amber-200 bg-amber-50/70'
        : tone === 'success'
          ? 'border-emerald-200 bg-emerald-50/70'
          : 'border-slate-200 bg-white';
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${className}`}>
      <div className="flex items-center justify-between text-slate-500">
        <span className="text-[10px] font-bold uppercase tracking-wide">{label}</span>
        {icon}
      </div>
      <div className="mt-2 text-2xl font-black text-slate-950">{value}</div>
    </div>
  );
};

export const MaintenanceOperationsMetrics: React.FC<{
  overview: MaintenanceOperationsOverview | null;
}> = ({ overview }) => (
  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8">
    <Metric
      label="Awaiting triage"
      value={overview?.candidates.awaitingTriage || 0}
      icon={<AlertTriangle size={18} />}
      tone={overview?.candidates.urgent ? 'danger' : 'default'}
    />
    <Metric
      label="Urgent findings"
      value={overview?.candidates.urgent || 0}
      icon={<ShieldAlert size={18} />}
      tone={overview?.candidates.urgent ? 'danger' : 'default'}
    />
    <Metric
      label="Awaiting pricing"
      value={overview?.items.awaitingPricing || 0}
      icon={<BadgeDollarSign size={18} />}
      tone={overview?.items.awaitingPricing ? 'warning' : 'default'}
    />
    <Metric
      label="Pricing review"
      value={overview?.items.pricingReview || 0}
      icon={<ReceiptText size={18} />}
      tone={overview?.items.pricingReview ? 'warning' : 'default'}
    />
    <Metric
      label="Client decisions"
      value={overview?.quotes.awaitingClient || 0}
      icon={<ClipboardCheck size={18} />}
      tone={overview?.quotes.awaitingClient ? 'warning' : 'default'}
    />
    <Metric
      label="Active work orders"
      value={overview?.workOrders.active || 0}
      icon={<Wrench size={18} />}
    />
    <Metric
      label="Overdue"
      value={overview?.items.overdue || 0}
      icon={<ClockAlert size={18} />}
      tone={overview?.items.overdue ? 'danger' : 'default'}
    />
    <Metric
      label="Quote pipeline"
      value={`$${(overview?.quotes.pipelineValue || 0).toLocaleString('en-AU', {
        maximumFractionDigits: 0,
      })}`}
      icon={<FileCheck2 size={18} />}
      tone="success"
    />
  </div>
);

export default MaintenanceOperationsMetrics;
