import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type {
  AuthenticatedPrincipal,
  ExternalAccessGrant,
  MaintenanceItem,
  TenantInstruction,
  WorkRequest,
} from '@pcr/domain';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies } from './types.js';

type Versioned<T> = T & { version: number };

function adminApp() {
  return getApps()[0] ?? initializeApp({ credential: applicationDefault() });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 250_000) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'External evidence session payload exceeds 250 KB.');
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Object required');
    return parsed as Record<string, unknown>;
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }
}

function hashToken(value: string): string {
  return createHash('sha256').update(value.trim()).digest('hex');
}

async function resolveGrant(rawToken: string): Promise<Versioned<ExternalAccessGrant>> {
  const snapshot = await getFirestore(adminApp())
    .collectionGroup('externalAccessGrants')
    .where('tokenHash', '==', hashToken(rawToken))
    .limit(2)
    .get();
  if (snapshot.empty) throw new ApiError(401, 'INVALID_GRANT_TOKEN', 'Access link is invalid or expired.');
  if (snapshot.size !== 1) throw new ApiError(401, 'AMBIGUOUS_GRANT_TOKEN', 'Access link cannot be resolved safely.');
  const grant = snapshot.docs[0].data() as Versioned<ExternalAccessGrant>;
  if (!['work_request', 'tenant_instruction'].includes(grant.resourceType)) {
    throw new ApiError(403, 'GRANT_SCOPE_MISMATCH', 'This access link cannot upload evidence.');
  }
  if (grant.revokedAt) throw new ApiError(401, 'GRANT_TOKEN_REVOKED', 'Access link has been revoked.');
  if (new Date(grant.expiresAt).getTime() <= Date.now()) throw new ApiError(401, 'GRANT_TOKEN_EXPIRED', 'Access link has expired.');
  await snapshot.docs[0].ref.update({ lastAccessedAt: new Date().toISOString() });
  return grant;
}

async function load<T>(dependencies: ApiDependencies, collection: string, agencyId: string, id: string): Promise<Versioned<T>> {
  const value = await dependencies.repository.get(collection, agencyId, id);
  if (!value) throw new ApiError(404, 'GRANT_RESOURCE_NOT_FOUND', 'The resource linked to this access grant no longer exists.');
  return value as unknown as Versioned<T>;
}

function uploadInput(body: Record<string, unknown>): { fileName: string; contentType: string; size: number; sha256: string } {
  const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';
  const contentType = typeof body.contentType === 'string' ? body.contentType.trim().toLowerCase() : '';
  const size = typeof body.size === 'number' ? body.size : NaN;
  const sha256 = typeof body.sha256 === 'string' ? body.sha256.trim().toLowerCase() : '';
  if (!fileName || fileName.length > 240) throw new ApiError(400, 'INVALID_FILENAME', 'A valid evidence filename is required.');
  if (!['image/jpeg', 'image/png', 'image/heic', 'image/heif'].includes(contentType)) {
    throw new ApiError(400, 'INVALID_EVIDENCE_TYPE', 'External evidence must be JPEG, PNG, HEIC or HEIF imagery.');
  }
  if (!Number.isFinite(size) || size < 1 || size > 25 * 1024 * 1024) {
    throw new ApiError(400, 'INVALID_EVIDENCE_SIZE', 'External evidence must be between 1 byte and 25 MB.');
  }
  if (!/^[a-f0-9]{64}$/u.test(sha256)) throw new ApiError(400, 'INVALID_EVIDENCE_HASH', 'A SHA-256 hash is required.');
  return { fileName, contentType, size, sha256 };
}

function externalPrincipal(grant: ExternalAccessGrant): AuthenticatedPrincipal {
  return {
    uid: `external:${grant.id}`,
    agencyId: grant.agencyId,
    role: 'operations',
    mfaVerified: false,
    tokenIssuedAt: Math.floor(Date.now() / 1000),
  };
}

async function resourceContext(dependencies: ApiDependencies, grant: ExternalAccessGrant): Promise<{
  propertyId: string;
  inspectionJobId: string;
  reportId?: string;
  areaId?: string;
  componentIds: string[];
}> {
  if (grant.resourceType === 'work_request') {
    const workRequest = await load<WorkRequest>(dependencies, 'workRequests', grant.agencyId, grant.resourceId);
    const maintenance = await load<MaintenanceItem>(dependencies, 'maintenanceItems', grant.agencyId, workRequest.maintenanceItemId);
    return {
      propertyId: maintenance.propertyId,
      inspectionJobId: maintenance.sourceInspectionJobId || `external-work-request-${workRequest.id}`,
      ...(maintenance.sourceReportId ? { reportId: maintenance.sourceReportId } : {}),
      ...(maintenance.sourceAreaId ? { areaId: maintenance.sourceAreaId } : {}),
      componentIds: maintenance.sourceComponentId ? [maintenance.sourceComponentId] : [],
    };
  }
  const instruction = await load<TenantInstruction>(dependencies, 'tenantInstructions', grant.agencyId, grant.resourceId);
  let inspectionJobId = `external-tenant-instruction-${instruction.id}`;
  if (instruction.sourceReportId) {
    const report = await dependencies.reports.load(grant.agencyId, instruction.sourceReportId);
    if (report?.report.inspectionJobId) inspectionJobId = report.report.inspectionJobId;
  }
  return {
    propertyId: instruction.propertyId,
    inspectionJobId,
    ...(instruction.sourceReportId ? { reportId: instruction.sourceReportId } : {}),
    ...(instruction.sourceAreaId ? { areaId: instruction.sourceAreaId } : {}),
    componentIds: instruction.sourceComponentId ? [instruction.sourceComponentId] : [],
  };
}

async function audit(dependencies: ApiDependencies, grant: ExternalAccessGrant, photoId: string, correlationId: string): Promise<void> {
  await dependencies.audit.append({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    actorId: `external:${grant.id}`,
    actorRole: 'external',
    agencyId: grant.agencyId,
    capability: 'upload.create',
    outcome: 'allowed',
    reason: 'external.evidence_upload_session_created',
    target: { agencyId: grant.agencyId },
    correlationId,
    entityType: grant.resourceType,
    entityId: grant.resourceId,
    eventType: 'external.evidence_upload_session_created',
    metadata: { photoId },
  });
}

export async function routeExternalEvidenceRequest(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
): Promise<ApiResponse | undefined> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'api' || parts[1] !== 'v1' || parts[2] !== 'external' || parts[3] !== 'evidence' || !parts[4] || parts[5] !== 'upload-session') {
    return undefined;
  }
  if (req.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'External evidence upload sessions require POST.');
  const grant = await resolveGrant(decodeURIComponent(parts[4]));
  const input = uploadInput(await readJson(req));
  const context = await resourceContext(dependencies, grant);
  const uploadId = randomUUID();
  const session = await dependencies.uploads.create(grant.agencyId, uploadId, {
    ...input,
    propertyId: context.propertyId,
    inspectionJobId: context.inspectionJobId,
    ...(context.reportId ? { reportId: context.reportId } : {}),
    ...(context.areaId ? { areaId: context.areaId } : {}),
    componentIds: context.componentIds,
    externalGrantId: grant.id,
    externalResourceType: grant.resourceType,
    externalResourceId: grant.resourceId,
  }, externalPrincipal(grant));
  await audit(dependencies, grant, uploadId, correlationId);
  return { status: 201, body: { data: { ...session, photoId: uploadId }, meta: { correlationId } } };
}
