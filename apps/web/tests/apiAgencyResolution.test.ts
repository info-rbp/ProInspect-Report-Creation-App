import { describe, expect, it } from 'vitest';
import { resolveRequestAgency } from '../services/apiClient';

describe('API agency resolution', () => {
  it('does not let browser context override an ordinary member signed agency', () => {
    expect(resolveRequestAgency({
      requestedAgency: 'agency-from-browser',
      claimAgency: 'agency-from-token',
      storedAgency: 'agency-from-storage',
      providerSuperAdmin: false,
    })).toBe('agency-from-token');
  });

  it('allows explicit cross-agency context only for a signed provider super administrator', () => {
    expect(resolveRequestAgency({
      requestedAgency: 'target-agency',
      claimAgency: 'provider-home-agency',
      providerSuperAdmin: true,
    })).toBe('target-agency');
  });

  it('does not invent an agency when no context exists', () => {
    expect(resolveRequestAgency({ providerSuperAdmin: false })).toBeUndefined();
  });
});
