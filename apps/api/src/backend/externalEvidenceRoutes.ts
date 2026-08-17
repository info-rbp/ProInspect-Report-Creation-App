import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { AuthenticatedPrincipal, ExternalAccessGrant } from '@pcr/domain';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies } from './types.js';

type VersionedGrant = ExternalAccessGrant & { version: number };

function adminApp() {
  return getApps()[0] ?? initializeApp({ credential: applicationDefault() });
}

function tokenHash(value: string): string {
  return createHash('sha256').update(value.trim()).digest('hex');
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) {
      throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'External evidence request exceeds 1 MB.');
    }
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Object required');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }
}

async function resolveGrant(rawToken: string): Promise<VersionedGrant> {
  const snapshot = await getFirestore(adminApp())
    .collectionGroup('externalAccessGrants')
    .where('tokenHash', '==', tokenHash(rawToken))
    .limit(2)
    .get();
  if (snapshot.empty) {
    throw new ApiError(401, 'INVALID_GRANT_TOKEN', 'Access link is invalid or expired.');
  }
  if (snapshot.size !== 1) {
    throw new ApiError(401, 'AMBIGUOUS_GRANT_TOKEN', 'Access link cannot be resolved safely.');
  }
  const grant = snapshot.docs[0].data() as VersionedGrant;
  if (!['work_request', 'tenant_instruction'].includes(grant.resourceType)) {
    throw new ApiError(403, 'GRANT_SCOPE_MISMATCH', 'This access link cannot upload evidence.');
  }
  if (grant.revokedAt) {
    throw new ApiError(401, 'GRANT_TOKEN_REVOKED', 'Access link has been revoked.');
  }
  if (new Date(grant.expiresAt).getTime() <= Date.now()) {
    throw new ApiError(401, 'GRANT_TOKEN_EXPIRED', 'Access link has expired.');
  }
  return grant;
}

function externalPrincipal(grant: VersionedGrant): AuthenticatedPrincipal {
  return {
    uid: `external:${grant.id}`,
    agencyId: grant.agencyId,
    role: 'operations',
    mfaVerified: false,
    tokenIssuedAt: Math.floor(Date.now() / 1000),
  };
}

function uploadInput(body: Record<string, unknown>) {
  const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';
  const contentType =
    typeof body.contentType === 'string' ? body.contentType.trim().toLowerCase() : '';
  const size = typeof body.size === 'number' ? body.size : Number(body.size);
  const sha256 = typeof body.sha256 === 'string' ? body.sha256.trim().toLowerCase() : '';
  if (!fileName) {
    throw new ApiError(400, 'FILE_NAME_REQUIRED', 'Evidence fileName is required.');
  }
  if (!['image/jpeg', 'image/png', 'image/heic', 'image/heif'].includes(contentType)) {
    throw new ApiError(
      400,
      'CONTENT_TYPE_UNSUPPORTED',
      'External evidence must be JPEG, PNG, HEIC or HEIF.',
    );
  }
  if (!Number.isFinite(size) || size <= 0 || size > 25 * 1024 * 1024) {
    throw new ApiError(
      400,
      'FILE_SIZE_INVALID',
      'External evidence must be between 1 byte and 25 MB.',
    );
  }
  if (!/^[a-f0-9]{64}$/u.test(sha256)) {
    throw new ApiError(
      400,
      'SHA256_REQUIRED',
      'A lowercase SHA-256 is required before evidence upload.',
    );
  }
  return { fileName, contentType, size, sha256 };
}

async function resourceContext(
  dependencies: ApiDependencies,
  grant: VersionedGrant,
): Promise<{
  propertyId: string;
  inspectionJobId: string;
  reportId?: string;
  areaId?: string;
  componentIds: string[];
}> {
  if (grant.resourceType === 'work_request') {
    const request = await dependencies.repository.get(
      'workRequests',
      grant.agencyId,
      grant.resourceId,
    );
    if (!request) {
      throw new ApiError(404, 'WORK_REQUEST_NOT_FOUND', 'Scoped Work Request no longer exists.');
    }
    const maintenanceId =
      typeof request.maintenanceItemId === 'string' ? request.maintenanceItemId : '';
    const item = maintenanceId
      ? await dependencies.repository.get('maintenanceItems', grant.agencyId, maintenanceId)
      : undefined;
    if (!item) {
      throw new ApiError(
        409,
        'MAINTENANCE_ITEM_REQUIRED',
        'Work Request is no longer linked to a Maintenance Item.',
      );
    }
    return {
      propertyId: String(item.propertyId),
      inspectionJobId:
        typeof item.sourceInspectionJobId === 'string' && item.sourceInspectionJobId
          ? item.sourceInspectionJobId
          : `maintenance-${maintenanceId}`,
      ...(typeof item.sourceReportId === 'string' && item.sourceReportId
        ? { reportId: item.sourceReportId }
        : {}),
      ...(typeof item.sourceAreaId === 'string' && item.sourceAreaId
        ? { areaId: item.sourceAreaId }
        : {}),
      componentIds:
        typeof item.sourceComponentId === 'string' && item.sourceComponentId
          ? [item.sourceComponentId]
          : [],
    };
  }

  const instruction = await dependencies.repository.get(
    'tenantInstructions',
    grant.agencyId,
    grant.resourceId,
  );
  if (!instruction) {
    throw new ApiError(
      404,
      'TENANT_INSTRUCTION_NOT_FOUND',
      'Scoped Tenant Instruction no longer exists.',
    );
  }
  const reportId = typeof instruction.sourceReportId === 'string' ? instruction.sourceReportId : '';
  let inspectionJobId = `tenant-instruction-${grant.resourceId}`;
  if (reportId) {
    const report = await dependencies.repository.get('reports', grant.agencyId, reportId);
    if (report && typeof report.inspectionJobId === 'string' && report.inspectionJobId) {
      inspectionJobId = report.inspectionJobId;
    }
  }
  return {
    propertyId: String(instruction.propertyId),
    inspectionJobId,
    ...(reportId ? { reportId } : {}),
    ...(typeof instruction.sourceAreaId === 'string' && instruction.sourceAreaId
      ? { areaId: instruction.sourceAreaId }
      : {}),
    componentIds:
      typeof instruction.sourceComponentId === 'string' && instruction.sourceComponentId
        ? [instruction.sourceComponentId]
        : [],
  };
}

export async function routeExternalEvidenceRequest(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
): Promise<ApiResponse | undefined> {
  const parts = new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean);
  if (
    parts.length !== 6 ||
    parts[0] !== 'api' ||
    parts[1] !== 'v1' ||
    parts[2] !== 'external' ||
    parts[3] !== 'evidence' ||
    !parts[4] ||
    parts[5] !== 'upload-session'
  ) {
    return undefined;
  }
  if (req.method !== 'POST') {
    throw new ApiError(
      405,
      'METHOD_NOT_ALLOWED',
      'External evidence upload session requires POST.',
    );
  }

  const grant = await resolveGrant(decodeURIComponent(parts[4]));
  const body = uploadInput(await readJson(req));
  const context = await resourceContext(dependencies, grant);
  const uploadId = randomUUID();
  const session = await dependencies.uploads.create(
    grant.agencyId,
    uploadId,
    {
      propertyId: context.propertyId,
      inspectionJobId: context.inspectionJobId,
      ...(context.reportId ? { reportId: context.reportId } : {}),
      ...(context.areaId ? { areaId: context.areaId } : {}),
      componentIds: context.componentIds,
      fileName: body.fileName,
      contentType: body.contentType,
      size: body.size,
      sha256: body.sha256,
      externalGrantId: grant.id,
      externalResourceType: grant.resourceType,
      externalResourceId: grant.resourceId,
    },
    externalPrincipal(grant),
  );

  await getFirestore(adminApp())
    .doc(`agencies/${grant.agencyId}/externalAccessGrants/${grant.id}`)
    .set({ lastAccessedAt: new Date().toISOString() }, { merge: true });
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
    metadata: { uploadId, fileName: body.fileName, sha256: body.sha256 },
  });

  return {
    status: 201,
    body: { data: { ...session, photoId: uploadId }, meta: { correlationId } },
  };
}
