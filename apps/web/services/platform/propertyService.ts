import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { generateId } from '../../utils';
import type { PropertyRecord } from '../../types/platform';
import { apiRequest } from '../apiClient';
import { getFirestoreDb, isFirebaseConfigured } from '../storageService';
import { localGet, localList, localPut } from './localPlatformStore';

export type CreatePropertyInput = Omit<PropertyRecord, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'clientIds'> &
  Partial<Pick<PropertyRecord, 'clientIds' | 'status'>>;

type VersionedProperty = PropertyRecord & { version?: number };

const SAMPLE_PROPERTIES: PropertyRecord[] = [
  {
    id: 'prop-sample-01',
    agencyId: 'proinspect-agency',
    address: '104 Ocean Drive',
    suburb: 'Scarborough',
    state: 'WA',
    postcode: '6019',
    propertyType: 'house',
    bedrooms: 4,
    bathrooms: 2,
    parking: 2,
    livingAreas: 2,
    status: 'active',
    clientIds: ['client-landlord-01'],
    googleDriveFolderId: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    roomsConfig: [
      { id: 'room-1', name: 'Master Bedroom', roomType: 'bedroom', floorLevel: 'First Floor', notes: 'Includes walk-in robe and ensuite' },
      { id: 'room-2', name: 'Ensuite Bathroom', roomType: 'bathroom', floorLevel: 'First Floor', notes: 'Double vanity, glass shower screen' },
      { id: 'room-3', name: 'Bedroom 2', roomType: 'bedroom', floorLevel: 'First Floor', notes: 'Built-in wardrobe' },
      { id: 'room-4', name: 'Bedroom 3', roomType: 'bedroom', floorLevel: 'Ground Floor', notes: 'Carpeted' },
      { id: 'room-5', name: 'Bedroom 4 / Study', roomType: 'study', floorLevel: 'Ground Floor', notes: 'Timber flooring' },
      { id: 'room-6', name: 'Main Bathroom', roomType: 'bathroom', floorLevel: 'Ground Floor', notes: 'Bathtub and separate shower' },
      { id: 'room-7', name: 'Open Plan Living & Dining', roomType: 'living', floorLevel: 'Ground Floor', notes: 'Split system A/C' },
      { id: 'room-8', name: 'Gourmet Kitchen', roomType: 'kitchen', floorLevel: 'Ground Floor', notes: 'Stone benchtop, gas cooktop, dishwasher' },
      { id: 'room-9', name: 'Alfresco Patio & Deck', roomType: 'outdoor', floorLevel: 'Ground Floor', notes: 'Covered outdoor entertaining area' },
      { id: 'room-10', name: 'Double Garage', roomType: 'garage', floorLevel: 'Ground Floor', notes: 'Automatic roller door' },
    ],
    landlordDetails: {
      name: 'Eleanor Vance',
      email: 'eleanor.vance@propertylandlords.com.au',
      phone: '0412 345 678',
      companyName: 'Vance Investments Pty Ltd',
      address: '12 St Georges Terrace, Perth WA 6000',
      contactPreference: 'email',
      notes: 'Prefers quarterly email summaries for all maintenance items.',
    },
    tenantDetails: {
      primaryTenantName: 'Marcus Miller',
      primaryTenantEmail: 'marcus.miller@gmail.com',
      primaryTenantPhone: '0499 888 777',
      additionalTenants: ['Sarah Jenkins'],
      leaseStartDate: '2025-02-01',
      leaseEndDate: '2026-01-31',
      rentAmount: 780,
      rentFrequency: 'weekly',
      emergencyContactName: 'David Miller (Brother)',
      emergencyContactPhone: '0433 222 111',
      occupancyStatus: 'tenanted',
      notes: 'Tenant has a approved small indoor cat.',
    },
    accessDetails: {
      keyNumbers: 'KEY-402A / 402B',
      lockboxCode: '8492',
      alarmCode: '1984',
      accessNotes: 'Lockbox located on side gas meter box left of garage.',
    },
    features: {
      airConditioning: true,
      heating: true,
      dishwasher: true,
      solar: true,
      courtyard: true,
      balcony: true,
      petsAllowed: true,
      furnished: false,
    },
    notes: 'Premium beachfront property. Handle annual PCR with extra photo detail on exterior deck timber.',
  },
  {
    id: 'prop-sample-02',
    agencyId: 'proinspect-agency',
    address: '15/88 Beaufort Street',
    suburb: 'Highgate',
    state: 'WA',
    postcode: '6003',
    propertyType: 'apartment',
    bedrooms: 2,
    bathrooms: 1,
    parking: 1,
    livingAreas: 1,
    status: 'active',
    clientIds: ['client-landlord-02'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    roomsConfig: [
      { id: 'room-201', name: 'Master Bedroom', roomType: 'bedroom', floorLevel: 'Level 2', notes: 'Built-in robe, direct balcony access' },
      { id: 'room-202', name: 'Bedroom 2', roomType: 'bedroom', floorLevel: 'Level 2' },
      { id: 'room-203', name: 'Bathroom & Laundry', roomType: 'bathroom', floorLevel: 'Level 2', notes: 'Combined laundry space' },
      { id: 'room-204', name: 'Living Room', roomType: 'living', floorLevel: 'Level 2' },
      { id: 'room-205', name: 'Kitchen', roomType: 'kitchen', floorLevel: 'Level 2' },
      { id: 'room-206', name: 'Private Balcony', roomType: 'outdoor', floorLevel: 'Level 2' },
    ],
    landlordDetails: {
      name: 'Julian Thorne',
      email: 'j.thorne@apexrealestate.com.au',
      phone: '0488 123 456',
      contactPreference: 'phone',
    },
    tenantDetails: {
      primaryTenantName: 'Chloe Bennett',
      primaryTenantEmail: 'chloe.b@outlook.com',
      primaryTenantPhone: '0455 666 777',
      leaseStartDate: '2024-08-15',
      leaseEndDate: '2025-08-14',
      rentAmount: 550,
      rentFrequency: 'weekly',
      occupancyStatus: 'tenanted',
    },
    accessDetails: {
      keyNumbers: 'APT-15-MAIN',
      lockboxCode: '3310',
      accessNotes: 'Swipe fob needed for elevator and basement car bay #15.',
    },
    features: {
      airConditioning: true,
      dishwasher: true,
      balcony: true,
      securitySystem: true,
    },
  },
];

export const createProperty = async (input: CreatePropertyInput): Promise<PropertyRecord> => {
  const timestamp = new Date().toISOString();
  const newId = generateId();
  const property: PropertyRecord = {
    ...input,
    id: newId,
    clientIds: input.clientIds || [],
    status: input.status || 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  if (isFirebaseConfigured() && import.meta.env.VITE_API_BASE_URL?.trim()) {
    try {
      return await apiRequest<PropertyRecord>(input.agencyId, '/api/v1/properties', {
        method: 'POST',
        body: property,
      });
    } catch (err) {
      console.warn('API createProperty failed, saving locally:', err);
    }
  }

  await localPut('properties', property);
  return property;
};

export const getProperty = async (propertyId: string): Promise<PropertyRecord | undefined> => {
  if (isFirebaseConfigured() && import.meta.env.VITE_API_BASE_URL) {
    try {
      return await apiRequest<PropertyRecord>(undefined, `/api/v1/properties/${propertyId}`);
    } catch {
      // Fall through
    }
  }

  const firestoreDb = getFirestoreDb();
  if (firestoreDb) {
    try {
      const docSnap = await getDoc(doc(firestoreDb, 'properties', propertyId));
      if (docSnap.exists()) {
        const data = docSnap.data() as PropertyRecord;
        await localPut('properties', data);
        return data;
      }
    } catch (err) {
      console.warn('Firestore getProperty failed, checking local:', err);
    }
  }

  const localRecord = await localGet<PropertyRecord>('properties', propertyId);
  if (localRecord) return localRecord;

  // Fallback to sample data matching id
  return SAMPLE_PROPERTIES.find((p) => p.id === propertyId);
};

export const listProperties = async (): Promise<PropertyRecord[]> => {
  if (isFirebaseConfigured() && import.meta.env.VITE_API_BASE_URL) {
    try {
      return await apiRequest<PropertyRecord[]>(undefined, '/api/v1/properties');
    } catch {
      // Fall through
    }
  }

  const firestoreDb = getFirestoreDb();
  if (firestoreDb) {
    try {
      const snapshot = await getDocs(collection(firestoreDb, 'properties'));
      if (!snapshot.empty) {
        const items = snapshot.docs.map((d) => d.data() as PropertyRecord);
        for (const item of items) {
          await localPut('properties', item);
        }
        return items;
      }
    } catch (err) {
      console.warn('Firestore listProperties failed, using local store:', err);
    }
  }

  const localItems = await localList<PropertyRecord>('properties');
  if (localItems.length > 0) return localItems;

  // Seed initial samples if empty
  for (const sample of SAMPLE_PROPERTIES) {
    await localPut('properties', sample);
  }
  return SAMPLE_PROPERTIES;
};

export const updateProperty = async (
  propertyId: string,
  updates: Partial<Omit<PropertyRecord, 'id' | 'createdAt'>>,
): Promise<PropertyRecord> => {
  const existing = await getProperty(propertyId);
  if (!existing) throw new Error('Property not found.');

  const timestamp = new Date().toISOString();
  const updatedProperty: PropertyRecord = {
    ...existing,
    ...updates,
    id: propertyId,
    updatedAt: timestamp,
  };

  if (isFirebaseConfigured() && import.meta.env.VITE_API_BASE_URL?.trim()) {
    try {
      return await apiRequest<PropertyRecord>(existing.agencyId, `/api/v1/properties/${propertyId}`, {
        method: 'PATCH',
        body: { ...updates, expectedVersion: (existing as VersionedProperty).version ?? 1 },
      });
    } catch (err) {
      console.warn('API updateProperty failed, updating locally:', err);
    }
  }

  await localPut('properties', updatedProperty);
  return updatedProperty;
};

export const archiveProperty = async (propertyId: string): Promise<PropertyRecord> =>
  updateProperty(propertyId, { status: 'archived' });

