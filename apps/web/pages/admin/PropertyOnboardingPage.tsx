import React, { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Building2, CheckCircle2, FileUp, Layers3, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type {
  AccessDeviceType,
  OwnershipStructure,
  PhysicalPropertyType,
  PropertyAccessDevice,
  PropertyAlert,
  PropertyAsset,
  PropertyAssetCategory,
  PropertyRecord,
  PropertyUse,
  StrataDetails,
} from '../../types/platform';
import { generateId } from '../../utils';
import { createProperty, listProperties, updateProperty } from '../../services/platform/propertyService';
import { DEFAULT_AGENCY_ID } from '../../services/platform/userProfileService';
import {
  PROPERTY_LAYOUT_TEMPLATES,
  applyLayoutTemplate,
  cloneLayoutFromProperty,
  templatesForProperty,
} from '../../services/platform/propertyLayoutService';
import { uploadPropertyDocument, type PropertyDocumentUploadMetadata } from '../../services/platform/propertyDocumentService';

const USES: Array<{ value: PropertyUse; label: string }> = [
  { value: 'residential', label: 'Residential' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'industrial', label: 'Industrial' },
  { value: 'retail', label: 'Retail' },
  { value: 'mixed_use', label: 'Mixed Use' },
  { value: 'strata_common_property', label: 'Strata / Common Property' },
  { value: 'other', label: 'Other' },
];

const PHYSICAL_TYPES: Array<{ value: PhysicalPropertyType; label: string; use: PropertyUse[] }> = [
  { value: 'house', label: 'House', use: ['residential'] },
  { value: 'apartment', label: 'Apartment', use: ['residential'] },
  { value: 'unit', label: 'Unit', use: ['residential'] },
  { value: 'townhouse', label: 'Townhouse', use: ['residential'] },
  { value: 'villa', label: 'Villa', use: ['residential'] },
  { value: 'duplex', label: 'Duplex', use: ['residential'] },
  { value: 'studio', label: 'Studio', use: ['residential'] },
  { value: 'ancillary_dwelling', label: 'Granny Flat / Ancillary Dwelling', use: ['residential'] },
  { value: 'retirement_supported', label: 'Retirement / Supported Accommodation', use: ['residential'] },
  { value: 'office', label: 'Office', use: ['commercial', 'mixed_use'] },
  { value: 'retail_shop', label: 'Retail Shop', use: ['retail', 'commercial', 'mixed_use'] },
  { value: 'warehouse', label: 'Warehouse', use: ['industrial', 'commercial'] },
  { value: 'industrial_unit', label: 'Industrial Unit', use: ['industrial', 'commercial'] },
  { value: 'showroom', label: 'Showroom', use: ['retail', 'commercial'] },
  { value: 'medical_consulting', label: 'Medical / Consulting', use: ['commercial'] },
  { value: 'hospitality', label: 'Hospitality', use: ['retail', 'commercial'] },
  { value: 'restaurant_cafe', label: 'Restaurant / Café', use: ['retail', 'commercial'] },
  { value: 'childcare', label: 'Childcare', use: ['commercial'] },
  { value: 'mixed_commercial', label: 'Mixed Commercial', use: ['commercial', 'mixed_use'] },
  { value: 'common_property', label: 'Common Property', use: ['strata_common_property'] },
  { value: 'other', label: 'Other', use: ['other', 'mixed_use'] },
];

const OWNERSHIP: Array<{ value: OwnershipStructure; label: string }> = [
  { value: 'freehold', label: 'Freehold' },
  { value: 'strata', label: 'Strata' },
  { value: 'survey_strata', label: 'Survey Strata' },
  { value: 'community_title', label: 'Community Title' },
  { value: 'company_title', label: 'Company Title' },
  { value: 'common_property', label: 'Common Property' },
  { value: 'unknown', label: 'Unknown' },
  { value: 'other', label: 'Other' },
];

interface PendingDocument {
  id: string;
  file: File;
  metadata: PropertyDocumentUploadMetadata;
}

const STEPS = ['Identity', 'Classification', 'Layout', 'Configuration', 'Assets & Access', 'People & Alerts', 'Historical Records', 'Review'];

function legacyType(type: PhysicalPropertyType): PropertyRecord['propertyType'] {
  if (['house', 'apartment', 'unit', 'townhouse', 'villa', 'duplex'].includes(type)) return type as PropertyRecord['propertyType'];
  if (['office', 'retail_shop', 'warehouse', 'industrial_unit', 'showroom', 'medical_consulting', 'hospitality', 'restaurant_cafe', 'childcare', 'mixed_commercial'].includes(type)) return 'commercial';
  return 'other';
}

const PropertyOnboardingPage: React.FC = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingProperties, setExistingProperties] = useState<PropertyRecord[]>([]);
  const [cloneSourceId, setCloneSourceId] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('res-house-3x2');
  const [pendingDocuments, setPendingDocuments] = useState<PendingDocument[]>([]);

  const [address, setAddress] = useState('');
  const [suburb, setSuburb] = useState('');
  const [state, setState] = useState('WA');
  const [postcode, setPostcode] = useState('');
  const [propertyUse, setPropertyUse] = useState<PropertyUse>('residential');
  const [physicalPropertyType, setPhysicalPropertyType] = useState<PhysicalPropertyType>('house');
  const [ownershipStructure, setOwnershipStructure] = useState<OwnershipStructure>('freehold');
  const [strataDetails, setStrataDetails] = useState<StrataDetails>({});
  const [bedrooms, setBedrooms] = useState(3);
  const [bathrooms, setBathrooms] = useState(2);
  const [parking, setParking] = useState(1);
  const [livingAreas, setLivingAreas] = useState(1);
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [tenantName, setTenantName] = useState('');
  const [tenantEmail, setTenantEmail] = useState('');
  const [leaseStart, setLeaseStart] = useState('');
  const [leaseEnd, setLeaseEnd] = useState('');
  const [assets, setAssets] = useState<PropertyAsset[]>([]);
  const [accessDevices, setAccessDevices] = useState<PropertyAccessDevice[]>([]);
  const [alerts, setAlerts] = useState<PropertyAlert[]>([]);
  const [newAssetName, setNewAssetName] = useState('');
  const [newAssetCategory, setNewAssetCategory] = useState<PropertyAssetCategory>('appliance');
  const [newAccessName, setNewAccessName] = useState('');
  const [newAccessType, setNewAccessType] = useState<AccessDeviceType>('key');
  const [newAlert, setNewAlert] = useState('');

  const templateCandidates = useMemo(
    () => templatesForProperty({ propertyUse, physicalPropertyType }),
    [propertyUse, physicalPropertyType],
  );

  const strata = ['strata', 'survey_strata', 'community_title', 'company_title', 'common_property'].includes(ownershipStructure);

  const ensurePropertiesLoaded = async () => {
    if (existingProperties.length === 0) setExistingProperties(await listProperties());
  };

  const next = async () => {
    setError(null);
    if (step === 0 && !address.trim()) return setError('Property address is required.');
    if (step === 1 && !physicalPropertyType) return setError('Select a physical property type.');
    if (step === 2) await ensurePropertiesLoaded();
    setStep((value) => Math.min(STEPS.length - 1, value + 1));
  };

  const addAsset = () => {
    if (!newAssetName.trim()) return;
    setAssets((items) => [...items, {
      id: `asset-${generateId()}`,
      name: newAssetName.trim(),
      category: newAssetCategory,
      status: 'active',
    }]);
    setNewAssetName('');
  };

  const addAccessDevice = () => {
    if (!newAccessName.trim()) return;
    setAccessDevices((items) => [...items, {
      id: `access-${generateId()}`,
      type: newAccessType,
      name: newAccessName.trim(),
      quantity: 1,
      status: 'held',
    }]);
    setNewAccessName('');
  };

  const addAlert = () => {
    if (!newAlert.trim()) return;
    setAlerts((items) => [...items, {
      id: `alert-${generateId()}`,
      type: 'general',
      severity: 'warning',
      message: newAlert.trim(),
      active: true,
      createdAt: new Date().toISOString(),
    }]);
    setNewAlert('');
  };

  const handleDocumentFiles = (files: FileList | null) => {
    if (!files) return;
    setPendingDocuments((current) => [
      ...current,
      ...Array.from(files).map((file) => ({
        id: generateId(),
        file,
        metadata: {
          type: 'entry_report',
          title: file.name,
          source: 'legacy_upload',
        },
      })),
    ]);
  };

  const updatePendingDocument = (id: string, patch: Partial<PropertyDocumentUploadMetadata>) => {
    setPendingDocuments((current) => current.map((item) => item.id === id ? { ...item, metadata: { ...item.metadata, ...patch } } : item));
  };

  const handleCreate = async () => {
    setBusy(true);
    setError(null);
    try {
      const now = new Date().toISOString();
      const draftProperty: PropertyRecord = {
        id: 'onboarding-draft',
        agencyId: DEFAULT_AGENCY_ID,
        address: address.trim(),
        suburb: suburb.trim(),
        state: state.trim(),
        postcode: postcode.trim(),
        propertyType: legacyType(physicalPropertyType),
        propertyUse,
        physicalPropertyType,
        ownershipStructure,
        ...(strata ? { strataDetails } : {}),
        bedrooms,
        bathrooms,
        parking,
        livingAreas,
        landlordDetails: { name: ownerName.trim(), email: ownerEmail.trim() },
        tenantDetails: {
          primaryTenantName: tenantName.trim(),
          primaryTenantEmail: tenantEmail.trim(),
          leaseStartDate: leaseStart,
          leaseEndDate: leaseEnd,
          occupancyStatus: tenantName.trim() ? 'tenanted' : 'vacant',
        },
        ownershipHistory: ownerName.trim() ? [{
          id: `ownership-${generateId()}`,
          ownerName: ownerName.trim(),
          ownerEmail: ownerEmail.trim() || undefined,
          isCurrent: true,
          startDate: now.slice(0, 10),
        }] : [],
        tenancyHistory: tenantName.trim() ? [{
          id: `tenancy-history-${generateId()}`,
          tenantNames: [tenantName.trim()],
          tenantEmails: tenantEmail.trim() ? [tenantEmail.trim()] : [],
          leaseStartDate: leaseStart || undefined,
          leaseEndDate: leaseEnd || undefined,
          status: 'current',
        }] : [],
        assets,
        accessDevices,
        alerts,
        clientIds: [],
        status: 'active',
        onboarding: {
          status: 'in_progress',
          completedSteps: STEPS.slice(0, 7),
          historicalImportStatus: pendingDocuments.length ? 'in_progress' : 'not_required',
          updatedAt: now,
        },
        createdAt: now,
        updatedAt: now,
      };

      let layoutPatch: Partial<PropertyRecord> = {};
      const source = existingProperties.find((item) => item.id === cloneSourceId);
      if (source) {
        layoutPatch = cloneLayoutFromProperty(draftProperty, source);
      } else {
        const template = PROPERTY_LAYOUT_TEMPLATES.find((item) => item.id === selectedTemplateId) || templateCandidates[0];
        if (template) layoutPatch = applyLayoutTemplate(draftProperty, template);
      }

      const property = await createProperty({
        ...draftProperty,
        ...layoutPatch,
        onboarding: {
          status: pendingDocuments.length ? 'in_progress' : 'ready_for_inspection',
          completedSteps: pendingDocuments.length ? STEPS.slice(0, 7) : STEPS,
          historicalImportStatus: pendingDocuments.length ? 'in_progress' : 'not_required',
          updatedAt: now,
        },
      });

      let latest = property;
      for (const document of pendingDocuments) {
        await uploadPropertyDocument(latest, document.file, document.metadata);
        latest = (await listProperties()).find((item) => item.id === property.id) || latest;
      }

      if (pendingDocuments.length) {
        await updateProperty(property.id, {
          onboarding: {
            status: 'ready_for_inspection',
            completedSteps: STEPS,
            historicalImportStatus: 'complete',
            updatedAt: new Date().toISOString(),
          },
        });
      }
      navigate(`/app/admin/properties/${property.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Property could not be created.');
    } finally {
      setBusy(false);
    }
  };

  const card = 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm';
  const field = 'mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none';

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-16">
      <div>
        <button onClick={() => navigate('/app/admin/properties')} className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-900">
          <ArrowLeft size={14} /> Back to Property Portfolio
        </button>
        <div className="mt-3 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-blue-50 text-blue-700"><Building2 size={22} /></div>
          <div>
            <h1 className="text-2xl font-black text-slate-950">Property Onboarding</h1>
            <p className="text-sm text-slate-500">Create the permanent property record, configure its inspection layout and bring historical evidence forward.</p>
          </div>
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-8">
        {STEPS.map((label, index) => (
          <button key={label} onClick={() => index <= step && setStep(index)} className={`rounded-xl border px-3 py-2 text-left text-[11px] font-semibold ${index === step ? 'border-blue-500 bg-blue-50 text-blue-800' : index < step ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-400'}`}>
            <div>{index < step ? '✓' : index + 1}. {label}</div>
          </button>
        ))}
      </div>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}

      {step === 0 && <div className={card}>
        <h2 className="font-bold">1. Property Identity</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="text-xs font-semibold">Street / Unit Address<input value={address} onChange={(e) => setAddress(e.target.value)} className={field} placeholder="46 Maamba Road" /></label>
          <label className="text-xs font-semibold">Suburb<input value={suburb} onChange={(e) => setSuburb(e.target.value)} className={field} /></label>
          <label className="text-xs font-semibold">State<input value={state} onChange={(e) => setState(e.target.value)} className={field} /></label>
          <label className="text-xs font-semibold">Postcode<input value={postcode} onChange={(e) => setPostcode(e.target.value)} className={field} /></label>
        </div>
      </div>}

      {step === 1 && <div className={card}>
        <h2 className="font-bold">2. Property Classification</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <label className="text-xs font-semibold">Property Use<select value={propertyUse} onChange={(e) => { const next = e.target.value as PropertyUse; setPropertyUse(next); const first = PHYSICAL_TYPES.find((item) => item.use.includes(next)); if (first) setPhysicalPropertyType(first.value); }} className={field}>{USES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label className="text-xs font-semibold">Physical Property Type<select value={physicalPropertyType} onChange={(e) => setPhysicalPropertyType(e.target.value as PhysicalPropertyType)} className={field}>{PHYSICAL_TYPES.filter((item) => item.use.includes(propertyUse)).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label className="text-xs font-semibold">Ownership / Management<select value={ownershipStructure} onChange={(e) => setOwnershipStructure(e.target.value as OwnershipStructure)} className={field}>{OWNERSHIP.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        </div>
        {strata && <div className="mt-5 rounded-xl bg-slate-50 p-4">
          <h3 className="text-sm font-bold">Strata details</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <input className={field} placeholder="Scheme / strata name" value={strataDetails.schemeName || ''} onChange={(e) => setStrataDetails((v) => ({ ...v, schemeName: e.target.value }))} />
            <input className={field} placeholder="Strata plan number" value={strataDetails.strataPlanNumber || ''} onChange={(e) => setStrataDetails((v) => ({ ...v, strataPlanNumber: e.target.value }))} />
            <input className={field} placeholder="Lot number" value={strataDetails.lotNumber || ''} onChange={(e) => setStrataDetails((v) => ({ ...v, lotNumber: e.target.value }))} />
            <input className={field} placeholder="Building name" value={strataDetails.buildingName || ''} onChange={(e) => setStrataDetails((v) => ({ ...v, buildingName: e.target.value }))} />
            <input className={field} placeholder="Strata manager" value={strataDetails.strataManagerName || ''} onChange={(e) => setStrataDetails((v) => ({ ...v, strataManagerName: e.target.value }))} />
            <input className={field} placeholder="Allocated parking bay" value={strataDetails.allocatedParkingBay || ''} onChange={(e) => setStrataDetails((v) => ({ ...v, allocatedParkingBay: e.target.value }))} />
          </div>
        </div>}
      </div>}

      {step === 2 && <div className={card}>
        <h2 className="font-bold">3. Choose Property Layout</h2>
        <p className="mt-1 text-xs text-slate-500">Start from a ProInspect layout or copy the layout of an existing property. The property receives its own versioned copy.</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="space-y-2">{templateCandidates.map((template) => <button key={template.id} onClick={() => { setCloneSourceId(''); setSelectedTemplateId(template.id); }} className={`w-full rounded-xl border p-4 text-left ${!cloneSourceId && selectedTemplateId === template.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200'}`}><div className="font-semibold">{template.name}</div><div className="mt-1 text-xs text-slate-500">{template.description}</div><div className="mt-2 text-[11px] text-slate-400">{template.rooms.length} configured areas</div></button>)}</div>
          <div>
            <label className="text-xs font-semibold">Copy layout from existing property<select value={cloneSourceId} onFocus={() => void ensurePropertiesLoaded()} onChange={(e) => setCloneSourceId(e.target.value)} className={field}><option value="">Do not copy another property</option>{existingProperties.map((item) => <option key={item.id} value={item.id}>{item.address}</option>)}</select></label>
          </div>
        </div>
      </div>}

      {step === 3 && <div className={card}>
        <h2 className="font-bold">4. Property Configuration</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-4">
          <label className="text-xs font-semibold">Bedrooms<input type="number" min={0} value={bedrooms} onChange={(e) => setBedrooms(Number(e.target.value))} className={field} /></label>
          <label className="text-xs font-semibold">Bathrooms<input type="number" min={0} value={bathrooms} onChange={(e) => setBathrooms(Number(e.target.value))} className={field} /></label>
          <label className="text-xs font-semibold">Parking<input type="number" min={0} value={parking} onChange={(e) => setParking(Number(e.target.value))} className={field} /></label>
          <label className="text-xs font-semibold">Living Areas<input type="number" min={0} value={livingAreas} onChange={(e) => setLivingAreas(Number(e.target.value))} className={field} /></label>
        </div>
        <div className="mt-4 rounded-xl bg-blue-50 p-4 text-xs text-blue-900"><Layers3 size={16} className="mb-2" />The selected layout will be copied to the property and can be changed later without altering historic layout versions.</div>
      </div>}

      {step === 4 && <div className="grid gap-5 lg:grid-cols-2">
        <div className={card}><h2 className="font-bold">5A. Assets & Appliances</h2><div className="mt-4 flex gap-2"><input className={field} value={newAssetName} onChange={(e) => setNewAssetName(e.target.value)} placeholder="e.g. Kitchen Dishwasher" /><select className={field} value={newAssetCategory} onChange={(e) => setNewAssetCategory(e.target.value as PropertyAssetCategory)}><option value="appliance">Appliance</option><option value="hvac">HVAC</option><option value="hot_water">Hot Water</option><option value="solar">Solar</option><option value="security">Security</option><option value="fire_safety">Fire Safety</option><option value="commercial_equipment">Commercial Equipment</option><option value="other">Other</option></select><button onClick={addAsset} className="rounded-xl bg-slate-900 px-4 text-xs font-semibold text-white">Add</button></div><div className="mt-3 space-y-2">{assets.map((item) => <div key={item.id} className="rounded-lg bg-slate-50 p-3 text-xs"><b>{item.name}</b> · {item.category.replaceAll('_', ' ')}</div>)}</div></div>
        <div className={card}><h2 className="font-bold">5B. Keys & Access Devices</h2><div className="mt-4 flex gap-2"><input className={field} value={newAccessName} onChange={(e) => setNewAccessName(e.target.value)} placeholder="e.g. Front Door Key" /><select className={field} value={newAccessType} onChange={(e) => setNewAccessType(e.target.value as AccessDeviceType)}><option value="key">Key</option><option value="garage_remote">Garage Remote</option><option value="security_fob">Security Fob</option><option value="access_card">Access Card</option><option value="gate_remote">Gate Remote</option><option value="other">Other</option></select><button onClick={addAccessDevice} className="rounded-xl bg-slate-900 px-4 text-xs font-semibold text-white">Add</button></div><div className="mt-3 space-y-2">{accessDevices.map((item) => <div key={item.id} className="rounded-lg bg-slate-50 p-3 text-xs"><b>{item.name}</b> · {item.type.replaceAll('_', ' ')}</div>)}</div></div>
      </div>}

      {step === 5 && <div className="grid gap-5 lg:grid-cols-2">
        <div className={card}><h2 className="font-bold">6A. Owner & Current Tenancy</h2><div className="mt-4 grid gap-3"><input className={field} value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Owner / landlord name" /><input className={field} type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder="Owner email" /><input className={field} value={tenantName} onChange={(e) => setTenantName(e.target.value)} placeholder="Current tenant name" /><input className={field} type="email" value={tenantEmail} onChange={(e) => setTenantEmail(e.target.value)} placeholder="Tenant email" /><div className="grid grid-cols-2 gap-2"><input className={field} type="date" value={leaseStart} onChange={(e) => setLeaseStart(e.target.value)} /><input className={field} type="date" value={leaseEnd} onChange={(e) => setLeaseEnd(e.target.value)} /></div></div></div>
        <div className={card}><h2 className="font-bold">6B. Persistent Property Alerts</h2><div className="mt-4 flex gap-2"><input className={field} value={newAlert} onChange={(e) => setNewAlert(e.target.value)} placeholder="e.g. Strata access requires concierge" /><button onClick={addAlert} className="rounded-xl bg-amber-600 px-4 text-xs font-semibold text-white">Add</button></div><div className="mt-3 space-y-2">{alerts.map((item) => <div key={item.id} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">⚠ {item.message}</div>)}</div></div>
      </div>}

      {step === 6 && <div className={card}>
        <h2 className="font-bold">7. Historical Reports & Property Documents</h2>
        <p className="mt-1 text-xs text-slate-500">Upload earlier Entry, Routine, Exit or maintenance reports now. Originals remain unchanged and historical report extraction remains review-controlled.</p>
        <label className="mt-4 flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 p-8 text-sm font-semibold text-slate-600 hover:border-blue-400 hover:bg-blue-50"><FileUp size={20} /> Choose historical files<input type="file" multiple accept=".pdf,.docx,.xlsx,.zip,.jpg,.jpeg,.png,.heic,.heif" onChange={(e) => handleDocumentFiles(e.target.files)} className="hidden" /></label>
        <div className="mt-4 space-y-3">{pendingDocuments.map((item) => <div key={item.id} className="grid gap-2 rounded-xl border border-slate-200 p-3 md:grid-cols-[1fr_180px_150px_auto]"><div><div className="text-sm font-semibold">{item.file.name}</div><div className="text-[11px] text-slate-400">{Math.round(item.file.size / 1024)} KB</div></div><select value={item.metadata.type} onChange={(e) => updatePendingDocument(item.id, { type: e.target.value as PropertyDocumentUploadMetadata['type'] })} className="rounded-lg border border-slate-200 px-2 text-xs"><option value="entry_report">Entry PCR</option><option value="routine_report">Routine</option><option value="exit_report">Exit</option><option value="maintenance_report">Maintenance</option><option value="floor_plan">Floor Plan</option><option value="other">Other</option></select><input type="date" value={item.metadata.inspectionDate || ''} onChange={(e) => updatePendingDocument(item.id, { inspectionDate: e.target.value })} className="rounded-lg border border-slate-200 px-2 text-xs" /><button onClick={() => setPendingDocuments((items) => items.filter((candidate) => candidate.id !== item.id))} className="text-xs font-semibold text-rose-600">Remove</button></div>)}</div>
      </div>}

      {step === 7 && <div className={card}>
        <div className="flex items-center gap-3"><ShieldCheck className="text-emerald-600" /><div><h2 className="font-bold">8. Review & Create</h2><p className="text-xs text-slate-500">The property becomes the permanent source record for future inspections, evidence, maintenance and history.</p></div></div>
        <div className="mt-5 grid gap-3 md:grid-cols-3"><div className="rounded-xl bg-slate-50 p-4"><div className="text-[11px] uppercase text-slate-400">Property</div><div className="font-semibold">{address}</div><div className="text-xs text-slate-500">{suburb} {state} {postcode}</div></div><div className="rounded-xl bg-slate-50 p-4"><div className="text-[11px] uppercase text-slate-400">Classification</div><div className="font-semibold capitalize">{propertyUse.replaceAll('_', ' ')}</div><div className="text-xs capitalize text-slate-500">{physicalPropertyType.replaceAll('_', ' ')} · {ownershipStructure.replaceAll('_', ' ')}</div></div><div className="rounded-xl bg-slate-50 p-4"><div className="text-[11px] uppercase text-slate-400">Historical Records</div><div className="font-semibold">{pendingDocuments.length}</div><div className="text-xs text-slate-500">files queued for verified upload</div></div></div>
        <button disabled={busy} onClick={() => void handleCreate()} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-50"><CheckCircle2 size={18} /> {busy ? 'Creating Property...' : 'Create Property & Prepare for Inspection'}</button>
      </div>}

      <div className="flex justify-between">
        <button disabled={step === 0 || busy} onClick={() => setStep((value) => Math.max(0, value - 1))} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold disabled:opacity-40"><ArrowLeft size={14} /> Previous</button>
        {step < STEPS.length - 1 && <button disabled={busy} onClick={() => void next()} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white">Next <ArrowRight size={14} /></button>}
      </div>
    </div>
  );
};

export default PropertyOnboardingPage;
