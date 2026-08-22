import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  Boxes,
  Building2,
  CalendarDays,
  ClipboardList,
  FileText,
  FileUp,
  History,
  KeyRound,
  Layers3,
  Plus,
  RefreshCw,
  ShieldAlert,
  Users,
  Wrench,
} from 'lucide-react';
import type {
  AccessDeviceType,
  InspectionJob,
  InspectionReportType,
  MaintenanceItem,
  PropertyAccessDevice,
  PropertyAsset,
  PropertyAssetCategory,
  PropertyDocument,
  PropertyDocumentType,
  PropertyRecord,
  RoomConfigItem,
  Tenancy,
} from '../../types/platform';
import type { ReportData } from '../../types';
import { generateId } from '../../utils';
import { getProperty, listProperties, updateProperty } from '../../services/platform/propertyService';
import { listInspectionJobs, createInspectionJob } from '../../services/platform/inspectionJobService';
import { createInspectionReportForJob } from '../../services/platform/inspectionReportService';
import { getAllSavedReports } from '../../services/storageService';
import { listMaintenanceItems } from '../../services/platform/maintenanceService';
import { createTenancy, listTenanciesForProperty } from '../../services/platform/tenancyService';
import { uploadPropertyDocument } from '../../services/platform/propertyDocumentService';
import {
  PROPERTY_LAYOUT_TEMPLATES,
  applyLayoutTemplate,
  cloneLayoutFromProperty,
  createLayoutVersion,
  hierarchyFromRooms,
} from '../../services/platform/propertyLayoutService';
import PropertyHistoryPanel from '../../components/properties/PropertyHistoryPanel';
import PropertyLayoutEditor from '../../components/properties/PropertyLayoutEditor';

const TABS = [
  ['overview', 'Overview'],
  ['layout', 'Layout & Areas'],
  ['assets', 'Assets & Features'],
  ['access', 'Access & Keys'],
  ['people', 'Owners & Tenancies'],
  ['documents', 'Documents & Imports'],
  ['inspections', 'Inspections & Reports'],
  ['maintenance', 'Maintenance'],
  ['history', 'Property History'],
] as const;
type Tab = (typeof TABS)[number][0];

const REPORT_TYPES: InspectionReportType[] = ['Property Condition Report', 'Routine Inspection', 'Exit Inspection'];
const REPORT_DOCUMENT_TYPES = new Set<PropertyDocumentType>(['entry_report', 'routine_report', 'exit_report', 'maintenance_report', 'comparison_report']);
const TERMINAL_MAINTENANCE = new Set(['closed', 'dismissed', 'cancelled', 'duplicate', 'not_actionable']);

function label(value?: string): string {
  return value ? value.replaceAll('_', ' ').replace(/\b\w/gu, (character) => character.toUpperCase()) : 'Not configured';
}

function dateValue(value?: string): string {
  if (!value) return 'Not recorded';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}

const PropertyWorkspacePage: React.FC = () => {
  const { propertyId } = useParams<{ propertyId: string }>();
  const navigate = useNavigate();
  const [property, setProperty] = useState<PropertyRecord | null>(null);
  const [jobs, setJobs] = useState<InspectionJob[]>([]);
  const [reports, setReports] = useState<ReportData[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceItem[]>([]);
  const [tenancies, setTenancies] = useState<Tenancy[]>([]);
  const [portfolio, setPortfolio] = useState<PropertyRecord[]>([]);
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!propertyId) return;
    setLoading(true);
    setError(null);
    try {
      const record = await getProperty(propertyId);
      if (!record) {
        setProperty(null);
        return;
      }
      setProperty(record);
      const [jobList, reportList, maintenanceList, tenancyList, properties] = await Promise.all([
        listInspectionJobs().catch(() => [] as InspectionJob[]),
        getAllSavedReports().catch(() => [] as unknown[]),
        listMaintenanceItems().catch(() => [] as MaintenanceItem[]),
        listTenanciesForProperty(propertyId).catch(() => [] as Tenancy[]),
        listProperties().catch(() => [] as PropertyRecord[]),
      ]);
      setJobs(jobList.filter((item) => item.propertyId === propertyId));
      setReports((reportList as ReportData[]).filter((item) => item.propertyId === propertyId || item.propertyAddress?.includes(record.address)));
      setMaintenance(maintenanceList.filter((item) => item.propertyId === propertyId));
      setTenancies(tenancyList);
      setPortfolio(properties.filter((item) => item.id !== propertyId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Property workspace could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [propertyId]);

  const latestReport = useMemo(() => [...reports].sort((a, b) => String(b.inspectionDate || '').localeCompare(String(a.inspectionDate || '')))[0], [reports]);
  const upcomingJob = useMemo(() => [...jobs].filter((item) => item.scheduledAt && !['finalised', 'archived', 'cancelled'].includes(item.status)).sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)))[0], [jobs]);
  const openMaintenance = maintenance.filter((item) => !TERMINAL_MAINTENANCE.has(item.status));

  const savePatch = async (patch: Partial<PropertyRecord>) => {
    if (!property) return;
    setBusy(true);
    setError(null);
    try {
      setProperty(await updateProperty(property.id, patch));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Property update failed.');
    } finally {
      setBusy(false);
    }
  };

  const startInspection = async (reportType: InspectionReportType) => {
    if (!property) return;
    setBusy(true);
    setError(null);
    try {
      const tenancy = tenancies.find((item) => item.status === 'active');
      const job = await createInspectionJob({
        agencyId: property.agencyId,
        propertyId: property.id,
        tenancyId: tenancy?.id,
        reportType,
        scheduledAt: new Date().toISOString().slice(0, 10),
        status: 'draft',
        notes: `Created from the Property Workspace for ${property.address}. Active property alerts: ${(property.alerts || []).filter((item) => item.active).map((item) => item.message).join(' | ') || 'none'}`,
      });
      const aggregate = await createInspectionReportForJob(job, property, {
        clientName: property.landlordDetails?.name || property.ownershipHistory?.find((item) => item.isCurrent)?.ownerName || '',
        inspectionDate: new Date().toISOString().slice(0, 10),
      });
      navigate(`/app/admin/reports/${aggregate.report.id}/edit`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Inspection could not be started.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="flex h-64 items-center justify-center text-sm text-slate-500"><RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Loading property workspace...</div>;
  if (!property) return <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center"><Building2 className="mx-auto text-slate-300" size={36} /><h2 className="mt-3 font-bold">Property not found</h2><Link to="/app/admin/properties" className="mt-4 inline-flex text-sm font-semibold text-blue-600">Return to portfolio</Link></div>;

  const activeAlerts = (property.alerts || []).filter((item) => item.active);
  const isStrata = ['strata', 'survey_strata', 'community_title', 'company_title', 'common_property'].includes(property.ownershipStructure || '');

  return <div className="space-y-6 pb-16">
    <div><Link to="/app/admin/properties" className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900"><ArrowLeft size={14} /> Back to Property Portfolio</Link></div>

    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
        <div>
          <div className="flex flex-wrap gap-2 text-[11px] font-bold uppercase tracking-wide">
            <span className="rounded-lg bg-blue-50 px-2.5 py-1 text-blue-700">{label(property.propertyUse)}</span>
            <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-slate-700">{label(property.physicalPropertyType || property.propertyType)}</span>
            <span className="rounded-lg bg-violet-50 px-2.5 py-1 text-violet-700">{label(property.ownershipStructure)}</span>
            <span className={`rounded-lg px-2.5 py-1 ${property.onboarding?.status === 'ready_for_inspection' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{label(property.onboarding?.status || 'legacy_record')}</span>
          </div>
          <h1 className="mt-3 text-3xl font-black text-slate-950">{property.address}</h1>
          <p className="text-sm text-slate-500">{[property.suburb, property.state, property.postcode].filter(Boolean).join(' ')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {REPORT_TYPES.map((type) => <button key={type} disabled={busy} onClick={() => void startInspection(type)} className="rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white disabled:opacity-50">Start {type === 'Property Condition Report' ? 'Entry PCR' : type.replace(' Inspection', '')}</button>)}
          <button onClick={() => setTab('documents')} className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold">Upload Document</button>
        </div>
      </div>
      {activeAlerts.length > 0 && <div className="mt-5 grid gap-2 md:grid-cols-2">{activeAlerts.map((item) => <div key={item.id} className={`flex gap-2 rounded-xl border p-3 text-xs ${item.severity === 'critical' ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}><ShieldAlert size={16} className="shrink-0" /><span>{item.message}</span></div>)}</div>}
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Stat label="Configured Areas" value={String(property.roomsConfig?.length || 0)} />
        <Stat label="Documents" value={String(property.documents?.length || 0)} />
        <Stat label="Assets" value={String(property.assets?.length || 0)} />
        <Stat label="Open Maintenance" value={String(openMaintenance.length)} />
        <Stat label="Latest Inspection" value={latestReport ? dateValue(latestReport.inspectionDate) : 'None'} />
        <Stat label="Next Inspection" value={upcomingJob ? dateValue(upcomingJob.scheduledAt) : 'Not booked'} />
      </div>
    </section>

    {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}

    <nav className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">{TABS.map(([id, name]) => <button key={id} onClick={() => setTab(id)} className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold ${tab === id ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{name}</button>)}</nav>

    {tab === 'overview' && <OverviewTab property={property} jobs={jobs} reports={reports} maintenance={maintenance} isStrata={isStrata} onSave={savePatch} busy={busy} />}
    {tab === 'layout' && <PropertyLayoutEditor property={property} portfolio={portfolio} onSave={savePatch} busy={busy} />}
    {tab === 'assets' && <AssetsTab property={property} onSave={savePatch} busy={busy} />}
    {tab === 'access' && <AccessTab property={property} onSave={savePatch} busy={busy} />}
    {tab === 'people' && <PeopleTab property={property} tenancies={tenancies} onSave={savePatch} onReload={load} busy={busy} />}
    {tab === 'documents' && <DocumentsTab property={property} onReload={load} onSave={savePatch} busy={busy} />}
    {tab === 'inspections' && <InspectionsTab jobs={jobs} reports={reports} />}
    {tab === 'maintenance' && <MaintenanceTab items={maintenance} />}
    {tab === 'history' && <HistoryTab property={property} jobs={jobs} reports={reports} maintenance={maintenance} />}
  </div>;
};

const Stat: React.FC<{ label: string; value: string }> = ({ label: text, value }) => <div className="rounded-xl bg-slate-50 p-3"><div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{text}</div><div className="mt-1 text-sm font-bold text-slate-900">{value}</div></div>;

const OverviewTab: React.FC<{ property: PropertyRecord; jobs: InspectionJob[]; reports: ReportData[]; maintenance: MaintenanceItem[]; isStrata: boolean; onSave: (patch: Partial<PropertyRecord>) => Promise<void>; busy: boolean }> = ({ property, isStrata, onSave, busy }) => {
  const [alertText, setAlertText] = useState('');
  return <div className="grid gap-5 lg:grid-cols-3">
    <section className="rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-2"><h2 className="font-bold">Property Identity & Classification</h2><div className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><Info label="Property use" value={label(property.propertyUse)} /><Info label="Physical type" value={label(property.physicalPropertyType)} /><Info label="Ownership / management" value={label(property.ownershipStructure)} /><Info label="Occupancy" value={label(property.tenantDetails?.occupancyStatus)} /><Info label="Layout version" value={property.layoutVersions?.find((item) => item.id === property.currentLayoutVersionId)?.label || 'Legacy / unversioned'} /><Info label="Layout template" value={property.layoutTemplateId || 'Custom'} /></div>{isStrata && <div className="mt-5 rounded-xl bg-violet-50 p-4"><h3 className="text-xs font-bold uppercase text-violet-700">Strata Details</h3><div className="mt-3 grid gap-3 sm:grid-cols-2"><Info label="Scheme" value={property.strataDetails?.schemeName || 'Not recorded'} /><Info label="Plan" value={property.strataDetails?.strataPlanNumber || 'Not recorded'} /><Info label="Lot" value={property.strataDetails?.lotNumber || 'Not recorded'} /><Info label="Building" value={property.strataDetails?.buildingName || 'Not recorded'} /><Info label="Strata manager" value={property.strataDetails?.strataManagerName || 'Not recorded'} /><Info label="Parking bay" value={property.strataDetails?.allocatedParkingBay || 'Not recorded'} /></div></div>}</section>
    <section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-bold">Persistent Alerts</h2><div className="mt-3 space-y-2">{(property.alerts || []).filter((item) => item.active).map((item) => <div key={item.id} className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">⚠ {item.message}</div>)}</div><div className="mt-3 flex gap-2"><input value={alertText} onChange={(e) => setAlertText(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs" placeholder="Add inspection/access alert" /><button disabled={busy || !alertText.trim()} onClick={() => { const next = [...(property.alerts || []), { id: `alert-${generateId()}`, type: 'general' as const, severity: 'warning' as const, message: alertText.trim(), active: true, createdAt: new Date().toISOString() }]; setAlertText(''); void onSave({ alerts: next }); }} className="rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white">Add</button></div></section>
  </div>;
};

const Info: React.FC<{ label: string; value: string }> = ({ label: text, value }) => <div><div className="text-[10px] font-bold uppercase text-slate-400">{text}</div><div className="mt-1 font-medium text-slate-800">{value}</div></div>;

const LayoutTab: React.FC<{ property: PropertyRecord; portfolio: PropertyRecord[]; onSave: (patch: Partial<PropertyRecord>) => Promise<void>; busy: boolean }> = ({ property, portfolio, onSave, busy }) => {
  const [templateId, setTemplateId] = useState(property.layoutTemplateId || PROPERTY_LAYOUT_TEMPLATES[0].id);
  const [cloneId, setCloneId] = useState('');
  const [newArea, setNewArea] = useState('');
  const [newLevel, setNewLevel] = useState('Ground Floor');
  const saveRooms = (rooms: RoomConfigItem[], reason: string) => {
    const version = createLayoutVersion(property, rooms, reason, property.layoutTemplateId);
    const previous = (property.layoutVersions || []).map((item) => item.effectiveTo ? item : { ...item, effectiveTo: version.effectiveFrom });
    return onSave({ roomsConfig: rooms, layoutNodes: hierarchyFromRooms(rooms), layoutVersions: [...previous, version], currentLayoutVersionId: version.id });
  };
  return <div className="space-y-5">
    <section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center gap-2"><Layers3 size={18} /><h2 className="font-bold">Layout Templates & Versioning</h2></div><div className="mt-4 grid gap-3 lg:grid-cols-2"><div className="flex gap-2"><select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm">{PROPERTY_LAYOUT_TEMPLATES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button disabled={busy} onClick={() => { const template = PROPERTY_LAYOUT_TEMPLATES.find((item) => item.id === templateId); if (template) void onSave(applyLayoutTemplate(property, template)); }} className="rounded-xl bg-blue-600 px-4 text-xs font-semibold text-white">Apply as New Version</button></div><div className="flex gap-2"><select value={cloneId} onChange={(e) => setCloneId(e.target.value)} className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm"><option value="">Copy from another property...</option>{portfolio.map((item) => <option key={item.id} value={item.id}>{item.address}</option>)}</select><button disabled={busy || !cloneId} onClick={() => { const source = portfolio.find((item) => item.id === cloneId); if (source) void onSave(cloneLayoutFromProperty(property, source)); }} className="rounded-xl border border-slate-200 px-4 text-xs font-semibold">Copy Layout</button></div></div></section>
    <section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex justify-between"><div><h2 className="font-bold">Configured Areas</h2><p className="text-xs text-slate-500">Site → building → level → area structure is retained with each version.</p></div><span className="text-xs font-semibold text-slate-500">{property.roomsConfig?.length || 0} areas</span></div><div className="mt-4 space-y-2">{(property.roomsConfig || []).map((room, index) => <div key={room.id} className="grid gap-2 rounded-xl border border-slate-200 p-3 md:grid-cols-[40px_1fr_160px_160px_auto]"><div className="text-xs text-slate-400">{index + 1}</div><input value={room.name} onChange={(e) => { const rooms = (property.roomsConfig || []).map((item) => item.id === room.id ? { ...item, name: e.target.value } : item); void saveRooms(rooms, `Renamed area ${room.name}`); }} className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs" /><div className="text-xs capitalize text-slate-500">{room.roomType}</div><div className="text-xs text-slate-500">{room.floorLevel || 'Ground Floor'}</div><button disabled={busy} onClick={() => void saveRooms((property.roomsConfig || []).filter((item) => item.id !== room.id), `Removed area ${room.name}`)} className="text-xs font-semibold text-rose-600">Remove</button></div>)}</div><div className="mt-4 flex flex-wrap gap-2"><input value={newArea} onChange={(e) => setNewArea(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs" placeholder="New area name" /><input value={newLevel} onChange={(e) => setNewLevel(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs" placeholder="Level" /><button disabled={busy || !newArea.trim()} onClick={() => { const room: RoomConfigItem = { id: `area-${generateId()}`, name: newArea.trim(), roomType: 'other', floorLevel: newLevel.trim() || 'Ground Floor' }; setNewArea(''); void saveRooms([...(property.roomsConfig || []), room], `Added area ${room.name}`); }} className="rounded-xl bg-slate-900 px-4 text-xs font-semibold text-white"><Plus size={14} className="inline" /> Add Area</button></div></section>
    <section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-bold">Layout History</h2><div className="mt-3 space-y-2">{[...(property.layoutVersions || [])].reverse().map((version) => <div key={version.id} className="flex justify-between rounded-xl bg-slate-50 p-3 text-xs"><div><b>{version.label}</b><div className="text-slate-500">{version.changeReason || 'Layout snapshot'} · {version.roomsConfig.length} areas</div></div><div className="text-right text-slate-500">Effective {dateValue(version.effectiveFrom)}{version.effectiveTo ? <div>to {dateValue(version.effectiveTo)}</div> : <div className="font-semibold text-emerald-600">Current</div>}</div></div>)}</div></section>
  </div>;
};

const AssetsTab: React.FC<{ property: PropertyRecord; onSave: (patch: Partial<PropertyRecord>) => Promise<void>; busy: boolean }> = ({ property, onSave, busy }) => {
  const [name, setName] = useState(''); const [category, setCategory] = useState<PropertyAssetCategory>('appliance');
  return <section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center gap-2"><Boxes size={18} /><h2 className="font-bold">Asset & Appliance Register</h2></div><div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{(property.assets || []).map((asset) => <div key={asset.id} className="rounded-xl border border-slate-200 p-4"><div className="flex justify-between"><div><div className="font-semibold">{asset.name}</div><div className="text-xs capitalize text-slate-500">{asset.category.replaceAll('_', ' ')}</div></div><span className="text-[10px] font-bold uppercase text-emerald-600">{asset.status}</span></div><div className="mt-3 grid grid-cols-2 gap-2 text-xs"><Info label="Brand" value={asset.brand || 'Not recorded'} /><Info label="Model" value={asset.model || 'Not recorded'} /><Info label="Serial" value={asset.serialNumber || 'Not recorded'} /><Info label="Last tested" value={dateValue(asset.lastWorkingConfirmationAt)} /></div><button disabled={busy} onClick={() => void onSave({ assets: (property.assets || []).map((item) => item.id === asset.id ? { ...item, status: 'removed' } : item) })} className="mt-3 text-xs font-semibold text-rose-600">Mark removed</button></div>)}</div><div className="mt-5 flex flex-wrap gap-2"><input value={name} onChange={(e) => setName(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs" placeholder="Asset / appliance name" /><select value={category} onChange={(e) => setCategory(e.target.value as PropertyAssetCategory)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs"><option value="appliance">Appliance</option><option value="hvac">HVAC</option><option value="hot_water">Hot Water</option><option value="solar">Solar</option><option value="security">Security</option><option value="fire_safety">Fire Safety</option><option value="electrical">Electrical</option><option value="commercial_equipment">Commercial Equipment</option><option value="other">Other</option></select><button disabled={busy || !name.trim()} onClick={() => { const asset: PropertyAsset = { id: `asset-${generateId()}`, name: name.trim(), category, status: 'active' }; setName(''); void onSave({ assets: [...(property.assets || []), asset] }); }} className="rounded-xl bg-slate-900 px-4 text-xs font-semibold text-white">Add Asset</button></div></section>;
};

const AccessTab: React.FC<{ property: PropertyRecord; onSave: (patch: Partial<PropertyRecord>) => Promise<void>; busy: boolean }> = ({ property, onSave, busy }) => {
  const [name, setName] = useState(''); const [type, setType] = useState<AccessDeviceType>('key');
  return <div className="grid gap-5 lg:grid-cols-3"><section className="rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-2"><div className="flex items-center gap-2"><KeyRound size={18} /><h2 className="font-bold">Keys & Access Device Register</h2></div><div className="mt-4 space-y-2">{(property.accessDevices || []).map((item) => <div key={item.id} className="grid gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-[1fr_100px_120px_120px]"><div><b className="text-sm">{item.name}</b><div className="text-xs text-slate-500">{label(item.type)} {item.identifier ? `· ${item.identifier}` : ''}</div></div><div className="text-xs">Qty {item.quantity}</div><div className="text-xs capitalize">{item.status}</div><button disabled={busy} onClick={() => void onSave({ accessDevices: (property.accessDevices || []).map((candidate) => candidate.id === item.id ? { ...candidate, status: 'inactive' } : candidate) })} className="text-xs font-semibold text-rose-600">Deactivate</button></div>)}</div><div className="mt-4 flex flex-wrap gap-2"><input value={name} onChange={(e) => setName(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs" placeholder="Front door key" /><select value={type} onChange={(e) => setType(e.target.value as AccessDeviceType)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs"><option value="key">Key</option><option value="garage_remote">Garage Remote</option><option value="security_fob">Security Fob</option><option value="access_card">Access Card</option><option value="gate_remote">Gate Remote</option><option value="lockbox">Lockbox</option><option value="other">Other</option></select><button disabled={busy || !name.trim()} onClick={() => { const item: PropertyAccessDevice = { id: `access-${generateId()}`, type, name: name.trim(), quantity: 1, status: 'held' }; setName(''); void onSave({ accessDevices: [...(property.accessDevices || []), item] }); }} className="rounded-xl bg-slate-900 px-4 text-xs font-semibold text-white">Add Device</button></div></section><section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-bold">Legacy Access Notes</h2><div className="mt-3 space-y-3 text-sm"><Info label="Key number" value={property.accessDetails?.keyNumbers || 'Not recorded'} /><Info label="Lockbox" value={property.accessDetails?.lockboxCode || 'Not recorded'} /><Info label="Alarm" value={property.accessDetails?.alarmCode || 'Not recorded'} /><Info label="Access notes" value={property.accessDetails?.accessNotes || 'Not recorded'} /></div></section></div>;
};

const PeopleTab: React.FC<{ property: PropertyRecord; tenancies: Tenancy[]; onSave: (patch: Partial<PropertyRecord>) => Promise<void>; onReload: () => Promise<void>; busy: boolean }> = ({ property, tenancies, onSave, onReload, busy }) => {
  const [tenantName, setTenantName] = useState(''); const [tenantEmail, setTenantEmail] = useState(''); const [start, setStart] = useState(''); const [end, setEnd] = useState('');
  const addTenancy = async () => { if (!tenantName.trim()) return; const created = await createTenancy({ agencyId: property.agencyId, propertyId: property.id, tenantNames: [tenantName.trim()], tenantEmails: tenantEmail.trim() ? [tenantEmail.trim()] : [], leaseStartDate: start || undefined, leaseEndDate: end || undefined }); await onSave({ tenancyHistory: [...(property.tenancyHistory || []), { id: `history-${generateId()}`, tenancyId: created.id, tenantNames: created.tenantNames, tenantEmails: created.tenantEmails, leaseStartDate: created.leaseStartDate, leaseEndDate: created.leaseEndDate, status: 'current' }], tenantDetails: { ...property.tenantDetails, primaryTenantName: tenantName.trim(), primaryTenantEmail: tenantEmail.trim(), leaseStartDate: start, leaseEndDate: end, occupancyStatus: 'tenanted' } }); setTenantName(''); await onReload(); };
  return <div className="grid gap-5 lg:grid-cols-2"><section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center gap-2"><Users size={18} /><h2 className="font-bold">Ownership History</h2></div><div className="mt-4 space-y-2">{(property.ownershipHistory || []).length ? property.ownershipHistory!.map((owner) => <div key={owner.id} className="rounded-xl bg-slate-50 p-3 text-sm"><div className="font-semibold">{owner.ownerName}</div><div className="text-xs text-slate-500">{owner.companyName || owner.ownerEmail || 'No contact details'} · {owner.isCurrent ? 'Current owner' : `${dateValue(owner.startDate)} – ${dateValue(owner.endDate)}`}</div></div>) : <div className="text-sm text-slate-500">Current legacy owner: {property.landlordDetails?.name || 'Not configured'}</div>}</div></section><section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-bold">Canonical Tenancies</h2><div className="mt-4 space-y-2">{tenancies.map((tenancy) => <div key={tenancy.id} className="rounded-xl bg-slate-50 p-3 text-sm"><div className="font-semibold">{tenancy.tenantNames.join(', ')}</div><div className="text-xs text-slate-500">{dateValue(tenancy.leaseStartDate)} – {dateValue(tenancy.leaseEndDate)} · {tenancy.status}</div></div>)}</div><div className="mt-4 grid gap-2 sm:grid-cols-2"><input value={tenantName} onChange={(e) => setTenantName(e.target.value)} placeholder="Tenant name" className="rounded-lg border border-slate-200 px-3 py-2 text-xs" /><input value={tenantEmail} onChange={(e) => setTenantEmail(e.target.value)} placeholder="Tenant email" className="rounded-lg border border-slate-200 px-3 py-2 text-xs" /><input value={start} type="date" onChange={(e) => setStart(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs" /><input value={end} type="date" onChange={(e) => setEnd(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs" /></div><button disabled={busy || !tenantName.trim()} onClick={() => void addTenancy()} className="mt-3 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white">Add Tenancy</button></section></div>;
};

const DocumentsTab: React.FC<{ property: PropertyRecord; onReload: () => Promise<void>; onSave: (patch: Partial<PropertyRecord>) => Promise<void>; busy: boolean }> = ({ property, onReload, onSave, busy }) => {
  const [file, setFile] = useState<File | null>(null); const [type, setType] = useState<PropertyDocumentType>('entry_report'); const [inspectionDate, setInspectionDate] = useState(''); const [uploading, setUploading] = useState(false);
  const upload = async () => { if (!file) return; setUploading(true); try { await uploadPropertyDocument(property, file, { type, title: file.name, source: 'legacy_upload', inspectionDate: inspectionDate || undefined, useAsBaseline: type === 'entry_report' }); setFile(null); await onReload(); } finally { setUploading(false); } };
  const documents = [...(property.documents || [])].sort((a, b) => String(b.inspectionDate || b.uploadedAt).localeCompare(String(a.inspectionDate || a.uploadedAt)));
  return <div className="space-y-5"><section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center gap-2"><FileUp size={18} /><h2 className="font-bold">Upload Historical Report or Property Document</h2></div><p className="mt-1 text-xs text-slate-500">PDF, DOCX, XLSX, ZIP and common image formats are stored as immutable source files. Historical report extraction remains a human-reviewed candidate process.</p><div className="mt-4 grid gap-3 md:grid-cols-[1fr_190px_160px_auto]"><input type="file" accept=".pdf,.docx,.xlsx,.zip,.jpg,.jpeg,.png,.webp,.heic,.heif" onChange={(e) => setFile(e.target.files?.[0] || null)} className="rounded-xl border border-slate-200 p-2 text-xs" /><select value={type} onChange={(e) => setType(e.target.value as PropertyDocumentType)} className="rounded-xl border border-slate-200 px-3 text-xs"><option value="entry_report">Entry PCR</option><option value="routine_report">Routine Report</option><option value="exit_report">Exit Report</option><option value="maintenance_report">Maintenance Report</option><option value="floor_plan">Floor Plan</option><option value="building_plan">Building Plan</option><option value="furnishing_inventory">Furnishing Inventory</option><option value="compliance_certificate">Compliance / Safety</option><option value="appliance_manual">Appliance Manual</option><option value="strata_plan">Strata Plan</option><option value="strata_bylaw">Strata By-law</option><option value="other">Other</option></select><input type="date" value={inspectionDate} onChange={(e) => setInspectionDate(e.target.value)} className="rounded-xl border border-slate-200 px-3 text-xs" /><button disabled={busy || uploading || !file} onClick={() => void upload()} className="rounded-xl bg-blue-600 px-4 text-xs font-semibold text-white">{uploading ? 'Uploading...' : 'Upload & Verify'}</button></div></section><section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-bold">Documents & Imports</h2><div className="mt-4 space-y-2">{documents.length === 0 ? <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">No property documents uploaded yet.</div> : documents.map((document) => <DocumentRow key={document.id} document={document} property={property} onSave={onSave} />)}</div></section></div>;
};

const DocumentRow: React.FC<{ document: PropertyDocument; property: PropertyRecord; onSave: (patch: Partial<PropertyRecord>) => Promise<void> }> = ({ document, property, onSave }) => <div className="rounded-xl border border-slate-200 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><FileText size={15} className="text-blue-600" /><b className="text-sm">{document.title}</b></div><div className="mt-1 text-xs text-slate-500">{label(document.type)} · {dateValue(document.inspectionDate || document.uploadedAt)} · {document.sourceSystem || label(document.source)} · {Math.round(document.fileSize / 1024)} KB</div><div className="mt-1 font-mono text-[10px] text-slate-400">{document.sha256 ? `SHA-256 ${document.sha256.slice(0, 16)}…` : 'Local source file'} {document.generation ? `· generation ${document.generation}` : ''}</div></div><div className="flex gap-2"><span className={`rounded-lg px-2 py-1 text-[10px] font-bold uppercase ${document.importStatus === 'mapped' ? 'bg-emerald-50 text-emerald-700' : document.importStatus === 'analysis_pending' || document.importStatus === 'review_required' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>{label(document.importStatus)}</span>{REPORT_DOCUMENT_TYPES.has(document.type) && document.importStatus !== 'mapped' && <button onClick={() => { const candidates = document.mappingCandidates?.length ? document.mappingCandidates : [{ id: `map-${generateId()}`, sourceLabel: `${label(document.type)} source`, status: 'suggested' as const }]; void onSave({ documents: (property.documents || []).map((item) => item.id === document.id ? { ...item, importStatus: 'review_required', mappingCandidates: candidates } : item) }); }} className="rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-semibold">Prepare Mapping Review</button>}</div></div>{document.mappingCandidates && document.mappingCandidates.length > 0 && <div className="mt-3 rounded-lg bg-slate-50 p-3"><div className="text-[10px] font-bold uppercase text-slate-500">Historical mapping candidates</div>{document.mappingCandidates.map((candidate) => <div key={candidate.id} className="mt-2 flex items-center justify-between gap-3 text-xs"><span>{candidate.sourceLabel} → {candidate.proposedAreaId || 'Area requires human mapping'} {candidate.proposedComponentId ? `/ ${candidate.proposedComponentId}` : ''}</span><button onClick={() => void onSave({ documents: (property.documents || []).map((item) => item.id === document.id ? { ...item, importStatus: 'mapped', mappingCandidates: (item.mappingCandidates || []).map((entry) => ({ ...entry, status: 'confirmed' })) } : item) })} className="font-semibold text-emerald-700">Confirm Reviewed Mapping</button></div>)}</div>}</div>;

const InspectionsTab: React.FC<{ jobs: InspectionJob[]; reports: ReportData[] }> = ({ jobs, reports }) => <div className="grid gap-5 lg:grid-cols-2"><section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center gap-2"><ClipboardList size={18} /><h2 className="font-bold">Inspection Jobs</h2></div><div className="mt-4 space-y-2">{jobs.map((job) => <Link key={job.id} to={`/app/admin/jobs/${job.id}`} className="block rounded-xl border border-slate-200 p-3 hover:bg-slate-50"><div className="flex justify-between"><b className="text-sm">{job.reportType}</b><span className="text-xs capitalize text-slate-500">{job.status.replaceAll('_', ' ')}</span></div><div className="mt-1 text-xs text-slate-500">{dateValue(job.scheduledAt)}</div></Link>)}</div></section><section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center gap-2"><FileText size={18} /><h2 className="font-bold">Reports</h2></div><div className="mt-4 space-y-2">{reports.map((report) => <Link key={report.id} to={`/app/admin/reports/${report.id}`} className="block rounded-xl border border-slate-200 p-3 hover:bg-slate-50"><div className="flex justify-between"><b className="text-sm">{report.reportType}</b><span className="text-xs capitalize text-slate-500">{label(report.lifecycleStatus)}</span></div><div className="mt-1 text-xs text-slate-500">{dateValue(report.inspectionDate)}</div></Link>)}</div></section></div>;

const MaintenanceTab: React.FC<{ items: MaintenanceItem[] }> = ({ items }) => <section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between"><div className="flex items-center gap-2"><Wrench size={18} /><h2 className="font-bold">Property Maintenance</h2></div><Link to="/app/admin/maintenance" className="text-xs font-semibold text-blue-600">Open Maintenance Register</Link></div><div className="mt-4 grid gap-3 md:grid-cols-2">{items.map((item) => <Link key={item.id} to={`/app/admin/maintenance/${item.id}`} className="rounded-xl border border-slate-200 p-4 hover:bg-slate-50"><div className="flex justify-between gap-2"><b className="text-sm">{item.title}</b><span className="text-[10px] font-bold uppercase text-slate-500">{item.priority}</span></div><div className="mt-1 text-xs text-slate-500">{item.category} · {label(item.status)}</div>{item.sourceComponentId && <div className="mt-2 text-[11px] text-slate-400">Source component: {item.sourceComponentId}</div>}</Link>)}</div>{items.length === 0 && <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">No maintenance recorded for this property.</div>}</section>;

const HistoryTab: React.FC<{ property: PropertyRecord; jobs: InspectionJob[]; reports: ReportData[]; maintenance: MaintenanceItem[] }> = ({ property, jobs, reports, maintenance }) => {
  const timeline = [
    ...(property.documents || []).map((item) => ({ id: `doc-${item.id}`, date: item.inspectionDate || item.uploadedAt, title: item.title, detail: `Document · ${label(item.type)}` })),
    ...(property.layoutVersions || []).map((item) => ({ id: `layout-${item.id}`, date: item.effectiveFrom, title: item.label, detail: `Layout · ${item.changeReason || 'snapshot'}` })),
    ...reports.map((item) => ({ id: `report-${item.id}`, date: item.inspectionDate || item.createdAt || '', title: item.reportType, detail: `Report · ${label(item.lifecycleStatus)}` })),
    ...maintenance.map((item) => ({ id: `maintenance-${item.id}`, date: item.createdAt, title: item.title, detail: `Maintenance · ${label(item.status)}` })),
    ...jobs.filter((item) => !item.reportId).map((item) => ({ id: `job-${item.id}`, date: item.scheduledAt || item.createdAt, title: item.reportType, detail: `Inspection job · ${label(item.status)}` })),
  ].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return <div className="space-y-5"><section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center gap-2"><History size={18} /><h2 className="font-bold">Unified Property Timeline</h2></div><div className="mt-4 space-y-2">{timeline.map((item) => <div key={item.id} className="flex gap-4 rounded-xl bg-slate-50 p-3"><div className="w-24 shrink-0 text-xs font-semibold text-slate-500">{dateValue(item.date)}</div><div><div className="text-sm font-semibold">{item.title}</div><div className="text-xs text-slate-500">{item.detail}</div></div></div>)}</div></section><PropertyHistoryPanel propertyId={property.id} agencyId={property.agencyId} /></div>;
};

export default PropertyWorkspacePage;
