import type { SecurityRole, UserProfile, UserRole } from '../../types/platform';
import { listPeople } from './peopleService';

const USER_PROFILE_ROLES = new Set<UserRole>([
  'super_admin',
  'proinspect_admin',
  'operations',
  'inspector',
  'analyst',
  'reviewer',
  'tenant',
  'landlord',
  'shopify_customer',
]);

function isUserProfileRole(role: SecurityRole): role is UserRole {
  return USER_PROFILE_ROLES.has(role as UserRole);
}

export async function listAgencyUsers(): Promise<UserProfile[]> {
  return (await listPeople())
    .filter((person) => isUserProfileRole(person.role))
    .map((person) => ({
      id: person.id,
      agencyId: person.agencyId,
      displayName: person.displayName,
      email: person.email,
      role: person.role,
      status: person.membershipStatus === 'active' ? 'active' : 'inactive',
      createdAt: person.identity?.createdAt ?? person.updatedAt,
      updatedAt: person.updatedAt,
    }));
}

export async function listAvailableInspectors(): Promise<UserProfile[]> {
  return (await listAgencyUsers()).filter((user) => user.status === 'active' && ['inspector', 'operations', 'proinspect_admin', 'super_admin'].includes(user.role));
}

export async function listAvailableReviewers(): Promise<UserProfile[]> {
  return (await listAgencyUsers()).filter((user) => user.status === 'active' && ['reviewer', 'operations', 'proinspect_admin', 'super_admin'].includes(user.role));
}