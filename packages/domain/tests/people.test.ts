import { describe, expect, it } from 'vitest';
import { canAccessInternalSection, mayAssignRole, roleHasCapability } from '../src/index.js';

describe('people access policy', () => {
  it('keeps user administration restricted to agency administrators', () => {
    expect(canAccessInternalSection('proinspect_admin', 'users')).toBe(true);
    expect(canAccessInternalSection('operations', 'users')).toBe(false);
    expect(roleHasCapability('operations', 'user.read')).toBe(true);
    expect(roleHasCapability('operations', 'user.role.manage')).toBe(false);
  });
  it('aligns inspector routes with backend capabilities', () => {
    expect(canAccessInternalSection('inspector', 'properties')).toBe(true);
    expect(canAccessInternalSection('inspector', 'jobs')).toBe(true);
    expect(canAccessInternalSection('inspector', 'reports')).toBe(true);
  });
  it('prevents agency administrators assigning platform administrator access', () => {
    expect(mayAssignRole('proinspect_admin', 'super_admin')).toBe(false);
    expect(mayAssignRole('super_admin', 'super_admin')).toBe(true);
  });
});
