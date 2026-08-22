export type HistoricalMappingDecision = 'suggested' | 'confirmed' | 'edited' | 'rejected';

export interface HistoricalExtractedFinding {
  id: string;
  sourceArea: string;
  sourceComponent: string;
  sourceCommentary: string;
  sourceCondition?: string;
  sourceCleanliness?: string;
  sourceWorkingStatus?: string;
  sourcePage?: number;
  /** Property-owned Area instance when a current occurrence can be identified. */
  proposedAreaId?: string;
  /** Legacy compatibility field. New extraction uses canonical Component definition identity. */
  proposedComponentId?: string;
  proposedCanonicalAreaDefinitionId?: string;
  proposedCanonicalAreaDefinitionVersion?: number;
  proposedCanonicalComponentDefinitionId?: string;
  proposedCanonicalComponentDefinitionVersion?: number;
  confidence: number;
  uncertainty?: string;
  decision: HistoricalMappingDecision;
  reviewerNote?: string;
}

export interface PropertyDocumentAnalysisRecord {
  id: string;
  agencyId: string;
  propertyId: string;
  documentId: string;
  sourceSha256?: string;
  sourceGeneration?: string;
  promptVersion: string;
  model: string;
  status: 'review_required' | 'mapped' | 'rejected' | 'failed';
  detectedReportType?: string;
  detectedInspectionDate?: string;
  summary: string;
  findings: HistoricalExtractedFinding[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface PropertyFloorPlanHotspot {
  id: string;
  areaId: string;
  areaName: string;
  canonicalAreaDefinitionId?: string;
  canonicalAreaDefinitionVersion?: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
}

export interface PropertyFloorPlanMap {
  id: string;
  agencyId: string;
  propertyId: string;
  documentId: string;
  title: string;
  layoutVersionId?: string;
  hotspots: PropertyFloorPlanHotspot[];
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
  version: number;
}
