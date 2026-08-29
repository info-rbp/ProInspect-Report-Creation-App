import { describe, expect, it } from 'vitest';
import { platformDrift, validatePlatformDefinitions } from './platforms.mjs';

const expected = [{ $id: 'proinspect-localhost', name: 'ProInspect local development', type: 'web', hostname: 'localhost' }];

describe('Appwrite Development platforms', () => {
  it('accepts the explicit localhost web platform', () => {
    expect(validatePlatformDefinitions(expected)).toEqual([]);
    expect(platformDrift(expected, expected)).toEqual({ missing: [], extra: [], incompatible: [] });
  });

  it('reports missing, extra, and incompatible platforms without deleting anything', () => {
    expect(platformDrift(expected, [
      { ...expected[0], hostname: '127.0.0.1' },
      { $id: 'unexpected', name: 'Unexpected', type: 'web', hostname: 'example.test' },
    ])).toEqual({
      missing: [],
      extra: [{ $id: 'unexpected', name: 'Unexpected', type: 'web', hostname: 'example.test' }],
      incompatible: [{ expected: expected[0], actual: { ...expected[0], hostname: '127.0.0.1' } }],
    });
  });

  it('rejects URLs, ports, duplicates, and Production-looking hostnames', () => {
    const errors = validatePlatformDefinitions([
      { $id: 'one', name: 'One', type: 'web', hostname: 'https://localhost:5173' },
      { $id: 'one', name: 'Two', type: 'web', hostname: 'app.production.example.com' },
    ]);
    expect(errors).toHaveLength(3);
  });
});
