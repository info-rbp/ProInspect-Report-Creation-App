import { canAccessSection, hasAnyRole, isInternalRole } from '../services/platform/roleAccess';

describe('roleAccess', () => {
  it('allows admin roles to access all internal sections', () => {
    expect(canAccessSection('proinspect_admin', 'properties')).toBe(true);
    expect(canAccessSection('proinspect_admin', 'settings')).toBe(true);
  });

  it('derives inspector sections from the canonical backend capability model', () => {
    expect(canAccessSection('inspector', 'dashboard')).toBe(true);
    expect(canAccessSection('inspector', 'properties')).toBe(true);
    expect(canAccessSection('inspector', 'jobs')).toBe(true);
    expect(canAccessSection('inspector', 'reports')).toBe(true);
    expect(canAccessSection('inspector', 'users')).toBe(false);
    expect(canAccessSection('inspector', 'settings')).toBe(false);
  });

  it('does not treat tenant-facing roles as internal', () => {
    expect(isInternalRole('tenant')).toBe(false);
    expect(hasAnyRole('reviewer', ['analyst', 'reviewer'])).toBe(true);
  });
});
