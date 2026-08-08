import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bath,
  Bed,
  Building,
  Car,
  ChevronRight,
  Edit,
  Grid,
  Home,
  Key,
  Layers,
  List,
  Plus,
  Search,
  User,
  Users,
} from 'lucide-react';
import type { PropertyRecord } from '../../types/platform';
import { createProperty, listProperties, updateProperty } from '../../services/platform/propertyService';
import { DEFAULT_AGENCY_ID } from '../../services/platform/userProfileService';
import { PropertyFormModal } from '../../components/properties/PropertyFormModal';

export const PropertiesPage: React.FC = () => {
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProperty, setEditingProperty] = useState<PropertyRecord | null>(null);

  const loadProperties = async () => {
    setLoading(true);
    try {
      const records = await listProperties();
      setProperties(records);
    } catch (err) {
      console.error('Failed to load properties:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProperties();
  }, []);

  const handleOpenAddModal = () => {
    setEditingProperty(null);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (prop: PropertyRecord) => {
    setEditingProperty(prop);
    setIsModalOpen(true);
  };

  const handleSaveProperty = async (data: Partial<PropertyRecord>) => {
    if (editingProperty) {
      await updateProperty(editingProperty.id, data);
    } else {
      await createProperty({
        agencyId: DEFAULT_AGENCY_ID,
        address: data.address || '',
        suburb: data.suburb,
        state: data.state,
        postcode: data.postcode,
        propertyType: data.propertyType,
        bedrooms: data.bedrooms,
        bathrooms: data.bathrooms,
        parking: data.parking,
        livingAreas: data.livingAreas,
        roomsConfig: data.roomsConfig,
        landlordDetails: data.landlordDetails,
        tenantDetails: data.tenantDetails,
        accessDetails: data.accessDetails,
        features: data.features,
        googleDriveFolderId: data.googleDriveFolderId,
        notes: data.notes,
      });
    }
    await loadProperties();
  };

  // Filtered Properties
  const filteredProperties = useMemo(() => {
    return properties.filter((prop) => {
      const query = searchQuery.toLowerCase().trim();
      const matchSearch =
        !query ||
        prop.address.toLowerCase().includes(query) ||
        (prop.suburb && prop.suburb.toLowerCase().includes(query)) ||
        (prop.landlordDetails?.name && prop.landlordDetails.name.toLowerCase().includes(query)) ||
        (prop.tenantDetails?.primaryTenantName && prop.tenantDetails.primaryTenantName.toLowerCase().includes(query));

      const matchType = typeFilter === 'all' || prop.propertyType === typeFilter;

      const occStatus = prop.tenantDetails?.occupancyStatus || 'tenanted';
      const matchStatus = statusFilter === 'all' || occStatus === statusFilter;

      return matchSearch && matchType && matchStatus;
    });
  }, [properties, searchQuery, typeFilter, statusFilter]);

  // Aggregate stats
  const totalProperties = properties.length;
  const tenantedCount = properties.filter((p) => (p.tenantDetails?.occupancyStatus || 'tenanted') === 'tenanted').length;
  const vacantCount = properties.filter((p) => p.tenantDetails?.occupancyStatus === 'vacant').length;
  const totalRoomsCount = properties.reduce((acc, p) => acc + (p.roomsConfig?.length || 0), 0);

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-950">Property Portfolio</h1>
          <p className="mt-1 text-xs text-gray-500">
            Manage agency property records, room layouts, landlord contacts, and active tenant details.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleOpenAddModal}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 transition"
          >
            <Plus size={16} /> Add Property
          </button>
        </div>
      </div>

      {/* Metric Cards Banner */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between text-gray-500">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Properties</span>
            <Building size={18} className="text-blue-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-gray-950">{totalProperties}</span>
            <span className="text-xs text-gray-500">managed</span>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between text-gray-500">
            <span className="text-xs font-semibold uppercase tracking-wider">Tenanted</span>
            <Users size={18} className="text-emerald-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-gray-950">{tenantedCount}</span>
            <span className="text-xs text-emerald-600 font-medium">Active Leases</span>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between text-gray-500">
            <span className="text-xs font-semibold uppercase tracking-wider">Vacant</span>
            <Home size={18} className="text-amber-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-gray-950">{vacantCount}</span>
            <span className="text-xs text-amber-600 font-medium">Ready for Lease</span>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between text-gray-500">
            <span className="text-xs font-semibold uppercase tracking-wider">Configured Rooms</span>
            <Layers size={18} className="text-purple-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-gray-950">{totalRoomsCount}</span>
            <span className="text-xs text-gray-500">across portfolio</span>
          </div>
        </div>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="flex flex-col gap-3 rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm md:flex-row md:items-center md:justify-between">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search by address, suburb, landlord, or tenant..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-gray-200 pl-10 pr-4 py-2 text-xs font-medium focus:border-blue-600 focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 focus:border-blue-600 focus:outline-none"
          >
            <option value="all">All Types</option>
            <option value="house">House</option>
            <option value="apartment">Apartment</option>
            <option value="unit">Unit</option>
            <option value="townhouse">Townhouse</option>
            <option value="villa">Villa</option>
            <option value="duplex">Duplex</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 focus:border-blue-600 focus:outline-none"
          >
            <option value="all">All Occupancy</option>
            <option value="tenanted">Tenanted</option>
            <option value="vacant">Vacant</option>
            <option value="notice_given">Notice Given</option>
          </select>

          <div className="flex items-center rounded-xl border border-gray-200 p-0.5 bg-gray-50">
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              className={`rounded-lg p-1.5 transition ${viewMode === 'grid' ? 'bg-white shadow text-blue-600' : 'text-gray-400 hover:text-gray-700'}`}
              title="Grid View"
            >
              <Grid size={15} />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`rounded-lg p-1.5 transition ${viewMode === 'table' ? 'bg-white shadow text-blue-600' : 'text-gray-400 hover:text-gray-700'}`}
              title="Table View"
            >
              <List size={15} />
            </button>
          </div>
        </div>
      </div>

      {/* Property Display Section */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-64 animate-pulse rounded-2xl border border-gray-200 bg-gray-50 p-5" />
          ))}
        </div>
      ) : filteredProperties.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-12 text-center">
          <Building size={36} className="mx-auto text-gray-400" />
          <h3 className="mt-3 text-sm font-bold text-gray-950">No properties match your filter</h3>
          <p className="mt-1 text-xs text-gray-500">Try adjusting your search criteria or add a new property record.</p>
          <button
            type="button"
            onClick={handleOpenAddModal}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
          >
            <Plus size={15} /> Add Property
          </button>
        </div>
      ) : viewMode === 'grid' ? (
        /* GRID VIEW */
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filteredProperties.map((prop) => {
            const roomCount = prop.roomsConfig?.length || 0;
            const occStatus = prop.tenantDetails?.occupancyStatus || 'tenanted';

            return (
              <div
                key={prop.id}
                className="group relative flex flex-col justify-between rounded-2xl border border-gray-200/90 bg-white p-5 shadow-sm transition hover:border-gray-300 hover:shadow-md"
              >
                <div>
                  {/* Badges Bar */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="capitalize rounded-lg bg-gray-100 px-2.5 py-1 text-[11px] font-semibold text-gray-700">
                      {prop.propertyType || 'house'}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold capitalize ${
                        occStatus === 'tenanted'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : occStatus === 'vacant'
                          ? 'bg-amber-50 text-amber-700 border border-amber-200'
                          : 'bg-blue-50 text-blue-700 border border-blue-200'
                      }`}
                    >
                      {occStatus}
                    </span>
                  </div>

                  {/* Address */}
                  <h3 className="mt-3 text-base font-bold text-gray-950 transition group-hover:text-blue-600">
                    <Link to={`/app/admin/properties/${prop.id}`}>{prop.address}</Link>
                  </h3>
                  <p className="text-xs text-gray-500">
                    {[prop.suburb, prop.state, prop.postcode].filter(Boolean).join(', ')}
                  </p>

                  {/* Room & Capacity Pills */}
                  <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-semibold text-gray-700">
                    <span className="flex items-center gap-1 rounded-lg bg-gray-50 px-2 py-1 border border-gray-100">
                      <Bed size={13} className="text-gray-500" /> {prop.bedrooms ?? 0} Bed
                    </span>
                    <span className="flex items-center gap-1 rounded-lg bg-gray-50 px-2 py-1 border border-gray-100">
                      <Bath size={13} className="text-gray-500" /> {prop.bathrooms ?? 0} Bath
                    </span>
                    <span className="flex items-center gap-1 rounded-lg bg-gray-50 px-2 py-1 border border-gray-100">
                      <Car size={13} className="text-gray-500" /> {prop.parking ?? 0} Park
                    </span>
                    <span className="flex items-center gap-1 rounded-lg bg-blue-50 px-2 py-1 border border-blue-100 text-blue-700">
                      <Layers size={13} /> {roomCount} Rooms
                    </span>
                  </div>

                  {/* Landlord & Tenant Quick info */}
                  <div className="mt-4 space-y-2 rounded-xl bg-gray-50/80 p-3 text-xs">
                    <div className="flex items-center justify-between text-gray-600">
                      <span className="flex items-center gap-1.5 font-medium text-gray-500">
                        <User size={13} /> Landlord:
                      </span>
                      <span className="font-semibold text-gray-900">
                        {prop.landlordDetails?.name || 'Not configured'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-gray-600">
                      <span className="flex items-center gap-1.5 font-medium text-gray-500">
                        <Users size={13} /> Tenant:
                      </span>
                      <span className="font-semibold text-gray-900">
                        {prop.tenantDetails?.primaryTenantName || 'Vacant / None'}
                      </span>
                    </div>
                    {prop.accessDetails?.lockboxCode && (
                      <div className="flex items-center justify-between text-gray-600 pt-1 border-t border-gray-200/60">
                        <span className="flex items-center gap-1.5 font-medium text-gray-500">
                          <Key size={13} /> Lockbox Code:
                        </span>
                        <span className="font-mono font-bold text-gray-950">{prop.accessDetails.lockboxCode}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Card Actions Footer */}
                <div className="mt-5 flex items-center justify-between border-t border-gray-100 pt-3">
                  <button
                    type="button"
                    onClick={() => handleOpenEditModal(prop)}
                    className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-100 hover:text-gray-950 transition"
                  >
                    <Edit size={13} /> Edit Property
                  </button>

                  <Link
                    to={`/app/admin/properties/${prop.id}`}
                    className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-800 transition"
                  >
                    Details <ChevronRight size={14} />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* TABLE VIEW */
        <div className="overflow-hidden rounded-2xl border border-gray-200/90 bg-white shadow-sm">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50 text-gray-500 uppercase tracking-wider font-bold border-b border-gray-200">
              <tr>
                <th className="p-3.5">Property Address</th>
                <th className="p-3.5">Type & Layout</th>
                <th className="p-3.5">Rooms</th>
                <th className="p-3.5">Landlord</th>
                <th className="p-3.5">Tenant Details</th>
                <th className="p-3.5">Occupancy</th>
                <th className="p-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredProperties.map((prop) => (
                <tr key={prop.id} className="hover:bg-gray-50/80 transition">
                  <td className="p-3.5">
                    <Link to={`/app/admin/properties/${prop.id}`} className="font-bold text-gray-950 hover:text-blue-600">
                      {prop.address}
                    </Link>
                    <p className="text-[11px] text-gray-500">
                      {[prop.suburb, prop.state, prop.postcode].filter(Boolean).join(', ')}
                    </p>
                  </td>
                  <td className="p-3.5 capitalize font-medium text-gray-700">
                    <div>{prop.propertyType || 'house'}</div>
                    <div className="text-[11px] text-gray-500 font-normal">
                      {prop.bedrooms ?? 0}B / {prop.bathrooms ?? 0}B / {prop.parking ?? 0}P
                    </div>
                  </td>
                  <td className="p-3.5 font-medium text-gray-900">
                    <span className="rounded-md bg-blue-50 px-2 py-0.5 text-blue-700 font-bold">
                      {prop.roomsConfig?.length || 0} rooms
                    </span>
                  </td>
                  <td className="p-3.5 text-gray-700">
                    <div className="font-medium text-gray-900">{prop.landlordDetails?.name || '-'}</div>
                    <div className="text-[11px] text-gray-500">{prop.landlordDetails?.phone || ''}</div>
                  </td>
                  <td className="p-3.5 text-gray-700">
                    <div className="font-medium text-gray-900">{prop.tenantDetails?.primaryTenantName || '-'}</div>
                    <div className="text-[11px] text-gray-500">{prop.tenantDetails?.primaryTenantPhone || ''}</div>
                  </td>
                  <td className="p-3.5 capitalize">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                        (prop.tenantDetails?.occupancyStatus || 'tenanted') === 'tenanted'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-amber-50 text-amber-700 border border-amber-200'
                      }`}
                    >
                      {prop.tenantDetails?.occupancyStatus || 'tenanted'}
                    </span>
                  </td>
                  <td className="p-3.5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => handleOpenEditModal(prop)}
                        className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                        title="Edit Property"
                      >
                        <Edit size={15} />
                      </button>
                      <Link
                        to={`/app/admin/properties/${prop.id}`}
                        className="rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-800 hover:bg-gray-200"
                      >
                        View
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Property Add/Edit Form Modal */}
      <PropertyFormModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveProperty}
        initialData={editingProperty}
      />
    </div>
  );
};

export default PropertiesPage;
