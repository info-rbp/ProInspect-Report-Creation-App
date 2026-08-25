import React, { useEffect, useMemo, useState } from 'react';
import type { CommunicationChannel, CommunicationEntityType, CommunicationMessage, CommunicationThread, PropertyRecord, Tenant } from '@pcr/domain';
import { createCommunicationThread, listCommunicationMessages, listCommunicationThreads, sendThreadMessage } from '../../services/platform/enhancementService';
import { listProperties } from '../../services/platform/propertyService';
import { listTenants } from '../../services/platform/tenantDirectoryService';

function id(prefix: string): string {
  return `${prefix}-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

const CommunicationsPage: React.FC = () => {
  const [threads, setThreads] = useState<CommunicationThread[]>([]);
  const [messages, setMessages] = useState<CommunicationMessage[]>([]);
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [active, setActive] = useState<string>();
  const [body, setBody] = useState('');
  const [recipient, setRecipient] = useState('');
  const [messageSubject, setMessageSubject] = useState('');
  const [channel, setChannel] = useState<'email' | 'sms' | 'portal'>('email');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [threadSubject, setThreadSubject] = useState('');
  const [participantName, setParticipantName] = useState('');
  const [participantEmail, setParticipantEmail] = useState('');
  const [participantPhone, setParticipantPhone] = useState('');
  const [entityType, setEntityType] = useState<'' | 'property' | 'tenant'>('');
  const [entityId, setEntityId] = useState('');

  const load = async () => {
    setError('');
    try {
      const [nextThreads, nextMessages, nextProperties, nextTenants] = await Promise.all([
        listCommunicationThreads(),
        listCommunicationMessages(),
        listProperties(),
        listTenants(),
      ]);
      setThreads(nextThreads);
      setMessages(nextMessages);
      setProperties(nextProperties);
      setTenants(nextTenants);
      setActive((current) => current && nextThreads.some((thread) => thread.id === current) ? current : nextThreads[0]?.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  useEffect(() => { void load(); }, []);

  const activeThread = useMemo(() => threads.find((thread) => thread.id === active), [active, threads]);
  const visible = useMemo(
    () => messages.filter((message) => message.threadId === active).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [active, messages],
  );
  const filteredThreads = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return threads;
    return threads.filter((thread) => `${thread.subject} ${thread.participants.map((participant) => participant.displayName).join(' ')}`.toLowerCase().includes(query));
  }, [search, threads]);

  useEffect(() => {
    if (!activeThread) return;
    const participant = activeThread.participants.find((item) => item.email || item.phone);
    if (!participant) return;
    if (channel === 'email' && participant.email) setRecipient(participant.email);
    else if (channel === 'sms' && participant.phone) setRecipient(participant.phone);
  }, [activeThread, channel]);

  const openNewThread = () => {
    setThreadSubject('');
    setParticipantName('');
    setParticipantEmail('');
    setParticipantPhone('');
    setEntityType('');
    setEntityId('');
    setError('');
    setSuccess('');
    setShowCreate(true);
  };

  const newThread = async () => {
    if (!threadSubject.trim()) return setError('Conversation subject is required.');
    if (participantEmail.trim() && !participantEmail.includes('@')) return setError('Enter a valid participant email address.');
    if (entityType && !entityId) return setError('Select the related record or clear the relationship type.');
    setBusy(true);
    setError('');
    try {
      const participantId = id('participant');
      const thread = await createCommunicationThread({
        subject: threadSubject.trim(),
        status: 'open',
        participants: participantName.trim() || participantEmail.trim() || participantPhone.trim() ? [{
          id: participantId,
          kind: 'external',
          displayName: participantName.trim() || participantEmail.trim() || participantPhone.trim(),
          ...(participantEmail.trim() ? { email: participantEmail.trim().toLowerCase() } : {}),
          ...(participantPhone.trim() ? { phone: participantPhone.trim() } : {}),
        }] : [],
        entityLinks: entityType && entityId ? [{ entityType: entityType as CommunicationEntityType, entityId }] : [],
      });
      setThreads((items) => [thread, ...items]);
      setActive(thread.id);
      setRecipient(participantEmail.trim() || participantPhone.trim());
      setShowCreate(false);
      setSuccess('Conversation created. No message has been sent yet.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!active) return setError('Select or create a conversation before sending a message.');
    if (!body.trim()) return setError('Message body is required.');
    if (!recipient.trim()) return setError('Recipient is required.');
    if (channel === 'email' && !recipient.includes('@')) return setError('Enter a valid email recipient.');
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await sendThreadMessage(active, {
        channel,
        recipients: [recipient.trim()],
        ...(channel === 'email' && messageSubject.trim() ? { subject: messageSubject.trim() } : {}),
        body: body.trim(),
      });
      setBody('');
      setMessageSubject('');
      setSuccess('Message accepted for delivery. Delivery status will update in the conversation history.');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const entityOptions = entityType === 'property'
    ? properties.map((property) => ({ id: property.id, label: [property.address, property.suburb].filter(Boolean).join(', ') }))
    : entityType === 'tenant'
      ? tenants.map((tenant) => ({ id: tenant.id, label: tenant.fullName }))
      : [];

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold">Communications</h1><p className="text-sm text-gray-600">Auditable email, SMS and portal correspondence linked to operational records.</p></div>
        <button className="rounded bg-gray-950 px-4 py-2 text-sm text-white" onClick={openNewThread}>New conversation</button>
      </header>
      {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      {success && <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{success}</div>}

      <div className="grid min-h-[580px] gap-4 lg:grid-cols-[320px_1fr]">
        <aside className="rounded-xl border bg-white p-2">
          <input className="mb-2 w-full rounded-lg border px-3 py-2 text-sm" placeholder="Search conversations" value={search} onChange={(event) => setSearch(event.target.value)} />
          {filteredThreads.length === 0 ? <div className="p-5 text-center text-sm text-gray-500">No conversations match this view. Create one when correspondence needs to be recorded.</div> : filteredThreads.map((thread) => (
            <button key={thread.id} onClick={() => setActive(thread.id)} className={`mb-1 w-full rounded-lg p-3 text-left ${active === thread.id ? 'bg-gray-950 text-white' : 'hover:bg-gray-50'}`}>
              <div className="truncate font-medium">{thread.subject}</div>
              <div className="truncate text-xs opacity-70">{thread.participants.map((participant) => participant.displayName).join(', ') || 'No participant'} · {thread.status}</div>
              <div className="mt-1 text-[11px] opacity-60">{thread.lastMessageAt ? new Date(thread.lastMessageAt).toLocaleString('en-AU') : 'No messages'}</div>
            </button>
          ))}
        </aside>

        <div className="flex min-h-[520px] flex-col rounded-xl border bg-white">
          {activeThread ? (
            <>
              <div className="border-b px-4 py-3">
                <div className="font-semibold text-gray-950">{activeThread.subject}</div>
                <div className="mt-1 text-xs text-gray-500">{activeThread.participants.map((participant) => participant.displayName).join(', ') || 'No participants'}{activeThread.entityLinks.length ? ` · ${activeThread.entityLinks.map((link) => `${link.entityType} ${link.entityId}`).join(', ')}` : ''}</div>
              </div>
              <div className="flex-1 space-y-3 overflow-auto p-4">
                {visible.length === 0 ? <div className="grid h-full place-items-center text-center text-sm text-gray-500"><div><div className="font-semibold text-gray-700">No messages yet</div><div>Create the first message below. It will not be sent until you explicitly press Send.</div></div></div> : visible.map((message) => (
                  <div key={message.id} className={`max-w-2xl rounded-lg p-3 text-sm ${message.direction === 'outbound' ? 'ml-auto bg-gray-950 text-white' : 'bg-gray-100'}`}>
                    {message.subject ? <div className="mb-1 font-semibold">{message.subject}</div> : null}
                    <div className="whitespace-pre-wrap">{message.body}</div>
                    <div className="mt-1 text-xs opacity-60">{message.channel} · {message.status} · {new Date(message.createdAt).toLocaleString('en-AU')}</div>
                  </div>
                ))}
              </div>
              <div className="border-t p-4">
                <div className="mb-2 grid gap-2 sm:grid-cols-[140px_1fr]">
                  <select className="rounded border px-3 py-2 text-sm" value={channel} onChange={(event) => setChannel(event.target.value as 'email' | 'sms' | 'portal')}><option value="email">Email</option><option value="sms">SMS</option><option value="portal">Portal</option></select>
                  <input className="rounded border px-3 py-2 text-sm" placeholder={channel === 'email' ? 'Recipient email' : channel === 'sms' ? 'Recipient mobile' : 'Portal recipient'} value={recipient} onChange={(event) => setRecipient(event.target.value)} />
                </div>
                {channel === 'email' ? <input className="mb-2 w-full rounded border px-3 py-2 text-sm" placeholder="Subject (optional)" value={messageSubject} onChange={(event) => setMessageSubject(event.target.value)} /> : null}
                <textarea className="min-h-24 w-full rounded border px-3 py-2 text-sm" placeholder="Message" value={body} onChange={(event) => setBody(event.target.value)} />
                <div className="mt-2 flex items-center justify-between gap-3"><p className="text-xs text-gray-500">Messages are recorded with delivery status for audit history.</p><button className="rounded bg-gray-950 px-4 py-2 text-sm text-white disabled:opacity-40" onClick={() => void send()} disabled={busy || !body.trim() || !recipient.trim()}>{busy ? 'Sending...' : 'Send'}</button></div>
              </div>
            </>
          ) : <div className="grid flex-1 place-items-center p-8 text-center text-sm text-gray-500"><div><div className="font-semibold text-gray-700">Select a conversation</div><div>Or create a new conversation without sending anything until you are ready.</div></div></div>}
        </div>
      </div>

      {showCreate ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-labelledby="communication-dialog-title">
          <div className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4"><div><h2 id="communication-dialog-title" className="text-lg font-bold">New conversation</h2><p className="text-sm text-gray-500">Create an auditable thread. This does not send a message.</p></div><button type="button" className="rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-100" onClick={() => setShowCreate(false)}>Close</button></div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm font-medium sm:col-span-2">Subject<input className="rounded border px-3 py-2 font-normal" value={threadSubject} onChange={(event) => setThreadSubject(event.target.value)} /></label>
              <label className="grid gap-1 text-sm font-medium sm:col-span-2">Participant name<input className="rounded border px-3 py-2 font-normal" value={participantName} onChange={(event) => setParticipantName(event.target.value)} /></label>
              <label className="grid gap-1 text-sm font-medium">Email<input type="email" className="rounded border px-3 py-2 font-normal" value={participantEmail} onChange={(event) => setParticipantEmail(event.target.value)} /></label>
              <label className="grid gap-1 text-sm font-medium">Mobile<input className="rounded border px-3 py-2 font-normal" value={participantPhone} onChange={(event) => setParticipantPhone(event.target.value)} /></label>
              <label className="grid gap-1 text-sm font-medium">Related record type<select className="rounded border px-3 py-2 font-normal" value={entityType} onChange={(event) => { setEntityType(event.target.value as '' | 'property' | 'tenant'); setEntityId(''); }}><option value="">None</option><option value="property">Property</option><option value="tenant">Tenant</option></select></label>
              <label className="grid gap-1 text-sm font-medium">Related record<select className="rounded border px-3 py-2 font-normal disabled:bg-gray-50" disabled={!entityType} value={entityId} onChange={(event) => setEntityId(event.target.value)}><option value="">Select record</option>{entityOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
            </div>
            <div className="mt-5 flex justify-end gap-2"><button type="button" className="rounded border px-4 py-2 text-sm font-semibold" onClick={() => setShowCreate(false)} disabled={busy}>Cancel</button><button type="button" className="rounded bg-gray-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40" disabled={busy || !threadSubject.trim()} onClick={() => void newThread()}>{busy ? 'Creating...' : 'Create conversation'}</button></div>
          </div>
        </div>
      ) : null}
    </section>
  );
};
export default CommunicationsPage;
