import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Bath,
  Bed,
  Building,
  Car,
  CheckCircle2,
  ClipboardList,
  Edit,
  ExternalLink,
  FileText,
  Home,
  Key,
  Layers,
  Mail,
  Phone,
  Plus,
  Sparkles,
  User,
  Users,
} from 'lucide-react';
import type { InspectionJob, PropertyRecord } from '../../types/platform';
import type { ReportData } from '../../types';
import { getProperty, updateProperty } from '../../services/platform/propertyService';
import { PropertyFormModal } from '../../components/properties/PropertyFormModal';
import { listInspectionJobs, createInspectionJob } from '../../services/platform/inspectionJobService';
import { getAllSavedReports, saveReportToDB } from '../../services/storageService';
import { DEFAULT_AGENCY_ID } from '../../services/platform/userProfileService';
import { generateId } from '../../utils';

export const PropertyDetailPage: React.FC = () => {
  const { propertyId } = useParams<{ propertyId: string }>();
  const navigate = useNavigate();

  const [property, setProperty] = useState<PropertyRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'rooms' | 'people' | 'inspections'>('overview');

  // Edit Modal State
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  // Linked Jobs & Reports
  const [linkedJobs, setLinkedJobs] = useState<InspectionJob[]>([]);
  const [linkedReports, setLinkedReports] = useState<ReportData[]>([]);

  const loadData = async () => {
    if (!propertyId) return;
    setLoading(true);
    try {
      const record = await getProperty(propertyId);
      setProperty(record || null);

      if (record) {
        // Load linked inspection jobs
        const allJobs = await listInspectionJobs();
        const matches = allJobs.filter((j) => j.propertyId === propertyId);
        setLinkedJobs(matches);

        // Load linked reports
        const allReports = (await getAllSavedReports()) as unknown as ReportData[];
        const reportMatches = allReports.filter((r) => r.propertyId === propertyId || r.propertyAddress === record.address);
        setLinkedReports(reportMatches);
      }
    } catch (err) {
      console.error('Failed to load property details:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [propertyId]);

  const handleSavePropertyEdit = async (updatedData: Partial<PropertyRecord>) => {
    if (!propertyId) return;
    const updated = await updateProperty(propertyId, updatedData);
    setProperty(updated);
    await loadData();
  };

  const handleCreateInspectionJob = async (reportType: string = 'Property Condition Report') => {
    if (!property) return;
    try {
      const newJob = await createInspectionJob({
        agencyId: property.agencyId || DEFAULT_AGENCY_ID,
        propertyId: property.id,
        reportType: reportType as any,
        scheduledAt: new Date().toISOString().split('T')[0],
        status: 'draft',
        notes: `Created for property ${property.address}`,
      });

      // Also create draft report seed with property rooms
      const reportId = `rep-${generateId()}`;
      const roomsSeed = (property.roomsConfig || []).map((rm) => ({
        id: rm.id,
        name: rm.name,
        status: 'draft' as const,
        items: [
          { id: `item-${rm.id}-1`, name: 'Walls & Skirting', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
          { id: `item-${rm.id}-2`, name: 'Doors, Lock & Handles', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
          { id: `item-${rm.id}-3`, name: 'Flooring / Carpet', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
          { id: `item-${rm.id}-4`, name: 'Light Switches & Fixtures', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
        ],
        photos: [],
        overallComment: rm.notes || '',
      }));

      await saveReportToDB({
        id: reportId,
        agencyId: property.agencyId,
        propertyId: property.id,
        inspectionJobId: newJob.id,
        propertyAddress: `${property.address}${property.suburb ? `, ${property.suburb}` : ''}`,
        agentName: 'ProInspect Operations',
        agentCompany: 'ProInspect Management',
        clientName: property.landlordDetails?.name || 'Property Owner',
        inspectionDate: new Date().toISOString().split('T')[0],
        tenantName: property.tenantDetails?.primaryTenantName || 'Current Tenant',
        reportType,
        rooms: roomsSeed,
      } as any);

      navigate(`/app/admin/reports/${reportId}/edit`);
    } catch (err) {
      console.error('Failed to create inspection job:', err);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 p-8">
        <div className="h-8 w-1/3 animate-pulse rounded-xl bg-gray-200" />
        <div className="h-64 w-full animate-pulse rounded-2xl bg-gray-100" />
      </div>
    );
  }

  if (!property) {
    return (
      <div className="space-y-4 p-8 text-center">
        <Building size={40} className="mx-auto text-gray-400" />
        <h2 className="text-lg font-bold text-gray-950">Property Not Found</h2>
        <p className="text-xs text-gray-500">The requested property record could not be found or has been removed.</p>
        <Link
          to="/app/admin/properties"
          className="inline-flex items-center gap-2 rounded-xl bg-gray-950 px-4 py-2 text-xs font-semibold text-white"
        >
          <ArrowLeft size={14} /> Return to Properties
        </Link>
      </div>
    );
  }

  const occStatus = property.tenantDetails?.occupancyStatus || 'tenanted';
  const roomsCount = property.roomsConfig?.length || 0;

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header Navigation */}
      <div>
        <Link
          to="/app/admin/properties"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-950 transition"
        >
          <ArrowLeft size={14} /> Back to Property Portfolio
        </Link>
      </div>

      {/* Main Title Banner */}
      <div className="flex flex-col justify-between gap-4 rounded-2xl border border-gray-200/90 bg-white p-6 shadow-sm lg:flex-row lg:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="capitalize rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-bold text-gray-700">
              {property.propertyType || 'house'}
            </span>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-bold capitalize ${
                occStatus === 'tenanted'
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : occStatus === 'vacant'
                  ? 'bg-amber-50 text-amber-700 border border-amber-200'
                  : 'bg-blue-50 text-blue-700 border border-blue-200'
              }`}
            >
              {occStatus}
            </span>
            {property.googleDriveFolderId && (
              <span className="flex items-center gap-1 rounded-lg bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">
                <ExternalLink size={12} /> Drive Linked
              </span>
            )}
          </div>

          <h1 className="mt-2 text-2xl font-black text-gray-950 sm:text-3xl">{property.address}</h1>
          <p className="mt-0.5 text-xs font-medium text-gray-500">
            {[property.suburb, property.state, property.postcode].filter(Boolean).join(' ')}
          </p>

          {/* Specs bar */}
          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs font-semibold text-gray-700">
            <span className="flex items-center gap-1.5 rounded-xl bg-gray-50 px-3 py-1.5 border border-gray-100">
              <Bed size={14} className="text-gray-500" /> {property.bedrooms ?? 0} Bedrooms
            </span>
            <span className="flex items-center gap-1.5 rounded-xl bg-gray-50 px-3 py-1.5 border border-gray-100">
              <Bath size={14} className="text-gray-500" /> {property.bathrooms ?? 0} Bathrooms
            </span>
            <span className="flex items-center gap-1.5 rounded-xl bg-gray-50 px-3 py-1.5 border border-gray-100">
              <Car size={14} className="text-gray-500" /> {property.parking ?? 0} Parking
            </span>
            <span className="flex items-center gap-1.5 rounded-xl bg-blue-50 px-3 py-1.5 border border-blue-100 text-blue-700">
              <Layers size={14} /> {roomsCount} Configured Rooms
            </span>
          </div>
        </div>

        {/* Header Quick Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setIsEditModalOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-xs font-semibold text-gray-800 shadow-sm hover:bg-gray-50 transition"
          >
            <Edit size={15} /> Edit Property
          </button>

          <button
            type="button"
            onClick={() => handleCreateInspectionJob('Property Condition Report')}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 transition"
          >
            <Plus size={16} /> Start PCR Inspection
          </button>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex border-b border-gray-200 bg-white rounded-xl px-4 shadow-sm">
        <button
          type="button"
          onClick={() => setActiveTab('overview')}
          className={`flex items-center gap-2 border-b-2 px-4 py-3.5 text-xs font-bold transition ${
            activeTab === 'overview'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-600 hover:text-gray-950'
          }`}
        >
          <Home size={15} /> Overview & Access
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('rooms')}
          className={`flex items-center gap-2 border-b-2 px-4 py-3.5 text-xs font-bold transition ${
            activeTab === 'rooms'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-600 hover:text-gray-950'
          }`}
        >
          <Layers size={15} /> Room Breakdown ({roomsCount})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('people')}
          className={`flex items-center gap-2 border-b-2 px-4 py-3.5 text-xs font-bold transition ${
            activeTab === 'people'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-600 hover:text-gray-950'
          }`}
        >
          <Users size={15} /> Landlord & Tenant
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('inspections')}
          className={`flex items-center gap-2 border-b-2 px-4 py-3.5 text-xs font-bold transition ${
            activeTab === 'inspections'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-600 hover:text-gray-950'
          }`}
        >
          <ClipboardList size={15} /> Inspections & Reports ({linkedReports.length + linkedJobs.length})
        </button>
      </div>

      {/* TAB CONTENT 1: OVERVIEW & ACCESS */}
      {activeTab === 'overview' && (
        <div className="grid gap-6 md:grid-cols-3">
          {/* Access & Security Credentials Card */}
          <div className="rounded-2xl border border-gray-200/90 bg-white p-5 shadow-sm space-y-4">
            <div className="flex items-center gap-2 text-gray-950 font-bold text-sm">
              <Key size={18} className="text-blue-600" />
              Access & Security Credentials
            </div>

            <div className="space-y-3 text-xs">
              <div className="rounded-xl bg-gray-50 p-3">
                <span className="block text-[11px] font-medium text-gray-500 uppercase">Key Tag / Number</span>
                <span className="font-mono font-bold text-gray-900 text-sm">
                  {property.accessDetails?.keyNumbers || 'Not assigned'}
                </span>
              </div>

              <div className="rounded-xl bg-gray-50 p-3">
                <span className="block text-[11px] font-medium text-gray-500 uppercase">Lockbox PIN</span>
                <span className="font-mono font-bold text-gray-900 text-sm">
                  {property.accessDetails?.lockboxCode || 'Not configured'}
                </span>
              </div>

              <div className="rounded-xl bg-gray-50 p-3">
                <span className="block text-[11px] font-medium text-gray-500 uppercase">Alarm Pin Code</span>
                <span className="font-mono font-bold text-gray-900 text-sm">
                  {property.accessDetails?.alarmCode || 'No alarm set'}
                </span>
              </div>

              {property.accessDetails?.accessNotes && (
                <div className="rounded-xl bg-amber-50/80 border border-amber-200 p-3 text-amber-900">
                  <span className="block font-bold text-[11px]">Access Instructions:</span>
                  <p className="mt-0.5">{property.accessDetails.accessNotes}</p>
                </div>
              )}
            </div>
          </div>

          {/* Features & Amenities Card */}
          <div className="rounded-2xl border border-gray-200/90 bg-white p-5 shadow-sm space-y-4 md:col-span-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-gray-950 font-bold text-sm">
                <Sparkles size={18} className="text-amber-500" />
                Property Amenities & Features
              </div>
              <button
                type="button"
                onClick={() => setIsEditModalOpen(true)}
                className="text-xs text-blue-600 hover:underline font-semibold"
              >
                Edit Features
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {[
                { key: 'airConditioning', label: 'Air Conditioning' },
                { key: 'heating', label: 'Heating' },
                { key: 'dishwasher', label: 'Dishwasher' },
                { key: 'pool', label: 'Swimming Pool' },
                { key: 'solar', label: 'Solar Panels' },
                { key: 'furnished', label: 'Furnished' },
                { key: 'petsAllowed', label: 'Pets Allowed' },
                { key: 'courtyard', label: 'Courtyard / Garden' },
                { key: 'balcony', label: 'Balcony' },
                { key: 'securitySystem', label: 'Security System' },
              ].map((feat) => {
                const isPresent = !!property.features?.[feat.key as keyof typeof property.features];
                return (
                  <div
                    key={feat.key}
                    className={`flex items-center gap-2 rounded-xl p-3 text-xs font-medium border ${
                      isPresent
                        ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900 font-semibold'
                        : 'border-gray-100 bg-gray-50 text-gray-400'
                    }`}
                  >
                    <CheckCircle2 size={15} className={isPresent ? 'text-emerald-600' : 'text-gray-300'} />
                    {feat.label}
                  </div>
                );
              })}
            </div>

            {property.notes && (
              <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-700">
                <span className="font-bold text-gray-900 block mb-1">Internal Property Notes:</span>
                <p className="whitespace-pre-line">{property.notes}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB CONTENT 2: ROOM BREAKDOWN */}
      {activeTab === 'rooms' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-2xl border border-gray-200/90 bg-white p-4 shadow-sm">
            <div>
              <h3 className="text-sm font-bold text-gray-950">Configured Room Inventory</h3>
              <p className="text-xs text-gray-500">
                These preset rooms define the inspection structure for Property Condition Reports (PCR).
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsEditModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-800 hover:bg-gray-100"
            >
              <Edit size={14} /> Edit Room Layout
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(property.roomsConfig || []).map((rm, idx) => (
              <div key={rm.id || idx} className="rounded-2xl border border-gray-200/90 bg-white p-4 shadow-sm space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md">
                    {rm.roomType}
                  </span>
                  <span className="text-[11px] font-semibold text-gray-400">
                    {rm.floorLevel || 'Ground Floor'}
                  </span>
                </div>

                <h4 className="text-sm font-bold text-gray-950">{rm.name}</h4>

                {rm.notes ? (
                  <p className="text-xs text-gray-600 bg-gray-50 p-2.5 rounded-xl border border-gray-100">
                    {rm.notes}
                  </p>
                ) : (
                  <p className="text-xs text-gray-400 italic">Standard inspection area</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB CONTENT 3: LANDLORD & TENANT */}
      {activeTab === 'people' && (
        <div className="grid gap-6 md:grid-cols-2">
          {/* Landlord Card */}
          <div className="rounded-2xl border border-gray-200/90 bg-white p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2 text-gray-950 font-bold text-sm">
                <User size={18} className="text-blue-600" />
                Landlord / Owner Details
              </div>
              <button
                type="button"
                onClick={() => setIsEditModalOpen(true)}
                className="text-xs text-blue-600 font-semibold hover:underline"
              >
                Edit
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <span className="text-gray-500 block text-[11px]">Full Name / Owner</span>
                <span className="font-bold text-gray-950 text-sm">
                  {property.landlordDetails?.name || 'Not configured'}
                </span>
              </div>

              {property.landlordDetails?.companyName && (
                <div>
                  <span className="text-gray-500 block text-[11px]">Company / Entity</span>
                  <span className="font-semibold text-gray-800">{property.landlordDetails.companyName}</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-100">
                <div>
                  <span className="text-gray-500 block text-[11px]">Email Address</span>
                  <a
                    href={`mailto:${property.landlordDetails?.email}`}
                    className="font-medium text-blue-600 hover:underline flex items-center gap-1"
                  >
                    <Mail size={12} /> {property.landlordDetails?.email || '-'}
                  </a>
                </div>
                <div>
                  <span className="text-gray-500 block text-[11px]">Phone Number</span>
                  <a
                    href={`tel:${property.landlordDetails?.phone}`}
                    className="font-medium text-gray-900 flex items-center gap-1"
                  >
                    <Phone size={12} /> {property.landlordDetails?.phone || '-'}
                  </a>
                </div>
              </div>

              {property.landlordDetails?.address && (
                <div>
                  <span className="text-gray-500 block text-[11px]">Mailing Address</span>
                  <span className="font-medium text-gray-800">{property.landlordDetails.address}</span>
                </div>
              )}

              {property.landlordDetails?.notes && (
                <div className="rounded-xl bg-gray-50 p-3 text-gray-700">
                  <span className="font-bold block text-[11px]">Landlord Notes:</span>
                  <p className="mt-0.5">{property.landlordDetails.notes}</p>
                </div>
              )}
            </div>
          </div>

          {/* Tenant Card */}
          <div className="rounded-2xl border border-gray-200/90 bg-white p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2 text-gray-950 font-bold text-sm">
                <Users size={18} className="text-emerald-600" />
                Tenant & Lease Information
              </div>
              <button
                type="button"
                onClick={() => setIsEditModalOpen(true)}
                className="text-xs text-blue-600 font-semibold hover:underline"
              >
                Edit
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-gray-500 block text-[11px]">Primary Tenant</span>
                  <span className="font-bold text-gray-950 text-sm">
                    {property.tenantDetails?.primaryTenantName || 'Vacant'}
                  </span>
                </div>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold capitalize ${
                    occStatus === 'tenanted'
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : 'bg-amber-50 text-amber-700 border border-amber-200'
                  }`}
                >
                  {occStatus}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-100">
                <div>
                  <span className="text-gray-500 block text-[11px]">Email</span>
                  <a
                    href={`mailto:${property.tenantDetails?.primaryTenantEmail}`}
                    className="font-medium text-blue-600 hover:underline flex items-center gap-1"
                  >
                    <Mail size={12} /> {property.tenantDetails?.primaryTenantEmail || '-'}
                  </a>
                </div>
                <div>
                  <span className="text-gray-500 block text-[11px]">Phone</span>
                  <a
                    href={`tel:${property.tenantDetails?.primaryTenantPhone}`}
                    className="font-medium text-gray-900 flex items-center gap-1"
                  >
                    <Phone size={12} /> {property.tenantDetails?.primaryTenantPhone || '-'}
                  </a>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-100">
                <div>
                  <span className="text-gray-500 block text-[11px]">Lease Period</span>
                  <span className="font-semibold text-gray-900">
                    {property.tenantDetails?.leaseStartDate || 'N/A'} — {property.tenantDetails?.leaseEndDate || 'N/A'}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500 block text-[11px]">Rent Amount</span>
                  <span className="font-bold text-emerald-700">
                    ${property.tenantDetails?.rentAmount || 0} / {property.tenantDetails?.rentFrequency || 'week'}
                  </span>
                </div>
              </div>

              {property.tenantDetails?.emergencyContactName && (
                <div className="rounded-xl bg-gray-50 p-3 text-gray-800">
                  <span className="font-bold block text-[11px]">Emergency Contact:</span>
                  <p>
                    {property.tenantDetails.emergencyContactName} ({property.tenantDetails.emergencyContactPhone})
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT 4: LINKED INSPECTIONS */}
      {activeTab === 'inspections' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-2xl border border-gray-200/90 bg-white p-4 shadow-sm">
            <div>
              <h3 className="text-sm font-bold text-gray-950">Linked Inspection Reports & Jobs</h3>
              <p className="text-xs text-gray-500">History of property condition reports conducted for this address.</p>
            </div>
            <button
              type="button"
              onClick={() => handleCreateInspectionJob('Property Condition Report')}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
            >
              <Plus size={15} /> New PCR Report
            </button>
          </div>

          {linkedReports.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center text-xs text-gray-500">
              No reports found for this property. Click &quot;New PCR Report&quot; to begin an entry condition inspection.
            </div>
          ) : (
            <div className="grid gap-3">
              {linkedReports.map((rep) => (
                <div
                  key={rep.id}
                  className="flex flex-col justify-between gap-3 rounded-2xl border border-gray-200/90 bg-white p-4 shadow-sm sm:flex-row sm:items-center"
                >
                  <div className="flex items-center gap-3">
                    <div className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-blue-600">
                      <FileText size={20} />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-gray-950">{rep.reportType || 'Property Condition Report'}</h4>
                      <p className="text-xs text-gray-500">
                        Date: {rep.inspectionDate || 'Not set'} • {rep.rooms?.length || 0} Rooms Inspected
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Link
                      to={`/app/admin/reports/${rep.id}/edit`}
                      className="rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-800 hover:bg-gray-100"
                    >
                      Edit Report
                    </Link>
                    <Link
                      to={`/app/admin/reports/${rep.id}/preview`}
                      className="rounded-xl bg-gray-950 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-800"
                    >
                      View PDF Preview
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Edit Property Form Modal */}
      <PropertyFormModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        onSave={handleSavePropertyEdit}
        initialData={property}
      />
    </div>
  );
};

export default PropertyDetailPage;
