import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  FileText,
  ShieldAlert,
  Wrench,
  XCircle,
} from 'lucide-react';
import { useParams } from 'react-router-dom';
import type {
  ContractorQuoteRequest,
  ExternalContact,
  MaintenanceItem,
} from '../../types/platform';
import {
  getExternalContractorQuoteRequest,
  submitExternalContractorQuote,
} from '../../services/platform/contractorQuoteService';

interface PortalData {
  request: ContractorQuoteRequest;
  contractor: Pick<ExternalContact, 'id' | 'name' | 'businessName' | 'email'>;
  maintenanceItem: Pick<
    MaintenanceItem,
    'id' | 'title' | 'description' | 'category' | 'priority' | 'sourceEvidenceIds'
  >;
  propertyAddress: string;
}

const ExternalContractorQuotePage: React.FC = () => {
  const { grantToken } = useParams<{ grantToken: string }>();
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState('');
  const [exclusions, setExclusions] = useState('');
  const [subtotal, setSubtotal] = useState('');
  const [tax, setTax] = useState('');
  const [startAt, setStartAt] = useState('');
  const [completionAt, setCompletionAt] = useState('');

  useEffect(() => {
    if (!grantToken) return;
    getExternalContractorQuoteRequest(grantToken)
      .then((value) => {
        setData(value);
        setScope(value.request.scope);
      })
      .catch((failure) =>
        setError(failure instanceof Error ? failure.message : 'Contractor quote link is invalid or expired.'),
      )
      .finally(() => setLoading(false));
  }, [grantToken]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!grantToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitExternalContractorQuote(grantToken, {
        scope: scope.trim(),
        exclusions: exclusions.split(/\n|;/u).map((item) => item.trim()).filter(Boolean),
        ...(startAt ? { estimatedStartAt: new Date(startAt).toISOString() } : {}),
        ...(completionAt ? { estimatedCompletionAt: new Date(completionAt).toISOString() } : {}),
        subtotal: Number(subtotal),
        tax: Number(tax),
        currency: 'AUD',
      });
      setSubmitted(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Contractor quote could not be submitted.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        Loading contractor quote request...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 text-center shadow-sm">
          <ShieldAlert className="mx-auto text-rose-500" size={36} />
          <h1 className="mt-4 text-xl font-black">Quote Request Unavailable</h1>
          <p className="mt-2 text-sm text-slate-500">{error || 'The quote request cannot be accessed.'}</p>
        </div>
      </div>
    );
  }

  const total = (Number(subtotal) || 0) + (Number(tax) || 0);

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-8">
      <main className="mx-auto w-full max-w-3xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <header className="border-b border-slate-100 pb-6">
          <div className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">ProInspect Contractor Portal</div>
          <h1 className="mt-2 text-2xl font-black">Request for Quote</h1>
          <p className="mt-1 text-sm text-slate-500">{data.request.id}</p>
        </header>

        <section className="mt-6 grid gap-4 rounded-2xl bg-slate-50 p-5 text-sm sm:grid-cols-2">
          <div><div className="text-[10px] font-bold uppercase text-slate-400">Property</div><div className="mt-1 font-bold">{data.propertyAddress}</div></div>
          <div><div className="text-[10px] font-bold uppercase text-slate-400">Contractor</div><div className="mt-1 font-bold">{data.contractor.businessName || data.contractor.name}</div></div>
          <div><div className="text-[10px] font-bold uppercase text-slate-400">Priority</div><div className="mt-1 font-bold capitalize">{data.maintenanceItem.priority}</div></div>
          <div><div className="text-[10px] font-bold uppercase text-slate-400">Response due</div><div className="mt-1 font-bold">{data.request.dueAt ? new Date(data.request.dueAt).toLocaleString() : 'Not specified'}</div></div>
        </section>

        <section className="mt-7">
          <div className="flex items-center gap-2"><Wrench size={17} className="text-blue-600" /><h2 className="font-black">Maintenance Requirement</h2></div>
          <h3 className="mt-3 font-bold">{data.maintenanceItem.title}</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">{data.maintenanceItem.description}</p>
          <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 p-5 text-sm text-blue-950">
            <b>Requested scope:</b>
            <p className="mt-2 leading-6">{data.request.scope}</p>
          </div>
          <div className="mt-3 text-xs text-slate-500">
            Inspection evidence references: {data.maintenanceItem.sourceEvidenceIds.length}
          </div>
        </section>

        {submitted ? (
          <section className="mt-8 rounded-2xl border border-emerald-200 bg-emerald-50 p-7 text-center">
            <CheckCircle2 className="mx-auto text-emerald-600" size={36} />
            <h2 className="mt-3 text-lg font-black text-emerald-950">Quote Submitted</h2>
            <p className="mt-2 text-sm text-emerald-800">The ProInspect maintenance team can now review and compare your quote.</p>
          </section>
        ) : (
          <form onSubmit={submit} className="mt-8 space-y-5">
            <div className="flex items-center gap-2"><FileText size={17} /><h2 className="font-black">Your Quote</h2></div>
            <label className="block text-xs font-bold text-slate-700">
              Proposed scope
              <textarea required rows={5} value={scope} onChange={(event) => setScope(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 p-3 text-sm font-normal" />
            </label>
            <label className="block text-xs font-bold text-slate-700">
              Exclusions, one per line
              <textarea rows={3} value={exclusions} onChange={(event) => setExclusions(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 p-3 text-sm font-normal" />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-bold text-slate-700">Estimated start<input type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 p-3 text-sm font-normal" /></label>
              <label className="text-xs font-bold text-slate-700">Estimated completion<input type="datetime-local" value={completionAt} onChange={(event) => setCompletionAt(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 p-3 text-sm font-normal" /></label>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="text-xs font-bold text-slate-700">Subtotal ex GST<input required type="number" min="0" step="0.01" value={subtotal} onChange={(event) => setSubtotal(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 p-3 text-sm font-normal" /></label>
              <label className="text-xs font-bold text-slate-700">GST<input required type="number" min="0" step="0.01" value={tax} onChange={(event) => setTax(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 p-3 text-sm font-normal" /></label>
              <div className="rounded-xl bg-slate-50 p-3"><div className="text-[10px] font-bold uppercase text-slate-400">Total</div><div className="mt-2 text-xl font-black">{new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(total)}</div></div>
            </div>
            {error && <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"><XCircle size={15} />{error}</div>}
            <button disabled={submitting} type="submit" className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">Submit Quote</button>
          </form>
        )}
      </main>
    </div>
  );
};

export default ExternalContractorQuotePage;
