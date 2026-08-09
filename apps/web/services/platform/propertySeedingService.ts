import type { PropertyRecord, RoomType, PropertyFeatures } from '../../types/platform';
import type { InspectionItem, ReportData, Room } from '../../types';
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
    lower.includes('light fixture') ||
    lower.includes('heat lamp') ||
    lower.includes('exhaust') ||
    lower.includes('intercom')
  );
}

export function createSeededItem(name: string): InspectionItem {
  const operational = isOperationalItem(name);
  return {
    id: generateId(),
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

export const getDefaultItemsForRoomType = (roomType?: RoomType | string, roomName: string = ''): InspectionItem[] => {
  const lowerType = (roomType || '').toLowerCase();
  const lowerName = roomName.toLowerCase();

  let itemNames: string[] = [];

  if (lowerType === 'kitchen' || lowerName.includes('kitchen')) {
    itemNames = [
      'Doors, Drawers & Handles',
      'Walls, Skirting & Splashback',
      'Benchtops & Sink / Taps',
      'Oven, Grill & Cooktop',
      'Rangehood & Filters',
      'Dishwasher (if fitted)',
      'Flooring / Tiles',
      'Light Switches & Outlets',
      'Ceiling & Exhaust',
    ];
  } else if (lowerType === 'bathroom' || lowerName.includes('bathroom') || lowerName.includes('ensuite') || lowerName.includes('toilet') || lowerName.includes('powder')) {
    itemNames = [
      'Door, Lock & Towel Rails',
      'Walls, Tiles & Grouting',
      'Vanity, Basin & Mirror',
      'Shower Screen, Recess & Taps',
      'Bath Tub (if fitted)',
      'Toilet Suite, Seat & Roll Holder',
      'Flooring / Tiles',
      'Exhaust Fan & Heat Lamps',
      'Light Switches & Fixtures',
    ];
  } else if (lowerType === 'bedroom' || lowerName.includes('bedroom') || lowerName.includes('bed')) {
    itemNames = [
      'Entry Door, Handle & Lock',
      'Walls, Skirting & Cornices',
      'Windows, Screens & Blinds/Curtains',
      'Flooring / Carpet',
      'Built-in Robes, Doors & Shelves',
      'Light Switches & Power Outlets',
      'Ceiling & Ceiling Fan/A/C',
    ];
  } else if (lowerType === 'living' || lowerType === 'dining' || lowerName.includes('living') || lowerName.includes('lounge') || lowerName.includes('dining') || lowerName.includes('family')) {
    itemNames = [
      'Doors, Handles & Screen Doors',
      'Walls, Skirting & Picture Rails',
      'Windows, Screens & Window Coverings',
      'Flooring / Timber / Carpet',
      'Light Switches & Power Outlets',
      'Air Conditioner / Heating Unit',
      'Ceiling, Light Fixtures & Fan',
    ];
  } else if (lowerType === 'laundry' || lowerName.includes('laundry')) {
    itemNames = [
      'Door & Screen Door',
      'Walls, Tiles & Skirting',
      'Laundry Tub, Taps & Cabinet',
      'Washing Machine Taps & Waste',
      'Flooring / Floor Drain',
      'Light Switch & Power Points',
    ];
  } else if (lowerType === 'outdoor' || lowerType === 'garage' || lowerName.includes('patio') || lowerName.includes('balcony') || lowerName.includes('garage') || lowerName.includes('garden')) {
    itemNames = [
      'Paved / Concrete Floor / Decking',
      'Walls, Fascia & Gutters',
      'Garage Door / Gates & Remotes',
      'Outdoor Lighting & Power Outlets',
      'Lawn, Garden Beds & Reticulation',
      'Fencing & Gates',
    ];
  } else {
    itemNames = [
      'Entry Door, Handle & Locks',
      'Walls, Skirting & Painting',
      'Windows, Screens & Coverings',
      'Flooring Condition',
      'Light Switches & Power Outlets',
      'Ceiling & Light Fixtures',
    ];
  }

  return itemNames.map((name) => createSeededItem(name));
};

export const seedRoomsFromProperty = (property: PropertyRecord): Room[] => {
  // If property has configured rooms in roomsConfig, use them
  if (property.roomsConfig && property.roomsConfig.length > 0) {
    return property.roomsConfig.map((rm) => ({
      id: rm.id ? (rm.id.startsWith('room-') ? rm.id : `room-${rm.id}`) : generateId(),
      name: rm.name,
      status: 'draft',
      items: getDefaultItemsForRoomType(rm.roomType, rm.name),
      photos: [],
      overallComment: rm.notes || '',
      isExpanded: true,
    }));
  }

  // Otherwise generate dynamic rooms based on property counts
  const rooms: Room[] = [];

  // Entry / Hallway
  rooms.push({
    id: generateId(),
    name: 'Entry / Hallway',
    status: 'draft',
    items: getDefaultItemsForRoomType('hallway', 'Entry / Hallway'),
    photos: [],
    overallComment: '',
    isExpanded: true,
  });

  // Living Areas
  const livingCount = property.livingAreas || 1;
  for (let i = 1; i <= livingCount; i += 1) {
    const name = livingCount === 1 ? 'Living & Dining Room' : i === 1 ? 'Main Living Room' : `Family / Lounge Room ${i}`;
    rooms.push({
      id: generateId(),
      name,
      status: 'draft',
      items: getDefaultItemsForRoomType('living', name),
      photos: [],
      overallComment: '',
      isExpanded: true,
    });
  }

  // Kitchen
  rooms.push({
    id: generateId(),
    name: 'Kitchen',
    status: 'draft',
    items: getDefaultItemsForRoomType('kitchen', 'Kitchen'),
    photos: [],
    overallComment: '',
    isExpanded: true,
  });

  // Bedrooms
  const bedCount = property.bedrooms || 3;
  for (let i = 1; i <= bedCount; i += 1) {
    const name = i === 1 ? 'Master Bedroom' : `Bedroom ${i}`;
    rooms.push({
      id: generateId(),
      name,
      status: 'draft',
      items: getDefaultItemsForRoomType('bedroom', name),
      photos: [],
      overallComment: '',
      isExpanded: true,
    });
  }

  // Bathrooms
  const bathCount = property.bathrooms || 1;
  for (let i = 1; i <= bathCount; i += 1) {
    const name = bathCount > 1 && i === 1 ? 'Ensuite Bathroom' : i === 1 ? 'Main Bathroom' : `Bathroom ${i}`;
    rooms.push({
      id: generateId(),
      name,
      status: 'draft',
      items: getDefaultItemsForRoomType('bathroom', name),
      photos: [],
      overallComment: '',
      isExpanded: true,
    });
  }

  // Laundry
  rooms.push({
    id: generateId(),
    name: 'Laundry',
    status: 'draft',
    items: getDefaultItemsForRoomType('laundry', 'Laundry'),
    photos: [],
    overallComment: '',
    isExpanded: true,
  });

  // Outdoor
  rooms.push({
    id: generateId(),
    name: property.propertyType === 'apartment' || property.propertyType === 'unit' ? 'Balcony / Patio' : 'Outdoor & Courtyard',
    status: 'draft',
    items: getDefaultItemsForRoomType('outdoor', 'Outdoor'),
    photos: [],
    overallComment: '',
    isExpanded: true,
  });

  // Garage / Parking
  if ((property.parking && property.parking > 0) || property.propertyType === 'house') {
    rooms.push({
      id: generateId(),
      name: 'Garage / Carport',
      status: 'draft',
      items: getDefaultItemsForRoomType('garage', 'Garage / Carport'),
      photos: [],
      overallComment: '',
      isExpanded: true,
    });
  }

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

  // If existing report already has user-modified rooms, preserve them if present, or combine
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
