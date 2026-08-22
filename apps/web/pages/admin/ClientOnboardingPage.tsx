import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, FileText, Save } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import {
  CLIENT_DOCUMENT_TYPES,
  CLIENT_PORTAL_PERMISSIONS,
  evaluateClientOnboarding,
  type ClientAccount,
  type ClientAccountType,
  type ClientContact,
  type ClientDocumentType,
  type ClientEngagement,
  type ClientEntityType,
  type ClientPortalPermission,
  type ClientServiceCode,
  type PropertyClientRelationshipType,
  type PropertyRecord,
} from '../../types/platform';
import {
  activateClient,
  checkClientDuplicates,
  createClientAccount,
  createClientContact,
  createClientEngagement,
  createClientPortalUser,
  createPropertyClientRelationship,
  updateClientAccount,
  uploadClientDocument,
} from '../../services/platform/clientManagementService';
import { listProperties } from '../../services/platform/propertyService';

const STEPS = [
  'Identity', 'Contacts', 'Engagement & Services', 'Commercial Terms', 'Operational Preferences',
  'Maintenance & Approvals', 'Properties', 'Documents', 'Portal & Permissions', 'Review',
] as const;

const SERVICE_OPTIONS: Array<[ClientServiceCode, string]> = [
  ['entry_inspection', 'Entry PCR'], ['routine_inspection', 'Routine Inspection'], ['exit_inspection', 'Exit Inspection'],
  ['comparison_report', 'Inspection Comparison'], ['maintenance_follow_up', 'Maintenance Follow-Up'],
  ['maintenance_identification', 'Automatic Maintenance Identification'], ['automatic_pricing', 'Automatic Pricing'],
  ['maintenance_quoting', 'Maintenance Quoting'], ['contractor_coordination', 'Contractor Coordination'],
  ['completion_verification', 'Completion Verification'],
];

function fieldClass(): string {
  return 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-400';
}

const ClientOnboardingPage: React.FC = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [duplicateWarning, setDuplicateWarning] = useState('');
  const [files, setFiles] = useState<Array<{ file: File; type: ClientDocumentType }>>([]);
  const [selectedServices, setSelectedServices] = useState<ClientServiceCode[]>(['entry_inspection', 'routine_inspection', 'exit_inspection']);
  const [portalPermissions, setPortalPermissions] = useState<ClientPortalPermission[]>(['client.properties.read', 'client.inspections.read', 'client.reports.read', 'client.maintenance.read']);
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<string[]>([]);

  const [form, setForm] = useState({
    legalName: '', tradingName: '', clientType: 'property_management_firm' as ClientAccountType,
    entityType: 'property_management_agency' as ClientEntityType, abn: '', acn: '', website: '',
    businessAddress: '', postalAddress: '', timezone: 'Australia/Perth', mainPhone: '', generalEmail: '',
    accountsEmail: '', maintenanceEmail: '', emergencyPhone: '', contactName: '', contactEmail: '', contactPhone: '',
    contactJobTitle: '', engagementName: 'Standard Service Agreement', effectiveFrom: new Date().toISOString().slice(0, 10),
    billingMethod: 'invoice_per_inspection', paymentTermsDays: '14', invoiceRecipientEmail: '', purchaseOrderRequired: false,
    pricingProfile: 'standard', preferredTimeWindow: 'business_hours', minimumBookingNoticeHours: '48',
    defaultAppointmentDurationMinutes: '60', directBookingAllowed: true, tenantNotificationRequired: true,
    routineFrequencyMonths: '3', autoScheduleRecurringInspections: false, bookingNotes: '',
    propertyManagerApprovalLimit: '500', landlordApprovalThreshold: '500', emergencyAuthorisationLimit: '1500',
    secondApprovalThreshold: '', replacementOwnerApproval: true, capitalOwnerApproval: true, cosmeticOwnerApproval: true,
    relationshipType: 'managing_agent' as PropertyClientRelationshipType, propertyApprovalLimit: '',
    portalName: '', portalEmail: '', notes: '',
  });

  useEffect(() => { void listProperties().then(setProperties).catch(() => setProperties([])); }, []);

  useEffect(() => {
    if (!form.legalName.trim()) { setDuplicateWarning(''); return; }
    const timer = window.setTimeout(() => {
      void checkClientDuplicates({ legalName: form.legalName, tradingName: form.tradingName || undefined, abn: form.abn || undefined, acn: form.acn || undefined, primaryEmail: form.contactEmail || form.generalEmail || undefined })
        .then((matches) => setDuplicateWarning(matches[0] && matches[0].score >= 0.5 ? `Possible existing Client (${Math.round(matches[0].score * 100)}% match): ${matches[0].reasons.join(', ')}` : ''))
        .catch(() => setDuplicateWarning(''));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [form.abn, form.acn, form.contactEmail, form.generalEmail, form.legalName, form.tradingName]);

  const previewAccount = useMemo<Partial<ClientAccount>>(() => ({
    legalName: form.legalName, tradingName: form.tradingName || undefined, clientType: form.clientType, entityType: form.entityType,
    billingProfile: form.billingMethod ? { method: form.billingMethod as ClientAccount['billingProfile'] extends infer T ? T extends { method: infer M } ? M : never : never } : undefined,
    inspectionPreferences: { preferredTimeWindow: form.preferredTimeWindow as 'morning' | 'afternoon' | 'business_hours' | 'any' },
    maintenancePolicy: {},
  }), [form]);
  const previewContacts = useMemo<ClientContact[]>(() => form.contactName ? [{ id: 'preview-contact', agencyId: '', clientAccountId: 'preview', displayName: form.contactName, email: form.contactEmail || undefined, phone: form.contactPhone || undefined, roles: form.clientType === 'property_management_firm' ? ['property_manager'] : ['owner_landlord'], isPrimary: true, status: 'active', createdAt: '', updatedAt: '' }] : [], [form.clientType, form.contactEmail, form.contactName, form.contactPhone]);
  const previewEngagements = useMemo<ClientEngagement[]>(() => selectedServices.length ? [{ id: 'preview-engagement', agencyId: '', clientAccountId: 'preview', name: form.engagementName, status: 'draft', services: selectedServices.map((serviceCode) => ({ serviceCode, active: true })), createdAt: '', updatedAt: '' }] : [], [form.engagementName, selectedServices]);
  const readiness = evaluateClientOnboarding(previewAccount, previewContacts, previewEngagements);

  const set = (key: keyof typeof form, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));
  const toggleService = (service: ClientServiceCode) => setSelectedServices((current) => current.includes(service) ? current.filter((value) => value !== service) : [...current, service]);
  const togglePortalPermission = (permission: ClientPortalPermission) => setPortalPermissions((current) => current.includes(permission) ? current.filter((value) => value !== permission) : [...current, permission]);
  const toggleProperty = (propertyId: string) => setSelectedPropertyIds((current) => current.includes(propertyId) ? current.filter((value) => value !== propertyId) : [...current, propertyId]);

  const save = async () => {
    setBusy(true); setError('');
    try {
      if (!form.legalName.trim()) throw new Error('Legal name is required.');
      if (!form.contactName.trim()) throw new Error('A primary contact is required.');
      const account = await createClientAccount({
        legalName: form.legalName.trim(), tradingName: form.tradingName.trim() || undefined, clientType: form.clientType,
        entityType: form.entityType, abn: form.abn.trim() || undefined, acn: form.acn.trim() || undefined,
        website: form.website.trim() || undefined, businessAddress: form.businessAddress.trim() || undefined,
        postalAddress: form.postalAddress.trim() || undefined, timezone: form.timezone.trim() || undefined,
        mainPhone: form.mainPhone.trim() || form.contactPhone.trim() || undefined,
        generalEmail: form.generalEmail.trim() || form.contactEmail.trim() || undefined,
        accountsEmail: form.accountsEmail.trim() || undefined, maintenanceEmail: form.maintenanceEmail.trim() || undefined,
        emergencyPhone: form.emergencyPhone.trim() || undefined,
        billingProfile: {
          method: form.billingMethod as NonNullable<ClientAccount['billingProfile']>['method'],
          invoiceRecipientEmail: form.invoiceRecipientEmail.trim() || form.accountsEmail.trim() || form.contactEmail.trim() || undefined,
          paymentTermsDays: Number(form.paymentTermsDays) || undefined,
          purchaseOrderRequired: form.purchaseOrderRequired,
          pricingProfile: form.pricingProfile as NonNullable<ClientAccount['billingProfile']>['pricingProfile'],
        },
        inspectionPreferences: {
          preferredTimeWindow: form.preferredTimeWindow as NonNullable<ClientAccount['inspectionPreferences']>['preferredTimeWindow'],
          minimumBookingNoticeHours: Number(form.minimumBookingNoticeHours) || undefined,
          defaultAppointmentDurationMinutes: Number(form.defaultAppointmentDurationMinutes) || undefined,
          directBookingAllowed: form.directBookingAllowed,
          tenantNotificationRequired: form.tenantNotificationRequired,
          routineFrequencyMonths: Number(form.routineFrequencyMonths) || undefined,
          autoScheduleRecurringInspections: form.autoScheduleRecurringInspections,
          bookingNotes: form.bookingNotes.trim() || undefined,
        },
        maintenancePolicy: {
          propertyManagerApprovalLimit: Number(form.propertyManagerApprovalLimit) || undefined,
          landlordApprovalThreshold: Number(form.landlordApprovalThreshold) || undefined,
          emergencyAuthorisationLimit: Number(form.emergencyAuthorisationLimit) || undefined,
          secondApprovalThreshold: Number(form.secondApprovalThreshold) || undefined,
          replacementAlwaysRequiresOwnerApproval: form.replacementOwnerApproval,
          capitalWorksAlwaysRequireOwnerApproval: form.capitalOwnerApproval,
          cosmeticWorksAlwaysRequireOwnerApproval: form.cosmeticOwnerApproval,
        },
        notes: form.notes.trim() || undefined,
        status: 'onboarding',
      });
      const contact = await createClientContact({
        clientAccountId: account.id, displayName: form.contactName.trim(), email: form.contactEmail.trim() || form.generalEmail.trim() || undefined,
        phone: form.contactPhone.trim() || undefined, jobTitle: form.contactJobTitle.trim() || undefined,
        roles: form.clientType === 'property_management_firm' ? ['property_manager'] : ['owner_landlord'],
        isPrimary: true, receivesReports: true, receivesMaintenance: true, receivesAccounts: true,
        canApproveMaintenance: true, approvalLimit: Number(form.propertyManagerApprovalLimit) || undefined, status: 'active',
      });
      let currentAccount = await updateClientAccount(account, {
        primaryContactId: contact.id,
        defaultApprovalEmail: contact.email,
        maintenancePolicy: { ...account.maintenancePolicy, propertyManagerApprovalLimit: Number(form.propertyManagerApprovalLimit) || undefined, landlordApprovalThreshold: Number(form.landlordApprovalThreshold) || undefined, emergencyAuthorisationLimit: Number(form.emergencyAuthorisationLimit) || undefined, secondApprovalThreshold: Number(form.secondApprovalThreshold) || undefined, replacementAlwaysRequiresOwnerApproval: form.replacementOwnerApproval, capitalWorksAlwaysRequireOwnerApproval: form.capitalOwnerApproval, cosmeticWorksAlwaysRequireOwnerApproval: form.cosmeticOwnerApproval, quoteContactId: contact.id, maintenanceContactId: contact.id, ownerApprovalContactId: contact.id, accountsContactId: contact.id },
      });
      await createClientEngagement({ clientAccountId: account.id, name: form.engagementName.trim() || 'Service Agreement', status: 'active', effectiveFrom: form.effectiveFrom || undefined, services: selectedServices.map((serviceCode) => ({ serviceCode, active: true })), billingMethod: form.billingMethod as NonNullable<ClientEngagement['billingMethod']>, paymentTermsDays: Number(form.paymentTermsDays) || undefined });
      for (const propertyId of selectedPropertyIds) {
        await createPropertyClientRelationship({ propertyId, clientAccountId: account.id, relationshipType: form.relationshipType, primaryContactId: contact.id, isCurrent: true, startDate: new Date().toISOString().slice(0, 10), propertyManagerApprovalLimit: Number(form.propertyApprovalLimit) || Number(form.propertyManagerApprovalLimit) || undefined });
      }
      for (const entry of files) {
        await uploadClientDocument(account.id, entry.file, { type: entry.type, title: entry.file.name });
      }
      if (form.portalEmail.trim()) {
        await createClientPortalUser({ clientAccountId: account.id, contactId: contact.id, email: form.portalEmail.trim().toLowerCase(), displayName: form.portalName.trim() || form.contactName.trim(), permissions: portalPermissions, propertyIds: selectedPropertyIds, status: 'invited', invitationExpiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString() });
      }
      if (readiness.readyForActivation) currentAccount = await activateClient(currentAccount);
      navigate(`/app/admin/clients/${encodeURIComponent(currentAccount.id)}`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Client onboarding could not be completed.');
    } finally { setBusy(false); }
  };

  const input = (label: string, key: keyof typeof form, type = 'text') => <label className="grid gap-1 text-sm"><span className="font-semibold text-slate-700">{label}</span><input type={type} value={String(form[key] ?? '')} onChange={(event) => set(key, event.target.value)} className={fieldClass()} /></label>;

  return <div className="space-y-6">
    <div className="flex items-center gap-3"><Link to="/app/admin/clients" className="rounded-lg border border-slate-200 p-2 text-slate-600"><ArrowLeft size={16} /></Link><div><div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Client onboarding</div><h1 className="text-3xl font-black text-slate-950">New Client Account</h1></div></div>
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-3"><div className="flex min-w-[900px] gap-2">{STEPS.map((name, index) => <button key={name} onClick={() => setStep(index)} className={`flex-1 rounded-xl px-3 py-2 text-xs font-semibold ${step === index ? 'bg-slate-950 text-white' : index < step ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-50 text-slate-500'}`}>{index + 1}. {name}</button>)}</div></div>
    {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>}
    {duplicateWarning && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{duplicateWarning}</div>}
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-black text-slate-950">{STEPS[step]}</h2>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {step === 0 && <>{input('Legal name', 'legalName')}{input('Trading name', 'tradingName')}<label className="grid gap-1 text-sm"><span className="font-semibold">Client type</span><select value={form.clientType} onChange={(event) => setForm((current) => ({ ...current, clientType: event.target.value as ClientAccountType }))} className={fieldClass()}>{['private_landlord','property_management_firm','commercial_property_owner','strata_owners_corporation','strata_manager','corporate_client','other'].map((value) => <option key={value} value={value}>{value.replaceAll('_',' ')}</option>)}</select></label><label className="grid gap-1 text-sm"><span className="font-semibold">Entity type</span><select value={form.entityType} onChange={(event) => setForm((current) => ({ ...current, entityType: event.target.value as ClientEntityType }))} className={fieldClass()}>{['individual','joint_owners','company','trust','partnership','property_management_agency','strata_owners_corporation','other'].map((value) => <option key={value} value={value}>{value.replaceAll('_',' ')}</option>)}</select></label>{input('ABN', 'abn')}{input('ACN', 'acn')}{input('Website', 'website')}{input('Timezone', 'timezone')}{input('Business address', 'businessAddress')}{input('Postal address', 'postalAddress')}</>}
        {step === 1 && <>{input('Primary contact name', 'contactName')}{input('Job title', 'contactJobTitle')}{input('Primary contact email', 'contactEmail','email')}{input('Primary contact phone', 'contactPhone')}{input('General email', 'generalEmail','email')}{input('Main phone', 'mainPhone')}{input('Accounts email', 'accountsEmail','email')}{input('Maintenance email', 'maintenanceEmail','email')}{input('Emergency phone', 'emergencyPhone')}</>}
        {step === 2 && <div className="lg:col-span-2 space-y-4">{input('Engagement / agreement name','engagementName')}{input('Effective from','effectiveFrom','date')}<div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{SERVICE_OPTIONS.map(([code,name]) => <label key={code} className="flex items-center gap-2 rounded-xl border border-slate-200 p-3 text-sm"><input type="checkbox" checked={selectedServices.includes(code)} onChange={() => toggleService(code)} />{name}</label>)}</div></div>}
        {step === 3 && <><label className="grid gap-1 text-sm"><span className="font-semibold">Billing method</span><select value={form.billingMethod} onChange={(event) => set('billingMethod',event.target.value)} className={fieldClass()}>{['shopify_prepaid','account','invoice_per_inspection','monthly_consolidated_invoice','other'].map((value) => <option key={value} value={value}>{value.replaceAll('_',' ')}</option>)}</select></label>{input('Invoice recipient email','invoiceRecipientEmail','email')}{input('Payment terms (days)','paymentTermsDays','number')}{input('Pricing profile','pricingProfile')}<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.purchaseOrderRequired} onChange={(event) => set('purchaseOrderRequired',event.target.checked)} /> Purchase order required</label></>}
        {step === 4 && <>{input('Minimum booking notice (hours)','minimumBookingNoticeHours','number')}{input('Default appointment duration (minutes)','defaultAppointmentDurationMinutes','number')}<label className="grid gap-1 text-sm"><span className="font-semibold">Preferred time window</span><select value={form.preferredTimeWindow} onChange={(event) => set('preferredTimeWindow',event.target.value)} className={fieldClass()}><option value="morning">Morning</option><option value="afternoon">Afternoon</option><option value="business_hours">Business hours</option><option value="any">Any</option></select></label>{input('Routine frequency (months)','routineFrequencyMonths','number')}<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.directBookingAllowed} onChange={(event) => set('directBookingAllowed',event.target.checked)} /> Client may book directly</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.tenantNotificationRequired} onChange={(event) => set('tenantNotificationRequired',event.target.checked)} /> Tenant notification required</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.autoScheduleRecurringInspections} onChange={(event) => set('autoScheduleRecurringInspections',event.target.checked)} /> Auto-schedule recurring inspections</label><label className="grid gap-1 text-sm lg:col-span-2"><span className="font-semibold">Booking notes</span><textarea value={form.bookingNotes} onChange={(event) => set('bookingNotes',event.target.value)} className={fieldClass()} rows={3} /></label></>}
        {step === 5 && <>{input('Property Manager delegated limit','propertyManagerApprovalLimit','number')}{input('Landlord approval threshold','landlordApprovalThreshold','number')}{input('Emergency authorisation limit','emergencyAuthorisationLimit','number')}{input('Second approval threshold','secondApprovalThreshold','number')}<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.replacementOwnerApproval} onChange={(event) => set('replacementOwnerApproval',event.target.checked)} /> Replacement always requires owner approval</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.capitalOwnerApproval} onChange={(event) => set('capitalOwnerApproval',event.target.checked)} /> Capital works always require owner approval</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.cosmeticOwnerApproval} onChange={(event) => set('cosmeticOwnerApproval',event.target.checked)} /> Cosmetic work always requires owner approval</label></>}
        {step === 6 && <div className="lg:col-span-2 space-y-4"><div className="grid gap-4 md:grid-cols-2"><label className="grid gap-1 text-sm"><span className="font-semibold">Relationship type for selected Properties</span><select value={form.relationshipType} onChange={(event) => setForm((current) => ({...current,relationshipType:event.target.value as PropertyClientRelationshipType}))} className={fieldClass()}>{['owner','managing_agent','engaging_client','billing_party','report_recipient','maintenance_authority','strata_manager','owner_representative'].map((value) => <option key={value} value={value}>{value.replaceAll('_',' ')}</option>)}</select></label>{input('Property-specific approval limit','propertyApprovalLimit','number')}</div><div className="max-h-80 overflow-y-auto rounded-xl border border-slate-200 divide-y">{properties.map((property) => <label key={property.id} className="flex items-center gap-3 p-3 text-sm"><input type="checkbox" checked={selectedPropertyIds.includes(property.id)} onChange={() => toggleProperty(property.id)} /><span className="font-semibold">{property.address}</span><span className="text-slate-400">{property.suburb} {property.postcode}</span></label>)}</div></div>}
        {step === 7 && <div className="lg:col-span-2 space-y-4"><label className="grid gap-1 text-sm"><span className="font-semibold">Add onboarding documents</span><input type="file" multiple onChange={(event) => { const selected = Array.from(event.target.files || []); setFiles(selected.map((file) => ({file,type:'engagement_agreement'}))); }} className={fieldClass()} /></label>{files.map((entry,index) => <div key={`${entry.file.name}-${index}`} className="grid gap-2 rounded-xl border border-slate-200 p-3 md:grid-cols-[1fr_260px]"><div><div className="font-semibold">{entry.file.name}</div><div className="text-xs text-slate-400">{Math.round(entry.file.size/1024)} KB</div></div><select value={entry.type} onChange={(event) => setFiles((current) => current.map((value,i) => i===index ? {...value,type:event.target.value as ClientDocumentType}:value))} className={fieldClass()}>{CLIENT_DOCUMENT_TYPES.map((value) => <option key={value} value={value}>{value.replaceAll('_',' ')}</option>)}</select></div>)}</div>}
        {step === 8 && <div className="lg:col-span-2 space-y-4"><div className="grid gap-4 md:grid-cols-2">{input('Initial portal user name','portalName')}{input('Initial portal user email','portalEmail','email')}</div><div className="grid gap-2 md:grid-cols-2">{CLIENT_PORTAL_PERMISSIONS.map((permission) => <label key={permission} className="flex items-center gap-2 rounded-xl border border-slate-200 p-3 text-sm"><input type="checkbox" checked={portalPermissions.includes(permission)} onChange={() => togglePortalPermission(permission)} />{permission}</label>)}</div></div>}
        {step === 9 && <div className="lg:col-span-2 space-y-4"><div className={`rounded-xl border p-4 ${readiness.readyForActivation ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}><div className="flex items-center gap-2 font-black"><CheckCircle2 size={18}/>{readiness.readyForActivation ? 'Ready for activation' : 'Will be saved in onboarding'}</div>{readiness.blockers.map((blocker) => <div key={blocker} className="mt-2 text-sm">• {blocker}</div>)}{readiness.warnings.map((warning) => <div key={warning} className="mt-2 text-sm text-slate-600">• {warning}</div>)}</div><div className="grid gap-3 md:grid-cols-3"><div className="rounded-xl bg-slate-50 p-4"><div className="text-xs text-slate-400">Client</div><div className="font-bold">{form.tradingName || form.legalName || 'Unnamed'}</div></div><div className="rounded-xl bg-slate-50 p-4"><div className="text-xs text-slate-400">Properties</div><div className="font-bold">{selectedPropertyIds.length}</div></div><div className="rounded-xl bg-slate-50 p-4"><div className="text-xs text-slate-400">Services</div><div className="font-bold">{selectedServices.length}</div></div></div><label className="grid gap-1 text-sm"><span className="font-semibold">Internal notes</span><textarea rows={4} value={form.notes} onChange={(event) => set('notes',event.target.value)} className={fieldClass()} /></label></div>}
      </div>
    </section>
    <div className="flex justify-between"><button disabled={step===0||busy} onClick={() => setStep((current)=>Math.max(0,current-1))} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold disabled:opacity-40"><ArrowLeft size={16}/> Previous</button>{step < STEPS.length-1 ? <button disabled={busy} onClick={() => setStep((current)=>Math.min(STEPS.length-1,current+1))} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white">Next <ArrowRight size={16}/></button> : <button disabled={busy} onClick={() => void save()} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? <FileText size={16}/> : <Save size={16}/>} Complete onboarding</button>}</div>
  </div>;
};

export default ClientOnboardingPage;