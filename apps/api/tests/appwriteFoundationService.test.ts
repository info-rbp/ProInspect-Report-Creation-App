import { describe, expect, it } from 'vitest';
import { createOptionalAppwriteFoundation } from '../src/services/appwriteFoundationService.js';

describe('Appwrite foundation activation boundary', () => {
  it('remains disabled unless the explicit foundation mode is selected', () => {
    expect(createOptionalAppwriteFoundation({})).toBeUndefined();
  });

  it('fails closed when selected without server credentials', () => {
    expect(() => createOptionalAppwriteFoundation({ APPWRITE_BACKEND_MODE: 'foundation' })).toThrow(/configuration is incomplete/);
  });
});
