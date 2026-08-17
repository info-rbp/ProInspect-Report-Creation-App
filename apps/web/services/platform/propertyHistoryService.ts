import { apiRequest } from '../apiClient';

export interface PropertyHistoryObservation {
  reportId: string;
  reportVersionId: string;
  reportType: string;
  inspectionDate?: string;
  lifecycleStatus: string;
  areaId: string;
  areaName: string;
  componentId: string;
  componentName: string;
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
  sourceEvidenceIds: string[];
  completionEvidenceIds: string[];
  createdAt?: string;
  updatedAt?: string;
  closedAt?: string;
}

export interface PropertyComponentHistory {
  stableKey: string;
  areaId: string;
  areaName: string;
  componentId: string;
  componentName: string;
  observations: PropertyHistoryObservation[];
  maintenance: PropertyHistoryMaintenance[];
}

export interface PropertyHistory {
  propertyId: string;
  propertyAddress: string;
  inspections: Array<{
    reportId: string;
    reportType: string;
    inspectionDate?: string;
    lifecycleStatus: string;
    currentVersionId?: string;
    templateId?: string;
    templateVersion?: number;
    immutableVersionCount: number;
    sourceMaintenanceItemIds?: string[];
  }>;
  components: PropertyComponentHistory[];
  maintenance: PropertyHistoryMaintenance[];
  generatedAt: string;
}

export async function getPropertyHistory(propertyId: string, agencyId?: string): Promise<PropertyHistory> {
  return apiRequest<PropertyHistory>(agencyId, `/api/v1/properties/${encodeURIComponent(propertyId)}/history`);
}