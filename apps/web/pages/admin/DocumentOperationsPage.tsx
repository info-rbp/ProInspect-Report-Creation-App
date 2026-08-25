import React, { useEffect, useMemo, useState } from 'react';
import type { DocumentPacket, TenancyDocument, TenancyDocumentType } from '@pcr/domain';
import { approveDocumentPacket, createDocumentPacket, issueDocumentPacket, listDocumentPackets, validateDocumentPacket } from '../../services/platform/enhancementService';
import { listProperties } from '../../services/platform/propertyService';
import {
  agentSignTenancyDocument,
  archiveTenancyDocument,
  generateTenancyDocument,
  getTenancyDocumentDownload,
  issueTenancyDocument,
  listManagedTenancies,
  listTenancyDocuments,
  listTenants,
  type ManagedTenancy,
} from '../../services/platform/tenantDirectoryService';
import type { PropertyRecord, Tenant } from '../../types/platform';

type WorkspaceTab = 'documents' | 'packets';
const DOCUMENT_TYPES: TenancyDocumentType[] = ['tenancy_agreement', 'variation', 'inspection_notice', 'tenant_form', 'notice', 'information_sheet', 'signed_form', 'other'];
const pretty = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/gu, (character) => character.toUpperCase());

const DocumentOperationsPage: React.FC = () => {
  const [tab, setTab] = useState<WorkspaceTab>('documents');
  const [documents, setDocuments] = useState<TenancyDocument[]>([]);
  const [packets, setPackets] = useState<DocumentPacket[]>([]);
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [tenancies, setTenancies] = useState<ManagedTenancy[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [propertyId, setPropertyId] = useState('');
  const [tenancyId, setTenancyId] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [documentType, setDocumentType] = useState<TenancyDocumentType>('tenancy_agreement');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [agentSignatureName, setAgentSignatureName] = useState('');
  const [packetPolicyId, setPacketPolicyId] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [nextDocuments, nextPackets, nextProperties, nextTenancies, nextTenants] = await Promise.all([
        listTenancyDocuments(),
        listDocumentPackets(),
        listProperties(),
        listManagedTenancies(),
        listTenants(),
      ]);
      setDocuments(nextDocuments.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      setPackets(nextPackets.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      setProperties(nextProperties);
      setTenancies(nextTenancies);
      setTenants(nextTenants);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const propertyMap = useMemo(() => new Map(properties.map((property) => [property.id, property])), [properties]);
  const tenancyMap = useMemo(() => new Map(tenancies.map((tenancy) => [tenancy.id, tenancy])), [tenancies]);
  const tenantMap = useMemo(() => new Map(tenants.map((tenant) => [tenant.id, tenant])), [tenants]);
  const eligibleTenancies = useMemo(() => propertyId ? tenancies.filter((tenancy) => tenancy.propertyId === propertyId) : tenancies, [propertyId, tenancies]);

  const resetCreate = () => {
    setPropertyId(''); setTenancyId(''); setTenantId(''); setDocumentType('tenancy_agreement'); setTitle(''); setContent(''); setAgentSignatureName(''); setPacketPolicyId(''); setError('');
  };
  const openCreate = () => { resetCreate(); setShowCreate(true); };

  const createDocument = async () => {
    if (!propertyId || !tenancyId || !title.trim()) return setError('Property, tenancy and document title are required.');
    setBusy(true); setError('');
    try {
      await generateTenancyDocument({ propertyId, tenancyId, ...(tenantId ? { tenantId } : {}), type: documentType, title: title.trim(), ...(content.trim() ? { content: content.trim() } : {}) });
      setShowCreate(false); await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const createPacket = async () => {
    if (!propertyId || !tenancyId || !packetPolicyId.trim()) return setError('Property, tenancy and jurisdiction policy version are required.');
    setBusy(true); setError('');
    try {
      const related = documents.filter((document) => document.propertyId === propertyId && document.tenancyId === tenancyId && document.status !== 'archived');
      const recipient = tenantId ? tenantMap.get(tenantId) : undefined;
      await createDocumentPacket({
        propertyId,
        tenancyId,
        packetType: 'new_tenancy',
        jurisdictionPolicyVersionId: packetPolicyId.trim(),
        documentIds: related.map((document) => document.id),
        recipients: recipient ? [{ partyId: recipient.id, role: 'tenant', email: recipient.email, required: true, action: 'execute' }] : [],
        status: 'draft',
        dataSnapshot: { propertyAddress: propertyMap.get(propertyId)?.address, tenancyId },
        dataSnapshotSha256: '',
        version: 1,
      });
      setShowCreate(false); await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const runDocument = async (operation: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await operation(); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const download = async (document: TenancyDocument) => {
    setError('');
    try { const result = await getTenancyDocumentDownload(document.id); window.open(result.url, '_blank', 'noopener,noreferrer'); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const actPacket = async (packet: DocumentPacket, action: 'validate' | 'approve' | 'issue') => {
    setBusy(true); setError('');
    try {
      if (action === 'validate') await validateDocumentPacket(packet);
      else if (action === 'approve') await approveDocumentPacket(packet);
      else await issueDocumentPacket(packet);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <section className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h1 className="text-2xl font-bold">Tenancy Documents</h1><p className="text-sm text-gray-600">Generate, review, issue and track tenancy documents without handling financial transactions.</p></div><button type="button" onClick={openCreate} className="rounded-lg bg-gray-950 px-4 py-2 text-sm font-semibold text-white">New document / packet</button></header>
      {error && <div className="flex justify-between gap-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800"><span>{error}</span><button type="button" className="font-semibold underline" onClick={() => setError('')}>Dismiss</button></div>}
      <nav className="flex gap-1 rounded-xl border bg-white p-1"><button type="button" onClick={() => setTab('documents')} className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === 'documents' ? 'bg-gray-950 text-white' : 'text-gray-600'}`}>Documents ({documents.length})</button><button type="button" onClick={() => setTab('packets')} className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === 'packets' ? 'bg-gray-950 text-white' : 'text-gray-600'}`}>Packets ({packets.length})</button></nav>
      {loading ? <div className="rounded-xl border bg-white p-6 text-sm text-gray-500">Loading tenancy documents…</div> : tab === 'documents' ? (
        documents.length ? <div className="overflow-x-auto rounded-xl border bg-white"><table className="min-w-full text-left text-sm"><thead className="bg-gray-50 text-xs uppercase text-gray-500"><tr><th className="p-3">Document</th><th className="p-3">Property / tenancy</th><th className="p-3">Status</th><th className="p-3">Version</th><th className="p-3">Actions</th></tr></thead><tbody>{documents.map((document) => { const property = propertyMap.get(document.propertyId); const tenancy = tenancyMap.get(document.tenancyId); return <tr key={document.id} className="border-t align-top"><td className="p-3"><div className="font-semibold">{document.title}</div><div className="text-xs text-gray-500">{pretty(document.type)}</div></td><td className="p-3"><div>{property?.address || document.propertyId}</div><div className="text-xs text-gray-500">{tenancy?.tenantNames?.join(', ') || document.tenancyId}</div></td><td className="p-3"><span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold">{pretty(document.status)}</span>{document.issuedAt && <div className="mt-1 text-xs text-gray-500">Issued {new Date(document.issuedAt).toLocaleDateString()}</div>}</td><td className="p-3">v{document.documentVersion || document.version || 1}</td><td className="p-3"><div className="flex flex-wrap gap-2">{document.objectPath && <button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => void download(document)}>Preview / download</button>}{['draft', 'ready'].includes(document.status) && <button type="button" disabled={busy} className="rounded bg-gray-950 px-2 py-1 text-xs text-white" onClick={() => { if (window.confirm(`Issue ${document.title}? Issued content becomes immutable.`)) void runDocument(() => issueTenancyDocument(document.id, { ...(document.tenantId ? { tenantIds: [document.tenantId] } : {}), agentSignatureRequired: Boolean(agentSignatureName.trim()), ...(agentSignatureName.trim() ? { agentName: agentSignatureName.trim() } : {}) })); }}>Issue</button>}{['signature_required', 'partially_signed'].includes(document.status) && agentSignatureName.trim() && <button type="button" disabled={busy} className="rounded border px-2 py-1 text-xs" onClick={() => void runDocument(() => agentSignTenancyDocument(document.id, agentSignatureName.trim()))}>Agent sign</button>}{document.status !== 'archived' && <button type="button" disabled={busy} className="rounded border border-gray-300 px-2 py-1 text-xs" onClick={() => { if (window.confirm(`Archive ${document.title}?`)) void runDocument(() => archiveTenancyDocument(document.id)); }}>Archive</button>}</div></td></tr>; })}</tbody></table></div> : <div className="rounded-xl border border-dashed bg-white p-8 text-center"><div className="font-semibold">No tenancy documents yet</div><p className="mt-1 text-sm text-gray-500">Generate a draft from a property and tenancy. Issued documents become immutable and remain in the register.</p></div>
      ) : packets.length ? <div className="grid gap-3">{packets.map((packet) => <article key={packet.id} className="rounded-xl border bg-white p-4"><div className="flex flex-wrap justify-between gap-3"><div><div className="font-semibold">{pretty(packet.packetType)}</div><div className="text-sm text-gray-500">{propertyMap.get(packet.propertyId)?.address || packet.propertyId} · {pretty(packet.status)}</div><div className="mt-1 text-xs text-gray-500">{packet.documentIds.length} document(s) · {packet.recipients.length} recipient(s)</div></div><div className="flex gap-2"><button className="rounded border px-3 py-1.5 text-sm" disabled={busy} onClick={() => void actPacket(packet, 'validate')}>Validate</button><button className="rounded border px-3 py-1.5 text-sm disabled:opacity-40" disabled={busy || packet.status !== 'approval_required'} onClick={() => void actPacket(packet, 'approve')}>Approve</button><button className="rounded bg-gray-950 px-3 py-1.5 text-sm text-white disabled:opacity-40" disabled={busy || packet.status !== 'ready_to_issue'} onClick={() => { if (window.confirm('Issue this document packet?')) void actPacket(packet, 'issue'); }}>Issue</button></div></div></article>)}</div> : <div className="rounded-xl border border-dashed bg-white p-8 text-center"><div className="font-semibold">No document packets yet</div><p className="mt-1 text-sm text-gray-500">Packets group rendered documents and recipients through validation, approval and issue states.</p></div>}

      {showCreate && <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="new-document-title"><div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"><div className="flex justify-between gap-4"><div><h2 id="new-document-title" className="text-lg font-bold">New tenancy document</h2><p className="text-sm text-gray-500">Choose real entities by name rather than pasting internal IDs.</p></div><button type="button" onClick={() => setShowCreate(false)} className="rounded border px-3 py-1.5 text-sm">Cancel</button></div><div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Property<select value={propertyId} onChange={(event) => { setPropertyId(event.target.value); setTenancyId(''); }} className="mt-1 w-full rounded-lg border px-3 py-2"><option value="">Select property</option>{properties.map((property) => <option key={property.id} value={property.id}>{property.address}, {property.suburb}</option>)}</select></label><label className="text-sm font-medium">Tenancy<select value={tenancyId} onChange={(event) => setTenancyId(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2"><option value="">Select tenancy</option>{eligibleTenancies.map((tenancy) => <option key={tenancy.id} value={tenancy.id}>{tenancy.tenantNames?.join(', ') || tenancy.id} · {tenancy.lifecycleStatus || tenancy.status}</option>)}</select></label><label className="text-sm font-medium">Tenant (optional)<select value={tenantId} onChange={(event) => setTenantId(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2"><option value="">No specific tenant</option>{tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.fullName}{tenant.email ? ` · ${tenant.email}` : ''}</option>)}</select></label><label className="text-sm font-medium">Document type<select value={documentType} onChange={(event) => setDocumentType(event.target.value as TenancyDocumentType)} className="mt-1 w-full rounded-lg border px-3 py-2">{DOCUMENT_TYPES.map((type) => <option key={type} value={type}>{pretty(type)}</option>)}</select></label><label className="text-sm font-medium sm:col-span-2">Title<input value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" placeholder="e.g. Residential tenancy agreement" /></label><label className="text-sm font-medium sm:col-span-2">Draft content (optional)<textarea value={content} onChange={(event) => setContent(event.target.value)} className="mt-1 min-h-28 w-full rounded-lg border px-3 py-2" placeholder="Draft text or instructions for the document." /></label><label className="text-sm font-medium">Agent signature name (optional)<input value={agentSignatureName} onChange={(event) => setAgentSignatureName(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" /></label><label className="text-sm font-medium">Jurisdiction policy version (packet only)<input value={packetPolicyId} onChange={(event) => setPacketPolicyId(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" placeholder="Policy version ID" /></label></div><div className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" onClick={() => setShowCreate(false)} className="rounded-lg border px-4 py-2 text-sm font-semibold">Cancel</button><button type="button" disabled={busy || !propertyId || !tenancyId || !packetPolicyId.trim()} onClick={() => void createPacket()} className="rounded-lg border border-gray-950 px-4 py-2 text-sm font-semibold disabled:opacity-40">Create packet</button><button type="button" disabled={busy || !propertyId || !tenancyId || !title.trim()} onClick={() => void createDocument()} className="rounded-lg bg-gray-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy ? 'Creating…' : 'Generate draft'}</button></div></div></div>}
    </section>
  );
};
export default DocumentOperationsPage;
