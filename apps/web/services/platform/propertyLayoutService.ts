import type {
  PhysicalPropertyType,
  PropertyLayoutComponentReference,
  PropertyLayoutNode,
  PropertyLayoutVersion,
  PropertyRecord,
  PropertyUse,
  RoomConfigItem,
} from '../../types/platform';
import type { CatalogueAreaVersionView, ManagedAreaComponentRule } from '@pcr/templates/catalogueAdmin';
import {
  CANONICAL_PROPERTY_LAYOUT_TEMPLATES,
  PROPERTY_LAYOUT_CATALOGUE_ID,
  PROPERTY_LAYOUT_CATALOGUE_VERSION,
  canonicalAreasForPropertyClassification,
  findSystemAreaDefinition,
  findSystemComponentDefinition,
  resolvePropertyLayoutTemplateRooms,
  systemAreaComponentRulesForArea,
  type CanonicalPropertyLayoutRoom,
  type CanonicalPropertyLayoutTemplate,
  type SystemAreaDefinitionVersion,
} from '@pcr/templates/propertyLayoutCatalogue';
import { generateId } from '../../utils';

export type PropertyLayoutTemplate = CanonicalPropertyLayoutTemplate;
export const PROPERTY_LAYOUT_TEMPLATES: PropertyLayoutTemplate[] = CANONICAL_PROPERTY_LAYOUT_TEMPLATES;

function deterministicComponentInstanceId(areaInstanceId: string, componentDefinitionId: string): string {
  return `${areaInstanceId}:component:${componentDefinitionId}`;
}

function componentReference(
  areaInstanceId: string,
  rule: Pick<ManagedAreaComponentRule,
    | 'componentDefinitionId'
    | 'componentDefinitionVersion'
    | 'id'
    | 'version'
    | 'order'
    | 'inclusion'
    | 'photoRequired'
    | 'legacyComponentName'
  >,
  fallbackName?: string,
): PropertyLayoutComponentReference {
  return {
    id: deterministicComponentInstanceId(areaInstanceId, rule.componentDefinitionId),
    name: rule.legacyComponentName || fallbackName || rule.componentDefinitionId,
    canonicalComponentDefinitionId: rule.componentDefinitionId,
    canonicalComponentDefinitionVersion: rule.componentDefinitionVersion,
    canonicalAreaComponentRuleId: rule.id,
    canonicalAreaComponentRuleVersion: rule.version,
    order: rule.order,
    inclusion: rule.inclusion,
    photoRequired: rule.photoRequired,
  };
}

function systemComponentRefs(
  areaInstanceId: string,
  areaDefinitionId: string,
  areaDefinitionVersion: number,
): PropertyLayoutComponentReference[] {
  return systemAreaComponentRulesForArea(areaDefinitionId, areaDefinitionVersion).map((rule) => {
    const component = findSystemComponentDefinition(rule.componentDefinitionId, rule.componentDefinitionVersion);
    return componentReference(areaInstanceId, rule as ManagedAreaComponentRule, component?.name);
  });
}

function roomFromBlueprint(
  blueprint: CanonicalPropertyLayoutRoom,
  areaInstanceId = `area-${generateId()}`,
  existing?: RoomConfigItem,
): RoomConfigItem {
  return {
    id: areaInstanceId,
    name: existing?.name?.trim() || blueprint.name,
    roomType: blueprint.roomType,
    floorLevel: existing?.floorLevel || blueprint.floorLevel,
    buildingName: existing?.buildingName,
    parentAreaId: existing?.parentAreaId,
    responsibility: existing?.responsibility || blueprint.responsibility,
    notes: existing?.notes || '',
    itemsPreset: [],
    canonicalAreaDefinitionId: blueprint.canonicalAreaDefinitionId,
    canonicalAreaDefinitionVersion: blueprint.canonicalAreaDefinitionVersion,
    componentRefs: systemComponentRefs(
      areaInstanceId,
      blueprint.canonicalAreaDefinitionId,
      blueprint.canonicalAreaDefinitionVersion,
    ),
  };
}

function roomsFromTemplate(
  template: PropertyLayoutTemplate,
  physicalPropertyType?: PhysicalPropertyType,
): RoomConfigItem[] {
  return resolvePropertyLayoutTemplateRooms(template, physicalPropertyType).map((blueprint) => roomFromBlueprint(blueprint));
}

export function templatesForProperty(input: Pick<PropertyRecord, 'propertyUse' | 'physicalPropertyType'>): PropertyLayoutTemplate[] {
  const use = input.propertyUse;
  const physical = input.physicalPropertyType;
  return PROPERTY_LAYOUT_TEMPLATES.filter((template) => {
    const useMatch = !use || template.propertyUses.includes(use as PropertyUse);
    const physicalMatch = !physical || template.physicalPropertyTypes.includes(physical);
    return useMatch && physicalMatch;
  });
}

export function canonicalAreasForProperty(
  property: Pick<PropertyRecord, 'propertyUse' | 'physicalPropertyType'>,
): SystemAreaDefinitionVersion[] {
  return canonicalAreasForPropertyClassification({
    propertyUse: property.propertyUse,
    physicalPropertyType: property.physicalPropertyType,
  });
}

export function createRoomFromSystemArea(
  areaDefinitionId: string,
  options: {
    name?: string;
    floorLevel?: string;
    responsibility?: RoomConfigItem['responsibility'];
    roomType?: RoomConfigItem['roomType'];
  } = {},
): RoomConfigItem {
  const definition = findSystemAreaDefinition(areaDefinitionId);
  if (!definition || definition.status !== 'published') throw new Error('Select a published canonical Area definition.');
  const areaInstanceId = `area-${generateId()}`;
  return {
    id: areaInstanceId,
    name: options.name?.trim() || definition.name,
    roomType: options.roomType || roomTypeForArea(definition),
    floorLevel: options.floorLevel?.trim() || 'Ground Floor',
    responsibility: options.responsibility || 'lot',
    notes: '',
    itemsPreset: [],
    canonicalAreaDefinitionId: definition.id,
    canonicalAreaDefinitionVersion: definition.version,
    componentRefs: systemComponentRefs(areaInstanceId, definition.id, definition.version),
  };
}

/** Supports published agency-defined Areas returned by the catalogue administration API. */
export function createRoomFromCatalogueArea(
  area: CatalogueAreaVersionView,
  options: {
    name?: string;
    floorLevel?: string;
    responsibility?: RoomConfigItem['responsibility'];
    roomType?: RoomConfigItem['roomType'];
  } = {},
): RoomConfigItem {
  if (area.definition.status !== 'published' || !area.immutable) throw new Error('Only an immutable published Area version can be added to a Property layout.');
  const areaInstanceId = `area-${generateId()}`;
  const refs = [...area.componentRules]
    .sort((left, right) => left.order - right.order)
    .map((rule) => componentReference(areaInstanceId, rule));
  return {
    id: areaInstanceId,
    name: options.name?.trim() || area.definition.name,
    roomType: options.roomType || roomTypeForArea(area.definition),
    floorLevel: options.floorLevel?.trim() || 'Ground Floor',
    responsibility: options.responsibility || 'lot',
    notes: '',
    itemsPreset: [],
    canonicalAreaDefinitionId: area.definition.id,
    canonicalAreaDefinitionVersion: area.definition.version,
    componentRefs: refs,
  };
}

function roomTypeForArea(area: Pick<SystemAreaDefinitionVersion, 'category' | 'id'>): RoomConfigItem['roomType'] {
  switch (area.category) {
    case 'sleeping': return 'bedroom';
    case 'wet_area': return 'bathroom';
    case 'living': return 'living';
    case 'kitchen': return 'kitchen';
    case 'circulation': return 'hallway';
    case 'storage': return 'storage';
    case 'external': return 'outdoor';
    case 'safety': return 'safety';
    case 'industrial': return 'warehouse';
    case 'commercial': return area.id.includes('retail') || area.id.includes('showroom') ? 'retail' : 'office';
    case 'common_property': return area.id.includes('car-park') ? 'garage' : area.id.includes('plant') ? 'plant' : 'hallway';
    case 'service': return area.id.includes('amenities') ? 'amenities' : area.id.includes('garage') || area.id.includes('parking') ? 'garage' : 'plant';
    default: return 'other';
  }
}

export function hierarchyFromRooms(rooms: RoomConfigItem[]): PropertyLayoutNode[] {
  const nodes: PropertyLayoutNode[] = [
    { id: 'site-primary', name: 'Primary Site', kind: 'site', order: 1 },
    { id: 'building-main', name: 'Main Building', kind: 'building', parentId: 'site-primary', order: 1 },
  ];
  const levels = [...new Set(rooms.map((room) => room.floorLevel || 'Ground Floor'))];
  levels.forEach((level, index) => {
    const levelId = `level-${level.toLowerCase().replace(/[^a-z0-9]+/gu, '-')}`;
    nodes.push({ id: levelId, name: level, kind: 'level', parentId: 'building-main', order: index + 1 });
    rooms.filter((candidate) => (candidate.floorLevel || 'Ground Floor') === level).forEach((area, areaIndex) => {
      nodes.push({
        id: area.id,
        name: area.name,
        kind: 'area',
        parentId: levelId,
        order: areaIndex + 1,
        responsibility: area.responsibility,
        notes: area.notes,
        itemsPreset: area.itemsPreset,
        canonicalAreaDefinitionId: area.canonicalAreaDefinitionId,
        canonicalAreaDefinitionVersion: area.canonicalAreaDefinitionVersion,
        componentRefs: structuredClone(area.componentRefs || []),
      });
    });
  });
  return nodes;
}

export function createLayoutVersion(
  property: PropertyRecord,
  rooms: RoomConfigItem[],
  changeReason: string,
  templateId?: string,
): PropertyLayoutVersion {
  const nextVersion = Math.max(0, ...(property.layoutVersions || []).map((version) => version.version)) + 1;
  const now = new Date().toISOString();
  return {
    id: `layout-${generateId()}`,
    version: nextVersion,
    label: `Layout v${nextVersion}`,
    effectiveFrom: now,
    changeReason,
    templateId,
    canonicalCatalogueId: PROPERTY_LAYOUT_CATALOGUE_ID,
    canonicalCatalogueVersion: PROPERTY_LAYOUT_CATALOGUE_VERSION,
    roomsConfig: structuredClone(rooms),
    nodes: hierarchyFromRooms(rooms),
    createdAt: now,
  };
}

export function applyLayoutTemplate(
  property: PropertyRecord,
  template: PropertyLayoutTemplate,
  changeReason = `Applied layout template: ${template.name}`,
): Partial<PropertyRecord> {
  const rooms = roomsFromTemplate(template, property.physicalPropertyType);
  const version = createLayoutVersion(property, rooms, changeReason, template.id);
  const previousVersions = (property.layoutVersions || []).map((item) => item.effectiveTo ? item : { ...item, effectiveTo: version.effectiveFrom });
  return {
    roomsConfig: rooms,
    layoutTemplateId: template.id,
    layoutNodes: version.nodes,
    layoutVersions: [...previousVersions, version],
    currentLayoutVersionId: version.id,
    ...(template.furnished ? { features: { ...property.features, furnished: true } } : {}),
  };
}

/**
 * Upgrades a known template-backed legacy layout without using Area display names.
 * Matching is by persisted template id plus ordered RoomType slots. Unmatched custom
 * Areas are retained untouched for human review rather than guessed into a definition.
 */
export function migrateTemplateBackedLayoutToCanonical(property: PropertyRecord): {
  rooms: RoomConfigItem[];
  migratedCount: number;
  unmappedCount: number;
  complete: boolean;
} {
  const current = structuredClone(property.roomsConfig || []);
  if (current.length > 0 && current.every((room) => room.canonicalAreaDefinitionId && room.canonicalAreaDefinitionVersion && room.componentRefs?.length)) {
    return { rooms: current, migratedCount: 0, unmappedCount: 0, complete: true };
  }
  const template = PROPERTY_LAYOUT_TEMPLATES.find((candidate) => candidate.id === property.layoutTemplateId);
  if (!template) {
    const unmapped = current.filter((room) => !room.canonicalAreaDefinitionId).length;
    return { rooms: current, migratedCount: 0, unmappedCount: unmapped, complete: unmapped === 0 };
  }

  const blueprints = resolvePropertyLayoutTemplateRooms(template, property.physicalPropertyType);
  const used = new Set<number>();
  let cursor = 0;
  let migratedCount = 0;
  const migrated = blueprints.map((blueprint, blueprintIndex) => {
    let matchedIndex = -1;
    for (let index = cursor; index < current.length; index += 1) {
      if (used.has(index)) continue;
      if (current[index].roomType === blueprint.roomType) {
        matchedIndex = index;
        break;
      }
    }
    if (matchedIndex < 0) {
      for (let index = 0; index < current.length; index += 1) {
        if (!used.has(index) && current[index].roomType === blueprint.roomType) {
          matchedIndex = index;
          break;
        }
      }
    }
    const existing = matchedIndex >= 0 ? current[matchedIndex] : undefined;
    if (matchedIndex >= 0) {
      used.add(matchedIndex);
      cursor = Math.max(cursor, matchedIndex + 1);
    }
    const areaInstanceId = existing?.id || `area-${property.id}-${template.id}-${blueprintIndex + 1}`.replace(/[^a-zA-Z0-9:_-]+/gu, '-');
    const next = roomFromBlueprint(blueprint, areaInstanceId, existing);
    if (!existing?.canonicalAreaDefinitionId) migratedCount += 1;
    return next;
  });
  const unmatched = current.filter((_room, index) => !used.has(index));
  return {
    rooms: [...migrated, ...unmatched],
    migratedCount,
    unmappedCount: unmatched.filter((room) => !room.canonicalAreaDefinitionId).length,
    complete: unmatched.every((room) => Boolean(room.canonicalAreaDefinitionId)),
  };
}

export function cloneLayoutFromProperty(target: PropertyRecord, source: PropertyRecord): Partial<PropertyRecord> {
  const sourceRooms = migrateTemplateBackedLayoutToCanonical(source).rooms;
  const rooms = sourceRooms.map((room) => {
    const id = `area-${generateId()}`;
    return {
      ...structuredClone(room),
      id,
      componentRefs: (room.componentRefs || []).map((component) => ({
        ...component,
        id: deterministicComponentInstanceId(id, component.canonicalComponentDefinitionId),
      })),
    };
  });
  const version = createLayoutVersion(target, rooms, `Copied layout from ${source.address}`, source.layoutTemplateId);
  const previousVersions = (target.layoutVersions || []).map((item) => item.effectiveTo ? item : { ...item, effectiveTo: version.effectiveFrom });
  return {
    roomsConfig: rooms,
    layoutTemplateId: source.layoutTemplateId,
    layoutNodes: version.nodes,
    layoutVersions: [...previousVersions, version],
    currentLayoutVersionId: version.id,
  };
}
