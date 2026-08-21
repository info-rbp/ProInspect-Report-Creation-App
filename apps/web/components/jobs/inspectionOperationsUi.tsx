import React from 'react';
import { CalendarDays, FileText, Repeat2, ShoppingBag } from 'lucide-react';

export function operationLabel(value?: string): string {
  return value
    ? value
        .replaceAll('_', ' ')
        .replace(/\b\w/gu, (character) => character.toUpperCase())
    : 'Not set';
}

export function operationDateTime(value?: string): string {
  if (!value) return 'Not scheduled';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export function operationDate(value?: string): string {
  if (!value) return 'Unscheduled';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value.slice(0, 10)
    : parsed.toLocaleDateString();
}

export function sourceIcon(source?: string): React.ReactNode {
  if (source === 'shopify') return <ShoppingBag size={14} />;
  if (source === 'google_calendar') return <CalendarDays size={14} />;
  if (source === 'recurring_schedule') return <Repeat2 size={14} />;
  return <FileText size={14} />;
}

function statusClass(value?: string): string {
  if (
    [
      'paid',
      'booked',
      'matched',
      'converted',
      'ready_for_job',
      'confirmed',
      'synchronised',
      'connected',
      'active',
      'on_track',
    ].includes(value || '')
  ) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }
  if (
    [
      'pending',
      'awaiting_payment',
      'awaiting_booking',
      'awaiting_property',
      'possible_match',
      'attention_required',
      'at_risk',
      'unknown',
      'confirmation_requested',
    ].includes(value || '')
  ) {
    return 'border-amber-200 bg-amber-50 text-amber-800';
  }
  if (
    [
      'failed',
      'cancelled',
      'refunded',
      'overdue',
      'critical',
      'unable_to_access',
      'disconnected',
    ].includes(value || '')
  ) {
    return 'border-rose-200 bg-rose-50 text-rose-700';
  }
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

export const OperationBadge: React.FC<{ value?: string }> = ({ value }) => (
  <span
    className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${statusClass(value)}`}
  >
    {operationLabel(value)}
  </span>
);
