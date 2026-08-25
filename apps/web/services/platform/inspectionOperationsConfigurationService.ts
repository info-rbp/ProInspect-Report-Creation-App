import type {
  InspectionServiceMapping,
  InspectorCapabilityProfile,
} from '../../types/platform';
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

function recordVersion(record: { version?: number }): number {
  return record.version ?? 1;
}

export async function listInspectionServiceMappings(): Promise<InspectionServiceMapping[]> {
  if (cloudMode()) {
    return apiRequest<InspectionServiceMapping[]>(
      agencyId(),
      '/api/v1/inspection-service-mappings?limit=100',
    );
  }
  return localList<InspectionServiceMapping>('inspectionServiceMappings');
}

export async function saveInspectionServiceMapping(
  input: Partial<InspectionServiceMapping> & Pick<InspectionServiceMapping, 'agencyId' | 'provider' | 'serviceCode' | 'label' | 'reportType'>,
): Promise<InspectionServiceMapping> {
  const now = new Date().toISOString();
  const id = input.id || `service-mapping-${generateId()}`;
  const record: InspectionServiceMapping = {
    id,
    agencyId: input.agencyId,
    provider: input.provider,
    active: input.active !== false,
    serviceCode: input.serviceCode.trim(),
    label: input.label.trim(),
    productId: input.productId?.trim() || undefined,
    variantId: input.variantId?.trim() || undefined,
    productHandle: input.productHandle?.trim() || undefined,
    sku: input.sku?.trim() || undefined,
    calendarSummaryPattern: input.calendarSummaryPattern?.trim() || undefined,
    bookingPageUrl: input.bookingPageUrl?.trim() || undefined,
    reportType: input.reportType,
    propertyUse: input.propertyUse,
    defaultDurationMinutes: Math.max(1, Math.round(input.defaultDurationMinutes || 60)),
    paymentRequired: input.paymentRequired === true,
    manualApprovalRequired: input.manualApprovalRequired === true,
    defaultPriority: input.defaultPriority || 'normal',
    defaultInspectorId: input.defaultInspectorId || undefined,
    defaultReviewerId: input.defaultReviewerId || undefined,
    templateId: input.templateId || undefined,
    createdAt: input.createdAt || now,
    updatedAt: now,
    version: input.version,
  };

  if (cloudMode()) {
    const existing = input.id
      ? await apiRequest<InspectionServiceMapping | null>(
          input.agencyId,
          `/api/v1/inspection-service-mappings/${encodeURIComponent(id)}`,
        ).catch(() => null)
      : null;
    if (existing) {
      return apiRequest<InspectionServiceMapping>(
        input.agencyId,
        `/api/v1/inspection-service-mappings/${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          body: { ...record, expectedVersion: recordVersion(existing) },
        },
      );
    }
    return apiRequest<InspectionServiceMapping>(
      input.agencyId,
      '/api/v1/inspection-service-mappings',
      { method: 'POST', body: record },
    );
  }

  await localPut('inspectionServiceMappings', record);
  return record;
}

export async function setInspectionServiceMappingActive(
  mapping: InspectionServiceMapping,
  active: boolean,
): Promise<InspectionServiceMapping> {
  return saveInspectionServiceMapping({ ...mapping, active });
}

export async function listInspectorProfiles(): Promise<InspectorCapabilityProfile[]> {
  if (cloudMode()) {
    return apiRequest<InspectorCapabilityProfile[]>(
      agencyId(),
      '/api/v1/inspector-capability-profiles?limit=100',
    );
  }
  return localList<InspectorCapabilityProfile>('inspectorCapabilityProfiles');
}

export async function saveInspectorProfile(
  input: Partial<InspectorCapabilityProfile> & Pick<InspectorCapabilityProfile, 'agencyId' | 'userId' | 'displayName' | 'role'>,
): Promise<InspectorCapabilityProfile> {
  const now = new Date().toISOString();
  const id = input.id || `inspector-profile-${input.userId || generateId()}`;
  const record: InspectorCapabilityProfile = {
    id,
    agencyId: input.agencyId,
    userId: input.userId,
    displayName: input.displayName.trim(),
    role: input.role,
    active: input.active !== false,
    inspectionTypes: input.inspectionTypes || [],
    propertyUses: input.propertyUses || [],
    serviceAreas: input.serviceAreas || [],
    commercialQualified: input.commercialQualified === true,
    strataQualified: input.strataQualified === true,
    maxJobsPerDay: input.maxJobsPerDay,
    defaultCalendarId: input.defaultCalendarId,
    workingHours: input.workingHours,
    createdAt: input.createdAt || now,
    updatedAt: now,
    version: input.version,
  };

  if (cloudMode()) {
    const existing = input.id
      ? await apiRequest<InspectorCapabilityProfile | null>(
          input.agencyId,
          `/api/v1/inspector-capability-profiles/${encodeURIComponent(id)}`,
        ).catch(() => null)
      : null;
    if (existing) {
      return apiRequest<InspectorCapabilityProfile>(
        input.agencyId,
        `/api/v1/inspector-capability-profiles/${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          body: { ...record, expectedVersion: recordVersion(existing) },
        },
      );
    }
    return apiRequest<InspectorCapabilityProfile>(
      input.agencyId,
      '/api/v1/inspector-capability-profiles',
      { method: 'POST', body: record },
    );
  }

  const existing = await localGet<InspectorCapabilityProfile>(
    'inspectorCapabilityProfiles',
    id,
  );
  await localPut('inspectorCapabilityProfiles', {
    ...existing,
    ...record,
  });
  return record;
}
