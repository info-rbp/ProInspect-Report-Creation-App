import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  insertAfter,
  insertBefore,
  replaceOnce,
  replaceSection,
  writeIfChanged,
} from './patch-lib.mjs';
import { packageRoot } from './lib.mjs';

const payload = (name) => readFileSync(resolve(packageRoot, 'payload', name), 'utf8');

const evidenceTypes = `
export interface EvidenceUploadSessionRecord {
  id: string; agencyId: string; userId: string; bucketId: string; fileId: string;
  originalFilename: string; mimeType: string; size: number; checksum: string;
  expiresAt: string; status: string; propertyId?: string; managedSiteId?: string;
  inspectionJobId?: string; reportId?: string; entityType?: string; entityId?: string;
  completedAt?: string;
}
export interface EvidenceFileRecord {
  id: string; agencyId: string; bucketId: string; fileId: string; entityType: string;
  entityId: string; mimeType: string; originalFilename: string; size: number;
  checksum: string; uploadedBy: string; createdAt: string; updatedAt: string;
  generation: string; propertyId?: string; managedSiteId?: string;
}
export interface EvidenceStoreUploadInput {
  agencyId: string; uploadId: string; actorId: string; entityType: string;
  entityId: string; contentType?: string; bytes: Uint8Array;
}
export interface EvidenceStoreCompletionInput {
  agencyId: string; uploadId: string; actorId: string; entityType: string;
  entityId: string; source: string; category?: string;
}
export interface EvidenceStore {
  getSession(agencyId: string, uploadId: string): Promise<EvidenceUploadSessionRecord>;
  uploadBinary(input: EvidenceStoreUploadInput): Promise<EvidenceUploadSessionRecord>;
  complete(input: EvidenceStoreCompletionInput): Promise<EvidenceFileRecord>;
}

`;

export async function applyStage02e() {
  writeIfChanged('apps/api/src/backend/appwriteEvidenceStore.ts', payload('appwriteEvidenceStore.ts'));
  writeIfChanged('apps/api/src/backend/firestoreEvidenceStore.ts', payload('firestoreEvidenceStore.ts'));
  writeIfChanged('apps/api/src/backend/externalEvidenceCompletionRoutes.ts', payload('externalEvidenceCompletionRoutes.ts'));

  insertBefore('apps/api/src/backend/types.ts', 'export interface IdempotencyResult {', evidenceTypes, 'evidence provider interfaces');
  replaceOnce('apps/api/src/backend/types.ts', '  externalGrants?: ExternalGrantStore;\n  idempotency: IdempotencyStore;', '  externalGrants?: ExternalGrantStore;\n  evidence?: EvidenceStore;\n  idempotency: IdempotencyStore;', 'ApiDependencies evidence store');

  replaceOnce('apps/api/src/backend/runtimeDependencyGuards.ts', '  ExternalGrantStore,\n  NotificationDeliveryStore,', '  EvidenceStore,\n  ExternalGrantStore,\n  NotificationDeliveryStore,', 'EvidenceStore runtime import');
  insertBefore('apps/api/src/backend/runtimeDependencyGuards.ts', 'export function requireExternalGrantStore(', `export function requireEvidenceStore(\n  dependencies: ApiDependencies,\n): EvidenceStore {\n  if (!dependencies.evidence) throw missingDependency('evidence');\n  return dependencies.evidence;\n}\n\n`, 'evidence provider runtime guard');

  insertAfter('packages/appwrite-server/src/index.ts', "export { Account, Client, Query } from 'node-appwrite';\n", "export { InputFile } from 'node-appwrite/file';\n", 'InputFile export');

  replaceOnce('apps/api/src/security/defaultDependencies.ts', "import { FirestoreExternalGrantStore } from '../backend/firestoreExternalGrantStore.js';\n", "import { FirestoreExternalGrantStore } from '../backend/firestoreExternalGrantStore.js';\nimport { FirestoreEvidenceStore } from '../backend/firestoreEvidenceStore.js';\n", 'Firestore evidence import');
  replaceOnce('apps/api/src/security/defaultDependencies.ts', "import { AppwriteExternalGrantStore } from '../backend/appwriteExternalGrantStore.js';\n", "import { AppwriteExternalGrantStore } from '../backend/appwriteExternalGrantStore.js';\nimport { AppwriteEvidenceStore } from '../backend/appwriteEvidenceStore.js';\n", 'Appwrite evidence import');
  replaceOnce('apps/api/src/security/defaultDependencies.ts', '  ApiDependencies,\n  ExternalGrantStore,', '  ApiDependencies,\n  EvidenceStore,\n  ExternalGrantStore,', 'EvidenceStore dependency type import');
  replaceOnce('apps/api/src/security/defaultDependencies.ts', '  let externalGrants: ExternalGrantStore =\n    new FirestoreExternalGrantStore();\n  let idempotency:', '  let externalGrants: ExternalGrantStore =\n    new FirestoreExternalGrantStore();\n  let evidence: EvidenceStore = new FirestoreEvidenceStore();\n  let idempotency:', 'default Firestore evidence provider');
  replaceOnce('apps/api/src/security/defaultDependencies.ts', '    externalGrants = new AppwriteExternalGrantStore(appwrite);\n    idempotency =', '    externalGrants = new AppwriteExternalGrantStore(appwrite);\n    evidence = new AppwriteEvidenceStore(appwrite);\n    idempotency =', 'Appwrite evidence provider wiring');
  replaceOnce('apps/api/src/security/defaultDependencies.ts', '    externalGrants,\n    idempotency,', '    externalGrants,\n    evidence,\n    idempotency,', 'returned evidence provider');

  replaceOnce('packages/domain/src/photoEvidence.ts', "externalResourceType?: 'work_request' | 'tenant_instruction' | 'tenant_portal';", "externalResourceType?: 'work_request' | 'tenant_instruction' | 'report_distribution' | 'tenant_portal' | 'remote_inspection';", 'UploadSessionRecord resource type parity');
  replaceOnce('apps/api/src/backend/integrations.ts', "input.externalResourceType === 'work_request' || input.externalResourceType === 'tenant_instruction' || input.externalResourceType === 'tenant_portal'", "input.externalResourceType === 'work_request' || input.externalResourceType === 'tenant_instruction' || input.externalResourceType === 'report_distribution' || input.externalResourceType === 'tenant_portal' || input.externalResourceType === 'remote_inspection'", 'Firebase fallback resource type parity');
  replaceOnce('infrastructure/appwrite/tables/schema.mjs', "str('legacyFileId',255)]", "str('legacyFileId',255),str('storageVersion',128)]", 'evidence storage version column');

  replaceOnce('apps/api/src/backend/externalEvidenceRoutes.ts', '  return {\n    status: 201,\n    body: { data: { ...session, photoId: uploadId }, meta: { correlationId } },\n  };', `  const encodedToken = encodeURIComponent(decodeURIComponent(parts[4]));\n  const providerUrls = session.uploadProvider === 'appwrite' ? {\n    binaryUploadUrl: \`/api/v1/external/evidence/\${encodedToken}/upload-session/\${encodeURIComponent(uploadId)}/binary\`,\n    completionUrl: \`/api/v1/external/evidence/\${encodedToken}/upload-session/\${encodeURIComponent(uploadId)}/complete\`,\n  } : {};\n  return { status: 201, body: { data: { ...session, ...providerUrls, photoId: uploadId }, meta: { correlationId } } };`, 'external evidence provider URLs');

  replaceOnce('apps/web/services/platform/externalEvidenceUploadService.ts', '    resumableUploadUrl?: string;\n    duplicatePhotoId?: string;', '    resumableUploadUrl?: string;\n    binaryUploadUrl?: string;\n    completionUrl?: string;\n    duplicatePhotoId?: string;', 'external evidence Appwrite upload fields');
  replaceSection('apps/web/services/platform/externalEvidenceUploadService.ts', "  if (!session.resumableUploadUrl) throw new Error('Evidence upload service is not configured.');", '  return { photoId: completed.photoId, uploadSessionId: session.id, sha256: completed.sha256, generation: completed.generation };', `  const baseUrl = import.meta.env.VITE_API_BASE_URL?.trim() || '';\n  const uploadUrl = session.binaryUploadUrl ? \`\${baseUrl.replace(/\\\/$/u, '')}\${session.binaryUploadUrl}\` : session.resumableUploadUrl;\n  if (!uploadUrl) throw new Error('Evidence upload service is not configured.');\n  const upload = await fetch(uploadUrl, { method: 'PUT', headers: session.binaryUploadUrl ? { 'content-type': contentType } : { 'content-type': contentType, 'content-range': \`bytes 0-\${file.size - 1}/\${file.size}\` }, body: file });\n  if (!upload.ok) throw new Error(\`Evidence upload failed with \${upload.status}.\`);\n  const completionPath = session.completionUrl || \`/api/v1/external/evidence/\${encodeURIComponent(grantToken)}/upload-session/\${encodeURIComponent(session.id)}/complete\`;\n  const completed = await externalRequest<{ photoId: string; sha256: string; generation: string }>(completionPath, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });\n`, 'external evidence upload transport');

  patchTenantPortal();
  patchRemoteInspection();
  patchEmulatorHarness();
}

function patchTenantPortal() {
  replaceOnce('apps/api/src/backend/tenantPortalRoutes.ts', "  type MaintenancePriority,\n  type UploadSessionRecord,\n} from '@pcr/domain';\nimport { firestoreDb } from '../firestoreDatabase.js';\nimport { authenticateAndAuthorise } from '../security/authoriseRequest.js';\nimport { FirestorePhotoEvidenceStore } from './photoEvidenceStore.js';", "  type MaintenancePriority,\n} from '@pcr/domain';\nimport { authenticateAndAuthorise } from '../security/authoriseRequest.js';", 'tenant evidence legacy imports');
  replaceOnce('apps/api/src/backend/tenantPortalRoutes.ts', "import { requireExternalGrantStore } from './runtimeDependencyGuards.js';", "import { requireEvidenceStore, requireExternalGrantStore } from './runtimeDependencyGuards.js';", 'tenant evidence provider import');
  replaceOnce('apps/api/src/backend/tenantPortalRoutes.ts', 'async function evidenceUploadSession(req: IncomingMessage, grant: TenantPortalGrant, dependencies: ApiDependencies, correlationId: string): Promise<ApiResponse> {', 'async function evidenceUploadSession(req: IncomingMessage, grant: TenantPortalGrant, rawToken: string, dependencies: ApiDependencies, correlationId: string): Promise<ApiResponse> {', 'tenant raw token');
  replaceOnce('apps/api/src/backend/tenantPortalRoutes.ts', "  return { status: 201, body: { data: { ...session, photoId: uploadId }, meta: { correlationId } } };\n}\n\nasync function evidenceComplete", `  const encodedToken = encodeURIComponent(rawToken);\n  const providerUrls = session.uploadProvider === 'appwrite' ? { binaryUploadUrl: \`/api/v1/external/evidence/\${encodedToken}/upload-session/\${encodeURIComponent(uploadId)}/binary\`, completionUrl: \`/api/v1/external/evidence/\${encodedToken}/upload-session/\${encodeURIComponent(uploadId)}/complete\` } : {};\n  return { status: 201, body: { data: { ...session, ...providerUrls, photoId: uploadId }, meta: { correlationId } } };\n}\n\nasync function evidenceComplete`, 'tenant provider URLs');
  replaceSection('apps/api/src/backend/tenantPortalRoutes.ts', 'async function evidenceComplete(', 'export async function routeTenantPortalRequest', `async function evidenceComplete(grant: TenantPortalGrant, dependencies: ApiDependencies, correlationId: string, uploadId: string): Promise<ApiResponse> {\n  const evidence = await requireEvidenceStore(dependencies).complete({ agencyId: grant.agencyId, uploadId, actorId: \`external:\${grant.id}\`, entityType: 'tenant_portal', entityId: grant.tenancyId, source: 'tenant_portal', category: 'inspection_evidence' });\n  await dependencies.audit.append({ id: randomUUID(), timestamp: new Date().toISOString(), actorId: \`external:\${grant.id}\`, actorRole: 'external', agencyId: grant.agencyId, capability: 'upload.create', outcome: 'allowed', reason: 'tenant_portal.evidence_upload_completed', target: { agencyId: grant.agencyId, tenancyId: grant.tenancyId }, correlationId, entityType: 'tenant_portal', entityId: grant.tenancyId, eventType: 'tenant_portal.evidence_upload_completed', metadata: { evidenceFileId: evidence.id, uploadId, sha256: evidence.checksum } });\n  return { status: 201, body: { data: { photoId: evidence.id, evidenceFileId: evidence.id, bucketId: evidence.bucketId, fileId: evidence.fileId, objectPath: evidence.fileId, generation: evidence.generation, sha256: evidence.checksum, contentType: evidence.mimeType }, meta: { correlationId } } };\n}\n\n`, 'tenant evidence completion');
  replaceOnce('apps/api/src/backend/tenantPortalRoutes.ts', "if (req.method === 'POST' && parts[5] === 'evidence' && parts[6] === 'upload-session' && !parts[7]) return evidenceUploadSession(req, grant, dependencies, correlationId);", "if (req.method === 'POST' && parts[5] === 'evidence' && parts[6] === 'upload-session' && !parts[7]) return evidenceUploadSession(req, grant, decodeURIComponent(parts[4]), dependencies, correlationId);", 'tenant upload route');

  replaceOnce('apps/web/services/platform/tenantPortalService.ts', 'const session = await externalRequest<{ id: string; status: string; resumableUploadUrl?: string; duplicatePhotoId?: string }>', 'const session = await externalRequest<{ id: string; status: string; resumableUploadUrl?: string; binaryUploadUrl?: string; completionUrl?: string; duplicatePhotoId?: string }>', 'tenant Appwrite upload fields');
  replaceSection('apps/web/services/platform/tenantPortalService.ts', "  if (!session.resumableUploadUrl) throw new Error('Evidence upload service is not configured.');", 'export async function signTenantPortalDocument', `  const baseUrl = import.meta.env.VITE_API_BASE_URL?.trim() || '';\n  const uploadUrl = session.binaryUploadUrl ? \`\${baseUrl.replace(/\\\/$/u, '')}\${session.binaryUploadUrl}\` : session.resumableUploadUrl;\n  if (!uploadUrl) throw new Error('Evidence upload service is not configured.');\n  const upload = await fetch(uploadUrl, { method: 'PUT', headers: session.binaryUploadUrl ? { 'content-type': contentType } : { 'content-type': contentType, 'content-range': \`bytes 0-\${file.size - 1}/\${file.size}\` }, body: file });\n  if (!upload.ok) throw new Error(\`Evidence upload failed with \${upload.status}.\`);\n  const completionPath = session.completionUrl || \`/api/v1/external/tenant-portal/\${encodeURIComponent(grantToken)}/evidence/upload-session/\${encodeURIComponent(session.id)}/complete\`;\n  return externalRequest(completionPath, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });\n}\n\n`, 'tenant evidence upload transport');
}

function patchRemoteInspection() {
  replaceOnce('apps/api/src/backend/remoteInspectionPortalRoutes.ts', "import { createHash, randomUUID } from 'node:crypto';", "import { randomUUID } from 'node:crypto';", 'remote crypto import');
  replaceOnce('apps/api/src/backend/remoteInspectionPortalRoutes.ts', "import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';\nimport { getStorage } from 'firebase-admin/storage';\nimport type { AuthenticatedPrincipal, UploadSessionRecord } from '@pcr/domain';\nimport { firestoreDb } from '../firestoreDatabase.js';\nimport { FirestorePhotoEvidenceStore } from './photoEvidenceStore.js';", "import type { AuthenticatedPrincipal } from '@pcr/domain';", 'remote Firebase imports');
  replaceOnce('apps/api/src/backend/remoteInspectionPortalRoutes.ts', "import { requireExternalGrantStore } from './runtimeDependencyGuards.js';", "import { requireEvidenceStore, requireExternalGrantStore } from './runtimeDependencyGuards.js';", 'remote provider import');
  replaceSection('apps/api/src/backend/remoteInspectionPortalRoutes.ts', 'function adminApp()', 'function routeParts', '', 'remote adminApp');
  replaceSection('apps/api/src/backend/remoteInspectionPortalRoutes.ts', 'async function completeUpload(', 'export async function routeRemoteInspectionPortalRequest', `async function completeUpload(deps: ApiDependencies, grant: PortalGrant, assignment: Record<string, unknown>, uploadId: string, correlationId: string): Promise<ApiResponse> {\n  const evidence = await requireEvidenceStore(deps).complete({ agencyId: grant.agencyId, uploadId, actorId: \`tenant-portal:\${grant.id}\`, entityType: 'remote_inspection', entityId: String(assignment.id), source: 'tenant', category: 'inspection_evidence' });\n  await deps.audit.append({ id: randomUUID(), timestamp: new Date().toISOString(), actorId: \`tenant-portal:\${grant.id}\`, actorRole: 'tenant', agencyId: grant.agencyId, capability: 'upload.create', outcome: 'allowed', reason: 'remote_inspection.evidence_upload_completed', target: { agencyId: grant.agencyId, tenancyId: grant.tenancyId, inspectionJobId: String(assignment.inspectionJobId || '') }, correlationId, entityType: 'remote_inspection_assignment', entityId: String(assignment.id), eventType: 'remote_inspection.evidence_upload_completed', metadata: { evidenceFileId: evidence.id, uploadId, generation: evidence.generation, sha256: evidence.checksum } });\n  return { status: 201, body: { data: { photoId: evidence.id, evidenceFileId: evidence.id, uploadSessionId: uploadId, generation: evidence.generation, sha256: evidence.checksum, contentType: evidence.mimeType }, meta: { correlationId } } };\n}\n\n`, 'remote evidence completion');
  replaceOnce('apps/api/src/backend/remoteInspectionPortalRoutes.ts', "externalResourceType: 'tenant_portal', externalResourceId: assignment.id", "externalResourceType: 'remote_inspection', externalResourceId: assignment.id", 'remote inspection scope');
  const oldSession = "if (req.method === 'POST' && route[6] === 'upload-session' && !route[7]) { const body = uploadBody(await readJson(req)); const uploadId = randomUUID(); const session = await deps.uploads.create(grant.agencyId, uploadId, { propertyId: String(assignment.propertyId || `tenancy-${grant.tenancyId}`), inspectionJobId: String(assignment.inspectionJobId), componentIds: [], fileName: body.fileName, contentType: body.contentType, size: body.size, sha256: body.sha256, mediaType: body.mediaType, externalGrantId: grant.id, externalResourceType: 'remote_inspection', externalResourceId: assignment.id }, externalPrincipal(grant)); return { status: 201, body: { data: { ...session, photoId: uploadId }, meta: { correlationId } } }; }";
  const newSession = "if (req.method === 'POST' && route[6] === 'upload-session' && !route[7]) { const body = uploadBody(await readJson(req)); const uploadId = randomUUID(); const session = await deps.uploads.create(grant.agencyId, uploadId, { propertyId: String(assignment.propertyId || `tenancy-${grant.tenancyId}`), inspectionJobId: String(assignment.inspectionJobId), componentIds: [], fileName: body.fileName, contentType: body.contentType, size: body.size, sha256: body.sha256, mediaType: body.mediaType, externalGrantId: grant.id, externalResourceType: 'remote_inspection', externalResourceId: assignment.id }, externalPrincipal(grant)); const encodedToken = encodeURIComponent(decodeURIComponent(route[4])); const providerUrls = session.uploadProvider === 'appwrite' ? { binaryUploadUrl: `/api/v1/external/evidence/${encodedToken}/upload-session/${encodeURIComponent(uploadId)}/binary`, completionUrl: `/api/v1/external/evidence/${encodedToken}/upload-session/${encodeURIComponent(uploadId)}/complete` } : {}; return { status: 201, body: { data: { ...session, ...providerUrls, photoId: uploadId }, meta: { correlationId } } }; }";
  replaceOnce('apps/api/src/backend/remoteInspectionPortalRoutes.ts', oldSession, newSession, 'remote upload session URLs');

  replaceOnce('apps/web/pages/external/RemoteInspectionPage.tsx', 'resumableUploadUrl?: string; duplicatePhotoId?: string', 'resumableUploadUrl?: string; binaryUploadUrl?: string; completionUrl?: string; duplicatePhotoId?: string', 'remote Appwrite fields');
  replaceSection('apps/web/pages/external/RemoteInspectionPage.tsx', "    if (!session.resumableUploadUrl) throw new Error('Remote inspection evidence upload is not configured.');", '  const addFiles', `    const baseUrl = import.meta.env.VITE_API_BASE_URL?.trim() || '';\n    const uploadUrl = session.binaryUploadUrl ? \`\${baseUrl.replace(/\\\/$/u, '')}\${session.binaryUploadUrl}\` : session.resumableUploadUrl;\n    if (!uploadUrl) throw new Error('Remote inspection evidence upload is not configured.');\n    const response = await fetch(uploadUrl, { method: 'PUT', headers: session.binaryUploadUrl ? { 'content-type': type } : { 'content-type': type, 'content-range': \`bytes 0-\${file.size - 1}/\${file.size}\` }, body: file }); if (!response.ok) throw new Error(\`Evidence upload failed with \${response.status}.\`);\n    const completionPath = session.completionUrl || \`/api/v1/external/remote-inspections/\${encodeURIComponent(grantToken)}/\${encodeURIComponent(assignmentId)}/upload-session/\${encodeURIComponent(session.id)}/complete\`;\n    const completed = await request<{ photoId: string }>(completionPath, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); return completed.photoId;\n  };\n\n  `, 'remote upload transport');
}

function patchEmulatorHarness() {
  replaceOnce('tests/emulator/externalEvidence.emulator.test.ts', "import { FirestoreExternalGrantStore } from '../../apps/api/src/backend/firestoreExternalGrantStore.js';\n", "import { FirestoreExternalGrantStore } from '../../apps/api/src/backend/firestoreExternalGrantStore.js';\nimport { FirestoreEvidenceStore } from '../../apps/api/src/backend/firestoreEvidenceStore.js';\n", 'emulator evidence import');
  replaceOnce('tests/emulator/externalEvidence.emulator.test.ts', '    externalGrants:\n      new FirestoreExternalGrantStore(),\n    reports:', '    externalGrants:\n      new FirestoreExternalGrantStore(),\n    evidence: new FirestoreEvidenceStore(),\n    reports:', 'emulator evidence dependency');
}
