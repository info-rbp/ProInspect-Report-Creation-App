import React, { useEffect, useMemo, useState } from 'react';
import type { AccessDeviceCustodyEvent, AccessDeviceRegisterItem } from '@pcr/domain';
import type { PropertyRecord, UserProfile } from '../../types/platform';
import { createKeyEvent, createKeyRegisterItem, listKeyEvents, listKeyRegister } from '../../services/platform/enhancementService';
import { listProperties } from '../../services/platform/propertyService';
import { listAgencyUsers } from '../../services/platform/userDirectoryService';

const KeyRegisterPage: React.FC = () => {
  const [items, setItems] = useState<AccessDeviceRegisterItem[]>([]);
  const [events, setEvents] = useState<AccessDeviceCustodyEvent[]>([]);
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [showAdd, setShowAdd] = useState(false);
  const [label, setLabel] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [kind, setKind] = useState<AccessDeviceRegisterItem['kind']>('key');
  const [holderByItem, setHolderByItem] = useState<Record<string, string>>({});
  const [historyItem, setHistoryItem] = useState<AccessDeviceRegisterItem | null>(null);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const [nextItems, nextEvents, nextProperties, nextUsers] = await Promise.all([listKeyRegister(), listKeyEvents(), listProperties(), listAgencyUsers()]);
      setItems(nextItems);
      setEvents(nextEvents.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)));
      setProperties(nextProperties);
      setUsers(nextUsers);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const propertyMap = useMemo(() => new Map(properties.map((property) => [property.id, property])), [properties]);
  const userMap = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter((item) => {
      const property = propertyMap.get(item.propertyId);
      const holder = item.currentHolderId ? userMap.get(item.currentHolderId) : undefined;
      const haystack = [item.label, item.kind, item.status, property?.address, property?.suburb, holder?.displayName, holder?.email].filter(Boolean).join(' ').toLowerCase();
      return (!query || haystack.includes(query)) && (status === 'all' || item.status === status);
    });
  }, [items, propertyMap, search, status, userMap]);

  const add = async () => {
    if (!label.trim()) return setError('Enter a label for the key or access device.');
    if (!propertyId) return setError('Choose the property that owns this access device.');
    setBusy(true); setError('');
    try {
      await createKeyRegisterItem({ propertyId, label: label.trim(), kind, status: 'available' });
      setLabel(''); setPropertyId(''); setKind('key'); setShowAdd(false); await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const event = async (item: AccessDeviceRegisterItem, eventType: 'checked_out' | 'returned' | 'lost') => {
    const holder = holderByItem[item.id]?.trim();
    if (eventType === 'checked_out' && !holder) return setError('Choose a holder before checking out an access device.');
    setBusy(true); setError('');
    try {
      await createKeyEvent(item.id, { eventType, ...(eventType === 'checked_out' ? { toHolderId: holder } : {}), notes: eventType === 'lost' ? 'Marked lost from the Key Register.' : undefined });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const userLabel = (id?: string) => {
    if (!id) return 'None';
    const user = userMap.get(id);
    return user?.displayName?.trim() || user?.email || id;
  };

  return (
    <section className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h1 className="text-2xl font-bold">Key & Access Register</h1><p className="text-sm text-gray-600">Auditable custody tracking for keys, fobs, remotes and access devices.</p></div><button type="button" onClick={() => { setError(''); setShowAdd(true); }} className="rounded-lg bg-gray-950 px-4 py-2 text-sm font-semibold text-white">Add access device</button></header>
      {error && <div className="flex justify-between gap-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800"><span>{error}</span><button type="button" className="font-semibold underline" onClick={() => setError('')}>Dismiss</button></div>}
      <div className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-[1fr_180px]"><label className="text-xs font-semibold text-gray-600">Search<input value={search} onChange={(event) => setSearch(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-normal" placeholder="Device, property or holder" /></label><label className="text-xs font-semibold text-gray-600">Status<select value={status} onChange={(event) => setStatus(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-normal"><option value="all">All statuses</option><option value="available">Available</option><option value="checked_out">Checked out</option><option value="lost">Lost</option><option value="replaced">Replaced</option><option value="deactivated">Deactivated</option></select></label></div>

      {loading ? <div className="rounded-xl border bg-white p-6 text-sm text-gray-500">Loading access devices…</div> : rows.length ? <div className="grid gap-3">{rows.map((item) => { const property = propertyMap.get(item.propertyId); return <article key={item.id} className="rounded-xl border bg-white p-4"><div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center"><div><div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{item.label}</span><span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold">{item.kind.replaceAll('_', ' ')}</span><span className={`rounded-full px-2 py-1 text-xs font-semibold ${item.status === 'available' ? 'bg-emerald-50 text-emerald-700' : item.status === 'lost' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-800'}`}>{item.status.replaceAll('_', ' ')}</span></div><div className="mt-1 text-sm text-gray-600">{property ? `${property.address}, ${property.suburb}` : item.propertyId}</div><div className="mt-1 text-xs text-gray-500">Current holder: {userLabel(item.currentHolderId)}{item.lastEventAt ? ` · last event ${new Date(item.lastEventAt).toLocaleString()}` : ''}</div></div><div className="flex flex-wrap items-end gap-2">{item.status === 'available' && <label className="text-xs font-semibold text-gray-600">Holder<select value={holderByItem[item.id] || ''} onChange={(eventValue) => setHolderByItem((current) => ({ ...current, [item.id]: eventValue.target.value }))} className="mt-1 block min-w-52 rounded border px-2 py-1.5 text-sm font-normal"><option value="">Select holder</option>{users.filter((user) => user.status === 'active').map((user) => <option key={user.id} value={user.id}>{user.displayName || user.email}</option>)}</select></label>}{item.status === 'available' ? <button disabled={busy || !holderByItem[item.id]} className="rounded bg-gray-950 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40" onClick={() => void event(item, 'checked_out')}>Check out</button> : item.status === 'checked_out' ? <button disabled={busy} className="rounded border px-3 py-2 text-sm font-semibold" onClick={() => void event(item, 'returned')}>Return</button> : null}{!['lost', 'deactivated'].includes(item.status) && <button disabled={busy} className="rounded border border-red-200 px-3 py-2 text-sm font-semibold text-red-700" onClick={() => { if (window.confirm(`Mark ${item.label} as lost?`)) void event(item, 'lost'); }}>Mark lost</button>}<button type="button" className="rounded border px-3 py-2 text-sm font-semibold" onClick={() => setHistoryItem(item)}>History</button></div></div></article>; })}</div> : <div className="rounded-xl border border-dashed bg-white p-8 text-center"><div className="font-semibold">No access devices found</div><p className="mt-1 text-sm text-gray-500">Add a device against a property to begin append-only custody tracking.</p></div>}

      {showAdd && <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="add-key-title"><div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl"><h2 id="add-key-title" className="text-lg font-bold">Add access device</h2><div className="mt-4 space-y-3"><label className="block text-sm font-medium">Property<select value={propertyId} onChange={(event) => setPropertyId(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2"><option value="">Select property</option>{properties.map((property) => <option key={property.id} value={property.id}>{property.address}, {property.suburb}</option>)}</select></label><label className="block text-sm font-medium">Label<input value={label} onChange={(event) => setLabel(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" placeholder="e.g. Front door set A" /></label><label className="block text-sm font-medium">Device type<select value={kind} onChange={(event) => setKind(event.target.value as AccessDeviceRegisterItem['kind'])} className="mt-1 w-full rounded-lg border px-3 py-2"><option value="key">Key</option><option value="fob">Fob</option><option value="remote">Remote</option><option value="access_card">Access card</option><option value="other">Other</option></select></label></div><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setShowAdd(false)} className="rounded-lg border px-4 py-2 text-sm font-semibold">Cancel</button><button type="button" disabled={busy || !propertyId || !label.trim()} onClick={() => void add()} className="rounded-lg bg-gray-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy ? 'Adding…' : 'Add device'}</button></div></div></div>}

      {historyItem && <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="key-history-title"><div className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"><div className="flex items-start justify-between"><div><h2 id="key-history-title" className="text-lg font-bold">Custody history · {historyItem.label}</h2><p className="text-sm text-gray-500">Append-only events for {propertyMap.get(historyItem.propertyId)?.address || historyItem.propertyId}</p></div><button type="button" onClick={() => setHistoryItem(null)} className="rounded border px-3 py-1.5 text-sm">Close</button></div><div className="mt-4 space-y-2">{events.filter((eventItem) => eventItem.accessDeviceId === historyItem.id).length ? events.filter((eventItem) => eventItem.accessDeviceId === historyItem.id).map((eventItem) => <div key={eventItem.id} className="rounded-lg border p-3 text-sm"><div className="flex justify-between gap-3"><strong>{eventItem.eventType.replaceAll('_', ' ')}</strong><span className="text-xs text-gray-500">{new Date(eventItem.occurredAt).toLocaleString()}</span></div><div className="mt-1 text-xs text-gray-600">{eventItem.fromHolderId ? `From ${userLabel(eventItem.fromHolderId)}` : ''}{eventItem.toHolderId ? `${eventItem.fromHolderId ? ' · ' : ''}To ${userLabel(eventItem.toHolderId)}` : ''}</div>{eventItem.notes && <div className="mt-1 text-xs text-gray-500">{eventItem.notes}</div>}</div>) : <div className="rounded-lg bg-gray-50 p-4 text-sm text-gray-500">No custody events have been recorded yet.</div>}</div></div></div>}
    </section>
  );
};
export default KeyRegisterPage;
