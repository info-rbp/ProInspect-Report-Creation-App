import React, { useEffect, useMemo, useState } from 'react';
import type { CommunicationMessage, CommunicationThread } from '@pcr/domain';
import { createCommunicationThread, listCommunicationMessages, listCommunicationThreads, sendThreadMessage } from '../../services/platform/enhancementService';

const CommunicationsPage: React.FC = () => {
  const [threads, setThreads] = useState<CommunicationThread[]>([]);
  const [messages, setMessages] = useState<CommunicationMessage[]>([]);
  const [active, setActive] = useState<string>();
  const [body, setBody] = useState('');
  const [recipient, setRecipient] = useState('');
  const [channel, setChannel] = useState<'email' | 'sms' | 'portal'>('email');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [subject, setSubject] = useState('');
  const [newRecipient, setNewRecipient] = useState('');
  const [newChannel, setNewChannel] = useState<'email' | 'sms' | 'portal'>('email');

  const load = async () => {
    setError('');
    try {
      const [nextThreads, nextMessages] = await Promise.all([listCommunicationThreads(), listCommunicationMessages()]);
      setThreads(nextThreads.sort((a, b) => String(b.lastMessageAt || b.updatedAt).localeCompare(String(a.lastMessageAt || a.updatedAt))));
      setMessages(nextMessages);
      if (!active && nextThreads[0]) setActive(nextThreads[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => { void load(); }, []);

  const filteredThreads = useMemo(() => {
    const query = search.trim().toLowerCase();
    return threads.filter((thread) => !query || [thread.subject, ...thread.participants.map((participant) => participant.displayName), ...thread.participants.map((participant) => participant.email || participant.phone || '')].join(' ').toLowerCase().includes(query));
  }, [search, threads]);
  const activeThread = threads.find((thread) => thread.id === active);
  const visible = useMemo(() => messages.filter((message) => message.threadId === active).sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [active, messages]);

  const beginNew = () => {
    setSubject('');
    setNewRecipient('');
    setNewChannel('email');
    setError('');
    setShowNew(true);
  };

  const newThread = async () => {
    if (!subject.trim()) return setError('Enter a subject for the conversation.');
    if (!newRecipient.trim()) return setError('Enter a recipient before creating the conversation.');
    setBusy(true);
    setError('');
    try {
      const value = newRecipient.trim();
      const thread = await createCommunicationThread({
        subject: subject.trim(),
        status: 'open',
        participants: [{
          id: `external-${Date.now()}`,
          kind: 'external',
          displayName: value,
          ...(newChannel === 'email' ? { email: value } : newChannel === 'sms' ? { phone: value } : {}),
        }],
        entityLinks: [],
      });
      setThreads((items) => [thread, ...items]);
      setActive(thread.id);
      setRecipient(value);
      setChannel(newChannel);
      setShowNew(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!active) return setError('Select or create a conversation first.');
    if (!recipient.trim()) return setError('Enter a recipient.');
    if (!body.trim()) return setError('Enter a message.');
    setBusy(true);
    setError('');
    try {
      await sendThreadMessage(active, { channel, recipients: [recipient.trim()], body: body.trim(), subject: activeThread?.subject });
      setBody('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const statusTone = (status: CommunicationMessage['status']) => status === 'failed' ? 'text-rose-600' : ['sent', 'delivered', 'received'].includes(status) ? 'text-emerald-600' : 'text-amber-600';

  return (
    <section className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h1 className="text-2xl font-bold">Communications</h1><p className="text-sm text-gray-600">Auditable email, SMS and portal correspondence linked to operational records.</p></div><button className="rounded bg-gray-950 px-4 py-2 text-sm font-semibold text-white" onClick={beginNew}>New conversation</button></header>
      {error && <div className="flex items-center justify-between rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800"><span>{error}</span><button type="button" className="font-semibold underline" onClick={() => setError('')}>Dismiss</button></div>}
      <div className="grid min-h-[580px] overflow-hidden rounded-xl border bg-white lg:grid-cols-[320px_1fr]">
        <aside className="border-b p-2 lg:border-b-0 lg:border-r">
          <label className="block p-1 text-xs font-semibold text-gray-600">Search conversations<input value={search} onChange={(event) => setSearch(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-normal" placeholder="Subject or recipient" /></label>
          <div className="mt-2 max-h-[510px] overflow-y-auto">{filteredThreads.length ? filteredThreads.map((thread) => <button key={thread.id} onClick={() => { setActive(thread.id); const participant = thread.participants[0]; if (participant?.email) { setRecipient(participant.email); setChannel('email'); } else if (participant?.phone) { setRecipient(participant.phone); setChannel('sms'); } }} className={`mb-1 w-full rounded-lg p-3 text-left ${active === thread.id ? 'bg-gray-950 text-white' : 'hover:bg-gray-50'}`}><div className="font-medium">{thread.subject}</div><div className="mt-1 truncate text-xs opacity-70">{thread.participants.map((participant) => participant.displayName).join(', ') || 'No participants yet'}</div><div className="text-xs opacity-70">{thread.status} · {thread.lastMessageAt ? new Date(thread.lastMessageAt).toLocaleString() : 'No messages'}</div></button>) : <div className="p-6 text-center text-sm text-gray-500">No conversations match this view.</div>}</div>
        </aside>
        <div className="flex min-w-0 flex-col">
          <div className="border-b px-4 py-3"><div className="font-semibold">{activeThread?.subject || 'Select a conversation'}</div>{activeThread && <div className="text-xs text-gray-500">{activeThread.participants.map((participant) => participant.displayName).join(', ') || 'No participants recorded'}</div>}</div>
          <div className="flex-1 space-y-3 overflow-auto p-4">{active ? visible.length ? visible.map((message) => <div key={message.id} className={`max-w-2xl rounded-lg p-3 text-sm ${message.direction === 'outbound' ? 'ml-auto bg-gray-950 text-white' : 'bg-gray-100'}`}><div>{message.body}</div><div className={`mt-1 text-xs ${message.direction === 'outbound' ? 'text-white/70' : statusTone(message.status)}`}>{message.channel} · {message.status} · {new Date(message.createdAt).toLocaleString()}</div></div>) : <div className="grid h-full place-items-center text-center text-sm text-gray-500"><div><div className="font-semibold text-gray-700">No messages yet</div><div>Compose the first message below. Delivery remains subject to the configured provider.</div></div></div> : <div className="grid h-full place-items-center text-center text-sm text-gray-500">Choose a conversation or create a new one.</div>}</div>
          <div className="border-t p-4"><div className="grid gap-2 sm:grid-cols-[130px_240px_1fr]"><label className="text-xs font-semibold text-gray-600">Channel<select value={channel} onChange={(event) => setChannel(event.target.value as 'email' | 'sms' | 'portal')} className="mt-1 w-full rounded border px-3 py-2 text-sm font-normal"><option value="email">Email</option><option value="sms">SMS</option><option value="portal">Portal</option></select></label><label className="text-xs font-semibold text-gray-600">Recipient<input className="mt-1 w-full rounded border px-3 py-2 text-sm font-normal" placeholder={channel === 'email' ? 'name@example.com' : channel === 'sms' ? 'Mobile number' : 'Portal recipient'} value={recipient} onChange={(e) => setRecipient(e.target.value)} /></label><label className="text-xs font-semibold text-gray-600">Message<textarea className="mt-1 min-h-20 w-full rounded border px-3 py-2 text-sm font-normal" placeholder="Message" value={body} onChange={(e) => setBody(e.target.value)} /></label></div><button className="mt-3 rounded bg-gray-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40" onClick={() => void send()} disabled={busy || !active || !recipient.trim() || !body.trim()}>{busy ? 'Sending…' : 'Send'}</button></div>
        </div>
      </div>

      {showNew && <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="new-conversation-title"><div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl"><h2 id="new-conversation-title" className="text-lg font-bold">New conversation</h2><p className="mt-1 text-sm text-gray-500">Create the thread first; no external message is sent until you explicitly select Send.</p><div className="mt-4 space-y-3"><label className="block text-sm font-medium">Subject<input value={subject} onChange={(event) => setSubject(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" /></label><label className="block text-sm font-medium">Channel<select value={newChannel} onChange={(event) => setNewChannel(event.target.value as 'email' | 'sms' | 'portal')} className="mt-1 w-full rounded-lg border px-3 py-2"><option value="email">Email</option><option value="sms">SMS</option><option value="portal">Portal</option></select></label><label className="block text-sm font-medium">Recipient<input value={newRecipient} onChange={(event) => setNewRecipient(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" placeholder={newChannel === 'email' ? 'name@example.com' : 'Recipient'} /></label></div><div className="mt-5 flex justify-end gap-2"><button type="button" className="rounded-lg border px-4 py-2 text-sm font-semibold" onClick={() => setShowNew(false)}>Cancel</button><button type="button" disabled={busy || !subject.trim() || !newRecipient.trim()} className="rounded-lg bg-gray-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40" onClick={() => void newThread()}>{busy ? 'Creating…' : 'Create conversation'}</button></div></div></div>}
    </section>
  );
};
export default CommunicationsPage;
