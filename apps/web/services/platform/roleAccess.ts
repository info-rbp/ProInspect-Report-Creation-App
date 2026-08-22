import type { UserRole } from '../../types/platform';

export const INTERNAL_ROLES: UserRole[] = [
  'super_admin',
  'proinspect_admin',
  'operations',
  'inspector',
  'analyst',
  'reviewer',
];

export type InternalSection =
  | 'dashboard'
  | 'clients'
  | 'properties'
  | 'jobs'
  | 'reports'
  | 'maintenance'
  | 'tenant-followup'
  | 'users'
  | 'templates'
  | 'settings';

const ROLE_SECTIONS: Record<UserRole, InternalSection[]> = {
  super_admin: ['dashboard', 'clients', 'properties', 'jobs', 'reports', 'maintenance', 'tenant-followup', 'users', 'templates', 'settings'],
  proinspect_admin: ['dashboard', 'clients', 'properties', 'jobs', 'reports', 'maintenance', 'tenant-followup', 'users', 'templates', 'settings'],
  operations: ['dashboard', 'clients', 'properties', 'jobs', 'reports', 'maintenance', 'tenant-followup'],
  inspector: ['dashboard', 'maintenance'],
  analyst: ['dashboard', 'reports', 'maintenance', 'tenant-followup'],
  reviewer: ['dashboard', 'reports', 'maintenance', 'tenant-followup'],
  tenant: [],
  landlord: [],
  shopify_customer: [],
};

export const isInternalRole = (role?: UserRole): boolean => Boolean(role && INTERNAL_ROLES.includes(role));

export const canAccessSection = (role: UserRole | undefined, section: InternalSection): boolean => {
  if (!role) return false;
  return ROLE_SECTIONS[role].includes(section);
};

export const hasAnyRole = (currentRole: UserRole | undefined, allowedRoles: UserRole[]): boolean => {
  if (!currentRole) return false;
  return allowedRoles.includes(currentRole);
};
