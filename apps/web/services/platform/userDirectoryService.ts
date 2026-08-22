import type { UserProfile } from '../../types/platform';
import { listPeople } from './peopleService';

export async function listAgencyUsers(): Promise<UserProfile[]> {
  return (await listPeople()).map((person) => ({
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
