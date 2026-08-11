import type { PropertyRecord, RoomType, PropertyFeatures } from '../../types/platform';
import type { InspectionItem, ReportData, Room } from '../../types';
import { pcrStandardAreas, type TemplateArea } from '@pcr/templates';
import { generateId } from '../../utils';

export function isOperationalItem(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.includes('switch') ||
    lower.includes('outlet') ||
    lower.includes('power') ||
    lower.includes('fan') ||
    lower.includes('oven') ||
    lower.includes('cooktop') ||
    lower.includes('grill') ||
    lower.includes('rangehood') ||
    lower.includes('dishwasher') ||
    lower.includes('air cond') ||
    lower.includes('heating') ||
    lower.includes('alarm') ||
    lower.includes('remote') ||
    lower.includes('reticulation') ||
    lower.includes('appliance') ||
    lower.includes('light fitting') ||
    lower.includes('heat lamp') ||
    lower.includes('exhaust') ||
    lower.includes('intercom') ||
    lower.includes('door motor') ||
    lower.includes('hot water') ||
    lower.includes('tap')
  );
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function createSeededItem(name: string, stableId?: string): InspectionItem {
  const operational = isOperationalItem(name);
  return {
    id: stableId?.trim() || slug(name) || generateId(),
    name,
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

function findAreaById(id: string): TemplateArea | undefined {
  return pcrStandardAreas.find((area) => area.id === id);
}

function resolveCanonicalArea(roomType?: RoomType | string, roomName = ''): TemplateArea | undefined {
  const lowerType = (roomType || '').toLowerCase();
  const lowerName = roomName.toLowerCase();

  if (lowerName.includes('exterior front')) return findAreaById('exterior-front');
  if (lowerName.includes('exterior back') || lowerName.includes('rear exterior')) return findAreaById('exterior-back');
  if (lowerName.includes('security') || lowerType === 'security') return findAreaById('security-safety');
  if (lowerName.includes('general external')) return findAreaById('general-external-items');
  if (lowerName.includes('lounge / dining') || lowerName.includes('living & dining')) return findAreaById('lounge-dining-room');
  if (lowerType === 'kitchen' || lowerName.includes('kitchen')) return findAreaById('kitchen');
  if (lowerName.includes('ensuite')) return findAreaById('ensuite');
  if (lowerType === 'bathroom' || lowerName.includes('bathroom')) return findAreaById('bathroom');
  if (lowerName.includes('toilet') || lowerName.includes('wc') || lowerName.includes('powder')) return findAreaById('toilet-wc');
  if (lowerType === 'bedroom' || lowerName.includes('bedroom') || lowerName.includes('master bed') || lowerName.includes('main bedroom')) return findAreaById('bedroom');
  if (lowerName.includes('study')) return findAreaById('study');
  if (lowerName.includes('activity')) return findAreaById('activity-room');
  if (lowerType === 'laundry' || lowerName.includes('laundry')) return findAreaById('laundry');
  if (lowerType === 'garage' || lowerName.includes('garage') || lowerName.includes('carport')) return findAreaById('garage-carport');
  if (lowerName.includes('entry')) return findAreaById('entry');
  if (lowerName.includes('hallway') || lowerName.includes('passage')) return findAreaById('passage-hallway');
  if (lowerName.includes('linen')) return findAreaById('linen-press');
  if (lowerType === 'dining' || lowerName.includes('dining')) return findAreaById('dining-room');
  if (lowerName.includes('family')) return findAreaById('family-room');
  if (lowerType === 'living' || lowerName.includes('living') || lowerName.includes('lounge')) return findAreaById('lounge-room');
  if (lowerName.includes('shed') || lowerName.includes('storage')) return findAreaById('garden-shed-external-storage');
  if (lowerType === 'outdoor' || lowerName.includes('outdoor') || lowerName.includes('courtyard') || lowerName.includes('balcony') || lowerName.includes('patio')) {
    return findAreaById('general-external-items');
  }

  return undefined;
}

export const getDefaultItemsForRoomType = (roomType?: RoomType | string, roomName = ''): InspectionItem[] => {
  const canonicalArea = resolveCanonicalArea(roomType, roomName);
  if (canonicalArea) {
    return canonicalArea.components.map((component) => createSeededItem(component.name, component.id));
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

function room(id: string, name: string, roomType?: RoomType | string, notes = ''): Room {
  return {
    id,
    name,
    status: 'draft',
    items: getDefaultItemsForRoomType(roomType, name),
    photos: [],
    overallComment: notes,
    isExpanded: true,
  };
}

export const seedRoomsFromProperty = (property: PropertyRecord): Room[] => {
  if (property.roomsConfig && property.roomsConfig.length > 0) {
    return property.roomsConfig.map((rm, index) => {
      const configuredId = rm.id?.trim();
      const stableAreaId = configuredId
        ? (configuredId.startsWith('room-') ? configuredId : `room-${configuredId}`)
        : `room-${slug(rm.name) || index + 1}`;
      return room(stableAreaId, rm.name, rm.roomType, rm.notes || '');
    });
  }

  const rooms: Room[] = [];

  rooms.push(room('area-entry', 'Entry', 'hallway'));
  rooms.push(room('area-passage-hallway', 'Passage / Hallway', 'hallway'));

  const livingCount = property.livingAreas || 1;
  for (let i = 1; i <= livingCount; i += 1) {
    const name = livingCount === 1 ? 'Lounge / Dining Room' : i === 1 ? 'Lounge Room' : `Family Room ${i - 1}`;
    rooms.push(room(`area-living-${i}`, name, 'living'));
  }

  rooms.push(room('area-kitchen', 'Kitchen', 'kitchen'));

  const bedCount = property.bedrooms || 3;
  for (let i = 1; i <= bedCount; i += 1) {
    const name = i === 1 ? 'Bedroom 1 / Main Bedroom' : `Bedroom ${i}`;
    rooms.push(room(`area-bedroom-${i}`, name, 'bedroom'));
  }

  const bathCount = property.bathrooms || 1;
  for (let i = 1; i <= bathCount; i += 1) {
    const name = bathCount > 1 && i === 1 ? 'Ensuite' : i === 1 ? 'Bathroom' : `Bathroom ${i}`;
    rooms.push(room(`area-bathroom-${i}`, name, i === 1 && bathCount > 1 ? 'ensuite' : 'bathroom'));
  }

  rooms.push(room('area-laundry', 'Laundry', 'laundry'));

  if (property.propertyType === 'apartment' || property.propertyType === 'unit') {
    rooms.push(room('area-external', 'Balcony / External', 'outdoor'));
  } else {
    rooms.push(room('area-exterior-front', 'Exterior Front', 'outdoor'));
    rooms.push(room('area-exterior-back', 'Exterior Back', 'outdoor'));
    rooms.push(room('area-general-external', 'General External Items', 'outdoor'));
  }

  if ((property.parking && property.parking > 0) || property.propertyType === 'house') {
    rooms.push(room('area-garage-carport', 'Garage / Carport', 'garage'));
  }

  rooms.push(room('area-security-safety', 'Security / Safety', 'security'));

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
  existingReport?: Partial<ReportData>
): ReportData => {
  const fullAddress = [
    property.address,
    property.suburb,
    property.state ? `${property.state} ${property.postcode || ''}`.trim() : property.postcode,
  ]
    .filter(Boolean)
    .join(', ');

  const seededRooms = seedRoomsFromProperty(property);
  const rooms = existingReport?.rooms && existingReport.rooms.length > 0
    ? existingReport.rooms
    : seededRooms;

  const featuresText = formatPropertyFeatures(property.features);
  const notesCombined = [property.notes, featuresText].filter(Boolean).join('\n');

  return {
    id: existingReport?.id || generateId(),
    agencyId: existingReport?.agencyId || property.agencyId,
    propertyId: property.id,
    inspectionJobId: existingReport?.inspectionJobId,
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
