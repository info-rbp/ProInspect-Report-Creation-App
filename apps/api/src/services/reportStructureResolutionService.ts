import type {
  InspectionType,
  PropertyLayoutVersion,
  PropertyRecord,
  ReportAggregate,
  ReportComponentRequirementSnapshot,
  RoomConfigItem,
} from '@pcr/domain';
import {
  MANAGED_SYSTEM_AREA_VERSIONS,
  MANAGED_SYSTEM_COMPONENT_VERSIONS,
  type CatalogueAreaVersionView,
  type CatalogueComponentVersionView,
  type ManagedAreaComponentRule,
} from '@pcr/templates/catalogueAdmin';
import {
  canonicalInspectionTemplateFromRecord,
  systemInspectionTemplateRecord,
  templateAppliesToProperty,
  validateCanonicalInspectionTemplate,
  type CanonicalInspectionTemplateAreaReference,
  type CanonicalInspectionTemplateContract,
} from '@pcr/templates/inspectionTemplateCatalogue';
import { canonicalInspectionType } from '@pcr/domain';
import type { ApiDependencies, StoredRecord } from '../backend/types.js';

const AREA_VERSION_COLLECTION = 'catalogueAreaVersions';
const COMPONENT_VERSION_COLLECTION = 'catalogueComponentVersions';
export const REPORT_STRUCTURE_RESOLUTION_VERSION = 1;

function storageId(id: string, version: number): string {
  return `${id}--v${version}`;
}

function asProperty(record: StoredRecord): PropertyRecord {
  return record as unknown as PropertyRecord;
}

function asLayoutVersion(value: unknown): PropertyLayoutVersion | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Partial<PropertyLayoutVersion>;
  if (!record.id || !Array.isArray(record.roomsConfig)) return undefined;
  return record as PropertyLayoutVersion;
}

export function resolveCurrentPropertyLayout(propertyRecord: StoredRecord): PropertyLayoutVersion {
  const property = asProperty(propertyRecord);
  const versions = Array.isArray(property.layoutVersions)
    ? property.layoutVersions.map(asLayoutVersion).filter((value): value is PropertyLayoutVersion => Boolean(value))
    : [];
  const currentId = property.currentLayoutVersionId?.trim();
  const current = currentId ? versions.find((version) => version.id === currentId) : undefined;
  if (!current) {
    throw Object.assign(new Error('The Property must have a current versioned canonical layout before a Report can be created.'), {
      code: 'PROPERTY_LAYOUT_VERSION_REQUIRED',
      status: 422,
    });
  }
  if (!current.roomsConfig.length) {
    throw Object.assign(new Error('The current Property Layout Version contains no Areas.'), {
      code: 'PROPERTY_LAYOUT_EMPTY',
      status: 422,
    });
  }
  return current;
}

function canonicalRoom(room: RoomConfigItem): asserts room is RoomConfigItem & {
  canonicalAreaDefinitionId: string;
  canonicalAreaDefinitionVersion: number;
  componentRefs: NonNullable<RoomConfigItem['componentRefs']>;
} {
  if (!room.canonicalAreaDefinitionId || !room.canonicalAreaDefinitionVersion) {
    throw Object.assign(new Error(`Property Area "${room.name}" is not mapped to an exact canonical Area version.`), {
      code: 'PROPERTY_AREA_CANONICAL_REFERENCE_REQUIRED',
      status: 422,
      details: { areaId: room.id },
    });
  }
  if (!Array.isArray(room.componentRefs) || room.componentRefs.length === 0) {
    throw Object.assign(new Error(`Property Area "${room.name}" has no canonical Component instances.`), {
      code: 'PROPERTY_COMPONENT_REFERENCES_REQUIRED',
      status: 422,
      details: { areaId: room.id },
    });
  }
}

function systemArea(id: string, version: number): CatalogueAreaVersionView | undefined {
  return MANAGED_SYSTEM_AREA_VERSIONS.find(
    (item) => item.definition.id === id && item.definition.version === version,
  );
}

function systemComponent(id: string, version: number): CatalogueComponentVersionView | undefined {
  return MANAGED_SYSTEM_COMPONENT_VERSIONS.find(
    (item) => item.definition.id === id && item.definition.version === version,
  );
}

async function loadArea(
  dependencies: ApiDependencies,
  agencyId: string,
  id: string,
  version: number,
): Promise<CatalogueAreaVersionView> {
  const stored = await dependencies.repository.get(AREA_VERSION_COLLECTION, agencyId, storageId(id, version));
  if (stored) {
    const definition = stored.definition as CatalogueAreaVersionView['definition'] | undefined;
    const componentRules = stored.componentRules as CatalogueAreaVersionView['componentRules'] | undefined;
    if (definition && Array.isArray(componentRules)) {
      return {
        definition,
        componentRules,
        recordVersion: stored.version,
        immutable: stored.immutable === true,
        ...(stored.systemDefault === true ? { systemDefault: true } : {}),
      };
    }
  }
  const fallback = systemArea(id, version);
  if (fallback) return structuredClone(fallback);
  throw Object.assign(new Error(`Canonical Area ${id}@${version} cannot be resolved.`), {
    code: 'CATALOGUE_AREA_VERSION_NOT_FOUND',
    status: 409,
    details: { id, version },
  });
}

async function loadComponent(
  dependencies: ApiDependencies,
  agencyId: string,
  id: string,
  version: number,
): Promise<CatalogueComponentVersionView> {
  const stored = await dependencies.repository.get(COMPONENT_VERSION_COLLECTION, agencyId, storageId(id, version));
  if (stored) {
    const definition = stored.definition as CatalogueComponentVersionView['definition'] | undefined;
    if (definition) {
      return {
        definition,
        recordVersion: stored.version,
        immutable: stored.immutable === true,
        ...(stored.systemDefault === true ? { systemDefault: true } : {}),
      };
    }
  }
  const fallback = systemComponent(id, version);
  if (fallback) return structuredClone(fallback);
  throw Object.assign(new Error(`Canonical Component ${id}@${version} cannot be resolved.`), {
    code: 'CATALOGUE_COMPONENT_VERSION_NOT_FOUND',
    status: 409,
    details: { id, version },
  });
}

function requirementSnapshot(rule: ManagedAreaComponentRule): ReportComponentRequirementSnapshot {
  return {
    condition: rule.assessmentDefaults.condition,
    cleanliness: rule.assessmentDefaults.cleanliness,
    material: rule.assessmentDefaults.material,
    colour: rule.assessmentDefaults.colour,
    type: rule.assessmentDefaults.type,
    quantity: rule.assessmentDefaults.quantity,
    workingStatus: rule.assessmentDefaults.workingStatus,
    operationalTest: rule.assessmentDefaults.operationalTest,
    commentary: rule.assessmentDefaults.commentary,
    maintenanceEvaluation: rule.assessmentDefaults.maintenanceEvaluation,
    componentPhotoRequired: rule.evidenceDefaults.componentPhotoRequired,
    exceptionPhotoRequired: rule.evidenceDefaults.exceptionPhotoRequired,
    contextPhotoRequired: rule.evidenceDefaults.contextPhotoRequired,
    minimumPhotos: rule.evidenceDefaults.minimumPhotos,
    minimumExceptionPhotos: rule.evidenceDefaults.minimumExceptionPhotos,
    comparisonPairRequired: rule.evidenceDefaults.comparisonPairRequired,
    reasonRequiredIfMissing: rule.evidenceDefaults.reasonRequiredIfMissing,
  };
}

function areaTemplateReference(
  template: CanonicalInspectionTemplateContract,
  room: RoomConfigItem & { canonicalAreaDefinitionId: string; canonicalAreaDefinitionVersion: number },
): CanonicalInspectionTemplateAreaReference | undefined {
  return template.areaReferences.find((reference) =>
    reference.canonicalAreaDefinitionId === room.canonicalAreaDefinitionId &&
    reference.canonicalAreaDefinitionVersion === room.canonicalAreaDefinitionVersion,
  );
}

function shouldIncludeArea(
  template: CanonicalInspectionTemplateContract,
  room: RoomConfigItem & { canonicalAreaDefinitionId: string; canonicalAreaDefinitionVersion: number },
): boolean {
  const reference = areaTemplateReference(template, room);
  if (reference?.inclusion === 'excluded') return false;
  if (reference) return true;
  return template.includeUnreferencedPropertyAreas;
}

function ruleAllowed(
  reference: CanonicalInspectionTemplateAreaReference | undefined,
  rule: ManagedAreaComponentRule,
): boolean {
  const restricted = reference?.canonicalAreaComponentRuleReferences;
  if (!restricted?.length) return true;
  return restricted.some((candidate) => candidate.id === rule.id && candidate.version === rule.version);
}

function applicabilityIncludes(
  values: string[] | undefined,
  value: string | undefined,
): boolean {
  return !value || !values?.length || values.includes(value);
}

function templateSpecificity(record: StoredRecord, property: PropertyRecord): number {
  let score = 0;
  const uses = Array.isArray(record.propertyUses) ? record.propertyUses : [];
  const physical = Array.isArray(record.physicalPropertyTypes) ? record.physicalPropertyTypes : [];
  if (property.propertyUse && uses.includes(property.propertyUse)) score += uses.length === 1 ? 20 : 5;
  if (property.physicalPropertyType && physical.includes(property.physicalPropertyType)) score += physical.length === 1 ? 20 : 5;
  return score;
}

export async function resolvePublishedInspectionTemplate(
  dependencies: ApiDependencies,
  agencyId: string,
  inspectionType: InspectionType,
  propertyRecord: StoredRecord,
  actorId: string,
): Promise<CanonicalInspectionTemplateContract> {
  const property = asProperty(propertyRecord);
  const page = await dependencies.repository.list('templates', agencyId, 100);
  const candidates = page.items
    .filter((record) => record.status === 'published')
    .filter((record) => canonicalInspectionType(String(record.inspectionType ?? record.reportType ?? '')) === inspectionType)
    .map((record) => ({ record, contract: canonicalInspectionTemplateFromRecord(record, inspectionType) }))
    .filter(({ contract }) => templateAppliesToProperty(contract, property))
    .sort((left, right) =>
      templateSpecificity(right.record, property) - templateSpecificity(left.record, property) ||
      right.contract.version - left.contract.version,
    );

  let contract = candidates[0]?.contract;
  if (!contract) {
    const data = systemInspectionTemplateRecord(inspectionType);
    const id = String(data.templateId);
    const existing = await dependencies.repository.get('templates', agencyId, id);
    if (!existing) {
      await dependencies.repository.create('templates', agencyId, id, data, actorId);
      contract = canonicalInspectionTemplateFromRecord({ id, ...data }, inspectionType);
    } else {
      contract = canonicalInspectionTemplateFromRecord(existing, inspectionType);
    }
  }

  const issues = validateCanonicalInspectionTemplate(contract);
  if (issues.length) {
    throw Object.assign(new Error(`Published inspection template is invalid: ${issues.join(' ')}`), {
      code: 'INVALID_PUBLISHED_TEMPLATE',
      status: 409,
      details: { templateId: contract.id, templateVersion: contract.version, issues },
    });
  }
  return contract;
}

export async function resolveAuthoritativeReportStructure(
  dependencies: ApiDependencies,
  input: {
    agencyId: string;
    inspectionType: InspectionType;
    propertyRecord: StoredRecord;
    template: CanonicalInspectionTemplateContract;
  },
): Promise<{
  propertyLayoutVersion: PropertyLayoutVersion;
  areas: ReportAggregate['areas'];
}> {
  const property = asProperty(input.propertyRecord);
  const layout = resolveCurrentPropertyLayout(input.propertyRecord);
  const rooms = structuredClone(layout.roomsConfig);
  rooms.forEach(canonicalRoom);

  const missingRequired = input.template.areaReferences.filter((reference) =>
    reference.inclusion === 'required' && !rooms.some((room) =>
      room.canonicalAreaDefinitionId === reference.canonicalAreaDefinitionId &&
      room.canonicalAreaDefinitionVersion === reference.canonicalAreaDefinitionVersion,
    ),
  );
  if (missingRequired.length) {
    throw Object.assign(new Error('The Property Layout does not satisfy required canonical Areas in the published inspection template.'), {
      code: 'PROPERTY_LAYOUT_TEMPLATE_MISMATCH',
      status: 422,
      details: { missingAreaReferences: missingRequired.map((reference) => reference.id) },
    });
  }

  const areas: ReportAggregate['areas'] = [];
  for (const room of rooms) {
    canonicalRoom(room);
    if (!shouldIncludeArea(input.template, room)) continue;
    const areaView = await loadArea(
      dependencies,
      input.agencyId,
      room.canonicalAreaDefinitionId,
      room.canonicalAreaDefinitionVersion,
    );
    if (!areaView.immutable || areaView.definition.status !== 'published') {
      throw Object.assign(new Error(`Property Area ${room.name} references a non-published catalogue Area version.`), {
        code: 'CATALOGUE_AREA_VERSION_NOT_PUBLISHED',
        status: 409,
      });
    }
    if (!applicabilityIncludes(areaView.definition.applicability.inspectionTypes, input.inspectionType) ||
      !applicabilityIncludes(areaView.definition.applicability.propertyUses, property.propertyUse) ||
      !applicabilityIncludes(areaView.definition.applicability.physicalPropertyTypes, property.physicalPropertyType)) {
      continue;
    }
    const reference = areaTemplateReference(input.template, room);
    const components: ReportAggregate['areas'][number]['components'] = [];
    for (const propertyComponent of [...room.componentRefs].sort((left, right) => left.order - right.order)) {
      const rule = areaView.componentRules.find((candidate) =>
        candidate.id === propertyComponent.canonicalAreaComponentRuleId &&
        candidate.version === propertyComponent.canonicalAreaComponentRuleVersion &&
        candidate.componentDefinitionId === propertyComponent.canonicalComponentDefinitionId &&
        candidate.componentDefinitionVersion === propertyComponent.canonicalComponentDefinitionVersion,
      );
      if (!rule) {
        throw Object.assign(new Error(`Property Component ${propertyComponent.name} cannot be reconciled with its exact Area-Component rule.`), {
          code: 'CATALOGUE_RULE_VERSION_MISMATCH',
          status: 409,
          details: { areaId: room.id, componentId: propertyComponent.id },
        });
      }
      if (!ruleAllowed(reference, rule)) continue;
      if (!applicabilityIncludes(rule.applicability.inspectionTypes, input.inspectionType)) continue;
      const componentView = await loadComponent(
        dependencies,
        input.agencyId,
        propertyComponent.canonicalComponentDefinitionId,
        propertyComponent.canonicalComponentDefinitionVersion,
      );
      if (!componentView.immutable || componentView.definition.status !== 'published') {
        throw Object.assign(new Error(`Property Component ${propertyComponent.name} references a non-published catalogue Component version.`), {
          code: 'CATALOGUE_COMPONENT_VERSION_NOT_PUBLISHED',
          status: 409,
        });
      }
      const requirements = requirementSnapshot(rule);
      const operational = requirements.workingStatus !== 'hidden' || requirements.operationalTest !== 'not_applicable';
      components.push({
        id: propertyComponent.id,
        component: propertyComponent.name || componentView.definition.name,
        canonicalComponentDefinitionId: componentView.definition.id,
        canonicalComponentDefinitionVersion: componentView.definition.version,
        canonicalAreaComponentRuleId: rule.id,
        canonicalAreaComponentRuleVersion: rule.version,
        requirementSnapshot: requirements,
        conditionCategory: requirements.condition === 'hidden' ? 'not_applicable' : 'unable_to_confirm',
        cleanlinessCategory: requirements.cleanliness === 'hidden' ? 'not_applicable' : 'unable_to_confirm',
        workingStatus: operational ? 'untested' : 'not_applicable',
        testStatus: requirements.operationalTest === 'not_applicable' ? 'not_applicable' : 'untested',
        defects: [],
        maintenanceRequired: false,
        commentary: '',
        photoReferences: [],
        reviewStatus: 'draft',
        comparisonStatus: 'not_compared',
      });
    }
    if (!components.length) continue;
    areas.push({
      id: room.id,
      name: room.name,
      canonicalAreaDefinitionId: room.canonicalAreaDefinitionId,
      canonicalAreaDefinitionVersion: room.canonicalAreaDefinitionVersion,
      ...(reference ? { templateAreaReferenceId: reference.id } : {}),
      sequence: areas.length + 1,
      overallCommentary: '',
      photoReferences: [],
      components,
    });
  }

  if (!areas.length) {
    throw Object.assign(new Error('The published template and current Property Layout resolve to no inspectable canonical Areas.'), {
      code: 'REPORT_STRUCTURE_EMPTY',
      status: 422,
    });
  }
  return { propertyLayoutVersion: layout, areas };
}
