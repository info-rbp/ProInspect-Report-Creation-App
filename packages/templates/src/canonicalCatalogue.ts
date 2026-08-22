import type { InspectionType, PhysicalPropertyType, PropertyUse } from '@pcr/domain';
import { pcrStandardAreas } from './pcrPreset.js';

export type CatalogueStatus = 'draft' | 'published' | 'retired';

export type AreaCategory =
  | 'external'
  | 'circulation'
  | 'living'
  | 'sleeping'
  | 'wet_area'
  | 'kitchen'
  | 'service'
  | 'storage'
  | 'safety'
  | 'commercial'
  | 'industrial'
  | 'common_property'
  | 'other';

export type ComponentCategory =
  | 'building_fabric'
  | 'door_access'
  | 'electrical'
  | 'plumbing'
  | 'appliance'
  | 'joinery'
  | 'flooring'
  | 'windows_glazing'
  | 'hvac'
  | 'safety_security'
  | 'external_site'
  | 'storage'
  | 'observation'
  | 'other';

export type AreaComponentInclusion = 'required' | 'default' | 'optional' | 'conditional';

export interface CatalogueApplicability {
  propertyUses: PropertyUse[];
  physicalPropertyTypes: PhysicalPropertyType[];
  inspectionTypes: InspectionType[];
}

interface VersionedCatalogueRecord {
  version: number;
  status: CatalogueStatus;
  createdAt: string;
  publishedAt?: string;
  source: 'legacy_pcr_standard_areas';
}

export interface AreaDefinition extends VersionedCatalogueRecord {
  id: string;
  code: string;
  name: string;
  description: string;
  aliases: string[];
  category: AreaCategory;
  repeatable: boolean;
  applicability: CatalogueApplicability;
  legacyIds: string[];
  legacyOrder: number;
}

export interface ComponentDefinition extends VersionedCatalogueRecord {
  id: string;
  code: string;
  name: string;
  description: string;
  aliases: string[];
  category: ComponentCategory;
  applicability: CatalogueApplicability;
  legacyIds: string[];
}

export interface AreaComponentRule extends VersionedCatalogueRecord {
  id: string;
  code: string;
  areaDefinitionId: string;
  componentDefinitionId: string;
  inclusion: AreaComponentInclusion;
  order: number;
  photoRequired: boolean;
  applicability: CatalogueApplicability;
  legacyAreaId: string;
  legacyAreaName: string;
  legacyComponentId: string;
  legacyComponentName: string;
}

export interface LegacyCatalogueIdMap {
  areaIds: Record<string, string>;
  componentIds: Record<string, string>;
  areaComponentKeys: Record<string, string>;
}

export interface CanonicalCatalogueMigrationSummary {
  legacyAreaCount: number;
  legacyAreaComponentCount: number;
  canonicalAreaCount: number;
  canonicalComponentCount: number;
  consolidatedLegacyComponentIds: number;
}

export interface CanonicalCatalogueSnapshot extends VersionedCatalogueRecord {
  id: string;
  areas: AreaDefinition[];
  components: ComponentDefinition[];
  areaComponentRules: AreaComponentRule[];
  legacyIdMap: LegacyCatalogueIdMap;
  migrationSummary: CanonicalCatalogueMigrationSummary;
}

interface LegacyTemplateComponent {
  id: string;
  name: string;
  required: boolean;
  photoRequired: boolean;
}

interface LegacyTemplateArea {
  id: string;
  name: string;
  components: LegacyTemplateComponent[];
}

interface AreaMetadata {
  category: AreaCategory;
  aliases: string[];
  repeatable?: boolean;
  physicalPropertyTypes?: PhysicalPropertyType[];
}

const CATALOGUE_CREATED_AT = '2026-08-22T00:00:00.000Z';
const SUPPORTED_INSPECTION_TYPES: InspectionType[] = ['entry', 'routine', 'exit', 'comparison', 'maintenance'];
const RESIDENTIAL_PROPERTY_TYPES: PhysicalPropertyType[] = [
  'house',
  'apartment',
  'unit',
  'townhouse',
  'villa',
  'duplex',
  'studio',
  'ancillary_dwelling',
  'retirement_supported',
];
const HOUSE_LIKE_PROPERTY_TYPES: PhysicalPropertyType[] = [
  'house',
  'townhouse',
  'villa',
  'duplex',
  'ancillary_dwelling',
];

const AREA_METADATA: Record<string, AreaMetadata> = {
  'exterior-front': {
    category: 'external',
    aliases: ['Front Exterior', 'Front Elevation', 'Front Yard'],
    physicalPropertyTypes: HOUSE_LIKE_PROPERTY_TYPES,
  },
  'exterior-back': {
    category: 'external',
    aliases: ['Rear Exterior', 'Back Exterior', 'Rear Yard'],
    physicalPropertyTypes: HOUSE_LIKE_PROPERTY_TYPES,
  },
  'garage-carport': {
    category: 'service',
    aliases: ['Garage', 'Carport', 'Garage / Parking'],
  },
  entry: {
    category: 'circulation',
    aliases: ['Entry Hall', 'Entrance', 'Foyer'],
  },
  'lounge-room': {
    category: 'living',
    aliases: ['Lounge', 'Living Room', 'Formal Lounge'],
    repeatable: true,
  },
  'family-room': {
    category: 'living',
    aliases: ['Family Room', 'Living Area', 'Family / Living Area'],
    repeatable: true,
  },
  'dining-room': {
    category: 'living',
    aliases: ['Dining', 'Dining Area'],
    repeatable: true,
  },
  'lounge-dining-room': {
    category: 'living',
    aliases: ['Living / Dining', 'Lounge Dining', 'Combined Living / Dining'],
    repeatable: true,
  },
  kitchen: {
    category: 'kitchen',
    aliases: ['Kitchen', 'Kitchen Area'],
  },
  'passage-hallway': {
    category: 'circulation',
    aliases: ['Hallway', 'Passage', 'Corridor', 'Internal Hallway'],
    repeatable: true,
  },
  'linen-press': {
    category: 'storage',
    aliases: ['Linen Press', 'Linen Closet', 'Walk-in Linen Closet'],
    repeatable: true,
  },
  bedroom: {
    category: 'sleeping',
    aliases: ['Master Bedroom', 'Main Bedroom', 'Primary Bedroom', 'Guest Bedroom'],
    repeatable: true,
  },
  study: {
    category: 'living',
    aliases: ['Study', 'Home Office'],
    repeatable: true,
  },
  'activity-room': {
    category: 'living',
    aliases: ['Activity Room', 'Games Room', 'Play Room'],
    repeatable: true,
  },
  bathroom: {
    category: 'wet_area',
    aliases: ['Main Bathroom', 'Bathroom'],
    repeatable: true,
  },
  ensuite: {
    category: 'wet_area',
    aliases: ['Ensuite', 'Ensuite Bathroom'],
    repeatable: true,
  },
  'toilet-wc': {
    category: 'wet_area',
    aliases: ['Toilet', 'WC', 'Powder Room'],
    repeatable: true,
  },
  laundry: {
    category: 'service',
    aliases: ['Laundry', 'Utility Room'],
  },
  'security-safety': {
    category: 'safety',
    aliases: ['Security & Safety', 'Safety', 'Security Systems'],
  },
  'general-external-items': {
    category: 'external',
    aliases: ['General External', 'External Areas', 'Grounds'],
    physicalPropertyTypes: HOUSE_LIKE_PROPERTY_TYPES,
  },
  'garden-shed-external-storage': {
    category: 'storage',
    aliases: ['Garden Shed', 'External Storage', 'Shed / Storage'],
    repeatable: true,
    physicalPropertyTypes: HOUSE_LIKE_PROPERTY_TYPES,
  },
};

const LEGACY_COMPONENT_CANONICAL_ID_OVERRIDES: Record<string, string> = {
  'light-fitting': 'light-fittings',
  'smoke-alarms': 'smoke-alarm',
  'window-screen': 'windows-screens',
  'bench-top': 'bench-tops',
  'overhead-cupboard': 'overhead-cupboards',
};

const KNOWN_COMPONENT_ALIASES: Record<string, string[]> = {
  'points-switches': ['Power Points', 'GPOs', 'Electrical Outlets', 'Power Outlets', 'Switches'],
  'oven-griller': ['Oven', 'Built-in Oven', 'Wall Oven', 'Oven / Grill'],
  'stove-top-hot-plates': ['Cooktop', 'Stovetop', 'Hotplates'],
  'windows-screens': ['Window', 'Windows', 'Window / Screen', 'Windows and Screens'],
  'smoke-alarm': ['Smoke Alarm', 'Smoke Alarms'],
  'air-conditioner': ['Air Conditioner', 'Air Conditioning', 'A/C'],
  'front-door': ['Entry Door', 'Main Entry Door'],
  'garage-roller-door': ['Garage Door', 'Roller Door'],
  'hot-water-system': ['Hot Water Unit', 'HWS'],
  'sink-taps-spout': ['Kitchen Sink', 'Sink and Taps'],
  'basin-taps-spout-plug': ['Basin', 'Vanity Basin', 'Basin and Taps'],
  'shower-screen-taps': ['Shower', 'Shower Screen', 'Shower and Taps'],
  'bench-tops': ['Bench Top', 'Benchtop', 'Benchtops'],
  'overhead-cupboards': ['Overhead Cupboard', 'Overhead Cabinets'],
};

function catalogueCode(prefix: 'AREA' | 'COMPONENT' | 'RULE', value: string): string {
  return `${prefix}_${value.trim().toUpperCase().replace(/[^A-Z0-9]+/gu, '_').replace(/^_+|_+$/gu, '')}`;
}

function uniqueStrings(values: Iterable<string>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function canonicalComponentId(legacyId: string): string {
  return LEGACY_COMPONENT_CANONICAL_ID_OVERRIDES[legacyId] ?? legacyId;
}

function componentCategory(id: string, name: string): ComponentCategory {
  const value = `${id} ${name}`.toLowerCase();
  if (/cleanliness|rust|dents|water-damage|overall-(condition|presentation)/u.test(value)) return 'observation';
  if (/smoke|safety|alarm|security|camera/u.test(value)) return 'safety_security';
  if (/door|handle|lock|key|remote|opening-device/u.test(value)) return 'door_access';
  if (/tap|sink|basin|shower|toilet|cistern|hot-water|trough|washing-machine/u.test(value)) return 'plumbing';
  if (/oven|stove|hot-plate|dishwasher|rangehood|appliance/u.test(value)) return 'appliance';
  if (/air-condition|ceiling-fan|exhaust-fan|vent/u.test(value)) return 'hvac';
  if (/light|point|switch|electrical|meter-box/u.test(value)) return 'electrical';
  if (/window|screen|blind|curtain|mirror/u.test(value)) return 'windows_glazing';
  if (/floor|paving|driveway|tile/u.test(value)) return 'flooring';
  if (/cupboard|drawer|wardrobe|pantry|shelv|rail|bench-top|bench top/u.test(value)) return 'joinery';
  if (/garden|lawn|fence|gate|clothesline|letterbox|bin|nbn|telstra|external-service/u.test(value)) return 'external_site';
  if (/storage|contents/u.test(value)) return 'storage';
  if (/wall|ceiling|cornice|eave|roof|skirting|splashback|manhole/u.test(value)) return 'building_fabric';
  return 'other';
}

function applicabilityForArea(areaId: string): CatalogueApplicability {
  const metadata = AREA_METADATA[areaId];
  return {
    propertyUses: ['residential'],
    physicalPropertyTypes: [...(metadata?.physicalPropertyTypes ?? RESIDENTIAL_PROPERTY_TYPES)],
    inspectionTypes: [...SUPPORTED_INSPECTION_TYPES],
  };
}

function mergeApplicability(target: CatalogueApplicability, source: CatalogueApplicability): void {
  target.propertyUses = uniqueStrings([...target.propertyUses, ...source.propertyUses]) as PropertyUse[];
  target.physicalPropertyTypes = uniqueStrings([...target.physicalPropertyTypes, ...source.physicalPropertyTypes]) as PhysicalPropertyType[];
  target.inspectionTypes = uniqueStrings([...target.inspectionTypes, ...source.inspectionTypes]) as InspectionType[];
}

function versionedRecord(): VersionedCatalogueRecord {
  return {
    version: 1,
    status: 'published',
    createdAt: CATALOGUE_CREATED_AT,
    publishedAt: CATALOGUE_CREATED_AT,
    source: 'legacy_pcr_standard_areas',
  };
}

export function migrateLegacyPcrStandardAreas(legacyAreas: readonly LegacyTemplateArea[]): CanonicalCatalogueSnapshot {
  const areas: AreaDefinition[] = [];
  const rules: AreaComponentRule[] = [];
  const componentDefinitions = new Map<string, ComponentDefinition>();
  const areaIds: Record<string, string> = {};
  const componentIds: Record<string, string> = {};
  const areaComponentKeys: Record<string, string> = {};
  let legacyAreaComponentCount = 0;
  let consolidatedLegacyComponentIds = 0;

  legacyAreas.forEach((legacyArea, areaIndex) => {
    const metadata = AREA_METADATA[legacyArea.id] ?? {
      category: 'other' as AreaCategory,
      aliases: [],
    };
    const applicability = applicabilityForArea(legacyArea.id);
    const areaDefinition: AreaDefinition = {
      ...versionedRecord(),
      id: legacyArea.id,
      code: catalogueCode('AREA', legacyArea.id),
      name: legacyArea.name,
      description: `Canonical area migrated from legacy PCR area '${legacyArea.name}'.`,
      aliases: uniqueStrings([legacyArea.name, ...metadata.aliases]),
      category: metadata.category,
      repeatable: Boolean(metadata.repeatable),
      applicability,
      legacyIds: [legacyArea.id],
      legacyOrder: areaIndex + 1,
    };
    areas.push(areaDefinition);
    areaIds[legacyArea.id] = areaDefinition.id;

    legacyArea.components.forEach((legacyComponent, componentIndex) => {
      legacyAreaComponentCount += 1;
      const canonicalId = canonicalComponentId(legacyComponent.id);
      if (canonicalId !== legacyComponent.id) consolidatedLegacyComponentIds += 1;
      componentIds[legacyComponent.id] = canonicalId;

      const existing = componentDefinitions.get(canonicalId);
      if (existing) {
        existing.aliases = uniqueStrings([
          ...existing.aliases,
          legacyComponent.name,
          ...(KNOWN_COMPONENT_ALIASES[canonicalId] ?? []),
        ]);
        existing.legacyIds = uniqueStrings([...existing.legacyIds, legacyComponent.id]);
        mergeApplicability(existing.applicability, applicability);
      } else {
        componentDefinitions.set(canonicalId, {
          ...versionedRecord(),
          id: canonicalId,
          code: catalogueCode('COMPONENT', canonicalId),
          name: legacyComponent.name,
          description: `Canonical component migrated from legacy PCR component '${legacyComponent.name}'.`,
          aliases: uniqueStrings([legacyComponent.name, ...(KNOWN_COMPONENT_ALIASES[canonicalId] ?? [])]),
          category: componentCategory(canonicalId, legacyComponent.name),
          applicability: structuredClone(applicability),
          legacyIds: [legacyComponent.id],
        });
      }

      const legacyKey = `${legacyArea.id}/${legacyComponent.id}`;
      const ruleId = `${legacyArea.id}:${legacyComponent.id}`;
      const rule: AreaComponentRule = {
        ...versionedRecord(),
        id: ruleId,
        code: catalogueCode('RULE', ruleId),
        areaDefinitionId: areaDefinition.id,
        componentDefinitionId: canonicalId,
        inclusion: legacyComponent.required ? 'required' : 'default',
        order: componentIndex + 1,
        photoRequired: legacyComponent.photoRequired,
        applicability: structuredClone(applicability),
        legacyAreaId: legacyArea.id,
        legacyAreaName: legacyArea.name,
        legacyComponentId: legacyComponent.id,
        legacyComponentName: legacyComponent.name,
      };
      rules.push(rule);
      areaComponentKeys[legacyKey] = ruleId;
    });
  });

  const snapshot: CanonicalCatalogueSnapshot = {
    ...versionedRecord(),
    id: 'proinspect-canonical-area-component-catalogue',
    areas,
    components: [...componentDefinitions.values()].sort((left, right) => left.code.localeCompare(right.code)),
    areaComponentRules: rules,
    legacyIdMap: { areaIds, componentIds, areaComponentKeys },
    migrationSummary: {
      legacyAreaCount: legacyAreas.length,
      legacyAreaComponentCount,
      canonicalAreaCount: areas.length,
      canonicalComponentCount: componentDefinitions.size,
      consolidatedLegacyComponentIds,
    },
  };

  validateCanonicalCatalogue(snapshot);
  assertLegacyMigrationParity(snapshot, legacyAreas);
  return snapshot;
}

export function validateCanonicalCatalogue(snapshot: CanonicalCatalogueSnapshot): void {
  if (!snapshot.id.trim() || snapshot.version < 1) throw new Error('Canonical catalogue identity and version are required.');
  if (snapshot.status !== 'published') throw new Error('Canonical migration snapshot must be published.');

  const areaIds = new Set<string>();
  const areaCodes = new Set<string>();
  for (const area of snapshot.areas) {
    if (!area.id.trim() || !area.code.trim() || !area.name.trim()) throw new Error('Every area definition requires id, code and name.');
    if (areaIds.has(area.id)) throw new Error(`Duplicate canonical area id: ${area.id}`);
    if (areaCodes.has(area.code)) throw new Error(`Duplicate canonical area code: ${area.code}`);
    if (area.version < 1 || area.status !== 'published') throw new Error(`Area ${area.id} must be a published positive version.`);
    if (!area.legacyIds.length) throw new Error(`Area ${area.id} must retain at least one legacy id.`);
    areaIds.add(area.id);
    areaCodes.add(area.code);
  }

  const componentIds = new Set<string>();
  const componentCodes = new Set<string>();
  for (const component of snapshot.components) {
    if (!component.id.trim() || !component.code.trim() || !component.name.trim()) throw new Error('Every component definition requires id, code and name.');
    if (componentIds.has(component.id)) throw new Error(`Duplicate canonical component id: ${component.id}`);
    if (componentCodes.has(component.code)) throw new Error(`Duplicate canonical component code: ${component.code}`);
    if (component.version < 1 || component.status !== 'published') throw new Error(`Component ${component.id} must be a published positive version.`);
    if (!component.legacyIds.length) throw new Error(`Component ${component.id} must retain at least one legacy id.`);
    componentIds.add(component.id);
    componentCodes.add(component.code);
  }

  const ruleIds = new Set<string>();
  const ruleCodes = new Set<string>();
  const membershipKeys = new Set<string>();
  for (const rule of snapshot.areaComponentRules) {
    if (ruleIds.has(rule.id)) throw new Error(`Duplicate area-component rule id: ${rule.id}`);
    if (ruleCodes.has(rule.code)) throw new Error(`Duplicate area-component rule code: ${rule.code}`);
    if (!areaIds.has(rule.areaDefinitionId)) throw new Error(`Rule ${rule.id} references unknown area ${rule.areaDefinitionId}.`);
    if (!componentIds.has(rule.componentDefinitionId)) throw new Error(`Rule ${rule.id} references unknown component ${rule.componentDefinitionId}.`);
    if (rule.version < 1 || rule.status !== 'published') throw new Error(`Rule ${rule.id} must be a published positive version.`);
    const membershipKey = `${rule.legacyAreaId}/${rule.legacyComponentId}`;
    if (membershipKeys.has(membershipKey)) throw new Error(`Duplicate legacy area-component membership: ${membershipKey}`);
    membershipKeys.add(membershipKey);
    ruleIds.add(rule.id);
    ruleCodes.add(rule.code);
  }

  for (const [legacyId, canonicalId] of Object.entries(snapshot.legacyIdMap.areaIds)) {
    if (!legacyId.trim() || !areaIds.has(canonicalId)) throw new Error(`Legacy area id ${legacyId} is not mapped to a canonical area.`);
  }
  for (const [legacyId, canonicalId] of Object.entries(snapshot.legacyIdMap.componentIds)) {
    if (!legacyId.trim() || !componentIds.has(canonicalId)) throw new Error(`Legacy component id ${legacyId} is not mapped to a canonical component.`);
  }
  for (const [legacyKey, ruleId] of Object.entries(snapshot.legacyIdMap.areaComponentKeys)) {
    if (!legacyKey.trim() || !ruleIds.has(ruleId)) throw new Error(`Legacy area-component key ${legacyKey} is not mapped to a canonical rule.`);
  }
}

export function legacyTemplateAreasFromCatalogue(snapshot: CanonicalCatalogueSnapshot): LegacyTemplateArea[] {
  return [...snapshot.areas]
    .sort((left, right) => left.legacyOrder - right.legacyOrder)
    .map((area) => ({
      id: area.legacyIds[0] ?? area.id,
      name: area.name,
      components: snapshot.areaComponentRules
        .filter((rule) => rule.areaDefinitionId === area.id)
        .sort((left, right) => left.order - right.order)
        .map((rule) => ({
          id: rule.legacyComponentId,
          name: rule.legacyComponentName,
          required: rule.inclusion === 'required',
          photoRequired: rule.photoRequired,
        })),
    }));
}

export function assertLegacyMigrationParity(
  snapshot: CanonicalCatalogueSnapshot,
  legacyAreas: readonly LegacyTemplateArea[],
): void {
  const reconstructed = legacyTemplateAreasFromCatalogue(snapshot);
  if (JSON.stringify(reconstructed) !== JSON.stringify(legacyAreas)) {
    throw new Error('Canonical catalogue migration does not preserve the legacy PCR area/component structure exactly.');
  }
}

export function resolveAreaDefinitionId(idOrLegacyId: string): string | undefined {
  if (CANONICAL_PCR_CATALOGUE_V1.areas.some((area) => area.id === idOrLegacyId)) return idOrLegacyId;
  return CANONICAL_PCR_CATALOGUE_V1.legacyIdMap.areaIds[idOrLegacyId];
}

export function resolveComponentDefinitionId(idOrLegacyId: string): string | undefined {
  if (CANONICAL_PCR_CATALOGUE_V1.components.some((component) => component.id === idOrLegacyId)) return idOrLegacyId;
  return CANONICAL_PCR_CATALOGUE_V1.legacyIdMap.componentIds[idOrLegacyId];
}

export function findAreaDefinition(idOrLegacyId: string): AreaDefinition | undefined {
  const id = resolveAreaDefinitionId(idOrLegacyId);
  return id ? CANONICAL_PCR_CATALOGUE_V1.areas.find((area) => area.id === id) : undefined;
}

export function findComponentDefinition(idOrLegacyId: string): ComponentDefinition | undefined {
  const id = resolveComponentDefinitionId(idOrLegacyId);
  return id ? CANONICAL_PCR_CATALOGUE_V1.components.find((component) => component.id === id) : undefined;
}

export function areaComponentRulesForArea(idOrLegacyId: string): AreaComponentRule[] {
  const areaId = resolveAreaDefinitionId(idOrLegacyId);
  if (!areaId) return [];
  return CANONICAL_PCR_CATALOGUE_V1.areaComponentRules
    .filter((rule) => rule.areaDefinitionId === areaId)
    .sort((left, right) => left.order - right.order);
}

export const CANONICAL_PCR_CATALOGUE_V1 = migrateLegacyPcrStandardAreas(pcrStandardAreas);
export const CANONICAL_AREA_DEFINITIONS = CANONICAL_PCR_CATALOGUE_V1.areas;
export const CANONICAL_COMPONENT_DEFINITIONS = CANONICAL_PCR_CATALOGUE_V1.components;
export const CANONICAL_AREA_COMPONENT_RULES = CANONICAL_PCR_CATALOGUE_V1.areaComponentRules;
export const LEGACY_CATALOGUE_ID_MAP = CANONICAL_PCR_CATALOGUE_V1.legacyIdMap;
