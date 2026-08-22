import type { TenantInstruction } from '../../types/platform';
import { apiRequest } from '../apiClient';

export type TenantActionQueueItem = TenantInstruction & {
  tenant?: { id: string; fullName: string; email?: string; phone?: string };
  property?: { id: string; address?: string; suburb?: string };
};

export async function listTenantActionQueue(): Promise<TenantActionQueueItem[]> {
  return apiRequest<TenantActionQueueItem[]>(undefined, '/api/v1/tenant-actions/queue');
}
