import {
  INTERNAL_USER_ROLES,
  canAccessInternalSection,
  isInternalRole as isDomainInternalRole,
  type InternalSection,
  type UserRole,
} from '@pcr/domain';

export const INTERNAL_ROLES: UserRole[] = [...INTERNAL_USER_ROLES];
export type { InternalSection };

export const isInternalRole = (role?: UserRole): boolean => isDomainInternalRole(role);

export const canAccessSection = (role: UserRole | undefined, section: InternalSection): boolean =>
  canAccessInternalSection(role, section);

export const hasAnyRole = (currentRole: UserRole | undefined, allowedRoles: UserRole[]): boolean => {
  if (!currentRole) return false;
  return allowedRoles.includes(currentRole);
};
