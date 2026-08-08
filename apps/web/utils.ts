import heic2any from 'heic2any';

export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      } else {
        reject(new Error('Failed to convert file to base64'));
      }
    };
    reader.onerror = (error) => reject(error);
  });
};

const compressAndResizeImage = (file: File, maxWidth = 1600, quality = 0.7): Promise<File> => {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.src = objectUrl;

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
      } else if (height > maxWidth) {
        width = Math.round((width * maxWidth) / height);
        height = maxWidth;
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        resolve(file);
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(new File([blob], file.name.replace(/\.[^/.]+$/, '') + '.jpg', {
              type: 'image/jpeg',
              lastModified: Date.now(),
            }));
            return;
          }

          resolve(file);
        },
        'image/jpeg',
        quality,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    };
  });
};

export const processImageFile = async (file: File): Promise<File> => {
  const name = file.name.toLowerCase();
  const isHeic = file.type === 'image/heic' ||
    file.type === 'image/heif' ||
    name.endsWith('.heic') ||
    name.endsWith('.heif');

  if (isHeic) {
    try {
      const sourceBlob = new Blob([await file.arrayBuffer()], { type: 'image/heic' });
      const result = await heic2any({
        blob: sourceBlob,
        toType: 'image/jpeg',
        quality: 0.6,
      });

      const conversionBlob = Array.isArray(result) ? result[0] : result;
      const convertedFile = new File(
        [conversionBlob as BlobPart],
        file.name.replace(/\.(heic|heif)$/i, '.jpg'),
        { type: 'image/jpeg', lastModified: Date.now() },
      );

      return await compressAndResizeImage(convertedFile);
    } catch (error) {
      console.warn(`HEIC conversion failed for ${file.name}`, error);
      return file;
    }
  }

  if (file.type.startsWith('image/')) {
    try {
      return await compressAndResizeImage(file);
    } catch (error) {
      console.warn(`Image compression failed for ${file.name}`, error);
      return file;
    }
  }

  return file;
};

export const generateId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return Math.random().toString(36).slice(2, 11);
};

export const ROOM_DEFINITIONS: Record<string, string[]> = {
  "Entry / Hallway": [
    "Walls", "Doors", "Ceilings", "Windows", "Screens", "Blinds/Curtains", "Light Fittings", "Light Switches", "Power Points", "Skirting Boards", "Floor/Floor Coverings", "Other Fixtures (e.g. intercoms)"
  ],
  "Lounge / Living Room": [
    "Walls", "Doors", "Ceilings", "Windows", "Screens", "Blinds/Curtains", "Light Fittings", "Light Switches", "Power Points", "Skirting Boards", "Floor/Floor Coverings", "Air Conditioner (if fitted)", "TV/Power/Data Points", "Other Fixtures"
  ],
  "Family Room / Second Living": [
    "Walls", "Doors", "Ceilings", "Windows", "Screens", "Blinds/Curtains", "Light Fittings", "Light Switches", "Power Points", "Skirting Boards", "Floor/Floor Coverings", "Air Conditioner (if fitted)", "Other Fixtures"
  ],
  "Dining Room": [
    "Walls", "Doors", "Ceilings", "Windows", "Screens", "Blinds/Curtains", "Light Fittings", "Light Switches", "Power Points", "Skirting Boards", "Floor/Floor Coverings"
  ],
  "Kitchen / Meals Area": [
    "Walls", "Doors", "Ceilings", "Windows", "Screens", "Blinds/Curtains", "Light Fittings", "Light Switches", "Power Points", "Skirting Boards", "Floor/Floor Coverings", "Cupboards/Drawers", "Bench Tops/Tiling", "Sink/Taps", "Stove Top", "Oven/Griller", "Rangehood/Exhaust Fan", "Dishwasher", "Splashback", "Other Fixtures"
  ],
  "Bedrooms": [
    "Walls", "Doors", "Ceilings", "Windows", "Screens", "Blinds/Curtains", "Light Fittings", "Light Switches", "Power Points", "Skirting Boards", "Floor/Floor Coverings", "Wardrobe/Drawers/Shelves", "Air Conditioner (if fitted)", "Other Fixtures"
  ],
  "Ensuite": [
    "Walls", "Doors", "Ceilings", "Windows", "Screens", "Blinds/Curtains", "Light Fittings", "Light Switches", "Power Points", "Skirting Boards", "Floor/Floor Coverings", "Shower/Shower Screen", "Bath (if applicable)", "Wash Basin/Vanity", "Mirror/Cabinet", "Towel Rails/Holders", "Toilet", "Exhaust Fan", "Other Fixtures"
  ],
  "Bathroom": [
    "Walls", "Doors", "Ceilings", "Windows", "Screens", "Blinds/Curtains", "Light Fittings", "Light Switches", "Power Points", "Skirting Boards", "Floor/Floor Coverings", "Bath", "Shower/Shower Screen", "Wash Basin/Vanity", "Mirror/Cabinet", "Towel Rails/Holders", "Toilet (if included)", "Exhaust Fan", "Other Fixtures"
  ],
  "Toilet (Separate)": [
    "Walls", "Doors", "Ceilings", "Light Fittings", "Light Switches", "Power Points (if fitted)", "Skirting Boards", "Floor/Floor Coverings", "Toilet", "Wash Basin (if fitted)", "Exhaust Fan", "Other Fixtures"
  ],
  "Laundry": [
    "Walls", "Doors", "Ceilings", "Windows", "Screens", "Blinds/Curtains", "Light Fittings", "Light Switches", "Power Points", "Skirting Boards", "Floor/Floor Coverings", "Wash Tubs", "Cupboards/Shelving", "Taps", "Washing Machine/Dryer (if supplied)", "Other Fixtures"
  ],
  "Hallways / Corridors": [
    "Walls", "Doors", "Ceilings", "Light Fittings", "Light Switches", "Power Points", "Skirting Boards", "Floor/Floor Coverings"
  ],
  "Garage / Carport / Storeroom": [
    "Walls", "Doors", "Ceilings", "Light Fittings", "Light Switches", "Power Points", "Floor/Floor Coverings", "Storage Fixtures", "Roller Door/Remote", "Skirting/Baseboards", "Other Fixtures"
  ],
  "Balcony / Porch / Deck": [
    "Balustrades/Railings", "Ceilings (if covered)", "Walls", "Light Fittings", "Power Points", "Floor/Floor Coverings", "External Doors/Windows", "Railings", "Outdoor Furniture (if applicable)", "Other Fixtures"
  ],
  "External Walls / Exterior": [
    "Wall Surfaces (render, brick, cladding)", "Windows", "External Doors", "Paint/Finish", "Fascia/Trims", "Downpipes", "Gutters", "Awnings", "External Lighting", "Fixed External Fixtures (e.g. meters, taps)"
  ],
  "Paving / Pergola / Courtyard": [
    "Paved Areas", "Pergola Structure", "Roof Covering (if applicable)", "Posts/Supports", "Floor Surfaces", "External Lighting", "Power Points", "Gates/Fencing", "Other Fixtures"
  ],
  "Front Yard": [
    "Lawns", "Garden Beds", "Trees/Shrubs", "Edging", "Retaining Walls (front)", "Paths/Walkways to Entry", "Driveway (front portion)", "Front Fences/Gates", "Letterbox/Street Number", "External Taps/Hose", "Irrigation (if present)", "External Lighting", "Drainage/Surface Falls", "Other Fixtures"
  ],
  "Back Yard": [
    "Lawns", "Garden Beds", "Trees/Shrubs", "Edging", "Retaining Walls (rear)", "Paving/Concrete Areas", "Pergola/Patio Structures", "Clothes Line", "Rear Fences/Gates", "External Taps/Hose", "Irrigation (if present)", "External Lighting", "Drainage/Surface Falls", "Pool/Equipment (if applicable)", "Shed (if located at rear)", "Other Fixtures"
  ],
  "Pool Area": [
    "Pool Fencing/Gates", "Gate Latches (Safety Compliance)", "CPR Signage", "Water Clarity", "Pool Surface/Tiles/Liner", "Coping/Surrounds", "Pump/Filter Equipment", "Cleaning Equipment", "Skimmer Box", "External Lighting", "Other Fixtures"
  ],
  "Grounds / Garden / General Yard": [
    "Lawns", "Garden Beds", "Trees/Shrubs", "Retaining Walls", "Edging", "Paving/Paths", "Irrigation System", "External Taps/Hose", "Outdoor Lighting", "Drainage", "Other External Fixtures"
  ],
  "Fences / Gates (Overall)": [
    "Fence Panels", "Posts", "Gates", "Hinges", "Latches", "Locks", "Alignment/Lean", "Structural Stability", "Paint/Finish"
  ],
  "Clothes Line Area": [
    "Clothes Line", "Posts/Mounts", "Line Condition", "Rotary/Tension Mechanisms", "Surface Under Line (paving/grass)", "Accessibility"
  ],
  "Shed (if applicable)": [
    "Structure", "Roof", "Walls", "Door/Lock", "Floor", "Ventilation", "Shelving/Storage Fixtures", "Lighting/Power (if installed)"
  ],
  "Driveway / Paths (Overall)": [
    "Surface Integrity", "Cracking/Wear", "Potholes/Depressions", "Edges", "Drainage/Runoff", "Staining/Oil Marks", "Accessibility/Clearance"
  ],
  "General (Safety & Compliance)": [
    "Smoke Alarms", "Security Devices (locks, alarms)", "Electrical Safety Switches", "Hot Water System", "Keys/Locks/Remotes", "Staircases/Railings (internal & external)", "Wheelie & Recycle Bins", "Pool/Equipment (if applicable)", "Solar Panels", "NBN/Internet Box", "Other Safety/Service Fixtures"
  ]
};

export const ROOM_TYPES = Object.keys(ROOM_DEFINITIONS);

export const getInitialItemsForRoom = (roomType: string): string[] => {
  if (ROOM_DEFINITIONS[roomType]) {
    return [...ROOM_DEFINITIONS[roomType]];
  }

  const lowerName = roomType.toLowerCase();

  if (lowerName.includes('kitchen') || lowerName.includes('meals')) return [...ROOM_DEFINITIONS['Kitchen / Meals Area']];
  if (lowerName.includes('ensuite')) return [...ROOM_DEFINITIONS['Ensuite']];
  if (lowerName.includes('bath')) return [...ROOM_DEFINITIONS['Bathroom']];
  if (lowerName.includes('laundry')) return [...ROOM_DEFINITIONS['Laundry']];
  if (lowerName.includes('lounge') || lowerName.includes('living')) return [...ROOM_DEFINITIONS['Lounge / Living Room']];
  if (lowerName.includes('entry') || lowerName.includes('hall')) return [...ROOM_DEFINITIONS['Entry / Hallway']];
  if (lowerName.includes('bed')) return [...ROOM_DEFINITIONS['Bedrooms']];
  if (lowerName.includes('garage') || lowerName.includes('carport')) return [...ROOM_DEFINITIONS['Garage / Carport / Storeroom']];
  if (lowerName.includes('front')) return [...ROOM_DEFINITIONS['Front Yard']];
  if (lowerName.includes('back') || lowerName.includes('rear')) return [...ROOM_DEFINITIONS['Back Yard']];
  if (lowerName.includes('courtyard') || lowerName.includes('patio')) return [...ROOM_DEFINITIONS['Paving / Pergola / Courtyard']];
  if (lowerName.includes('pool')) return [...ROOM_DEFINITIONS['Pool Area']];

  return [...ROOM_DEFINITIONS['Entry / Hallway']];
};
