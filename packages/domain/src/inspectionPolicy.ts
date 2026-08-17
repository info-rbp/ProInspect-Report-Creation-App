export type CanonicalInspectionType = 'entry' | 'routine' | 'exit' | 'comparison' | 'maintenance';

export interface InspectionTypePolicy {
  inspectionType: CanonicalInspectionType;
  displayName: string;
  detailedBaseline: boolean;
  exceptionFocused: boolean;
  requiresBaseline: boolean;
  baselineType?: CanonicalInspectionType;
  tenantReviewDefault: boolean;
  comparisonRequired: boolean;
  maintenanceExtractionEnabled: boolean;
  ordinaryComponentCommentaryRequired: boolean;
  areaOverviewEvidenceRequired: boolean;
}

const POLICIES: Record<CanonicalInspectionType, InspectionTypePolicy> = {
  entry: {
    inspectionType: 'entry',
    displayName: 'Property Condition Report',
    detailedBaseline: true,
    exceptionFocused: false,
    requiresBaseline: false,
    tenantReviewDefault: true,
    comparisonRequired: false,
    maintenanceExtractionEnabled: true,
    ordinaryComponentCommentaryRequired: true,
    areaOverviewEvidenceRequired: true,
  },
  routine: {
    inspectionType: 'routine',
    displayName: 'Routine Inspection',
    detailedBaseline: false,
    exceptionFocused: true,
    requiresBaseline: false,
    tenantReviewDefault: false,
    comparisonRequired: false,
    maintenanceExtractionEnabled: true,
    ordinaryComponentCommentaryRequired: false,
    areaOverviewEvidenceRequired: true,
  },
  exit: {
    inspectionType: 'exit',
    displayName: 'Exit Inspection',
    detailedBaseline: true,
    exceptionFocused: true,
    requiresBaseline: true,
    baselineType: 'entry',
    tenantReviewDefault: true,
    comparisonRequired: true,
    maintenanceExtractionEnabled: true,
    ordinaryComponentCommentaryRequired: true,
    areaOverviewEvidenceRequired: true,
  },
  comparison: {
    inspectionType: 'comparison',
    displayName: 'Inspection Comparison Report',
    detailedBaseline: false,
    exceptionFocused: true,
    requiresBaseline: true,
    tenantReviewDefault: false,
    comparisonRequired: true,
    maintenanceExtractionEnabled: true,
    ordinaryComponentCommentaryRequired: false,
    areaOverviewEvidenceRequired: false,
  },
  maintenance: {
    inspectionType: 'maintenance',
    displayName: 'Maintenance and Follow-Up Report',
    detailedBaseline: false,
    exceptionFocused: true,
    requiresBaseline: true,
    tenantReviewDefault: false,
    comparisonRequired: true,
    maintenanceExtractionEnabled: true,
    ordinaryComponentCommentaryRequired: false,
    areaOverviewEvidenceRequired: false,
  },
};

const DISPLAY_NAME_TO_TYPE: Record<string, CanonicalInspectionType> = Object.fromEntries(
  Object.values(POLICIES).map((policy) => [policy.displayName.toLowerCase(), policy.inspectionType]),
) as Record<string, CanonicalInspectionType>;

export function canonicalInspectionType(value: string): CanonicalInspectionType {
  const normalised = value.trim().toLowerCase();
  if (normalised in POLICIES) return normalised as CanonicalInspectionType;
  return DISPLAY_NAME_TO_TYPE[normalised] ?? 'entry';
}

export function inspectionPolicy(value: string): InspectionTypePolicy {
  return POLICIES[canonicalInspectionType(value)];
}

export const INSPECTION_TYPE_POLICIES = POLICIES;
