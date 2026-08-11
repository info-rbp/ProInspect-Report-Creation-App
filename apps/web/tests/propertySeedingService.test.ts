import { describe, expect, it } from 'vitest';
import type { PropertyRecord } from '../types/platform';
import {
  createSeededItem,
  getDefaultItemsForRoomType,
  seedRoomsFromProperty,
} from '../services/platform/propertySeedingService';

const property: PropertyRecord = {
  id: 'property-test',
  agencyId: 'agency-test',
  address: '1 Test Street',
  bedrooms: 3,
  bathrooms: 2,
  livingAreas: 1,
  parking: 1,
  clientIds: [],
  status: 'active',
  createdAt: '2026-08-09T00:00:00.000Z',
  updatedAt: '2026-08-09T00:00:00.000Z',
};

describe('canonical property report seeding', () => {
  it('uses canonical kitchen component identities instead of grouped prototype items', () => {
    const items = getDefaultItemsForRoomType('kitchen', 'Kitchen');
    const ids = items.map((item) => item.id);
    const names = items.map((item) => item.name);

    expect(ids).toContain('bench-tops');
    expect(ids).toContain('sink-taps-spout');
    expect(ids).toContain('cupboards');
    expect(ids).toContain('drawers');
    expect(names).not.toContain('Doors, Drawers & Handles');
    expect(names).not.toContain('Benchtops & Sink / Taps');
  });

  it('never seeds operational components as tested or confirmed', () => {
    const oven = createSeededItem('Oven / Griller', 'oven-griller');
    expect(oven.workingStatus).toBe('untested');
    expect(oven.testStatus).toBe('untested');
    expect(oven.conditionCategory).toBe('unable_to_confirm');
    expect(oven.cleanlinessCategory).toBe('unable_to_confirm');
  });

  it('uses not-applicable operation state for static components', () => {
    const walls = createSeededItem('Walls', 'walls');
    expect(walls.workingStatus).toBe('not_applicable');
    expect(walls.testStatus).toBe('not_applicable');
  });

  it('seeds deterministic area and component identities across reports', () => {
    const first = seedRoomsFromProperty(property);
    const second = seedRoomsFromProperty(property);

    expect(first.map((area) => area.id)).toEqual(second.map((area) => area.id));
    expect(first.map((area) => area.items.map((item) => item.id))).toEqual(
      second.map((area) => area.items.map((item) => item.id)),
    );
  });

  it('keeps bedroom area instances distinct while sharing canonical component identities', () => {
    const rooms = seedRoomsFromProperty(property);
    const bedroom1 = rooms.find((area) => area.id === 'area-bedroom-1');
    const bedroom2 = rooms.find((area) => area.id === 'area-bedroom-2');

    expect(bedroom1).toBeDefined();
    expect(bedroom2).toBeDefined();
    expect(bedroom1?.id).not.toBe(bedroom2?.id);
    expect(bedroom1?.items.map((item) => item.id)).toEqual(
      bedroom2?.items.map((item) => item.id),
    );
    expect(bedroom1?.items.map((item) => item.id)).toContain('walls');
    expect(bedroom1?.items.map((item) => item.id)).toContain('wardrobe');
  });
});
