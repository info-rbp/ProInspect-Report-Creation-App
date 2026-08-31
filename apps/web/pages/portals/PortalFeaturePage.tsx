import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, ChevronDown, ExternalLink, Loader2, MessageSquare, Plus, RefreshCw, Send, ShieldAlert } from 'lucide-react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import type { PortalId } from '@pcr/domain';
import AccessDenied from '../../components/layout/AccessDenied';
import { useAuth } from '../../contexts/AuthContext';
import {
  createPortalResource,
  listConversationMessages,
  listPortalResource,
  sendConversationMessage,
  signOutPortalContractor,
  transitionPortalResource,
  type PortalResourceContext,
  type PortalResourceRecord,
} from '../../services/portalResourceApi';
import { canOpenPortal, portalDefinition } from '../../services/platform/portalAccess';
import { contextLabel, portalContexts, type PortalContext } from '../../services/platform/portalEntitlementService';
import { portalFeature, type PortalCreateField, type PortalResourceBinding } from '../../services/platform/portalFeatureRegistry';

interface ResourceState {
  loading: boolean;
  records: PortalResourceRecord[];
  error?: string;
}

const styles = {
  page: { minHeight: '100vh', background: '#f6f7f9', color: '#111827' },
  header: { background: '#111827', color: '#fff', padding: '20px 28px', borderBottom: '1px solid #273244' },
  shell: { maxWidth: 1440, margin: '0 auto' },
  content: { maxWidth: 1440, margin: '0 auto', padding: 28 },
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 18 },
  button: { border: '1px solid #d1d5db', borderRadius: 8, background: '#fff', padding: '9px 12px', cursor: 'pointer', color: '#111827', fontWeight: 600, fontSize: 13 },
  primary: { border: '1px solid #4338ca', borderRadius: 8, background: '#4338ca', padding: '9px 12px', cursor: 'pointer', color: '#fff', fontWeight: 600, fontSize: 13 },
  input: { width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: '9px 10px', font: 'inherit', boxSizing: 'border-box' as const },
  muted: { color: '#6b7280', fontSize: 13 },
} as const;

function recordTitle(record: PortalResourceRecord): string {
  for (const key of ['title', 'name', 'summary', 'subject', 'companyName', 'description', 'unitNumber', 'category', 'requestType', 'eventType']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return record.id;
}

function displayValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function recordDetails(record: PortalResourceRecord): Array<[string, string]> {
  const hidden = new Set(['id', 'agencyId', 'version', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'legacySystem', 'legacyId']);
  return Object.entries(record)
    .filter(([key, value]) => !hidden.has(key) && value !== undefined && value !== null && value !== '')
    .slice(0, 8)
    .map(([key, value]) => [key.replace(/([a-z])([A-Z])/gu, '$1 $2'), displayValue(value)]);
}

function contextFor(binding: PortalResourceBinding, selected: PortalContext | undefined, searchParams: URLSearchParams): PortalResourceContext {
  const managedSiteId = selected?.managedSiteId ?? searchParams.get('site') ?? undefined;
  const clientAccountId = selected?.clientAccountId ?? searchParams.get('client') ?? undefined;
  const propertyId = selected?.propertyId ?? searchParams.get('property') ?? undefined;
  const contractorId = selected?.contractorId ?? searchParams.get('contractor') ?? undefined;
  if (binding.context === 'site') return { ...(managedSiteId ? { managedSiteId } : {}) };
  if (binding.context === 'client') return { ...(clientAccountId ? { clientAccountId } : {}) };
  if (binding.context === 'contractor') return { ...(contractorId ? { contractorId } : {}), ...(managedSiteId ? { managedSiteId } : {}) };
  if (binding.context === 'property') return { ...(propertyId ? { propertyId } : {}), ...(managedSiteId ? { managedSiteId } : {}) };
  return {};
}

function missingContext(binding: PortalResourceBinding, context: PortalResourceContext): string | undefined {
  if (binding.context === 'site' && !context.managedSiteId) return 'A managed-site entitlement is required.';
  if (binding.context === 'client' && !context.clientAccountId) return 'A client-account entitlement is required.';
  if (binding.context === 'contractor' && !context.contractorId) return 'A contractor entitlement is required.';
  if (binding.context === 'property' && !context.propertyId) return 'A property entitlement is required.';
  return undefined;
}

function castFormValue(field: PortalCreateField, raw: FormDataEntryValue | null): unknown {
  if (field.type === 'checkbox') return raw === 'on';
  if (raw === null) return undefined;
  const value = String(raw).trim();
  if (!value) return undefined;
  if (field.type === 'number') return Number(value);
  if (field.type === 'datetime-local') return new Date(value).toISOString();
  return value;
}

const ConversationPanel: React.FC<{ conversation: PortalResourceRecord }> = ({ conversation }) => {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<PortalResourceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true); setError(undefined);
    try { setMessages(await listConversationMessages(conversation.id)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Messages could not be loaded.'); }
    finally { setLoading(false); }
  }, [conversation.id]);

  const toggle = async () => {
    const next = !open; setOpen(next);
    if (next && messages.length === 0) await load();
  };

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!body.trim()) return;
    setLoading(true); setError(undefined);
    try { await sendConversationMessage(conversation.id, body.trim()); setBody(''); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Message could not be sent.'); setLoading(false); }
  };

  return (
    <div style={{ marginTop: 12, borderTop: '1px solid #e5e7eb', paddingTop: 10 }}>
      <button type="button" onClick={toggle} style={{ ...styles.button, padding: '6px 9px' }}><MessageSquare size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />{open ? 'Hide messages' : 'Open messages'}</button>
      {open && <div style={{ marginTop: 10 }}>
        {loading && <div style={styles.muted}>Loading conversation…</div>}
        {error && <div style={{ color: '#b91c1c', fontSize: 13 }}>{error}</div>}
        {messages.map((message) => <div key={message.id} style={{ padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}><strong style={{ fontSize: 12 }}>{String(message.senderId ?? message.senderType ?? 'User')}</strong><div style={{ marginTop: 3 }}>{String(message.body ?? '')}</div></div>)}
        <form onSubmit={send} style={{ display: 'flex', gap: 8, marginTop: 10 }}><input value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write a message" style={styles.input} /><button style={styles.primary} disabled={loading || !body.trim()}><Send size={15} /></button></form>
      </div>}
    </div>
  );
};

const PortalFeaturePage: React.FC<{ portalId: PortalId }> = ({ portalId }) => {
  const { featureSlug = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { userProfile, portalEntitlements, refreshPortalEntitlements } = useAuth();
  const role = userProfile?.role as string | undefined;
  const feature = portalFeature(portalId, featureSlug);
  const portal = portalDefinition(portalId);
  const contexts = useMemo(() => portalContexts(portalEntitlements, portalId), [portalEntitlements, portalId]);
  const contextId = searchParams.get('context');
  const selectedContext = contexts.find((item) => item.entitlementId === contextId) ?? contexts[0];
  const [resourceStates, setResourceStates] = useState<Record<string, ResourceState>>({});
  const [activeKey, setActiveKey] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [transitionValues, setTransitionValues] = useState<Record<string, string>>({});

  const resources = feature?.resources ?? [];
  const activeBinding = resources.find((item) => `${item.source}:${item.resource}` === activeKey) ?? resources[0];

  const loadResources = useCallback(async () => {
    if (!feature || resources.length === 0) return;
    const next: Record<string, ResourceState> = {};
    for (const binding of resources) {
      const key = `${binding.source}:${binding.resource}`;
      const context = contextFor(binding, selectedContext, searchParams);
      const missing = missingContext(binding, context);
      if (missing) { next[key] = { loading: false, records: [], error: missing }; continue; }
      next[key] = { loading: true, records: [] };
    }
    setResourceStates(next);
    await Promise.all(resources.map(async (binding) => {
      const key = `${binding.source}:${binding.resource}`;
      const context = contextFor(binding, selectedContext, searchParams);
      if (missingContext(binding, context)) return;
      try {
        const records = await listPortalResource(binding.source, binding.resource, context);
        setResourceStates((current) => ({ ...current, [key]: { loading: false, records } }));
      } catch (err) {
        setResourceStates((current) => ({ ...current, [key]: { loading: false, records: [], error: err instanceof Error ? err.message : 'The resource could not be loaded.' } }));
      }
    }));
  }, [feature, resources, searchParams, selectedContext]);

  useEffect(() => { void loadResources(); }, [loadResources]);

  if (!feature) return <Navigate to={`/${portalId}`} replace />;
  if (!canOpenPortal(role, portalId, portalEntitlements)) return <AccessDenied />;
  if (feature.kind === 'internal' && feature.internalPath) return <Navigate to={feature.internalPath} replace />;
  if (feature.kind === 'client-workspace') {
    const clientAccountId = selectedContext?.clientAccountId ?? searchParams.get('client');
    if (clientAccountId) return <Navigate to={`/client-portal/${encodeURIComponent(clientAccountId)}`} replace />;
  }

  const activeResourceKey = activeBinding ? `${activeBinding.source}:${activeBinding.resource}` : undefined;
  const activeState = activeResourceKey ? resourceStates[activeResourceKey] : undefined;

  const changeContext = (entitlementId: string) => {
    const next = new URLSearchParams(searchParams);
    if (entitlementId) next.set('context', entitlementId); else next.delete('context');
    setSearchParams(next);
  };

  const createRecord = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeBinding || !feature.createFields?.length) return;
    const context = contextFor(activeBinding, selectedContext, searchParams);
    const missing = missingContext(activeBinding, context);
    if (missing) { setActionError(missing); return; }
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(feature.createFields.flatMap((field) => {
      const value = castFormValue(field, form.get(field.name));
      return value === undefined ? [] : [[field.name, value]];
    }));
    setSubmitting(true); setActionError(undefined);
    try { await createPortalResource(activeBinding.source, activeBinding.resource, body, context); event.currentTarget.reset(); await loadResources(); }
    catch (err) { setActionError(err instanceof Error ? err.message : 'The record could not be created.'); }
    finally { setSubmitting(false); }
  };

  const transitionRecord = async (record: PortalResourceRecord) => {
    if (!feature.transitionResource || !record.version) return;
    const status = transitionValues[record.id];
    if (!status) return;
    setSubmitting(true); setActionError(undefined);
    try { await transitionPortalResource(feature.transitionResource, record.id, record.version, status); await loadResources(); }
    catch (err) { setActionError(err instanceof Error ? err.message : 'The lifecycle action could not be completed.'); }
    finally { setSubmitting(false); }
  };

  const signOut = async (record: PortalResourceRecord) => {
    if (!record.version) return;
    const keyIssued = Boolean(record.accessItemIdentifier || record.accessItemType);
    const keyReturned = !keyIssued || window.confirm('Have all keys/access items been returned?');
    const overrideReason = keyIssued && !keyReturned ? window.prompt('A key/access item remains outstanding. Enter the Building Manager override reason:') ?? undefined : undefined;
    if (keyIssued && !keyReturned && !overrideReason?.trim()) return;
    const signoutNotes = window.prompt('Optional sign-out notes:') ?? undefined;
    setSubmitting(true); setActionError(undefined);
    try { await signOutPortalContractor(record.id, record.version, { keyIssued, keyReturned, ...(overrideReason ? { overrideReason } : {}), ...(signoutNotes ? { signoutNotes } : {}) }); await loadResources(); }
    catch (err) { setActionError(err instanceof Error ? err.message : 'Sign-out could not be completed.'); }
    finally { setSubmitting(false); }
  };

  const redeemOffer = async (record: PortalResourceRecord) => {
    const managedSiteId = selectedContext?.managedSiteId;
    if (!managedSiteId) { setActionError('A managed-site entitlement is required to redeem an offer.'); return; }
    setSubmitting(true); setActionError(undefined);
    try { await createPortalResource('platform', 'offer-redemptions', { offerId: record.id }, { managedSiteId }); await loadResources(); }
    catch (err) { setActionError(err instanceof Error ? err.message : 'The offer could not be redeemed.'); }
    finally { setSubmitting(false); }
  };

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <div style={styles.shell}>
          <Link to={`/${portalId}${selectedContext ? `?context=${encodeURIComponent(selectedContext.entitlementId)}` : ''}`} style={{ color: '#cbd5e1', textDecoration: 'none', fontSize: 13 }}><ArrowLeft size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />{portal.name}</Link>
          <h1 style={{ margin: '8px 0 0', fontSize: 26 }}>{feature.label}</h1>
          <p style={{ margin: '7px 0 0', color: '#cbd5e1' }}>{feature.summary}</p>
        </div>
      </header>

      <section style={styles.content}>
        <div style={{ ...styles.card, marginBottom: 18, display: 'flex', gap: 14, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div>
            <strong>Workspace scope</strong>
            <div style={{ ...styles.muted, marginTop: 4 }}>{selectedContext ? contextLabel(selectedContext) : 'No scoped portal entitlement selected.'}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {contexts.length > 1 && <select value={selectedContext?.entitlementId ?? ''} onChange={(event) => changeContext(event.target.value)} style={{ ...styles.input, width: 280 }}><option value="">Choose workspace</option>{contexts.map((item) => <option key={item.entitlementId} value={item.entitlementId}>{contextLabel(item)}</option>)}</select>}
            <button type="button" onClick={() => void refreshPortalEntitlements().then(loadResources)} style={styles.button}><RefreshCw size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />Refresh</button>
          </div>
        </div>

        {feature.kind === 'client-workspace' && !selectedContext?.clientAccountId && <div style={{ ...styles.card, borderColor: '#f59e0b' }}><ShieldAlert size={20} /><h2>Client scope required</h2><p style={styles.muted}>This account needs an active client portal entitlement before portfolio records can be opened.</p></div>}

        {feature.kind === 'profile' && <div style={styles.card}><h2 style={{ marginTop: 0 }}>Account</h2><dl style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 8 }}><dt>Email</dt><dd>{userProfile?.email ?? '—'}</dd><dt>Name</dt><dd>{userProfile?.displayName ?? '—'}</dd><dt>Agency</dt><dd>{userProfile?.agencyId ?? '—'}</dd><dt>Base role</dt><dd>{role ?? '—'}</dd><dt>Portal entitlements</dt><dd>{portalEntitlements.length}</dd></dl></div>}

        {feature.kind === 'quick-actions' && <div style={{ ...styles.card, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 10 }}>{feature.quickActions?.map((slug) => <Link key={slug} to={`/${portalId}/${slug}${selectedContext ? `?context=${encodeURIComponent(selectedContext.entitlementId)}` : ''}`} style={{ ...styles.card, textDecoration: 'none', color: '#111827' }}><Plus size={18} /><strong style={{ display: 'block', marginTop: 8 }}>{portalFeature(portalId, slug)?.label ?? slug}</strong></Link>)}</div>}

        {(feature.kind === 'dashboard' || feature.kind === 'resource') && <>
          {resources.length > 1 && <nav style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>{resources.map((binding) => { const key = `${binding.source}:${binding.resource}`; return <button type="button" key={key} onClick={() => setActiveKey(key)} style={key === activeResourceKey ? styles.primary : styles.button}>{binding.label} {resourceStates[key] && !resourceStates[key].loading ? `(${resourceStates[key].records.length})` : ''}</button>; })}</nav>}

          {feature.kind === 'dashboard' && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 12, marginBottom: 18 }}>{resources.map((binding) => { const key = `${binding.source}:${binding.resource}`; const state = resourceStates[key]; return <div key={key} style={styles.card}><div style={styles.muted}>{binding.label}</div><div style={{ fontSize: 30, fontWeight: 700, marginTop: 8 }}>{state?.loading ? <Loader2 size={22} /> : state?.error ? '—' : state?.records.length ?? 0}</div>{state?.error && <div style={{ color: '#b91c1c', fontSize: 12, marginTop: 6 }}>{state.error}</div>}</div>; })}</div>}

          {feature.kind === 'resource' && activeBinding && <div style={{ display: 'grid', gridTemplateColumns: feature.createFields?.length ? 'minmax(0,2fr) minmax(300px,1fr)' : '1fr', gap: 18, alignItems: 'start' }}>
            <div style={styles.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 12 }}><div><h2 style={{ margin: 0, fontSize: 18 }}>{activeBinding.label}</h2><div style={{ ...styles.muted, marginTop: 4 }}>{activeState?.records.length ?? 0} records in the permitted scope</div></div><button type="button" style={styles.button} onClick={() => void loadResources()}><RefreshCw size={14} /></button></div>
              {activeState?.loading && <p style={styles.muted}>Loading records…</p>}
              {activeState?.error && <div style={{ color: '#b91c1c', background: '#fef2f2', padding: 12, borderRadius: 8 }}>{activeState.error}</div>}
              {!activeState?.loading && !activeState?.error && activeState?.records.length === 0 && <p style={styles.muted}>No records are currently visible in this workspace.</p>}
              <div style={{ display: 'grid', gap: 10 }}>
                {activeState?.records.map((record) => <article key={record.id} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><strong>{recordTitle(record)}</strong><span style={{ ...styles.muted, whiteSpace: 'nowrap' }}>{String(record.status ?? record.approvalStatus ?? record.bookingState ?? '')}</span></div>
                  <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(120px,180px) 1fr', gap: '5px 10px', margin: '10px 0 0', fontSize: 13 }}>{recordDetails(record).map(([key, value]) => <React.Fragment key={key}><dt style={{ color: '#6b7280', textTransform: 'capitalize' }}>{key}</dt><dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{value}</dd></React.Fragment>)}</dl>
                  {feature.transitionResource === activeBinding.resource && record.version && <div style={{ display: 'flex', gap: 8, marginTop: 12 }}><select value={transitionValues[record.id] ?? ''} onChange={(event) => setTransitionValues((current) => ({ ...current, [record.id]: event.target.value }))} style={{ ...styles.input, maxWidth: 260 }}><option value="">Choose lifecycle action</option>{feature.transitionStatuses?.map((status) => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}</select><button type="button" disabled={submitting || !transitionValues[record.id]} style={styles.button} onClick={() => void transitionRecord(record)}>Apply</button></div>}
                  {portalId === 'contractor' && activeBinding.resource === 'contractor-attendance' && !record.checkedOutAt && record.version && <button type="button" onClick={() => void signOut(record)} disabled={submitting} style={{ ...styles.button, marginTop: 12 }}><CheckCircle2 size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />Sign out</button>}
                  {portalId === 'resident' && activeBinding.resource === 'offers' && <button type="button" onClick={() => void redeemOffer(record)} disabled={submitting} style={{ ...styles.primary, marginTop: 12 }}>Redeem offer</button>}
                  {activeBinding.resource === 'conversations' && <ConversationPanel conversation={record} />}
                </article>)}
              </div>
            </div>

            {feature.createFields?.length && <aside style={styles.card}><h2 style={{ marginTop: 0, fontSize: 18 }}>Create</h2><p style={styles.muted}>New records are submitted through the canonical API and audited server-side.</p><form onSubmit={createRecord} style={{ display: 'grid', gap: 11 }}>{feature.createFields.map((field) => <label key={field.name} style={{ fontSize: 13, fontWeight: 600 }}>{field.label}{field.type === 'textarea' ? <textarea name={field.name} required={field.required} placeholder={field.placeholder} rows={4} style={{ ...styles.input, marginTop: 5, resize: 'vertical' }} /> : field.type === 'checkbox' ? <input name={field.name} type="checkbox" style={{ marginLeft: 8 }} /> : <input name={field.name} type={field.type ?? 'text'} required={field.required} placeholder={field.placeholder} style={{ ...styles.input, marginTop: 5 }} />}</label>)}{actionError && <div style={{ color: '#b91c1c', fontSize: 13 }}>{actionError}</div>}<button disabled={submitting} style={styles.primary}>{submitting ? 'Saving…' : 'Create record'}</button></form></aside>}
          </div>}
        </>}

        {actionError && feature.kind !== 'resource' && <div style={{ marginTop: 14, color: '#b91c1c' }}>{actionError}</div>}
        <div style={{ marginTop: 22 }}><Link to={`/${portalId}`} style={{ color: '#4338ca', textDecoration: 'none', fontWeight: 600 }}>Back to {portal.name}</Link> <ChevronDown size={12} style={{ transform: 'rotate(90deg)' }} /></div>
      </section>
    </main>
  );
};

export default PortalFeaturePage;
