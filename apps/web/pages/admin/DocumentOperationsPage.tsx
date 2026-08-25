import React, { useEffect, useMemo, useState } from 'react';
import type { DocumentPacket, JurisdictionPolicyVersion, PropertyRecord } from '@pcr/domain';
import { approveDocumentPacket, createDocumentPacket, issueDocumentPacket, listDocumentPackets, listJurisdictionPolicies, renderDocumentPacket, validateDocumentPacket } from '../../services/platform/enhancementService';
import { listProperties } from '../../services/platform/propertyService';
import { listManagedTenancies, type ManagedTenancy } from '../../services/platform/tenantDirectoryService';

function generatedPartyId(): string {
  return `recipient-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function propertyLabel(property: PropertyRecord | undefined, fallback: string): string {
  if (!property) return fallback;
  return [property.address, property.suburb, property.state, property.postcode].filter(Boolean).join(', ');
}

const DocumentOperationsPage: React.FC = () => {
  const [packets, setPackets] = useState<DocumentPacket[]>([]);
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [tenancies, setTenancies] = useState<ManagedTenancy[]>([]);
  const [policies, setPolicies] = useState<JurisdictionPolicyVersion[]>([]);
  const [propertyId, setPropertyId] = useState('');
  const [tenancyId, setTenancyId] = useState('');
  const [policyId, setPolicyId] = useState('');
  const [packetType, setPacketType] = useState('new_tenancy');
  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busyId, setBusyId] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [nextPackets, nextProperties, nextTenancies, nextPolicies] = await Promise.all([
        listDocumentPackets(),
        listProperties(),
        listManagedTenancies(),
        listJurisdictionPolicies(),
      ]);
      setPackets(nextPackets);
      setProperties(nextProperties);
      setTenancies(nextTenancies);
      setPolicies(nextPolicies);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const propertyById = useMemo(() => new Map(properties.map((property) => [property.id, property])), [properties]);
  const tenancyById = useMemo(() => new Map(tenancies.map((tenancy) => [tenancy.id, tenancy])), [tenancies]);
  const policyById = useMemo(() => new Map(policies.map((policy) => [policy.id, policy])), [policies]);
  const propertyTenancies = useMemo(() => tenancies.filter((tenancy) => !propertyId || tenancy.propertyId === propertyId), [propertyId, tenancies]);
  const publishedPolicies = useMemo(() => policies.filter((policy) => policy.status === 'published'), [policies]);

  const openCreate = () => {
    setPropertyId('');
    setTenancyId('');
    setPolicyId('');
    setPacketType('new_tenancy');
    setRecipientName('');
    setRecipientEmail('');
    setError('');
    setSuccess('');
    setShowCreate(true);
  };

  const create = async () => {
    if (!propertyId) return setError('Select a property.');
    if (!tenancyId) return setError('Select a tenancy.');
    if (!policyId) return setError('Select a published jurisdiction policy.');
    if (!recipientName.trim()) return setError('Recipient name is required.');
    if (!recipientEmail.trim() || !recipientEmail.includes('@')) return setError('A valid recipient email is required.');
    const tenancy = tenancyById.get(tenancyId);
    if (!tenancy || tenancy.propertyId !== propertyId) return setError('The selected tenancy does not belong to the selected property.');
    const property = propertyById.get(propertyId);
    setBusyId('create');
    setError('');
    setSuccess('');
    try {
      const packet = await createDocumentPacket({
        propertyId,
        tenancyId,
        packetType,
        jurisdictionPolicyVersionId: policyId,
        documentIds: [],
        recipients: [{ partyId: generatedPartyId(), role: 'tenant', email: recipientEmail.trim().toLowerCase(), required: true, action: 'execute' }],
        status: 'draft',
        dataSnapshot: {
          property: property ? { id: property.id, address: property.address, suburb: property.suburb, state: property.state, postcode: property.postcode } : { id: propertyId },
          tenancy: { id: tenancy.id, propertyId: tenancy.propertyId, leaseStartDate: tenancy.leaseStartDate, leaseEndDate: tenancy.leaseEndDate, tenantNames: tenancy.tenantNames, tenantEmails: tenancy.tenantEmails },
          recipient: { name: recipientName.trim(), email: recipientEmail.trim().toLowerCase() },
        },
        dataSnapshotSha256: '',
        version: 1,
      });
      setPackets((items) => [packet, ...items]);
      setShowCreate(false);
      setSuccess('Document packet created as a draft. Render its policy documents before validation.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusyId('');
    }
  };

  const act = async (packet: DocumentPacket, action: 'render' | 'validate' | 'approve' | 'issue') => {
    setBusyId(`${packet.id}:${action}`);
    setError('');
    setSuccess('');
    try {
      if (action === 'render') {
        const policy = policyById.get(packet.jurisdictionPolicyVersionId);
        if (!policy) throw new Error('The packet jurisdiction policy could not be found.');
        if (!policy.rules.length) throw new Error('The selected jurisdiction policy has no document rules to render.');
        await renderDocumentPacket(packet, policy.rules.map((rule) => ({
          templateVersionId: rule.templateVersionId,
          title: rule.purpose,
          fields: packet.dataSnapshot,
        })));
        setSuccess('Document rendering was queued. Refresh the packet before validation if processing is still underway.');
      } else if (action === 'validate') {
        const updated = await validateDocumentPacket(packet);
        const blockers = (updated as DocumentPacket & { validationBlockers?: string[] }).validationBlockers || [];
        setSuccess(blockers.length ? `Validation completed with blockers: ${blockers.join(' ')}` : 'Packet validated and is ready for approval.');
      } else if (action === 'approve') {
        await approveDocumentPacket(packet);
        setSuccess('Packet approved and ready to issue.');
      } else {
        if (!window.confirm('Issue this document packet to its configured recipients? Issued content becomes part of the audit history.')) return;
        await issueDocumentPacket(packet);
        setSuccess('Document packet issued.');
      }
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusyId('');
    }
  };

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold">Tenancy Documents</h1><p className="text-sm text-gray-600">Jurisdiction-aware document packets, rendering, approval, issue and signing status. Financial transactions remain external.</p></div>
        <button className="rounded bg-gray-950 px-4 py-2 text-sm font-semibold text-white" onClick={openCreate}>Create packet</button>
      </header>
      {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      {success && <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{success}</div>}

      {loading ? <div className="rounded-xl border bg-white p-6 text-sm text-gray-500">Loading document packets...</div> : packets.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-white p-8 text-center"><div className="font-semibold text-gray-900">No document packets yet</div><p className="mt-1 text-sm text-gray-500">Create a packet by selecting a real property, tenancy and published jurisdiction policy. Nothing is issued until the explicit Issue action.</p></div>
      ) : (
        <div className="grid gap-3">
          {packets.map((packet) => {
            const property = propertyById.get(packet.propertyId);
            const tenancy = tenancyById.get(packet.tenancyId);
            const policy = policyById.get(packet.jurisdictionPolicyVersionId);
            const busy = busyId.startsWith(`${packet.id}:`);
            return (
              <article key={packet.id} className="rounded-xl border bg-white p-4">
                <div className="flex flex-wrap justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold capitalize">{packet.packetType.replaceAll('_', ' ')}</div>
                    <div className="text-sm text-gray-700">{propertyLabel(property, packet.propertyId)}</div>
                    <div className="mt-1 text-xs text-gray-500">Tenancy {tenancy ? `${tenancy.leaseStartDate || 'start not set'} → ${tenancy.leaseEndDate || 'periodic'}` : packet.tenancyId} · {policy ? `${policy.jurisdiction} policy v${policy.versionNumber}` : packet.jurisdictionPolicyVersionId}</div>
                    <div className="mt-1 text-xs text-gray-500">{packet.documentIds.length} document(s) · {packet.recipients.length} recipient(s) · <span className="font-semibold capitalize">{packet.status.replaceAll('_', ' ')}</span></div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button className="rounded border px-3 py-1.5 text-sm disabled:opacity-40" disabled={busy || !['draft', 'validation_required'].includes(packet.status)} onClick={() => void act(packet, 'render')}>Render</button>
                    <button className="rounded border px-3 py-1.5 text-sm disabled:opacity-40" disabled={busy || !['draft', 'validation_required'].includes(packet.status)} onClick={() => void act(packet, 'validate')}>Validate</button>
                    <button className="rounded border px-3 py-1.5 text-sm disabled:opacity-40" disabled={busy || packet.status !== 'approval_required'} onClick={() => void act(packet, 'approve')}>Approve</button>
                    <button className="rounded bg-gray-950 px-3 py-1.5 text-sm text-white disabled:opacity-40" disabled={busy || packet.status !== 'ready_to_issue'} onClick={() => void act(packet, 'issue')}>Issue</button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {showCreate ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-labelledby="document-packet-dialog-title">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4"><div><h2 id="document-packet-dialog-title" className="text-lg font-bold">Create tenancy document packet</h2><p className="text-sm text-gray-500">Select authoritative records instead of entering internal IDs.</p></div><button type="button" className="rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-100" onClick={() => setShowCreate(false)}>Close</button></div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1 text-sm font-medium sm:col-span-2">Property<select className="rounded border px-3 py-2 font-normal" value={propertyId} onChange={(event) => { setPropertyId(event.target.value); setTenancyId(''); }}><option value="">Select property</option>{properties.map((property) => <option key={property.id} value={property.id}>{propertyLabel(property, property.id)}</option>)}</select></label>
              <label className="grid gap-1 text-sm font-medium sm:col-span-2">Tenancy<select className="rounded border px-3 py-2 font-normal disabled:bg-gray-50" value={tenancyId} disabled={!propertyId} onChange={(event) => setTenancyId(event.target.value)}><option value="">Select tenancy</option>{propertyTenancies.map((tenancy) => <option key={tenancy.id} value={tenancy.id}>{(tenancy.tenantNames || []).join(', ') || tenancy.id} · {tenancy.leaseStartDate || 'start not set'} → {tenancy.leaseEndDate || 'periodic'}</option>)}</select></label>
              <label className="grid gap-1 text-sm font-medium">Packet type<select className="rounded border px-3 py-2 font-normal" value={packetType} onChange={(event) => setPacketType(event.target.value)}><option value="new_tenancy">New tenancy</option><option value="renewal">Renewal</option><option value="variation">Variation</option><option value="vacate">Vacate</option><option value="general">General</option></select></label>
              <label className="grid gap-1 text-sm font-medium">Jurisdiction policy<select className="rounded border px-3 py-2 font-normal" value={policyId} onChange={(event) => setPolicyId(event.target.value)}><option value="">Select published policy</option>{publishedPolicies.map((policy) => <option key={policy.id} value={policy.id}>{policy.jurisdiction} · {policy.tenancyKind} · v{policy.versionNumber} · {policy.workflow}</option>)}</select></label>
              <label className="grid gap-1 text-sm font-medium">Recipient name<input className="rounded border px-3 py-2 font-normal" value={recipientName} onChange={(event) => setRecipientName(event.target.value)} /></label>
              <label className="grid gap-1 text-sm font-medium">Recipient email<input type="email" className="rounded border px-3 py-2 font-normal" value={recipientEmail} onChange={(event) => setRecipientEmail(event.target.value)} /></label>
            </div>
            {publishedPolicies.length === 0 ? <div className="mt-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">No published jurisdiction policy is available. Publish a reviewed policy before creating operational packets.</div> : null}
            <div className="mt-5 flex justify-end gap-2"><button type="button" className="rounded border px-4 py-2 text-sm font-semibold" onClick={() => setShowCreate(false)} disabled={busyId === 'create'}>Cancel</button><button type="button" className="rounded bg-gray-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40" onClick={() => void create()} disabled={busyId === 'create' || !propertyId || !tenancyId || !policyId || !recipientName.trim() || !recipientEmail.trim()}>{busyId === 'create' ? 'Creating...' : 'Create draft packet'}</button></div>
          </div>
        </div>
      ) : null}
    </section>
  );
};
export default DocumentOperationsPage;
