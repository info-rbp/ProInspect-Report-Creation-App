import React, { useEffect, useMemo, useState } from 'react';
import {
  BadgeDollarSign,
  Building2,
  CalendarDays,
  FileText,
  History,
  Link2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Users,
  Wrench,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import type {
  ClientAccount,
  ClientContact,
  ClientDocument,
  ClientPortalPermission,
  PropertyClientRelationshipType,
  PropertyRecord,
} from '../../types/platform';
import {
  activateClient,
  createClientContact,
  createClientEngagement,
  createClientPortalUser,
  createPropertyClientRelationship,
  endPropertyClientRelationship,
  getClientOverview,
  offboardClient,
  type ClientOverview,
  updateClientAccount,
  updateClientContact,
  updateClientPortalUser,
  uploadClientDocument,
} from '../../services/platform/clientManagementService';
import { listProperties } from '../../services/platform/propertyService';

const TABS = [
  'Overview',
  'Contacts & Team',
  'Properties',
  'Engagement & Services',
  'Inspection Preferences',
  'Maintenance & Approvals',
  'Billing & Xero',
  'Documents & Agreements',
  'Orders & Bookings',
  'Portal & Access',
  'History',
] as const;
type Tab = (typeof TABS)[number];

const PORTAL_PERMISSIONS: ClientPortalPermission[] = [
  'client.properties.read',
  'client.inspections.create',
  'client.inspections.read',
  'client.reports.read',
  'client.maintenance.read',
  'client.maintenance.approve',
  'client.quotes.approve',
  'client.billing.read',
  'client.documents.read',
  'client.users.manage',
];

function label(value?: string): string {
  return (value || 'not configured')
    .replaceAll('_', ' ')
    .replace(/\b\w/gu, (character) => character.toUpperCase());
}

function MetricCard({ title, value, caption }: { title: string; value: React.ReactNode; caption?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold text-slate-400">{title}</div>
      <div className="mt-2 text-xl font-black text-slate-950">{value}</div>
      {caption && <div className="mt-1 text-xs text-slate-500">{caption}</div>}
    </div>
  );
}

const ClientWorkspacePage: React.FC = () => {
  const { clientId } = useParams<{ clientId: string }>();
  const [overview, setOverview] = useState<ClientOverview>();
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [tab, setTab] = useState<Tab>('Overview');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [contactForm, setContactForm] = useState({ name: '', email: '', phone: '', role: 'property_manager' });
  const [relationshipForm, setRelationshipForm] = useState({
    propertyId: '',
    relationshipType: 'managing_agent' as PropertyClientRelationshipType,
    contactId: '',
    approvalLimit: '',
  });
  const [engagementName, setEngagementName] = useState('');
  const [portalForm, setPortalForm] = useState({ name: '', email: '', contactId: '' });
  const [portalPermissions, setPortalPermissions] = useState<ClientPortalPermission[]>([
    'client.properties.read',
    'client.inspections.read',
    'client.reports.read',
    'client.maintenance.read',
  ]);
  const [documentType, setDocumentType] = useState<ClientDocument['type']>('service_agreement');

  const reload = async () => {
    if (!clientId) return;
    setLoading(true);
    setError('');
    try {
      const [nextOverview, nextProperties] = await Promise.all([
        getClientOverview(clientId),
        listProperties(),
      ]);
      setOverview(nextOverview);
      setProperties(nextProperties);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Client Account could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, [clientId]);

  const account = overview?.client;
  const linkedPropertyIds = useMemo(
    () => [
      ...new Set(
        (overview?.relationships || [])
          .filter((relationship) => relationship.isCurrent)
          .map((relationship) => relationship.propertyId),
      ),
    ],
    [overview?.relationships],
  );
  const linkedProperties = useMemo(
    () => properties.filter((property) => linkedPropertyIds.includes(property.id)),
    [linkedPropertyIds, properties],
  );

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await action();
      await reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Client operation failed.');
    } finally {
      setBusy(false);
    }
  };

  const saveAccount = async (updates: Partial<ClientAccount>) => {
    if (!account) return;
    await run(() => updateClientAccount(account, updates));
  };

  if (!clientId) return <div className="p-8 text-slate-500">Client identifier is missing.</div>;
  if (loading && !overview) return <div className="p-8 text-slate-500">Loading Client Account…</div>;
  if (!account || !overview) return <div className="p-8 text-rose-700">{error || 'Client Account was not found.'}</div>;

  const clientName = account.tradingName || account.legalName || account.name || 'Client';

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Client workspace</div>
          <h1 className="mt-1 text-3xl font-black text-slate-950">{clientName}</h1>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
            <span>{label(account.clientType)}</span>
            {account.abn && <span>ABN {account.abn}</span>}
            <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-700">{label(account.status)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/app/admin/clients" className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold">Back to Clients</Link>
          <button disabled={busy} onClick={() => void reload()} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold"><RefreshCw size={14} /> Refresh</button>
          {account.status !== 'active' && !['inactive', 'archived'].includes(account.status) && (
            <button disabled={busy} onClick={() => void run(() => activateClient(account))} className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">Activate Client</button>
          )}
          {account.status === 'active' && (
            <button
              disabled={busy}
              onClick={() => {
                const reason = window.prompt('Reason for offboarding this Client Account?');
                if (reason?.trim()) void run(() => offboardClient(account, reason.trim()));
              }}
              className="rounded-xl border border-rose-200 px-4 py-2 text-xs font-semibold text-rose-700"
            >
              Offboard
            </button>
          )}
        </div>
      </div>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2">
        <div className="flex min-w-max gap-1">
          {TABS.map((value) => (
            <button key={value} onClick={() => setTab(value)} className={`rounded-xl px-3 py-2 text-xs font-semibold ${tab === value ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
              {value}
            </button>
          ))}
        </div>
      </div>

      {tab === 'Overview' && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <MetricCard title="Properties" value={overview.counts.properties} caption={linkedProperties.slice(0, 2).map((property) => property.address).join(' · ') || 'No linked Properties'} />
            <MetricCard title="Active jobs" value={overview.counts.activeJobs} />
            <MetricCard title="Reports" value={overview.counts.reports} />
            <MetricCard title="Open maintenance" value={overview.counts.openMaintenance} />
            <MetricCard title="Pending requests" value={overview.counts.pendingInspectionRequests} />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-center gap-2 font-black"><Building2 size={17} /> Account details</div>
              <div className="mt-4 grid gap-2 text-sm">
                <div><span className="text-slate-400">Legal name:</span> {account.legalName}</div>
                <div><span className="text-slate-400">Primary email:</span> {account.generalEmail || account.email || 'Not configured'}</div>
                <div><span className="text-slate-400">Phone:</span> {account.mainPhone || account.phone || 'Not configured'}</div>
                <div><span className="text-slate-400">Account manager:</span> {account.internalAccountManagerUserId || 'Not assigned'}</div>
              </div>
            </section>
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-center gap-2 font-black"><ShieldCheck size={17} /> Operational readiness</div>
              <div className="mt-4 space-y-2 text-sm">
                {(account.onboardingBlockers || []).length
                  ? account.onboardingBlockers?.map((blocker) => <div key={blocker} className="rounded-lg bg-amber-50 p-2 text-amber-800">{blocker}</div>)
                  : <div className="rounded-lg bg-emerald-50 p-2 text-emerald-700">No recorded onboarding blockers.</div>}
                <div className="text-xs text-slate-400">Completed: {(account.onboardingCompletedSteps || []).join(', ') || 'Not yet recorded'}</div>
              </div>
            </section>
          </div>
        </div>
      )}

      {tab === 'Contacts & Team' && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2 font-black"><Users size={17} /> Contacts & Team</div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {overview.contacts.map((contact) => (
              <div key={contact.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div><div className="font-bold">{contact.displayName}</div><div className="text-xs text-slate-400">{contact.jobTitle || contact.roles.map(label).join(', ')}</div></div>
                  {contact.isPrimary && <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700">Primary</span>}
                </div>
                <div className="mt-3 text-xs text-slate-600">{contact.email || 'No email'}<br />{contact.mobile || contact.phone || ''}</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button disabled={busy} onClick={() => void run(() => updateClientContact(contact, { receivesReports: !contact.receivesReports }))} className="rounded-lg border border-slate-200 px-2 py-1 text-[10px]">Reports {contact.receivesReports ? '✓' : '○'}</button>
                  <button disabled={busy} onClick={() => void run(() => updateClientContact(contact, { canApproveMaintenance: !contact.canApproveMaintenance }))} className="rounded-lg border border-slate-200 px-2 py-1 text-[10px]">Approvals {contact.canApproveMaintenance ? '✓' : '○'}</button>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 grid gap-3 rounded-xl bg-slate-50 p-4 md:grid-cols-5">
            <input placeholder="Name" value={contactForm.name} onChange={(event) => setContactForm((current) => ({ ...current, name: event.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-xs" />
            <input placeholder="Email" value={contactForm.email} onChange={(event) => setContactForm((current) => ({ ...current, email: event.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-xs" />
            <input placeholder="Phone" value={contactForm.phone} onChange={(event) => setContactForm((current) => ({ ...current, phone: event.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-xs" />
            <select value={contactForm.role} onChange={(event) => setContactForm((current) => ({ ...current, role: event.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-xs">
              {['principal', 'property_manager', 'assistant_property_manager', 'portfolio_manager', 'maintenance_manager', 'accounts', 'operations', 'owner_landlord', 'owner_representative', 'strata_manager', 'other'].map((value) => <option key={value} value={value}>{label(value)}</option>)}
            </select>
            <button
              disabled={busy || !contactForm.name.trim()}
              onClick={() => void run(async () => {
                await createClientContact({
                  clientAccountId: account.id,
                  displayName: contactForm.name.trim(),
                  email: contactForm.email.trim() || undefined,
                  phone: contactForm.phone.trim() || undefined,
                  roles: [contactForm.role as ClientContact['roles'][number]],
                  isPrimary: overview.contacts.length === 0,
                  receivesReports: true,
                  receivesMaintenance: true,
                  canApproveMaintenance: ['property_manager', 'owner_landlord'].includes(contactForm.role),
                  status: 'active',
                });
                setContactForm({ name: '', email: '', phone: '', role: 'property_manager' });
              })}
              className="inline-flex items-center justify-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
            >
              <Plus size={13} /> Add contact
            </button>
          </div>
        </section>
      )}

      {tab === 'Properties' && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2 font-black"><Building2 size={17} /> Property relationships</div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {overview.relationships.filter((relationship) => relationship.isCurrent).map((relationship) => {
              const property = properties.find((candidate) => candidate.id === relationship.propertyId);
              const contact = overview.contacts.find((candidate) => candidate.id === relationship.primaryContactId);
              return (
                <div key={relationship.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex justify-between gap-3">
                    <div>
                      <Link to={`/app/admin/properties/${relationship.propertyId}`} className="font-bold text-blue-700">{property?.address || relationship.propertyId}</Link>
                      <div className="mt-1 text-xs text-slate-400">{label(relationship.relationshipType)}{contact ? ` · ${contact.displayName}` : ''}</div>
                      {relationship.propertyManagerApprovalLimit !== undefined && <div className="mt-2 text-xs text-slate-500">Approval limit ${relationship.propertyManagerApprovalLimit.toFixed(2)}</div>}
                    </div>
                    <button disabled={busy} onClick={() => void run(() => endPropertyClientRelationship(relationship))} className="h-fit rounded-lg border border-rose-200 px-2 py-1 text-[10px] font-semibold text-rose-700">End</button>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-5 grid gap-3 rounded-xl bg-slate-50 p-4 md:grid-cols-4">
            <select value={relationshipForm.propertyId} onChange={(event) => setRelationshipForm((current) => ({ ...current, propertyId: event.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-xs">
              <option value="">Select Property</option>
              {properties.filter((property) => !linkedPropertyIds.includes(property.id)).map((property) => <option key={property.id} value={property.id}>{property.address}, {property.suburb}</option>)}
            </select>
            <select value={relationshipForm.relationshipType} onChange={(event) => setRelationshipForm((current) => ({ ...current, relationshipType: event.target.value as PropertyClientRelationshipType }))} className="rounded-lg border border-slate-200 px-3 py-2 text-xs">
              {['owner', 'managing_agent', 'engaging_client', 'billing_party', 'report_recipient', 'maintenance_authority', 'strata_manager', 'owner_representative'].map((value) => <option key={value} value={value}>{label(value)}</option>)}
            </select>
            <select value={relationshipForm.contactId} onChange={(event) => setRelationshipForm((current) => ({ ...current, contactId: event.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-xs">
              <option value="">No contact</option>
              {overview.contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.displayName}</option>)}
            </select>
            <button disabled={busy || !relationshipForm.propertyId} onClick={() => void run(async () => {
              await createPropertyClientRelationship({
                propertyId: relationshipForm.propertyId,
                clientAccountId: account.id,
                relationshipType: relationshipForm.relationshipType,
                primaryContactId: relationshipForm.contactId || undefined,
                isCurrent: true,
                propertyManagerApprovalLimit: Number(relationshipForm.approvalLimit) || undefined,
              });
              setRelationshipForm({ propertyId: '', relationshipType: 'managing_agent', contactId: '', approvalLimit: '' });
            })} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">Link Property</button>
          </div>
        </section>
      )}

      {tab === 'Engagement & Services' && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2 font-black"><Link2 size={17} /> Engagements</div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {overview.engagements.map((engagement) => (
              <div key={engagement.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex justify-between"><div className="font-bold">{engagement.name}</div><span className="text-xs font-semibold text-slate-500">{label(engagement.status)}</span></div>
                <div className="mt-2 text-xs text-slate-500">{engagement.effectiveFrom || 'No start date'}{engagement.effectiveTo ? ` → ${engagement.effectiveTo}` : ''}</div>
                <div className="mt-3 flex flex-wrap gap-1">{engagement.services.filter((service) => service.active).map((service) => <span key={service.serviceCode} className="rounded-full bg-slate-100 px-2 py-1 text-[10px]">{label(service.serviceCode)}</span>)}</div>
              </div>
            ))}
          </div>
          <div className="mt-5 grid gap-3 rounded-xl bg-slate-50 p-4 md:grid-cols-[1fr_auto]">
            <input placeholder="New engagement name" value={engagementName} onChange={(event) => setEngagementName(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs" />
            <button disabled={busy || !engagementName.trim()} onClick={() => void run(async () => {
              await createClientEngagement({ clientAccountId: account.id, name: engagementName.trim(), status: 'draft', effectiveFrom: new Date().toISOString().slice(0, 10), services: [] });
              setEngagementName('');
            })} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">Add engagement</button>
          </div>
        </section>
      )}

      {tab === 'Inspection Preferences' && <PreferencesEditor account={account} busy={busy} save={saveAccount} />}
      {tab === 'Maintenance & Approvals' && <MaintenancePolicyEditor account={account} busy={busy} save={saveAccount} />}
      {tab === 'Billing & Xero' && <BillingEditor account={account} busy={busy} save={saveAccount} />}

      {tab === 'Documents & Agreements' && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2 font-black"><FileText size={17} /> Documents & Agreements</div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {overview.documents.map((document) => (
              <div key={document.id} className="rounded-xl border border-slate-200 p-4">
                <div className="font-bold">{document.title}</div>
                <div className="mt-1 text-xs text-slate-400">{label(document.type)} · {document.status} · {(document.fileSize / 1024).toFixed(0)} KB</div>
                {document.expiresAt && <div className="mt-2 text-xs text-amber-700">Expires {document.expiresAt.slice(0, 10)}</div>}
                <div className="mt-2 font-mono text-[9px] text-slate-300">SHA {document.sha256.slice(0, 16)}… · generation {document.generation}</div>
              </div>
            ))}
          </div>
          <div className="mt-5 grid gap-3 rounded-xl bg-slate-50 p-4 md:grid-cols-[240px_1fr]">
            <select value={documentType} onChange={(event) => setDocumentType(event.target.value as ClientDocument['type'])} className="rounded-lg border border-slate-200 px-3 py-2 text-xs">
              {['engagement_agreement', 'service_agreement', 'fee_schedule', 'terms_conditions', 'privacy_consent', 'authority_to_act', 'maintenance_authority', 'purchase_order', 'insurance_compliance', 'client_instructions', 'pricing_agreement', 'other'].map((value) => <option key={value} value={value}>{label(value)}</option>)}
            </select>
            <input type="file" disabled={busy} onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void run(() => uploadClientDocument(account.id, file, { type: documentType, title: file.name }));
            }} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs" />
          </div>
        </section>
      )}

      {tab === 'Orders & Bookings' && (
        <section className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard title="Pending requests" value={overview.counts.pendingInspectionRequests} />
            <MetricCard title="Active jobs" value={overview.counts.activeJobs} />
            <MetricCard title="Reports" value={overview.counts.reports} />
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2 font-black"><CalendarDays size={17} /> Recent operational activity</div>
            <div className="mt-4 divide-y divide-slate-100">
              {overview.recentJobs.map((job) => <div key={String(job.id)} className="flex justify-between gap-3 py-3 text-sm"><div><div className="font-semibold">{String(job.reportType || 'Inspection')}</div><div className="text-xs text-slate-400">{String(job.propertyId || '')}</div></div><div className="text-right text-xs"><div>{label(String(job.status || ''))}</div><div className="text-slate-400">{String(job.scheduledAt || job.updatedAt || '').slice(0, 16)}</div></div></div>)}
              {!overview.recentJobs.length && <div className="py-8 text-center text-sm text-slate-400">No Inspection Jobs yet.</div>}
            </div>
          </div>
        </section>
      )}

      {tab === 'Portal & Access' && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2 font-black"><ShieldCheck size={17} /> Client Portal & Access</div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {overview.portalUsers.map((user) => (
              <div key={user.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex justify-between"><div><div className="font-bold">{user.displayName}</div><div className="text-xs text-slate-400">{user.email}</div></div><span className="text-xs font-semibold">{label(user.status)}</span></div>
                <div className="mt-3 flex flex-wrap gap-1">{user.permissions.map((permission) => <span key={permission} className="rounded-full bg-slate-100 px-2 py-1 text-[9px]">{permission}</span>)}</div>
                {user.status !== 'revoked' && <button disabled={busy} onClick={() => void run(() => updateClientPortalUser(user, { status: 'revoked' }))} className="mt-3 rounded-lg border border-rose-200 px-2 py-1 text-[10px] font-semibold text-rose-700">Revoke access</button>}
              </div>
            ))}
          </div>
          <div className="mt-5 space-y-3 rounded-xl bg-slate-50 p-4">
            <div className="grid gap-3 md:grid-cols-3">
              <input placeholder="Name" value={portalForm.name} onChange={(event) => setPortalForm((current) => ({ ...current, name: event.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-xs" />
              <input placeholder="Email" type="email" value={portalForm.email} onChange={(event) => setPortalForm((current) => ({ ...current, email: event.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-xs" />
              <select value={portalForm.contactId} onChange={(event) => setPortalForm((current) => ({ ...current, contactId: event.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-xs"><option value="">No linked contact</option>{overview.contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.displayName}</option>)}</select>
            </div>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {PORTAL_PERMISSIONS.map((permission) => <label key={permission} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 text-[10px]"><input type="checkbox" checked={portalPermissions.includes(permission)} onChange={() => setPortalPermissions((current) => current.includes(permission) ? current.filter((value) => value !== permission) : [...current, permission])} />{permission}</label>)}
            </div>
            <button disabled={busy || !portalForm.email.trim()} onClick={() => void run(async () => {
              await createClientPortalUser({
                clientAccountId: account.id,
                contactId: portalForm.contactId || undefined,
                email: portalForm.email.trim().toLowerCase(),
                displayName: portalForm.name.trim() || portalForm.email.trim(),
                permissions: portalPermissions,
                propertyIds: linkedPropertyIds,
                status: 'invited',
                invitationExpiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
              });
              setPortalForm({ name: '', email: '', contactId: '' });
            })} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">Create portal invitation record</button>
          </div>
        </section>
      )}

      {tab === 'History' && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2 font-black"><History size={17} /> Client history</div>
          <div className="mt-4 divide-y divide-slate-100">
            {overview.timeline.map((event) => <div key={event.id} className="grid gap-2 py-3 md:grid-cols-[180px_180px_1fr]"><div className="text-xs text-slate-400">{new Date(event.occurredAt).toLocaleString()}</div><div className="text-xs font-bold text-slate-600">{label(event.type)}</div><div className="text-sm text-slate-700">{event.summary}</div></div>)}
            {!overview.timeline.length && <div className="py-8 text-center text-sm text-slate-400">No Client timeline events have been recorded yet.</div>}
          </div>
        </section>
      )}
    </div>
  );
};

function PreferencesEditor({ account, busy, save }: { account: ClientAccount; busy: boolean; save: (updates: Partial<ClientAccount>) => Promise<void> }) {
  const [notice, setNotice] = useState(String(account.inspectionPreferences?.minimumBookingNoticeHours || 48));
  const [duration, setDuration] = useState(String(account.inspectionPreferences?.defaultAppointmentDurationMinutes || 60));
  const [frequency, setFrequency] = useState(String(account.inspectionPreferences?.routineFrequencyMonths || 3));
  const [notes, setNotes] = useState(account.inspectionPreferences?.bookingNotes || '');
  return <section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center gap-2 font-black"><CalendarDays size={17} /> Inspection preferences</div><div className="mt-4 grid gap-3 md:grid-cols-2"><input value={notice} onChange={(event) => setNotice(event.target.value)} placeholder="Minimum booking notice hours" className="rounded-xl border border-slate-200 px-3 py-2 text-sm" /><input value={duration} onChange={(event) => setDuration(event.target.value)} placeholder="Default duration minutes" className="rounded-xl border border-slate-200 px-3 py-2 text-sm" /><input value={frequency} onChange={(event) => setFrequency(event.target.value)} placeholder="Routine frequency months" className="rounded-xl border border-slate-200 px-3 py-2 text-sm" /><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Booking instructions" className="rounded-xl border border-slate-200 p-3 text-sm" /><button disabled={busy} onClick={() => void save({ inspectionPreferences: { ...account.inspectionPreferences, minimumBookingNoticeHours: Number(notice) || undefined, defaultAppointmentDurationMinutes: Number(duration) || undefined, routineFrequencyMonths: Number(frequency) || undefined, bookingNotes: notes || undefined } })} className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white md:col-span-2">Save inspection preferences</button></div></section>;
}

function MaintenancePolicyEditor({ account, busy, save }: { account: ClientAccount; busy: boolean; save: (updates: Partial<ClientAccount>) => Promise<void> }) {
  const [manager, setManager] = useState(String(account.maintenancePolicy?.propertyManagerApprovalLimit ?? ''));
  const [landlord, setLandlord] = useState(String(account.maintenancePolicy?.landlordApprovalThreshold ?? ''));
  const [emergency, setEmergency] = useState(String(account.maintenancePolicy?.emergencyAuthorisationLimit ?? ''));
  const [second, setSecond] = useState(String(account.maintenancePolicy?.secondApprovalThreshold ?? ''));
  return <section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center gap-2 font-black"><Wrench size={17} /> Maintenance authority</div><div className="mt-4 grid gap-3 md:grid-cols-2"><input value={manager} onChange={(event) => setManager(event.target.value)} placeholder="Property Manager approval limit" className="rounded-xl border border-slate-200 px-3 py-2 text-sm" /><input value={landlord} onChange={(event) => setLandlord(event.target.value)} placeholder="Landlord approval threshold" className="rounded-xl border border-slate-200 px-3 py-2 text-sm" /><input value={emergency} onChange={(event) => setEmergency(event.target.value)} placeholder="Emergency limit" className="rounded-xl border border-slate-200 px-3 py-2 text-sm" /><input value={second} onChange={(event) => setSecond(event.target.value)} placeholder="Second approval threshold" className="rounded-xl border border-slate-200 px-3 py-2 text-sm" /><button disabled={busy} onClick={() => void save({ maintenancePolicy: { ...account.maintenancePolicy, propertyManagerApprovalLimit: Number(manager) || undefined, landlordApprovalThreshold: Number(landlord) || undefined, emergencyAuthorisationLimit: Number(emergency) || undefined, secondApprovalThreshold: Number(second) || undefined } })} className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white md:col-span-2">Save approval policy</button></div></section>;
}

function BillingEditor({ account, busy, save }: { account: ClientAccount; busy: boolean; save: (updates: Partial<ClientAccount>) => Promise<void> }) {
  const [email, setEmail] = useState(account.billingProfile?.invoiceRecipientEmail || account.accountsEmail || '');
  const [terms, setTerms] = useState(String(account.billingProfile?.paymentTermsDays || 14));
  const [xero, setXero] = useState(account.billingProfile?.xeroContactId || account.externalReferences?.xeroContactId || '');
  return <section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center gap-2 font-black"><BadgeDollarSign size={17} /> Billing & Xero</div><div className="mt-4 grid gap-3 md:grid-cols-2"><input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Invoice recipient" className="rounded-xl border border-slate-200 px-3 py-2 text-sm" /><input value={terms} onChange={(event) => setTerms(event.target.value)} placeholder="Payment terms days" className="rounded-xl border border-slate-200 px-3 py-2 text-sm" /><input value={xero} onChange={(event) => setXero(event.target.value)} placeholder="Xero Contact ID" className="rounded-xl border border-slate-200 px-3 py-2 text-sm md:col-span-2" /><button disabled={busy} onClick={() => void save({ accountsEmail: email || undefined, billingProfile: { method: account.billingProfile?.method || 'invoice_per_inspection', ...account.billingProfile, invoiceRecipientEmail: email || undefined, paymentTermsDays: Number(terms) || undefined, xeroContactId: xero || undefined }, externalReferences: { ...account.externalReferences, xeroContactId: xero || undefined } })} className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white md:col-span-2">Save billing configuration</button></div></section>;
}

export default ClientWorkspacePage;
