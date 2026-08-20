import React, { useEffect, useMemo, useState } from 'react';
import {
  BadgeDollarSign,
  CalendarClock,
  FileSpreadsheet,
  FileText,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Wrench,
  XCircle,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import type {
  MaintenanceCandidate,
  MaintenanceEstimate,
  MaintenanceFinancialReconciliation,
  MaintenanceItem,
  MaintenanceQuote,
  MaintenanceQuoteVersion,
  MaintenanceVariation,
  MaintenanceWorkOrder,
  PreventiveMaintenanceSchedule,
  PriceBook,
  PropertyRecord,
  QuoteApprovalPolicy,
} from '../../types/platform';
import MaintenanceCandidatesPanel from '../../components/maintenance/MaintenanceCandidatesPanel';
import MaintenanceOperationsMetrics from '../../components/maintenance/MaintenanceOperationsMetrics';
import MaintenanceQuotesPanel from '../../components/maintenance/MaintenanceQuotesPanel';
import {
  createMaintenanceItem,
  listMaintenanceCandidates,
  listMaintenanceItems,
} from '../../services/platform/maintenanceService';
import {
  createMaintenanceQuote,
  createQuoteApprovalPolicy,
  generateMaintenanceEstimate,
  getMaintenanceOperationsOverview,
  getXeroStatus,
  listFinancialReconciliations,
  listMaintenanceEstimates,
  listMaintenanceQuoteVersions,
  listMaintenanceQuotes,
  listMaintenanceVariations,
  listMaintenanceWorkOrders,
  listPreventiveMaintenanceSchedules,
  listPriceBooks,
  listQuoteApprovalPolicies,
  runMaintenanceAutomation,
  savePreventiveMaintenanceSchedule,
  type MaintenanceOperationsOverview,
  type XeroStatus,
} from '../../services/platform/maintenanceCommercialService';
import { listProperties } from '../../services/platform/propertyService';

const TABS = [
  ['items', 'Maintenance Items'],
  ['candidates', 'Triage'],
  ['pricing', 'Estimates'],
  ['quotes', 'Quotes & Approval'],
  ['work', 'Work Orders'],
  ['preventive', 'Preventive'],
  ['financial', 'Financials'],
  ['sync', 'Sync & Exceptions'],
] as const;

type Tab = (typeof TABS)[number][0];

function label(value?: string): string {
  return value
    ? value.replaceAll('_', ' ').replace(/\b\w/gu, (character) => character.toUpperCase())
    : 'Not set';
}

function money(value?: number, currency = 'AUD'): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(value || 0);
}

function statusClass(value?: string): string {
  if (['accepted', 'approved', 'verified', 'closed', 'complete', 'synchronised'].includes(value || '')) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }
  if (['urgent', 'overdue', 'failed', 'declined', 'cancelled', 'attention_required'].includes(value || '')) {
    return 'border-rose-200 bg-rose-50 text-rose-700';
  }
  if (['high', 'review_required', 'pending', 'at_risk', 'awaiting_booking'].includes(value || '')) {
    return 'border-amber-200 bg-amber-50 text-amber-800';
  }
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

const Badge: React.FC<{ value?: string }> = ({ value }) => (
  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${statusClass(value)}`}>
    {label(value)}
  </span>
);

const MaintenanceOperationsPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('items');
  const [overview, setOverview] = useState<MaintenanceOperationsOverview | null>(null);
  const [items, setItems] = useState<MaintenanceItem[]>([]);
  const [candidates, setCandidates] = useState<MaintenanceCandidate[]>([]);
  const [estimates, setEstimates] = useState<MaintenanceEstimate[]>([]);
  const [quotes, setQuotes] = useState<MaintenanceQuote[]>([]);
  const [quoteVersions, setQuoteVersions] = useState<MaintenanceQuoteVersion[]>([]);
  const [workOrders, setWorkOrders] = useState<MaintenanceWorkOrder[]>([]);
  const [variations, setVariations] = useState<MaintenanceVariation[]>([]);
  const [financials, setFinancials] = useState<MaintenanceFinancialReconciliation[]>([]);
  const [preventive, setPreventive] = useState<PreventiveMaintenanceSchedule[]>([]);
  const [priceBooks, setPriceBooks] = useState<PriceBook[]>([]);
  const [approvalPolicies, setApprovalPolicies] = useState<QuoteApprovalPolicy[]>([]);
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [xero, setXero] = useState<XeroStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [
        nextOverview,
        nextItems,
        nextCandidates,
        nextEstimates,
        nextQuotes,
        nextQuoteVersions,
        nextWorkOrders,
        nextVariations,
        nextFinancials,
        nextPreventive,
        nextPriceBooks,
        nextPolicies,
        nextProperties,
        nextXero,
      ] = await Promise.all([
        getMaintenanceOperationsOverview(),
        listMaintenanceItems(),
        listMaintenanceCandidates(),
        listMaintenanceEstimates(),
        listMaintenanceQuotes(),
        listMaintenanceQuoteVersions(),
        listMaintenanceWorkOrders(),
        listMaintenanceVariations(),
        listFinancialReconciliations(),
        listPreventiveMaintenanceSchedules(),
        listPriceBooks(),
        listQuoteApprovalPolicies(),
        listProperties(),
        getXeroStatus().catch(() => ({ connection: null, scopes: [], exceptions: [] })),
      ]);
      setOverview(nextOverview);
      setItems(nextItems);
      setCandidates(nextCandidates);
      setEstimates(nextEstimates);
      setQuotes(nextQuotes);
      setQuoteVersions(nextQuoteVersions);
      setWorkOrders(nextWorkOrders);
      setVariations(nextVariations);
      setFinancials(nextFinancials);
      setPreventive(nextPreventive);
      setPriceBooks(nextPriceBooks);
      setApprovalPolicies(nextPolicies);
      setProperties(nextProperties);
      setXero(nextXero);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Maintenance operations could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const propertyMap = useMemo(
    () => new Map(properties.map((property) => [property.id, property])),
    [properties],
  );
  const estimateMap = useMemo(
    () => new Map(estimates.map((estimate) => [estimate.id, estimate])),
    [estimates],
  );
  const quoteMap = useMemo(() => new Map(quotes.map((quote) => [quote.id, quote])), [quotes]);

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter((item) => {
      const property = propertyMap.get(item.propertyId);
      const haystack = [
        item.title,
        item.description,
        item.category,
        item.issueType,
        property?.address,
        property?.suburb,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return (
        (!query || haystack.includes(query)) &&
        (statusFilter === 'all' || item.status === statusFilter) &&
        (priorityFilter === 'all' || item.priority === priorityFilter)
      );
    });
  }, [items, propertyMap, priorityFilter, search, statusFilter]);

  const runAutomation = async () => {
    setBusy(true);
    setError(null);
    try {
      await runMaintenanceAutomation();
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Maintenance automation failed.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-slate-500">
        <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Loading maintenance operations...
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-16">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="text-3xl font-black text-slate-950">Maintenance Operations</h1>
          <p className="mt-1 text-sm text-slate-500">
            Convert inspection evidence into priced work, client approvals, contractor execution and verified financial closeout.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            disabled={busy}
            onClick={() => void runAutomation()}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold disabled:opacity-50"
          >
            <RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> Run Automation
          </button>
          <Link
            to="/app/admin/maintenance/configuration"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold"
          >
            <Settings2 size={14} /> Pricing & Integrations
          </Link>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-xs font-semibold text-white"
          >
            <Plus size={14} /> New Item
          </button>
        </div>
      </header>

      {error && (
        <div className="flex items-start justify-between rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          <span>{error}</span>
          <button onClick={() => setError(null)}><XCircle size={16} /></button>
        </div>
      )}

      <MaintenanceOperationsMetrics overview={overview} />

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

      {tab === 'items' && (
        <ItemsPanel
          items={filteredItems}
          properties={propertyMap}
          search={search}
          statusFilter={statusFilter}
          priorityFilter={priorityFilter}
          onSearch={setSearch}
          onStatusFilter={setStatusFilter}
          onPriorityFilter={setPriorityFilter}
        />
      )}
      {tab === 'candidates' && (
        <MaintenanceCandidatesPanel candidates={candidates} onChanged={load} />
      )}
      {tab === 'pricing' && (
        <PricingPanel
          items={items}
          estimates={estimates}
          priceBooks={priceBooks}
          properties={propertyMap}
          onChanged={load}
          onError={setError}
        />
      )}
      {tab === 'quotes' && (
        <MaintenanceQuotesPanel
          quotes={quotes}
          quoteVersions={quoteVersions}
          items={items}
          onChanged={load}
        />
      )}
      {tab === 'work' && (
        <WorkPanel
          workOrders={workOrders}
          variations={variations}
          items={items}
          quotes={quoteMap}
        />
      )}
      {tab === 'preventive' && (
        <PreventivePanel
          schedules={preventive}
          properties={properties}
          onChanged={load}
          onError={setError}
        />
      )}
      {tab === 'financial' && (
        <FinancialPanel financials={financials} items={items} quotes={quoteMap} />
      )}
      {tab === 'sync' && (
        <SyncPanel
          xero={xero}
          priceBooks={priceBooks}
          policies={approvalPolicies}
        />
      )}

      {showCreate && (
        <CreateItemModal
          properties={properties}
          onClose={() => setShowCreate(false)}
          onCreated={async () => {
            setShowCreate(false);
            await load();
          }}
          onError={setError}
        />
      )}
    </div>
  );
};

const ItemsPanel: React.FC<{
  items: MaintenanceItem[];
  properties: Map<string, PropertyRecord>;
  search: string;
  statusFilter: string;
  priorityFilter: string;
  onSearch: (value: string) => void;
  onStatusFilter: (value: string) => void;
  onPriorityFilter: (value: string) => void;
}> = ({
  items,
  properties,
  search,
  statusFilter,
  priorityFilter,
  onSearch,
  onStatusFilter,
  onPriorityFilter,
}) => (
  <div className="space-y-4">
    <section className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 lg:flex-row lg:items-center">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
        <input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Search issue, property, category or component..."
          className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-xs"
        />
      </div>
      <select
        value={statusFilter}
        onChange={(event) => onStatusFilter(event.target.value)}
        className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
      >
        <option value="all">All statuses</option>
        <option value="triage_required">Triage required</option>
        <option value="approved">Approved</option>
        <option value="assigned">Assigned</option>
        <option value="in_progress">In progress</option>
        <option value="verification_required">Verification required</option>
        <option value="closed">Closed</option>
      </select>
      <select
        value={priorityFilter}
        onChange={(event) => onPriorityFilter(event.target.value)}
        className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
      >
        <option value="all">All priorities</option>
        <option value="urgent">Urgent</option>
        <option value="high">High</option>
        <option value="routine">Routine</option>
        <option value="monitor">Monitor</option>
      </select>
    </section>
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Issue</th>
              <th className="px-4 py-3">Property</th>
              <th className="px-4 py-3">Workflow</th>
              <th className="px-4 py-3">Pricing</th>
              <th className="px-4 py-3">SLA</th>
              <th className="px-4 py-3 text-right">Open</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((item) => (
              <tr key={item.id} className="align-top hover:bg-slate-50">
                <td className="px-4 py-4">
                  <div className="font-bold text-slate-950">{item.title}</div>
                  <div className="mt-1 text-slate-500">{item.category} · {label(item.issueType)}</div>
                  <div className="mt-2 flex gap-1"><Badge value={item.priority} /><Badge value={item.safetyClassification} /></div>
                </td>
                <td className="px-4 py-4">
                  <div className="font-semibold">{properties.get(item.propertyId)?.address || item.propertyId}</div>
                  <div className="mt-1 text-slate-500">{properties.get(item.propertyId)?.suburb || ''}</div>
                </td>
                <td className="px-4 py-4"><Badge value={item.status} /><div className="mt-2 text-slate-500">Approval: {label(item.approvalStatus)}</div></td>
                <td className="px-4 py-4"><Badge value={item.pricingStatus || 'not_started'} /><div className="mt-2 text-slate-500">{item.activeQuoteId ? 'Quote created' : item.estimateId ? 'Estimate created' : 'Not priced'}</div></td>
                <td className="px-4 py-4"><Badge value={item.slaStatus || 'on_track'} /><div className="mt-2 text-slate-500">{item.slaDueAt ? new Date(item.slaDueAt).toLocaleString() : 'No due date'}</div></td>
                <td className="px-4 py-4 text-right">
                  <Link to={`/app/admin/maintenance/${encodeURIComponent(item.id)}`} className="font-semibold text-blue-600">View</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!items.length && <div className="p-12 text-center text-sm text-slate-500">No maintenance items match the filters.</div>}
    </div>
  </div>
);

const PricingPanel: React.FC<{
  items: MaintenanceItem[];
  estimates: MaintenanceEstimate[];
  priceBooks: PriceBook[];
  properties: Map<string, PropertyRecord>;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}> = ({ items, estimates, priceBooks, properties, onChanged, onError }) => {
  const [busyId, setBusyId] = useState<string | null>(null);
  const estimateByItem = new Map(estimates.map((estimate) => [estimate.maintenanceItemId, estimate]));
  const pricingItems = items.filter((item) => !['closed', 'cancelled', 'dismissed', 'duplicate', 'not_actionable'].includes(item.status));
  const run = async (item: MaintenanceItem, action: () => Promise<unknown>) => {
    setBusyId(item.id);
    try {
      await action();
      await onChanged();
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : 'Pricing operation failed.');
    } finally {
      setBusyId(null);
    }
  };
  return (
    <div className="space-y-3">
      {!priceBooks.length && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          No published price book is available. Import and publish one under Pricing & Integrations before expecting automatic quotes to perform their little arithmetic miracle.
        </div>
      )}
      {pricingItems.map((item) => {
        const estimate = estimateByItem.get(item.id);
        const selected = estimate?.options.find((option) => option.id === estimate.selectedOptionId) || estimate?.options[0];
        return (
          <section key={item.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col justify-between gap-4 xl:flex-row">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <BadgeDollarSign size={18} className="text-blue-600" />
                  <h3 className="font-bold text-slate-950">{item.title}</h3>
                  <Badge value={item.pricingStatus || 'not_started'} />
                  <Badge value={estimate?.status} />
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {properties.get(item.propertyId)?.address || item.propertyId} · {item.category} · {label(item.issueType)}
                </div>
                {estimate ? (
                  <div className="mt-4 grid gap-3 md:grid-cols-4">
                    <div><div className="text-[10px] font-bold uppercase text-slate-400">Confidence</div><div className="mt-1 font-bold">{Math.round(estimate.confidence * 100)}%</div></div>
                    <div><div className="text-[10px] font-bold uppercase text-slate-400">Options</div><div className="mt-1 font-bold">{estimate.options.length}</div></div>
                    <div><div className="text-[10px] font-bold uppercase text-slate-400">Recommended total</div><div className="mt-1 text-lg font-black">{money(selected?.total, estimate.currency)}</div></div>
                    <div><div className="text-[10px] font-bold uppercase text-slate-400">Price book</div><div className="mt-1 font-bold">{estimate.priceBookVersionId || 'Manual review'}</div></div>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-slate-500">No estimate has been generated.</p>
                )}
                {estimate?.reviewReasons.length ? (
                  <div className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
                    {estimate.reviewReasons.join(' ')}
                  </div>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap items-start gap-2">
                <button
                  disabled={busyId === item.id}
                  onClick={() => void run(item, () => generateMaintenanceEstimate(item, { preferredPriceBookId: priceBooks[0]?.id }))}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold disabled:opacity-50"
                >
                  <RefreshCw size={13} /> {estimate ? 'Recalculate' : 'Generate estimate'}
                </button>
                {estimate && selected && (
                  <button
                    disabled={busyId === item.id}
                    onClick={() => void run(item, () => createMaintenanceQuote(item, estimate, selected.id))}
                    className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    <FileText size={13} /> Create quote
                  </button>
                )}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
};

const WorkPanel: React.FC<{
  workOrders: MaintenanceWorkOrder[];
  variations: MaintenanceVariation[];
  items: MaintenanceItem[];
  quotes: Map<string, MaintenanceQuote>;
}> = ({ workOrders, variations, items, quotes }) => {
  const itemMap = new Map(items.map((item) => [item.id, item]));
  return (
    <div className="space-y-4">
      {workOrders.map((order) => (
        <section key={order.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col justify-between gap-3 lg:flex-row">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Wrench size={17} className="text-blue-600" />
                <h3 className="font-bold">{order.workOrderNumber}</h3>
                <Badge value={order.status} />
              </div>
              <p className="mt-2 text-sm text-slate-600">{order.scope}</p>
              <div className="mt-3 text-xs text-slate-500">
                {itemMap.get(order.maintenanceItemId)?.title || order.maintenanceItemId} · Approved {money(order.approvedAmount, order.currency)}
              </div>
            </div>
            <div className="text-right text-xs text-slate-500">
              <div>{order.externalContactId ? `Contractor ${order.externalContactId}` : 'Contractor not assigned'}</div>
              <div className="mt-1">{order.xeroPurchaseOrderNumber ? `Xero PO ${order.xeroPurchaseOrderNumber}` : 'No Xero purchase order'}</div>
              <div className="mt-1">Quote {quotes.get(order.quoteId)?.quoteNumber || order.quoteId}</div>
            </div>
          </div>
          {variations.filter((variation) => variation.workOrderId === order.id).length > 0 && (
            <div className="mt-4 border-t border-slate-100 pt-4">
              <div className="text-[10px] font-bold uppercase text-slate-400">Variations</div>
              <div className="mt-2 space-y-2">
                {variations.filter((variation) => variation.workOrderId === order.id).map((variation) => (
                  <div key={variation.id} className="flex justify-between rounded-xl bg-slate-50 p-3 text-xs">
                    <div><b>{variation.scopeChange}</b><div className="mt-1 text-slate-500">{variation.reason}</div></div>
                    <div className="text-right"><Badge value={variation.status} /><div className="mt-1 font-bold">{money(variation.total, order.currency)}</div></div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      ))}
      {!workOrders.length && <div className="rounded-2xl border border-dashed border-slate-300 p-12 text-center text-sm text-slate-500">No work orders have been created.</div>}
    </div>
  );
};

const PreventivePanel: React.FC<{
  schedules: PreventiveMaintenanceSchedule[];
  properties: PropertyRecord[];
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}> = ({ schedules, properties, onChanged, onError }) => {
  const [propertyId, setPropertyId] = useState(properties[0]?.id || '');
  const [title, setTitle] = useState('Annual air-conditioning service');
  const [category, setCategory] = useState('Air Conditioning');
  const [nextDueAt, setNextDueAt] = useState(new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10));
  const create = async () => {
    try {
      await savePreventiveMaintenanceSchedule({
        agencyId: properties.find((property) => property.id === propertyId)?.agencyId,
        propertyId,
        title,
        category: category as PreventiveMaintenanceSchedule['category'],
        cadence: 'annual',
        nextDueAt: new Date(`${nextDueAt}T09:00:00`).toISOString(),
        paused: false,
      });
      await onChanged();
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : 'Preventive schedule could not be saved.');
    }
  };
  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-bold">Create preventive maintenance schedule</h2>
        <div className="mt-4 grid gap-3 lg:grid-cols-5">
          <select value={propertyId} onChange={(event) => setPropertyId(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs">
            {properties.map((property) => <option key={property.id} value={property.id}>{property.address}</option>)}
          </select>
          <input value={title} onChange={(event) => setTitle(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs" />
          <select value={category} onChange={(event) => setCategory(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs">
            <option>Air Conditioning</option><option>Safety</option><option>Roof / Gutters</option><option>Garden / Landscaping</option><option>Pest</option><option>General Maintenance</option>
          </select>
          <input type="date" value={nextDueAt} onChange={(event) => setNextDueAt(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs" />
          <button disabled={!propertyId || !title.trim()} onClick={() => void create()} className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">Create schedule</button>
        </div>
      </section>
      {schedules.map((schedule) => (
        <section key={schedule.id} className="flex flex-col justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5 md:flex-row">
          <div><div className="flex items-center gap-2 font-bold"><CalendarClock size={16} /> {schedule.title}</div><div className="mt-1 text-xs text-slate-500">{properties.find((property) => property.id === schedule.propertyId)?.address || schedule.propertyId} · {label(schedule.cadence)} · next due {new Date(schedule.nextDueAt).toLocaleDateString()}</div></div>
          <Badge value={schedule.paused ? 'paused' : 'active'} />
        </section>
      ))}
      {!schedules.length && <div className="rounded-2xl border border-dashed border-slate-300 p-12 text-center text-sm text-slate-500">No preventive schedules have been configured.</div>}
    </div>
  );
};

const FinancialPanel: React.FC<{
  financials: MaintenanceFinancialReconciliation[];
  items: MaintenanceItem[];
  quotes: Map<string, MaintenanceQuote>;
}> = ({ financials, items, quotes }) => {
  const itemMap = new Map(items.map((item) => [item.id, item]));
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr><th className="px-4 py-3">Maintenance</th><th className="px-4 py-3">Approved quote</th><th className="px-4 py-3">Variations</th><th className="px-4 py-3">Actual cost</th><th className="px-4 py-3">Invoice</th><th className="px-4 py-3">Margin</th><th className="px-4 py-3">Status</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {financials.map((entry) => (
              <tr key={entry.id}>
                <td className="px-4 py-4"><b>{itemMap.get(entry.maintenanceItemId)?.title || entry.maintenanceItemId}</b><div className="mt-1 text-slate-500">{quotes.get(entry.quoteId)?.quoteNumber || entry.quoteId}</div></td>
                <td className="px-4 py-4">{money(entry.approvedQuoteTotal)}</td>
                <td className="px-4 py-4">{money(entry.variationTotal)}</td>
                <td className="px-4 py-4">{entry.actualContractorCost === undefined ? 'Pending' : money(entry.actualContractorCost)}</td>
                <td className="px-4 py-4">{entry.clientInvoiceTotal === undefined ? 'Pending' : money(entry.clientInvoiceTotal)}</td>
                <td className="px-4 py-4">{entry.grossMarginAmount === undefined ? 'Pending' : `${money(entry.grossMarginAmount)} (${(entry.grossMarginPercent || 0).toFixed(1)}%)`}</td>
                <td className="px-4 py-4"><Badge value={entry.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!financials.length && <div className="p-12 text-center text-sm text-slate-500">No financial reconciliations are available yet.</div>}
    </div>
  );
};

const SyncPanel: React.FC<{
  xero: XeroStatus | null;
  priceBooks: PriceBook[];
  policies: QuoteApprovalPolicy[];
}> = ({ xero, priceBooks, policies }) => (
  <div className="grid gap-5 xl:grid-cols-3">
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-center gap-2"><FileSpreadsheet size={17} /><h2 className="font-bold">Price Books</h2></div>
      <div className="mt-4 text-3xl font-black">{priceBooks.length}</div>
      <p className="mt-1 text-xs text-slate-500">Published or configured price books available to the estimate engine.</p>
      <Link to="/app/admin/maintenance/configuration" className="mt-4 inline-flex text-xs font-semibold text-blue-600">Manage price books</Link>
    </section>
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-center gap-2"><ShieldCheck size={17} /><h2 className="font-bold">Approval Policies</h2></div>
      <div className="mt-4 text-3xl font-black">{policies.filter((policy) => policy.active).length}</div>
      <p className="mt-1 text-xs text-slate-500">Active delegated-authority and landlord approval policies.</p>
      <Link to="/app/admin/maintenance/configuration" className="mt-4 inline-flex text-xs font-semibold text-blue-600">Manage policies</Link>
    </section>
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-center gap-2"><FileText size={17} /><h2 className="font-bold">Xero</h2></div>
      <div className="mt-4"><Badge value={xero?.connection?.status || 'not_connected'} /></div>
      <p className="mt-3 text-xs text-slate-500">{xero?.connection?.tenantName || 'No Xero organisation connected.'}</p>
      <p className="mt-2 text-xs text-slate-500">Open exceptions: {xero?.exceptions.filter((entry) => entry.status === 'open').length || 0}</p>
      <Link to="/app/admin/maintenance/configuration" className="mt-4 inline-flex text-xs font-semibold text-blue-600">Configure Xero</Link>
    </section>
  </div>
);

const CreateItemModal: React.FC<{
  properties: PropertyRecord[];
  onClose: () => void;
  onCreated: () => Promise<void>;
  onError: (message: string) => void;
}> = ({ properties, onClose, onCreated, onError }) => {
  const [propertyId, setPropertyId] = useState(properties[0]?.id || '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('General Maintenance');
  const [priority, setPriority] = useState('routine');
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await createMaintenanceItem({
        propertyId,
        title,
        description,
        category: category as MaintenanceItem['category'],
        priority: priority as MaintenanceItem['priority'],
        approvalRequired: true,
      });
      await onCreated();
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : 'Maintenance item could not be created.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-bold">New Maintenance Item</h2>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <select required value={propertyId} onChange={(event) => setPropertyId(event.target.value)} className="w-full rounded-xl border border-slate-200 p-2 text-sm">
            {properties.map((property) => <option key={property.id} value={property.id}>{property.address}</option>)}
          </select>
          <input required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Issue title" className="w-full rounded-xl border border-slate-200 p-2 text-sm" />
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Observed issue" rows={3} className="w-full rounded-xl border border-slate-200 p-2 text-sm" />
          <div className="grid grid-cols-2 gap-3">
            <select value={category} onChange={(event) => setCategory(event.target.value)} className="rounded-xl border border-slate-200 p-2 text-sm"><option>General Maintenance</option><option>Plumbing</option><option>Electrical</option><option>Appliance</option><option>Cleaning</option><option>Safety</option></select>
            <select value={priority} onChange={(event) => setPriority(event.target.value)} className="rounded-xl border border-slate-200 p-2 text-sm"><option value="routine">Routine</option><option value="high">High</option><option value="urgent">Urgent</option><option value="monitor">Monitor</option></select>
          </div>
          <div className="flex justify-end gap-2 pt-2"><button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-sm">Cancel</button><button disabled={busy} type="submit" className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Create & Triage</button></div>
        </form>
      </div>
    </div>
  );
};

export default MaintenanceOperationsPage;
