import type {
  InspectionType,
  PhysicalPropertyType,
  PropertyUse,
  RoomType,
} from '@pcr/domain';
import {
  CANONICAL_AREA_COMPONENT_RULES,
  CANONICAL_AREA_DEFINITIONS,
  CANONICAL_COMPONENT_DEFINITIONS,
  type AreaCategory,
  type AreaComponentInclusion,
  type AreaComponentRule,
  type AreaDefinition,
  type CatalogueApplicability,
  type ComponentCategory,
  type ComponentDefinition,
} from './canonicalCatalogue.js';

export const PROPERTY_LAYOUT_CATALOGUE_ID = 'proinspect-property-layout-catalogue';
export const PROPERTY_LAYOUT_CATALOGUE_VERSION = 1;
const CREATED_AT = '2026-08-22T04:30:00.000Z';
const INSPECTION_TYPES: InspectionType[] = ['entry', 'routine', 'exit', 'comparison', 'maintenance'];

export type SystemCatalogueSource = 'system_property_layouts';

export interface SystemAreaDefinition extends Omit<AreaDefinition, 'source'> {
  source: SystemCatalogueSource;
}

export interface SystemComponentDefinition extends Omit<ComponentDefinition, 'source'> {
  source: SystemCatalogueSource;
}

export interface SystemAreaComponentRule extends Omit<AreaComponentRule, 'source'> {
  source: SystemCatalogueSource;
  componentDefinitionVersion: number;
}

export type SystemAreaDefinitionVersion = AreaDefinition | SystemAreaDefinition;
export type SystemComponentDefinitionVersion = ComponentDefinition | SystemComponentDefinition;
export type SystemAreaComponentRuleVersion = AreaComponentRule | SystemAreaComponentRule;

export interface ResolvedAreaComponentRule extends Omit<AreaComponentRule, 'source'> {
  source: 'legacy_pcr_standard_areas' | SystemCatalogueSource;
  componentDefinitionVersion: number;
}

export interface CanonicalPropertyLayoutRoom {
  name: string;
  roomType: RoomType;
  canonicalAreaDefinitionId: string;
  canonicalAreaDefinitionVersion: number;
  floorLevel?: string;
  responsibility?: 'lot' | 'common_property' | 'exclusive_use' | 'shared' | 'unknown';
  physicalPropertyTypes?: PhysicalPropertyType[];
}

export interface CanonicalPropertyLayoutTemplate {
  id: string;
  name: string;
  description: string;
  /** Primary use retained for current browser compatibility. */
  propertyUse: PropertyUse;
  /** All uses for which this template is a supported starting point. */
  propertyUses: PropertyUse[];
  physicalPropertyTypes: PhysicalPropertyType[];
  rooms: CanonicalPropertyLayoutRoom[];
  furnished?: boolean;
}

interface ComponentSpec {
  id: string;
  name?: string;
  category?: ComponentCategory;
  inclusion?: AreaComponentInclusion;
  photoRequired?: boolean;
  aliases?: string[];
}

interface AreaSpec {
  id: string;
  name: string;
  category: AreaCategory;
  aliases?: string[];
  repeatable?: boolean;
  applicability: CatalogueApplicability;
  components: ComponentSpec[];
}

const app = (
  propertyUses: PropertyUse[],
  physicalPropertyTypes: PhysicalPropertyType[],
): CatalogueApplicability => ({
  propertyUses,
  physicalPropertyTypes,
  inspectionTypes: [...INSPECTION_TYPES],
});

const RESIDENTIAL_APARTMENT_TYPES: PhysicalPropertyType[] = [
  'apartment', 'unit', 'studio', 'townhouse', 'retirement_supported',
];
const COMMERCIAL_TYPES: PhysicalPropertyType[] = [
  'office', 'medical_consulting', 'childcare', 'mixed_commercial',
];
const RETAIL_TYPES: PhysicalPropertyType[] = [
  'retail_shop', 'showroom', 'hospitality', 'restaurant_cafe',
];
const INDUSTRIAL_TYPES: PhysicalPropertyType[] = ['warehouse', 'industrial_unit'];
const STRATA_TYPES: PhysicalPropertyType[] = ['common_property'];

const c = (
  id: string,
  name?: string,
  category?: ComponentCategory,
  inclusion: AreaComponentInclusion = 'default',
  photoRequired = false,
  aliases: string[] = [],
): ComponentSpec => ({ id, name, category, inclusion, photoRequired, aliases });

const RES_APT = app(['residential'], RESIDENTIAL_APARTMENT_TYPES);
const COMMERCIAL = app(['commercial', 'mixed_use'], COMMERCIAL_TYPES);
const RETAIL = app(['retail', 'commercial', 'mixed_use'], RETAIL_TYPES);
const INDUSTRIAL = app(['industrial', 'commercial'], INDUSTRIAL_TYPES);
const STRATA = app(['strata_common_property'], STRATA_TYPES);

/**
 * Areas absent from the original residential PCR preset. These are first-class
 * system definitions, not display-name aliases for unrelated residential Areas.
 */
const AREA_SPECS: AreaSpec[] = [
  {
    id: 'balcony-courtyard', name: 'Balcony / Courtyard', category: 'external', repeatable: true,
    aliases: ['Balcony', 'Courtyard', 'Patio', 'Private Balcony', 'Rear Courtyard / Patio'], applicability: RES_APT,
    components: [
      c('door-to-exterior', undefined, undefined, 'default'), c('external-walls', undefined, undefined, 'required', true),
      c('floor-paving-concrete', undefined, undefined, 'required', true), c('balustrade-handrail', 'Balustrade / Handrail', 'building_fabric', 'required', true),
      c('drainage-outlets', 'Drainage / Outlets', 'plumbing'), c('light-fittings'), c('windows-screens'),
    ],
  },
  {
    id: 'storeroom', name: 'Storeroom', category: 'storage', repeatable: true,
    aliases: ['Storage Room', 'Store Room'], applicability: app(['residential'], ['apartment', 'unit', 'townhouse', 'studio', 'retirement_supported']),
    components: [
      c('doors-doorway-frames'), c('ceiling-cornices'), c('walls', undefined, undefined, 'required', true),
      c('light-fittings'), c('floor', undefined, undefined, 'required', true), c('shelving'), c('contents-stored-items'),
    ],
  },
  {
    id: 'car-bay', name: 'Car Bay', category: 'service', repeatable: true,
    aliases: ['Parking Bay', 'Allocated Car Bay'], applicability: app(['residential'], ['apartment', 'unit', 'townhouse', 'retirement_supported']),
    components: [
      c('floor', undefined, undefined, 'required', true), c('line-marking', 'Line Marking', 'external_site'),
      c('parking-signage', 'Parking Signage', 'external_site'), c('bollards-wheel-stops', 'Bollards / Wheel Stops', 'external_site'), c('light-fittings'),
    ],
  },
  {
    id: 'furniture-included-chattels', name: 'Furniture & Included Chattels', category: 'other',
    aliases: ['Furnishings', 'Furniture Inventory', 'Included Chattels'], applicability: app(['residential'], ['apartment', 'unit', 'studio', 'house', 'townhouse', 'villa', 'retirement_supported']),
    components: [
      c('furniture-lounge', 'Lounge Furniture', 'other', 'required', true), c('furniture-dining', 'Dining Furniture', 'other'),
      c('furniture-bedroom', 'Bedroom Furniture', 'other'), c('freestanding-appliances', 'Freestanding Appliances', 'appliance'),
      c('blinds-curtains'), c('inventory-completeness', 'Inventory Completeness', 'observation', 'required', true),
    ],
  },
  {
    id: 'internal-stairs-landing', name: 'Internal Stairs / Landing', category: 'circulation', repeatable: true,
    aliases: ['Stairs', 'Landing', 'Internal Stairwell'], applicability: app(['residential'], ['townhouse', 'house', 'duplex', 'retirement_supported']),
    components: [
      c('stairs-treads-risers', 'Stair Treads / Risers', 'building_fabric', 'required', true),
      c('balustrade-handrail', 'Balustrade / Handrail', 'building_fabric', 'required', true),
      c('walls', undefined, undefined, 'required', true), c('ceiling-cornices'), c('light-fittings'), c('floor-floorcoverings'),
    ],
  },

  // Commercial office / specialist commercial Areas.
  {
    id: 'commercial-external-entry-facade', name: 'External Entry / Façade', category: 'commercial', applicability: COMMERCIAL,
    components: [c('front-door', undefined, undefined, 'required', true), c('external-walls', undefined, undefined, 'required', true), c('shopfront-glazing', 'Entry Glazing', 'windows_glazing', 'required', true), c('business-signage', 'Building / Business Signage', 'external_site'), c('light-fittings'), c('floor-paving-concrete')],
  },
  {
    id: 'commercial-reception', name: 'Reception', category: 'commercial', applicability: COMMERCIAL,
    components: [c('doors-doorway-frames'), c('ceiling-cornices'), c('walls', undefined, undefined, 'required', true), c('light-fittings'), c('points-switches'), c('floor-floorcoverings', undefined, undefined, 'required', true), c('windows-screens'), c('air-conditioner'), c('reception-counter', 'Reception Counter', 'joinery', 'required', true)],
  },
  {
    id: 'commercial-open-office', name: 'Open Office', category: 'commercial', repeatable: true, applicability: COMMERCIAL,
    components: [c('doors-doorway-frames'), c('ceiling-cornices'), c('walls', undefined, undefined, 'required', true), c('light-fittings'), c('points-switches'), c('tv-data-telephone'), c('floor-floorcoverings', undefined, undefined, 'required', true), c('windows-screens'), c('air-conditioner'), c('fixed-workstations', 'Fixed Workstations', 'joinery'), c('partitioning', 'Partitions', 'building_fabric')],
  },
  {
    id: 'commercial-private-office', name: 'Private Office', category: 'commercial', repeatable: true, applicability: COMMERCIAL,
    components: [c('doors-doorway-frames'), c('ceiling-cornices'), c('walls', undefined, undefined, 'required', true), c('light-fittings'), c('points-switches'), c('tv-data-telephone'), c('floor-floorcoverings', undefined, undefined, 'required', true), c('windows-screens'), c('air-conditioner'), c('fixed-workstations', 'Fixed Workstations', 'joinery')],
  },
  {
    id: 'commercial-meeting-room', name: 'Meeting Room', category: 'commercial', repeatable: true, applicability: COMMERCIAL,
    components: [c('doors-doorway-frames'), c('ceiling-cornices'), c('walls', undefined, undefined, 'required', true), c('light-fittings'), c('points-switches'), c('tv-data-telephone'), c('floor-floorcoverings', undefined, undefined, 'required', true), c('windows-screens'), c('air-conditioner')],
  },
  {
    id: 'commercial-kitchenette', name: 'Kitchenette', category: 'kitchen', applicability: COMMERCIAL,
    components: [c('ceiling-cornices'), c('walls'), c('light-fittings'), c('points-switches'), c('floor-floorcoverings', undefined, undefined, 'required', true), c('bench-tops', undefined, undefined, 'required', true), c('sink-taps-spout', undefined, undefined, 'required', true), c('cupboards', undefined, undefined, 'required', true), c('drawers'), c('fridge-recess'), c('dishwasher')],
  },
  {
    id: 'commercial-amenities', name: 'Amenities', category: 'service', repeatable: true, applicability: COMMERCIAL,
    components: [c('doors-doorway-frames'), c('ceiling-cornices'), c('walls-tiles', undefined, undefined, 'required', true), c('light-fittings'), c('floor-tiles', undefined, undefined, 'required', true), c('basin-taps-spout-plug', undefined, undefined, 'required', true), c('toilet', undefined, undefined, 'required', true), c('mirror'), c('exhaust-fan-vent'), c('accessible-fixtures', 'Accessible Fixtures', 'plumbing')],
  },
  {
    id: 'server-communications-room', name: 'Server / Communications Room', category: 'service', applicability: COMMERCIAL,
    components: [c('doors-doorway-frames', undefined, undefined, 'required', true), c('walls'), c('floor'), c('light-fittings'), c('points-switches'), c('air-conditioner'), c('server-racks', 'Server Racks', 'storage', 'required', true), c('data-cabling-racks', 'Data / Communications Cabling', 'electrical'), c('ups-equipment', 'UPS / Backup Power', 'electrical'), c('fire-extinguishers', 'Fire Extinguishers', 'safety_security')],
  },
  {
    id: 'commercial-storage', name: 'Commercial Storage', category: 'storage', repeatable: true, applicability: COMMERCIAL,
    components: [c('doors-doorway-frames'), c('ceiling-cornices'), c('walls'), c('light-fittings'), c('floor'), c('shelving'), c('contents-stored-items')],
  },
  {
    id: 'hvac-mechanical-services', name: 'HVAC & Mechanical Services', category: 'service', applicability: app(['commercial', 'mixed_use', 'retail', 'industrial', 'strata_common_property'], [...COMMERCIAL_TYPES, ...RETAIL_TYPES, ...INDUSTRIAL_TYPES, ...STRATA_TYPES]),
    components: [c('mechanical-plant', 'Mechanical Plant', 'hvac', 'required', true), c('air-conditioning-motor'), c('ductwork-grilles', 'Ductwork / Grilles', 'hvac'), c('thermostat-controls', 'Thermostats / Controls', 'hvac'), c('drainage-outlets', 'Condensate / Drainage', 'plumbing')],
  },
  {
    id: 'electrical-lighting-services', name: 'Electrical & Lighting', category: 'service', applicability: app(['commercial', 'mixed_use', 'retail', 'industrial', 'strata_common_property'], [...COMMERCIAL_TYPES, ...RETAIL_TYPES, ...INDUSTRIAL_TYPES, ...STRATA_TYPES]),
    components: [c('switchboards', 'Switchboards', 'electrical', 'required', true), c('electrical-safety-switch', undefined, undefined, 'required', true), c('light-fittings', undefined, undefined, 'required', true), c('points-switches'), c('emergency-lighting', 'Emergency Lighting', 'safety_security')],
  },
  {
    id: 'fire-safety-systems', name: 'Fire & Safety Systems', category: 'safety', applicability: app(['commercial', 'mixed_use', 'retail', 'industrial'], [...COMMERCIAL_TYPES, ...RETAIL_TYPES, ...INDUSTRIAL_TYPES]),
    components: [c('fire-panel', 'Fire Indicator Panel', 'safety_security', 'required', true), c('exit-signage', 'Exit Signage', 'safety_security', 'required', true), c('emergency-lighting', 'Emergency Lighting', 'safety_security'), c('fire-extinguishers', 'Fire Extinguishers', 'safety_security', 'required', true), c('fire-hose-reels', 'Fire Hose Reels', 'safety_security'), c('sprinkler-heads', 'Sprinkler Heads', 'safety_security'), c('smoke-alarm')],
  },
  {
    id: 'commercial-car-parking', name: 'Car Parking', category: 'commercial', repeatable: true, applicability: app(['commercial', 'mixed_use'], COMMERCIAL_TYPES),
    components: [c('floor', undefined, undefined, 'required', true), c('line-marking', 'Line Marking', 'external_site'), c('parking-signage', 'Parking Signage', 'external_site'), c('bollards-wheel-stops', 'Bollards / Wheel Stops', 'external_site'), c('light-fittings'), c('drainage-outlets', 'Drainage', 'plumbing')],
  },

  // Retail / hospitality / showroom.
  {
    id: 'retail-shopfront-signage', name: 'Shopfront & Signage', category: 'commercial', applicability: RETAIL,
    components: [c('shopfront-glazing', 'Shopfront Glazing', 'windows_glazing', 'required', true), c('business-signage', 'Business Signage', 'external_site', 'required', true), c('front-door', undefined, undefined, 'required', true), c('door-handles-locks'), c('light-fittings')],
  },
  {
    id: 'retail-sales-area', name: 'Customer / Sales Area', category: 'commercial', applicability: RETAIL,
    components: [c('ceiling-cornices'), c('walls', undefined, undefined, 'required', true), c('light-fittings', undefined, undefined, 'required', true), c('points-switches'), c('floor-floorcoverings', undefined, undefined, 'required', true), c('air-conditioner'), c('display-fixtures', 'Display Fixtures', 'joinery')],
  },
  {
    id: 'retail-pos-counter', name: 'Point of Sale / Counter', category: 'commercial', applicability: RETAIL,
    components: [c('pos-counter', 'POS / Service Counter', 'joinery', 'required', true), c('points-switches'), c('tv-data-telephone'), c('cupboards'), c('drawers'), c('light-fittings')],
  },
  {
    id: 'retail-display-fixtures', name: 'Display Fixtures', category: 'commercial', applicability: RETAIL,
    components: [c('display-fixtures', 'Display Fixtures', 'joinery', 'required', true), c('shelving'), c('fixed-workstations', 'Fixed Joinery / Workstations', 'joinery'), c('light-fittings')],
  },
  {
    id: 'retail-storeroom', name: 'Retail Storeroom', category: 'storage', repeatable: true, applicability: RETAIL,
    components: [c('doors-doorway-frames'), c('ceiling-cornices'), c('walls'), c('light-fittings'), c('floor'), c('shelving', undefined, undefined, 'required', true), c('contents-stored-items')],
  },
  {
    id: 'retail-office', name: 'Retail Office', category: 'commercial', repeatable: true, applicability: RETAIL,
    components: [c('doors-doorway-frames'), c('ceiling-cornices'), c('walls'), c('light-fittings'), c('points-switches'), c('tv-data-telephone'), c('floor-floorcoverings'), c('air-conditioner'), c('fixed-workstations', 'Fixed Workstations', 'joinery')],
  },
  {
    id: 'retail-kitchen-preparation', name: 'Kitchen / Preparation Area', category: 'kitchen', applicability: RETAIL,
    components: [c('ceiling-cornices'), c('walls-tiles'), c('light-fittings'), c('points-switches'), c('floor-tiles', undefined, undefined, 'required', true), c('bench-tops', undefined, undefined, 'required', true), c('sink-taps-spout', undefined, undefined, 'required', true), c('cupboards'), c('drawers'), c('exhaust-fan-vent')],
  },
  {
    id: 'retail-amenities', name: 'Retail Amenities', category: 'service', applicability: RETAIL,
    components: [c('doors-doorway-frames'), c('walls-tiles'), c('light-fittings'), c('floor-tiles'), c('basin-taps-spout-plug'), c('toilet'), c('mirror'), c('exhaust-fan-vent'), c('accessible-fixtures', 'Accessible Fixtures', 'plumbing')],
  },
  {
    id: 'retail-external-areas', name: 'Retail External Areas', category: 'external', applicability: RETAIL,
    components: [c('external-walls', undefined, undefined, 'required', true), c('floor-paving-concrete'), c('business-signage', 'External Signage', 'external_site'), c('light-fittings'), c('drainage-outlets', 'Drainage', 'plumbing'), c('bins')],
  },
  {
    id: 'commercial-kitchen', name: 'Commercial Kitchen', category: 'kitchen', applicability: app(['retail', 'commercial'], ['hospitality', 'restaurant_cafe']),
    components: [c('commercial-cooking-equipment', 'Commercial Cooking Equipment', 'appliance', 'required', true), c('commercial-exhaust-canopy', 'Exhaust Canopy / Extraction', 'hvac', 'required', true), c('stainless-benches', 'Stainless Benches', 'joinery', 'required', true), c('sink-taps-spout'), c('floor-tiles', undefined, undefined, 'required', true), c('walls-tiles'), c('points-switches'), c('light-fittings'), c('grease-trap', 'Grease Trap / Waste', 'plumbing')],
  },
  {
    id: 'coolroom-refrigeration-area', name: 'Coolroom / Refrigeration', category: 'service', applicability: app(['retail', 'commercial'], ['hospitality', 'restaurant_cafe']),
    components: [c('coolroom-refrigeration', 'Coolroom / Refrigeration Plant', 'appliance', 'required', true), c('doors-doorway-frames', undefined, undefined, 'required', true), c('walls', undefined, undefined, 'required', true), c('floor', undefined, undefined, 'required', true), c('light-fittings'), c('drainage-outlets', 'Drainage', 'plumbing')],
  },
  {
    id: 'showroom-floor', name: 'Showroom Floor', category: 'commercial', applicability: app(['retail', 'commercial'], ['showroom']),
    components: [c('showroom-display-systems', 'Showroom Display Systems', 'joinery', 'required', true), c('walls', undefined, undefined, 'required', true), c('floor-floorcoverings', undefined, undefined, 'required', true), c('light-fittings', undefined, undefined, 'required', true), c('points-switches'), c('air-conditioner')],
  },

  // Warehouse / industrial.
  {
    id: 'warehouse-floor', name: 'Warehouse Floor', category: 'industrial', applicability: INDUSTRIAL,
    components: [c('warehouse-slab', 'Warehouse Slab / Floor', 'flooring', 'required', true), c('walls', undefined, undefined, 'required', true), c('roof-ceiling', undefined, undefined, 'required', true), c('light-fittings', undefined, undefined, 'required', true), c('points-switches')],
  },
  {
    id: 'warehouse-loading-area', name: 'Loading Area', category: 'industrial', applicability: INDUSTRIAL,
    components: [c('loading-dock', 'Loading Dock / Apron', 'external_site', 'required', true), c('loading-bay-markings', 'Loading Bay Markings', 'external_site'), c('roller-doors-shutters', 'Roller Doors / Shutters', 'door_access'), c('bollards-wheel-stops', 'Bollards / Wheel Stops', 'external_site'), c('yard-surface', 'Trafficable Surface', 'flooring'), c('light-fittings')],
  },
  {
    id: 'warehouse-roller-doors', name: 'Roller Doors', category: 'industrial', repeatable: true, applicability: INDUSTRIAL,
    components: [c('roller-doors-shutters', 'Roller Doors / Shutters', 'door_access', 'required', true), c('garage-door-motor'), c('opening-devices'), c('door-handles-locks')],
  },
  {
    id: 'warehouse-office', name: 'Warehouse Office', category: 'commercial', repeatable: true, applicability: INDUSTRIAL,
    components: [c('doors-doorway-frames'), c('ceiling-cornices'), c('walls'), c('light-fittings'), c('points-switches'), c('tv-data-telephone'), c('floor-floorcoverings'), c('air-conditioner'), c('fixed-workstations', 'Fixed Workstations', 'joinery')],
  },
  {
    id: 'warehouse-amenities', name: 'Warehouse Amenities', category: 'service', applicability: INDUSTRIAL,
    components: [c('doors-doorway-frames'), c('walls-tiles'), c('light-fittings'), c('floor-tiles'), c('basin-taps-spout-plug'), c('toilet'), c('mirror'), c('exhaust-fan-vent'), c('accessible-fixtures', 'Accessible Fixtures', 'plumbing')],
  },
  {
    id: 'warehouse-mezzanine', name: 'Mezzanine', category: 'industrial', repeatable: true, applicability: INDUSTRIAL,
    components: [c('mezzanine-structure', 'Mezzanine Structure', 'building_fabric', 'required', true), c('stairs-treads-risers', 'Stairs / Access', 'building_fabric', 'required', true), c('balustrade-handrail', 'Balustrade / Handrail', 'building_fabric', 'required', true), c('floor', undefined, undefined, 'required', true), c('light-fittings')],
  },
  {
    id: 'warehouse-racking-storage', name: 'Racking / Storage', category: 'industrial', repeatable: true, applicability: INDUSTRIAL,
    components: [c('racking', 'Storage Racking', 'storage', 'required', true), c('shelving'), c('floor'), c('light-fittings'), c('contents-stored-items')],
  },
  {
    id: 'warehouse-external-yard', name: 'External Yard', category: 'industrial', applicability: INDUSTRIAL,
    components: [c('yard-surface', 'Yard Surface', 'flooring', 'required', true), c('drainage-outlets', 'Stormwater / Drainage', 'plumbing'), c('boundary-fencing', 'Boundary Fencing', 'external_site', 'required', true), c('fence-gate'), c('light-fittings'), c('business-signage', 'Site Signage', 'external_site')],
  },
  {
    id: 'warehouse-boundary-fencing', name: 'Boundary Fencing', category: 'industrial', applicability: INDUSTRIAL,
    components: [c('boundary-fencing', 'Boundary Fencing', 'external_site', 'required', true), c('fence-gate', undefined, undefined, 'required', true), c('business-signage', 'Safety / Site Signage', 'external_site')],
  },
  {
    id: 'warehouse-car-parking', name: 'Warehouse Car Parking', category: 'industrial', applicability: INDUSTRIAL,
    components: [c('yard-surface', 'Parking Surface', 'flooring', 'required', true), c('line-marking', 'Line Marking', 'external_site'), c('parking-signage', 'Parking Signage', 'external_site'), c('bollards-wheel-stops', 'Bollards / Wheel Stops', 'external_site'), c('light-fittings'), c('drainage-outlets', 'Drainage', 'plumbing')],
  },

  // Strata / common property.
  {
    id: 'strata-building-entry', name: 'Building Entry', category: 'common_property', applicability: STRATA,
    components: [c('front-door', undefined, undefined, 'required', true), c('shopfront-glazing', 'Entry Glazing', 'windows_glazing'), c('access-control', 'Access Control', 'safety_security'), c('common-intercom', 'Intercom', 'safety_security'), c('walls', undefined, undefined, 'required', true), c('floor-floorcoverings', undefined, undefined, 'required', true), c('light-fittings')],
  },
  {
    id: 'strata-lobby-hallways', name: 'Lobby / Common Hallways', category: 'common_property', repeatable: true, applicability: STRATA,
    components: [c('doors-doorway-frames'), c('fire-doors', 'Fire Doors', 'safety_security', 'required', true), c('ceiling-cornices'), c('walls', undefined, undefined, 'required', true), c('floor-floorcoverings', undefined, undefined, 'required', true), c('light-fittings'), c('emergency-lighting', 'Emergency Lighting', 'safety_security'), c('exit-signage', 'Exit Signage', 'safety_security')],
  },
  {
    id: 'strata-lift-lobby', name: 'Lifts / Lift Lobby', category: 'common_property', repeatable: true, applicability: STRATA,
    components: [c('lift-car-doors', 'Lift Car / Doors', 'safety_security', 'required', true), c('lift-controls', 'Lift Controls / Indicators', 'electrical', 'required', true), c('walls'), c('floor-floorcoverings'), c('light-fittings'), c('emergency-lighting', 'Emergency Lighting', 'safety_security')],
  },
  {
    id: 'strata-stairwells', name: 'Stairwells', category: 'common_property', repeatable: true, applicability: STRATA,
    components: [c('stairs-treads-risers', 'Stair Treads / Risers', 'building_fabric', 'required', true), c('balustrade-handrail', 'Balustrade / Handrail', 'building_fabric', 'required', true), c('fire-doors', 'Fire Doors', 'safety_security'), c('walls'), c('light-fittings'), c('emergency-lighting', 'Emergency Lighting', 'safety_security'), c('exit-signage', 'Exit Signage', 'safety_security')],
  },
  {
    id: 'strata-common-amenities', name: 'Common Amenities', category: 'common_property', repeatable: true, applicability: STRATA,
    components: [c('doors-doorway-frames'), c('walls-tiles'), c('floor-tiles'), c('light-fittings'), c('basin-taps-spout-plug'), c('toilet'), c('mirror'), c('accessible-fixtures', 'Accessible Fixtures', 'plumbing'), c('exhaust-fan-vent')],
  },
  {
    id: 'strata-car-park', name: 'Common Car Park', category: 'common_property', applicability: STRATA,
    components: [c('yard-surface', 'Car Park Surface', 'flooring', 'required', true), c('line-marking', 'Line Marking', 'external_site'), c('parking-signage', 'Parking / Wayfinding Signage', 'external_site'), c('bollards-wheel-stops', 'Bollards / Wheel Stops', 'external_site'), c('light-fittings'), c('drainage-outlets', 'Drainage', 'plumbing'), c('access-control', 'Vehicle Access Control', 'safety_security')],
  },
  {
    id: 'strata-common-storage', name: 'Common Storage', category: 'common_property', repeatable: true, applicability: STRATA,
    components: [c('doors-doorway-frames'), c('fire-doors', 'Fire Doors', 'safety_security'), c('walls'), c('floor'), c('light-fittings'), c('shelving'), c('contents-stored-items')],
  },
  {
    id: 'strata-external-walls-grounds', name: 'External Walls & Grounds', category: 'common_property', applicability: STRATA,
    components: [c('external-walls', undefined, undefined, 'required', true), c('gutters-downpipes-fascia'), c('roof-ceiling'), c('garden-lawn'), c('floor-paving-concrete'), c('boundary-fencing', 'Boundary Fencing', 'external_site'), c('fence-gate'), c('drainage-outlets', 'Stormwater / Drainage', 'plumbing'), c('light-fittings')],
  },
  {
    id: 'strata-plant-services', name: 'Plant & Services', category: 'common_property', applicability: STRATA,
    components: [c('plant-room-equipment', 'Plant Room Equipment', 'hvac', 'required', true), c('mechanical-plant', 'Mechanical Plant', 'hvac'), c('switchboards', 'Switchboards', 'electrical'), c('hot-water-system'), c('pumps-controls', 'Pumps / Controls', 'plumbing'), c('light-fittings')],
  },
  {
    id: 'strata-fire-safety-systems', name: 'Fire & Safety Systems', category: 'common_property', applicability: STRATA,
    components: [c('fire-panel', 'Fire Indicator Panel', 'safety_security', 'required', true), c('fire-doors', 'Fire Doors', 'safety_security'), c('exit-signage', 'Exit Signage', 'safety_security', 'required', true), c('emergency-lighting', 'Emergency Lighting', 'safety_security'), c('fire-extinguishers', 'Fire Extinguishers', 'safety_security', 'required', true), c('fire-hose-reels', 'Fire Hose Reels', 'safety_security'), c('sprinkler-heads', 'Sprinkler Heads', 'safety_security'), c('smoke-alarm')],
  },

  // Specialist-property Areas. They are conditionally injected into an existing template.
  {
    id: 'medical-consulting-room', name: 'Consulting Room', category: 'commercial', repeatable: true, applicability: app(['commercial'], ['medical_consulting']),
    components: [c('doors-doorway-frames'), c('privacy-hardware', 'Privacy / Door Hardware', 'door_access'), c('walls', undefined, undefined, 'required', true), c('floor-floorcoverings', undefined, undefined, 'required', true), c('light-fittings'), c('points-switches'), c('clinical-handwash-basin', 'Clinical Handwash Basin', 'plumbing'), c('fixed-clinical-joinery', 'Fixed Clinical Joinery', 'joinery'), c('air-conditioner')],
  },
  {
    id: 'medical-treatment-room', name: 'Treatment Room', category: 'commercial', repeatable: true, applicability: app(['commercial'], ['medical_consulting']),
    components: [c('doors-doorway-frames'), c('privacy-hardware', 'Privacy / Door Hardware', 'door_access'), c('walls', undefined, undefined, 'required', true), c('floor-floorcoverings', undefined, undefined, 'required', true), c('light-fittings'), c('points-switches'), c('clinical-handwash-basin', 'Clinical Handwash Basin', 'plumbing', 'required', true), c('fixed-clinical-joinery', 'Fixed Clinical Joinery', 'joinery'), c('exhaust-fan-vent')],
  },
  {
    id: 'childcare-activity-room', name: 'Childcare Activity Room', category: 'commercial', repeatable: true, applicability: app(['commercial'], ['childcare']),
    components: [c('child-safe-hardware', 'Child-Safe Hardware', 'safety_security', 'required', true), c('walls', undefined, undefined, 'required', true), c('floor-floorcoverings', undefined, undefined, 'required', true), c('light-fittings'), c('points-switches'), c('windows-screens'), c('fixed-workstations', 'Fixed Storage / Joinery', 'joinery')],
  },
  {
    id: 'childcare-sleep-room', name: 'Childcare Sleep Room', category: 'commercial', repeatable: true, applicability: app(['commercial'], ['childcare']),
    components: [c('child-safe-hardware', 'Child-Safe Hardware', 'safety_security', 'required', true), c('walls'), c('floor-floorcoverings'), c('light-fittings'), c('windows-screens'), c('air-conditioner'), c('smoke-alarm')],
  },
  {
    id: 'childcare-outdoor-play', name: 'Outdoor Play Area', category: 'external', applicability: app(['commercial'], ['childcare']),
    components: [c('play-equipment', 'Play Equipment', 'external_site', 'required', true), c('softfall-surface', 'Softfall / Play Surface', 'flooring', 'required', true), c('shade-structures', 'Shade Structures', 'external_site', 'required', true), c('boundary-fencing', 'Boundary / Child-Safe Fencing', 'external_site', 'required', true), c('fence-gate'), c('drainage-outlets', 'Drainage', 'plumbing')],
  },
  {
    id: 'retirement-accessibility-safety', name: 'Accessibility & Resident Safety', category: 'safety', applicability: app(['residential'], ['retirement_supported']),
    components: [c('emergency-call-system', 'Emergency Call System', 'safety_security', 'required', true), c('grab-rails', 'Grab Rails / Supports', 'safety_security', 'required', true), c('accessible-fixtures', 'Accessible Fixtures', 'plumbing'), c('smoke-alarm', undefined, undefined, 'required', true), c('electrical-safety-switch', undefined, undefined, 'required', true), c('child-safe-hardware', 'Safety Hardware', 'safety_security')],
  },
];

function union<T extends string>(left: readonly T[], right: readonly T[]): T[] {
  return [...new Set([...left, ...right])];
}

function mergeApplicability(left: CatalogueApplicability, right: CatalogueApplicability): CatalogueApplicability {
  return {
    propertyUses: union(left.propertyUses, right.propertyUses),
    physicalPropertyTypes: union(left.physicalPropertyTypes, right.physicalPropertyTypes),
    inspectionTypes: union(left.inspectionTypes, right.inspectionTypes),
  };
}

function covers(existing: CatalogueApplicability, required: CatalogueApplicability): boolean {
  return required.propertyUses.every((value) => existing.propertyUses.includes(value))
    && required.physicalPropertyTypes.every((value) => existing.physicalPropertyTypes.includes(value))
    && required.inspectionTypes.every((value) => existing.inspectionTypes.includes(value));
}

function machineCode(prefix: 'AREA' | 'COMPONENT' | 'RULE', value: string): string {
  return `${prefix}_${value.trim().toUpperCase().replace(/[^A-Z0-9]+/gu, '_').replace(/^_+|_+$/gu, '')}`;
}

const legacyComponents = new Map(CANONICAL_COMPONENT_DEFINITIONS.map((definition) => [definition.id, definition]));
const componentRequirements = new Map<string, { spec: ComponentSpec; applicability: CatalogueApplicability }>();

for (const area of AREA_SPECS) {
  for (const spec of area.components) {
    const existing = componentRequirements.get(spec.id);
    if (existing) {
      existing.applicability = mergeApplicability(existing.applicability, area.applicability);
      existing.spec.aliases = union(existing.spec.aliases ?? [], spec.aliases ?? []);
    } else {
      componentRequirements.set(spec.id, { spec: { ...spec }, applicability: structuredClone(area.applicability) });
    }
  }
}

/**
 * New Component v1 records plus v2 records for legacy Components whose system
 * applicability has to expand beyond the immutable residential v1 definition.
 */
export const PROPERTY_LAYOUT_COMPONENT_DEFINITIONS: SystemComponentDefinition[] = [...componentRequirements.entries()]
  .flatMap(([id, requirement]) => {
    const legacy = legacyComponents.get(id);
    if (legacy && covers(legacy.applicability, requirement.applicability)) return [];
    if (legacy) {
      return [{
        ...structuredClone(legacy),
        version: legacy.version + 1,
        source: 'system_property_layouts' as const,
        applicability: mergeApplicability(legacy.applicability, requirement.applicability),
        aliases: union(legacy.aliases, requirement.spec.aliases ?? []),
        createdAt: CREATED_AT,
        publishedAt: CREATED_AT,
      }];
    }
    const name = requirement.spec.name?.trim() || id.replaceAll('-', ' ').replace(/\b\w/gu, (letter) => letter.toUpperCase());
    return [{
      id,
      code: machineCode('COMPONENT', id),
      name,
      description: `System Component used by canonical Property Layout templates: ${name}.`,
      aliases: union([name], requirement.spec.aliases ?? []),
      category: requirement.spec.category ?? 'other',
      applicability: structuredClone(requirement.applicability),
      legacyIds: [],
      version: 1,
      status: 'published' as const,
      createdAt: CREATED_AT,
      publishedAt: CREATED_AT,
      source: 'system_property_layouts' as const,
    }];
  })
  .sort((left, right) => left.code.localeCompare(right.code));

const systemComponentVersions = new Map<string, SystemComponentDefinition>();
for (const definition of PROPERTY_LAYOUT_COMPONENT_DEFINITIONS) systemComponentVersions.set(definition.id, definition);

export const PROPERTY_LAYOUT_AREA_DEFINITIONS: SystemAreaDefinition[] = AREA_SPECS.map((spec, index) => ({
  id: spec.id,
  code: machineCode('AREA', spec.id),
  name: spec.name,
  description: `System Area used by canonical Property Layout templates: ${spec.name}.`,
  aliases: union([spec.name], spec.aliases ?? []),
  category: spec.category,
  repeatable: Boolean(spec.repeatable),
  applicability: structuredClone(spec.applicability),
  legacyIds: [],
  legacyOrder: 1000 + index,
  version: 1,
  status: 'published',
  createdAt: CREATED_AT,
  publishedAt: CREATED_AT,
  source: 'system_property_layouts',
}));

function componentVersionFor(spec: ComponentSpec): SystemComponentDefinitionVersion {
  return systemComponentVersions.get(spec.id) ?? legacyComponents.get(spec.id) ?? (() => { throw new Error(`Missing Component definition ${spec.id}.`); })();
}

export const PROPERTY_LAYOUT_AREA_COMPONENT_RULES: SystemAreaComponentRule[] = AREA_SPECS.flatMap((area) =>
  area.components.map((spec, index) => {
    const component = componentVersionFor(spec);
    const id = `${area.id}:${spec.id}`;
    return {
      id,
      code: machineCode('RULE', id),
      areaDefinitionId: area.id,
      componentDefinitionId: spec.id,
      componentDefinitionVersion: component.version,
      inclusion: spec.inclusion ?? 'default',
      order: index + 1,
      photoRequired: Boolean(spec.photoRequired),
      applicability: structuredClone(area.applicability),
      legacyAreaId: area.id,
      legacyAreaName: area.name,
      legacyComponentId: spec.id,
      legacyComponentName: component.name,
      version: 1,
      status: 'published',
      createdAt: CREATED_AT,
      publishedAt: CREATED_AT,
      source: 'system_property_layouts',
    };
  }),
);

/** All immutable system definition versions, including retained residential v1 records. */
export const SYSTEM_CANONICAL_AREA_DEFINITION_VERSIONS: SystemAreaDefinitionVersion[] = [
  ...CANONICAL_AREA_DEFINITIONS,
  ...PROPERTY_LAYOUT_AREA_DEFINITIONS,
];
export const SYSTEM_CANONICAL_COMPONENT_DEFINITION_VERSIONS: SystemComponentDefinitionVersion[] = [
  ...CANONICAL_COMPONENT_DEFINITIONS,
  ...PROPERTY_LAYOUT_COMPONENT_DEFINITIONS,
];
export const SYSTEM_CANONICAL_AREA_COMPONENT_RULE_VERSIONS: SystemAreaComponentRuleVersion[] = [
  ...CANONICAL_AREA_COMPONENT_RULES,
  ...PROPERTY_LAYOUT_AREA_COMPONENT_RULES,
];

export function findSystemAreaDefinition(id: string, version?: number): SystemAreaDefinitionVersion | undefined {
  const matches = SYSTEM_CANONICAL_AREA_DEFINITION_VERSIONS.filter((definition) => definition.id === id && (version === undefined || definition.version === version));
  return matches.sort((left, right) => right.version - left.version)[0];
}

export function findSystemComponentDefinition(id: string, version?: number): SystemComponentDefinitionVersion | undefined {
  const matches = SYSTEM_CANONICAL_COMPONENT_DEFINITION_VERSIONS.filter((definition) => definition.id === id && (version === undefined || definition.version === version));
  return matches.sort((left, right) => right.version - left.version)[0];
}

export function systemAreaComponentRulesForArea(id: string, version?: number): ResolvedAreaComponentRule[] {
  const area = findSystemAreaDefinition(id, version);
  if (!area) return [];
  return SYSTEM_CANONICAL_AREA_COMPONENT_RULE_VERSIONS
    .filter((rule) => rule.areaDefinitionId === area.id && rule.version === area.version)
    .map((rule) => ({
      ...structuredClone(rule),
      source: rule.source,
      componentDefinitionVersion: 'componentDefinitionVersion' in rule
        ? rule.componentDefinitionVersion
        : findSystemComponentDefinition(rule.componentDefinitionId, 1)?.version ?? 1,
    }))
    .sort((left, right) => left.order - right.order);
}

const room = (
  name: string,
  roomType: RoomType,
  canonicalAreaDefinitionId: string,
  floorLevel = 'Ground Floor',
  responsibility: CanonicalPropertyLayoutRoom['responsibility'] = 'lot',
  physicalPropertyTypes?: PhysicalPropertyType[],
): CanonicalPropertyLayoutRoom => {
  const definition = findSystemAreaDefinition(canonicalAreaDefinitionId);
  if (!definition) throw new Error(`Property Layout room '${name}' references missing Area ${canonicalAreaDefinitionId}.`);
  return {
    name,
    roomType,
    canonicalAreaDefinitionId,
    canonicalAreaDefinitionVersion: definition.version,
    floorLevel,
    responsibility,
    ...(physicalPropertyTypes?.length ? { physicalPropertyTypes } : {}),
  };
};

const HOUSE_CORE: CanonicalPropertyLayoutRoom[] = [
  room('Front Exterior', 'outdoor', 'exterior-front'),
  room('Entry', 'hallway', 'entry'),
  room('Lounge Room', 'living', 'lounge-room'),
  room('Kitchen', 'kitchen', 'kitchen'),
  room('Dining Area', 'dining', 'dining-room'),
  room('Passage / Hallway', 'hallway', 'passage-hallway'),
];
const HOUSE_CLOSE: CanonicalPropertyLayoutRoom[] = [
  room('Main Bathroom', 'bathroom', 'bathroom'),
  room('Toilet / WC', 'bathroom', 'toilet-wc'),
  room('Laundry', 'laundry', 'laundry'),
  room('Garage / Carport', 'garage', 'garage-carport'),
  room('Rear Exterior', 'outdoor', 'exterior-back'),
  room('Garden & External Items', 'outdoor', 'general-external-items'),
  room('Security & Safety', 'safety', 'security-safety'),
];

/** The same ten user-facing templates, now composed entirely from exact Area versions. */
export const CANONICAL_PROPERTY_LAYOUT_TEMPLATES: CanonicalPropertyLayoutTemplate[] = [
  {
    id: 'res-house-3x2', name: 'Standard 3 x 2 House', description: 'Residential house with comprehensive internal, external and safety inspection Areas.',
    propertyUse: 'residential', propertyUses: ['residential'], physicalPropertyTypes: ['house', 'villa', 'duplex', 'ancillary_dwelling'],
    rooms: [...HOUSE_CORE, room('Master Bedroom', 'bedroom', 'bedroom'), room('Ensuite', 'bathroom', 'ensuite'), room('Bedroom 2', 'bedroom', 'bedroom'), room('Bedroom 3', 'bedroom', 'bedroom'), ...HOUSE_CLOSE],
  },
  {
    id: 'res-house-4x2', name: 'Standard 4 x 2 House', description: 'Four-bedroom residential house with common internal and external Areas.',
    propertyUse: 'residential', propertyUses: ['residential'], physicalPropertyTypes: ['house', 'villa', 'duplex'],
    rooms: [room('Front Exterior', 'outdoor', 'exterior-front'), room('Entry', 'hallway', 'entry'), room('Front Lounge', 'living', 'lounge-room'), room('Kitchen', 'kitchen', 'kitchen'), room('Dining Area', 'dining', 'dining-room'), room('Family / Living Area', 'living', 'family-room'), room('Master Bedroom', 'bedroom', 'bedroom'), room('Ensuite', 'bathroom', 'ensuite'), room('Bedroom 2', 'bedroom', 'bedroom'), room('Bedroom 3', 'bedroom', 'bedroom'), room('Bedroom 4', 'bedroom', 'bedroom'), ...HOUSE_CLOSE],
  },
  {
    id: 'res-apartment-1x1', name: '1 x 1 Apartment', description: 'Compact apartment or supported-accommodation layout without house-only external Areas.',
    propertyUse: 'residential', propertyUses: ['residential'], physicalPropertyTypes: ['apartment', 'unit', 'studio', 'retirement_supported'],
    rooms: [room('Entry', 'hallway', 'entry'), room('Living / Dining', 'living', 'lounge-dining-room'), room('Kitchen', 'kitchen', 'kitchen'), room('Master Bedroom', 'bedroom', 'bedroom'), room('Bathroom', 'bathroom', 'bathroom'), room('Laundry', 'laundry', 'laundry'), room('Balcony / Courtyard', 'outdoor', 'balcony-courtyard'), room('Storeroom', 'storage', 'storeroom'), room('Car Bay', 'garage', 'car-bay'), room('Security & Safety', 'safety', 'security-safety'), room('Accessibility & Resident Safety', 'safety', 'retirement-accessibility-safety', 'Ground Floor', 'lot', ['retirement_supported'])],
  },
  {
    id: 'res-apartment-2x2', name: '2 x 2 Apartment', description: 'Two-bedroom apartment with ensuite, balcony, storage and allocated car bay.',
    propertyUse: 'residential', propertyUses: ['residential'], physicalPropertyTypes: ['apartment', 'unit'],
    rooms: [room('Entry', 'hallway', 'entry'), room('Living / Dining', 'living', 'lounge-dining-room'), room('Kitchen', 'kitchen', 'kitchen'), room('Master Bedroom', 'bedroom', 'bedroom'), room('Ensuite', 'bathroom', 'ensuite'), room('Bedroom 2', 'bedroom', 'bedroom'), room('Main Bathroom', 'bathroom', 'bathroom'), room('Laundry', 'laundry', 'laundry'), room('Balcony', 'outdoor', 'balcony-courtyard'), room('Storeroom', 'storage', 'storeroom'), room('Car Bay', 'garage', 'car-bay'), room('Security & Safety', 'safety', 'security-safety')],
  },
  {
    id: 'res-furnished-apartment', name: 'Furnished Apartment', description: 'Apartment layout with a dedicated furnishing and included-chattels Area.',
    propertyUse: 'residential', propertyUses: ['residential'], physicalPropertyTypes: ['apartment', 'unit', 'studio'], furnished: true,
    rooms: [room('Entry', 'hallway', 'entry'), room('Living / Dining', 'living', 'lounge-dining-room'), room('Kitchen', 'kitchen', 'kitchen'), room('Master Bedroom', 'bedroom', 'bedroom'), room('Bedroom 2', 'bedroom', 'bedroom'), room('Bathroom / Ensuite', 'bathroom', 'bathroom'), room('Laundry', 'laundry', 'laundry'), room('Balcony / Courtyard', 'outdoor', 'balcony-courtyard'), room('Furniture & Included Chattels', 'other', 'furniture-included-chattels'), room('Storeroom', 'storage', 'storeroom'), room('Car Bay', 'garage', 'car-bay'), room('Security & Safety', 'safety', 'security-safety')],
  },
  {
    id: 'res-townhouse', name: 'Townhouse', description: 'Multi-level residential layout with internal stairs and private external Areas.',
    propertyUse: 'residential', propertyUses: ['residential'], physicalPropertyTypes: ['townhouse'],
    rooms: [room('Front Exterior', 'outdoor', 'exterior-front'), room('Entry', 'hallway', 'entry'), room('Living / Dining', 'living', 'lounge-dining-room'), room('Kitchen', 'kitchen', 'kitchen'), room('Laundry', 'laundry', 'laundry'), room('Ground Floor WC', 'bathroom', 'toilet-wc'), room('Garage / Carport', 'garage', 'garage-carport'), room('Internal Stairs / Landing', 'hallway', 'internal-stairs-landing'), room('Master Bedroom', 'bedroom', 'bedroom', 'First Floor'), room('Ensuite', 'bathroom', 'ensuite', 'First Floor'), room('Bedroom 2', 'bedroom', 'bedroom', 'First Floor'), room('Bedroom 3', 'bedroom', 'bedroom', 'First Floor'), room('Main Bathroom', 'bathroom', 'bathroom', 'First Floor'), room('Rear Courtyard / Patio', 'outdoor', 'balcony-courtyard'), room('Security & Safety', 'safety', 'security-safety')],
  },
  {
    id: 'commercial-office', name: 'Commercial Office', description: 'Office and specialist commercial premises including work Areas, amenities, services and safety systems.',
    propertyUse: 'commercial', propertyUses: ['commercial', 'mixed_use'], physicalPropertyTypes: COMMERCIAL_TYPES,
    rooms: [room('External Entry / Façade', 'outdoor', 'commercial-external-entry-facade'), room('Reception', 'office', 'commercial-reception'), room('Open Office', 'office', 'commercial-open-office'), room('Private Offices', 'office', 'commercial-private-office'), room('Meeting Rooms', 'office', 'commercial-meeting-room'), room('Kitchenette', 'kitchen', 'commercial-kitchenette'), room('Amenities', 'amenities', 'commercial-amenities'), room('Server / Communications Room', 'plant', 'server-communications-room'), room('Storage', 'storage', 'commercial-storage'), room('HVAC & Mechanical Services', 'plant', 'hvac-mechanical-services'), room('Electrical & Lighting', 'plant', 'electrical-lighting-services'), room('Fire & Safety Systems', 'safety', 'fire-safety-systems'), room('Car Parking', 'garage', 'commercial-car-parking'), room('Consulting Rooms', 'office', 'medical-consulting-room', 'Ground Floor', 'lot', ['medical_consulting']), room('Treatment Rooms', 'office', 'medical-treatment-room', 'Ground Floor', 'lot', ['medical_consulting']), room('Childcare Activity Rooms', 'other', 'childcare-activity-room', 'Ground Floor', 'lot', ['childcare']), room('Childcare Sleep Room', 'other', 'childcare-sleep-room', 'Ground Floor', 'lot', ['childcare']), room('Outdoor Play Area', 'outdoor', 'childcare-outdoor-play', 'Ground Floor', 'lot', ['childcare'])],
  },
  {
    id: 'commercial-retail', name: 'Retail Premises', description: 'Retail, showroom and hospitality structure covering customer, back-of-house and service Areas.',
    propertyUse: 'retail', propertyUses: ['retail', 'commercial', 'mixed_use'], physicalPropertyTypes: RETAIL_TYPES,
    rooms: [room('Shopfront & Signage', 'retail', 'retail-shopfront-signage'), room('Customer / Sales Area', 'retail', 'retail-sales-area'), room('Point of Sale / Counter', 'retail', 'retail-pos-counter'), room('Display Fixtures', 'retail', 'retail-display-fixtures'), room('Storeroom', 'storage', 'retail-storeroom'), room('Office', 'office', 'retail-office'), room('Kitchen / Preparation Area', 'kitchen', 'retail-kitchen-preparation'), room('Amenities', 'amenities', 'retail-amenities'), room('HVAC & Mechanical Services', 'plant', 'hvac-mechanical-services'), room('Electrical & Lighting', 'plant', 'electrical-lighting-services'), room('Fire & Safety Systems', 'safety', 'fire-safety-systems'), room('External Areas', 'outdoor', 'retail-external-areas'), room('Commercial Kitchen', 'kitchen', 'commercial-kitchen', 'Ground Floor', 'lot', ['hospitality', 'restaurant_cafe']), room('Coolroom / Refrigeration', 'plant', 'coolroom-refrigeration-area', 'Ground Floor', 'lot', ['hospitality', 'restaurant_cafe']), room('Showroom Floor', 'retail', 'showroom-floor', 'Ground Floor', 'lot', ['showroom'])],
  },
  {
    id: 'industrial-warehouse', name: 'Warehouse / Industrial', description: 'Industrial premises with warehouse, loading, external yard, services and safety Areas.',
    propertyUse: 'industrial', propertyUses: ['industrial', 'commercial'], physicalPropertyTypes: INDUSTRIAL_TYPES,
    rooms: [room('Warehouse Floor', 'warehouse', 'warehouse-floor'), room('Loading Area', 'warehouse', 'warehouse-loading-area'), room('Roller Doors', 'warehouse', 'warehouse-roller-doors'), room('Offices', 'office', 'warehouse-office'), room('Amenities', 'amenities', 'warehouse-amenities'), room('Mezzanine', 'storage', 'warehouse-mezzanine', 'Mezzanine'), room('Racking / Storage', 'storage', 'warehouse-racking-storage'), room('External Yard', 'outdoor', 'warehouse-external-yard'), room('Boundary Fencing', 'outdoor', 'warehouse-boundary-fencing'), room('Car Parking', 'garage', 'warehouse-car-parking'), room('Electrical & Lighting', 'plant', 'electrical-lighting-services'), room('Fire & Safety Equipment', 'safety', 'fire-safety-systems')],
  },
  {
    id: 'strata-common-property', name: 'Strata Common Property', description: 'Shared building and common-property layout for strata inspection and maintenance records.',
    propertyUse: 'strata_common_property', propertyUses: ['strata_common_property'], physicalPropertyTypes: STRATA_TYPES,
    rooms: [room('Building Entry', 'hallway', 'strata-building-entry', 'Ground Floor', 'common_property'), room('Lobby / Common Hallways', 'hallway', 'strata-lobby-hallways', 'Ground Floor', 'common_property'), room('Lifts / Lift Lobby', 'plant', 'strata-lift-lobby', 'Ground Floor', 'common_property'), room('Stairwells', 'hallway', 'strata-stairwells', 'Ground Floor', 'common_property'), room('Common Amenities', 'amenities', 'strata-common-amenities', 'Ground Floor', 'common_property'), room('Car Park', 'garage', 'strata-car-park', 'Basement', 'common_property'), room('Common Storage', 'storage', 'strata-common-storage', 'Basement', 'common_property'), room('External Walls & Grounds', 'outdoor', 'strata-external-walls-grounds', 'External', 'common_property'), room('Plant & Services', 'plant', 'strata-plant-services', 'Plant', 'common_property'), room('Fire & Safety Systems', 'safety', 'strata-fire-safety-systems', 'Common', 'common_property')],
  },
];

export function resolvePropertyLayoutTemplateRooms(
  template: CanonicalPropertyLayoutTemplate,
  physicalPropertyType?: PhysicalPropertyType,
): CanonicalPropertyLayoutRoom[] {
  return template.rooms.filter((candidate) => !candidate.physicalPropertyTypes?.length
    || (physicalPropertyType ? candidate.physicalPropertyTypes.includes(physicalPropertyType) : false));
}

export function canonicalAreasForPropertyClassification(input: {
  propertyUse?: PropertyUse;
  physicalPropertyType?: PhysicalPropertyType;
}): SystemAreaDefinitionVersion[] {
  return SYSTEM_CANONICAL_AREA_DEFINITION_VERSIONS
    .filter((area) => area.status === 'published')
    .filter((area) => !input.propertyUse || area.applicability.propertyUses.includes(input.propertyUse))
    .filter((area) => !input.physicalPropertyType || area.applicability.physicalPropertyTypes.includes(input.physicalPropertyType))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function validatePropertyLayoutCatalogue(): void {
  const areaKeys = new Set(SYSTEM_CANONICAL_AREA_DEFINITION_VERSIONS.map((area) => `${area.id}@${area.version}`));
  const componentKeys = new Set(SYSTEM_CANONICAL_COMPONENT_DEFINITION_VERSIONS.map((component) => `${component.id}@${component.version}`));
  for (const area of PROPERTY_LAYOUT_AREA_DEFINITIONS) {
    const rules = systemAreaComponentRulesForArea(area.id, area.version);
    if (!rules.length) throw new Error(`System Area ${area.id} has no Component rules.`);
    for (const rule of rules) {
      if (!componentKeys.has(`${rule.componentDefinitionId}@${rule.componentDefinitionVersion}`)) throw new Error(`Rule ${rule.id} references missing exact Component version.`);
    }
  }
  if (CANONICAL_PROPERTY_LAYOUT_TEMPLATES.length !== 10) throw new Error('The canonical Property Layout catalogue must preserve the ten existing layout templates.');
  const templateIds = new Set<string>();
  for (const template of CANONICAL_PROPERTY_LAYOUT_TEMPLATES) {
    if (templateIds.has(template.id)) throw new Error(`Duplicate Property Layout template ${template.id}.`);
    templateIds.add(template.id);
    const resolved = resolvePropertyLayoutTemplateRooms(template, template.physicalPropertyTypes[0]);
    if (!resolved.length) throw new Error(`Property Layout template ${template.id} has no Areas.`);
    for (const candidate of template.rooms) {
      if (!areaKeys.has(`${candidate.canonicalAreaDefinitionId}@${candidate.canonicalAreaDefinitionVersion}`)) throw new Error(`Template ${template.id} references missing Area ${candidate.canonicalAreaDefinitionId}@${candidate.canonicalAreaDefinitionVersion}.`);
      if (!systemAreaComponentRulesForArea(candidate.canonicalAreaDefinitionId, candidate.canonicalAreaDefinitionVersion).length) throw new Error(`Template ${template.id} Area ${candidate.canonicalAreaDefinitionId} has no Components.`);
    }
  }
}

validatePropertyLayoutCatalogue();
