import type {
  DeactivationImpact,
  PeopleDirectoryEntry,
  ReassignmentResult,
  UserRole,
  WorkforceProfile,
  WorkloadSummary,
} from '../../types/platform';
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

export async function getPersonWorkload(userId: string): Promise<WorkloadSummary> {
  return apiRequest(undefined, `/api/v1/people/${encodeURIComponent(userId)}/workload`);
}

export async function reassignPersonWork(
  userId: string,
  replacementUserId: string,
  reason: string,
): Promise<ReassignmentResult> {
  return apiRequest(undefined, `/api/v1/people/${encodeURIComponent(userId)}/reassign`, {
    method: 'POST',
    body: { replacementUserId, reason },
  });
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
