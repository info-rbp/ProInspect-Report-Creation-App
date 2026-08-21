import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  Settings2,
  UserCog,
  Wrench,
} from 'lucide-react';
import type {
  InspectionReportType,
  InspectionServiceMapping,
  InspectorCapabilityProfile,
  PropertyUse,
  UserProfile,
} from '../../types/platform';
import {
  listInspectionServiceMappings,
  listInspectorProfiles,
  saveInspectionServiceMapping,
  saveInspectorProfile,
  setInspectionServiceMappingActive,
} from '../../services/platform/inspectionOperationsConfigurationService';
import { listAvailableInspectors } from '../../services/platform/userDirectoryService';
import { DEFAULT_AGENCY_ID } from '../../services/platform/userProfileService';

const REPORT_TYPES: InspectionReportType[] = [
  'Property Condition Report',
  'Routine Inspection',
  'Exit Inspection',
  'Inspection Comparison Report',
  'Maintenance and Follow-Up Report',
];

const PROPERTY_USES: PropertyUse[] = [
  'residential',
  'commercial',
  'industrial',
  'retail',
  'mixed_use',
  'strata_common_property',
  'other',
];

function displayName(user: UserProfile): string {
  return user.displayName?.trim() || user.email;
}

function label(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/gu, (character) => character.toUpperCase());
}

export const InspectionOperationsConfigurationPage: React.FC = () => {
  const [tab, setTab] = useState<'mappings' | 'inspectors'>('mappings');
  const [mappings, setMappings] = useState<InspectionServiceMapping[]>([]);
  const [profiles, setProfiles] = useState<InspectorCapabilityProfile[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const [nextMappings, nextProfiles, nextUsers] = await Promise.all([
      listInspectionServiceMappings(),
      listInspectorProfiles(),
      listAvailableInspectors(),
    ]);
    setMappings(nextMappings);
    setProfiles(nextProfiles);
    setUsers(nextUsers);
  };

  useEffect(() => {
    void load().catch((failure) => setError(failure instanceof Error ? failure.message : 'Configuration could not be loaded.'));
  }, []);

  return (
    <div className="space-y-6 pb-16">
      <header>
        <Link to="/app/admin/jobs" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500"><ArrowLeft size={14} /> Back to Inspection Operations</Link>
        <div className="mt-3 flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-xl bg-blue-50 text-blue-700"><Settings2 size={21} /></div><div><h1 className="text-2xl font-black text-slate-950">Inspection Operations Configuration</h1><p className="text-sm text-slate-500">Control external service mappings and staff assignment capabilities.</p></div></div>
      </header>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}

      <nav className="inline-flex rounded-xl border border-slate-200 bg-white p-1"><button onClick={() => setTab('mappings')} className={`rounded-lg px-4 py-2 text-xs font-semibold ${tab === 'mappings' ? 'bg-slate-950 text-white' : 'text-slate-600'}`}>Service Mappings</button><button onClick={() => setTab('inspectors')} className={`rounded-lg px-4 py-2 text-xs font-semibold ${tab === 'inspectors' ? 'bg-slate-950 text-white' : 'text-slate-600'}`}>Inspector Capabilities</button></nav>

      {tab === 'mappings' ? (
        <MappingConfiguration
          mappings={mappings}
          busy={busy}
          onSave={async (mapping) => {
            setBusy(true);
            try {
              await saveInspectionServiceMapping(mapping);
              await load();
            } catch (failure) {
              setError(failure instanceof Error ? failure.message : 'Service mapping could not be saved.');
            } finally {
              setBusy(false);
            }
          }}
          onActive={async (mapping, active) => {
            setBusy(true);
            try {
              await setInspectionServiceMappingActive(mapping, active);
              await load();
            } catch (failure) {
              setError(failure instanceof Error ? failure.message : 'Mapping status could not be changed.');
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : (
        <InspectorConfiguration
          users={users}
          profiles={profiles}
          busy={busy}
          onSave={async (profile) => {
            setBusy(true);
            try {
              await saveInspectorProfile(profile);
              await load();
            } catch (failure) {
              setError(failure instanceof Error ? failure.message : 'Inspector profile could not be saved.');
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </div>
  );
};

const MappingConfiguration: React.FC<{
  mappings: InspectionServiceMapping[];
  busy: boolean;
  onSave: (mapping: Partial<InspectionServiceMapping> & Pick<InspectionServiceMapping, 'agencyId' | 'provider' | 'serviceCode' | 'label' | 'reportType'>) => Promise<void>;
  onActive: (mapping: InspectionServiceMapping, active: boolean) => Promise<void>;
}> = ({ mappings, busy, onSave, onActive }) => {
  const [provider, setProvider] = useState<InspectionServiceMapping['provider']>('shopify');
  const [serviceCode, setServiceCode] = useState('');
  const [mappingLabel, setMappingLabel] = useState('');
  const [reportType, setReportType] = useState<InspectionReportType>('Property Condition Report');
  const [externalMatch, setExternalMatch] = useState('');
  const [duration, setDuration] = useState(60);

  return <div className="space-y-5"><section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center gap-2"><Wrench size={18} /><h2 className="font-bold">Create Service Mapping</h2></div><div className="mt-4 grid gap-3 md:grid-cols-3"><select value={provider} onChange={(event) => setProvider(event.target.value as InspectionServiceMapping['provider'])} className="rounded-xl border border-slate-200 px-3 py-2 text-xs"><option value="shopify">Shopify</option><option value="google_calendar">Google Calendar</option><option value="manual">Manual</option></select><input value={serviceCode} onChange={(event) => setServiceCode(event.target.value)} placeholder="Service code" className="rounded-xl border border-slate-200 px-3 py-2 text-xs" /><input value={mappingLabel} onChange={(event) => setMappingLabel(event.target.value)} placeholder="Display label" className="rounded-xl border border-slate-200 px-3 py-2 text-xs" /><select value={reportType} onChange={(event) => setReportType(event.target.value as InspectionReportType)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs">{REPORT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select><input value={externalMatch} onChange={(event) => setExternalMatch(event.target.value)} placeholder={provider === 'shopify' ? 'Product GID, SKU or handle' : 'Calendar summary regex'} className="rounded-xl border border-slate-200 px-3 py-2 text-xs" /><input type="number" min={1} value={duration} onChange={(event) => setDuration(Number(event.target.value) || 60)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs" /><button disabled={busy || !serviceCode.trim() || !mappingLabel.trim()} onClick={() => void onSave({ agencyId: DEFAULT_AGENCY_ID, provider, serviceCode: serviceCode.trim(), label: mappingLabel.trim(), reportType, defaultDurationMinutes: duration, paymentRequired: provider === 'shopify', manualApprovalRequired: false, defaultPriority: 'normal', ...(provider === 'shopify' ? externalMatch.startsWith('gid://') ? { productId: externalMatch } : externalMatch.includes('-') ? { productHandle: externalMatch } : { sku: externalMatch } : provider === 'google_calendar' ? { calendarSummaryPattern: externalMatch } : {}) })} className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white md:col-span-3">Create Mapping</button></div></section><div className="grid gap-3 xl:grid-cols-2">{mappings.map((mapping) => <section key={mapping.id} className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><b>{mapping.label}</b><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase">{label(mapping.provider)}</span></div><div className="mt-1 text-xs text-slate-500">{mapping.serviceCode} → {mapping.reportType}</div></div><button disabled={busy} onClick={() => void onActive(mapping, !mapping.active)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${mapping.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{mapping.active ? 'Active' : 'Inactive'}</button></div><div className="mt-4 grid grid-cols-2 gap-3 text-xs"><div><b>External match</b><div className="mt-1 break-all text-slate-500">{mapping.productId || mapping.variantId || mapping.sku || mapping.productHandle || mapping.calendarSummaryPattern || 'Manual'}</div></div><div><b>Defaults</b><div className="mt-1 text-slate-500">{mapping.defaultDurationMinutes} min · {mapping.defaultPriority} · {mapping.paymentRequired ? 'payment required' : 'no payment gate'}</div></div></div></section>)}</div></div>;
};

const InspectorConfiguration: React.FC<{
  users: UserProfile[];
  profiles: InspectorCapabilityProfile[];
  busy: boolean;
  onSave: (profile: Partial<InspectorCapabilityProfile> & Pick<InspectorCapabilityProfile, 'agencyId' | 'userId' | 'displayName' | 'role'>) => Promise<void>;
}> = ({ users, profiles, busy, onSave }) => {
  const [selectedUserId, setSelectedUserId] = useState(users[0]?.id || '');
  const [serviceAreas, setServiceAreas] = useState('');
  const [maxJobs, setMaxJobs] = useState(4);
  const selected = users.find((user) => user.id === selectedUserId);
  return <div className="space-y-5"><section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center gap-2"><UserCog size={18} /><h2 className="font-bold">Inspector Capability Profile</h2></div><div className="mt-4 grid gap-3 md:grid-cols-3"><select value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs"><option value="">Select active inspector...</option>{users.map((user) => <option key={user.id} value={user.id}>{displayName(user)}</option>)}</select><input value={serviceAreas} onChange={(event) => setServiceAreas(event.target.value)} placeholder="Service areas, comma separated" className="rounded-xl border border-slate-200 px-3 py-2 text-xs" /><input type="number" min={1} value={maxJobs} onChange={(event) => setMaxJobs(Number(event.target.value) || 4)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs" /><button disabled={busy || !selected} onClick={() => selected && void onSave({ agencyId: selected.agencyId || DEFAULT_AGENCY_ID, userId: selected.id, displayName: displayName(selected), role: ['inspector', 'operations', 'proinspect_admin', 'super_admin'].includes(selected.role) ? selected.role as InspectorCapabilityProfile['role'] : 'inspector', active: true, inspectionTypes: REPORT_TYPES, propertyUses: PROPERTY_USES, serviceAreas: serviceAreas.split(',').map((value) => value.trim()).filter(Boolean), commercialQualified: true, strataQualified: true, maxJobsPerDay: maxJobs })} className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white md:col-span-3">Save Capability Profile</button></div></section><div className="grid gap-3 xl:grid-cols-2">{profiles.map((profile) => <section key={profile.id} className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between"><div><b>{profile.displayName}</b><div className="mt-1 text-xs text-slate-500">{profile.userId}</div></div><span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold uppercase ${profile.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}><CheckCircle2 size={12} /> {profile.active ? 'Active' : 'Inactive'}</span></div><div className="mt-4 text-xs text-slate-600"><b>Capacity:</b> {profile.maxJobsPerDay || 'unlimited'} jobs/day<br /><b>Service areas:</b> {profile.serviceAreas.join(', ') || 'all'}<br /><b>Inspection types:</b> {profile.inspectionTypes.join(', ') || 'none configured'}</div></section>)}</div></div>;
};

export default InspectionOperationsConfigurationPage;
