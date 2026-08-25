import { generateId } from '../../utils';
import type { OwnershipStructure, PhysicalPropertyType, PropertyRecord, PropertyUse } from '../../types/platform';
import { apiRequest } from '../apiClient';
import { isFirebaseConfigured } from '../storageService';
import { localGet, localList, localPut } from './localPlatformStore';

export type CreatePropertyInput = Omit<PropertyRecord, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'clientIds'> & Partial<Pick<PropertyRecord, 'clientIds' | 'status'>> & { id?: string };
type VersionedProperty = PropertyRecord & { version?: number };

function inferredUse(property: PropertyRecord): PropertyUse {
  if (property.propertyUse) return property.propertyUse;
  return property.propertyType === 'commercial' ? 'commercial' : 'residential';
}
function inferredPhysicalType(property: PropertyRecord): PhysicalPropertyType {
  if (property.physicalPropertyType) return property.physicalPropertyType;
  if (property.propertyType === 'commercial') return 'office';
  return (property.propertyType || 'house') as PhysicalPropertyType;
}
function inferredOwnership(property: PropertyRecord): OwnershipStructure {
  if (property.ownershipStructure) return property.ownershipStructure;
  return ['apartment', 'unit'].includes(property.propertyType || '') ? 'strata' : 'unknown';
}
export function normalisePropertyRecord(property: PropertyRecord): PropertyRecord {
  return {
    ...property,
    propertyUse: inferredUse(property),
    physicalPropertyType: inferredPhysicalType(property),
    ownershipStructure: inferredOwnership(property),
    roomsConfig: property.roomsConfig || [],
    layoutNodes: property.layoutNodes || [],
    layoutVersions: property.layoutVersions || [],
    ownershipHistory: property.ownershipHistory || [],
    tenancyHistory: property.tenancyHistory || [],
    accessDevices: property.accessDevices || [],
    assets: property.assets || [],
    documents: property.documents || [],
    profilePhotos: property.profilePhotos || [],
    alerts: property.alerts || [],
    floorPlanDocumentIds: property.floorPlanDocumentIds || [],
  };
}

function cloudCreateCommand(property: VersionedProperty): Record<string, unknown> {
  const command: Record<string, unknown> = { ...property };
  // The server owns the canonical property identifier. A wizard may use a local
  // draft identifier while composing layouts, but it must never become the
  // persistent document ID.
  delete command.id;
  delete command.createdAt;
  delete command.updatedAt;
  delete command.version;
  return command;
}
function cloudUpdateCommand(updates: Partial<PropertyRecord>): Record<string, unknown> {
  const command: Record<string, unknown> = { ...updates };
  delete command.id;
  delete command.agencyId;
  delete command.createdAt;
  delete command.updatedAt;
  delete command.version;
  return command;
}

const SAMPLE_PROPERTIES: PropertyRecord[] = [
  normalisePropertyRecord({
    id: 'prop-sample-01',
    agencyId: 'proinspect-agency',
    address: '104 Ocean Drive',
    suburb: 'Scarborough',
    state: 'WA',
    postcode: '6019',
    propertyType: 'house',
    propertyUse: 'residential',
    physicalPropertyType: 'house',
    ownershipStructure: 'freehold',
    bedrooms: 4,
    bathrooms: 2,
    parking: 2,
    livingAreas: 2,
    status: 'active',
    clientIds: ['client-landlord-01'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as PropertyRecord),
  normalisePropertyRecord({
    id: 'prop-sample-02',
    agencyId: 'proinspect-agency',
    address: '15/88 Beaufort Street',
    suburb: 'Highgate',
    state: 'WA',
    postcode: '6003',
    propertyType: 'apartment',
    propertyUse: 'residential',
    physicalPropertyType: 'apartment',
    ownershipStructure: 'strata',
    bedrooms: 2,
    bathrooms: 1,
    parking: 1,
    livingAreas: 1,
    status: 'active',
    clientIds: ['client-landlord-02'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as PropertyRecord),
];

/**
 * Cloud deployments are server-authoritative. They never silently fall back to
 * IndexedDB after a failed write, because doing so presents a false success to
 * the operator and creates records that disappear on another device/refresh.
 */
export const createProperty = async (input: CreatePropertyInput): Promise<PropertyRecord> => {
  const timestamp = new Date().toISOString();
  const localProperty = normalisePropertyRecord({
    ...input,
    id: input.id?.trim() || generateId(),
    clientIds: input.clientIds || [],
    status: input.status || 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  if (isFirebaseConfigured()) {
    const created = await apiRequest<PropertyRecord>(input.agencyId, '/api/v1/properties', {
      method: 'POST',
      body: cloudCreateCommand(localProperty),
    });
    if (!created?.id?.trim()) throw new Error('The property API did not return a canonical property identifier.');
    return normalisePropertyRecord(created);
  }

  await localPut('properties', localProperty);
  return localProperty;
};

export const getProperty = async (propertyId: string): Promise<PropertyRecord | undefined> => {
  if (isFirebaseConfigured()) {
    try {
      return normalisePropertyRecord(await apiRequest<PropertyRecord>(undefined, `/api/v1/properties/${encodeURIComponent(propertyId)}`));
    } catch (error) {
      if ((error as { code?: string }).code === 'NOT_FOUND') return undefined;
      throw error;
    }
  }

  const localRecord = await localGet<PropertyRecord>('properties', propertyId);
  if (localRecord) return normalisePropertyRecord(localRecord);
  const sample = SAMPLE_PROPERTIES.find((property) => property.id === propertyId);
  return sample ? normalisePropertyRecord(sample) : undefined;
};

export const listProperties = async (): Promise<PropertyRecord[]> => {
  if (isFirebaseConfigured()) {
    return (await apiRequest<PropertyRecord[]>(undefined, '/api/v1/properties?limit=100')).map(normalisePropertyRecord);
  }

  const localItems = await localList<PropertyRecord>('properties');
  if (localItems.length > 0) return localItems.map(normalisePropertyRecord);
  for (const sample of SAMPLE_PROPERTIES) await localPut('properties', sample);
  return SAMPLE_PROPERTIES.map(normalisePropertyRecord);
};

export const updateProperty = async (
  propertyId: string,
  updates: Partial<Omit<PropertyRecord, 'id' | 'createdAt'>>,
): Promise<PropertyRecord> => {
  const existing = await getProperty(propertyId);
  if (!existing) throw new Error('Property not found.');

  if (isFirebaseConfigured()) {
    return normalisePropertyRecord(await apiRequest<PropertyRecord>(existing.agencyId, `/api/v1/properties/${encodeURIComponent(propertyId)}`, {
      method: 'PATCH',
      body: { ...cloudUpdateCommand(updates), expectedVersion: (existing as VersionedProperty).version ?? 1 },
    }));
  }

  const updatedProperty = normalisePropertyRecord({ ...existing, ...updates, id: propertyId, updatedAt: new Date().toISOString() });
  await localPut('properties', updatedProperty);
  return updatedProperty;
};

export const archiveProperty = async (propertyId: string): Promise<PropertyRecord> => updateProperty(propertyId, { status: 'archived' });
