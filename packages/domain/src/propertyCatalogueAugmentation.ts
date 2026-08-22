export type PropertyLayoutComponentInclusion = 'required' | 'default' | 'optional' | 'conditional';

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
}

declare module './reportModel.js' {
  interface ReportAreaRecord {
    /** Exact catalogue Area definition represented by this immutable Report Area instance. */
    canonicalAreaDefinitionId?: string;
    canonicalAreaDefinitionVersion?: number;
  }

  interface ReportComponentRecord {
    /** Exact catalogue Component definition represented by this Property/Report Component instance. */
    canonicalComponentDefinitionId?: string;
    canonicalComponentDefinitionVersion?: number;
    /** Exact Area-Component rule that supplied assessment/evidence defaults. */
    canonicalAreaComponentRuleId?: string;
    canonicalAreaComponentRuleVersion?: number;
  }
}
