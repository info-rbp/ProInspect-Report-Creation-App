import React, { useEffect, useMemo, useState } from 'react';
import {
  BadgeDollarSign,
  CheckCircle2,
  FileText,
  Link2,
  ReceiptText,
  RefreshCw,
  Send,
  ShieldCheck,
  ShoppingCart,
  XCircle,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import type {
  MaintenanceEstimate,
  MaintenanceFinancialReconciliation,
  MaintenanceItem,
  MaintenanceQuote,
  MaintenanceQuoteVersion,
  MaintenanceWorkOrder,
  PriceBook,
} from '../../types/platform';
import { getMaintenanceItem } from '../../services/platform/maintenanceService';
import {
  createMaintenanceQuote,
  generateMaintenanceEstimate,
  listFinancialReconciliations,
  listMaintenanceEstimates,
  listMaintenanceQuoteVersions,
  listMaintenanceQuotes,
  listMaintenanceWorkOrders,
  listPriceBooks,
  reconcileMaintenanceFinancials,
  sendMaintenanceQuote,
  syncQuoteToXero,
  syncWorkOrderPurchaseOrder,
  transitionMaintenanceQuote,
} from '../../services/platform/maintenanceCommercialService';

function money(value?: number, currency = 'AUD'): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(value || 0);
}

function label(value?: string): string {
  return value
    ? value.replaceAll('_', ' ').replace(/\b\w/gu, (character) => character.toUpperCase())
    : 'Not set';
}

function tone(value?: string): string {
  if (['accepted', 'approved', 'converted_to_work_order', 'invoiced', 'complete', 'synchronised'].includes(value || '')) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }
  if (['declined', 'cancelled', 'failed', 'attention_required'].includes(value || '')) {
    return 'border-rose-200 bg-rose-50 text-rose-700';
  }
  if (['review_required', 'pricing_review_required', 'information_requested', 'pending'].includes(value || '')) {
    return 'border-amber-200 bg-amber-50 text-amber-800';
  }
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

const Badge: React.FC<{ value?: string }> = ({ value }) => (
  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${tone(value)}`}>
    {label(value)}
  </span>
);

export const MaintenanceItemCommercialPanel: React.FC<{ maintenanceId: string }> = ({
  maintenanceId,
}) => {
  const [item, setItem] = useState<MaintenanceItem | null>(null);
  const [estimates, setEstimates] = useState<MaintenanceEstimate[]>([]);
  const [quotes, setQuotes] = useState<MaintenanceQuote[]>([]);
  const [versions, setVersions] = useState<MaintenanceQuoteVersion[]>([]);
  const [workOrders, setWorkOrders] = useState<MaintenanceWorkOrder[]>([]);
  const [financials, setFinancials] = useState<MaintenanceFinancialReconciliation[]>([]);
  const [priceBooks, setPriceBooks] = useState<PriceBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [actualCost, setActualCost] = useState('');
  const [invoiceTotal, setInvoiceTotal] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextItem, allEstimates, allQuotes, allVersions, allWorkOrders, allFinancials, allPriceBooks] =
        await Promise.all([
          getMaintenanceItem(maintenanceId),
          listMaintenanceEstimates(),
          listMaintenanceQuotes(),
          listMaintenanceQuoteVersions(),
          listMaintenanceWorkOrders(),
          listFinancialReconciliations(),
          listPriceBooks(),
        ]);
      setItem(nextItem);
      setEstimates(allEstimates.filter((estimate) => estimate.maintenanceItemId === maintenanceId));
      setQuotes(allQuotes.filter((quote) => quote.maintenanceItemId === maintenanceId));
      setVersions(
        allVersions.filter((version) =>
          allQuotes.some(
            (quote) => quote.maintenanceItemId === maintenanceId && quote.id === version.quoteId,
          ),
        ),
      );
      setWorkOrders(allWorkOrders.filter((order) => order.maintenanceItemId === maintenanceId));
      setFinancials(allFinancials.filter((entry) => entry.maintenanceItemId === maintenanceId));
      setPriceBooks(allPriceBooks);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Commercial maintenance data could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [maintenanceId]);

  const estimate = useMemo(
    () => [...estimates].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0],
    [estimates],
  );
  const quote = useMemo(
    () => [...quotes].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0],
    [quotes],
  );
  const quoteVersion = quote?.currentVersionId
    ? versions.find((version) => version.id === quote.currentVersionId)
    : undefined;
  const workOrder = workOrders[0];
  const financial = financials[0];
  const selectedOption = estimate?.options.find((option) => option.id === estimate.selectedOptionId) || estimate?.options[0];

  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await operation();
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Commercial maintenance operation failed.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="mt-6 flex items-center justify-center rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-500">
        <RefreshCw className="mr-2 animate-spin" size={15} /> Loading pricing and approval...
      </div>
    );
  }
  if (!item) return null;

  return (
    <div className="mt-6 space-y-5">
      {error && (
        <div className="flex items-start justify-between rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          <span>{error}</span>
          <button onClick={() => setError(null)}><XCircle size={16} /></button>
        </div>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col justify-between gap-4 lg:flex-row">
          <div>
            <div className="flex items-center gap-2">
              <BadgeDollarSign size={18} className="text-blue-600" />
              <h2 className="font-black text-slate-950">Pricing & Quote</h2>
              <Badge value={item.pricingStatus || 'not_started'} />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Estimates are calculated from the exact published price-book version and remain separate from client-facing quote versions.
            </p>
          </div>
          <Link
            to="/app/admin/maintenance/configuration"
            className="inline-flex h-fit items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold"
          >
            <Link2 size={13} /> Pricing settings
          </Link>
        </div>

        {!estimate ? (
          <div className="mt-5 flex flex-col gap-3 rounded-2xl bg-slate-50 p-5 sm:flex-row sm:items-end">
            <label className="text-[10px] font-bold uppercase text-slate-500">
              Quantity
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                className="mt-1 block w-28 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
              />
            </label>
            <button
              disabled={busy}
              onClick={() =>
                void run(() =>
                  generateMaintenanceEstimate(item, {
                    preferredPriceBookId: priceBooks[0]?.id,
                    quantity: Number(quantity) || 1,
                  }),
                )
              }
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              <BadgeDollarSign size={14} /> Generate automatic estimate
            </button>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Summary label="Estimate" value={estimate.id.slice(0, 8)} />
              <Summary label="Status" value={label(estimate.status)} />
              <Summary label="Confidence" value={`${Math.round(estimate.confidence * 100)}%`} />
              <Summary label="Options" value={String(estimate.options.length)} />
              <Summary
                label="Recommended"
                value={money(selectedOption?.total, estimate.currency)}
                emphasis
              />
            </div>
            {estimate.reviewReasons.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                {estimate.reviewReasons.join(' ')}
              </div>
            )}
            <div className="grid gap-3 lg:grid-cols-3">
              {estimate.options.map((option) => (
                <div
                  key={option.id}
                  className={`rounded-2xl border p-4 ${
                    option.id === selectedOption?.id
                      ? 'border-blue-300 bg-blue-50/50'
                      : 'border-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <b className="text-sm">{option.label}</b>
                    <Badge value={option.type} />
                  </div>
                  <p className="mt-2 text-xs text-slate-500">{option.description}</p>
                  <div className="mt-3 text-xl font-black">{money(option.total, estimate.currency)}</div>
                  <div className="mt-1 text-[10px] text-slate-400">
                    {option.lineItems.length} line item(s) · GST {money(option.tax, estimate.currency)}
                  </div>
                  {!quote && (
                    <button
                      disabled={busy}
                      onClick={() => void run(() => createMaintenanceQuote(item, estimate, option.id))}
                      className="mt-4 w-full rounded-xl bg-slate-950 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      Create quote from option
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              disabled={busy}
              onClick={() =>
                void run(() =>
                  generateMaintenanceEstimate(item, {
                    preferredPriceBookId: priceBooks[0]?.id,
                    quantity: Number(quantity) || 1,
                  }),
                )
              }
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold disabled:opacity-50"
            >
              <RefreshCw size={13} /> Recalculate estimate
            </button>
          </div>
        )}
      </section>

      {quote && (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col justify-between gap-4 lg:flex-row">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <ReceiptText size={18} className="text-blue-600" />
                <h2 className="font-black">Quote {quote.quoteNumber}</h2>
                <Badge value={quote.status} />
                <Badge value={`xero_${quote.xeroStatus || 'not_connected'}`} />
              </div>
              <p className="mt-2 text-sm text-slate-600">{quoteVersion?.scope || item.recommendedAction || item.title}</p>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-bold uppercase text-slate-400">Quote total</div>
              <div className="mt-1 text-2xl font-black">{money(quote.total, quote.currency)}</div>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            {['draft', 'pricing_review_required'].includes(quote.status) && (
              <button
                disabled={busy}
                onClick={() => void run(() => transitionMaintenanceQuote(quote, 'internal-approve'))}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                <ShieldCheck size={14} /> Internal approval
              </button>
            )}
            {quote.status === 'internally_approved' && (
              <button
                disabled={busy}
                onClick={() => void run(() => transitionMaintenanceQuote(quote, 'ready'))}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold disabled:opacity-50"
              >
                Mark ready to send
              </button>
            )}
            {['internally_approved', 'ready_to_send', 'information_requested'].includes(quote.status) && (
              <button
                disabled={busy}
                onClick={() => {
                  const email = window.prompt('Quote approval recipient:', quote.recipientEmail || '');
                  if (email?.trim()) void run(() => sendMaintenanceQuote(quote, email.trim()));
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                <Send size={14} /> Send to landlord / manager
              </button>
            )}
            <button
              disabled={busy}
              onClick={() => void run(() => syncQuoteToXero(quote.id))}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold disabled:opacity-50"
            >
              <FileText size={14} /> Sync Xero quote
            </button>
          </div>
          {quote.clientApprovalId && (
            <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
              Client approval request {quote.clientApprovalId} · Recipient {quote.recipientEmail || 'not set'}
            </div>
          )}
        </section>
      )}

      {workOrder && (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col justify-between gap-4 lg:flex-row">
            <div>
              <div className="flex items-center gap-2">
                <ShoppingCart size={18} className="text-blue-600" />
                <h2 className="font-black">Work Order {workOrder.workOrderNumber}</h2>
                <Badge value={workOrder.status} />
              </div>
              <p className="mt-2 text-sm text-slate-600">{workOrder.scope}</p>
            </div>
            <div className="text-right text-sm">
              <div className="font-black">{money(workOrder.approvedAmount, workOrder.currency)}</div>
              <div className="mt-1 text-xs text-slate-400">
                {workOrder.xeroPurchaseOrderNumber
                  ? `Xero PO ${workOrder.xeroPurchaseOrderNumber}`
                  : 'No Xero purchase order'}
              </div>
            </div>
          </div>
          <button
            disabled={busy || !workOrder.externalContactId}
            onClick={() => void run(() => syncWorkOrderPurchaseOrder(workOrder.id))}
            className="mt-4 rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold disabled:opacity-40"
          >
            Create / update Xero purchase order
          </button>
        </section>
      )}

      {quote && (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={18} className="text-emerald-600" />
            <h2 className="font-black">Financial Reconciliation</h2>
            <Badge value={financial?.status || 'pending'} />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Summary label="Approved quote" value={money(quote.total, quote.currency)} />
            <Summary label="Variations" value={money(financial?.variationTotal, quote.currency)} />
            <Summary label="Actual contractor cost" value={financial?.actualContractorCost === undefined ? 'Pending' : money(financial.actualContractorCost, quote.currency)} />
            <Summary label="Client invoice" value={financial?.clientInvoiceTotal === undefined ? 'Pending' : money(financial.clientInvoiceTotal, quote.currency)} />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <input
              value={actualCost}
              onChange={(event) => setActualCost(event.target.value)}
              type="number"
              step="0.01"
              placeholder="Actual contractor cost"
              className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
            />
            <input
              value={invoiceTotal}
              onChange={(event) => setInvoiceTotal(event.target.value)}
              type="number"
              step="0.01"
              placeholder="Client invoice total"
              className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
            />
            <button
              disabled={busy}
              onClick={() =>
                void run(() =>
                  reconcileMaintenanceFinancials({
                    maintenanceItemId: item.id,
                    quoteId: quote.id,
                    ...(actualCost ? { actualContractorCost: Number(actualCost) } : {}),
                    ...(invoiceTotal ? { clientInvoiceTotal: Number(invoiceTotal) } : {}),
                  }),
                )
              }
              className="rounded-xl bg-slate-950 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              Reconcile
            </button>
          </div>
          {financial?.varianceReasons.length ? (
            <div className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
              {financial.varianceReasons.join(' ')}
            </div>
          ) : null}
        </section>
      )}

      {item.sourceReportId && (
        <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
          <b>Source provenance:</b>{' '}
          <Link
            to={`/app/admin/reports/${encodeURIComponent(item.sourceReportId)}/edit`}
            className="font-semibold text-blue-600"
          >
            report {item.sourceReportId}
          </Link>{' '}
          · version {item.sourceReportVersionId || 'draft source'} · component{' '}
          {item.sourceComponentId || 'not mapped'}
        </section>
      )}
    </div>
  );
};

const Summary: React.FC<{ label: string; value: string; emphasis?: boolean }> = ({
  label: title,
  value,
  emphasis = false,
}) => (
  <div className="rounded-xl bg-slate-50 p-3">
    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{title}</div>
    <div className={`mt-1 font-bold text-slate-900 ${emphasis ? 'text-lg' : 'text-sm'}`}>{value}</div>
  </div>
);

export default MaintenanceItemCommercialPanel;
