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
  | 'properties'
  | 'jobs'
  | 'reports'
  | 'maintenance'
  | 'tenants'
  | 'users'
  | 'templates'
  | 'settings';

const ROLE_SECTIONS: Record<UserRole, InternalSection[]> = {
  super_admin: ['dashboard', 'properties', 'jobs', 'reports', 'maintenance', 'tenants', 'users', 'templates', 'settings'],
  proinspect_admin: ['dashboard', 'properties', 'jobs', 'reports', 'maintenance', 'tenants', 'users', 'templates', 'settings'],
  operations: ['dashboard', 'properties', 'jobs', 'reports', 'maintenance', 'tenants'],
  inspector: ['dashboard', 'maintenance'],
  analyst: ['dashboard', 'reports', 'maintenance', 'tenants'],
  reviewer: ['dashboard', 'reports', 'maintenance', 'tenants'],
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
