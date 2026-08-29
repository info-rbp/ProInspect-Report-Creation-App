import { describe, expect, it } from 'vitest';
import { canAccessFoundation, type FoundationPrincipal } from '../src/capabilities.js';
import { apiManagedRowPermissions, assertNoClientWritePermission } from '../src/permissions.js';

const base: FoundationPrincipal = { userId: 'user-1', agencyId: 'agency-1', role: 'resident_tenant', mfaVerified: false, siteIds: ['site-1'], propertyIds: ['property-1'] };

describe('Appwrite foundation permission policy', () => {
  it('allows a resident to read their own request but denies another resident request', () => {
    expect(canAccessFoundation(base, 'resident_request.read', { agencyId: 'agency-1', residentUserId: 'user-1' })).toBe(true);
    expect(canAccessFoundation(base, 'resident_request.read', { agencyId: 'agency-1', residentUserId: 'user-2' })).toBe(false);
  });

  it('limits building managers to assigned sites', () => {
    const manager = { ...base, role: 'building_manager' as const };
    expect(canAccessFoundation(manager, 'maintenance_item.read', { agencyId: 'agency-1', managedSiteId: 'site-1' })).toBe(true);
    expect(canAccessFoundation(manager, 'maintenance_item.read', { agencyId: 'agency-1', managedSiteId: 'site-2' })).toBe(false);
  });

  it('limits inspectors and contractors to assignments', () => {
    const inspector = { ...base, role: 'inspector' as const };
    expect(canAccessFoundation(inspector, 'inspection_job.read', { agencyId: 'agency-1', assignedInspectorId: 'user-1' })).toBe(true);
    expect(canAccessFoundation(inspector, 'approval.read', { agencyId: 'agency-1', managedSiteId: 'site-1' })).toBe(false);
    const contractor = { ...base, role: 'contractor_worker' as const };
    expect(canAccessFoundation(contractor, 'work_order.read', { agencyId: 'agency-1', assignedContractorId: 'user-1' })).toBe(true);
    expect(canAccessFoundation(contractor, 'work_order.read', { agencyId: 'agency-1', assignedContractorId: 'contractor-2' })).toBe(false);
  });

  it('requires MFA for privileged access and denies cross-agency access', () => {
    const admin = { ...base, role: 'proinspect_admin' as const };
    expect(canAccessFoundation(admin, 'property.read', { agencyId: 'agency-1' })).toBe(false);
    expect(canAccessFoundation({ ...admin, mfaVerified: true }, 'property.read', { agencyId: 'agency-2' })).toBe(false);
    expect(canAccessFoundation({ ...admin, mfaVerified: true }, 'property.read', { agencyId: 'agency-1' })).toBe(true);
  });

  it('emits read-only row permissions', () => {
    const permissions = apiManagedRowPermissions({ userIds: ['user-1'], teamIds: ['team-1'] });
    expect(permissions.every((permission) => permission.startsWith('read('))).toBe(true);
    expect(() => assertNoClientWritePermission(['update("user:user-1")'])).toThrow(/must not grant/);
  });
});
