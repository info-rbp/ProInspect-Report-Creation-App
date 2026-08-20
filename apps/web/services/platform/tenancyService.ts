import type { Tenancy } from '../../types/platform';
import { generateId } from '../../utils';
import { apiRequest } from '../apiClient';
import { isFirebaseConfigured } from '../storageService';
import { localGet, localList, localPut } from './localPlatformStore';

function agencyId(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.localStorage.getItem('pcr_agency_id') || window.localStorage.getItem('agencyId') || undefined;
}

function cloudMode(): boolean {
  return isFirebaseConfigured() && Boolean(import.meta.env.VITE_API_BASE_URL?.trim());
}

export async function listTenancies(): Promise<Tenancy[]> {
  if (cloudMode()) return apiRequest<Tenancy[]>(agencyId(), '/api/v1/tenancies');
  return localList<Tenancy>('tenancies');
}

export async function listTenanciesForProperty(propertyId: string): Promise<Tenancy[]> {
  return (await listTenancies()).filter((tenancy) => tenancy.propertyId === propertyId);
}

export async function getTenancy(id: string): Promise<Tenancy | undefined> {
  if (cloudMode()) {
    try {
      return await apiRequest<Tenancy>(agencyId(), `/api/v1/tenancies/${encodeURIComponent(id)}`);
    } catch (error) {
      if ((error as { code?: string }).code === 'NOT_FOUND') return undefined;
      throw error;
    }
  }
  return localGet<Tenancy>('tenancies', id);
}

export async function createTenancy(
  input: Omit<Tenancy, 'id' | 'createdAt' | 'updatedAt' | 'status'> & Partial<Pick<Tenancy, 'status'>>,
): Promise<Tenancy> {
  const id = `tenancy-${generateId()}`;
  const status = input.status || 'active';
  if (cloudMode()) {
    return apiRequest<Tenancy>(input.agencyId, '/api/v1/tenancies', {
      method: 'POST',
      body: { ...input, id, status },
    });
  }

  const now = new Date().toISOString();
  const record: Tenancy = { ...input, id, status, createdAt: now, updatedAt: now };
  await localPut('tenancies', record);
  return record;
}
