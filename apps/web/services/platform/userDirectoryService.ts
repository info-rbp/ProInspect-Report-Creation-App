import type { UserProfile } from '../../types/platform';
import { apiRequest } from '../apiClient';
import { isFirebaseConfigured } from '../storageService';
import { localList } from './localPlatformStore';

function agencyId(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.localStorage.getItem('pcr_agency_id') || window.localStorage.getItem('agencyId') || undefined;
}

function cloudMode(): boolean {
  return isFirebaseConfigured() && Boolean(import.meta.env.VITE_API_BASE_URL?.trim());
}

export async function listAgencyUsers(): Promise<UserProfile[]> {
  if (cloudMode()) return apiRequest<UserProfile[]>(agencyId(), '/api/v1/users?limit=100');
  return localList<UserProfile>('users');
}

export async function listAvailableInspectors(): Promise<UserProfile[]> {
  return (await listAgencyUsers()).filter(
    (user) =>
      user.status === 'active' &&
      ['inspector', 'operations', 'proinspect_admin', 'super_admin'].includes(user.role),
  );
}

export async function listAvailableReviewers(): Promise<UserProfile[]> {
  return (await listAgencyUsers()).filter(
    (user) =>
      user.status === 'active' &&
      ['reviewer', 'operations', 'proinspect_admin', 'super_admin'].includes(user.role),
  );
}
