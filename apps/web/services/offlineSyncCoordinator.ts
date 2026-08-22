import { apiRequest } from './apiClient';
import { syncPendingPhotos } from './photoUploadCoordinator';
import {
  downloadJobForOffline,
  getOfflineJob,
  pendingMutations,
  syncStateSummary,
  updateMutationProgress,
  type OfflineJobSnapshot,
  type MutationOutboxItem,
} from './offlineWorkspace';

export interface OfflinePackage {
  job: Record<string, unknown>;
  property?: Record<string, unknown>;
  report?: Record<string, unknown>;
  tenancy?: Record<string, unknown>;
  layout?: Record<string, unknown>;
  template?: Record<string, unknown>;
  baseline?: Record<string, unknown>;
  downloadedAt: string;
  packageHash: string;
}

type SyncSummary = Awaited<ReturnType<typeof syncStateSummary>>;
function agencyId(): string | undefined { if (typeof window === 'undefined') return undefined; return window.localStorage.getItem('pcr_agency_id') || window.localStorage.getItem('agencyId') || undefined; }

export async function downloadInspectionForOffline(jobId: string): Promise<OfflinePackage> {
  const payload = await apiRequest<OfflinePackage>(agencyId(), `/api/v1/inspection-jobs/${encodeURIComponent(jobId)}/offline-package`);
  const cloudVersion = Number(payload.job.version || 1);
  const snapshot: OfflineJobSnapshot = { id: jobId, agencyId: String(payload.job.agencyId || agencyId() || ''), cloudVersion, downloadedAt: payload.downloadedAt, payload };
  await downloadJobForOffline(snapshot);
  return payload;
}

async function replayMutation(item: MutationOutboxItem): Promise<number> {
  const payload = item.payload && typeof item.payload === 'object' && !Array.isArray(item.payload) ? item.payload as Record<string, unknown> : {};
  if (item.operation === 'job.patch') {
    const updated = await apiRequest<Record<string, unknown>>(item.agencyId, `/api/v1/inspection-jobs/${encodeURIComponent(item.inspectionJobId)}/offline-sync`, { method: 'POST', body: { baseVersion: item.expectedVersion, patch: payload } });
    return Number(updated.version || item.expectedVersion + 1);
  }
  const path = typeof payload.path === 'string' ? payload.path : undefined;
  const method = payload.method === 'POST' || payload.method === 'PATCH' || payload.method === 'PUT' || payload.method === 'DELETE' ? payload.method : undefined;
  if (!path || !method) throw new Error(`Unsupported offline mutation operation: ${item.operation}`);
  const response = await apiRequest<Record<string, unknown>>(item.agencyId, path, { method, body: payload.body });
  return Number(response.version || item.expectedVersion + 1);
}

export async function syncOfflineJob(jobId: string): Promise<SyncSummary> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return syncStateSummary(jobId);
  await syncPendingPhotos(jobId);
  const mutations = await pendingMutations(jobId);
  let currentVersion = (await getOfflineJob(jobId))?.cloudVersion;
  for (const item of mutations) {
    if (item.state === 'conflict') continue;
    await updateMutationProgress(item.id, 'syncing');
    try {
      const nextVersion = await replayMutation({ ...item, expectedVersion: currentVersion || item.expectedVersion });
      currentVersion = nextVersion;
      await updateMutationProgress(item.id, 'synced', { expectedVersion: nextVersion, error: undefined });
    } catch (error) {
      const candidate = error as { code?: string; status?: number; message?: string };
      if (candidate.code === 'OFFLINE_CONFLICT' || candidate.status === 409) {
        await updateMutationProgress(item.id, 'conflict', { attempts: item.attempts + 1, error: candidate.message || 'Cloud version changed.' });
        break;
      }
      await updateMutationProgress(item.id, 'failed', { attempts: item.attempts + 1, error: error instanceof Error ? error.message : String(error) });
      break;
    }
  }
  return syncStateSummary(jobId);
}

export async function syncAllOfflineWork(): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  await syncPendingPhotos();
  const mutations = await pendingMutations();
  for (const jobId of [...new Set(mutations.map((item) => item.inspectionJobId))]) await syncOfflineJob(jobId);
}
