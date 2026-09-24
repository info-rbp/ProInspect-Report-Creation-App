import { describe, expect, it, vi } from 'vitest';
import { AppwriteWorkerDatabase, workerRowId } from '../src/workerRepository.js';
import { transactionFixture } from '@pcr/testing';
import { workerSchema } from '../src/workerSchema.js';
import { downloadWorkerEvidence, saveWorkerArtifact, workerDigest } from '../src/workerStorage.js';
import type { AppwriteServerServices } from '../src/client.js';

describe('Appwrite worker persistence and isolation', () => {
  it('round trips notification state, stamps the actor, and separates identical logical IDs across agencies', async () => {
    const f = transactionFixture(workerSchema); const db = new AppwriteWorkerDatabase(f.services as unknown as AppwriteServerServices, 'system:notification-worker');
    const a = db.doc('agencies/a/notificationJobs/shared'); const b = db.doc('agencies/b/notificationJobs/shared');
    await a.create({ recipient: 'qa@example.invalid', retryCount: 3, status: 'queued', createdBy: 'spoofed' });
    await b.create({ recipient: 'other@example.invalid', status: 'queued' });
    expect((await a.get()).data()).toMatchObject({ recipient: 'qa@example.invalid', retryCount: 3, createdBy: 'system:notification-worker' });
    await a.set({ attempts: 1, nextAttemptAt: '2026-09-24T01:00:00Z' }, { merge: true });
    expect((await a.get()).get('recipient')).toBe('qa@example.invalid');
    expect((await db.collection('agencies/a/notificationJobs').get()).docs.map((d) => d.get('recipient'))).toEqual(['qa@example.invalid']);
    expect(workerRowId('notification_jobs', 'a', 'shared')).not.toBe(workerRowId('notification_jobs', 'b', 'shared'));
    await expect(a.update({ agencyId: 'b' })).rejects.toThrow('scope mismatch');
    expect(f.calls.every((call) => !call.method.toLowerCase().includes('firestore'))).toBe(true);
  });
  it('denies foreign rows before reads or writes and rejects unscoped paths', async () => {
    const f = transactionFixture(workerSchema); const db = new AppwriteWorkerDatabase(f.services as unknown as AppwriteServerServices, 'system:worker');
    f.rows.set('reports:r', { $id: 'r', agencyId: 'b' });
    await expect(db.doc('agencies/a/reports/r').get()).rejects.toThrow('scope mismatch');
    await expect(db.doc('agencies/a/reports/r').set({ status: 'finalised' }, { merge: true })).rejects.toThrow('scope mismatch');
    expect(() => db.doc('documentTemplateVersions/global')).toThrow('require an agency');
    expect(f.rows.get('reports:r')).toEqual({ $id: 'r', agencyId: 'b' });
  });
  it('rolls back every staged write on faults and retries commit conflicts without partial visibility', async () => {
    const f = transactionFixture(workerSchema); const db = new AppwriteWorkerDatabase(f.services as unknown as AppwriteServerServices, 'system:worker');
    const perform = () => db.runTransaction(async (tx) => { tx.create(db.doc('agencies/a/notificationJobs/j'), { status: 'queued' }); tx.create(db.doc('agencies/a/tenantAutomationEvents/e'), { eventType: 'test' }); expect(f.rows.size).toBe(0); });
    f.fault('tenant_automation_events'); await expect(perform()).rejects.toThrow(); expect(f.rows.size).toBe(0);
    f.fault(); f.conflict(); await perform(); expect(f.rows.size).toBe(2); expect(f.stats()).toMatchObject({ commits: 1, rollbacks: 2 });
  });
  it('concurrent claims conflict and only one caller can change a queued job to running', async () => {
    const f = transactionFixture(workerSchema); const db = new AppwriteWorkerDatabase(f.services as unknown as AppwriteServerServices, 'system:worker'); const ref = db.doc('agencies/a/notificationJobs/j'); await ref.create({ status: 'queued' });
    const claim = () => db.runTransaction(async (tx) => { const row = await tx.get(ref); if (row.get('status') === 'running') return false; tx.update(ref, { status: 'running' }); return true; });
    expect((await Promise.all([claim(), claim()])).filter(Boolean)).toHaveLength(1);
  });
  it('audit appends cannot be replaced', async () => {
    const f = transactionFixture(workerSchema); const db = new AppwriteWorkerDatabase(f.services as unknown as AppwriteServerServices, 'system:worker'); const ref = db.doc('agencies/a/auditEvents/e');
    await ref.create({ action: 'test', actorType: 'system', entityType: 'job', entityId: 'j', source: 'worker', correlationId: 'test' });
    await expect(ref.set({ action: 'rewrite' }, { merge: true })).rejects.toThrow('append-only');
    expect((await ref.get()).get('action')).toBe('test');
  });
});
describe('Appwrite worker binary provenance', () => {
  it('rejects foreign agency evidence before downloading and verifies immutable metadata plus content hash', async () => {
    const bytes = new TextEncoder().encode('synthetic');
    const row = { agencyId: 'b', bucketId: 'inspection-evidence', fileId: 'f', checksum: workerDigest(bytes), storageVersion: 'timestamp' };
    const download = vi.fn(async () => bytes.buffer);
    const services = { databaseId: 'proinspect_core', tables: { getRow: async () => row }, storage: { getFile: async () => ({ $updatedAt: 'timestamp' }), getFileDownload: download } } as unknown as AppwriteServerServices;
    await expect(downloadWorkerEvidence('a', 'e', services)).rejects.toThrow('scope mismatch'); expect(download).not.toHaveBeenCalled();
    row.agencyId = 'a'; await expect(downloadWorkerEvidence('a', 'e', services)).resolves.toMatchObject({ bytes });
    row.checksum = '0'.repeat(64); await expect(downloadWorkerEvidence('a', 'e', services)).rejects.toThrow('SHA-256');
  });
  it('immutable upload replay accepts identical bytes and refuses a conflict without overwriting', async () => {
    const bytes = new TextEncoder().encode('synthetic'); const create = vi.fn(async () => { throw Object.assign(new Error('exists'), { code: 409 }); });
    const download = vi.fn(async () => bytes.buffer);
    const services = { storage: { createFile: create, getFile: async () => ({ $createdAt: 'v1' }), getFileDownload: download } } as unknown as AppwriteServerServices;
    const input = { bucketId: 'reports', path: 'agencies/a/report/r.pdf', bytes, sha256: workerDigest(bytes), contentType: 'application/pdf' };
    await expect(saveWorkerArtifact(services, input)).resolves.toMatchObject({ generation: 'v1' });
    download.mockResolvedValue(new TextEncoder().encode('changed').buffer); await expect(saveWorkerArtifact(services, input)).rejects.toThrow('Immutable artifact conflict');
    expect(create.mock.calls[0]).toBeDefined();
  });
});
