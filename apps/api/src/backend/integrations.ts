import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { originalObjectPath, type AuthenticatedPrincipal, type UploadSessionRecord } from '@pcr/domain';
import type { TaskDispatcher, TaskKind, UploadSessionIssuer } from './types.js';
import { FirestorePhotoEvidenceStore } from './photoEvidenceStore.js';

function adminApp() { return getApps()[0] ?? initializeApp({ credential: applicationDefault() }); }
async function metadataAccessToken(): Promise<string> { const response = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(5_000) }); if (!response.ok) throw new Error(`Metadata token request failed with ${response.status}.`); const body = (await response.json()) as { access_token?: string }; if (!body.access_token) throw new Error('Metadata token response did not contain access_token.'); return body.access_token; }
async function publishTask(projectId: string, topic: string, payload: Record<string, unknown>): Promise<string> { const token = await metadataAccessToken(); const response = await fetch(`https://pubsub.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/topics/${encodeURIComponent(topic)}:publish`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ data: Buffer.from(JSON.stringify(payload), 'utf8').toString('base64') }] }), signal: AbortSignal.timeout(10_000) }); if (!response.ok) { const detail = await response.text().catch(() => ''); throw new Error(`Pub/Sub ${topic} dispatch failed with ${response.status}${detail ? `: ${detail}` : ''}.`); } const body = (await response.json()) as { messageIds?: string[] }; const messageId = body.messageIds?.[0]; if (!messageId) throw new Error(`Pub/Sub ${topic} dispatch did not return a message ID.`); return messageId; }

const TOPIC_BY_KIND: Record<TaskKind, string> = {
  analysis: 'analysis-requests',
  pdf: 'pdf-generation-requests',
  notification: 'notification-requests',
  document: 'document-generation-requests',
  integration: 'integration-sync-requests',
};

export class FirestoreTaskOutbox implements TaskDispatcher {
  async dispatch(kind: TaskKind, agencyId: string, taskId: string, payload: Record<string, unknown>): Promise<void> {
    const now = new Date().toISOString(); const database = getFirestore(adminApp()); const outboxRef = database.doc(`agencies/${agencyId}/taskOutbox/${taskId}`);
    await outboxRef.create({ id: taskId, agencyId, kind, payload, status: 'pending', attempts: 0, createdAt: now, updatedAt: now });
    const projectId = process.env.GOOGLE_CLOUD_PROJECT?.trim();
    if (!projectId || process.env.NODE_ENV === 'test') { await outboxRef.update({ status: 'pending_runtime_dispatch', topic: TOPIC_BY_KIND[kind], updatedAt: new Date().toISOString() }); return; }
    const topic = TOPIC_BY_KIND[kind];
    try { const messageId = await publishTask(projectId, topic, { taskId, agencyId, kind, ...payload }); await outboxRef.update({ status: 'dispatched', topic, pubsubMessageId: messageId, dispatchedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }); }
    catch (error) { await outboxRef.update({ status: 'dispatch_failed', topic, dispatchError: error instanceof Error ? error.message : String(error), updatedAt: new Date().toISOString() }); throw error; }
  }
}

function extension(fileName: string): string { const value = fileName.split('.').pop(); return value && value !== fileName ? value : 'bin'; }

export class FirebaseUploadSessionIssuer implements UploadSessionIssuer {
  private readonly evidence = new FirestorePhotoEvidenceStore();
  constructor(private readonly bucketName = process.env.UPLOAD_BUCKET) {}
  async create(agencyId: string, uploadId: string, input: Record<string, unknown>, principal: AuthenticatedPrincipal): Promise<Record<string, unknown>> {
    const fileName = String(input.fileName); const sha256 = String(input.sha256); const inspectionJobId = String(input.inspectionJobId); const existing = await this.evidence.findByHash(agencyId, inspectionJobId, sha256); const now = new Date().toISOString();
    if (existing) return { id: uploadId, agencyId, status: 'duplicate', duplicatePhotoId: existing.id, objectPath: existing.objectPath, generation: existing.generation, contentType: existing.contentType, fileSize: existing.fileSize, originalFilename: existing.originalFilename, sha256, createdAt: now, updatedAt: now };
    const objectPath = originalObjectPath({ agencyId, inspectionJobId, uploadSessionId: uploadId, sha256, extension: extension(fileName) }); const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const session: UploadSessionRecord = { id: uploadId, agencyId, propertyId: String(input.propertyId), inspectionJobId, ...(typeof input.reportId === 'string' ? { reportId: input.reportId } : {}), ...(typeof input.areaId === 'string' ? { areaId: input.areaId } : {}), componentIds: Array.isArray(input.componentIds) ? input.componentIds.filter((value): value is string => typeof value === 'string') : [], originalFilename: fileName, contentType: String(input.contentType), fileSize: Number(input.size), sha256, objectPath, status: 'issued', issuedTo: principal.uid, expiresAt, ...(typeof input.externalGrantId === 'string' ? { externalGrantId: input.externalGrantId } : {}), ...(input.externalResourceType === 'work_request' || input.externalResourceType === 'tenant_instruction' ? { externalResourceType: input.externalResourceType } : {}), ...(typeof input.externalResourceId === 'string' ? { externalResourceId: input.externalResourceId } : {}), createdAt: now, updatedAt: now };
    if (!this.bucketName) { await this.evidence.createSession(session); return { ...session, status: 'configuration_required', note: 'Set UPLOAD_BUCKET to the evidence bucket before enabling uploads.' }; }
    const file = getStorage(adminApp()).bucket(this.bucketName).file(objectPath); const [resumableUploadUrl] = await file.createResumableUpload({ metadata: { contentType: session.contentType, metadata: { agencyId, inspectionJobId, uploadSessionId: uploadId, sha256, immutableOriginal: 'true' } }, preconditionOpts: { ifGenerationMatch: 0 } }); session.resumableUploadUrl = resumableUploadUrl; await this.evidence.createSession(session); return session as unknown as Record<string, unknown>;
  }
}
