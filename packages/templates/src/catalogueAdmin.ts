import type { InspectionType, PhysicalPropertyType, PropertyUse } from '@pcr/domain';
import {
  CANONICAL_AREA_COMPONENT_RULES,
  CANONICAL_AREA_DEFINITIONS,
  CANONICAL_COMPONENT_DEFINITIONS,
  type AreaCategory,
  type AreaComponentInclusion,
  type AreaComponentRule,
  type AreaDefinition,
  type CatalogueApplicability,
  type CatalogueStatus,
  type ComponentCategory,
  type ComponentDefinition,
} from './canonicalCatalogue.js';

export type CatalogueRecordSource =
  | 'legacy_pcr_standard_areas'
  | 'agency_custom'
  | 'duplicated';

export type CatalogueFieldRequirement = 'required' | 'optional' | 'hidden';
export type CatalogueOperationalTestRequirement =
  | 'required'
  | 'recommended'
  | 'optional'
  | 'not_applicable';
export type CatalogueCommentaryRequirement =
  | 'always'
  | 'exception_only'
  | 'optional'
  | 'hidden';

export interface CatalogueAssessmentDefaults {
  condition: CatalogueFieldRequirement;
  cleanliness: CatalogueFieldRequirement;
  material: CatalogueFieldRequirement;
  colour: CatalogueFieldRequirement;
  type: CatalogueFieldRequirement;
  quantity: CatalogueFieldRequirement;
  workingStatus: CatalogueFieldRequirement;
  operationalTest: CatalogueOperationalTestRequirement;
  commentary: CatalogueCommentaryRequirement;
  maintenanceEvaluation: boolean;
}

export interface CatalogueEvidenceDefaults {
  componentPhotoRequired: boolean;
  exceptionPhotoRequired: boolean;
  contextPhotoRequired: boolean;
  minimumPhotos: number;
  minimumExceptionPhotos: number;
  comparisonPairRequired: boolean;
  reasonRequiredIfMissing: boolean;
}

export interface ManagedAreaDefinition extends Omit<AreaDefinition, 'source'> {
  source: CatalogueRecordSource;
  updatedAt?: string;
  retiredAt?: string;
}

export interface ManagedComponentDefinition extends Omit<ComponentDefinition, 'source'> {
  source: CatalogueRecordSource;
  operational: boolean;
  testable: boolean;
  repeatable: boolean;
  maintenanceCategory?: string;
  defaultTrade?: string;
  updatedAt?: string;
  retiredAt?: string;
}

export interface ManagedAreaComponentRule
  extends Omit<AreaComponentRule, 'source'> {
  source: CatalogueRecordSource;
  componentDefinitionVersion: number;
  assessmentDefaults: CatalogueAssessmentDefaults;
  evidenceDefaults: CatalogueEvidenceDefaults;
}

export interface CatalogueAreaVersionView {
  definition: ManagedAreaDefinition;
  componentRules: ManagedAreaComponentRule[];
  recordVersion: number;
  immutable: boolean;
  systemDefault?: boolean;
}

export interface CatalogueComponentVersionView {
  definition: ManagedComponentDefinition;
  recordVersion: number;
  immutable: boolean;
  systemDefault?: boolean;
}

export interface CatalogueUsageImpact {
  catalogueAreas: number;
  templates: number;
  properties: number;
  reports: number;
  maintenanceItems: number;
  totalRecords: number;
  hasPublishedDependencies: boolean;
  sampledAt: string;
}

export interface NewAreaDraftInput {
  id: string;
  name: string;
  description?: string;
  aliases?: string[];
  category?: AreaCategory;
  repeatable?: boolean;
  applicability?: Partial<CatalogueApplicability>;
}

export interface NewComponentDraftInput {
  id: string;
  name: string;
  description?: string;
  aliases?: string[];
  category?: ComponentCategory;
  applicability?: Partial<CatalogueApplicability>;
  operational?: boolean;
  testable?: boolean;
  repeatable?: boolean;
  maintenanceCategory?: string;
  defaultTrade?: string;
}

const ALL_INSPECTION_TYPES: InspectionType[] = [
  'entry',
  'routine',
  'exit',
  'comparison',
  'maintenance',
];

const ALL_PROPERTY_USES: PropertyUse[] = [
  'residential',
  'commercial',
  'industrial',
  'retail',
  'mixed_use',
  'strata_common_property',
  'other',
];

const ALL_PHYSICAL_PROPERTY_TYPES: PhysicalPropertyType[] = [
  'house',
  'apartment',
  'unit',
  'townhouse',
  'villa',
  'duplex',
  'studio',
  'ancillary_dwelling',
  'retirement_supported',
  'office',
  'retail_shop',
  'warehouse',
  'industrial_unit',
  'showroom',
  'medical_consulting',
  'hospitality',
  'restaurant_cafe',
  'childcare',
  'mixed_commercial',
  'common_property',
  'other',
];

const OPERATIONAL_CATEGORIES = new Set<ComponentCategory>([
  'electrical',
  'plumbing',
  'appliance',
  'hvac',
  'safety_security',
]);

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function catalogueMachineCode(prefix: 'AREA' | 'COMPONENT' | 'RULE', value: string): string {
  const body = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '');
  return `${prefix}_${body || 'UNNAMED'}`;
}

export function normaliseCatalogueApplicability(
  value: Partial<CatalogueApplicability> | undefined,
  fallback?: CatalogueApplicability,
): CatalogueApplicability {
  const propertyUses = (value?.propertyUses?.length
    ? value.propertyUses
    : fallback?.propertyUses?.length
      ? fallback.propertyUses
      : ALL_PROPERTY_USES) as PropertyUse[];
  const physicalPropertyTypes = (value?.physicalPropertyTypes?.length
    ? value.physicalPropertyTypes
    : fallback?.physicalPropertyTypes?.length
      ? fallback.physicalPropertyTypes
      : ALL_PHYSICAL_PROPERTY_TYPES) as PhysicalPropertyType[];
  const inspectionTypes = (value?.inspectionTypes?.length
    ? value.inspectionTypes
    : fallback?.inspectionTypes?.length
      ? fallback.inspectionTypes
      : ALL_INSPECTION_TYPES) as InspectionType[];
  return {
    propertyUses: unique(propertyUses) as PropertyUse[],
    physicalPropertyTypes: unique(physicalPropertyTypes) as PhysicalPropertyType[],
    inspectionTypes: unique(inspectionTypes) as InspectionType[],
  };
}

export function defaultAssessmentDefaults(
  component: Pick<ManagedComponentDefinition | ComponentDefinition, 'category'>,
): CatalogueAssessmentDefaults {
  const operational = OPERATIONAL_CATEGORIES.has(component.category);
  return {
    condition: 'required',
    cleanliness: 'required',
    material: 'optional',
    colour: 'optional',
    type: 'optional',
    quantity: 'optional',
    workingStatus: operational ? 'required' : 'hidden',
    operationalTest: operational ? 'recommended' : 'not_applicable',
    commentary: 'exception_only',
    maintenanceEvaluation: true,
  };
}

export function defaultEvidenceDefaults(
  photoRequired = false,
): CatalogueEvidenceDefaults {
  return {
    componentPhotoRequired: photoRequired,
    exceptionPhotoRequired: true,
    contextPhotoRequired: false,
    minimumPhotos: photoRequired ? 1 : 0,
    minimumExceptionPhotos: 1,
    comparisonPairRequired: false,
    reasonRequiredIfMissing: photoRequired,
  };
}

function componentOperational(category: ComponentCategory): boolean {
  return OPERATIONAL_CATEGORIES.has(category);
}

export function managedComponentFromCanonical(
  component: ComponentDefinition,
): ManagedComponentDefinition {
  const operational = componentOperational(component.category);
  return {
    ...structuredClone(component),
    source: 'legacy_pcr_standard_areas',
    operational,
    testable: operational,
    repeatable: false,
  };
}

export function managedAreaFromCanonical(
  area: AreaDefinition,
): CatalogueAreaVersionView {
  const componentsById = new Map(
    CANONICAL_COMPONENT_DEFINITIONS.map((component) => [component.id, component]),
  );
  const rules = CANONICAL_AREA_COMPONENT_RULES
    .filter((rule) => rule.areaDefinitionId === area.id)
    .sort((left, right) => left.order - right.order)
    .map((rule): ManagedAreaComponentRule => {
      const component = componentsById.get(rule.componentDefinitionId);
      if (!component) throw new Error(`Missing canonical component ${rule.componentDefinitionId}.`);
      return {
        ...structuredClone(rule),
        source: 'legacy_pcr_standard_areas',
        componentDefinitionVersion: component.version,
        assessmentDefaults: defaultAssessmentDefaults(component),
        evidenceDefaults: defaultEvidenceDefaults(rule.photoRequired),
      };
    });
  return {
    definition: {
      ...structuredClone(area),
      source: 'legacy_pcr_standard_areas',
    },
    componentRules: rules,
    recordVersion: 1,
    immutable: true,
    systemDefault: true,
  };
}

export const MANAGED_CANONICAL_AREA_V1 = CANONICAL_AREA_DEFINITIONS.map(
  managedAreaFromCanonical,
);
export const MANAGED_CANONICAL_COMPONENT_V1 = CANONICAL_COMPONENT_DEFINITIONS.map(
  (definition): CatalogueComponentVersionView => ({
    definition: managedComponentFromCanonical(definition),
    recordVersion: 1,
    immutable: true,
    systemDefault: true,
  }),
);

export function createAreaDraftDefinition(
  input: NewAreaDraftInput,
  createdAt = new Date().toISOString(),
): ManagedAreaDefinition {
  const id = input.id.trim().toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '');
  const name = input.name.trim();
  if (!id || !name) throw new Error('Area ID and name are required.');
  return {
    id,
    code: catalogueMachineCode('AREA', id),
    name,
    description: input.description?.trim() || `Agency-defined inspection area '${name}'.`,
    aliases: unique([name, ...(input.aliases ?? [])]),
    category: input.category ?? 'other',
    repeatable: input.repeatable ?? false,
    applicability: normaliseCatalogueApplicability(input.applicability),
    legacyIds: [],
    legacyOrder: 0,
    version: 1,
    status: 'draft',
    createdAt,
    source: 'agency_custom',
  };
}

export function createComponentDraftDefinition(
  input: NewComponentDraftInput,
  createdAt = new Date().toISOString(),
): ManagedComponentDefinition {
  const id = input.id.trim().toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '');
  const name = input.name.trim();
  if (!id || !name) throw new Error('Component ID and name are required.');
  const category = input.category ?? 'other';
  const operational = input.operational ?? componentOperational(category);
  return {
    id,
    code: catalogueMachineCode('COMPONENT', id),
    name,
    description: input.description?.trim() || `Agency-defined inspection component '${name}'.`,
    aliases: unique([name, ...(input.aliases ?? [])]),
    category,
    applicability: normaliseCatalogueApplicability(input.applicability),
    legacyIds: [],
    version: 1,
    status: 'draft',
    createdAt,
    source: 'agency_custom',
    operational,
    testable: input.testable ?? operational,
    repeatable: input.repeatable ?? false,
    ...(input.maintenanceCategory?.trim()
      ? { maintenanceCategory: input.maintenanceCategory.trim() }
      : {}),
    ...(input.defaultTrade?.trim() ? { defaultTrade: input.defaultTrade.trim() } : {}),
  };
}

export function createAreaComponentAssignment(
  area: Pick<ManagedAreaDefinition, 'id' | 'version' | 'status' | 'createdAt' | 'source' | 'applicability'>,
  component: Pick<ManagedComponentDefinition, 'id' | 'version' | 'category'>,
  order: number,
  inclusion: AreaComponentInclusion = 'default',
): ManagedAreaComponentRule {
  const id = `${area.id}:${component.id}`;
  return {
    id,
    code: catalogueMachineCode('RULE', id),
    areaDefinitionId: area.id,
    componentDefinitionId: component.id,
    componentDefinitionVersion: component.version,
    inclusion,
    order,
    photoRequired: false,
    applicability: structuredClone(area.applicability),
    legacyAreaId: area.id,
    legacyAreaName: area.id,
    legacyComponentId: component.id,
    legacyComponentName: component.id,
    version: area.version,
    status: area.status,
    createdAt: area.createdAt,
    source: area.source,
    assessmentDefaults: defaultAssessmentDefaults(component),
    evidenceDefaults: defaultEvidenceDefaults(false),
  };
}

const FIELD_REQUIREMENTS = new Set<CatalogueFieldRequirement>(['required', 'optional', 'hidden']);
const TEST_REQUIREMENTS = new Set<CatalogueOperationalTestRequirement>([
  'required',
  'recommended',
  'optional',
  'not_applicable',
]);
const COMMENTARY_REQUIREMENTS = new Set<CatalogueCommentaryRequirement>([
  'always',
  'exception_only',
  'optional',
  'hidden',
]);
const STATUSES = new Set<CatalogueStatus>(['draft', 'published', 'retired']);
const INCLUSIONS = new Set<AreaComponentInclusion>([
  'required',
  'default',
  'optional',
  'conditional',
]);

function validateApplicability(value: CatalogueApplicability): void {
  if (!value.propertyUses.length) throw new Error('At least one Property Use is required.');
  if (!value.physicalPropertyTypes.length) throw new Error('At least one Physical Property Type is required.');
  if (!value.inspectionTypes.length) throw new Error('At least one Inspection Type is required.');
}

function validateAssessmentDefaults(value: CatalogueAssessmentDefaults): void {
  for (const requirement of [
    value.condition,
    value.cleanliness,
    value.material,
    value.colour,
    value.type,
    value.quantity,
    value.workingStatus,
  ]) {
    if (!FIELD_REQUIREMENTS.has(requirement)) throw new Error(`Unsupported assessment requirement '${requirement}'.`);
  }
  if (!TEST_REQUIREMENTS.has(value.operationalTest)) throw new Error('Unsupported operational-test requirement.');
  if (!COMMENTARY_REQUIREMENTS.has(value.commentary)) throw new Error('Unsupported commentary requirement.');
}

function validateEvidenceDefaults(value: CatalogueEvidenceDefaults): void {
  if (!Number.isInteger(value.minimumPhotos) || value.minimumPhotos < 0) throw new Error('Minimum photos must be a non-negative integer.');
  if (!Number.isInteger(value.minimumExceptionPhotos) || value.minimumExceptionPhotos < 0) throw new Error('Minimum exception photos must be a non-negative integer.');
  if (value.componentPhotoRequired && value.minimumPhotos < 1) throw new Error('A required component photograph needs a minimum photo count of at least one.');
  if (value.exceptionPhotoRequired && value.minimumExceptionPhotos < 1) throw new Error('Required exception evidence needs a minimum exception photo count of at least one.');
}

export function normaliseAreaComponentRuleOrder(
  rules: ManagedAreaComponentRule[],
): ManagedAreaComponentRule[] {
  return [...rules]
    .sort((left, right) => left.order - right.order || left.componentDefinitionId.localeCompare(right.componentDefinitionId))
    .map((rule, index) => ({ ...rule, order: index + 1 }));
}

export function validateManagedComponent(
  definition: ManagedComponentDefinition,
): void {
  if (!definition.id.trim() || !definition.code.trim() || !definition.name.trim()) throw new Error('Component ID, code and name are required.');
  if (!/^COMPONENT_[A-Z0-9_]+$/u.test(definition.code)) throw new Error('Component code must use COMPONENT_* machine-code format.');
  if (!Number.isInteger(definition.version) || definition.version < 1) throw new Error('Component version must be a positive integer.');
  if (!STATUSES.has(definition.status)) throw new Error('Unsupported Component status.');
  if (definition.testable && !definition.operational) throw new Error('A testable Component must also be operational.');
  validateApplicability(definition.applicability);
}

export function validateManagedArea(
  definition: ManagedAreaDefinition,
  rules: ManagedAreaComponentRule[],
): void {
  if (!definition.id.trim() || !definition.code.trim() || !definition.name.trim()) throw new Error('Area ID, code and name are required.');
  if (!/^AREA_[A-Z0-9_]+$/u.test(definition.code)) throw new Error('Area code must use AREA_* machine-code format.');
  if (!Number.isInteger(definition.version) || definition.version < 1) throw new Error('Area version must be a positive integer.');
  if (!STATUSES.has(definition.status)) throw new Error('Unsupported Area status.');
  validateApplicability(definition.applicability);

  const componentIds = new Set<string>();
  const orders = new Set<number>();
  for (const rule of rules) {
    if (rule.areaDefinitionId !== definition.id) throw new Error(`Component assignment ${rule.id} belongs to a different Area.`);
    if (rule.version !== definition.version || rule.status !== definition.status) throw new Error(`Component assignment ${rule.id} does not match the Area version/status.`);
    if (!rule.componentDefinitionId.trim() || !Number.isInteger(rule.componentDefinitionVersion) || rule.componentDefinitionVersion < 1) throw new Error(`Component assignment ${rule.id} requires a valid Component version.`);
    if (componentIds.has(rule.componentDefinitionId)) throw new Error(`Component ${rule.componentDefinitionId} is assigned to the Area more than once.`);
    if (!INCLUSIONS.has(rule.inclusion)) throw new Error(`Unsupported inclusion rule '${rule.inclusion}'.`);
    if (!Number.isInteger(rule.order) || rule.order < 1) throw new Error('Component order must be a positive integer.');
    if (orders.has(rule.order)) throw new Error(`Duplicate Component order ${rule.order}.`);
    componentIds.add(rule.componentDefinitionId);
    orders.add(rule.order);
    validateApplicability(rule.applicability);
    validateAssessmentDefaults(rule.assessmentDefaults);
    validateEvidenceDefaults(rule.evidenceDefaults);
  }
}

export function withCatalogueLifecycle<T extends { status: CatalogueStatus; version: number; createdAt: string; publishedAt?: string; retiredAt?: string; updatedAt?: string; source: CatalogueRecordSource }>(
  record: T,
  status: CatalogueStatus,
  timestamp = new Date().toISOString(),
): T {
  return {
    ...record,
    status,
    updatedAt: timestamp,
    ...(status === 'published' ? { publishedAt: timestamp, retiredAt: undefined } : {}),
    ...(status === 'retired' ? { retiredAt: timestamp } : {}),
  };
}
