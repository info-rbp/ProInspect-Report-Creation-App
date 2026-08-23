import type {
  InspectionJob,
  MaintenanceItem,
  PropertyRecord,
  ReportIndex,
  Tenant,
  TenantCommunication,
  TenantInstruction,
  Tenancy,
  TenancyDocument,
  TenancyDocumentType,
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

export interface TenantOverviewRow {
  tenant: Tenant;
  tenancy?: ManagedTenancy;
  property?: Pick<PropertyRecord, 'id' | 'address' | 'suburb' | 'state' | 'postcode'>;
  lifecycle: string;
  openActionCount: number;
  openMaintenanceCount: number;
  nextInspection?: Pick<InspectionJob, 'id' | 'reportType' | 'scheduledAt' | 'status'>;
  overdue: boolean;
}

export interface TenantOverview {
  rows: TenantOverviewRow[];
  stats: {
    activeTenants: number;
    activeTenancies: number;
    upcoming: number;
    vacating: number;
    awaitingTenant: number;
    openMaintenance: number;
  };
}

export type EnrichedTenancyParticipant = TenancyParticipant & { tenant?: Tenant };

export interface TenantWorkspace {
  tenant: Tenant;
  linkedTenancies: ManagedTenancy[];
  currentTenancy?: ManagedTenancy;
  property?: PropertyRecord;
  participants: EnrichedTenancyParticipant[];
  jobs: InspectionJob[];
  reports: ReportIndex[];
  maintenance: MaintenanceItem[];
  actions: TenantInstruction[];
  communications: TenantCommunication[];
  documents: TenancyDocument[];
}

function agencyId(): string | undefined {
  if (typeof window === 'undefined') return 'agency-1';
  return window.localStorage.getItem('pcr_agency_id') || window.localStorage.getItem('agencyId') || 'agency-1';
}

function id(prefix: string): string {
  return `${prefix}-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  return btoa(binary);
}

export async function getTenantOverview(): Promise<TenantOverview> {
  return apiRequest<TenantOverview>(agencyId(), '/api/v1/tenants/overview');
}

export async function getTenantWorkspace(tenantId: string): Promise<TenantWorkspace> {
  return apiRequest<TenantWorkspace>(agencyId(), `/api/v1/tenants/${encodeURIComponent(tenantId)}/workspace`);
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

export async function updateTenancyParticipant(participant: TenancyParticipant, patch: Partial<TenancyParticipant>): Promise<TenancyParticipant> {
  return apiRequest<TenancyParticipant>(agencyId(), `/api/v1/tenancy-participants/${encodeURIComponent(participant.id)}`, {
    method: 'PATCH',
    body: { ...patch, expectedVersion: participant.version || 1 },
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

export async function generateTenancyDocument(input: {
  tenantId?: string;
  tenancyId: string;
  propertyId: string;
  type: TenancyDocumentType;
  title: string;
  content?: string;
  file?: File;
  templateKey?: string;
  acknowledgementText?: string;
}): Promise<TenancyDocument> {
  return apiRequest<TenancyDocument>(agencyId(), '/api/v1/tenancy-documents/generate', {
    method: 'POST',
    body: {
      tenantId: input.tenantId,
      tenancyId: input.tenancyId,
      propertyId: input.propertyId,
      type: input.type,
      title: input.title,
      content: input.content,
      templateKey: input.templateKey,
      acknowledgementText: input.acknowledgementText,
      ...(input.file ? { fileBase64: await fileToBase64(input.file) } : {}),
    },
  });
}

export async function createTenancyDocument(input: Omit<TenancyDocument, 'id' | 'agencyId' | 'createdAt' | 'updatedAt'>): Promise<TenancyDocument> {
  return apiRequest<TenancyDocument>(agencyId(), '/api/v1/tenancy-documents', { method: 'POST', body: { id: id('tenancy-document'), ...input } });
}

export async function createNewTenancyDocumentVersion(documentId: string, input: { title?: string; content?: string; file?: File; templateKey?: string; acknowledgementText?: string }): Promise<TenancyDocument> {
  return apiRequest<TenancyDocument>(agencyId(), `/api/v1/tenancy-documents/${encodeURIComponent(documentId)}/new-version`, {
    method: 'POST',
    body: { ...input, ...(input.file ? { fileBase64: await fileToBase64(input.file) } : {}) },
  });
}

export async function issueTenancyDocument(documentId: string, input: { tenantIds?: string[]; agentSignatureRequired?: boolean; agentName?: string } = {}): Promise<TenancyDocument> {
  return apiRequest<TenancyDocument>(agencyId(), `/api/v1/tenancy-documents/${encodeURIComponent(documentId)}/issue`, { method: 'POST', body: input });
}

export async function agentSignTenancyDocument(documentId: string, signatureName: string): Promise<TenancyDocument> {
  return apiRequest<TenancyDocument>(agencyId(), `/api/v1/tenancy-documents/${encodeURIComponent(documentId)}/agent-sign`, { method: 'POST', body: { signatureName } });
}

export async function archiveTenancyDocument(documentId: string): Promise<TenancyDocument> {
  return apiRequest<TenancyDocument>(agencyId(), `/api/v1/tenancy-documents/${encodeURIComponent(documentId)}/archive`, { method: 'POST', body: {} });
}

export async function getTenancyDocumentDownload(documentId: string): Promise<{ url: string; expiresInSeconds: number; sha256?: string; documentVersion?: number }> {
  return apiRequest(agencyId(), `/api/v1/tenancy-documents/${encodeURIComponent(documentId)}/download`);
}

export async function migrateLegacyTenancies(_tenancies?: ManagedTenancy[]): Promise<{ tenantsCreated: number; participantsCreated: number; reviewRequired: number; skipped: number }> {
  return apiRequest(agencyId(), '/api/v1/tenants/migrate-legacy', { method: 'POST', body: {} });
}
