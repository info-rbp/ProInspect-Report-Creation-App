import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  MailPlus,
  RefreshCw,
  Send,
  UsersRound,
  XCircle,
} from 'lucide-react';
import type {
  ContractorQuote,
  ContractorQuoteRequest,
  ExternalContact,
  MaintenanceItem,
} from '../../types/platform';
import {
  getMaintenanceItem,
  listExternalContacts,
} from '../../services/platform/maintenanceService';
import {
  createContractorQuoteRequest,
  issueContractorQuoteRequest,
  listContractorQuoteRequests,
  listContractorQuotes,
  selectContractorQuote,
} from '../../services/platform/contractorQuoteService';

function money(value: number, currency = 'AUD'): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(value || 0);
}

function label(value?: string): string {
  return value
    ? value.replaceAll('_', ' ').replace(/\b\w/gu, (character) => character.toUpperCase())
    : 'Not set';
}

function tone(value?: string): string {
  if (['selected', 'submitted', 'accepted'].includes(value || '')) return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (['cancelled', 'declined', 'expired'].includes(value || '')) return 'border-rose-200 bg-rose-50 text-rose-700';
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

const Badge: React.FC<{ value?: string }> = ({ value }) => (
  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${tone(value)}`}>
    {label(value)}
  </span>
);

export const MaintenanceContractorQuotesPanel: React.FC<{ maintenanceId: string }> = ({ maintenanceId }) => {
  const [item, setItem] = useState<MaintenanceItem | null>(null);
  const [contacts, setContacts] = useState<ExternalContact[]>([]);
  const [requests, setRequests] = useState<ContractorQuoteRequest[]>([]);
  const [quotes, setQuotes] = useState<ContractorQuote[]>([]);
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [scope, setScope] = useState('');
  const [dueAt, setDueAt] = useState(
    new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 16),
  );
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [links, setLinks] = useState<Array<{ email: string; accessUrl: string }>>([]);

  const load = async () => {
    setLoading(true);
    try {
      const [nextItem, nextContacts, nextRequests, nextQuotes] = await Promise.all([
        getMaintenanceItem(maintenanceId),
        listExternalContacts(),
        listContractorQuoteRequests(),
        listContractorQuotes(),
      ]);
      setItem(nextItem);
      setContacts(
        nextContacts.filter((contact) => contact.type === 'contractor' && contact.status === 'active'),
      );
      setRequests(nextRequests.filter((request) => request.maintenanceItemId === maintenanceId));
      setQuotes(nextQuotes.filter((quote) => quote.maintenanceItemId === maintenanceId));
      if (!scope) setScope(nextItem.recommendedAction || nextItem.workInstruction || nextItem.description);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Contractor pricing could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [maintenanceId]);

  const contactMap = useMemo(
    () => new Map(contacts.map((contact) => [contact.id, contact])),
    [contacts],
  );

  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await operation();
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Contractor quote operation failed.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="mt-6 flex items-center justify-center rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-500">
        <RefreshCw size={15} className="mr-2 animate-spin" /> Loading contractor quotes...
      </div>
    );
  }
  if (!item) return null;

  const activeRequest = [...requests]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .find((request) => !['selected', 'cancelled', 'expired'].includes(request.status));

  const createAndIssue = async () => {
    const request = await createContractorQuoteRequest({
      maintenanceItemId: item.id,
      contractorIds: selectedContacts,
      scope: scope.trim(),
      dueAt: new Date(dueAt).toISOString(),
    });
    const issued = await issueContractorQuoteRequest(request);
    setLinks(issued.links.map((link) => ({ email: link.email, accessUrl: link.accessUrl })));
  };

  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col justify-between gap-4 lg:flex-row">
        <div>
          <div className="flex items-center gap-2">
            <UsersRound size={18} className="text-blue-600" />
            <h2 className="font-black text-slate-950">Contractor Quote Comparison</h2>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Request a site or trade quote from multiple contractors when the price book cannot safely determine the scope.
          </p>
        </div>
        {activeRequest && <Badge value={activeRequest.status} />}
      </div>

      {error && (
        <div className="mt-4 flex items-start justify-between rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
          <span>{error}</span>
          <button onClick={() => setError(null)}><XCircle size={15} /></button>
        </div>
      )}

      {!activeRequest && (
        <div className="mt-5 space-y-4 rounded-2xl bg-slate-50 p-5">
          <div className="grid gap-3 lg:grid-cols-[1fr_220px]">
            <textarea
              rows={3}
              value={scope}
              onChange={(event) => setScope(event.target.value)}
              placeholder="Scope contractors should quote..."
              className="rounded-xl border border-slate-200 bg-white p-3 text-xs"
            />
            <label className="text-[10px] font-bold uppercase text-slate-500">
              Quote due
              <input
                type="datetime-local"
                value={dueAt}
                onChange={(event) => setDueAt(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
              />
            </label>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {contacts.map((contact) => (
              <label
                key={contact.id}
                className={`cursor-pointer rounded-xl border p-3 text-xs ${
                  selectedContacts.includes(contact.id)
                    ? 'border-blue-300 bg-blue-50'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <input
                  type="checkbox"
                  className="mr-2"
                  checked={selectedContacts.includes(contact.id)}
                  onChange={(event) =>
                    setSelectedContacts((current) =>
                      event.target.checked
                        ? [...new Set([...current, contact.id])]
                        : current.filter((id) => id !== contact.id),
                    )
                  }
                />
                <b>{contact.businessName || contact.name}</b>
                <div className="mt-1 text-slate-500">{contact.tradeCategories?.join(', ') || contact.email}</div>
              </label>
            ))}
          </div>
          <button
            disabled={busy || !selectedContacts.length || !scope.trim()}
            onClick={() => void run(createAndIssue)}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
          >
            <MailPlus size={14} /> Request contractor quotes
          </button>
        </div>
      )}

      {activeRequest && (
        <div className="mt-5 rounded-2xl border border-slate-200 p-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><b>Request {activeRequest.id}</b><div className="mt-1 text-slate-500">{activeRequest.scope}</div></div>
            <div className="text-right text-slate-500">Due {activeRequest.dueAt ? new Date(activeRequest.dueAt).toLocaleString() : 'not set'}</div>
          </div>
        </div>
      )}

      {links.length > 0 && (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-900">
          <b>Scoped contractor links issued</b>
          {links.map((link) => (
            <div key={link.email} className="mt-2 break-all">
              {link.email}: {link.accessUrl}
            </div>
          ))}
        </div>
      )}

      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        {quotes.map((quote) => (
          <div key={quote.id} className="rounded-2xl border border-slate-200 p-4">
            <div className="flex items-center justify-between gap-3">
              <div><b>{contactMap.get(quote.externalContactId)?.businessName || contactMap.get(quote.externalContactId)?.name || quote.externalContactId}</b><div className="mt-1 text-xs text-slate-500">Submitted {new Date(quote.submittedAt).toLocaleString()}</div></div>
              <Badge value={quote.status} />
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-600">{quote.scope}</p>
            <div className="mt-3 text-xl font-black">{money(quote.total, quote.currency)}</div>
            {quote.exclusions.length > 0 && (
              <div className="mt-2 text-[11px] text-slate-500">Exclusions: {quote.exclusions.join('; ')}</div>
            )}
            {activeRequest && quote.status === 'submitted' && (
              <button
                disabled={busy}
                onClick={() => void run(() => selectContractorQuote(activeRequest, quote.id))}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                <CheckCircle2 size={13} /> Select for internal estimate
              </button>
            )}
          </div>
        ))}
      </div>
      {!quotes.length && activeRequest && (
        <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          No contractor responses have been received yet.
        </div>
      )}
    </section>
  );
};

export default MaintenanceContractorQuotesPanel;
