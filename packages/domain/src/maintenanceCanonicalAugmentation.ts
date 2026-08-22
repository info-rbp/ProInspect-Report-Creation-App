declare module './maintenance.js' {
  interface MaintenanceCandidate {
    sourceCanonicalAreaDefinitionId?: string;
    sourceCanonicalAreaDefinitionVersion?: number;
    sourceCanonicalComponentDefinitionId?: string;
    sourceCanonicalComponentDefinitionVersion?: number;
    sourceCanonicalAreaComponentRuleId?: string;
    sourceCanonicalAreaComponentRuleVersion?: number;
  }

  interface MaintenanceItem {
    sourceCanonicalAreaDefinitionId?: string;
    sourceCanonicalAreaDefinitionVersion?: number;
    sourceCanonicalComponentDefinitionId?: string;
    sourceCanonicalComponentDefinitionVersion?: number;
    sourceCanonicalAreaComponentRuleId?: string;
    sourceCanonicalAreaComponentRuleVersion?: number;
  }

  interface TenantInstruction {
    sourceCanonicalAreaDefinitionId?: string;
    sourceCanonicalAreaDefinitionVersion?: number;
    sourceCanonicalComponentDefinitionId?: string;
    sourceCanonicalComponentDefinitionVersion?: number;
  }
}

declare module './maintenanceCommercial.js' {
  interface PriceBookEntry {
    /** Optional exact semantic match constraints. Empty arrays retain legacy text/category matching. */
    canonicalAreaDefinitionIds?: string[];
    canonicalComponentDefinitionIds?: string[];
  }
}

export {};
