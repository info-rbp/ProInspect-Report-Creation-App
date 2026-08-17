import type {
  BaselineComponentSnapshot,
  ComponentComparisonMethod,
  ReportPhotoReference,
} from './reportModel.js';

export type LegacyBaselineSourceType = 'pdf' | 'document' | 'manual';

export interface LegacyBaselineSource {
  sourceId: string;
  sourceType: LegacyBaselineSourceType;
  sourceName: string;
  sourceObjectPath?: string;
  sourceSha256?: string;
  sourceDate?: string;
}

export interface LegacyBaselineComponentMapping {
  areaId: string;
  componentId: string;
  sourceAreaLabel: string;
  sourceComponentLabel: string;
  sourceExcerpt?: string;
  baseline: BaselineComponentSnapshot;
  evidenceReferences?: ReportPhotoReference[];
  mappingMethod: Extract<ComponentComparisonMethod, 'legacy_mapping' | 'manual'>;
  confidence: number;
  reviewNote?: string;
}

export interface LegacyBaselineMappingRecord {
  id: string;
  agencyId: string;
  exitReportId: string;
  propertyId: string;
  tenancyId?: string;
  source: LegacyBaselineSource;
  mappings: LegacyBaselineComponentMapping[];
  reviewedBy: string;
  reviewedAt: string;
  createdAt: string;
}

export function validateLegacyMapping(mapping: LegacyBaselineComponentMapping): void {
  if (!mapping.areaId.trim() || !mapping.componentId.trim()) throw new Error('Legacy mapping requires stable area and component IDs.');
  if (!mapping.sourceAreaLabel.trim() || !mapping.sourceComponentLabel.trim()) throw new Error('Legacy mapping requires source area and component labels.');
  if (!['legacy_mapping', 'manual'].includes(mapping.mappingMethod)) throw new Error('Legacy mapping method must be legacy_mapping or manual.');
  if (!Number.isFinite(mapping.confidence) || mapping.confidence < 0 || mapping.confidence > 0.7) {
    throw new Error('Legacy mapping confidence must be between 0 and 0.7 because the source is unstructured.');
  }
}
