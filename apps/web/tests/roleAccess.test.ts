import { canAccessSection, hasAnyRole, isInternalRole } from '../services/platform/roleAccess';

describe('roleAccess', () => {
  it('allows admin roles to access all internal sections', () => {
    expect(canAccessSection('proinspect_admin', 'properties')).toBe(true);
    expect(canAccessSection('proinspect_admin', 'settings')).toBe(true);
  });

  it('limits inspector access to dashboard for stage 1', () => {
    expect(canAccessSection('inspector', 'dashboard')).toBe(true);
    expect(canAccessSection('inspector', 'reports')).toBe(false);
  });

  it('does not treat tenant-facing roles as internal', () => {
    expect(isInternalRole('tenant')).toBe(false);
    expect(hasAnyRole('reviewer', ['analyst', 'reviewer'])).toBe(true);
  });
});
