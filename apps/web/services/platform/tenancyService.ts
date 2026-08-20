import type { Tenancy } from '../../types/platform';
import { generateId } from '../../utils';
import { apiRequest } from '../apiClient';
import { localGet, localList, localPut } from './localPlatformStore';

function agencyId(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.localStorage.getItem('pcr_agency_id') || window.localStorage.getItem('agencyId') || undefined;
}

export async function listTenancies(): Promise<Tenancy[]> {
  try {
    return await apiRequest<Tenancy[]>(agencyId(), '/api/v1/tenancies');
  } catch {
    return localList<Tenancy>('tenancies');
  }
}

export async function listTenanciesForProperty(propertyId: string): Promise<Tenancy[]> {
  return (await listTenancies()).filter((tenancy) => tenancy.propertyId === propertyId);
}

export async function getTenancy(id: string): Promise<Tenancy | undefined> {
  try {
    return await apiRequest<Tenancy>(agencyId(), `/api/v1/tenancies/${encodeURIComponent(id)}`);
  } catch {
    return localGet<Tenancy>('tenancies', id);
  }
}

export async function createTenancy(
  input: Omit<Tenancy, 'id' | 'createdAt' | 'updatedAt' | 'status'> & Partial<Pick<Tenancy, 'status'>>,
): Promise<Tenancy> {
  const now = new Date().toISOString();
  const record: Tenancy = {
    ...input,
    id: `tenancy-${generateId()}`,
    status: input.status || 'active',
    createdAt: now,
    updatedAt: now,
  };
  try {
    return await apiRequest<Tenancy>(input.agencyId, '/api/v1/tenancies', { method: 'POST', body: record });
  } catch {
    await localPut('tenancies', record);
    return record;
  }
}
