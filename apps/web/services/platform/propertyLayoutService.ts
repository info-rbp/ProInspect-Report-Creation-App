import type {
  PhysicalPropertyType,
  PropertyLayoutNode,
  PropertyLayoutVersion,
  PropertyRecord,
  PropertyUse,
  RoomConfigItem,
  RoomType,
} from '../../types/platform';
import { generateId } from '../../utils';

export interface PropertyLayoutTemplate {
  id: string;
  name: string;
  description: string;
  propertyUse: PropertyUse;
  physicalPropertyTypes: PhysicalPropertyType[];
  rooms: Array<{ name: string; roomType: RoomType; floorLevel?: string; responsibility?: RoomConfigItem['responsibility'] }>;
}

const room = (
  name: string,
  roomType: RoomType,
  floorLevel = 'Ground Floor',
  responsibility: RoomConfigItem['responsibility'] = 'lot',
) => ({ name, roomType, floorLevel, responsibility });

export const PROPERTY_LAYOUT_TEMPLATES: PropertyLayoutTemplate[] = [
  {
    id: 'res-house-3x2',
    name: 'Standard 3 x 2 House',
    description: 'Residential house with comprehensive internal, external and safety inspection areas.',
    propertyUse: 'residential',
    physicalPropertyTypes: ['house', 'villa', 'duplex', 'ancillary_dwelling'],
    rooms: [
      room('Front Exterior', 'outdoor'), room('Entry', 'hallway'), room('Lounge Room', 'living'),
      room('Kitchen', 'kitchen'), room('Dining Area', 'dining'), room('Passage / Hallway', 'hallway'),
      room('Master Bedroom', 'bedroom'), room('Ensuite', 'bathroom'), room('Bedroom 2', 'bedroom'),
      room('Bedroom 3', 'bedroom'), room('Main Bathroom', 'bathroom'), room('Toilet / WC', 'bathroom'),
      room('Laundry', 'laundry'), room('Garage / Carport', 'garage'), room('Rear Exterior', 'outdoor'),
      room('Garden & External Items', 'outdoor'), room('Security & Safety', 'safety'),
    ],
  },
  {
    id: 'res-house-4x2',
    name: 'Standard 4 x 2 House',
    description: 'Four-bedroom residential house with common internal and external areas.',
    propertyUse: 'residential',
    physicalPropertyTypes: ['house', 'villa', 'duplex'],
    rooms: [
      room('Front Exterior', 'outdoor'), room('Entry', 'hallway'), room('Front Lounge', 'living'),
      room('Kitchen', 'kitchen'), room('Dining Area', 'dining'), room('Family / Living Area', 'living'),
      room('Master Bedroom', 'bedroom'), room('Ensuite', 'bathroom'), room('Bedroom 2', 'bedroom'),
      room('Bedroom 3', 'bedroom'), room('Bedroom 4', 'bedroom'), room('Main Bathroom', 'bathroom'),
      room('Toilet / WC', 'bathroom'), room('Laundry', 'laundry'), room('Garage / Carport', 'garage'),
      room('Rear Exterior', 'outdoor'), room('Garden & External Items', 'outdoor'), room('Security & Safety', 'safety'),
    ],
  },
  {
    id: 'res-apartment-1x1',
    name: '1 x 1 Apartment',
    description: 'Compact apartment layout without house-only exterior areas.',
    propertyUse: 'residential',
    physicalPropertyTypes: ['apartment', 'unit', 'studio'],
    rooms: [
      room('Entry', 'hallway'), room('Living / Dining', 'living'), room('Kitchen', 'kitchen'),
      room('Master Bedroom', 'bedroom'), room('Bathroom', 'bathroom'), room('Laundry', 'laundry'),
      room('Balcony / Courtyard', 'outdoor'), room('Storeroom', 'storage'), room('Car Bay', 'garage'),
      room('Security & Safety', 'safety'),
    ],
  },
  {
    id: 'res-apartment-2x2',
    name: '2 x 2 Apartment',
    description: 'Two-bedroom apartment with ensuite, balcony, storage and allocated car bay.',
    propertyUse: 'residential',
    physicalPropertyTypes: ['apartment', 'unit'],
    rooms: [
      room('Entry', 'hallway'), room('Living / Dining', 'living'), room('Kitchen', 'kitchen'),
      room('Master Bedroom', 'bedroom'), room('Ensuite', 'bathroom'), room('Bedroom 2', 'bedroom'),
      room('Main Bathroom', 'bathroom'), room('Laundry', 'laundry'), room('Balcony', 'outdoor'),
      room('Storeroom', 'storage'), room('Car Bay', 'garage'), room('Security & Safety', 'safety'),
    ],
  },
  {
    id: 'commercial-office',
    name: 'Commercial Office',
    description: 'Office premises including work areas, amenities, services and safety systems.',
    propertyUse: 'commercial',
    physicalPropertyTypes: ['office', 'medical_consulting', 'mixed_commercial'],
    rooms: [
      room('External Entry / Façade', 'outdoor'), room('Reception', 'office'), room('Open Office', 'office'),
      room('Private Offices', 'office'), room('Meeting Rooms', 'office'), room('Kitchenette', 'kitchen'),
      room('Amenities', 'amenities'), room('Server / Communications Room', 'plant'), room('Storage', 'storage'),
      room('HVAC & Mechanical Services', 'plant'), room('Electrical & Lighting', 'plant'),
      room('Fire & Safety Systems', 'safety'), room('Car Parking', 'garage'),
    ],
  },
  {
    id: 'commercial-retail',
    name: 'Retail Premises',
    description: 'Retail/shopfront inspection structure covering customer, back-of-house and service areas.',
    propertyUse: 'retail',
    physicalPropertyTypes: ['retail_shop', 'showroom', 'hospitality', 'restaurant_cafe'],
    rooms: [
      room('Shopfront & Signage', 'retail'), room('Customer / Sales Area', 'retail'),
      room('Point of Sale / Counter', 'retail'), room('Display Fixtures', 'retail'), room('Storeroom', 'storage'),
      room('Office', 'office'), room('Kitchen / Preparation Area', 'kitchen'), room('Amenities', 'amenities'),
      room('HVAC & Mechanical Services', 'plant'), room('Electrical & Lighting', 'plant'),
      room('Fire & Safety Systems', 'safety'), room('External Areas', 'outdoor'),
    ],
  },
  {
    id: 'industrial-warehouse',
    name: 'Warehouse / Industrial',
    description: 'Industrial premises with warehouse, loading, external yard, services and safety areas.',
    propertyUse: 'industrial',
    physicalPropertyTypes: ['warehouse', 'industrial_unit'],
    rooms: [
      room('Warehouse Floor', 'warehouse'), room('Loading Area', 'warehouse'), room('Roller Doors', 'warehouse'),
      room('Offices', 'office'), room('Amenities', 'amenities'), room('Mezzanine', 'storage', 'Mezzanine'),
      room('Racking / Storage', 'storage'), room('External Yard', 'outdoor'), room('Boundary Fencing', 'outdoor'),
      room('Car Parking', 'garage'), room('Electrical & Lighting', 'plant'), room('Fire & Safety Equipment', 'safety'),
    ],
  },
  {
    id: 'strata-common-property',
    name: 'Strata Common Property',
    description: 'Shared building and common-property layout for strata inspection and maintenance records.',
    propertyUse: 'strata_common_property',
    physicalPropertyTypes: ['common_property'],
    rooms: [
      room('Building Entry', 'hallway', 'Ground Floor', 'common_property'),
      room('Lobby / Common Hallways', 'hallway', 'Ground Floor', 'common_property'),
      room('Lifts / Lift Lobby', 'plant', 'Ground Floor', 'common_property'),
      room('Stairwells', 'hallway', 'Ground Floor', 'common_property'),
      room('Common Amenities', 'amenities', 'Ground Floor', 'common_property'),
      room('Car Park', 'garage', 'Basement', 'common_property'),
      room('Common Storage', 'storage', 'Basement', 'common_property'),
      room('External Walls & Grounds', 'outdoor', 'External', 'common_property'),
      room('Plant & Services', 'plant', 'Plant', 'common_property'),
      room('Fire & Safety Systems', 'safety', 'Common', 'common_property'),
    ],
  },
];

export function templatesForProperty(property: Pick<PropertyRecord, 'propertyUse' | 'physicalPropertyType'>): PropertyLayoutTemplate[] {
  return PROPERTY_LAYOUT_TEMPLATES.filter((template) => {
    const useMatch = !property.propertyUse || template.propertyUse === property.propertyUse;
    const typeMatch = !property.physicalPropertyType || template.physicalPropertyTypes.includes(property.physicalPropertyType);
    return useMatch && typeMatch;
  });
}

export function roomsFromTemplate(template: PropertyLayoutTemplate): RoomConfigItem[] {
  return template.rooms.map((candidate, index) => ({
    id: `area-${generateId()}`,
    name: candidate.name,
    roomType: candidate.roomType,
    floorLevel: candidate.floorLevel,
    responsibility: candidate.responsibility,
    notes: '',
    itemsPreset: [],
    ...(index === 0 ? {} : {}),
  }));
}

export function hierarchyFromRooms(rooms: RoomConfigItem[]): PropertyLayoutNode[] {
  const nodes: PropertyLayoutNode[] = [];
  const buildingId = 'building-main';
  nodes.push({ id: buildingId, name: 'Main Building', kind: 'building', parentId: 'site', order: 0 });
  nodes.push({ id: 'site', name: 'Property Site', kind: 'site', order: 0 });

  const levelIds = new Map<string, string>();
  for (const [index, configuredRoom] of rooms.entries()) {
    const level = configuredRoom.floorLevel || 'Ground Floor';
    let levelId = levelIds.get(level);
    if (!levelId) {
      levelId = `level-${level.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${levelIds.size + 1}`;
      levelIds.set(level, levelId);
      nodes.push({ id: levelId, name: level, kind: 'level', parentId: buildingId, floorLevel: level, order: levelIds.size });
    }
    nodes.push({
      id: configuredRoom.id,
      name: configuredRoom.name,
      kind: 'area',
      parentId: configuredRoom.parentAreaId || levelId,
      roomType: configuredRoom.roomType,
      floorLevel: configuredRoom.floorLevel,
      responsibility: configuredRoom.responsibility,
      notes: configuredRoom.notes,
      itemsPreset: configuredRoom.itemsPreset,
      order: index,
    });
  }
  return nodes;
}

export function createLayoutVersion(
  property: PropertyRecord,
  roomsConfig: RoomConfigItem[],
  reason: string,
  templateId?: string,
): PropertyLayoutVersion {
  const current = property.layoutVersions || [];
  const now = new Date().toISOString();
  return {
    id: `layout-${generateId()}`,
    version: current.reduce((max, item) => Math.max(max, item.version), 0) + 1,
    label: `Property Layout Version ${current.length + 1}`,
    effectiveFrom: now,
    changeReason: reason.trim() || 'Property layout updated',
    templateId,
    nodes: hierarchyFromRooms(roomsConfig),
    roomsConfig: structuredClone(roomsConfig),
    createdAt: now,
  };
}

export function applyLayoutTemplate(
  property: PropertyRecord,
  template: PropertyLayoutTemplate,
  reason = `Applied ${template.name}`,
): Pick<PropertyRecord, 'layoutTemplateId' | 'roomsConfig' | 'layoutNodes' | 'layoutVersions' | 'currentLayoutVersionId'> {
  const roomsConfig = roomsFromTemplate(template);
  const version = createLayoutVersion(property, roomsConfig, reason, template.id);
  const previous = (property.layoutVersions || []).map((item) =>
    item.effectiveTo ? item : { ...item, effectiveTo: version.effectiveFrom },
  );
  return {
    layoutTemplateId: template.id,
    roomsConfig,
    layoutNodes: version.nodes,
    layoutVersions: [...previous, version],
    currentLayoutVersionId: version.id,
  };
}

export function cloneLayoutFromProperty(
  target: PropertyRecord,
  source: PropertyRecord,
): Pick<PropertyRecord, 'layoutTemplateId' | 'roomsConfig' | 'layoutNodes' | 'layoutVersions' | 'currentLayoutVersionId'> {
  const roomsConfig = (source.roomsConfig || []).map((item) => ({ ...structuredClone(item), id: `area-${generateId()}` }));
  const version = createLayoutVersion(target, roomsConfig, `Layout copied from ${source.address}`, source.layoutTemplateId);
  return {
    layoutTemplateId: source.layoutTemplateId,
    roomsConfig,
    layoutNodes: version.nodes,
    layoutVersions: [...(target.layoutVersions || []), version],
    currentLayoutVersionId: version.id,
  };
}
