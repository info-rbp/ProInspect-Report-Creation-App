import type { UserProfile } from '../../types/platform';
import { isInternalRole } from '@pcr/domain';
import { listPeople } from './peopleService';

export async function listAgencyUsers(): Promise<UserProfile[]> {
  const profiles: UserProfile[] = [];
  for (const person of await listPeople()) {
    if (!isInternalRole(person.role)) continue;
    profiles.push({
      id: person.id,
      agencyId: person.agencyId,
      displayName: person.displayName,
      email: person.email,
      role: person.role,
      status: person.membershipStatus === 'active' ? 'active' : 'inactive',
      createdAt: person.identity?.createdAt ?? person.updatedAt,
      updatedAt: person.updatedAt,
    });
  }
  return profiles;
}

export async function listAvailableInspectors(): Promise<UserProfile[]> {
  return (await listAgencyUsers()).filter((user) => user.status === 'active' && ['inspector', 'operations', 'proinspect_admin', 'super_admin'].includes(user.role));
}

export async function listAvailableReviewers(): Promise<UserProfile[]> {
  return (await listAgencyUsers()).filter((user) => user.status === 'active' && ['reviewer', 'operations', 'proinspect_admin', 'super_admin'].includes(user.role));
}
