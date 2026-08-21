import type {
  Tenant,
  TenantCommunication,
  Tenancy,
  TenancyDocument,
  TenancyLifecycleStatus,
  TenancyParticipant,
  TenancyParticipantRole,
} from '../../types/platform';
import { apiRequest } from '../apiClient';

export type ManagedTenancy = Tenancy & {
  lifecycleStatus?: TenancyLifecycleStatus;
  leaseType?: 'fixed' | 'periodic';
  noticeDate?: string;
  vacateDate?: string;
  assignedManagerId?: string;
  version?: number;
};

function agencyId(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.localStorage.getItem('pcr_agency_id') || window.localStorage.getItem('agencyId') || undefined;
}

function id(prefix: string): string {
  return `${prefix}-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

export async function listTenants(): Promise<Tenant[]> {
  return apiRequest<Tenant[]>(agencyId(), '/api/v1/tenants?limit=100');
}

export async function getTenant(tenantId: string): Promise<Tenant> {
  return apiRequest<Tenant>(agencyId(), `/api/v1/tenants/${encodeURIComponent(tenantId)}`);
}

export async function createTenant(input: Pick<Tenant, 'fullName'> & Partial<Pick<Tenant, 'preferredName' | 'email' | 'phone' | 'preferredCommunication' | 'status'>>): Promise<Tenant> {
  return apiRequest<Tenant>(agencyId(), '/api/v1/tenants', {
    method: 'POST',
    body: { id: id('tenant'), ...input, status: input.status || 'active' },
  });
}

export async function updateTenant(tenant: Tenant, patch: Partial<Tenant>): Promise<Tenant> {
  return apiRequest<Tenant>(agencyId(), `/api/v1/tenants/${encodeURIComponent(tenant.id)}`, {
    method: 'PATCH',
    body: { ...patch, expectedVersion: tenant.version || 1 },
  });
}

export async function listManagedTenancies(): Promise<ManagedTenancy[]> {
  return apiRequest<ManagedTenancy[]>(agencyId(), '/api/v1/tenancies?limit=100');
}

export async function createManagedTenancy(input: {
  propertyId: string;
  leaseStartDate?: string;
  leaseEndDate?: string;
  lifecycleStatus?: TenancyLifecycleStatus;
  leaseType?: 'fixed' | 'periodic';
  assignedManagerId?: string;
  tenantNames?: string[];
  tenantEmails?: string[];
}): Promise<ManagedTenancy> {
  return apiRequest<ManagedTenancy>(agencyId(), '/api/v1/tenancies', {
    method: 'POST',
    body: {
      id: id('tenancy'),
      propertyId: input.propertyId,
      tenantNames: input.tenantNames || [],
      tenantEmails: input.tenantEmails || [],
      leaseStartDate: input.leaseStartDate,
      leaseEndDate: input.leaseEndDate,
      lifecycleStatus: input.lifecycleStatus || 'active',
      leaseType: input.leaseType || 'fixed',
      assignedManagerId: input.assignedManagerId,
      status: input.lifecycleStatus === 'ended' || input.lifecycleStatus === 'cancelled' ? 'inactive' : 'active',
    },
  });
}

export async function updateManagedTenancy(tenancy: ManagedTenancy, patch: Partial<ManagedTenancy>): Promise<ManagedTenancy> {
  return apiRequest<ManagedTenancy>(agencyId(), `/api/v1/tenancies/${encodeURIComponent(tenancy.id)}`, {
    method: 'PATCH',
    body: { ...patch, expectedVersion: tenancy.version || 1 },
  });
}

export async function listTenancyParticipants(): Promise<TenancyParticipant[]> {
  return apiRequest<TenancyParticipant[]>(agencyId(), '/api/v1/tenancy-participants?limit=100');
}

export async function addTenancyParticipant(tenancyId: string, tenantId: string, role: TenancyParticipantRole = 'co_tenant'): Promise<TenancyParticipant> {
  return apiRequest<TenancyParticipant>(agencyId(), '/api/v1/tenancy-participants', {
    method: 'POST',
    body: { id: id('participant'), tenancyId, tenantId, role, status: 'active' },
  });
}

export async function createTenantWithTenancy(input: {
  fullName: string;
  email?: string;
  phone?: string;
  propertyId: string;
  leaseStartDate?: string;
  leaseEndDate?: string;
  leaseType?: 'fixed' | 'periodic';
}): Promise<{ tenant: Tenant; tenancy: ManagedTenancy; participant: TenancyParticipant }> {
  const tenant = await createTenant({ fullName: input.fullName, email: input.email, phone: input.phone, preferredCommunication: input.email ? 'email' : 'portal' });
  const tenancy = await createManagedTenancy({
    propertyId: input.propertyId,
    leaseStartDate: input.leaseStartDate,
    leaseEndDate: input.leaseEndDate,
    leaseType: input.leaseType,
    tenantNames: [input.fullName],
    tenantEmails: input.email ? [input.email] : [],
  });
  const participant = await addTenancyParticipant(tenancy.id, tenant.id, 'primary_tenant');
  return { tenant, tenancy, participant };
}

export async function listTenantCommunications(): Promise<TenantCommunication[]> {
  return apiRequest<TenantCommunication[]>(agencyId(), '/api/v1/tenant-communications?limit=100');
}

export async function createTenantCommunication(input: Omit<TenantCommunication, 'id' | 'agencyId' | 'createdAt' | 'updatedAt'>): Promise<TenantCommunication> {
  return apiRequest<TenantCommunication>(agencyId(), '/api/v1/tenant-communications', {
    method: 'POST',
    body: { id: id('communication'), ...input },
  });
}

export async function queueTenantCommunication(input: {
  tenantId: string;
  tenancyId?: string;
  propertyId?: string;
  channel: 'email' | 'sms' | 'portal';
  recipient: string;
  subject?: string;
  message: string;
  relatedEntityType?: TenantCommunication['relatedEntityType'];
  relatedEntityId?: string;
}): Promise<TenantCommunication> {
  const communication = await createTenantCommunication({
    tenantId: input.tenantId,
    tenancyId: input.tenancyId,
    propertyId: input.propertyId,
    channel: input.channel,
    direction: 'outbound',
    subject: input.subject,
    message: input.message,
    status: 'queued',
    relatedEntityType: input.relatedEntityType,
    relatedEntityId: input.relatedEntityId,
  });
  await apiRequest(agencyId(), '/api/v1/notifications', {
    method: 'POST',
    body: {
      tenantId: input.tenantId,
      tenancyId: input.tenancyId,
      propertyId: input.propertyId,
      channel: input.channel,
      recipient: input.recipient,
      subject: input.subject,
      message: input.message,
      communicationId: communication.id,
    },
  });
  return communication;
}

export async function listTenancyDocuments(): Promise<TenancyDocument[]> {
  return apiRequest<TenancyDocument[]>(agencyId(), '/api/v1/tenancy-documents?limit=100');
}

export async function createTenancyDocument(input: Omit<TenancyDocument, 'id' | 'agencyId' | 'createdAt' | 'updatedAt'>): Promise<TenancyDocument> {
  return apiRequest<TenancyDocument>(agencyId(), '/api/v1/tenancy-documents', {
    method: 'POST',
    body: { id: id('tenancy-document'), ...input },
  });
}

export async function migrateLegacyTenancies(tenancies: ManagedTenancy[]): Promise<{ tenantsCreated: number; participantsCreated: number }> {
  const existingTenants = await listTenants();
  const participants = await listTenancyParticipants();
  let tenantsCreated = 0;
  let participantsCreated = 0;

  for (const tenancy of tenancies) {
    const names = tenancy.tenantNames || [];
    const emails = tenancy.tenantEmails || [];
    for (let index = 0; index < names.length; index += 1) {
      const fullName = names[index]?.trim();
      if (!fullName) continue;
      const email = emails[index]?.trim().toLowerCase();
      let tenant = existingTenants.find((candidate) => email && candidate.email?.toLowerCase() === email)
        || existingTenants.find((candidate) => candidate.fullName.trim().toLowerCase() === fullName.toLowerCase());
      if (!tenant) {
        tenant = await createTenant({ fullName, ...(email ? { email } : {}) });
        existingTenants.push(tenant);
        tenantsCreated += 1;
      }
      if (!participants.some((candidate) => candidate.tenancyId === tenancy.id && candidate.tenantId === tenant!.id)) {
        const participant = await addTenancyParticipant(tenancy.id, tenant.id, index === 0 ? 'primary_tenant' : 'co_tenant');
        participants.push(participant);
        participantsCreated += 1;
      }
    }
  }
  return { tenantsCreated, participantsCreated };
}
