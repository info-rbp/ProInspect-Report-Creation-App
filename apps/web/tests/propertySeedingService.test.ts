import { describe, expect, it } from 'vitest';
import type { PropertyRecord } from '../types/platform';
import { PROPERTY_LAYOUT_TEMPLATES, applyLayoutTemplate } from '../services/platform/propertyLayoutService';
import {
  createSeededItem,
  getDefaultItemsForRoomType,
  isOperationalItem,
  seedRoomsFromProperty,
} from '../services/platform/propertySeedingService';

const property: PropertyRecord = {
  id: 'property-test',
  agencyId: 'agency-test',
  address: '1 Test Street',
  propertyType: 'house',
  propertyUse: 'residential',
  physicalPropertyType: 'house',
  bedrooms: 3,
  bathrooms: 2,
  livingAreas: 1,
  parking: 1,
  clientIds: [],
  status: 'active',
  roomsConfig: [],
  layoutNodes: [],
  layoutVersions: [],
  ownershipHistory: [],
  tenancyHistory: [],
  accessDevices: [],
  assets: [],
  documents: [],
  profilePhotos: [],
  alerts: [],
  floorPlanDocumentIds: [],
  createdAt: '2026-08-09T00:00:00.000Z',
  updatedAt: '2026-08-09T00:00:00.000Z',
};

describe('canonical property report seeding', () => {
  it('uses canonical kitchen Component identities instead of grouped prototype items', () => {
    const items = getDefaultItemsForRoomType('kitchen', 'Room of Regrettable Toast');
    const canonicalIds = items.map((item) => item.canonicalComponentDefinitionId);
    const names = items.map((item) => item.name);

    expect(canonicalIds).toContain('bench-tops');
    expect(canonicalIds).toContain('sink-taps-spout');
    expect(canonicalIds).toContain('cupboards');
    expect(canonicalIds).toContain('drawers');
    expect(names).not.toContain('Doors, Drawers & Handles');
    expect(names).not.toContain('Benchtops & Sink / Taps');
  });

  it('ignores display names when choosing RoomType fallback components', () => {
    const sensible = getDefaultItemsForRoomType('kitchen', 'Kitchen');
    const renamed = getDefaultItemsForRoomType('kitchen', 'Definitely Not A Kitchen');
    expect(renamed.map((item) => item.canonicalComponentDefinitionId)).toEqual(
      sensible.map((item) => item.canonicalComponentDefinitionId),
    );
  });

  it('derives operational state from the exact Component definition instead of its display name', () => {
    expect(isOperationalItem('oven-griller', 1)).toBe(true);
    expect(isOperationalItem('walls', 1)).toBe(false);
    const renamedOven = createSeededItem('Decorative Wall Ornament, Apparently', 'oven-instance', {
      componentDefinitionId: 'oven-griller',
      componentDefinitionVersion: 1,
    });
    expect(renamedOven.workingStatus).toBe('untested');
    expect(renamedOven.testStatus).toBe('untested');
    expect(renamedOven.canonicalComponentDefinitionId).toBe('oven-griller');
  });

  it('never seeds operational Components as tested or confirmed', () => {
    const oven = createSeededItem('Oven / Griller', 'oven-griller');
    expect(oven.workingStatus).toBe('untested');
    expect(oven.testStatus).toBe('untested');
    expect(oven.conditionCategory).toBe('unable_to_confirm');
    expect(oven.cleanlinessCategory).toBe('unable_to_confirm');
  });

  it('uses not-applicable operation state for static Components', () => {
    const walls = createSeededItem('Walls', 'walls');
    expect(walls.workingStatus).toBe('not_applicable');
    expect(walls.testStatus).toBe('not_applicable');
  });

  it('seeds deterministic Property Area and Component instance identities across reports', () => {
    const first = seedRoomsFromProperty(property);
    const second = seedRoomsFromProperty(property);

    expect(first.map((area) => area.id)).toEqual(second.map((area) => area.id));
    expect(first.map((area) => area.items.map((item) => item.id))).toEqual(
      second.map((area) => area.items.map((item) => item.id)),
    );
    expect(first.every((area) => Boolean(area.canonicalAreaDefinitionId && area.canonicalAreaDefinitionVersion))).toBe(true);
  });

  it('keeps bedroom instances distinct while sharing canonical Component definitions', () => {
    const rooms = seedRoomsFromProperty(property);
    const bedroom1 = rooms.find((area) => area.id === 'area-bedroom-1');
    const bedroom2 = rooms.find((area) => area.id === 'area-bedroom-2');

    expect(bedroom1).toBeDefined();
    expect(bedroom2).toBeDefined();
    expect(bedroom1?.id).not.toBe(bedroom2?.id);
    expect(bedroom1?.canonicalAreaDefinitionId).toBe('bedroom');
    expect(bedroom2?.canonicalAreaDefinitionId).toBe('bedroom');
    expect(bedroom1?.items.map((item) => item.id)).not.toEqual(
      bedroom2?.items.map((item) => item.id),
    );
    expect(bedroom1?.items.map((item) => item.canonicalComponentDefinitionId)).toEqual(
      bedroom2?.items.map((item) => item.canonicalComponentDefinitionId),
    );
    expect(bedroom1?.items.map((item) => item.canonicalComponentDefinitionId)).toContain('walls');
    expect(bedroom1?.items.map((item) => item.canonicalComponentDefinitionId)).toContain('wardrobe');
  });

  it('seeds a renamed template-backed Area from its exact canonical references', () => {
    const template = PROPERTY_LAYOUT_TEMPLATES.find((item) => item.id === 'res-house-3x2')!;
    const patch = applyLayoutTemplate(property, template);
    const roomsConfig = structuredClone(patch.roomsConfig!);
    const kitchen = roomsConfig.find((room) => room.canonicalAreaDefinitionId === 'kitchen')!;
    kitchen.name = 'Room of Regrettable Toast';
    const configured = { ...property, ...patch, roomsConfig } as PropertyRecord;
    const reportRooms = seedRoomsFromProperty(configured);
    const seededKitchen = reportRooms.find((room) => room.id === kitchen.id)!;
    expect(seededKitchen.name).toBe('Room of Regrettable Toast');
    expect(seededKitchen.canonicalAreaDefinitionId).toBe('kitchen');
    expect(seededKitchen.items.map((item) => item.canonicalComponentDefinitionId)).toEqual(
      kitchen.componentRefs?.map((component) => component.canonicalComponentDefinitionId),
    );
  });

  it('preserves exact agency Component references even when the system package does not define them', () => {
    const custom = createSeededItem('Custom Sensor', 'property-area:component:agency-sensor', {
      componentDefinitionId: 'agency-sensor',
      componentDefinitionVersion: 4,
      areaComponentRuleId: 'agency-area:agency-sensor',
      areaComponentRuleVersion: 2,
    });
    expect(custom).toMatchObject({
      canonicalComponentDefinitionId: 'agency-sensor',
      canonicalComponentDefinitionVersion: 4,
      canonicalAreaComponentRuleId: 'agency-area:agency-sensor',
      canonicalAreaComponentRuleVersion: 2,
    });
  });
});
