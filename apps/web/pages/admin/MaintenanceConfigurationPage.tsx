import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BookOpenCheck,
  CheckCircle2,
  Cloud,
  FileSpreadsheet,
  KeyRound,
  RefreshCw,
  Save,
  ShieldCheck,
  Upload,
  UsersRound,
  XCircle,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import type {
  ExternalContact,
  PriceBook,
  PriceBookImport,
  PriceBookVersion,
  QuoteApprovalPolicy,
} from '../../types/platform';
import {
  beginXeroConnection,
  configureXero,
  connectXeroCustom,
  createPriceBookImport,
  createQuoteApprovalPolicy,
  disconnectXero,
  getXeroStatus,
  listPriceBookImports,
  listPriceBooks,
  listPriceBookVersions,
  listQuoteApprovalPolicies,
  parsePriceBookSpreadsheet,
  publishPriceBookImport,
  type ParsedSpreadsheet,
  type XeroStatus,
} from '../../services/platform/maintenanceCommercialService';
import {
  createExternalContact,
  listExternalContacts,
} from '../../services/platform/maintenanceService';

const TABS = [
  ['price-books', 'Price Books'],
  ['approval', 'Approval Policies'],
  ['contractors', 'Contractors'],
  ['xero', 'Xero'],
] as const;

type Tab = (typeof TABS)[number][0];

function label(value?: string): string {
  return value
    ? value.replaceAll('_', ' ').replace(/\b\w/gu, (character) => character.toUpperCase())
    : 'Not set';
}

function statusClass(value?: string): string {
  if (['published', 'active', 'connected', 'validated'].includes(value || '')) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }
  if (['review_required', 'attention_required', 'pending'].includes(value || '')) {
    return 'border-amber-200 bg-amber-50 text-amber-800';
  }
  if (['failed', 'rejected', 'disconnected'].includes(value || '')) {
    return 'border-rose-200 bg-rose-50 text-rose-700';
  }
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

const Badge: React.FC<{ value?: string }> = ({ value }) => (
  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${statusClass(value)}`}>
    {label(value)}
  </span>
);

const MaintenanceConfigurationPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('price-books');
  const [imports, setImports] = useState<PriceBookImport[]>([]);
  const [books, setBooks] = useState<PriceBook[]>([]);
  const [versions, setVersions] = useState<PriceBookVersion[]>([]);
  const [policies, setPolicies] = useState<QuoteApprovalPolicy[]>([]);
  const [contacts, setContacts] = useState<ExternalContact[]>([]);
  const [xero, setXero] = useState<XeroStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextImports, nextBooks, nextVersions, nextPolicies, nextContacts, nextXero] =
        await Promise.all([
          listPriceBookImports(),
          listPriceBooks(),
          listPriceBookVersions(),
          listQuoteApprovalPolicies(),
          listExternalContacts(),
          getXeroStatus().catch(() => ({ connection: null, scopes: [], exceptions: [] })),
        ]);
      setImports(nextImports);
      setBooks(nextBooks);
      setVersions(nextVersions);
      setPolicies(nextPolicies);
      setContacts(nextContacts);
      setXero(nextXero);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Maintenance configuration could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-slate-500">
        <RefreshCw size={16} className="mr-2 animate-spin" /> Loading maintenance configuration...
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-16">
      <header className="flex flex-col justify-between gap-4 lg:flex-row">
        <div>
          <Link
            to="/app/admin/maintenance"
            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-900"
          >
            <ArrowLeft size={13} /> Back to Maintenance
          </Link>
          <h1 className="mt-3 text-3xl font-black text-slate-950">Maintenance Configuration</h1>
          <p className="mt-1 text-sm text-slate-500">
            Publish pricing, configure delegated approvals, manage contractors and connect accounting.
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="inline-flex h-fit items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </header>

      {error && (
        <div className="flex items-start justify-between rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          <span>{error}</span>
          <button onClick={() => setError(null)}><XCircle size={16} /></button>
        </div>
      )}

      <nav className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">
        {TABS.map(([id, title]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`whitespace-nowrap rounded-lg px-4 py-2 text-xs font-semibold ${
              tab === id ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            {title}
          </button>
        ))}
      </nav>

      {tab === 'price-books' && (
        <PriceBooksPanel
          imports={imports}
          books={books}
          versions={versions}
          busy={busy}
          onBusy={setBusy}
          onChanged={load}
          onError={setError}
        />
      )}
      {tab === 'approval' && (
        <ApprovalPoliciesPanel policies={policies} onChanged={load} onError={setError} />
      )}
      {tab === 'contractors' && (
        <ContractorsPanel contacts={contacts} onChanged={load} onError={setError} />
      )}
      {tab === 'xero' && (
        <XeroPanel xero={xero} onChanged={load} onError={setError} />
      )}
    </div>
  );
};

const PriceBooksPanel: React.FC<{
  imports: PriceBookImport[];
  books: PriceBook[];
  versions: PriceBookVersion[];
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}> = ({ imports, books, versions, busy, onBusy, onChanged, onError }) => {
  const [parsed, setParsed] = useState<ParsedSpreadsheet | null>(null);
  const [name, setName] = useState('ProInspect Maintenance Price Book');
  const [currency, setCurrency] = useState('AUD');
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));

  const handleFile = async (file?: File) => {
    if (!file) return;
    onBusy(true);
    try {
      const value = await parsePriceBookSpreadsheet(file);
      setParsed(value);
      if (!name.trim() || name === 'ProInspect Maintenance Price Book') {
        setName(file.name.replace(/\.[^.]+$/u, ''));
      }
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : 'Spreadsheet could not be parsed.');
    } finally {
      onBusy(false);
    }
  };

  const importSpreadsheet = async () => {
    if (!parsed) return;
    onBusy(true);
    try {
      await createPriceBookImport(parsed, name.trim());
      setParsed(null);
      await onChanged();
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : 'Price-book import failed.');
    } finally {
      onBusy(false);
    }
  };

  const publish = async (importRecord: PriceBookImport) => {
    onBusy(true);
    try {
      await publishPriceBookImport(importRecord, {
        name: importRecord.proposedPriceBookName || name,
        currency,
        effectiveFrom,
      });
      await onChanged();
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : 'Price book could not be published.');
    } finally {
      onBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <FileSpreadsheet size={18} className="text-blue-600" />
          <h2 className="font-bold">Import Pricing Spreadsheet</h2>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          XLSX, XLS or CSV files are read into a reviewed staging import. Published versions remain immutable so old quotes do not mutate when somebody edits row 47 next year.
        </p>
        <div className="mt-5 grid gap-3 lg:grid-cols-[1fr_220px_140px_160px_auto]">
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-3 text-xs font-semibold text-slate-600 hover:bg-slate-50">
            <Upload size={15} /> {parsed ? parsed.fileName : 'Choose spreadsheet'}
            <input
              type="file"
              accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              className="hidden"
              onChange={(event) => void handleFile(event.target.files?.[0])}
            />
          </label>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Price book name"
            className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
          />
          <input
            value={currency}
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
            maxLength={3}
            className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
          />
          <input
            type="date"
            value={effectiveFrom}
            onChange={(event) => setEffectiveFrom(event.target.value)}
            className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
          />
          <button
            disabled={busy || !parsed}
            onClick={() => void importSpreadsheet()}
            className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
          >
            Stage import
          </button>
        </div>
        {parsed && (
          <div className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 text-xs sm:grid-cols-4">
            <div><b>Worksheet</b><br />{parsed.sheetName}</div>
            <div><b>Rows</b><br />{parsed.rows.length}</div>
            <div><b>File size</b><br />{Math.round(parsed.fileSize / 1024).toLocaleString()} KB</div>
            <div><b>SHA-256</b><br /><span className="break-all font-mono text-[10px]">{parsed.sha256.slice(0, 24)}…</span></div>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2"><BookOpenCheck size={18} /><h2 className="font-bold">Staged Imports</h2></div>
        <div className="mt-4 space-y-3">
          {[...imports].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).map((item) => (
            <div key={item.id} className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-col justify-between gap-3 lg:flex-row">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <b>{item.proposedPriceBookName || item.source.fileName}</b>
                    <Badge value={item.status} />
                  </div>
                  <div className="mt-2 grid gap-3 text-xs text-slate-500 sm:grid-cols-4">
                    <div>Valid: {item.validRowCount}</div>
                    <div>Warnings: {item.warningRowCount}</div>
                    <div>Rejected: {item.rejectedRowCount}</div>
                    <div>{item.sheetName || 'First worksheet'}</div>
                  </div>
                  {item.rows.some((row) => row.errors.length || row.warnings.length) && (
                    <div className="mt-3 max-h-40 overflow-auto rounded-lg bg-slate-50 p-3 text-[11px]">
                      {item.rows
                        .filter((row) => row.errors.length || row.warnings.length)
                        .slice(0, 30)
                        .map((row) => (
                          <div key={row.rowNumber} className="mb-2">
                            <b>Row {row.rowNumber}</b>{' '}
                            <span className="text-rose-600">{row.errors.join(' ')}</span>{' '}
                            <span className="text-amber-700">{row.warnings.join(' ')}</span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
                {['validated', 'review_required'].includes(item.status) && (
                  <button
                    disabled={busy || item.rejectedRowCount > 0}
                    onClick={() => void publish(item)}
                    className="inline-flex h-fit items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
                  >
                    <CheckCircle2 size={14} /> Publish version
                  </button>
                )}
              </div>
            </div>
          ))}
          {!imports.length && <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">No pricing imports have been staged.</div>}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="font-bold">Published Price Books</h2>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {books.map((book) => {
            const current = versions.find((version) => version.id === book.currentPublishedVersionId);
            return (
              <div key={book.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between gap-3"><b>{book.name}</b><Badge value={book.status} /></div>
                <div className="mt-3 grid grid-cols-3 gap-3 text-xs text-slate-500">
                  <div><b className="text-slate-700">Currency</b><br />{book.currency}</div>
                  <div><b className="text-slate-700">Version</b><br />{book.currentPublishedVersionNumber || 0}</div>
                  <div><b className="text-slate-700">Entries</b><br />{current?.entries.length || 0}</div>
                </div>
                {current && <div className="mt-3 text-[10px] text-slate-400">Hash {current.contentHash.slice(0, 24)}…</div>}
              </div>
            );
          })}
          {!books.length && <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">No price book has been published.</div>}
        </div>
      </section>
    </div>
  );
};

const ApprovalPoliciesPanel: React.FC<{
  policies: QuoteApprovalPolicy[];
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}> = ({ policies, onChanged, onError }) => {
  const [name, setName] = useState('Standard maintenance approvals');
  const [delegatedLimit, setDelegatedLimit] = useState('500');
  const [landlordThreshold, setLandlordThreshold] = useState('500');
  const [secondThreshold, setSecondThreshold] = useState('5000');
  const [emergencyLimit, setEmergencyLimit] = useState('1000');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      await createQuoteApprovalPolicy({
        name,
        active: true,
        propertyUses: [],
        propertyManagerDelegatedLimit: Number(delegatedLimit),
        landlordApprovalThreshold: Number(landlordThreshold),
        secondApprovalThreshold: Number(secondThreshold),
        emergencyAuthorisationLimit: Number(emergencyLimit),
        mandatoryReplacementApproval: true,
        mandatoryCapitalApproval: true,
        mandatoryCosmeticApproval: true,
        autoApprovePreauthorisedServices: false,
        approvalLinkExpiryHours: 168,
        reminderHours: [24, 72, 120],
      });
      await onChanged();
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : 'Approval policy could not be created.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2"><ShieldCheck size={18} /><h2 className="font-bold">Create Approval Policy</h2></div>
        <div className="mt-4 grid gap-3 lg:grid-cols-5">
          <input value={name} onChange={(event) => setName(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs" />
          <label className="text-[10px] font-bold uppercase text-slate-500">PM delegated limit<input value={delegatedLimit} onChange={(event) => setDelegatedLimit(event.target.value)} type="number" className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs" /></label>
          <label className="text-[10px] font-bold uppercase text-slate-500">Landlord threshold<input value={landlordThreshold} onChange={(event) => setLandlordThreshold(event.target.value)} type="number" className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs" /></label>
          <label className="text-[10px] font-bold uppercase text-slate-500">Second approval<input value={secondThreshold} onChange={(event) => setSecondThreshold(event.target.value)} type="number" className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs" /></label>
          <label className="text-[10px] font-bold uppercase text-slate-500">Emergency limit<input value={emergencyLimit} onChange={(event) => setEmergencyLimit(event.target.value)} type="number" className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs" /></label>
        </div>
        <button disabled={busy || !name.trim()} onClick={() => void create()} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"><Save size={14} /> Save policy</button>
      </section>
      {policies.map((policy) => (
        <section key={policy.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3"><b>{policy.name}</b><Badge value={policy.active ? 'active' : 'inactive'} /></div>
          <div className="mt-4 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-5">
            <div><b>PM authority</b><br />${policy.propertyManagerDelegatedLimit?.toLocaleString() || 'Not set'}</div>
            <div><b>Landlord approval</b><br />${policy.landlordApprovalThreshold.toLocaleString()}+</div>
            <div><b>Second approval</b><br />${policy.secondApprovalThreshold?.toLocaleString() || 'Not set'}</div>
            <div><b>Emergency authority</b><br />${policy.emergencyAuthorisationLimit?.toLocaleString() || 'Not set'}</div>
            <div><b>Link expiry</b><br />{policy.approvalLinkExpiryHours} hours</div>
          </div>
        </section>
      ))}
      {!policies.length && <div className="rounded-2xl border border-dashed border-slate-300 p-12 text-center text-sm text-slate-500">No approval policies are configured. The server will use a conservative owner-approval default.</div>}
    </div>
  );
};

const ContractorsPanel: React.FC<{
  contacts: ExternalContact[];
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}> = ({ contacts, onChanged, onError }) => {
  const [name, setName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const contractors = useMemo(
    () => contacts.filter((contact) => contact.type === 'contractor'),
    [contacts],
  );
  const create = async () => {
    setBusy(true);
    try {
      await createExternalContact({
        name,
        businessName,
        email,
        phone,
        type: 'contractor',
        status: 'active',
        preferredSupplier: false,
        emergencyAvailable: false,
        tradeCategories: [],
        serviceAreas: [],
      });
      setName('');
      setBusinessName('');
      setEmail('');
      setPhone('');
      await onChanged();
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : 'Contractor could not be created.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2"><UsersRound size={18} /><h2 className="font-bold">Add Contractor</h2></div>
        <div className="mt-4 grid gap-3 lg:grid-cols-5">
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Contact name" className="rounded-xl border border-slate-200 px-3 py-2 text-xs" />
          <input value={businessName} onChange={(event) => setBusinessName(event.target.value)} placeholder="Business" className="rounded-xl border border-slate-200 px-3 py-2 text-xs" />
          <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" type="email" className="rounded-xl border border-slate-200 px-3 py-2 text-xs" />
          <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Phone" className="rounded-xl border border-slate-200 px-3 py-2 text-xs" />
          <button disabled={busy || !name.trim() || !email.trim()} onClick={() => void create()} className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">Add contractor</button>
        </div>
      </section>
      <div className="grid gap-3 lg:grid-cols-2">
        {contractors.map((contact) => (
          <section key={contact.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3"><div><b>{contact.businessName || contact.name}</b><div className="mt-1 text-xs text-slate-500">{contact.name}</div></div><Badge value={contact.status} /></div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-slate-500"><div>{contact.email}<br />{contact.phone || 'No phone'}</div><div>Preferred: {contact.preferredSupplier ? 'Yes' : 'No'}<br />Emergency: {contact.emergencyAvailable ? 'Yes' : 'No'}</div></div>
            <div className="mt-3 text-xs text-slate-500">Trades: {contact.tradeCategories?.join(', ') || 'Not configured'} · Areas: {contact.serviceAreas?.join(', ') || 'Not configured'}</div>
            {contact.xeroContactId && <div className="mt-2 text-[10px] text-slate-400">Xero contact {contact.xeroContactId}</div>}
          </section>
        ))}
      </div>
    </div>
  );
};

const XeroPanel: React.FC<{
  xero: XeroStatus | null;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}> = ({ xero, onChanged, onError }) => {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [tenantName, setTenantName] = useState('');
  const [salesAccountCode, setSalesAccountCode] = useState(xero?.connection?.salesAccountCode || '200');
  const [purchaseAccountCode, setPurchaseAccountCode] = useState(xero?.connection?.purchaseAccountCode || '300');
  const [taxType, setTaxType] = useState(xero?.connection?.defaultTaxType || 'OUTPUT');
  const [busy, setBusy] = useState(false);

  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await operation();
      await onChanged();
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : 'Xero operation failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col justify-between gap-4 lg:flex-row">
          <div>
            <div className="flex items-center gap-2"><Cloud size={18} /><h2 className="font-bold">Xero Connection</h2></div>
            <div className="mt-3 flex items-center gap-2"><Badge value={xero?.connection?.status || 'not_connected'} /><span className="text-xs text-slate-500">{xero?.connection?.tenantName || 'No organisation connected'}</span></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button disabled={busy} onClick={() => void run(async () => { const result = await beginXeroConnection(); window.location.assign(result.authorisationUrl); })} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"><KeyRound size={14} /> Connect with OAuth</button>
            {xero?.connection && <button disabled={busy} onClick={() => void run(() => disconnectXero())} className="rounded-xl border border-rose-200 px-4 py-2 text-xs font-semibold text-rose-700 disabled:opacity-50">Disconnect</button>}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="font-bold">Single-organisation Custom Connection</h2>
        <p className="mt-1 text-xs text-slate-500">Use this only where the ProInspect business owns one dedicated Xero organisation and has Xero Custom Connection credentials.</p>
        <div className="mt-4 grid gap-3 lg:grid-cols-4">
          <input value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder="Client ID" className="rounded-xl border border-slate-200 px-3 py-2 text-xs" />
          <input value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} placeholder="Client secret" type="password" className="rounded-xl border border-slate-200 px-3 py-2 text-xs" />
          <input value={tenantId} onChange={(event) => setTenantId(event.target.value)} placeholder="Tenant ID" className="rounded-xl border border-slate-200 px-3 py-2 text-xs" />
          <input value={tenantName} onChange={(event) => setTenantName(event.target.value)} placeholder="Organisation name" className="rounded-xl border border-slate-200 px-3 py-2 text-xs" />
        </div>
        <button disabled={busy || !clientId || !clientSecret || !tenantId} onClick={() => void run(() => connectXeroCustom({ clientId, clientSecret, tenantId, tenantName, salesAccountCode, purchaseAccountCode, defaultTaxType: taxType }))} className="mt-4 rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold disabled:opacity-40">Connect custom connection</button>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="font-bold">Accounting Defaults</h2>
        <div className="mt-4 grid gap-3 lg:grid-cols-4">
          <label className="text-[10px] font-bold uppercase text-slate-500">Sales account<input value={salesAccountCode} onChange={(event) => setSalesAccountCode(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs" /></label>
          <label className="text-[10px] font-bold uppercase text-slate-500">Purchase account<input value={purchaseAccountCode} onChange={(event) => setPurchaseAccountCode(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs" /></label>
          <label className="text-[10px] font-bold uppercase text-slate-500">Tax type<input value={taxType} onChange={(event) => setTaxType(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs" /></label>
          <button disabled={busy || !xero?.connection} onClick={() => void run(() => configureXero({ salesAccountCode, purchaseAccountCode, defaultTaxType: taxType }))} className="mt-4 inline-flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"><Save size={14} /> Save mappings</button>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="font-bold">Sync Exceptions</h2>
        <div className="mt-4 space-y-2">
          {xero?.exceptions.map((exception) => (
            <div key={exception.id} className="rounded-xl border border-slate-200 p-3 text-xs">
              <div className="flex items-center justify-between gap-3"><b>{exception.code}</b><Badge value={exception.status} /></div>
              <div className="mt-1 text-slate-500">{exception.message}</div>
              <div className="mt-1 text-[10px] text-slate-400">{exception.resourceType} · {exception.internalId} · attempts {exception.attemptCount}</div>
            </div>
          ))}
          {!xero?.exceptions.length && <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">No Xero sync exceptions.</div>}
        </div>
      </section>
    </div>
  );
};

export default MaintenanceConfigurationPage;
