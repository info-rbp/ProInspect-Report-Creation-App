import type {
  InspectionType,
  PhysicalPropertyType,
  PropertyUse,
  RoomConfigItem,
} from '@pcr/domain';

export type InspectionTemplateStructureMode = 'property_layout_catalogue';
export type InspectionTemplateAreaInclusion = 'required' | 'default' | 'optional' | 'excluded';

export interface CanonicalInspectionTemplateAreaReference {
  id: string;
  canonicalAreaDefinitionId: string;
  canonicalAreaDefinitionVersion: number;
  inclusion: InspectionTemplateAreaInclusion;
  /** Optional exact Area-Component rules to include. Empty means use the Property Area instance composition. */
  canonicalAreaComponentRuleReferences?: Array<{
    id: string;
    version: number;
  }>;
}

export interface CanonicalInspectionTemplateContract {
  id: string;
  version: number;
  inspectionType: InspectionType;
  status: 'draft' | 'published' | 'retired';
  structureMode: InspectionTemplateStructureMode;
  /**
   * Dynamic Property-layout templates intentionally keep this true. Area references are semantic
   * constraints/overrides, not embedded copies of Area or Component definitions.
   */
  includeUnreferencedPropertyAreas: boolean;
  areaReferences: CanonicalInspectionTemplateAreaReference[];
  propertyUses: PropertyUse[];
  physicalPropertyTypes: PhysicalPropertyType[];
  source: 'system' | 'agency';
}

const ALL_PROPERTY_USES: PropertyUse[] = [
  'residential', 'commercial', 'industrial', 'retail', 'mixed_use',
  'strata_common_property', 'other',
];

const ALL_PHYSICAL_PROPERTY_TYPES: PhysicalPropertyType[] = [
  'house', 'apartment', 'unit', 'townhouse', 'villa', 'duplex', 'studio',
  'ancillary_dwelling', 'retirement_supported', 'office', 'retail_shop',
  'warehouse', 'industrial_unit', 'showroom', 'medical_consulting',
  'hospitality', 'restaurant_cafe', 'childcare', 'mixed_commercial',
  'common_property', 'other',
];

const DISPLAY_NAMES: Record<InspectionType, string> = {
  entry: 'Property Condition Report',
  routine: 'Routine Inspection',
  exit: 'Exit Inspection',
  comparison: 'Entry / Exit Comparison',
  maintenance: 'Maintenance and Follow-Up Report',
};

export function systemInspectionTemplateContract(inspectionType: InspectionType): CanonicalInspectionTemplateContract {
  return {
    id: `system-${inspectionType}-v1`,
    version: 1,
    inspectionType,
    status: 'published',
    structureMode: 'property_layout_catalogue',
    includeUnreferencedPropertyAreas: true,
    areaReferences: [],
    propertyUses: [...ALL_PROPERTY_USES],
    physicalPropertyTypes: [...ALL_PHYSICAL_PROPERTY_TYPES],
    source: 'system',
  };
}

export function systemInspectionTemplateRecord(inspectionType: InspectionType): Record<string, unknown> {
  const contract = systemInspectionTemplateContract(inspectionType);
  return {
    templateId: contract.id,
    templateVersion: contract.version,
    inspectionType,
    reportType: DISPLAY_NAMES[inspectionType],
    name: `${DISPLAY_NAMES[inspectionType]} - System Default`,
    status: 'published',
    systemDefault: true,
    publishedAt: '2026-08-22T00:00:00.000Z',
    structureMode: contract.structureMode,
    includeUnreferencedPropertyAreas: contract.includeUnreferencedPropertyAreas,
    canonicalAreaReferences: contract.areaReferences,
    propertyUses: contract.propertyUses,
    physicalPropertyTypes: contract.physicalPropertyTypes,
  };
}

function stringArray<T extends string>(value: unknown, fallback: T[]): T[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is T => typeof item === 'string'))]
    : fallback;
}

function areaReferences(value: unknown): CanonicalInspectionTemplateAreaReference[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const canonicalAreaDefinitionId = typeof record.canonicalAreaDefinitionId === 'string'
      ? record.canonicalAreaDefinitionId.trim()
      : typeof record.areaDefinitionId === 'string' ? record.areaDefinitionId.trim() : '';
    const canonicalAreaDefinitionVersion = typeof record.canonicalAreaDefinitionVersion === 'number'
      ? record.canonicalAreaDefinitionVersion
      : typeof record.areaDefinitionVersion === 'number' ? record.areaDefinitionVersion : 0;
    if (!canonicalAreaDefinitionId || !Number.isInteger(canonicalAreaDefinitionVersion) || canonicalAreaDefinitionVersion < 1) return [];
    const inclusion = ['required', 'default', 'optional', 'excluded'].includes(String(record.inclusion))
      ? record.inclusion as InspectionTemplateAreaInclusion
      : 'default';
    const ruleValue = Array.isArray(record.canonicalAreaComponentRuleReferences)
      ? record.canonicalAreaComponentRuleReferences
      : [];
    const canonicalAreaComponentRuleReferences = ruleValue.flatMap((candidate) => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
      const rule = candidate as Record<string, unknown>;
      const id = typeof rule.id === 'string' ? rule.id.trim() : '';
      const version = typeof rule.version === 'number' ? rule.version : 0;
      return id && Number.isInteger(version) && version > 0 ? [{ id, version }] : [];
    });
    return [{
      id: typeof record.id === 'string' && record.id.trim()
        ? record.id.trim()
        : `template-area-${index + 1}-${canonicalAreaDefinitionId}`,
      canonicalAreaDefinitionId,
      canonicalAreaDefinitionVersion,
      inclusion,
      ...(canonicalAreaComponentRuleReferences.length ? { canonicalAreaComponentRuleReferences } : {}),
    }];
  });
}

export function canonicalInspectionTemplateFromRecord(
  record: Record<string, unknown>,
  fallbackInspectionType: InspectionType,
): CanonicalInspectionTemplateContract {
  const fallback = systemInspectionTemplateContract(fallbackInspectionType);
  const id = typeof record.templateId === 'string' && record.templateId.trim()
    ? record.templateId.trim()
    : typeof record.id === 'string' && record.id.trim() ? record.id.trim() : fallback.id;
  const version = Number(record.templateVersion ?? record.version ?? fallback.version);
  const status = ['draft', 'published', 'retired'].includes(String(record.status))
    ? record.status as CanonicalInspectionTemplateContract['status']
    : 'published';
  return {
    id,
    version: Number.isInteger(version) && version > 0 ? version : 1,
    inspectionType: fallbackInspectionType,
    status,
    structureMode: 'property_layout_catalogue',
    includeUnreferencedPropertyAreas: record.includeUnreferencedPropertyAreas !== false,
    areaReferences: areaReferences(record.canonicalAreaReferences),
    propertyUses: stringArray(record.propertyUses, fallback.propertyUses),
    physicalPropertyTypes: stringArray(record.physicalPropertyTypes, fallback.physicalPropertyTypes),
    source: record.systemDefault === true ? 'system' : 'agency',
  };
}

export function validateCanonicalInspectionTemplate(contract: CanonicalInspectionTemplateContract): string[] {
  const issues: string[] = [];
  if (!contract.id.trim() || contract.version < 1) issues.push('Template identity and positive version are required.');
  if (contract.status === 'published' && contract.structureMode !== 'property_layout_catalogue') {
    issues.push('Published templates must use canonical Property Layout catalogue structure.');
  }
  const seen = new Set<string>();
  contract.areaReferences.forEach((reference) => {
    const key = `${reference.canonicalAreaDefinitionId}@${reference.canonicalAreaDefinitionVersion}`;
    if (seen.has(key)) issues.push(`Duplicate canonical Area reference: ${key}.`);
    seen.add(key);
    if (!reference.canonicalAreaDefinitionId.trim() || reference.canonicalAreaDefinitionVersion < 1) {
      issues.push(`Area reference ${reference.id} must pin an exact canonical Area version.`);
    }
  });
  if (!contract.includeUnreferencedPropertyAreas && contract.areaReferences.length === 0) {
    issues.push('A restrictive template must contain at least one canonical Area reference.');
  }
  return issues;
}

export function templateAppliesToProperty(
  contract: CanonicalInspectionTemplateContract,
  property: Record<string, unknown> | { propertyUse?: PropertyUse; physicalPropertyType?: PhysicalPropertyType },
): boolean {
  const rawUse = property.propertyUse;
  const rawPhysicalType = property.physicalPropertyType;
  const propertyUse = typeof rawUse === 'string' ? rawUse as PropertyUse : undefined;
  const physicalPropertyType = typeof rawPhysicalType === 'string' ? rawPhysicalType as PhysicalPropertyType : undefined;
  const useMatch = !propertyUse || contract.propertyUses.length === 0 || contract.propertyUses.includes(propertyUse);
  const physicalMatch = !physicalPropertyType || contract.physicalPropertyTypes.length === 0 || contract.physicalPropertyTypes.includes(physicalPropertyType);
  return useMatch && physicalMatch;
}

/**
 * Creates semantic template references from a canonical Property layout. This never copies Area or
 * Component definitions; it records only exact catalogue identities and rule identities.
 */
export function canonicalAreaReferencesFromLayout(rooms: RoomConfigItem[]): CanonicalInspectionTemplateAreaReference[] {
  const seen = new Set<string>();
  const references: CanonicalInspectionTemplateAreaReference[] = [];
  for (const room of rooms) {
    if (!room.canonicalAreaDefinitionId || !room.canonicalAreaDefinitionVersion) continue;
    const key = `${room.canonicalAreaDefinitionId}@${room.canonicalAreaDefinitionVersion}`;
    if (seen.has(key)) continue;
    seen.add(key);
    references.push({
      id: `template-area-${references.length + 1}-${room.canonicalAreaDefinitionId}`,
      canonicalAreaDefinitionId: room.canonicalAreaDefinitionId,
      canonicalAreaDefinitionVersion: room.canonicalAreaDefinitionVersion,
      inclusion: 'default',
      canonicalAreaComponentRuleReferences: [...new Map((room.componentRefs || []).map((component) => [
        `${component.canonicalAreaComponentRuleId}@${component.canonicalAreaComponentRuleVersion}`,
        { id: component.canonicalAreaComponentRuleId, version: component.canonicalAreaComponentRuleVersion },
      ])).values()],
    });
  }
  return references;
}
