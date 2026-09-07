import {
  INTERNAL_USER_ROLES,
  canAccessInternalSection,
  isInternalRole as isDomainInternalRole,
  type InternalUserRole,
  type InternalSection,
  type SecurityRole,
  type UserRole,
} from '@pcr/domain';

export const INTERNAL_ROLES: UserRole[] = [...INTERNAL_USER_ROLES];
export type { InternalSection };

export const isInternalRole = (role?: SecurityRole): role is InternalUserRole => isDomainInternalRole(role);

export const canAccessSection = (role: SecurityRole | undefined, section: InternalSection): boolean =>
  canAccessInternalSection(role, section);

export const hasAnyRole = (currentRole: SecurityRole | undefined, allowedRoles: SecurityRole[]): boolean => {
  if (!currentRole) return false;
  return allowedRoles.includes(currentRole);
};
