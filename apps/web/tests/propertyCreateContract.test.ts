import { describe, expect, it } from 'vitest';
import type { PropertyRecord } from '../types/platform';
import { propertyCreateCommand } from '../services/platform/propertyService';

const draftProperty: PropertyRecord & { version?: number } = {
  id: 'onboarding-draft',
  agencyId: 'agency-1',
  address: 'QA TEST - 1 Example Street',
  suburb: 'Perth',
  state: 'WA',
  postcode: '6000',
  clientIds: ['client-1'],
  status: 'active',
  createdAt: '2026-08-25T00:00:00.000Z',
  updatedAt: '2026-08-25T00:00:00.000Z',
  version: 3,
};

describe('property create contract', () => {
  it('never sends the onboarding draft identifier or server-owned metadata', () => {
    expect(propertyCreateCommand(draftProperty)).toEqual(expect.objectContaining({
      agencyId: 'agency-1',
      address: 'QA TEST - 1 Example Street',
    }));
    expect(propertyCreateCommand(draftProperty)).not.toHaveProperty('id');
    expect(propertyCreateCommand(draftProperty)).not.toHaveProperty('createdAt');
    expect(propertyCreateCommand(draftProperty)).not.toHaveProperty('updatedAt');
    expect(propertyCreateCommand(draftProperty)).not.toHaveProperty('version');
  });
});
