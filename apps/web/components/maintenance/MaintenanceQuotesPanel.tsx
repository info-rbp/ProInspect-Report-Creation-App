import React, { useMemo, useState } from 'react';
import { CheckCircle2, ReceiptText, Send, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { MaintenanceItem, MaintenanceQuote, MaintenanceQuoteVersion } from '../../types/platform';
import { sendMaintenanceQuote, transitionMaintenanceQuote } from '../../services/platform/maintenanceCommercialService';

function label(value?: string): string {
  return value
    ? value.replaceAll('_', ' ').replace(/\b\w/gu, (character) => character.toUpperCase())
    : 'Not set';
}

function money(value: number, currency = 'AUD'): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(value || 0);
}

function statusTone(status: string): string {
  if (['accepted', 'converted_to_work_order', 'invoiced'].includes(status)) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }
  if (['declined', 'cancelled', 'expired'].includes(status)) {
    return 'border-rose-200 bg-rose-50 text-rose-700';
  }
  if (['pricing_review_required', 'information_requested'].includes(status)) {
    return 'border-amber-200 bg-amber-50 text-amber-800';
  }
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

export const MaintenanceQuotesPanel: React.FC<{
  quotes: MaintenanceQuote[];
  quoteVersions: MaintenanceQuoteVersion[];
  items: MaintenanceItem[];
  onChanged: () => Promise<void>;
}> = ({ quotes, quoteVersions, items, onChanged }) => {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const itemMap = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const versionMap = useMemo(() => new Map(quoteVersions.map((version) => [version.id, version])), [quoteVersions]);

  const run = async (quote: MaintenanceQuote, operation: () => Promise<unknown>) => {
    setBusyId(quote.id);
    setError(null);
    try {
      await operation();
      await onChanged();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Quote operation failed.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-start justify-between rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          <span>{error}</span>
          <button onClick={() => setError(null)}><XCircle size={16} /></button>
        </div>
      )}
      {[...quotes].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).map((quote) => {
        const item = itemMap.get(quote.maintenanceItemId);
        const version = quote.currentVersionId ? versionMap.get(quote.currentVersionId) : undefined;
        return (
          <section key={quote.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col justify-between gap-5 xl:flex-row">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <ReceiptText size={18} className="text-blue-600" />
                  <h3 className="font-bold text-slate-950">{quote.quoteNumber}</h3>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${statusTone(quote.status)}`}>
                    {label(quote.status)}
                  </span>
                </div>
                <div className="mt-2 text-sm font-semibold text-slate-800">{item?.title || quote.maintenanceItemId}</div>
                <div className="mt-1 text-xs text-slate-500">{version?.scope || version?.summary || 'Quote scope unavailable.'}</div>
                <div className="mt-4 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-5">
                  <div><b className="text-slate-700">Subtotal</b><br />{money(quote.subtotal, quote.currency)}</div>
                  <div><b className="text-slate-700">GST</b><br />{money(quote.totalTax, quote.currency)}</div>
                  <div><b className="text-slate-700">Total</b><br /><span className="text-base font-black text-slate-950">{money(quote.total, quote.currency)}</span></div>
                  <div><b className="text-slate-700">Recipient</b><br />{quote.recipientEmail || 'Not resolved'}</div>
                  <div><b className="text-slate-700">Expires</b><br />{quote.expiresAt ? new Date(quote.expiresAt).toLocaleDateString() : 'Not set'}</div>
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-xs font-semibold">
                  <Link to={`/app/admin/maintenance/${encodeURIComponent(quote.maintenanceItemId)}`} className="text-blue-600">Open maintenance item</Link>
                  {quote.workOrderId && <span className="text-slate-500">Work order {quote.workOrderId}</span>}
                </div>
                <p className="mt-3 text-[11px] text-slate-400">Accounting and payment execution remain in the connected property-management or accounting system.</p>
              </div>
              <div className="flex w-full flex-wrap items-start gap-2 xl:w-80 xl:justify-end">
                {['draft', 'pricing_review_required'].includes(quote.status) && (
                  <button disabled={busyId === quote.id} onClick={() => void run(quote, () => transitionMaintenanceQuote(quote, 'internal-approve'))} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
                    <CheckCircle2 size={13} /> Internal approve
                  </button>
                )}
                {quote.status === 'internally_approved' && (
                  <button disabled={busyId === quote.id} onClick={() => void run(quote, () => transitionMaintenanceQuote(quote, 'ready'))} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold">Ready to send</button>
                )}
                {['internally_approved', 'ready_to_send', 'information_requested'].includes(quote.status) && (
                  <button disabled={busyId === quote.id} onClick={() => {
                    const email = window.prompt('Approval recipient email:', quote.recipientEmail || '') || undefined;
                    if (email) void run(quote, () => sendMaintenanceQuote(quote, email));
                  }} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
                    <Send size={13} /> Send for approval
                  </button>
                )}
              </div>
            </div>
          </section>
        );
      })}
      {!quotes.length && <div className="rounded-2xl border border-dashed border-slate-300 p-12 text-center text-sm text-slate-500">No maintenance quotes have been created yet.</div>}
    </div>
  );
};

export default MaintenanceQuotesPanel;
