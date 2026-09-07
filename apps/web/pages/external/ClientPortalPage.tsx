import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Check, Clock3, MessageSquare, Plus, RefreshCw, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
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
interface ServiceDefinition { id: string; code?: string; name?: string; category?: string; workflowType?: string; description?: string; }
interface PortalRecord { id: string; [key: string]: unknown; }
function agencyId(): string | undefined { if (typeof window === 'undefined') return undefined; return window.localStorage.getItem('pcr_agency_id') || window.localStorage.getItem('agencyId') || undefined; }
function label(item: Record<string, unknown>): string { return String(item.streetAddress || item.address || item.name || item.title || item.id || 'Record'); }
function inputClass(): string { return 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100'; }
function activeEntitlement(value: { status: string; validFrom?: string; validUntil?: string }): boolean {
  if (value.status !== 'active') return false;
  const now = Date.now();
  if (value.validFrom && Date.parse(value.validFrom) > now) return false;
  if (value.validUntil && Date.parse(value.validUntil) <= now) return false;
  return true;
}

const ClientPortalPage: React.FC = () => {
  const { clientAccountId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const { userProfile, portalEntitlements } = useAuth();
  const [data, setData] = useState<PortalOverview>();
  const [services, setServices] = useState<ServiceDefinition[]>([]);
  const [serviceRequests, setServiceRequests] = useState<PortalRecord[]>([]);
  const [bookings, setBookings] = useState<PortalRecord[]>([]);
  const [conversations, setConversations] = useState<PortalRecord[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const requestedAction = searchParams.get('action');
  const baseRole = userProfile?.role as string | undefined;
  const canApproveQuotes = ['super_admin', 'proinspect_admin', 'operations', 'client_admin'].includes(baseRole ?? '') || portalEntitlements.some((entitlement) => (
    entitlement.portalId === 'client'
    && entitlement.clientAccountId === clientAccountId
    && entitlement.sourceRole === 'client_admin'
    && activeEntitlement(entitlement)
  ));
  const api = useCallback(<T,>(path: string, options?: { method?: 'GET' | 'POST'; body?: unknown }) => apiRequest<T>(agencyId(), `/api/v1/client-portal/${encodeURIComponent(clientAccountId)}${path}`, options), [clientAccountId]);
  const load = useCallback(async () => {
    if (!clientAccountId) return;
    setError('');
    try {
      const [overview, definitions, requests, appointmentRows, conversationRows] = await Promise.all([
        api<PortalOverview>('/overview'), api<ServiceDefinition[]>('/service-definitions'), api<PortalRecord[]>('/service-requests'), api<PortalRecord[]>('/bookings'), api<PortalRecord[]>('/conversations'),
      ]);
      setData(overview); setServices(definitions); setServiceRequests(requests); setBookings(appointmentRows); setConversations(conversationRows);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [api, clientAccountId]);
  useEffect(() => { void load(); }, [load]);
  const propertyOptions = useMemo(() => data?.properties ?? [], [data]);
  const perform = async (operation: () => Promise<unknown>, success: string) => { setSaving(true); setError(''); setNotice(''); try { await operation(); setNotice(success); await load(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setSaving(false); } };

  const requestService = (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); const body = { serviceDefinitionId: String(form.get('serviceDefinitionId') || ''), propertyId: String(form.get('propertyId') || ''), priority: String(form.get('priority') || 'normal'), notes: String(form.get('notes') || ''), accessInstructions: String(form.get('accessInstructions') || '') }; void perform(() => api('/service-requests', { method: 'POST', body }), 'Service request submitted.'); };
  const requestBooking = (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); const start = String(form.get('startAt') || ''); const end = String(form.get('endAt') || ''); const body = { propertyId: String(form.get('propertyId') || ''), serviceRequestId: String(form.get('serviceRequestId') || '') || undefined, startAt: start ? new Date(start).toISOString() : '', endAt: end ? new Date(end).toISOString() : '', accessInstructions: String(form.get('accessInstructions') || '') }; void perform(() => api('/bookings', { method: 'POST', body }), 'Appointment request submitted.'); };
  const startConversation = (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); const message = String(form.get('message') || '').trim(); const body = { subject: String(form.get('subject') || ''), propertyId: String(form.get('propertyId') || '') || undefined, linkedEntityType: String(form.get('linkedEntityType') || 'client'), linkedEntityId: String(form.get('linkedEntityId') || clientAccountId) }; void perform(async () => { const conversation = await api<PortalRecord>('/conversations', { method: 'POST', body }); if (message) await api(`/conversations/${encodeURIComponent(conversation.id)}/messages`, { method: 'POST', body: { body: message } }); }, 'Conversation started.'); };
  const decideQuote = (quoteId: string, decision: 'approved' | 'declined' | 'more_information') => { const reason = decision === 'approved' ? undefined : window.prompt(decision === 'declined' ? 'Reason for declining:' : 'What information is required?') ?? undefined; if (decision !== 'approved' && !reason?.trim()) return; void perform(() => api(`/quotes/${encodeURIComponent(quoteId)}/decision`, { method: 'POST', body: { decision, ...(reason ? { reason } : {}) } }), `Quote ${decision.replace('_', ' ')}.`); };

  if (error && !data) return <main className="min-h-screen bg-gray-50 p-6"><div className="mx-auto max-w-4xl rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">{error}</div></main>;
  if (!data) return <main className="min-h-screen grid place-items-center text-sm text-gray-500">Loading client portal...</main>;
  const title = String(data.client.tradingName || data.client.legalName || 'Client portal');
  const card = (name: string, value: number) => <div className="rounded-xl border bg-white p-4"><div className="text-xs uppercase tracking-wide text-gray-500">{name}</div><div className="mt-1 text-2xl font-bold">{value}</div></div>;
  const panelClass = 'rounded-xl border bg-white p-4';
  return <main className="min-h-screen bg-gray-50"><header className="border-b bg-white"><div className="mx-auto max-w-6xl px-5 py-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-xs font-semibold uppercase tracking-wider text-gray-500">ProInspect client portal</div><h1 className="text-2xl font-bold">{title}</h1><p className="mt-1 text-sm text-gray-600">Request services, manage appointments and approvals, communicate with ProInspect, and access your authorised portfolio. Financial ledgers and money movement remain in your property-management/accounting system.</p></div><Link to="/client" className="rounded-lg border px-3 py-2 text-sm font-semibold text-gray-700">Switch workspace</Link></div></div></header>
    <div className="mx-auto max-w-6xl space-y-6 p-5">
      {(error || notice) && <div className={`rounded-lg border p-3 text-sm ${error ? 'border-red-200 bg-red-50 text-red-800' : 'border-green-200 bg-green-50 text-green-800'}`}>{error || notice}</div>}
      <div className="flex justify-end"><button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm font-semibold"><RefreshCw size={14} /> Refresh</button></div>
      <div className="grid gap-3 sm:grid-cols-5">{card('Properties', data.properties.length)}{card('Inspections', data.inspections.length)}{card('Open maintenance', data.maintenance.filter((item) => !['closed','cancelled','verified'].includes(String(item.status))).length)}{card('Service requests', serviceRequests.length)}{card('Appointments', bookings.length)}</div>
      <section className="grid gap-4 lg:grid-cols-3">
        <form onSubmit={requestService} className={`${panelClass} ${requestedAction === 'service-requests' ? 'ring-2 ring-indigo-400' : ''}`}><div className="flex items-center gap-2"><Plus size={18} /><h2 className="font-semibold">Request a service</h2></div><div className="mt-3 grid gap-3"><select name="serviceDefinitionId" required className={inputClass()} defaultValue=""><option value="" disabled>Select service</option>{services.map((service) => <option key={service.id} value={service.id}>{service.name || service.code || service.id}</option>)}</select><select name="propertyId" required className={inputClass()} defaultValue=""><option value="" disabled>Select property</option>{propertyOptions.map((item) => <option key={String(item.id)} value={String(item.id)}>{label(item)}</option>)}</select><select name="priority" className={inputClass()} defaultValue="normal"><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select><textarea name="notes" rows={3} placeholder="What do you need?" className={inputClass()} /><textarea name="accessInstructions" rows={2} placeholder="Access instructions" className={inputClass()} /><button disabled={saving} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white">Submit request</button></div></form>
        <form onSubmit={requestBooking} className={`${panelClass} ${requestedAction === 'bookings' ? 'ring-2 ring-indigo-400' : ''}`}><div className="flex items-center gap-2"><Clock3 size={18} /><h2 className="font-semibold">Request / reschedule</h2></div><div className="mt-3 grid gap-3"><select name="propertyId" required className={inputClass()} defaultValue=""><option value="" disabled>Select property</option>{propertyOptions.map((item) => <option key={String(item.id)} value={String(item.id)}>{label(item)}</option>)}</select><select name="serviceRequestId" className={inputClass()} defaultValue=""><option value="">No linked service request</option>{serviceRequests.map((item) => <option key={item.id} value={item.id}>{String(item.notes || item.sourceReference || item.id)}</option>)}</select><label className="text-xs font-semibold text-gray-600">Preferred start<input name="startAt" type="datetime-local" required className={`${inputClass()} mt-1`} /></label><label className="text-xs font-semibold text-gray-600">Preferred end<input name="endAt" type="datetime-local" required className={`${inputClass()} mt-1`} /></label><textarea name="accessInstructions" rows={2} placeholder="Access or scheduling notes" className={inputClass()} /><button disabled={saving} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white">Request appointment</button></div></form>
        <form onSubmit={startConversation} className={`${panelClass} ${requestedAction === 'messages' ? 'ring-2 ring-indigo-400' : ''}`}><div className="flex items-center gap-2"><MessageSquare size={18} /><h2 className="font-semibold">Message ProInspect</h2></div><div className="mt-3 grid gap-3"><input name="subject" required placeholder="Subject" className={inputClass()} /><select name="propertyId" className={inputClass()} defaultValue=""><option value="">General client query</option>{propertyOptions.map((item) => <option key={String(item.id)} value={String(item.id)}>{label(item)}</option>)}</select><input type="hidden" name="linkedEntityType" value="client" /><input type="hidden" name="linkedEntityId" value={clientAccountId} /><textarea name="message" required rows={5} placeholder="Write your message" className={inputClass()} /><button disabled={saving} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white">Start conversation</button></div></form>
      </section>
      <section className="grid gap-4 lg:grid-cols-2"><div className={panelClass}><h2 className="font-semibold">Properties</h2><div className="mt-3 space-y-2">{data.properties.map((item) => <div key={String(item.id)} className="rounded bg-gray-50 p-3 text-sm"><div className="font-medium">{label(item)}</div><div className="text-gray-500">{[item.suburb,item.state,item.postcode].filter(Boolean).map(String).join(' ')}</div></div>)}</div></div><div className={panelClass}><h2 className="font-semibold">Recent reports</h2><div className="mt-3 space-y-2">{data.reports.slice(0,8).map((item) => <div key={String(item.id)} className="rounded bg-gray-50 p-3 text-sm"><div className="font-medium">{String(item.reportType || item.type || 'Inspection report')}</div><div className="text-gray-500">{String(item.lifecycleStatus || item.status || '')}</div></div>)}</div></div></section>
      <section className={`${panelClass} ${requestedAction === 'quotes-approvals' ? 'ring-2 ring-indigo-400' : ''}`}><h2 className="font-semibold">Maintenance & quote approvals</h2><div className="mt-3 grid gap-3 md:grid-cols-2">{data.maintenance.slice(0,8).map((item) => <div key={String(item.id)} className="rounded bg-gray-50 p-3 text-sm"><div className="font-medium">{String(item.title || item.summary || item.category || 'Maintenance item')}</div><div className="text-gray-500">{String(item.status || '')}</div></div>)}{data.quotes.map((quote) => <div key={String(quote.id)} className="rounded border p-3 text-sm"><div className="font-medium">{String(quote.title || `Quote ${quote.id}`)}</div><div className="mt-1 text-gray-500">{String(quote.approvalStatus || quote.status || '')} {quote.totalIncludingTax ? `· ${quote.totalIncludingTax}` : ''}</div>{canApproveQuotes && <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => decideQuote(String(quote.id), 'approved')} className="inline-flex items-center gap-1 rounded border border-green-300 bg-green-50 px-2 py-1 text-green-800"><Check size={13} /> Approve</button><button type="button" onClick={() => decideQuote(String(quote.id), 'more_information')} className="rounded border px-2 py-1">More information</button><button type="button" onClick={() => decideQuote(String(quote.id), 'declined')} className="inline-flex items-center gap-1 rounded border border-red-300 bg-red-50 px-2 py-1 text-red-800"><X size={13} /> Decline</button></div>}</div>)}</div></section>
      <section className="grid gap-4 lg:grid-cols-2"><div className={panelClass}><h2 className="font-semibold">Appointments & requests</h2><div className="mt-3 space-y-2">{bookings.slice(0,8).map((item) => <div key={item.id} className="rounded bg-gray-50 p-3 text-sm"><div className="font-medium">{String(item.bookingState || item.status || 'Appointment')}</div><div className="text-gray-500">{String(item.startAt || '')}</div></div>)}{serviceRequests.slice(0,8).map((item) => <div key={item.id} className="rounded bg-gray-50 p-3 text-sm"><div className="font-medium">{String(item.notes || item.sourceReference || 'Service request')}</div><div className="text-gray-500">{String(item.status || item.schedulingStatus || '')}</div></div>)}</div></div><div className={panelClass}><h2 className="font-semibold">Conversations</h2><div className="mt-3 space-y-2">{conversations.slice(0,8).map((item) => <div key={item.id} className="rounded bg-gray-50 p-3 text-sm"><div className="font-medium">{String(item.subject || 'Conversation')}</div><div className="text-gray-500">{String(item.conversationState || item.status || '')}</div></div>)}</div></div></section>
      <section className={panelClass}><h2 className="font-semibold">Documents & compliance</h2><div className="mt-3 text-sm text-gray-600">{data.documents.length} document(s) available · {data.compliance.length} compliance obligation(s)</div></section>
    </div>
  </main>;
};
export default ClientPortalPage;
