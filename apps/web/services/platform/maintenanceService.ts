import type {
  ClientApproval,
  ExternalContact,
  MaintenanceCandidate,
  MaintenanceCategory,
  MaintenanceItem,
  MaintenancePriority,
  TenantInstruction,
  WorkRequest,
} from '../../types/platform';
import { generateId } from '../../utils';
import { apiRequest } from '../apiClient';
import { isFirebaseConfigured } from '../storageService';
import { localGet, localList, localPut } from './localPlatformStore';

function agencyId(): string | undefined {
  if (typeof window === 'undefined') return 'agency-1';
  return window.localStorage.getItem('pcr_agency_id') || window.localStorage.getItem('agencyId') || 'agency-1';
}

const SAMPLE_MAINTENANCE_ITEMS: MaintenanceItem[] = [
  {
    id: 'maint-sample-01',
    agencyId: 'proinspect-agency',
    propertyId: 'prop-sample-01',
    sourceReportId: 'rep-sample-01',
    sourceAreaId: 'room-2',
    sourceComponentId: 'basin-tapware',
    title: 'Leaking Ensuite Basin Tapware',
    description: 'Ensuite basin cold tap constantly drips, seal deteriorated.',
    category: 'Plumbing',
    priority: 'routine',
    status: 'assigned',
    sourceEvidenceIds: [],
    approvalRequired: false,
    approvalStatus: 'not_required',
    dueDate: new Date(Date.now() + 86400000 * 7).toISOString(),
    workInstruction: 'Replace ceramic disc spindle cartridges and reseat tap.',
    verificationStatus: 'unverified',
    createdBy: 'system',
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1,
  },
  {
    id: 'maint-sample-02',
    agencyId: 'proinspect-agency',
    propertyId: 'prop-sample-01',
    sourceReportId: 'rep-sample-01',
    sourceAreaId: 'room-7',
    sourceComponentId: 'split-system-ac',
    title: 'Split System AC Filter Service and Remote Battery',
    description: 'Living room split system air conditioner filter requires cleaning and remote control batteries are flat.',
    category: 'Air Conditioning',
    priority: 'monitor',
    status: 'triage_required',
    sourceEvidenceIds: [],
    approvalRequired: false,
    approvalStatus: 'not_required',
    dueDate: new Date(Date.now() + 86400000 * 14).toISOString(),
    verificationStatus: 'unverified',
    createdBy: 'system',
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1,
  },
  {
    id: 'maint-sample-03',
    agencyId: 'proinspect-agency',
    propertyId: 'prop-sample-02',
    sourceReportId: 'rep-sample-02',
    sourceAreaId: 'room-10',
    sourceComponentId: 'screen-door',
    title: 'Rear Sliding Screen Door Rollers Degraded',
    description: 'Screen door jumping off bottom track, wheels heavily corroded.',
    category: 'Doors / Locks',
    priority: 'high',
    status: 'in_progress',
    sourceEvidenceIds: [],
    approvalRequired: true,
    approvalStatus: 'approved',
    dueDate: new Date(Date.now() + 86400000 * 3).toISOString(),
    workInstruction: 'Supply and fit heavy duty stainless steel screen door roller carriages.',
    verificationStatus: 'unverified',
    createdBy: 'system',
    createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1,
  },
];

const SAMPLE_MAINTENANCE_CANDIDATES: MaintenanceCandidate[] = [
  {
    id: 'cand-sample-01',
    agencyId: 'proinspect-agency',
    propertyId: 'prop-sample-01',
    reportId: 'rep-sample-01',
    areaId: 'room-8',
    componentId: 'rangehood-filter',
    title: 'Rangehood grease filter saturation',
    description: 'Grease accumulation noted on stainless mesh filters during routine inspection.',
    category: 'Cleaning',
    suggestedPriority: 'routine',
    evidencePhotoIds: [],
    source: 'inspector',
    reviewStatus: 'suggested',
    confidence: 0.92,
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1,
  },
  {
    id: 'cand-sample-02',
    agencyId: 'proinspect-agency',
    propertyId: 'prop-sample-01',
    reportId: 'rep-sample-01',
    areaId: 'room-9',
    componentId: 'deck-timber',
    title: 'Alfresco Timber Decking Weathering',
    description: 'Exposed outdoor deck shows early dry-checking; recommend resealing within 3 months.',
    category: 'General Maintenance',
    suggestedPriority: 'monitor',
    evidencePhotoIds: [],
    source: 'ai',
    reviewStatus: 'suggested',
    confidence: 0.88,
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1,
  },
];

const SAMPLE_EXTERNAL_CONTACTS: ExternalContact[] = [
  {
    id: 'contact-sample-01',
    agencyId: 'proinspect-agency',
    name: 'Apex Plumbing & Gas Solutions',
    contactName: 'Dave Higgins',
    email: 'service@apexplumbingwa.com.au',
    phone: '0488 123 456',
    contactType: 'trade_contractor',
    tradeCategory: 'Plumbing',
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'contact-sample-02',
    agencyId: 'proinspect-agency',
    name: 'Perth Coastal Electrical Services',
    contactName: 'Liam Carter',
    email: 'jobs@coastalelectricalperth.com.au',
    phone: '0499 765 432',
    contactType: 'trade_contractor',
    tradeCategory: 'Electrical',
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const SAMPLE_WORK_REQUESTS: WorkRequest[] = [
  {
    id: 'wr-sample-01',
    agencyId: 'proinspect-agency',
    propertyId: 'prop-sample-02',
    maintenanceItemId: 'maint-sample-03',
    externalContactId: 'contact-sample-01',
    title: 'Replace Screen Door Rollers and Align Track',
    description: 'Sliding screen door off tracks at 15/88 Beaufort Street.',
    tradeCategory: 'Doors / Locks',
    priority: 'high',
    status: 'issued',
    issuedAt: new Date().toISOString(),
    dueDate: new Date(Date.now() + 86400000 * 4).toISOString(),
    accessInstructions: 'Tenant home after 3pm or collect key from Scarborough office.',
    contractorContactName: 'Dave Higgins',
    contractorEmail: 'service@apexplumbingwa.com.au',
    contractorPhone: '0488 123 456',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1,
  },
];

const SAMPLE_TENANT_INSTRUCTIONS: TenantInstruction[] = [
  {
    id: 'ti-sample-01',
    agencyId: 'proinspect-agency',
    propertyId: 'prop-sample-01',
    instructionType: 'cleaning',
    title: 'Clean Rangehood Filters & Air Con Return Grille',
    description: 'Please soak and clean rangehood filters with degreaser as noted during routine inspection.',
    status: 'issued',
    issuedAt: new Date().toISOString(),
    targetDate: new Date(Date.now() + 86400000 * 7).toISOString(),
    primaryTenantName: 'Marcus Miller',
    primaryTenantEmail: 'marcus.miller@gmail.com',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1,
  },
];

const SAMPLE_CLIENT_APPROVALS: ClientApproval[] = [
  {
    id: 'appr-sample-01',
    agencyId: 'proinspect-agency',
    propertyId: 'prop-sample-02',
    resourceType: 'work_request',
    resourceId: 'wr-sample-01',
    title: 'Approve Contractor Quote: Screen Door Rollers Replacement ($185)',
    description: 'Apex Plumbing & Maintenance quoted $185 inc GST to replace tandem stainless rollers.',
    status: 'approved',
    recipientEmail: 'eleanor.vance@propertylandlords.com.au',
    respondedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1,
  },
];

async function externalRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const baseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
  if (!baseUrl) throw new Error('VITE_API_BASE_URL is required for external portal operations.');
  const response = await fetch(`${baseUrl.replace(/\/$/u, '')}${path}`, init);
  const payload = await response.json().catch(() => ({})) as { data?: T; error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || `External portal request failed with ${response.status}.`);
  if (payload.data === undefined) throw new Error('External portal response did not contain data.');
  return payload.data;
}

async function lifecycleAction<T>(
  resource: 'maintenance-items' | 'work-requests' | 'tenant-instructions',
  id: string,
  action: string,
  expectedVersion: number,
  body: Record<string, unknown> = {},
): Promise<T> {
  return apiRequest<T>(agencyId(), `/api/v1/${resource}/${encodeURIComponent(id)}/actions/${encodeURIComponent(action)}`, {
    method: 'POST',
    body: { expectedVersion, ...body },
  });
}

export async function listMaintenanceCandidates(): Promise<MaintenanceCandidate[]> {
  if (isFirebaseConfigured() && import.meta.env.VITE_API_BASE_URL?.trim()) {
    try {
      const candidates = await apiRequest<MaintenanceCandidate[]>(agencyId(), '/api/v1/maintenance-candidates');
      for (const item of candidates) {
        await localPut('maintenanceCandidates', item);
      }
      return candidates;
    } catch (err) {
      console.warn('API listMaintenanceCandidates failed, falling back to local store:', err);
    }
  }

  const localCandidates = await localList<MaintenanceCandidate>('maintenanceCandidates');
  if (localCandidates.length > 0) {
    return localCandidates;
  }

  for (const item of SAMPLE_MAINTENANCE_CANDIDATES) {
    await localPut('maintenanceCandidates', item);
  }
  return SAMPLE_MAINTENANCE_CANDIDATES;
}

export async function extractMaintenanceCandidates(reportId: string): Promise<MaintenanceCandidate[]> {
  if (isFirebaseConfigured() && import.meta.env.VITE_API_BASE_URL?.trim()) {
    try {
      return await apiRequest<MaintenanceCandidate[]>(agencyId(), '/api/v1/maintenance-candidates/extract', {
        method: 'POST',
        body: { reportId },
      });
    } catch (err) {
      console.warn('API extractMaintenanceCandidates failed, searching local store:', err);
    }
  }

  const candidates = await listMaintenanceCandidates();
  return candidates.filter((c) => c.reportId === reportId);
}

export async function confirmMaintenanceCandidate(
  candidateId: string,
  overrides?: {
    title?: string;
    description?: string;
    category?: string;
    priority?: string;
    workInstruction?: string;
    recommendedAction?: string;
    approvalRequired?: boolean;
  },
): Promise<MaintenanceItem> {
  if (isFirebaseConfigured() && import.meta.env.VITE_API_BASE_URL?.trim()) {
    try {
      const confirmed = await apiRequest<MaintenanceItem>(agencyId(), `/api/v1/maintenance-candidates/${candidateId}/confirm`, {
        method: 'POST',
        body: overrides || {},
      });
      await localPut('maintenanceItems', confirmed);
      return confirmed;
    } catch (err) {
      console.warn('API confirmMaintenanceCandidate failed, updating locally:', err);
    }
  }

  const candidates = await listMaintenanceCandidates();
  const candidate = candidates.find((c) => c.id === candidateId);
  const now = new Date().toISOString();

  if (candidate) {
    candidate.reviewStatus = 'confirmed';
    candidate.updatedAt = now;
    await localPut('maintenanceCandidates', candidate);
  }

  const newItem: MaintenanceItem = {
    id: `maint-${generateId()}`,
    agencyId: candidate?.agencyId || 'proinspect-agency',
    propertyId: candidate?.propertyId || 'prop-sample-01',
    sourceReportId: candidate?.reportId,
    sourceAreaId: candidate?.areaId,
    sourceComponentId: candidate?.componentId,
    candidateId,
    title: overrides?.title || candidate?.title || 'Maintenance Task',
    description: overrides?.description || candidate?.description || '',
    category: (overrides?.category as MaintenanceCategory) || candidate?.category || 'General Maintenance',
    priority: (overrides?.priority as MaintenancePriority) || candidate?.suggestedPriority || 'routine',
    status: 'triage_required',
    sourceEvidenceIds: candidate?.evidencePhotoIds || [],
    approvalRequired: false,
    approvalStatus: 'not_required',
    workInstruction: overrides?.workInstruction,
    verificationStatus: 'unverified',
    createdBy: 'current_user',
    createdAt: now,
    updatedAt: now,
    version: 1,
  };

  await localPut('maintenanceItems', newItem);
  return newItem;
}

export async function dismissMaintenanceCandidate(
  candidateId: string,
  reason: string,
  expectedVersion = 1,
): Promise<MaintenanceCandidate> {
  if (isFirebaseConfigured() && import.meta.env.VITE_API_BASE_URL?.trim()) {
    try {
      const dismissed = await apiRequest<MaintenanceCandidate>(agencyId(), `/api/v1/maintenance-candidates/${candidateId}`, {
        method: 'PATCH',
        body: { reviewStatus: 'dismissed', dismissedReason: reason, expectedVersion },
      });
      await localPut('maintenanceCandidates', dismissed);
      return dismissed;
    } catch (err) {
      console.warn('API dismissMaintenanceCandidate failed, updating locally:', err);
    }
  }

  const candidates = await listMaintenanceCandidates();
  const candidate = candidates.find((c) => c.id === candidateId);
  if (!candidate) {
    throw new Error('Maintenance candidate not found.');
  }

  candidate.reviewStatus = 'dismissed';
  candidate.dismissedReason = reason;
  candidate.updatedAt = new Date().toISOString();
  candidate.version = (candidate.version || expectedVersion) + 1;
  await localPut('maintenanceCandidates', candidate);
  return candidate;
}

export async function listMaintenanceItems(): Promise<MaintenanceItem[]> {
  if (isFirebaseConfigured() && import.meta.env.VITE_API_BASE_URL?.trim()) {
    try {
      const items = await apiRequest<MaintenanceItem[]>(agencyId(), '/api/v1/maintenance-items');
      for (const item of items) {
        await localPut('maintenanceItems', item);
      }
      return items;
    } catch (err) {
      console.warn('API listMaintenanceItems failed, falling back to local store:', err);
    }
  }

  const localItems = await localList<MaintenanceItem>('maintenanceItems');
  if (localItems.length > 0) {
    return localItems;
  }

  for (const item of SAMPLE_MAINTENANCE_ITEMS) {
    await localPut('maintenanceItems', item);
  }
  return SAMPLE_MAINTENANCE_ITEMS;
}

export async function getMaintenanceItem(id: string): Promise<MaintenanceItem> {
  if (isFirebaseConfigured() && import.meta.env.VITE_API_BASE_URL?.trim()) {
    try {
      const item = await apiRequest<MaintenanceItem>(agencyId(), `/api/v1/maintenance-items/${id}`);
      await localPut('maintenanceItems', item);
      return item;
    } catch (err) {
      console.warn('API getMaintenanceItem failed, checking local store:', err);
    }
  }

  const localItem = await localGet<MaintenanceItem>('maintenanceItems', id);
  if (localItem) return localItem;

  const sample = SAMPLE_MAINTENANCE_ITEMS.find((item) => item.id === id);
  if (sample) return sample;

  throw new Error(`Maintenance item with id ${id} not found.`);
}

export async function createMaintenanceItem(input: Partial<MaintenanceItem>): Promise<MaintenanceItem> {
  if (isFirebaseConfigured() && import.meta.env.VITE_API_BASE_URL?.trim()) {
    try {
      const created = await apiRequest<MaintenanceItem>(agencyId(), '/api/v1/maintenance-items/create', {
        method: 'POST',
        body: input,
      });
      await localPut('maintenanceItems', created);
      return created;
    } catch (err) {
      console.warn('API createMaintenanceItem failed, creating locally:', err);
    }
  }

  const now = new Date().toISOString();
  const newItem: MaintenanceItem = {
    id: input.id || `maint-${generateId()}`,
    agencyId: input.agencyId || agencyId() || 'proinspect-agency',
    propertyId: input.propertyId || 'prop-sample-01',
    sourceReportId: input.sourceReportId,
    sourceAreaId: input.sourceAreaId,
    sourceComponentId: input.sourceComponentId,
    candidateId: input.candidateId,
    title: input.title || 'New Maintenance Task',
    description: input.description || '',
    category: input.category || 'General Maintenance',
    priority: input.priority || 'routine',
    status: input.status || 'triage_required',
    sourceEvidenceIds: input.sourceEvidenceIds || [],
    assignedInternalUserId: input.assignedInternalUserId,
    externalContactId: input.externalContactId,
    approvalRequired: input.approvalRequired ?? false,
    approvalStatus: input.approvalStatus || 'not_required',
    dueDate: input.dueDate,
    targetCompletionDate: input.targetCompletionDate,
    workInstruction: input.workInstruction,
    workNotes: input.workNotes,
    completionEvidenceIds: input.completionEvidenceIds || [],
    verificationStatus: input.verificationStatus || 'unverified',
    createdBy: input.createdBy || 'current_user',
    createdAt: now,
    updatedAt: now,
    version: 1,
  };

  await localPut('maintenanceItems', newItem);
  return newItem;
}

export async function transitionMaintenanceItem(
  id: string,
  action: 'approve' | 'assign' | 'start' | 'await_evidence' | 'submit_completion' | 'verify' | 'close' | 'reopen' | 'cancel' | 'dismiss' | 'duplicate' | 'not_actionable',
  expectedVersion: number,
  body: Record<string, unknown> = {},
): Promise<MaintenanceItem> {
  if (isFirebaseConfigured() && import.meta.env.VITE_API_BASE_URL?.trim()) {
    try {
      const updated = await lifecycleAction<MaintenanceItem>('maintenance-items', id, action, expectedVersion, body);
      await localPut('maintenanceItems', updated);
      return updated;
    } catch (err) {
      console.warn('API transitionMaintenanceItem failed, transitioning locally:', err);
    }
  }

  const item = await getMaintenanceItem(id);
  const now = new Date().toISOString();

  switch (action) {
    case 'approve':
      item.approvalStatus = 'approved';
      item.status = 'approved';
      break;
    case 'assign':
      item.status = 'assigned';
      if (body.assignedInternalUserId) item.assignedInternalUserId = body.assignedInternalUserId as string;
      if (body.externalContactId) item.externalContactId = body.externalContactId as string;
      break;
    case 'start':
      item.status = 'in_progress';
      break;
    case 'await_evidence':
      item.status = 'awaiting_completion_evidence';
      break;
    case 'submit_completion':
      item.status = 'verification_required';
      if (body.completionNote) item.completionNote = body.completionNote as string;
      item.completionDate = now;
      break;
    case 'verify':
      item.status = 'verified';
      item.verificationStatus = 'verified';
      if (body.verificationNote) item.verificationNote = body.verificationNote as string;
      break;
    case 'close':
      item.status = 'closed';
      item.closedAt = now;
      if (body.closureReason) item.closureReason = body.closureReason as string;
      break;
    case 'reopen':
      item.status = 'in_progress';
      item.closedAt = undefined;
      break;
    case 'cancel':
      item.status = 'cancelled';
      break;
    case 'dismiss':
      item.status = 'dismissed';
      break;
    case 'duplicate':
      item.status = 'duplicate';
      break;
    case 'not_actionable':
      item.status = 'not_actionable';
      break;
  }

  item.updatedAt = now;
  item.version = (item.version || expectedVersion || 1) + 1;
  await localPut('maintenanceItems', item);
  return item;
}

export async function listExternalContacts(): Promise<ExternalContact[]> {
  if (isFirebaseConfigured() && import.meta.env.VITE_API_BASE_URL?.trim()) {
    try {
      const contacts = await apiRequest<ExternalContact[]>(agencyId(), '/api/v1/external-contacts');
      for (const contact of contacts) {
        await localPut('externalContacts', contact);
      }
      return contacts;
    } catch (err) {
      console.warn('API listExternalContacts failed, falling back to local store:', err);
    }
  }

  const localContacts = await localList<ExternalContact>('externalContacts');
  if (localContacts.length > 0) {
    return localContacts;
  }

  for (const contact of SAMPLE_EXTERNAL_CONTACTS) {
    await localPut('externalContacts', contact);
  }
  return SAMPLE_EXTERNAL_CONTACTS;
}

export async function createExternalContact(input: Partial<ExternalContact>): Promise<ExternalContact> {
  if (isFirebaseConfigured() && import.meta.env.VITE_API_BASE_URL?.trim()) {
    try {
      const created = await apiRequest<ExternalContact>(agencyId(), '/api/v1/external-contacts', { method: 'POST', body: input });
      await localPut('externalContacts', created);
      return created;
    } catch (err) {
      console.warn('API createExternalContact failed, saving locally:', err);
    }
  }

  const now = new Date().toISOString();
  const newContact: ExternalContact = {
    id: input.id || `contact-${generateId()}`,
    agencyId: input.agencyId || agencyId() || 'proinspect-agency',
    name: input.name || 'External Contractor',
    contactName: input.contactName || '',
    email: input.email || '',
    phone: input.phone || '',
    contactType: input.contactType || 'trade_contractor',
    tradeCategory: input.tradeCategory,
    active: input.active ?? true,
    createdAt: now,
    updatedAt: now,
  };

  await localPut('externalContacts', newContact);
  return newContact;
}

export async function listWorkRequests(): Promise<WorkRequest[]> {
  if (isFirebaseConfigured() && import.meta.env.VITE_API_BASE_URL?.trim()) {
    try {
      const requests = await apiRequest<WorkRequest[]>(agencyId(), '/api/v1/work-requests');
      for (const req of requests) {
        await localPut('workRequests', req);
      }
      return requests;
    } catch (err) {
      console.warn('API listWorkRequests failed, falling back to local store:', err);
    }
  }

  const localRequests = await localList<WorkRequest>('workRequests');
  if (localRequests.length > 0) {
    return localRequests;
  }

  for (const req of SAMPLE_WORK_REQUESTS) {
    await localPut('workRequests', req);
  }
  return SAMPLE_WORK_REQUESTS;
}

export async function createWorkRequest(input: Partial<WorkRequest>): Promise<WorkRequest> {
  if (isFirebaseConfigured() && import.meta.env.VITE_API_BASE_URL?.trim()) {
    try {
      const created = await apiRequest<WorkRequest>(agencyId(), '/api/v1/work-requests/create', {
        method: 'POST',
        body: input,
      });
      await localPut('workRequests', created);
      return created;
    } catch (err) {
      console.warn('API createWorkRequest failed, creating locally:', err);
    }
  }

  const now = new Date().toISOString();
  const newWorkRequest: WorkRequest = {
    id: input.id || `wr-${generateId()}`,
    agencyId: input.agencyId || agencyId() || 'proinspect-agency',
    propertyId: input.propertyId || 'prop-sample-01',
    maintenanceItemId: input.maintenanceItemId || 'maint-sample-01',
    externalContactId: input.externalContactId,
    title: input.title || 'Work Order',
    description: input.description || '',
    tradeCategory: input.tradeCategory || 'General Maintenance',
    priority: input.priority || 'routine',
    status: input.status || 'draft',
    issuedAt: input.issuedAt,
    dueDate: input.dueDate,
    accessInstructions: input.accessInstructions,
    contractorContactName: input.contractorContactName,
    contractorEmail: input.contractorEmail,
    contractorPhone: input.contractorPhone,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };

  await localPut('workRequests', newWorkRequest);
  return newWorkRequest;
}

export async function transitionWorkRequest(
  id: string,
  action: 'issue' | 'accept' | 'cancel',
  expectedVersion: number,
  body: Record<string, unknown> = {},
): Promise<WorkRequest> {
  if (isFirebaseConfigured() && import.meta.env.VITE_API_BASE_URL?.trim()) {
    try {
      const updated = await lifecycleAction<WorkRequest>('work-requests', id, action, expectedVersion, body);
      await localPut('workRequests', updated);
      return updated;
    } catch (err) {
      console.warn('API transitionWorkRequest failed, updating locally:', err);
    }
  }

  const requests = await listWorkRequests();
  const req = requests.find((r) => r.id === id);
  if (!req) throw new Error('Work request not found');

  const now = new Date().toISOString();
  if (action === 'issue') {
    req.status = 'issued';
    req.issuedAt = now;
  } else if (action === 'accept') {
    req.status = 'accepted';
  } else if (action === 'cancel') {
    req.status = 'cancelled';
  }

  req.updatedAt = now;
  req.version = (req.version || expectedVersion || 1) + 1;
  await localPut('workRequests', req);
  return req;
}

export async function listTenantInstructions(): Promise<TenantInstruction[]> {
  if (isFirebaseConfigured() && import.meta.env.VITE_API_BASE_URL?.trim()) {
    try {
      const instructions = await apiRequest<TenantInstruction[]>(agencyId(), '/api/v1/tenant-instructions');
      for (const inst of instructions) {
        await localPut('tenantInstructions', inst);
      }
      return instructions;
    } catch (err) {
      console.warn('API listTenantInstructions failed, falling back to local store:', err);
    }
  }

  const localInstructions = await localList<TenantInstruction>('tenantInstructions');
  if (localInstructions.length > 0) {
    return localInstructions;
  }

  for (const inst of SAMPLE_TENANT_INSTRUCTIONS) {
    await localPut('tenantInstructions', inst);
  }
  return SAMPLE_TENANT_INSTRUCTIONS;
}

export async function createTenantInstruction(input: Partial<TenantInstruction>): Promise<TenantInstruction> {
  if (isFirebaseConfigured() && import.meta.env.VITE_API_BASE_URL?.trim()) {
    try {
      const created = await apiRequest<TenantInstruction>(agencyId(), '/api/v1/tenant-instructions/create', {
        method: 'POST',
        body: input,
      });
      await localPut('tenantInstructions', created);
      return created;
    } catch (err) {
      console.warn('API createTenantInstruction failed, creating locally:', err);
    }
  }

  const now = new Date().toISOString();
  const newInstruction: TenantInstruction = {
    id: input.id || `ti-${generateId()}`,
    agencyId: input.agencyId || agencyId() || 'proinspect-agency',
    propertyId: input.propertyId || 'prop-sample-01',
    instructionType: input.instructionType || 'cleaning',
    title: input.title || 'Tenant Action Required',
    description: input.description || '',
    status: input.status || 'draft',
    issuedAt: input.issuedAt,
    targetDate: input.targetDate,
    primaryTenantName: input.primaryTenantName,
    primaryTenantEmail: input.primaryTenantEmail,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };

  await localPut('tenantInstructions', newInstruction);
  return newInstruction;
}

export async function transitionTenantInstruction(
  id: string,
  action: 'request_approval' | 'approve' | 'issue' | 'await_action' | 'review_response' | 'resolve' | 'close' | 'withdraw' | 'cancel',
  expectedVersion: number,
  body: Record<string, unknown> = {},
): Promise<TenantInstruction> {
  if (isFirebaseConfigured() && import.meta.env.VITE_API_BASE_URL?.trim()) {
    try {
      const updated = await lifecycleAction<TenantInstruction>('tenant-instructions', id, action, expectedVersion, body);
      await localPut('tenantInstructions', updated);
      return updated;
    } catch (err) {
      console.warn('API transitionTenantInstruction failed, updating locally:', err);
    }
  }

  const instructions = await listTenantInstructions();
  const inst = instructions.find((t) => t.id === id);
  if (!inst) throw new Error('Tenant instruction not found');

  const now = new Date().toISOString();
  switch (action) {
    case 'issue':
      inst.status = 'issued';
      inst.issuedAt = now;
      break;
    case 'await_action':
      inst.status = 'issued';
      break;
    case 'review_response':
      inst.status = 'tenant_response_received';
      break;
    case 'resolve':
    case 'close':
      inst.status = 'resolved';
      break;
    case 'withdraw':
    case 'cancel':
      inst.status = 'cancelled';
      break;
  }

  inst.updatedAt = now;
  inst.version = (inst.version || expectedVersion || 1) + 1;
  await localPut('tenantInstructions', inst);
  return inst;
}

export async function listClientApprovals(): Promise<ClientApproval[]> {
  if (isFirebaseConfigured() && import.meta.env.VITE_API_BASE_URL?.trim()) {
    try {
      const approvals = await apiRequest<ClientApproval[]>(agencyId(), '/api/v1/client-approvals');
      for (const app of approvals) {
        await localPut('clientApprovals', app);
      }
      return approvals;
    } catch (err) {
      console.warn('API listClientApprovals failed, falling back to local store:', err);
    }
  }

  const localApprovals = await localList<ClientApproval>('clientApprovals');
  if (localApprovals.length > 0) {
    return localApprovals;
  }

  for (const app of SAMPLE_CLIENT_APPROVALS) {
    await localPut('clientApprovals', app);
  }
  return SAMPLE_CLIENT_APPROVALS;
}

export async function createClientApproval(input: Partial<ClientApproval>): Promise<ClientApproval> {
  if (isFirebaseConfigured() && import.meta.env.VITE_API_BASE_URL?.trim()) {
    try {
      const created = await apiRequest<ClientApproval>(agencyId(), '/api/v1/client-approvals', {
        method: 'POST',
        body: { ...input, status: input.status || 'pending' },
      });
      await localPut('clientApprovals', created);
      return created;
    } catch (err) {
      console.warn('API createClientApproval failed, creating locally:', err);
    }
  }

  const now = new Date().toISOString();
  const newApproval: ClientApproval = {
    id: input.id || `appr-${generateId()}`,
    agencyId: input.agencyId || agencyId() || 'proinspect-agency',
    propertyId: input.propertyId || 'prop-sample-01',
    resourceType: input.resourceType || 'work_request',
    resourceId: input.resourceId || 'wr-sample-01',
    title: input.title || 'Client Approval Request',
    description: input.description || '',
    status: input.status || 'pending',
    recipientEmail: input.recipientEmail || 'owner@example.com',
    createdAt: now,
    updatedAt: now,
    version: 1,
  };

  await localPut('clientApprovals', newApproval);
  return newApproval;
}

export async function generateAccessGrant(
  resourceType: 'work_request' | 'tenant_instruction' | 'client_approval',
  resourceId: string,
  recipientEmail: string,
  expiresInHours = 72,
): Promise<{ grantId: string; grantToken: string; expiresAt: string; accessUrl: string }> {
  if (isFirebaseConfigured() && import.meta.env.VITE_API_BASE_URL?.trim()) {
    try {
      return await apiRequest(agencyId(), '/api/v1/external-access-grants/generate', {
        method: 'POST',
        body: { resourceType, resourceId, recipientEmail, expiresInHours },
      });
    } catch (err) {
      console.warn('API generateAccessGrant failed, returning local grant URL:', err);
    }
  }

  const token = `token-${generateId()}`;
  const expiresAt = new Date(Date.now() + expiresInHours * 3600000).toISOString();
  const routePrefix = resourceType === 'work_request' ? 'work-request' : resourceType === 'tenant_instruction' ? 'tenant-instruction' : 'client-approval';
  return {
    grantId: `grant-${generateId()}`,
    grantToken: token,
    expiresAt,
    accessUrl: `${window.location.origin}/portal/${routePrefix}?token=${token}`,
  };
}

export async function getExternalWorkRequest(
  grantToken: string,
): Promise<{ workRequest: WorkRequest; maintenanceItem: Partial<MaintenanceItem> | null; propertyAddress: string }> {
  if (isFirebaseConfigured() && import.meta.env.VITE_API_BASE_URL?.trim()) {
    try {
      return await externalRequest(`/api/v1/external/work-requests/${encodeURIComponent(grantToken)}`);
    } catch (err) {
      console.warn('External getExternalWorkRequest failed, returning local fallback:', err);
    }
  }

  const requests = await listWorkRequests();
  const workRequest = requests[0] || SAMPLE_WORK_REQUESTS[0];
  return {
    workRequest,
    maintenanceItem: SAMPLE_MAINTENANCE_ITEMS[0],
    propertyAddress: '104 Ocean Drive, Scarborough WA 6019',
  };
}

export async function submitExternalWorkResponse(
  grantToken: string,
  action: 'acknowledge' | 'in_progress' | 'complete' | 'unable_to_complete',
  responseNotes?: string,
  completionEvidenceIds?: string[],
): Promise<WorkRequest> {
  if (isFirebaseConfigured() && import.meta.env.VITE_API_BASE_URL?.trim()) {
    try {
      return await externalRequest(`/api/v1/external/work-requests/${encodeURIComponent(grantToken)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, responseNotes, completionEvidenceIds }),
      });
    } catch (err) {
      console.warn('External submitExternalWorkResponse failed, updating locally:', err);
    }
  }

  const requests = await listWorkRequests();
  const workRequest = requests[0] || SAMPLE_WORK_REQUESTS[0];
  workRequest.status = action === 'complete' ? 'completed' : 'in_progress';
  workRequest.updatedAt = new Date().toISOString();
  await localPut('workRequests', workRequest);
  return workRequest;
}

export async function getExternalTenantInstruction(grantToken: string): Promise<TenantInstruction> {
  if (isFirebaseConfigured() && import.meta.env.VITE_API_BASE_URL?.trim()) {
    try {
      return await externalRequest(`/api/v1/external/tenant-instructions/${encodeURIComponent(grantToken)}`);
    } catch (err) {
      console.warn('External getExternalTenantInstruction failed, returning local fallback:', err);
    }
  }

  const instructions = await listTenantInstructions();
  return instructions[0] || SAMPLE_TENANT_INSTRUCTIONS[0];
}

export async function submitExternalTenantResponse(
  grantToken: string,
  tenantResponseNote: string,
  tenantEvidenceIds?: string[],
): Promise<TenantInstruction> {
  if (isFirebaseConfigured() && import.meta.env.VITE_API_BASE_URL?.trim()) {
    try {
      return await externalRequest(`/api/v1/external/tenant-instructions/${encodeURIComponent(grantToken)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenantResponseNote, tenantEvidenceIds }),
      });
    } catch (err) {
      console.warn('External submitExternalTenantResponse failed, updating locally:', err);
    }
  }

  const instructions = await listTenantInstructions();
  const instruction = instructions[0] || SAMPLE_TENANT_INSTRUCTIONS[0];
  instruction.status = 'tenant_response_received';
  instruction.updatedAt = new Date().toISOString();
  await localPut('tenantInstructions', instruction);
  return instruction;
}

export async function getExternalClientApproval(grantToken: string): Promise<ClientApproval> {
  if (isFirebaseConfigured() && import.meta.env.VITE_API_BASE_URL?.trim()) {
    try {
      return await externalRequest(`/api/v1/external/client-approvals/${encodeURIComponent(grantToken)}`);
    } catch (err) {
      console.warn('External getExternalClientApproval failed, returning local fallback:', err);
    }
  }

  const approvals = await listClientApprovals();
  return approvals[0] || SAMPLE_CLIENT_APPROVALS[0];
}

export async function submitExternalClientApproval(
  grantToken: string,
  decision: 'approved' | 'declined' | 'information_requested',
  clientNotes?: string,
): Promise<ClientApproval> {
  if (isFirebaseConfigured() && import.meta.env.VITE_API_BASE_URL?.trim()) {
    try {
      return await externalRequest(`/api/v1/external/client-approvals/${encodeURIComponent(grantToken)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision, clientNotes }),
      });
    } catch (err) {
      console.warn('External submitExternalClientApproval failed, updating locally:', err);
    }
  }

  const approvals = await listClientApprovals();
  const approval = approvals[0] || SAMPLE_CLIENT_APPROVALS[0];
  approval.status = decision;
  approval.respondedAt = new Date().toISOString();
  approval.updatedAt = new Date().toISOString();
  await localPut('clientApprovals', approval);
  return approval;
}
