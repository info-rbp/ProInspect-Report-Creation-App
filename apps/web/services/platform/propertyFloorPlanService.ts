import type { PropertyFloorPlanHotspot, PropertyFloorPlanMap, PropertyRecord } from '../../types/platform';
import { generateId } from '../../utils';
import { apiRequest } from '../apiClient';
import { isFirebaseConfigured } from '../storageService';
import { localGet, localList, localPut } from './localPlatformStore';

function cloudMode(): boolean {
  return isFirebaseConfigured() && Boolean(import.meta.env.VITE_API_BASE_URL?.trim());
}

export async function listPropertyFloorPlans(property: PropertyRecord): Promise<PropertyFloorPlanMap[]> {
  if (cloudMode()) {
    return apiRequest<PropertyFloorPlanMap[]>(
      property.agencyId,
      `/api/v1/properties/${encodeURIComponent(property.id)}/floor-plans`,
    );
  }
  return (await localList<PropertyFloorPlanMap>('propertyFloorPlans')).filter((map) => map.propertyId === property.id);
}

export async function getPropertyFloorPlan(mapId: string): Promise<PropertyFloorPlanMap | undefined> {
  return localGet<PropertyFloorPlanMap>('propertyFloorPlans', mapId);
}

export async function createPropertyFloorPlan(
  property: PropertyRecord,
  input: { documentId: string; title: string; hotspots?: PropertyFloorPlanHotspot[] },
): Promise<PropertyFloorPlanMap> {
  if (cloudMode()) {
    return apiRequest<PropertyFloorPlanMap>(
      property.agencyId,
      `/api/v1/properties/${encodeURIComponent(property.id)}/floor-plans`,
      {
        method: 'POST',
        body: {
          documentId: input.documentId,
          title: input.title,
          layoutVersionId: property.currentLayoutVersionId,
          hotspots: input.hotspots || [],
        },
      },
    );
  }

  const now = new Date().toISOString();
  const map: PropertyFloorPlanMap = {
    id: `floor-plan-${generateId()}`,
    agencyId: property.agencyId,
    propertyId: property.id,
    documentId: input.documentId,
    title: input.title,
    layoutVersionId: property.currentLayoutVersionId,
    hotspots: input.hotspots || [],
    status: 'active',
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  await localPut('propertyFloorPlans', map);
  return map;
}

export async function updatePropertyFloorPlan(
  property: PropertyRecord,
  map: PropertyFloorPlanMap,
  updates: { title?: string; hotspots?: PropertyFloorPlanHotspot[]; status?: 'active' | 'archived' },
): Promise<PropertyFloorPlanMap> {
  if (cloudMode()) {
    return apiRequest<PropertyFloorPlanMap>(
      property.agencyId,
      `/api/v1/properties/${encodeURIComponent(property.id)}/floor-plans/${encodeURIComponent(map.id)}`,
      {
        method: 'PATCH',
        body: { ...updates, expectedVersion: map.version },
      },
    );
  }

  const updated: PropertyFloorPlanMap = {
    ...map,
    ...updates,
    version: map.version + 1,
    updatedAt: new Date().toISOString(),
  };
  await localPut('propertyFloorPlans', updated);
  return updated;
}
