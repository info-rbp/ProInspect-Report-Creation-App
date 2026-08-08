import React, { useState } from 'react';
import {
  Bath,
  Bed,
  Building,
  Car,
  Check,
  ChevronRight,
  Key,
  Layers,
  MapPin,
  Sparkles,
  Trash2,
  User,
  Users,
  X,
} from 'lucide-react';
import type {
  AccessDetails,
  LandlordDetails,
  PropertyFeatures,
  PropertyRecord,
  RoomConfigItem,
  RoomType,
  TenantDetails,
} from '../../types/platform';
import { generateId } from '../../utils';

interface PropertyFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: Partial<PropertyRecord>) => Promise<void>;
  initialData?: PropertyRecord | null;
}

const PROPERTY_TYPES: PropertyRecord['propertyType'][] = [
  'house',
  'apartment',
  'unit',
  'townhouse',
  'villa',
  'duplex',
  'commercial',
  'other',
];

const ROOM_TYPES: { label: string; value: RoomType }[] = [
  { label: 'Bedroom', value: 'bedroom' },
  { label: 'Bathroom / Ensuite', value: 'bathroom' },
  { label: 'Living Area', value: 'living' },
  { label: 'Kitchen', value: 'kitchen' },
  { label: 'Dining Area', value: 'dining' },
  { label: 'Outdoor / Balcony / Patio', value: 'outdoor' },
  { label: 'Laundry', value: 'laundry' },
  { label: 'Garage / Carport', value: 'garage' },
  { label: 'Study / Office', value: 'study' },
  { label: 'Hallway / Entry', value: 'hallway' },
  { label: 'Storage / Shed', value: 'storage' },
  { label: 'Other Space', value: 'other' },
];

export const PropertyFormModal: React.FC<PropertyFormModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialData,
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'rooms' | 'landlord' | 'tenant' | 'access'>('overview');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // General Form State
  const [address, setAddress] = useState(initialData?.address || '');
  const [suburb, setSuburb] = useState(initialData?.suburb || '');
  const [state, setState] = useState(initialData?.state || 'WA');
  const [postcode, setPostcode] = useState(initialData?.postcode || '');
  const [propertyType, setPropertyType] = useState<PropertyRecord['propertyType']>(initialData?.propertyType || 'house');
  const [bedrooms, setBedrooms] = useState<number>(initialData?.bedrooms ?? 3);
  const [bathrooms, setBathrooms] = useState<number>(initialData?.bathrooms ?? 2);
  const [parking, setParking] = useState<number>(initialData?.parking ?? 1);
  const [livingAreas, setLivingAreas] = useState<number>(initialData?.livingAreas ?? 1);
  const [googleDriveFolderId, setGoogleDriveFolderId] = useState(initialData?.googleDriveFolderId || '');
  const [notes, setNotes] = useState(initialData?.notes || '');

  // Room Layout State
  const [roomsConfig, setRoomsConfig] = useState<RoomConfigItem[]>(
    initialData?.roomsConfig && initialData.roomsConfig.length > 0
      ? initialData.roomsConfig
      : [
          { id: 'rm-1', name: 'Master Bedroom', roomType: 'bedroom', floorLevel: 'Ground Floor' },
          { id: 'rm-2', name: 'Ensuite Bathroom', roomType: 'bathroom', floorLevel: 'Ground Floor' },
          { id: 'rm-3', name: 'Bedroom 2', roomType: 'bedroom', floorLevel: 'Ground Floor' },
          { id: 'rm-4', name: 'Main Bathroom', roomType: 'bathroom', floorLevel: 'Ground Floor' },
          { id: 'rm-5', name: 'Living Room', roomType: 'living', floorLevel: 'Ground Floor' },
          { id: 'rm-6', name: 'Kitchen', roomType: 'kitchen', floorLevel: 'Ground Floor' },
        ],
  );

  // Landlord Details State
  const [landlord, setLandlord] = useState<LandlordDetails>({
    name: initialData?.landlordDetails?.name || '',
    email: initialData?.landlordDetails?.email || '',
    phone: initialData?.landlordDetails?.phone || '',
    companyName: initialData?.landlordDetails?.companyName || '',
    address: initialData?.landlordDetails?.address || '',
    contactPreference: initialData?.landlordDetails?.contactPreference || 'email',
    notes: initialData?.landlordDetails?.notes || '',
  });

  // Tenant Details State
  const [tenant, setTenant] = useState<TenantDetails>({
    primaryTenantName: initialData?.tenantDetails?.primaryTenantName || '',
    primaryTenantEmail: initialData?.tenantDetails?.primaryTenantEmail || '',
    primaryTenantPhone: initialData?.tenantDetails?.primaryTenantPhone || '',
    additionalTenants: initialData?.tenantDetails?.additionalTenants || [],
    leaseStartDate: initialData?.tenantDetails?.leaseStartDate || '',
    leaseEndDate: initialData?.tenantDetails?.leaseEndDate || '',
    rentAmount: initialData?.tenantDetails?.rentAmount || undefined,
    rentFrequency: initialData?.tenantDetails?.rentFrequency || 'weekly',
    emergencyContactName: initialData?.tenantDetails?.emergencyContactName || '',
    emergencyContactPhone: initialData?.tenantDetails?.emergencyContactPhone || '',
    occupancyStatus: initialData?.tenantDetails?.occupancyStatus || 'tenanted',
    notes: initialData?.tenantDetails?.notes || '',
  });

  // Access & Features State
  const [access, setAccess] = useState<AccessDetails>({
    keyNumbers: initialData?.accessDetails?.keyNumbers || '',
    lockboxCode: initialData?.accessDetails?.lockboxCode || '',
    alarmCode: initialData?.accessDetails?.alarmCode || '',
    accessNotes: initialData?.accessDetails?.accessNotes || '',
  });

  const [features, setFeatures] = useState<PropertyFeatures>({
    airConditioning: initialData?.features?.airConditioning ?? true,
    heating: initialData?.features?.heating ?? false,
    dishwasher: initialData?.features?.dishwasher ?? true,
    pool: initialData?.features?.pool ?? false,
    furnished: initialData?.features?.furnished ?? false,
    petsAllowed: initialData?.features?.petsAllowed ?? false,
    solar: initialData?.features?.solar ?? false,
    courtyard: initialData?.features?.courtyard ?? false,
    balcony: initialData?.features?.balcony ?? false,
    securitySystem: initialData?.features?.securitySystem ?? false,
  });

  if (!isOpen) return null;

  // Auto-generate rooms based on bedroom and bathroom counts
  const handleAutoGenerateRooms = () => {
    const generated: RoomConfigItem[] = [];
    for (let i = 1; i <= bedrooms; i++) {
      generated.push({
        id: generateId(),
        name: i === 1 ? 'Master Bedroom' : `Bedroom ${i}`,
        roomType: 'bedroom',
        floorLevel: 'Ground Floor',
      });
    }
    for (let i = 1; i <= bathrooms; i++) {
      generated.push({
        id: generateId(),
        name: i === 1 && bedrooms > 1 ? 'Ensuite Bathroom' : `Bathroom ${i}`,
        roomType: 'bathroom',
        floorLevel: 'Ground Floor',
      });
    }
    for (let i = 1; i <= livingAreas; i++) {
      generated.push({
        id: generateId(),
        name: i === 1 ? 'Living Room' : `Living Area ${i}`,
        roomType: 'living',
        floorLevel: 'Ground Floor',
      });
    }
    generated.push({ id: generateId(), name: 'Kitchen', roomType: 'kitchen', floorLevel: 'Ground Floor' });
    generated.push({ id: generateId(), name: 'Dining Area', roomType: 'dining', floorLevel: 'Ground Floor' });
    generated.push({ id: generateId(), name: 'Laundry', roomType: 'laundry', floorLevel: 'Ground Floor' });
    if (parking > 0) {
      generated.push({ id: generateId(), name: 'Garage / Carport', roomType: 'garage', floorLevel: 'Ground Floor' });
    }
    setRoomsConfig(generated);
  };

  const handleAddRoom = (type: RoomType = 'other', defaultName = 'New Room') => {
    setRoomsConfig((prev) => [
      ...prev,
      {
        id: generateId(),
        name: defaultName,
        roomType: type,
        floorLevel: 'Ground Floor',
      },
    ]);
  };

  const handleUpdateRoom = (id: string, updates: Partial<RoomConfigItem>) => {
    setRoomsConfig((prev) => prev.map((r) => (r.id === id ? { ...r, ...updates } : r)));
  };

  const handleRemoveRoom = (id: string) => {
    setRoomsConfig((prev) => prev.filter((r) => r.id !== id));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address.trim()) {
      setErrorMsg('Property address is required.');
      setActiveTab('overview');
      return;
    }
    setErrorMsg(null);
    setIsSubmitting(true);

    try {
      await onSave({
        address: address.trim(),
        suburb: suburb.trim(),
        state: state.trim(),
        postcode: postcode.trim(),
        propertyType,
        bedrooms: Number(bedrooms),
        bathrooms: Number(bathrooms),
        parking: Number(parking),
        livingAreas: Number(livingAreas),
        roomsConfig,
        landlordDetails: landlord,
        tenantDetails: tenant,
        accessDetails: access,
        features,
        googleDriveFolderId: googleDriveFolderId.trim(),
        notes: notes.trim(),
      });
      onClose();
    } catch (err) {
      setErrorMsg((err as Error).message || 'Failed to save property. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-gray-950/60 p-4 backdrop-blur-sm">
      <div className="relative flex max-h-[92vh] w-full max-w-4xl flex-col rounded-2xl border border-gray-200 bg-white shadow-2xl transition-all">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-blue-600">
              <Building size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-950">
                {initialData ? `Edit Property — ${initialData.address}` : 'Add New Property'}
              </h2>
              <p className="text-xs text-gray-500">Configure address, rooms, landlord, tenant & access parameters</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-gray-100 bg-gray-50/50 px-6">
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-semibold transition ${
              activeTab === 'overview'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-950'
            }`}
          >
            <MapPin size={15} /> 1. Address & Overview
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('rooms')}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-semibold transition ${
              activeTab === 'rooms'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-950'
            }`}
          >
            <Layers size={15} /> 2. Rooms & Layout ({roomsConfig.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('landlord')}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-semibold transition ${
              activeTab === 'landlord'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-950'
            }`}
          >
            <User size={15} /> 3. Landlord / Owner
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('tenant')}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-semibold transition ${
              activeTab === 'tenant'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-950'
            }`}
          >
            <Users size={15} /> 4. Tenant & Lease
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('access')}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-semibold transition ${
              activeTab === 'access'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-950'
            }`}
          >
            <Key size={15} /> 5. Access & Features
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6">
            {errorMsg && (
              <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-700">
                {errorMsg}
              </div>
            )}

            {/* TAB 1: OVERVIEW & ADDRESS */}
            {activeTab === 'overview' && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-sm font-bold text-gray-950">Property Location</h3>
                  <p className="text-xs text-gray-500">Primary street address and location classification</p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-gray-700">
                      Street Address <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. 104 Ocean Drive or 15/88 Beaufort Street"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-sm transition focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700">Suburb</label>
                    <input
                      type="text"
                      placeholder="e.g. Scarborough"
                      value={suburb}
                      onChange={(e) => setSuburb(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-sm transition focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-gray-700">State</label>
                      <select
                        value={state}
                        onChange={(e) => setState(e.target.value)}
                        className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-sm transition focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                      >
                        <option value="WA">WA</option>
                        <option value="NSW">NSW</option>
                        <option value="VIC">VIC</option>
                        <option value="QLD">QLD</option>
                        <option value="SA">SA</option>
                        <option value="TAS">TAS</option>
                        <option value="ACT">ACT</option>
                        <option value="NT">NT</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700">Postcode</label>
                      <input
                        type="text"
                        placeholder="6019"
                        value={postcode}
                        onChange={(e) => setPostcode(e.target.value)}
                        className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-sm transition focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                      />
                    </div>
                  </div>
                </div>

                <hr className="border-gray-100" />

                <div>
                  <h3 className="text-sm font-bold text-gray-950">Structural Overview & Counts</h3>
                  <p className="text-xs text-gray-500">Property classification and capacity metrics</p>
                </div>

                <div className="grid gap-4 sm:grid-cols-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700">Property Type</label>
                    <select
                      value={propertyType}
                      onChange={(e) => setPropertyType(e.target.value as PropertyRecord['propertyType'])}
                      className="mt-1 w-full capitalize rounded-xl border border-gray-300 p-2.5 text-sm transition focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                    >
                      {PROPERTY_TYPES.map((pt) => (
                        <option key={pt} value={pt} className="capitalize">
                          {pt}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="flex items-center gap-1 text-xs font-medium text-gray-700">
                      <Bed size={13} /> Bedrooms
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={20}
                      value={bedrooms}
                      onChange={(e) => setBedrooms(parseInt(e.target.value) || 0)}
                      className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-sm transition focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                    />
                  </div>

                  <div>
                    <label className="flex items-center gap-1 text-xs font-medium text-gray-700">
                      <Bath size={13} /> Bathrooms
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={20}
                      value={bathrooms}
                      onChange={(e) => setBathrooms(parseInt(e.target.value) || 0)}
                      className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-sm transition focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                    />
                  </div>

                  <div>
                    <label className="flex items-center gap-1 text-xs font-medium text-gray-700">
                      <Car size={13} /> Parking Spaces
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={10}
                      value={parking}
                      onChange={(e) => setParking(parseInt(e.target.value) || 0)}
                      className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-sm transition focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-700">Living Areas Count</label>
                    <input
                      type="number"
                      min={0}
                      max={10}
                      value={livingAreas}
                      onChange={(e) => setLivingAreas(parseInt(e.target.value) || 0)}
                      className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-sm transition focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700">Google Drive Folder URL / ID</label>
                    <input
                      type="text"
                      placeholder="Folder ID or URL for photos & assets"
                      value={googleDriveFolderId}
                      onChange={(e) => setGoogleDriveFolderId(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-sm transition focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: ROOMS & LAYOUT */}
            {activeTab === 'rooms' && (
              <div className="space-y-5">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <div>
                    <h3 className="text-sm font-bold text-gray-950">Room Configuration & Breakdown</h3>
                    <p className="text-xs text-gray-500">
                      These rooms will automatically seed the inspection report template when starting an inspection.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleAutoGenerateRooms}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                  >
                    <Sparkles size={14} /> Auto-Generate From Counts
                  </button>
                </div>

                {/* Quick Add Preset Bar */}
                <div className="flex flex-wrap items-center gap-2 rounded-xl bg-gray-50 p-3 text-xs">
                  <span className="font-semibold text-gray-700">Quick Add:</span>
                  <button
                    type="button"
                    onClick={() => handleAddRoom('bedroom', `Bedroom ${roomsConfig.filter((r) => r.roomType === 'bedroom').length + 1}`)}
                    className="rounded-lg bg-white border border-gray-200 px-2.5 py-1 font-medium hover:border-gray-400"
                  >
                    + Bedroom
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddRoom('bathroom', `Bathroom ${roomsConfig.filter((r) => r.roomType === 'bathroom').length + 1}`)}
                    className="rounded-lg bg-white border border-gray-200 px-2.5 py-1 font-medium hover:border-gray-400"
                  >
                    + Bathroom
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddRoom('living', 'Living Room')}
                    className="rounded-lg bg-white border border-gray-200 px-2.5 py-1 font-medium hover:border-gray-400"
                  >
                    + Living Area
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddRoom('outdoor', 'Balcony / Patio')}
                    className="rounded-lg bg-white border border-gray-200 px-2.5 py-1 font-medium hover:border-gray-400"
                  >
                    + Balcony/Patio
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddRoom('garage', 'Garage')}
                    className="rounded-lg bg-white border border-gray-200 px-2.5 py-1 font-medium hover:border-gray-400"
                  >
                    + Garage
                  </button>
                </div>

                {/* Rooms List */}
                <div className="space-y-3">
                  {roomsConfig.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-xs text-gray-500">
                      No rooms added yet. Click &quot;Auto-Generate&quot; or use the quick add buttons above.
                    </div>
                  ) : (
                    roomsConfig.map((rm, idx) => (
                      <div
                        key={rm.id}
                        className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-3.5 shadow-sm sm:flex-row sm:items-center"
                      >
                        <span className="grid h-6 w-6 place-items-center rounded-lg bg-gray-100 text-xs font-bold text-gray-600">
                          {idx + 1}
                        </span>

                        <div className="flex-1 sm:w-1/3">
                          <input
                            type="text"
                            placeholder="Room name (e.g. Master Bedroom)"
                            value={rm.name}
                            onChange={(e) => handleUpdateRoom(rm.id, { name: e.target.value })}
                            className="w-full rounded-lg border border-gray-300 p-2 text-xs font-semibold text-gray-900 focus:border-blue-600 focus:outline-none"
                          />
                        </div>

                        <div className="sm:w-1/4">
                          <select
                            value={rm.roomType}
                            onChange={(e) => handleUpdateRoom(rm.id, { roomType: e.target.value as RoomType })}
                            className="w-full rounded-lg border border-gray-300 p-2 text-xs focus:border-blue-600 focus:outline-none"
                          >
                            {ROOM_TYPES.map((rt) => (
                              <option key={rt.value} value={rt.value}>
                                {rt.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="sm:w-1/4">
                          <input
                            type="text"
                            placeholder="Floor level / Notes"
                            value={rm.floorLevel || ''}
                            onChange={(e) => handleUpdateRoom(rm.id, { floorLevel: e.target.value })}
                            className="w-full rounded-lg border border-gray-300 p-2 text-xs focus:border-blue-600 focus:outline-none"
                          />
                        </div>

                        <button
                          type="button"
                          onClick={() => handleRemoveRoom(rm.id)}
                          className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* TAB 3: LANDLORD / OWNER */}
            {activeTab === 'landlord' && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-sm font-bold text-gray-950">Landlord / Owner Profile</h3>
                  <p className="text-xs text-gray-500">Contact & organizational details for the property owner</p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-700">Landlord Full Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Eleanor Vance"
                      value={landlord.name || ''}
                      onChange={(e) => setLandlord((prev) => ({ ...prev, name: e.target.value }))}
                      className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-sm transition focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700">Company / Investment Entity</label>
                    <input
                      type="text"
                      placeholder="e.g. Vance Investments Pty Ltd"
                      value={landlord.companyName || ''}
                      onChange={(e) => setLandlord((prev) => ({ ...prev, companyName: e.target.value }))}
                      className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-sm transition focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700">Email Address</label>
                    <input
                      type="email"
                      placeholder="eleanor.vance@example.com"
                      value={landlord.email || ''}
                      onChange={(e) => setLandlord((prev) => ({ ...prev, email: e.target.value }))}
                      className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-sm transition focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700">Phone Number</label>
                    <input
                      type="text"
                      placeholder="0412 345 678"
                      value={landlord.phone || ''}
                      onChange={(e) => setLandlord((prev) => ({ ...prev, phone: e.target.value }))}
                      className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-sm transition focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-gray-700">Mailing / Business Address</label>
                    <input
                      type="text"
                      placeholder="12 St Georges Terrace, Perth WA 6000"
                      value={landlord.address || ''}
                      onChange={(e) => setLandlord((prev) => ({ ...prev, address: e.target.value }))}
                      className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-sm transition focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700">Preferred Contact Method</label>
                    <select
                      value={landlord.contactPreference || 'email'}
                      onChange={(e) => setLandlord((prev) => ({ ...prev, contactPreference: e.target.value as 'email' | 'phone' | 'sms' }))}
                      className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-sm transition focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                    >
                      <option value="email">Email</option>
                      <option value="phone">Phone Call</option>
                      <option value="sms">SMS</option>
                    </select>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-gray-700">Landlord Special Instructions / Notes</label>
                    <textarea
                      rows={2}
                      placeholder="e.g. Prefers email updates for repairs over $200"
                      value={landlord.notes || ''}
                      onChange={(e) => setLandlord((prev) => ({ ...prev, notes: e.target.value }))}
                      className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-sm transition focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* TAB 4: TENANT & LEASE */}
            {activeTab === 'tenant' && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-sm font-bold text-gray-950">Tenant & Tenancy Details</h3>
                  <p className="text-xs text-gray-500">Current lease terms and occupant contact information</p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-700">Occupancy Status</label>
                    <select
                      value={tenant.occupancyStatus || 'tenanted'}
                      onChange={(e) => setTenant((prev) => ({ ...prev, occupancyStatus: e.target.value as TenantDetails['occupancyStatus'] }))}
                      className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-sm transition focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                    >
                      <option value="tenanted">Tenanted (Active Lease)</option>
                      <option value="vacant">Vacant</option>
                      <option value="notice_given">Notice Given (Vacating Soon)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700">Primary Tenant Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Marcus Miller"
                      value={tenant.primaryTenantName || ''}
                      onChange={(e) => setTenant((prev) => ({ ...prev, primaryTenantName: e.target.value }))}
                      className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-sm transition focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700">Tenant Email</label>
                    <input
                      type="email"
                      placeholder="marcus.miller@example.com"
                      value={tenant.primaryTenantEmail || ''}
                      onChange={(e) => setTenant((prev) => ({ ...prev, primaryTenantEmail: e.target.value }))}
                      className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-sm transition focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700">Tenant Phone</label>
                    <input
                      type="text"
                      placeholder="0499 888 777"
                      value={tenant.primaryTenantPhone || ''}
                      onChange={(e) => setTenant((prev) => ({ ...prev, primaryTenantPhone: e.target.value }))}
                      className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-sm transition focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700">Lease Start Date</label>
                    <input
                      type="date"
                      value={tenant.leaseStartDate || ''}
                      onChange={(e) => setTenant((prev) => ({ ...prev, leaseStartDate: e.target.value }))}
                      className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-sm transition focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700">Lease End Date</label>
                    <input
                      type="date"
                      value={tenant.leaseEndDate || ''}
                      onChange={(e) => setTenant((prev) => ({ ...prev, leaseEndDate: e.target.value }))}
                      className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-sm transition focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-gray-700">Rent Amount ($)</label>
                      <input
                        type="number"
                        placeholder="780"
                        value={tenant.rentAmount || ''}
                        onChange={(e) => setTenant((prev) => ({ ...prev, rentAmount: parseFloat(e.target.value) || undefined }))}
                        className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-sm transition focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700">Frequency</label>
                      <select
                        value={tenant.rentFrequency || 'weekly'}
                        onChange={(e) => setTenant((prev) => ({ ...prev, rentFrequency: e.target.value as TenantDetails['rentFrequency'] }))}
                        className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-sm transition focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                      >
                        <option value="weekly">Weekly</option>
                        <option value="fortnightly">Fortnightly</option>
                        <option value="monthly">Monthly</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-gray-700">Emergency Contact</label>
                      <input
                        type="text"
                        placeholder="Name & Relationship"
                        value={tenant.emergencyContactName || ''}
                        onChange={(e) => setTenant((prev) => ({ ...prev, emergencyContactName: e.target.value }))}
                        className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-sm transition focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700">Emergency Phone</label>
                      <input
                        type="text"
                        placeholder="Phone Number"
                        value={tenant.emergencyContactPhone || ''}
                        onChange={(e) => setTenant((prev) => ({ ...prev, emergencyContactPhone: e.target.value }))}
                        className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-sm transition focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                      />
                    </div>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-gray-700">Tenancy Notes</label>
                    <textarea
                      rows={2}
                      placeholder="Special lease conditions, pet details, parking arrangements..."
                      value={tenant.notes || ''}
                      onChange={(e) => setTenant((prev) => ({ ...prev, notes: e.target.value }))}
                      className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-sm transition focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* TAB 5: ACCESS & FEATURES */}
            {activeTab === 'access' && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-sm font-bold text-gray-950">Property Access & Key Management</h3>
                  <p className="text-xs text-gray-500">Security credentials for inspector and property manager entry</p>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700">Key Tag / Reference Numbers</label>
                    <input
                      type="text"
                      placeholder="e.g. KEY-402A / 402B"
                      value={access.keyNumbers || ''}
                      onChange={(e) => setAccess((prev) => ({ ...prev, keyNumbers: e.target.value }))}
                      className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-sm transition focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700">Lockbox Code</label>
                    <input
                      type="text"
                      placeholder="e.g. 8492"
                      value={access.lockboxCode || ''}
                      onChange={(e) => setAccess((prev) => ({ ...prev, lockboxCode: e.target.value }))}
                      className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-sm transition focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700">Alarm Pin Code</label>
                    <input
                      type="text"
                      placeholder="e.g. 1984"
                      value={access.alarmCode || ''}
                      onChange={(e) => setAccess((prev) => ({ ...prev, alarmCode: e.target.value }))}
                      className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-sm transition focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                    />
                  </div>

                  <div className="sm:col-span-3">
                    <label className="block text-xs font-medium text-gray-700">Access Instructions / Notes</label>
                    <input
                      type="text"
                      placeholder="e.g. Lockbox located on side gas meter box left of garage entrance."
                      value={access.accessNotes || ''}
                      onChange={(e) => setAccess((prev) => ({ ...prev, accessNotes: e.target.value }))}
                      className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-sm transition focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                    />
                  </div>
                </div>

                <hr className="border-gray-100" />

                <div>
                  <h3 className="text-sm font-bold text-gray-950">Property Features & Amenities</h3>
                  <p className="text-xs text-gray-500">Toggle amenities present at this property</p>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
                    const isChecked = !!features[feat.key as keyof PropertyFeatures];
                    return (
                      <button
                        key={feat.key}
                        type="button"
                        onClick={() =>
                          setFeatures((prev) => ({
                            ...prev,
                            [feat.key]: !prev[feat.key as keyof PropertyFeatures],
                          }))
                        }
                        className={`flex items-center gap-2 rounded-xl border p-2.5 text-xs font-medium transition text-left ${
                          isChecked
                            ? 'border-blue-600 bg-blue-50/80 text-blue-900'
                            : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <div
                          className={`grid h-4 w-4 place-items-center rounded ${
                            isChecked ? 'bg-blue-600 text-white' : 'border border-gray-300 bg-white'
                          }`}
                        >
                          {isChecked && <Check size={12} />}
                        </div>
                        {feat.label}
                      </button>
                    );
                  })}
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700">General Property Notes</label>
                  <textarea
                    rows={3}
                    placeholder="General property background, special instructions, historical repairs..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-sm transition focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Modal Footer */}
          <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50/50 px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-xs font-semibold text-gray-700 hover:bg-gray-100"
            >
              Cancel
            </button>

            <div className="flex items-center gap-2">
              {activeTab !== 'overview' && (
                <button
                  type="button"
                  onClick={() => {
                    const tabs: Array<'overview' | 'rooms' | 'landlord' | 'tenant' | 'access'> = [
                      'overview',
                      'rooms',
                      'landlord',
                      'tenant',
                      'access',
                    ];
                    const idx = tabs.indexOf(activeTab);
                    if (idx > 0) setActiveTab(tabs[idx - 1]);
                  }}
                  className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-100"
                >
                  Previous Step
                </button>
              )}

              {activeTab !== 'access' ? (
                <button
                  type="button"
                  onClick={() => {
                    const tabs: Array<'overview' | 'rooms' | 'landlord' | 'tenant' | 'access'> = [
                      'overview',
                      'rooms',
                      'landlord',
                      'tenant',
                      'access',
                    ];
                    const idx = tabs.indexOf(activeTab);
                    if (idx < tabs.length - 1) setActiveTab(tabs[idx + 1]);
                  }}
                  className="inline-flex items-center gap-1 rounded-xl bg-gray-950 px-4 py-2 text-xs font-semibold text-white hover:bg-gray-800"
                >
                  Next Step <ChevronRight size={14} />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
                >
                  {isSubmitting ? (
                    'Saving Property...'
                  ) : (
                    <>
                      <Check size={15} /> Save Property Record
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
