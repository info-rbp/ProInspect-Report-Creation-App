import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileText,
  HelpCircle,
  Image,
  Printer,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { useParams } from 'react-router-dom';
import type {
  ClientApproval,
  MaintenanceItem,
  MaintenanceQuote,
  MaintenanceQuoteVersion,
  MaintenanceWorkOrder,
} from '../../types/platform';
import {
  getExternalMaintenanceQuote,
  submitExternalMaintenanceQuoteDecision,
} from '../../services/platform/maintenanceCommercialService';

interface QuotePortalData {
  quote: MaintenanceQuote;
  version: MaintenanceQuoteVersion;
  maintenanceItem: Pick<
    MaintenanceItem,
    'id' | 'title' | 'description' | 'priority' | 'category' | 'sourceEvidenceIds'
  >;
  propertyAddress: string;
  approval: ClientApproval;
}

function money(value: number, currency = 'AUD'): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(value || 0);
}

function label(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/gu, (character) => character.toUpperCase());
}

const ExternalMaintenanceQuotePage: React.FC = () => {
  const { grantToken } = useParams<{ grantToken: string }>();
  const [data, setData] = useState<QuotePortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comments, setComments] = useState('');
  const [result, setResult] = useState<{
    decision: 'accepted' | 'declined' | 'information_requested';
    workOrder?: MaintenanceWorkOrder;
  } | null>(null);

  useEffect(() => {
    if (!grantToken) return;
    getExternalMaintenanceQuote(grantToken)
      .then(setData)
      .catch((failure) =>
        setError(failure instanceof Error ? failure.message : 'Quote approval link is invalid or expired.'),
      )
      .finally(() => setLoading(false));
  }, [grantToken]);

  const decide = async (
    decision: 'accepted' | 'declined' | 'information_requested',
  ) => {
    if (!grantToken) return;
    if ((decision === 'declined' || decision === 'information_requested') && !comments.trim()) {
      setError('Please provide comments before declining or requesting information.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await submitExternalMaintenanceQuoteDecision(
        grantToken,
        decision,
        comments.trim() || undefined,
      );
      setResult({ decision, workOrder: response.workOrder });
      setData((current) =>
        current
          ? {
              ...current,
              quote: { ...current.quote, status: decision },
              approval: {
                ...current.approval,
                status:
                  decision === 'accepted'
                    ? 'approved'
                    : decision === 'declined'
                      ? 'declined'
                      : 'information_requested',
              },
            }
          : current,
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Quote decision could not be recorded.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        Loading maintenance quote...
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 text-center shadow-sm">
          <ShieldAlert className="mx-auto text-rose-500" size={36} />
          <h1 className="mt-4 text-xl font-black text-slate-950">Quote Link Unavailable</h1>
          <p className="mt-2 text-sm text-slate-500">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { quote, version, maintenanceItem, propertyAddress } = data;
  const decisionComplete = ['accepted', 'declined'].includes(quote.status);

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-10 print:bg-white print:p-0">
      <main className="mx-auto w-full max-w-4xl rounded-3xl border border-slate-200 bg-white shadow-sm print:border-0 print:shadow-none">
        <header className="border-b border-slate-100 p-6 sm:p-8">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">
                ProInspect Maintenance
              </div>
              <h1 className="mt-2 text-2xl font-black text-slate-950">Maintenance Quote</h1>
              <p className="mt-1 text-sm text-slate-500">{quote.quoteNumber}</p>
            </div>
            <div className="flex flex-wrap gap-2 print:hidden">
              <button
                onClick={() => window.print()}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700"
              >
                <Printer size={14} /> Print / Save PDF
              </button>
              <button
                onClick={() => window.print()}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700"
              >
                <Download size={14} /> Download
              </button>
            </div>
          </div>

          <div className="mt-6 grid gap-4 rounded-2xl bg-slate-50 p-5 text-sm sm:grid-cols-2">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Property</div>
              <div className="mt-1 font-bold text-slate-900">{propertyAddress}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Valid until</div>
              <div className="mt-1 font-bold text-slate-900">
                {version.validUntil ? new Date(version.validUntil).toLocaleDateString('en-AU') : 'Not specified'}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Maintenance priority</div>
              <div className="mt-1 font-bold text-slate-900">{label(maintenanceItem.priority)}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Quote status</div>
              <div className="mt-1 font-bold text-slate-900">{label(quote.status)}</div>
            </div>
          </div>
        </header>

        <div className="space-y-8 p-6 sm:p-8">
          <section>
            <div className="flex items-center gap-2">
              <FileText size={17} className="text-blue-600" />
              <h2 className="font-black text-slate-950">Issue and Recommended Scope</h2>
            </div>
            <h3 className="mt-4 font-bold text-slate-900">{maintenanceItem.title}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">{maintenanceItem.description}</p>
            <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50/60 p-5">
              <div className="text-[10px] font-bold uppercase tracking-wide text-blue-700">Proposed scope</div>
              <p className="mt-2 text-sm leading-6 text-blue-950">{version.scope}</p>
            </div>
          </section>

          <section>
            <h2 className="font-black text-slate-950">Quote Line Items</h2>
            <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Description</th>
                      <th className="px-4 py-3 text-right">Qty</th>
                      <th className="px-4 py-3 text-right">Unit Price</th>
                      <th className="px-4 py-3 text-right">GST</th>
                      <th className="px-4 py-3 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {version.lineItems.map((line) => (
                      <tr key={line.id}>
                        <td className="px-4 py-4">
                          <div className="font-semibold text-slate-900">{line.description}</div>
                          <div className="mt-1 text-xs text-slate-400">{label(line.unit)}</div>
                        </td>
                        <td className="px-4 py-4 text-right">{line.quantity}</td>
                        <td className="px-4 py-4 text-right">
                          {money(line.unitAmountExcludingTax, version.currency)}
                        </td>
                        <td className="px-4 py-4 text-right">
                          {money(line.taxAmount, version.currency)}
                        </td>
                        <td className="px-4 py-4 text-right font-bold">
                          {money(line.lineTotalIncludingTax, version.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-slate-200 bg-slate-50 p-5">
                <dl className="ml-auto grid max-w-sm grid-cols-2 gap-x-8 gap-y-2 text-sm">
                  <dt className="text-slate-500">Subtotal</dt>
                  <dd className="text-right font-semibold">{money(version.subtotal, version.currency)}</dd>
                  <dt className="text-slate-500">GST</dt>
                  <dd className="text-right font-semibold">{money(version.totalTax, version.currency)}</dd>
                  <dt className="border-t border-slate-200 pt-3 text-base font-black text-slate-950">Total</dt>
                  <dd className="border-t border-slate-200 pt-3 text-right text-xl font-black text-slate-950">
                    {money(version.total, version.currency)}
                  </dd>
                </dl>
              </div>
            </div>
          </section>

          <section className="grid gap-5 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 p-5">
              <h2 className="font-black text-slate-950">Inclusions</h2>
              <ul className="mt-3 space-y-2 text-sm text-slate-600">
                {(version.inclusions.length ? version.inclusions : ['Work described in the approved scope.']).map((item) => (
                  <li key={item} className="flex gap-2"><CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-600" />{item}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-slate-200 p-5">
              <h2 className="font-black text-slate-950">Exclusions</h2>
              <ul className="mt-3 space-y-2 text-sm text-slate-600">
                {(version.exclusions.length ? version.exclusions : ['Concealed conditions or additional work not described in the scope.']).map((item) => (
                  <li key={item} className="flex gap-2"><XCircle size={15} className="mt-0.5 shrink-0 text-slate-400" />{item}</li>
                ))}
              </ul>
            </div>
          </section>

          {version.warrantyDays && (
            <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-900">
              <b>Warranty:</b> {version.warrantyDays} days from verified completion, subject to the stated scope and terms.
            </section>
          )}

          <section>
            <div className="flex items-center gap-2">
              <Image size={17} className="text-slate-500" />
              <h2 className="font-black text-slate-950">Inspection Evidence</h2>
            </div>
            <p className="mt-2 text-sm text-slate-500">
              This quote is linked to {version.evidencePhotoIds.length} source evidence photograph reference(s) from the inspection report.
            </p>
            {version.evidencePhotoIds.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {version.evidencePhotoIds.map((id) => (
                  <span key={id} className="rounded-lg bg-slate-100 px-2 py-1 font-mono text-[10px] text-slate-500">
                    {id}
                  </span>
                ))}
              </div>
            )}
          </section>

          {version.terms && (
            <section className="border-t border-slate-100 pt-6 text-xs leading-5 text-slate-500">
              <b className="text-slate-700">Terms:</b> {version.terms}
            </section>
          )}

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 print:hidden">
              {error}
            </div>
          )}

          {result ? (
            <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center print:hidden">
              <CheckCircle2 className="mx-auto text-emerald-600" size={32} />
              <h2 className="mt-3 text-lg font-black text-emerald-950">
                {result.decision === 'accepted'
                  ? 'Quote Approved'
                  : result.decision === 'declined'
                    ? 'Quote Declined'
                    : 'Information Request Sent'}
              </h2>
              <p className="mt-2 text-sm text-emerald-800">
                Your decision has been recorded. The maintenance team will take the next appropriate action.
              </p>
              {result.workOrder && (
                <p className="mt-2 text-xs text-emerald-700">Work order {result.workOrder.workOrderNumber} has been created.</p>
              )}
            </section>
          ) : (
            <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 print:hidden">
              <h2 className="font-black text-slate-950">Your Decision</h2>
              <textarea
                rows={4}
                value={comments}
                onChange={(event) => setComments(event.target.value)}
                placeholder="Add comments or describe the information you require..."
                className="mt-3 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm"
              />
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                <button
                  disabled={submitting || decisionComplete}
                  onClick={() => void decide('accepted')}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-40"
                >
                  <CheckCircle2 size={16} /> Approve Quote
                </button>
                <button
                  disabled={submitting || decisionComplete}
                  onClick={() => void decide('information_requested')}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-800 disabled:opacity-40"
                >
                  <HelpCircle size={16} /> Request Information
                </button>
                <button
                  disabled={submitting || decisionComplete}
                  onClick={() => void decide('declined')}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-40"
                >
                  <XCircle size={16} /> Decline Quote
                </button>
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
};

export default ExternalMaintenanceQuotePage;
