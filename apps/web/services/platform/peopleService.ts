import type { DeactivationImpact, PeopleDirectoryEntry, UserRole, WorkforceProfile } from '../../types/platform';
import { apiRequest } from '../apiClient';

export async function listPeople(): Promise<PeopleDirectoryEntry[]> {
  return apiRequest<PeopleDirectoryEntry[]>(undefined, '/api/v1/people');
}

export async function invitePerson(input: { email: string; displayName?: string; role: UserRole; mfaRequired?: boolean }): Promise<{ userId: string }> {
  return apiRequest(undefined, '/api/v1/people', { method: 'POST', body: input });
}

export async function getDeactivationImpact(userId: string): Promise<DeactivationImpact> {
  return apiRequest(undefined, `/api/v1/people/${encodeURIComponent(userId)}/impact`);
}

export async function changePersonRole(userId: string, role: UserRole, reason: string): Promise<void> {
  await apiRequest(undefined, `/api/v1/people/${encodeURIComponent(userId)}/role`, { method: 'PATCH', body: { role, reason } });
}

export async function setMembershipStatus(userId: string, action: 'suspend' | 'reactivate' | 'revoke', reason: string): Promise<void> {
  await apiRequest(undefined, `/api/v1/people/${encodeURIComponent(userId)}/${action}`, { method: 'POST', body: { reason } });
}

export async function revokePersonSessions(userId: string, reason: string): Promise<void> {
  await apiRequest(undefined, `/api/v1/people/${encodeURIComponent(userId)}/revoke-sessions`, { method: 'POST', body: { reason } });
}

export async function saveWorkforceProfile(userId: string, profile: Partial<WorkforceProfile>): Promise<WorkforceProfile> {
  return apiRequest(undefined, `/api/v1/people/${encodeURIComponent(userId)}/workforce`, { method: 'PUT', body: profile });
}
