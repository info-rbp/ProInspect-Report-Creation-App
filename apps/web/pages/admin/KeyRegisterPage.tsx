import React, { useEffect, useMemo, useState } from 'react';
import type { AccessDeviceRegisterItem } from '@pcr/domain';
import type { PeopleDirectoryEntry, PropertyRecord } from '../../types/platform';
import { createKeyEvent, createKeyRegisterItem, listKeyRegister } from '../../services/platform/enhancementService';
import { listPeople } from '../../services/platform/peopleService';
import { listProperties } from '../../services/platform/propertyService';

function propertyLabel(property: PropertyRecord | undefined, fallback: string): string {
  if (!property) return fallback;
  return [property.address, property.suburb, property.state, property.postcode].filter(Boolean).join(', ');
}

function personLabel(person: PeopleDirectoryEntry | undefined, fallback: string): string {
  return person?.displayName || person?.identity?.displayName || person?.email || fallback;
}

const KeyRegisterPage: React.FC = () => {
  const [items, setItems] = useState<AccessDeviceRegisterItem[]>([]);
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [people, setPeople] = useState<PeopleDirectoryEntry[]>([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [label, setLabel] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [kind, setKind] = useState<AccessDeviceRegisterItem['kind']>('key');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [propertyFilter, setPropertyFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [checkoutItem, setCheckoutItem] = useState<AccessDeviceRegisterItem | null>(null);
  const [holderId, setHolderId] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [nextItems, nextProperties, nextPeople] = await Promise.all([listKeyRegister(), listProperties(), listPeople()]);
      setItems(nextItems);
      setProperties(nextProperties);
      setPeople(nextPeople);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const propertyById = useMemo(() => new Map(properties.map((property) => [property.id, property])), [properties]);
  const personById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);
  const activePeople = useMemo(() => people.filter((person) => person.membershipStatus === 'active'), [people]);
  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      if (propertyFilter !== 'all' && item.propertyId !== propertyFilter) return false;
      if (!query) return true;
      const property = propertyLabel(propertyById.get(item.propertyId), item.propertyId);
      const holder = item.currentHolderId ? personLabel(personById.get(item.currentHolderId), item.currentHolderId) : '';
      return `${item.label} ${item.kind} ${item.status} ${property} ${holder}`.toLowerCase().includes(query);
    });
  }, [items, personById, propertyById, propertyFilter, search, statusFilter]);

  const openCreate = () => {
    setPropertyId('');
    setLabel('');
    setKind('key');
    setError('');
    setSuccess('');
    setShowCreate(true);
  };

  const add = async () => {
    if (!propertyId) return setError('Select a property before adding an access device.');
    if (!label.trim()) return setError('Key or access-device label is required.');
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await createKeyRegisterItem({ propertyId, label: label.trim(), kind, status: 'available' });
      setShowCreate(false);
      setSuccess('Access device added to the register.');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const runEvent = async (item: AccessDeviceRegisterItem, eventType: 'checked_out' | 'returned' | 'lost', toHolderId?: string, eventNotes?: string) => {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await createKeyEvent(item.id, { eventType, ...(toHolderId ? { toHolderId } : {}), ...(eventNotes?.trim() ? { notes: eventNotes.trim() } : {}) });
      setCheckoutItem(null);
      setHolderId('');
      setNotes('');
      setSuccess(eventType === 'checked_out' ? 'Custody checkout recorded.' : eventType === 'returned' ? 'Return recorded.' : 'Device marked lost and preserved in custody history.');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const confirmReturn = (item: AccessDeviceRegisterItem) => {
    if (window.confirm(`Record ${item.label} as returned and available?`)) void runEvent(item, 'returned');
  };
  const confirmLost = (item: AccessDeviceRegisterItem) => {
    if (window.confirm(`Mark ${item.label} as lost? This will be recorded in the custody history.`)) void runEvent(item, 'lost');
  };

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold">Key & Access Register</h1><p className="text-sm text-gray-600">Append-only custody tracking for keys, fobs, remotes and access devices.</p></div>
        <button className="rounded bg-gray-950 px-4 py-2 text-sm font-semibold text-white" onClick={openCreate}>Add device</button>
      </header>
      {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      {success && <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{success}</div>}

      <div className="grid gap-2 rounded-xl border bg-white p-3 sm:grid-cols-3">
        <input className="rounded border px-3 py-2 text-sm" placeholder="Search label, property or holder" value={search} onChange={(event) => setSearch(event.target.value)} />
        <select className="rounded border px-3 py-2 text-sm" value={propertyFilter} onChange={(event) => setPropertyFilter(event.target.value)}><option value="all">All properties</option>{properties.map((property) => <option key={property.id} value={property.id}>{propertyLabel(property, property.id)}</option>)}</select>
        <select className="rounded border px-3 py-2 text-sm" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="available">Available</option><option value="checked_out">Checked out</option><option value="lost">Lost</option><option value="replaced">Replaced</option><option value="deactivated">Deactivated</option></select>
      </div>

      {loading ? <div className="rounded-xl border bg-white p-6 text-sm text-gray-500">Loading access-device register...</div> : filteredItems.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-white p-8 text-center"><div className="font-semibold text-gray-900">No access devices in this view</div><p className="mt-1 text-sm text-gray-500">Add a device against a property, then use explicit checkout and return actions to maintain custody history.</p></div>
      ) : (
        <div className="grid gap-3">
          {filteredItems.map((item) => (
            <article key={item.id} className="rounded-xl border bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{item.label}</span><span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs capitalize text-gray-600">{item.kind.replaceAll('_', ' ')}</span><span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs capitalize text-gray-600">{item.status.replaceAll('_', ' ')}</span></div>
                  <div className="mt-1 text-sm text-gray-600">{propertyLabel(propertyById.get(item.propertyId), item.propertyId)}</div>
                  {item.currentHolderId ? <div className="mt-1 text-sm text-gray-700">Holder: <span className="font-medium">{personLabel(personById.get(item.currentHolderId), item.currentHolderId)}</span></div> : null}
                  <div className="mt-1 text-xs text-gray-500">{item.lastEventAt ? `Last custody event ${new Date(item.lastEventAt).toLocaleString('en-AU')}` : 'No custody event recorded yet'}</div>
                </div>
                <div className="flex gap-2">
                  {item.status === 'available' ? <button className="rounded bg-gray-950 px-3 py-1.5 text-sm text-white" disabled={busy} onClick={() => { setCheckoutItem(item); setHolderId(''); setNotes(''); }}>Check out</button> : item.status === 'checked_out' ? <button className="rounded border px-3 py-1.5 text-sm" disabled={busy} onClick={() => confirmReturn(item)}>Return</button> : null}
                  {!['lost', 'deactivated'].includes(item.status) ? <button className="rounded border border-red-200 px-3 py-1.5 text-sm text-red-700" disabled={busy} onClick={() => confirmLost(item)}>Mark lost</button> : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {showCreate ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-labelledby="key-create-dialog-title">
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4"><div><h2 id="key-create-dialog-title" className="text-lg font-bold">Add access device</h2><p className="text-sm text-gray-500">Use a human property selector. Internal IDs remain implementation details.</p></div><button type="button" className="rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-100" onClick={() => setShowCreate(false)}>Close</button></div>
            <div className="mt-5 grid gap-4">
              <label className="grid gap-1 text-sm font-medium">Property<select className="rounded border px-3 py-2 font-normal" value={propertyId} onChange={(event) => setPropertyId(event.target.value)}><option value="">Select property</option>{properties.map((property) => <option key={property.id} value={property.id}>{propertyLabel(property, property.id)}</option>)}</select></label>
              <div className="grid gap-4 sm:grid-cols-[1fr_180px]"><label className="grid gap-1 text-sm font-medium">Label<input className="rounded border px-3 py-2 font-normal" placeholder="e.g. Front door set A" value={label} onChange={(event) => setLabel(event.target.value)} /></label><label className="grid gap-1 text-sm font-medium">Type<select className="rounded border px-3 py-2 font-normal" value={kind} onChange={(event) => setKind(event.target.value as AccessDeviceRegisterItem['kind'])}><option value="key">Key</option><option value="fob">Fob</option><option value="remote">Remote</option><option value="access_card">Access card</option><option value="other">Other</option></select></label></div>
            </div>
            <div className="mt-5 flex justify-end gap-2"><button type="button" className="rounded border px-4 py-2 text-sm font-semibold" onClick={() => setShowCreate(false)} disabled={busy}>Cancel</button><button type="button" className="rounded bg-gray-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40" disabled={busy || !propertyId || !label.trim()} onClick={() => void add()}>{busy ? 'Adding...' : 'Add device'}</button></div>
          </div>
        </div>
      ) : null}

      {checkoutItem ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-labelledby="key-checkout-dialog-title">
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
            <h2 id="key-checkout-dialog-title" className="text-lg font-bold">Check out {checkoutItem.label}</h2>
            <p className="mt-1 text-sm text-gray-500">Record exactly who takes custody. The event is appended to the audit history.</p>
            <div className="mt-5 grid gap-4"><label className="grid gap-1 text-sm font-medium">Holder<select className="rounded border px-3 py-2 font-normal" value={holderId} onChange={(event) => setHolderId(event.target.value)}><option value="">Select active user</option>{activePeople.map((person) => <option key={person.id} value={person.id}>{personLabel(person, person.id)}</option>)}</select></label><label className="grid gap-1 text-sm font-medium">Notes<textarea className="min-h-20 rounded border px-3 py-2 font-normal" placeholder="Optional custody or return instructions" value={notes} onChange={(event) => setNotes(event.target.value)} /></label></div>
            <div className="mt-5 flex justify-end gap-2"><button type="button" className="rounded border px-4 py-2 text-sm font-semibold" onClick={() => setCheckoutItem(null)} disabled={busy}>Cancel</button><button type="button" className="rounded bg-gray-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40" disabled={busy || !holderId} onClick={() => void runEvent(checkoutItem, 'checked_out', holderId, notes)}>{busy ? 'Recording...' : 'Confirm checkout'}</button></div>
          </div>
        </div>
      ) : null}
    </section>
  );
};
export default KeyRegisterPage;
