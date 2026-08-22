export type PropertyLayoutComponentInclusion = 'required' | 'default' | 'optional' | 'conditional';

export type ReportFieldRequirement = 'required' | 'optional' | 'hidden';
export type ReportOperationalTestRequirement = 'required' | 'recommended' | 'optional' | 'not_applicable';
export type ReportCommentaryRequirement = 'always' | 'exception_only' | 'optional' | 'hidden';

/** Immutable requirement snapshot resolved from the exact Area-Component catalogue rule. */
export interface ReportComponentRequirementSnapshot {
  condition: ReportFieldRequirement;
  cleanliness: ReportFieldRequirement;
  material: ReportFieldRequirement;
  colour: ReportFieldRequirement;
  type: ReportFieldRequirement;
  quantity: ReportFieldRequirement;
  workingStatus: ReportFieldRequirement;
  operationalTest: ReportOperationalTestRequirement;
  commentary: ReportCommentaryRequirement;
  maintenanceEvaluation: boolean;
  componentPhotoRequired: boolean;
  exceptionPhotoRequired: boolean;
  contextPhotoRequired: boolean;
  minimumPhotos: number;
  minimumExceptionPhotos: number;
  comparisonPairRequired: boolean;
  reasonRequiredIfMissing: boolean;
}

/**
 * Property-owned Component instance bound to an exact immutable catalogue definition/rule version.
 * The instance id belongs to the Property layout; the canonical ids describe what the instance is.
 */
export interface PropertyLayoutComponentReference {
  id: string;
  name: string;
  canonicalComponentDefinitionId: string;
  canonicalComponentDefinitionVersion: number;
  canonicalAreaComponentRuleId: string;
  canonicalAreaComponentRuleVersion: number;
  order: number;
  inclusion: PropertyLayoutComponentInclusion;
  photoRequired: boolean;
}

declare module './platform.js' {
  interface RoomConfigItem {
    /** Exact published Area definition used by this Property-owned Area instance. */
    canonicalAreaDefinitionId?: string;
    canonicalAreaDefinitionVersion?: number;
    /** Property-owned Component instances populated from the exact Area-Component rule set. */
    componentRefs?: PropertyLayoutComponentReference[];
  }

  interface PropertyLayoutNode {
    canonicalAreaDefinitionId?: string;
    canonicalAreaDefinitionVersion?: number;
    componentRefs?: PropertyLayoutComponentReference[];
  }

  interface PropertyLayoutVersion {
    /** Stable catalogue identity used when this layout snapshot was created. */
    canonicalCatalogueId?: string;
    /** Version of the Property-layout catalogue contract used to resolve the snapshot. */
    canonicalCatalogueVersion?: number;
  }

  interface PropertyAsset {
    /** Property occurrence and canonical semantic binding for cross-report asset history. */
    canonicalAreaDefinitionId?: string;
    canonicalAreaDefinitionVersion?: number;
    canonicalComponentDefinitionId?: string;
    canonicalComponentDefinitionVersion?: number;
  }

  interface HistoricalMappingCandidate {
    proposedCanonicalAreaDefinitionId?: string;
    proposedCanonicalAreaDefinitionVersion?: number;
    proposedCanonicalComponentDefinitionId?: string;
    proposedCanonicalComponentDefinitionVersion?: number;
  }
}

declare module './reportModel.js' {
  interface ReportAreaRecord {
    /** Exact catalogue Area definition represented by this immutable Report Area instance. */
    canonicalAreaDefinitionId?: string;
    canonicalAreaDefinitionVersion?: number;
    /** Template membership responsible for this Area when a restrictive template is used. */
    templateAreaReferenceId?: string;
  }

  interface ReportComponentRecord {
    /** Exact catalogue Component definition represented by this Property/Report Component instance. */
    canonicalComponentDefinitionId?: string;
    canonicalComponentDefinitionVersion?: number;
    /** Exact Area-Component rule that supplied assessment/evidence defaults. */
    canonicalAreaComponentRuleId?: string;
    canonicalAreaComponentRuleVersion?: number;
    /** Immutable QC/inspection requirement snapshot resolved when the Report was created. */
    requirementSnapshot?: ReportComponentRequirementSnapshot;
  }

  interface ReportMetadataRecord {
    /** Server-side structure resolver contract. */
    structureResolutionVersion?: number;
    templateStructureMode?: 'property_layout_catalogue';
    canonicalCatalogueId?: string;
    canonicalCatalogueVersion?: number;
  }
}
