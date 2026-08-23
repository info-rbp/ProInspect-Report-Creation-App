import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiRequest } from '../../services/apiClient';

interface PortalOverview {
  client: { id: string; legalName?: string; tradingName?: string; status?: string };
  properties: Array<Record<string, unknown>>;
  inspections: Array<Record<string, unknown>>;
  reports: Array<Record<string, unknown>>;
  maintenance: Array<Record<string, unknown>>;
  quotes: Array<Record<string, unknown>>;
  documents: Array<Record<string, unknown>>;
  compliance: Array<Record<string, unknown>>;
}

function agencyId(): string | undefined { if (typeof window === 'undefined') return 'agency-1'; return window.localStorage.getItem('pcr_agency_id') || window.localStorage.getItem('agencyId') || 'agency-1'; }

const ClientPortalPage: React.FC = () => {
  const { clientAccountId = '' } = useParams(); const [data, setData] = useState<PortalOverview>(); const [error, setError] = useState('');
  useEffect(() => { if (!clientAccountId) return; void apiRequest<PortalOverview>(agencyId(), `/api/v1/client-portal/${encodeURIComponent(clientAccountId)}/overview`).then(setData).catch((e) => setError(e instanceof Error ? e.message : String(e))); }, [clientAccountId]);
  if (error) return <main className="min-h-screen bg-gray-50 p-6"><div className="mx-auto max-w-4xl rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">{error}</div></main>;
  if (!data) return <main className="min-h-screen grid place-items-center text-sm text-gray-500">Loading client portal...</main>;
  const title = String(data.client.tradingName || data.client.legalName || 'Client portal');
  const card = (label: string, value: number) => <div className="rounded-xl border bg-white p-4"><div className="text-xs uppercase tracking-wide text-gray-500">{label}</div><div className="mt-1 text-2xl font-bold">{value}</div></div>;
  return <main className="min-h-screen bg-gray-50"><header className="border-b bg-white"><div className="mx-auto max-w-6xl px-5 py-5"><div className="text-xs font-semibold uppercase tracking-wider text-gray-500">ProInspect client portal</div><h1 className="text-2xl font-bold">{title}</h1><p className="mt-1 text-sm text-gray-600">Inspections, reports, maintenance, documents and compliance. Financial ledgers and money movement remain in your property-management/accounting system.</p></div></header><div className="mx-auto max-w-6xl space-y-6 p-5"><div className="grid gap-3 sm:grid-cols-4">{card('Properties', data.properties.length)}{card('Inspections', data.inspections.length)}{card('Open maintenance', data.maintenance.filter((item) => !['closed','cancelled','verified'].includes(String(item.status))).length)}{card('Compliance items', data.compliance.filter((item) => item.status === 'open').length)}</div><section className="grid gap-4 lg:grid-cols-2"><div className="rounded-xl border bg-white p-4"><h2 className="font-semibold">Properties</h2><div className="mt-3 space-y-2">{data.properties.map((item) => <div key={String(item.id)} className="rounded bg-gray-50 p-3 text-sm"><div className="font-medium">{String(item.address || item.name || item.id)}</div><div className="text-gray-500">{[item.suburb,item.state,item.postcode].filter(Boolean).map(String).join(' ')}</div></div>)}</div></div><div className="rounded-xl border bg-white p-4"><h2 className="font-semibold">Recent reports</h2><div className="mt-3 space-y-2">{data.reports.slice(0,8).map((item) => <div key={String(item.id)} className="rounded bg-gray-50 p-3 text-sm"><div className="font-medium">{String(item.reportType || item.type || 'Inspection report')}</div><div className="text-gray-500">{String(item.status || '')}</div></div>)}</div></div><div className="rounded-xl border bg-white p-4"><h2 className="font-semibold">Maintenance & quotes</h2><div className="mt-3 space-y-2">{data.maintenance.slice(0,8).map((item) => <div key={String(item.id)} className="rounded bg-gray-50 p-3 text-sm"><div className="font-medium">{String(item.title || item.summary || item.category || 'Maintenance item')}</div><div className="text-gray-500">{String(item.status || '')}</div></div>)}</div></div><div className="rounded-xl border bg-white p-4"><h2 className="font-semibold">Documents & compliance</h2><div className="mt-3 text-sm text-gray-600">{data.documents.length} document(s) available · {data.compliance.length} compliance obligation(s)</div></div></section></div></main>;
};
export default ClientPortalPage;
