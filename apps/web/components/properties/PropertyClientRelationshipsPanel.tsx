import React, { useEffect, useMemo, useState } from 'react';
import { Building2, RefreshCw, UserPlus } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ClientAccount, ClientContact, PropertyClientRelationship, PropertyClientRelationshipType } from '../../types/platform';
import {
  createPropertyClientRelationship,
  endPropertyClientRelationship,
  getPropertyClientContext,
  listClientAccounts,
  listClientContacts,
  migrateLegacyPropertyClient,
  syncPropertyClientContext,
} from '../../services/platform/clientManagementService';
import { getProperty } from '../../services/platform/propertyService';

function label(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/gu, (character) => character.toUpperCase());
}

const PropertyClientRelationshipsPanel: React.FC<{ propertyId: string }> = ({ propertyId }) => {
  const [clients, setClients] = useState<ClientAccount[]>([]);
  const [contacts, setContacts] = useState<ClientContact[]>([]);
  const [relationships, setRelationships] = useState<PropertyClientRelationship[]>([]);
  const [legacyAvailable, setLegacyAvailable] = useState(false);
  const [clientId, setClientId] = useState('');
  const [contactId, setContactId] = useState('');
  const [relationshipType, setRelationshipType] = useState<PropertyClientRelationshipType>('managing_agent');
  const [approvalLimit, setApprovalLimit] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const reload = async () => {
    setError('');
    try {
      const [context, nextClients, nextContacts, property] = await Promise.all([
        getPropertyClientContext(propertyId),
        listClientAccounts(),
        listClientContacts(),
        getProperty(propertyId),
      ]);
      setRelationships(context.relationships);
      setClients(nextClients.filter((client) => !['archived', 'inactive'].includes(client.status)));
      setContacts(nextContacts.filter((contact) => contact.status === 'active'));
      setLegacyAvailable(Boolean(property?.landlordDetails?.name && !context.relationships.length));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Client relationships could not be loaded.');
    }
  };
  useEffect(() => { void reload(); }, [propertyId]);

  const selectedContacts = useMemo(() => contacts.filter((contact) => contact.clientAccountId === clientId), [clientId, contacts]);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await action(); await reload(); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Client relationship operation failed.'); } finally { setBusy(false); }
  };

  return <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
    <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start"><div><div className="flex items-center gap-2"><Building2 size={18} className="text-blue-600"/><h2 className="font-black text-slate-950">Clients, Owners & Managing Agents</h2></div><p className="mt-2 text-xs text-slate-500">Authoritative Property relationships drive inspection context, report recipients, maintenance approval routing and billing identity.</p></div><button disabled={busy} onClick={() => void run(() => syncPropertyClientContext(propertyId))} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold disabled:opacity-40"><RefreshCw size={13}/> Synchronise context</button></div>
    {error && <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</div>}
    {legacyAvailable && <div className="mt-4 flex flex-col justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center"><div><div className="text-sm font-bold text-amber-900">Legacy landlord details detected</div><div className="text-xs text-amber-700">Create a reviewed canonical Client Account and Owner relationship from the existing Property record.</div></div><button disabled={busy} onClick={() => void run(() => migrateLegacyPropertyClient(propertyId))} className="rounded-lg bg-amber-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">Migrate landlord</button></div>}
    <div className="mt-5 grid gap-3 lg:grid-cols-2">{relationships.map((relationship) => { const client = clients.find((candidate) => candidate.id === relationship.clientAccountId); const contact = contacts.find((candidate) => candidate.id === relationship.primaryContactId); return <div key={relationship.id} className="rounded-xl border border-slate-200 p-4"><div className="flex items-start justify-between gap-3"><div><Link to={`/app/admin/clients/${encodeURIComponent(relationship.clientAccountId)}`} className="font-bold text-blue-700">{client?.tradingName || client?.legalName || client?.name || relationship.clientAccountId}</Link><div className="mt-1 text-xs font-semibold text-slate-500">{label(relationship.relationshipType)}</div>{contact && <div className="mt-1 text-xs text-slate-400">{contact.displayName}{contact.email ? ` · ${contact.email}` : ''}</div>}{relationship.propertyManagerApprovalLimit !== undefined && <div className="mt-2 text-xs text-slate-600">Property authority: ${relationship.propertyManagerApprovalLimit.toFixed(2)}</div>}</div><button disabled={busy} onClick={() => void run(() => endPropertyClientRelationship(relationship))} className="rounded-lg border border-rose-200 px-2 py-1 text-[10px] font-semibold text-rose-700 disabled:opacity-40">End relationship</button></div></div>; })}{!relationships.length && !legacyAvailable && <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400 lg:col-span-2">No current Client relationship is linked to this Property.</div>}</div>
    <div className="mt-5 grid gap-3 rounded-xl bg-slate-50 p-4 md:grid-cols-2 xl:grid-cols-5"><select value={clientId} onChange={(event) => { setClientId(event.target.value); setContactId(''); }} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"><option value="">Select Client Account</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.tradingName || client.legalName || client.name}</option>)}</select><select value={relationshipType} onChange={(event) => setRelationshipType(event.target.value as PropertyClientRelationshipType)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">{['owner','managing_agent','engaging_client','billing_party','report_recipient','maintenance_authority','strata_manager','owner_representative'].map((value) => <option key={value} value={value}>{label(value)}</option>)}</select><select value={contactId} onChange={(event) => setContactId(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"><option value="">Default Client contact</option>{selectedContacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.displayName}</option>)}</select><input value={approvalLimit} onChange={(event) => setApprovalLimit(event.target.value)} type="number" min="0" step="0.01" placeholder="PM approval limit" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"/><button disabled={busy || !clientId} onClick={() => void run(async () => { await createPropertyClientRelationship({ propertyId, clientAccountId: clientId, relationshipType, primaryContactId: contactId || undefined, isCurrent: true, startDate: new Date().toISOString().slice(0,10), propertyManagerApprovalLimit: Number(approvalLimit) || undefined }); setClientId(''); setContactId(''); setApprovalLimit(''); })} className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"><UserPlus size={13}/> Link Client</button></div>
  </section>;
};

export default PropertyClientRelationshipsPanel;
