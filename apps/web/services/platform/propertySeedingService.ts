import type { PropertyLayoutComponentReference, PropertyRecord, RoomConfigItem, RoomType, PropertyFeatures } from '../../types/platform';
import type { InspectionItem, ReportData, Room } from '../../types';
import {
  findSystemAreaDefinition,
  findSystemComponentDefinition,
  systemAreaComponentRulesForArea,
} from '@pcr/templates/propertyLayoutCatalogue';
import { migrateTemplateBackedLayoutToCanonical } from './propertyLayoutService';
import { generateId } from '../../utils';

const OPERATIONAL_COMPONENT_CATEGORIES = new Set([
  'electrical', 'plumbing', 'appliance', 'hvac', 'safety_security',
]);

/**
 * Operational state is derived from an exact catalogue Component definition.
 * Display wording is deliberately irrelevant.
 */
export function isOperationalItem(componentDefinitionId: string, version?: number): boolean {
  const component = findSystemComponentDefinition(componentDefinitionId, version);
  return Boolean(component && OPERATIONAL_COMPONENT_CATEGORIES.has(component.category));
}

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '');
}

export function createSeededItem(
  name: string,
  stableId?: string,
  canonical?: {
    componentDefinitionId: string;
    componentDefinitionVersion: number;
    areaComponentRuleId?: string;
    areaComponentRuleVersion?: number;
  },
): InspectionItem {
  const resolvedCanonicalId = canonical?.componentDefinitionId
    || (stableId && findSystemComponentDefinition(stableId) ? stableId : undefined);
  const resolvedComponent = resolvedCanonicalId
    ? findSystemComponentDefinition(resolvedCanonicalId, canonical?.componentDefinitionVersion)
    : undefined;
  const operational = Boolean(resolvedComponent && OPERATIONAL_COMPONENT_CATEGORIES.has(resolvedComponent.category));
  return {
    id: stableId?.trim() || slug(name) || generateId(),
    name,
    ...(resolvedComponent ? {
      canonicalComponentDefinitionId: resolvedComponent.id,
      canonicalComponentDefinitionVersion: resolvedComponent.version,
    } : {}),
    ...(canonical?.areaComponentRuleId ? { canonicalAreaComponentRuleId: canonical.areaComponentRuleId } : {}),
    ...(canonical?.areaComponentRuleVersion ? { canonicalAreaComponentRuleVersion: canonical.areaComponentRuleVersion } : {}),
    conditionCategory: 'unable_to_confirm',
    cleanlinessCategory: 'unable_to_confirm',
    workingStatus: operational ? 'untested' : 'not_applicable',
    testStatus: operational ? 'untested' : 'not_applicable',
    defects: [],
    maintenanceRequired: false,
    comment: '',
    photoReferences: [],
    reviewStatus: 'draft',
    comparisonStatus: 'not_compared',
  };
}

function itemFromReference(reference: PropertyLayoutComponentReference): InspectionItem {
  const component = findSystemComponentDefinition(
    reference.canonicalComponentDefinitionId,
    reference.canonicalComponentDefinitionVersion,
  );
  return createSeededItem(reference.name || component?.name || reference.canonicalComponentDefinitionId, reference.id, {
    componentDefinitionId: reference.canonicalComponentDefinitionId,
    componentDefinitionVersion: reference.canonicalComponentDefinitionVersion,
    areaComponentRuleId: reference.canonicalAreaComponentRuleId,
    areaComponentRuleVersion: reference.canonicalAreaComponentRuleVersion,
  });
}

/**
 * Controlled fallback for genuinely legacy/unmapped custom layouts. This uses
 * the stored RoomType enum only. It never scans or infers from an Area name.
 */
const LEGACY_ROOM_TYPE_AREA: Partial<Record<RoomType, string>> = {
  bedroom: 'bedroom',
  bathroom: 'bathroom',
  living: 'lounge-room',
  kitchen: 'kitchen',
  dining: 'dining-room',
  laundry: 'laundry',
  garage: 'garage-carport',
  study: 'study',
  hallway: 'passage-hallway',
  storage: 'storeroom',
  office: 'commercial-open-office',
  retail: 'retail-sales-area',
  warehouse: 'warehouse-floor',
  amenities: 'commercial-amenities',
  plant: 'hvac-mechanical-services',
  safety: 'security-safety',
};

export const getDefaultItemsForRoomType = (roomType?: RoomType | string, _roomName = ''): InspectionItem[] => {
  const areaId = roomType ? LEGACY_ROOM_TYPE_AREA[roomType as RoomType] : undefined;
  if (areaId) {
    const area = findSystemAreaDefinition(areaId);
    if (area) {
      return systemAreaComponentRulesForArea(area.id, area.version).map((rule) => {
        const component = findSystemComponentDefinition(rule.componentDefinitionId, rule.componentDefinitionVersion);
        return createSeededItem(component?.name || rule.legacyComponentName, rule.componentDefinitionId, {
          componentDefinitionId: rule.componentDefinitionId,
          componentDefinitionVersion: rule.componentDefinitionVersion,
          areaComponentRuleId: rule.id,
          areaComponentRuleVersion: rule.version,
        });
      });
    }
  }

  return [
    createSeededItem('Doors / Doorway Frames', 'doors-doorway-frames'),
    createSeededItem('Ceiling / Cornices', 'ceiling-cornices'),
    createSeededItem('Walls', 'walls'),
    createSeededItem('Light Fittings', 'light-fittings'),
    createSeededItem('Points and Switches', 'points-switches'),
    createSeededItem('Floor / Floorcoverings', 'floor-floorcoverings'),
  ];
};

function roomFromConfig(config: RoomConfigItem): Room {
  const exactItems = config.componentRefs?.length
    ? [...config.componentRefs].sort((left, right) => left.order - right.order).map(itemFromReference)
    : getDefaultItemsForRoomType(config.roomType).map((item) => ({
        ...item,
        id: `${config.id}:component:${item.canonicalComponentDefinitionId || item.id}`,
      }));
  return {
    id: config.id,
    name: config.name,
    canonicalAreaDefinitionId: config.canonicalAreaDefinitionId,
    canonicalAreaDefinitionVersion: config.canonicalAreaDefinitionVersion,
    status: 'draft',
    items: exactItems,
    photos: [],
    overallComment: config.notes || '',
    isExpanded: true,
  };
}

function canonicalRoom(
  id: string,
  name: string,
  areaDefinitionId: string,
  roomType: RoomType,
  notes = '',
): Room {
  const area = findSystemAreaDefinition(areaDefinitionId);
  if (!area) {
    return {
      id,
      name,
      status: 'draft',
      items: getDefaultItemsForRoomType(roomType).map((item) => ({ ...item, id: `${id}:component:${item.id}` })),
      photos: [],
      overallComment: notes,
      isExpanded: true,
    };
  }
  const componentRefs: PropertyLayoutComponentReference[] = systemAreaComponentRulesForArea(area.id, area.version).map((rule) => {
    const component = findSystemComponentDefinition(rule.componentDefinitionId, rule.componentDefinitionVersion);
    return {
      id: `${id}:component:${rule.componentDefinitionId}`,
      name: component?.name || rule.legacyComponentName,
      canonicalComponentDefinitionId: rule.componentDefinitionId,
      canonicalComponentDefinitionVersion: rule.componentDefinitionVersion,
      canonicalAreaComponentRuleId: rule.id,
      canonicalAreaComponentRuleVersion: rule.version,
      order: rule.order,
      inclusion: rule.inclusion,
      photoRequired: rule.photoRequired,
    };
  });
  return roomFromConfig({
    id,
    name,
    roomType,
    notes,
    canonicalAreaDefinitionId: area.id,
    canonicalAreaDefinitionVersion: area.version,
    componentRefs,
  });
}

export const seedRoomsFromProperty = (property: PropertyRecord): Room[] => {
  if (property.roomsConfig && property.roomsConfig.length > 0) {
    const migration = migrateTemplateBackedLayoutToCanonical(property);
    return migration.rooms.map(roomFromConfig);
  }

  if (property.layoutTemplateId) {
    const migration = migrateTemplateBackedLayoutToCanonical(property);
    if (migration.rooms.length > 0) return migration.rooms.map(roomFromConfig);
  }

  const rooms: Room[] = [];
  rooms.push(canonicalRoom('area-entry', 'Entry', 'entry', 'hallway'));
  rooms.push(canonicalRoom('area-passage-hallway', 'Passage / Hallway', 'passage-hallway', 'hallway'));

  const livingCount = property.livingAreas || 1;
  for (let i = 1; i <= livingCount; i += 1) {
    const name = livingCount === 1 ? 'Lounge / Dining Room' : i === 1 ? 'Lounge Room' : `Family Room ${i - 1}`;
    const definition = livingCount === 1 ? 'lounge-dining-room' : i === 1 ? 'lounge-room' : 'family-room';
    rooms.push(canonicalRoom(`area-living-${i}`, name, definition, 'living'));
  }

  rooms.push(canonicalRoom('area-kitchen', 'Kitchen', 'kitchen', 'kitchen'));

  const bedCount = property.bedrooms || 3;
  for (let i = 1; i <= bedCount; i += 1) {
    rooms.push(canonicalRoom(`area-bedroom-${i}`, i === 1 ? 'Bedroom 1 / Main Bedroom' : `Bedroom ${i}`, 'bedroom', 'bedroom'));
  }

  const bathCount = property.bathrooms || 1;
  for (let i = 1; i <= bathCount; i += 1) {
    const ensuite = bathCount > 1 && i === 1;
    rooms.push(canonicalRoom(`area-bathroom-${i}`, ensuite ? 'Ensuite' : i === 1 ? 'Bathroom' : `Bathroom ${i}`, ensuite ? 'ensuite' : 'bathroom', 'bathroom'));
  }

  rooms.push(canonicalRoom('area-laundry', 'Laundry', 'laundry', 'laundry'));

  if (property.propertyType === 'apartment' || property.propertyType === 'unit' || property.physicalPropertyType === 'studio') {
    rooms.push(canonicalRoom('area-balcony-courtyard', 'Balcony / External', 'balcony-courtyard', 'outdoor'));
  } else {
    rooms.push(canonicalRoom('area-exterior-front', 'Exterior Front', 'exterior-front', 'outdoor'));
    rooms.push(canonicalRoom('area-exterior-back', 'Exterior Back', 'exterior-back', 'outdoor'));
    rooms.push(canonicalRoom('area-general-external', 'General External Items', 'general-external-items', 'outdoor'));
  }

  if ((property.parking && property.parking > 0) || property.propertyType === 'house') {
    rooms.push(canonicalRoom('area-garage-carport', 'Garage / Carport', 'garage-carport', 'garage'));
  }

  rooms.push(canonicalRoom('area-security-safety', 'Security / Safety', 'security-safety', 'safety'));
  return rooms;
};

export const formatPropertyFeatures = (features?: PropertyFeatures): string => {
  if (!features) return '';
  const list: string[] = [];
  if (features.airConditioning) list.push('Air Conditioning');
  if (features.heating) list.push('Heating');
  if (features.dishwasher) list.push('Dishwasher');
  if (features.solar) list.push('Solar Panels');
  if (features.pool) list.push('Swimming Pool');
  if (features.petsAllowed) list.push('Pets Allowed');
  if (features.furnished) list.push('Furnished');
  if (features.courtyard) list.push('Courtyard');
  if (features.balcony) list.push('Balcony');
  if (features.securitySystem) list.push('Security System');
  return list.length > 0 ? `Property Features: ${list.join(', ')}.` : '';
};

export const seedReportFromProperty = (
  property: PropertyRecord,
  existingReport?: Partial<ReportData>,
): ReportData => {
  const fullAddress = [
    property.address,
    property.suburb,
    property.state ? `${property.state} ${property.postcode || ''}`.trim() : property.postcode,
  ].filter(Boolean).join(', ');

  const seededRooms = seedRoomsFromProperty(property);
  const rooms = existingReport?.rooms && existingReport.rooms.length > 0 ? existingReport.rooms : seededRooms;
  const featuresText = formatPropertyFeatures(property.features);
  const notesCombined = [property.notes, featuresText].filter(Boolean).join('\n');

  return {
    id: existingReport?.id || generateId(),
    agencyId: existingReport?.agencyId || property.agencyId,
    propertyId: property.id,
    inspectionJobId: existingReport?.inspectionJobId,
    propertyLayoutVersionId: property.currentLayoutVersionId,
    propertyAddress: fullAddress || existingReport?.propertyAddress || 'Property Address',
    clientName: property.landlordDetails?.name || existingReport?.clientName || 'Property Owner',
    tenantName: property.tenantDetails?.primaryTenantName || existingReport?.tenantName || 'Tenant',
    agentName: existingReport?.agentName || 'ProInspect Inspector',
    agentCompany: existingReport?.agentCompany || 'ProInspect Management',
    agentAddress: existingReport?.agentAddress || 'Perth, WA',
    agentPhone: existingReport?.agentPhone || '0400 000 000',
    inspectionDate: existingReport?.inspectionDate || new Date().toISOString().split('T')[0],
    reportType: existingReport?.reportType || 'Property Condition Report',
    lifecycleStatus: existingReport?.lifecycleStatus || 'draft',
    previousReportNotes: existingReport?.previousReportNotes || notesCombined || '',
    heroPhoto: existingReport?.heroPhoto,
    rooms,
    createdAt: existingReport?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
};
