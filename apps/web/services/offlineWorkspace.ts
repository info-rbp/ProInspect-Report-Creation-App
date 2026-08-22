import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export type SyncState = 'local' | 'queued' | 'syncing' | 'synced' | 'conflict' | 'failed';
export interface OfflineJobSnapshot { id: string; agencyId: string; cloudVersion: number; downloadedAt: string; payload: unknown; }
export interface LocalPhotoQueueItem { id: string; agencyId: string; propertyId: string; inspectionJobId: string; reportId?: string; areaId?: string; componentIds: string[]; file: Blob; fileName: string; contentType: string; size: number; sha256: string; uploadedBytes: number; uploadSessionId?: string; resumableUploadUrl?: string; state: SyncState; attempts: number; error?: string; updatedAt: string; }
export interface MutationOutboxItem { id: string; agencyId: string; inspectionJobId: string; operation: string; expectedVersion: number; payload: unknown; state: SyncState; attempts: number; error?: string; createdAt: string; updatedAt: string; }

interface WorkspaceDatabase extends DBSchema {
  jobs: { key: string; value: OfflineJobSnapshot };
  drafts: { key: string; value: { jobId: string; baseVersion: number; payload: unknown; updatedAt: string } };
  photos: { key: string; value: LocalPhotoQueueItem; indexes: { 'by-job': string; 'by-state': SyncState } };
  outbox: { key: string; value: MutationOutboxItem; indexes: { 'by-job': string; 'by-state': SyncState } };
  confirmations: { key: string; value: { jobId: string; allEvidenceUploaded: boolean; confirmedAt?: string } };
}

let databasePromise: Promise<IDBPDatabase<WorkspaceDatabase>> | undefined;
function database(): Promise<IDBPDatabase<WorkspaceDatabase>> { if (!databasePromise) { databasePromise = openDB<WorkspaceDatabase>('pcr-offline-workspace', 1, { upgrade(db) { db.createObjectStore('jobs', { keyPath: 'id' }); db.createObjectStore('drafts', { keyPath: 'jobId' }); const photos = db.createObjectStore('photos', { keyPath: 'id' }); photos.createIndex('by-job', 'inspectionJobId'); photos.createIndex('by-state', 'state'); const outbox = db.createObjectStore('outbox', { keyPath: 'id' }); outbox.createIndex('by-job', 'inspectionJobId'); outbox.createIndex('by-state', 'state'); db.createObjectStore('confirmations', { keyPath: 'jobId' }); } }); } return databasePromise; }

export async function downloadJobForOffline(snapshot: OfflineJobSnapshot): Promise<void> { await (await database()).put('jobs', snapshot); }
export async function getOfflineJob(jobId: string): Promise<OfflineJobSnapshot | undefined> { return (await database()).get('jobs', jobId); }
export async function listOfflineJobs(): Promise<OfflineJobSnapshot[]> { return (await database()).getAll('jobs'); }
export async function removeOfflineJob(jobId: string): Promise<void> { const db = await database(); const tx = db.transaction(['jobs', 'drafts', 'photos', 'outbox', 'confirmations'], 'readwrite'); await Promise.all([tx.objectStore('jobs').delete(jobId), tx.objectStore('drafts').delete(jobId), ...((await tx.objectStore('photos').index('by-job').getAllKeys(jobId)).map((key) => tx.objectStore('photos').delete(key))), ...((await tx.objectStore('outbox').index('by-job').getAllKeys(jobId)).map((key) => tx.objectStore('outbox').delete(key))), tx.objectStore('confirmations').delete(jobId)]); await tx.done; }
export async function saveLocalDraft(jobId: string, baseVersion: number, payload: unknown): Promise<void> { await (await database()).put('drafts', { jobId, baseVersion, payload, updatedAt: new Date().toISOString() }); }
export async function getLocalDraft(jobId: string) { return (await database()).get('drafts', jobId); }

export async function queuePhoto(item: Omit<LocalPhotoQueueItem, 'uploadedBytes' | 'state' | 'attempts' | 'updatedAt'>): Promise<void> { await (await database()).put('photos', { ...item, uploadedBytes: 0, state: 'queued', attempts: 0, updatedAt: new Date().toISOString() }); await setEvidenceConfirmation(item.inspectionJobId, false); }
export async function updatePhotoProgress(id: string, uploadedBytes: number, state: SyncState, patch: Partial<LocalPhotoQueueItem> = {}): Promise<void> { const db = await database(); const existing = await db.get('photos', id); if (!existing) throw new Error('Offline photo queue item not found.'); await db.put('photos', { ...existing, ...patch, uploadedBytes, state, updatedAt: new Date().toISOString() }); }

export async function enqueueMutation(item: Omit<MutationOutboxItem, 'state' | 'attempts' | 'createdAt' | 'updatedAt'>): Promise<void> { const now = new Date().toISOString(); await (await database()).put('outbox', { ...item, state: 'queued', attempts: 0, createdAt: now, updatedAt: now }); }
export async function updateMutationProgress(id: string, state: SyncState, patch: Partial<MutationOutboxItem> = {}): Promise<void> { const db = await database(); const existing = await db.get('outbox', id); if (!existing) throw new Error('Offline mutation queue item not found.'); await db.put('outbox', { ...existing, ...patch, state, updatedAt: new Date().toISOString() }); }

export async function pendingPhotos(jobId?: string): Promise<LocalPhotoQueueItem[]> { const db = await database(); const items = jobId ? await db.getAllFromIndex('photos', 'by-job', jobId) : await db.getAll('photos'); return items.filter((item) => item.state !== 'synced'); }
export async function pendingMutations(jobId?: string): Promise<MutationOutboxItem[]> { const db = await database(); const items = jobId ? await db.getAllFromIndex('outbox', 'by-job', jobId) : await db.getAll('outbox'); return items.filter((item) => item.state !== 'synced').sort((a, b) => a.createdAt.localeCompare(b.createdAt)); }
export async function syncStateSummary(jobId?: string) { const [photos, mutations] = await Promise.all([pendingPhotos(jobId), pendingMutations(jobId)]); return { photos: photos.length, mutations: mutations.length, conflicts: mutations.filter((item) => item.state === 'conflict').length, failures: photos.filter((item) => item.state === 'failed').length + mutations.filter((item) => item.state === 'failed').length, syncing: photos.some((item) => item.state === 'syncing') || mutations.some((item) => item.state === 'syncing') }; }
export async function detectDraftConflict(jobId: string, cloudVersion: number): Promise<boolean> { const draft = await (await database()).get('drafts', jobId); return Boolean(draft && draft.baseVersion !== cloudVersion); }
export async function setEvidenceConfirmation(jobId: string, allEvidenceUploaded: boolean): Promise<void> { await (await database()).put('confirmations', { jobId, allEvidenceUploaded, ...(allEvidenceUploaded ? { confirmedAt: new Date().toISOString() } : {}) }); }
export async function canSubmitInspection(jobId: string): Promise<boolean> { const db = await database(); const confirmation = await db.get('confirmations', jobId); const photos = await db.getAllFromIndex('photos', 'by-job', jobId); const mutations = await db.getAllFromIndex('outbox', 'by-job', jobId); return Boolean(confirmation?.allEvidenceUploaded && photos.every((item) => item.state === 'synced') && mutations.every((item) => item.state === 'synced')); }
export function installReconnectSync(sync: () => Promise<void>): () => void { const listener = () => { void sync(); }; window.addEventListener('online', listener); return () => window.removeEventListener('online', listener); }
