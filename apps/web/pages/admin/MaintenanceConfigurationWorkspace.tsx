import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BookOpenCheck,
  CheckCircle2,
  FileSpreadsheet,
  PlugZap,
  RefreshCw,
  Save,
  ShieldCheck,
  Upload,
  UsersRound,
  XCircle,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ExternalContact, PriceBook, PriceBookImport, PriceBookVersion, QuoteApprovalPolicy } from '../../types/platform';
import {
  createQuoteApprovalPolicy,
  listPriceBookImports,
  listPriceBooks,
  listPriceBookVersions,
  listQuoteApprovalPolicies,
  publishPriceBookImport,
} from '../../services/platform/maintenanceCommercialService';
import {
  preparePriceBookSpreadsheet,
  uploadPriceBookSpreadsheet,
  type PreparedPriceBookSpreadsheet,
} from '../../services/platform/priceBookUploadService';
import { createExternalContact, listExternalContacts } from '../../services/platform/maintenanceService';

const TABS = [
  ['price-books', 'Price Books'],
  ['approval', 'Approval Policies'],
  ['contractors', 'Contractors'],
  ['integrations', 'PMS Integrations'],
] as const;
type Tab = (typeof TABS)[number][0];

function label(value?: string): string {
  return value ? value.replaceAll('_', ' ').replace(/\b\w/gu, (character) => character.toUpperCase()) : 'Not set';
}
function statusClass(value?: string): string {
  if (['published', 'active', 'connected', 'validated'].includes(value || '')) return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (['review_required', 'attention_required', 'pending'].includes(value || '')) return 'border-amber-200 bg-amber-50 text-amber-800';
  if (['failed', 'rejected', 'disconnected'].includes(value || '')) return 'border-rose-200 bg-rose-50 text-rose-700';
  return 'border-slate-200 bg-slate-50 text-slate-700';
}
const Badge: React.FC<{ value?: string }> = ({ value }) => (
  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${statusClass(value)}`}>{label(value)}</span>
);

const MaintenanceConfigurationWorkspace: React.FC = () => {
  const [tab, setTab] = useState<Tab>('price-books');
  const [imports, setImports] = useState<PriceBookImport[]>([]);
  const [books, setBooks] = useState<PriceBook[]>([]);
  const [versions, setVersions] = useState<PriceBookVersion[]>([]);
  const [policies, setPolicies] = useState<QuoteApprovalPolicy[]>([]);
  const [contacts, setContacts] = useState<ExternalContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextImports, nextBooks, nextVersions, nextPolicies, nextContacts] = await Promise.all([
        listPriceBookImports(), listPriceBooks(), listPriceBookVersions(), listQuoteApprovalPolicies(), listExternalContacts(),
      ]);
      setImports(nextImports);
      setBooks(nextBooks);
      setVersions(nextVersions);
      setPolicies(nextPolicies);
      setContacts(nextContacts);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Maintenance configuration could not be loaded.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  if (loading) return <div className="flex h-64 items-center justify-center text-sm text-slate-500"><RefreshCw size={16} className="mr-2 animate-spin" /> Loading maintenance configuration...</div>;

  return <div className="space-y-6 pb-16">
    <header className="flex flex-col justify-between gap-4 lg:flex-row">
      <div>
        <Link to="/app/admin/maintenance" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-900"><ArrowLeft size={13} /> Back to Maintenance</Link>
        <h1 className="mt-3 text-3xl font-black text-slate-950">Maintenance Configuration</h1>
        <p className="mt-1 text-sm text-slate-500">Publish pricing, configure delegated approvals, manage contractors and connect operational PMS data.</p>
      </div>
      <button onClick={() => void load()} className="inline-flex h-fit items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold"><RefreshCw size={14} /> Refresh</button>
    </header>
    {error && <div className="flex items-start justify-between rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"><span>{error}</span><button onClick={() => setError(null)}><XCircle size={16} /></button></div>}
    <nav className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">{TABS.map(([id, title]) => <button key={id} onClick={() => setTab(id)} className={`whitespace-nowrap rounded-lg px-4 py-2 text-xs font-semibold ${tab === id ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{title}</button>)}</nav>
    {tab === 'price-books' && <PriceBooksPanel imports={imports} books={books} versions={versions} busy={busy} onBusy={setBusy} onChanged={load} onError={(message) => setError(message)} />}
    {tab === 'approval' && <ApprovalPoliciesPanel policies={policies} onChanged={load} onError={(message) => setError(message)} />}
    {tab === 'contractors' && <ContractorsPanel contacts={contacts} onChanged={load} onError={(message) => setError(message)} />}
    {tab === 'integrations' && <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex items-center gap-2"><PlugZap size={18} /><h2 className="font-bold">Operational PMS integrations</h2></div><p className="mt-2 max-w-3xl text-sm text-slate-600">PMS connections import property, client, tenant and tenancy context and publish operational events. ProInspect does not execute payments, trust accounting, bank reconciliation, receipts or disbursements.</p><Link to="/app/admin/settings/integrations" className="mt-4 inline-flex rounded-xl bg-slate-950 px-4 py-2 text-xs font-semibold text-white">Manage PMS integrations</Link></section>}
  </div>;
};

const PriceBooksPanel: React.FC<{
  imports: PriceBookImport[]; books: PriceBook[]; versions: PriceBookVersion[]; busy: boolean;
  onBusy: (busy: boolean) => void; onChanged: () => Promise<void>; onError: (message: string) => void;
}> = ({ imports, books, versions, busy, onBusy, onChanged, onError }) => {
  const [prepared, setPrepared] = useState<PreparedPriceBookSpreadsheet | null>(null);
  const [name, setName] = useState('ProInspect Maintenance Price Book');
  const [currency, setCurrency] = useState('AUD');
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const chooseFile = async (file?: File) => {
    if (!file) return;
    onBusy(true);
    try { const value = await preparePriceBookSpreadsheet(file); setPrepared(value); setName(file.name.replace(/\.[^.]+$/u, '')); }
    catch (failure) { onError(failure instanceof Error ? failure.message : 'Spreadsheet could not be prepared.'); }
    finally { onBusy(false); }
  };
  const stage = async () => {
    if (!prepared) return;
    onBusy(true);
    try { await uploadPriceBookSpreadsheet(prepared, name.trim()); setPrepared(null); await onChanged(); }
    catch (failure) { onError(failure instanceof Error ? failure.message : 'Price-book upload failed.'); }
    finally { onBusy(false); }
  };
  const publish = async (record: PriceBookImport) => {
    onBusy(true);
    try { await publishPriceBookImport(record, { name: record.proposedPriceBookName || name, currency, effectiveFrom }); await onChanged(); }
    catch (failure) { onError(failure instanceof Error ? failure.message : 'Price book could not be published.'); }
    finally { onBusy(false); }
  };
  return <div className="space-y-6">
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex items-center gap-2"><FileSpreadsheet size={18} className="text-blue-600" /><h2 className="font-bold">Import Pricing Spreadsheet</h2></div><p className="mt-1 text-xs text-slate-500">The original XLSX, XLS or CSV is retained as an immutable SHA-256 verified source before rows enter staging.</p><div className="mt-5 grid gap-3 lg:grid-cols-[1fr_220px_120px_150px_auto]"><label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"><Upload size={15} /> {prepared ? prepared.fileName : 'Choose spreadsheet'}<input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(event) => void chooseFile(event.target.files?.[0])} /></label><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Price book name" className="rounded-xl border border-slate-200 px-3 py-2 text-xs" /><input value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} maxLength={3} className="rounded-xl border border-slate-200 px-3 py-2 text-xs" /><input type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs" /><button disabled={busy || !prepared} onClick={() => void stage()} className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">Upload & stage</button></div>{prepared && <div className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 text-xs sm:grid-cols-4"><div><b>Worksheet</b><br />{prepared.sheetName}</div><div><b>Rows</b><br />{prepared.rows.length}</div><div><b>File size</b><br />{Math.round(prepared.fileSize / 1024).toLocaleString()} KB</div><div><b>SHA-256</b><br /><span className="break-all font-mono text-[10px]">{prepared.sha256.slice(0, 24)}…</span></div></div>}</section>
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex items-center gap-2"><BookOpenCheck size={18} /><h2 className="font-bold">Staged Imports</h2></div><div className="mt-4 space-y-3">{[...imports].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).map((item) => <div key={item.id} className="rounded-xl border border-slate-200 p-4"><div className="flex flex-col justify-between gap-3 lg:flex-row"><div><div className="flex flex-wrap items-center gap-2"><b>{item.proposedPriceBookName || item.source.fileName}</b><Badge value={item.status} /></div><div className="mt-2 text-xs text-slate-500">Valid {item.validRowCount} · warnings {item.warningRowCount} · rejected {item.rejectedRowCount}</div></div>{['validated','review_required'].includes(item.status) && <button disabled={busy || item.rejectedRowCount > 0} onClick={() => void publish(item)} className="inline-flex h-fit items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"><CheckCircle2 size={14} /> Publish version</button>}</div></div>)}{!imports.length && <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">No pricing imports have been staged.</div>}</div></section>
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="font-bold">Published Price Books</h2><div className="mt-4 grid gap-3 lg:grid-cols-2">{books.map((book) => { const current = versions.find((version) => version.id === book.currentPublishedVersionId); return <div key={book.id} className="rounded-xl border border-slate-200 p-4"><div className="flex items-center justify-between gap-3"><b>{book.name}</b><Badge value={book.status} /></div><div className="mt-3 text-xs text-slate-500">{book.currency} · version {book.currentPublishedVersionNumber || 0} · {current?.entries.length || 0} entries</div></div>; })}</div></section>
  </div>;
};

const ApprovalPoliciesPanel: React.FC<{ policies: QuoteApprovalPolicy[]; onChanged: () => Promise<void>; onError: (message: string) => void }> = ({ policies, onChanged, onError }) => {
  const [name, setName] = useState('Standard Maintenance Approval');
  const [delegatedLimit, setDelegatedLimit] = useState('500');
  const [landlordThreshold, setLandlordThreshold] = useState('500');
  const [secondThreshold, setSecondThreshold] = useState('2500');
  const [emergencyLimit, setEmergencyLimit] = useState('1500');
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try { await createQuoteApprovalPolicy({ name, active: true, propertyUses: [], propertyManagerDelegatedLimit: Number(delegatedLimit) || undefined, landlordApprovalThreshold: Number(landlordThreshold) || 0, secondApprovalThreshold: Number(secondThreshold) || undefined, emergencyAuthorisationLimit: Number(emergencyLimit) || undefined, mandatoryReplacementApproval: true, mandatoryCapitalApproval: true, mandatoryCosmeticApproval: true, autoApprovePreauthorisedServices: false, approvalLinkExpiryHours: 168, reminderHours: [24,72,120] }); await onChanged(); }
    catch (failure) { onError(failure instanceof Error ? failure.message : 'Approval policy could not be created.'); }
    finally { setBusy(false); }
  };
  return <div className="space-y-5"><section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex items-center gap-2"><ShieldCheck size={18} /><h2 className="font-bold">Create Approval Policy</h2></div><div className="mt-4 grid gap-3 lg:grid-cols-5"><input value={name} onChange={(e) => setName(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs" /><input value={delegatedLimit} onChange={(e) => setDelegatedLimit(e.target.value)} type="number" placeholder="PM delegated limit" className="rounded-xl border border-slate-200 px-3 py-2 text-xs" /><input value={landlordThreshold} onChange={(e) => setLandlordThreshold(e.target.value)} type="number" placeholder="Owner threshold" className="rounded-xl border border-slate-200 px-3 py-2 text-xs" /><input value={secondThreshold} onChange={(e) => setSecondThreshold(e.target.value)} type="number" placeholder="Second approval" className="rounded-xl border border-slate-200 px-3 py-2 text-xs" /><input value={emergencyLimit} onChange={(e) => setEmergencyLimit(e.target.value)} type="number" placeholder="Emergency limit" className="rounded-xl border border-slate-200 px-3 py-2 text-xs" /></div><button disabled={busy || !name.trim()} onClick={() => void create()} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"><Save size={14} /> Save policy</button></section>{policies.map((policy) => <section key={policy.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between gap-3"><b>{policy.name}</b><Badge value={policy.active ? 'active' : 'inactive'} /></div><div className="mt-4 text-xs text-slate-500">PM authority ${policy.propertyManagerDelegatedLimit?.toLocaleString() || 'not set'} · owner approval ${policy.landlordApprovalThreshold.toLocaleString()}+ · emergency ${policy.emergencyAuthorisationLimit?.toLocaleString() || 'not set'}</div></section>)}</div>;
};

const ContractorsPanel: React.FC<{ contacts: ExternalContact[]; onChanged: () => Promise<void>; onError: (message: string) => void }> = ({ contacts, onChanged, onError }) => {
  const [name, setName] = useState(''); const [businessName, setBusinessName] = useState(''); const [email, setEmail] = useState(''); const [phone, setPhone] = useState(''); const [busy, setBusy] = useState(false);
  const contractors = useMemo(() => contacts.filter((contact) => contact.type === 'contractor'), [contacts]);
  const create = async () => { setBusy(true); try { await createExternalContact({ name, businessName, email, phone, type: 'contractor', status: 'active', preferredSupplier: false, emergencyAvailable: false, tradeCategories: [], serviceAreas: [] }); setName(''); setBusinessName(''); setEmail(''); setPhone(''); await onChanged(); } catch (failure) { onError(failure instanceof Error ? failure.message : 'Contractor could not be created.'); } finally { setBusy(false); } };
  return <div className="space-y-5"><section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex items-center gap-2"><UsersRound size={18} /><h2 className="font-bold">Add Contractor</h2></div><div className="mt-4 grid gap-3 lg:grid-cols-5"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Contact name" className="rounded-xl border border-slate-200 px-3 py-2 text-xs" /><input value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Business" className="rounded-xl border border-slate-200 px-3 py-2 text-xs" /><input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" className="rounded-xl border border-slate-200 px-3 py-2 text-xs" /><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" className="rounded-xl border border-slate-200 px-3 py-2 text-xs" /><button disabled={busy || !name.trim() || !email.trim()} onClick={() => void create()} className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">Add contractor</button></div></section><div className="grid gap-3 lg:grid-cols-2">{contractors.map((contact) => <section key={contact.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between gap-3"><div><b>{contact.businessName || contact.name}</b><div className="mt-1 text-xs text-slate-500">{contact.name}</div></div><Badge value={contact.status} /></div><div className="mt-4 text-xs text-slate-500">{contact.email}<br />{contact.phone || 'No phone'}<br />Trades: {contact.tradeCategories?.join(', ') || 'Not configured'}</div></section>)}</div></div>;
};

export default MaintenanceConfigurationWorkspace;
