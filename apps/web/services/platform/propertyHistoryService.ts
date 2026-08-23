import { apiRequest } from '../apiClient';
import { isFirebaseConfigured } from '../storageService';
import { localGet, localList } from './localPlatformStore';
import type { InspectionJob, MaintenanceItem, PropertyRecord } from '../../types/platform';

export interface PropertyHistoryObservation {
  reportId: string;
  reportVersionId: string;
  reportType: string;
  inspectionDate?: string;
  lifecycleStatus: string;
  areaId: string;
  areaName: string;
  canonicalAreaDefinitionId?: string;
  canonicalAreaDefinitionVersion?: number;
  componentId: string;
  componentName: string;
  canonicalComponentDefinitionId?: string;
  canonicalComponentDefinitionVersion?: number;
  canonicalAreaComponentRuleId?: string;
  canonicalAreaComponentRuleVersion?: number;
  conditionCategory: string;
  cleanlinessCategory: string;
  workingStatus: string;
  testStatus: string;
  commentary: string;
  defects: string[];
  evidencePhotoIds: string[];
  versionCreatedAt?: string;
}

export interface PropertyHistoryMaintenance {
  id: string;
  title: string;
  category: string;
  priority: string;
  status: string;
  sourceReportId?: string;
  sourceReportVersionId?: string;
  sourceAreaId?: string;
  sourceComponentId?: string;
  sourceCanonicalAreaDefinitionId?: string;
  sourceCanonicalAreaDefinitionVersion?: number;
  sourceCanonicalComponentDefinitionId?: string;
  sourceCanonicalComponentDefinitionVersion?: number;
  sourceEvidenceIds: string[];
  completionEvidenceIds: string[];
  createdAt?: string;
  updatedAt?: string;
  closedAt?: string;
}

export interface PropertyComponentHistory {
  stableKey: string;
  identityMode: 'canonical_occurrence' | 'canonical_semantic' | 'legacy_instance';
  areaId: string;
  areaName: string;
  canonicalAreaDefinitionId?: string;
  componentId: string;
  componentName: string;
  canonicalComponentDefinitionId?: string;
  observations: PropertyHistoryObservation[];
  maintenance: PropertyHistoryMaintenance[];
}

export interface PropertyHistory {
  propertyId: string;
  propertyAddress: string;
  identityMode?: 'canonical_first';
  inspections: Array<{
    reportId: string;
    reportType: string;
    inspectionDate?: string;
    lifecycleStatus: string;
    currentVersionId?: string;
    templateId?: string;
    templateVersion?: number;
    propertyLayoutVersionId?: string;
    structureResolutionVersion?: number;
    canonicalCatalogueId?: string;
    canonicalCatalogueVersion?: number;
    immutableVersionCount: number;
    sourceMaintenanceItemIds?: string[];
  }>;
  components: PropertyComponentHistory[];
  maintenance: PropertyHistoryMaintenance[];
  generatedAt: string;
}

export async function getPropertyHistory(propertyId: string, agencyId?: string): Promise<PropertyHistory> {
  if (isFirebaseConfigured() && import.meta.env.VITE_API_BASE_URL?.trim()) {
    try {
      return await apiRequest<PropertyHistory>(agencyId, `/api/v1/properties/${encodeURIComponent(propertyId)}/history`);
    } catch (err) {
      console.warn('API getPropertyHistory failed, assembling local history:', err);
    }
  }

  // Local synthesis
  const property = await localGet<PropertyRecord>('properties', propertyId);
  const allJobs = await localList<InspectionJob>('inspectionJobs');
  const propertyJobs = allJobs.filter((job) => job.propertyId === propertyId);

  const allMaintenance = await localList<MaintenanceItem>('maintenanceItems');
  const propertyMaintenance = allMaintenance.filter((item) => item.propertyId === propertyId);

  const mappedMaintenance: PropertyHistoryMaintenance[] = propertyMaintenance.map((item) => ({
    id: item.id,
    title: item.title,
    category: item.category,
    priority: item.priority,
    status: item.status,
    sourceReportId: item.sourceReportId,
    sourceReportVersionId: item.sourceReportVersionId,
    sourceAreaId: item.sourceAreaId,
    sourceComponentId: item.sourceComponentId,
    sourceEvidenceIds: item.sourceEvidenceIds || [],
    completionEvidenceIds: item.completionEvidenceIds || [],
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    closedAt: item.closedAt,
  }));

  const componentsMap = new Map<string, PropertyComponentHistory>();

  for (const m of mappedMaintenance) {
    if (m.sourceAreaId && m.sourceComponentId) {
      const stableKey = `${m.sourceAreaId}::${m.sourceComponentId}`;
      if (!componentsMap.has(stableKey)) {
        componentsMap.set(stableKey, {
          stableKey,
          areaId: m.sourceAreaId,
          areaName: m.sourceAreaId.replaceAll('-', ' '),
          componentId: m.sourceComponentId,
          componentName: m.sourceComponentId.replaceAll('-', ' '),
          observations: [],
          maintenance: [],
        });
      }
      componentsMap.get(stableKey)!.maintenance.push(m);
    }
  }

  return {
    propertyId,
    propertyAddress: property?.address ? `${property.address.line1}, ${property.address.suburb}` : 'Local Property',
    inspections: propertyJobs.map((job) => ({
      reportId: job.id,
      reportType: job.type || 'entry',
      inspectionDate: job.scheduledDate,
      lifecycleStatus: job.status,
      currentVersionId: job.id,
      immutableVersionCount: 1,
    })),
    components: Array.from(componentsMap.values()),
    maintenance: mappedMaintenance,
    generatedAt: new Date().toISOString(),
  };
}
