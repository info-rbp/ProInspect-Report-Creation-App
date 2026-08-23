import type { Tenant, Tenancy } from '../../types/platform';
import { generateId } from '../../utils';
import { apiRequest } from '../apiClient';
import { isFirebaseConfigured } from '../storageService';
import { localGet, localList, localPut } from './localPlatformStore';

function agencyId(): string | undefined {
  if (typeof window === 'undefined') return 'agency-1';
  return window.localStorage.getItem('pcr_agency_id') || window.localStorage.getItem('agencyId') || 'agency-1';
}

function cloudMode(): boolean {
  return isFirebaseConfigured() && Boolean(import.meta.env.VITE_API_BASE_URL?.trim());
}

function tenantId(): string {
  return `tenant-${generateId()}`;
}

function participantId(): string {
  return `participant-${generateId()}`;
}

async function synchroniseTenantDirectory(tenancy: Tenancy): Promise<void> {
  if (!cloudMode()) return;
  let existing: Tenant[] = [];
  try {
    existing = await apiRequest<Tenant[]>(tenancy.agencyId, '/api/v1/tenants?limit=100');
  } catch {
    return;
  }

  for (let index = 0; index < tenancy.tenantNames.length; index += 1) {
    const fullName = tenancy.tenantNames[index]?.trim();
    if (!fullName) continue;
    const email = tenancy.tenantEmails[index]?.trim().toLowerCase();
    let tenant = email ? existing.find((candidate) => candidate.email?.trim().toLowerCase() === email) : undefined;
    if (!tenant) {
      tenant = await apiRequest<Tenant>(tenancy.agencyId, '/api/v1/tenants', {
        method: 'POST',
        body: {
          id: tenantId(),
          fullName,
          ...(email ? { email } : {}),
          preferredCommunication: email ? 'email' : 'portal',
          status: 'active',
        },
      });
      existing.push(tenant);
    }
    await apiRequest(tenancy.agencyId, '/api/v1/tenancy-participants', {
      method: 'POST',
      body: {
        id: participantId(),
        tenancyId: tenancy.id,
        tenantId: tenant.id,
        role: index === 0 ? 'primary_tenant' : 'co_tenant',
        status: 'active',
      },
    });
  }
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
    const tenancy = await apiRequest<Tenancy>(input.agencyId, '/api/v1/tenancies', {
      method: 'POST',
      body: { ...input, id, status, lifecycleStatus: status === 'active' ? 'active' : 'ended' },
    });
    await synchroniseTenantDirectory(tenancy);
    return tenancy;
  }

  const now = new Date().toISOString();
  const record: Tenancy = { ...input, id, status, createdAt: now, updatedAt: now };
  await localPut('tenancies', record);
  return record;
}
