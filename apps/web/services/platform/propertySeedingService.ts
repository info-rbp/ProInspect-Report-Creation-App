import type { PropertyRecord, RoomType, PropertyFeatures } from '../../types/platform';
import type { InspectionItem, ReportData, Room } from '../../types';
import { generateId } from '../../utils';

export const getDefaultItemsForRoomType = (roomType?: RoomType | string, roomName: string = ''): InspectionItem[] => {
  const lowerType = (roomType || '').toLowerCase();
  const lowerName = roomName.toLowerCase();

  if (lowerType === 'kitchen' || lowerName.includes('kitchen')) {
    return [
      { id: generateId(), name: 'Doors, Drawers & Handles', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
      { id: generateId(), name: 'Walls, Skirting & Splashback', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
      { id: generateId(), name: 'Benchtops & Sink / Taps', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
      { id: generateId(), name: 'Oven, Grill & Cooktop', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
      { id: generateId(), name: 'Rangehood & Filters', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
      { id: generateId(), name: 'Dishwasher (if fitted)', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
      { id: generateId(), name: 'Flooring / Tiles', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
      { id: generateId(), name: 'Light Switches & Outlets', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
      { id: generateId(), name: 'Ceiling & Exhaust', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
    ];
  }

  if (lowerType === 'bathroom' || lowerName.includes('bathroom') || lowerName.includes('ensuite') || lowerName.includes('toilet') || lowerName.includes('powder')) {
    return [
      { id: generateId(), name: 'Door, Lock & Towel Rails', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
      { id: generateId(), name: 'Walls, Tiles & Grouting', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
      { id: generateId(), name: 'Vanity, Basin & Mirror', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
      { id: generateId(), name: 'Shower Screen, Recess & Taps', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
      { id: generateId(), name: 'Bath Tub (if fitted)', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
      { id: generateId(), name: 'Toilet Suite, Seat & Roll Holder', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
      { id: generateId(), name: 'Flooring / Tiles', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
      { id: generateId(), name: 'Exhaust Fan & Heat Lamps', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
      { id: generateId(), name: 'Light Switches & Fixtures', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
    ];
  }

  if (lowerType === 'bedroom' || lowerName.includes('bedroom') || lowerName.includes('bed')) {
    return [
      { id: generateId(), name: 'Entry Door, Handle & Lock', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
      { id: generateId(), name: 'Walls, Skirting & Cornices', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
      { id: generateId(), name: 'Windows, Screens & Blinds/Curtains', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
      { id: generateId(), name: 'Flooring / Carpet', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
      { id: generateId(), name: 'Built-in Robes, Doors & Shelves', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
      { id: generateId(), name: 'Light Switches & Power Outlets', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
      { id: generateId(), name: 'Ceiling & Ceiling Fan/A/C', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
    ];
  }

  if (lowerType === 'living' || lowerType === 'dining' || lowerName.includes('living') || lowerName.includes('lounge') || lowerName.includes('dining') || lowerName.includes('family')) {
    return [
      { id: generateId(), name: 'Doors, Handles & Screen Doors', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
      { id: generateId(), name: 'Walls, Skirting & Picture Rails', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
      { id: generateId(), name: 'Windows, Screens & Window Coverings', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
      { id: generateId(), name: 'Flooring / Timber / Carpet', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
      { id: generateId(), name: 'Light Switches & Power Outlets', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
      { id: generateId(), name: 'Air Conditioner / Heating Unit', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
      { id: generateId(), name: 'Ceiling, Light Fixtures & Fan', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
    ];
  }

  if (lowerType === 'laundry' || lowerName.includes('laundry')) {
    return [
      { id: generateId(), name: 'Door & Screen Door', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
      { id: generateId(), name: 'Walls, Tiles & Skirting', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
      { id: generateId(), name: 'Laundry Tub, Taps & Cabinet', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
      { id: generateId(), name: 'Washing Machine Taps & Waste', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
      { id: generateId(), name: 'Flooring / Floor Drain', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
      { id: generateId(), name: 'Light Switch & Power Points', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
    ];
  }

  if (lowerType === 'outdoor' || lowerType === 'garage' || lowerName.includes('patio') || lowerName.includes('balcony') || lowerName.includes('garage') || lowerName.includes('garden')) {
    return [
      { id: generateId(), name: 'Paved / Concrete Floor / Decking', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
      { id: generateId(), name: 'Walls, Fascia & Gutters', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
      { id: generateId(), name: 'Garage Door / Gates & Remotes', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
      { id: generateId(), name: 'Outdoor Lighting & Power Outlets', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
      { id: generateId(), name: 'Lawn, Garden Beds & Reticulation', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
      { id: generateId(), name: 'Fencing & Gates', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
    ];
  }

  // Generic room / area items
  return [
    { id: generateId(), name: 'Entry Door, Handle & Locks', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
    { id: generateId(), name: 'Walls, Skirting & Painting', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
    { id: generateId(), name: 'Windows, Screens & Coverings', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
    { id: generateId(), name: 'Flooring Condition', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
    { id: generateId(), name: 'Light Switches & Power Outlets', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
    { id: generateId(), name: 'Ceiling & Light Fixtures', isClean: true, isUndamaged: true, isWorking: true, comment: '' },
  ];
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
