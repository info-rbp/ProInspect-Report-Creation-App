import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { AuthenticatedPrincipal } from '@pcr/domain';
import { ApiError, type ApiResponse } from './router.js';
import { requireEvidenceStore, requireExternalGrantStore } from './runtimeDependencyGuards.js';
import type {
  ApiDependencies,
  ExternalGrantRecord,
} from './types.js';

type PortalGrant =
  ExternalGrantRecord & {
    resourceType: 'remote_inspection';
    tenantId: string;
    tenancyId: string;
  };

function remoteInspectionGrant(
  grant: ExternalGrantRecord,
): PortalGrant {
  const tenantId = grant.tenantId?.trim();
  const tenancyId = grant.tenancyId?.trim();

  if (
    grant.resourceType !== 'remote_inspection'
    || !grant.resourceId
    || !tenantId
    || !tenancyId
  ) {
    throw new ApiError(
      409,
      'REMOTE_INSPECTION_GRANT_SCOPE_INCOMPLETE',
      'Remote inspection grant is missing required scope.',
    );
  }

  return {
    ...grant,
    resourceType: 'remote_inspection',
    tenantId,
    tenancyId,
  };
}

// Stage 2E: Firebase admin helper removed; Appwrite evidence provider is authoritative.
function parts(req: IncomingMessage) { return new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean); }
async function readJson(req: IncomingMessage) { const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); if (!chunks.length) return {}; const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'INVALID_JSON', 'Request body must be an object.'); return value as Record<string, unknown>; }
async function resolveGrant(
  token: string,
  deps: ApiDependencies,
): Promise<PortalGrant> {
  const grant =
    await requireExternalGrantStore(
      deps,
    ).resolve(
      token,
      ['remote_inspection'],
    );

  return remoteInspectionGrant(grant);
}


async function listAll(deps: ApiDependencies, collection: string, agency: string) { const result = []; let cursor: string | undefined; do { const page = await deps.repository.list(collection, agency, 100, cursor); result.push(...page.items); cursor = page.nextCursor; } while (cursor); return result; }
function externalPrincipal(grant: PortalGrant): AuthenticatedPrincipal { return { uid: `tenant-portal:${grant.id}`, agencyId: grant.agencyId, role: 'tenant', mfaVerified: false, tokenIssuedAt: Math.floor(Date.now() / 1000) }; }
function uploadBody(body: Record<string, unknown>) { const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : ''; const contentType = typeof body.contentType === 'string' ? body.contentType.trim().toLowerCase() : ''; const size = Number(body.size); const sha256 = typeof body.sha256 === 'string' ? body.sha256.trim().toLowerCase() : ''; const allowed = ['image/jpeg','image/png','image/heic','image/heif','video/mp4','video/quicktime','audio/mpeg','audio/mp4','audio/webm']; if (!fileName) throw new ApiError(400, 'FILE_NAME_REQUIRED', 'Evidence fileName is required.'); if (!allowed.includes(contentType)) throw new ApiError(400, 'CONTENT_TYPE_UNSUPPORTED', 'Unsupported remote inspection evidence type.'); if (!Number.isFinite(size) || size <= 0 || size > 100 * 1024 * 1024) throw new ApiError(400, 'FILE_SIZE_INVALID', 'Remote inspection evidence must be between 1 byte and 100 MB.'); if (!/^[a-f0-9]{64}$/u.test(sha256)) throw new ApiError(400, 'SHA256_REQUIRED', 'A lowercase SHA-256 is required before evidence upload.'); const mediaType = contentType.startsWith('video/') ? 'video' : contentType.startsWith('audio/') ? 'audio' : 'photo'; return { fileName, contentType, size, sha256, mediaType }; }

async function completeUpload(deps: ApiDependencies, grant: PortalGrant, assignment: Record<string, unknown>, uploadId: string, correlationId: string): Promise<ApiResponse> {
  const evidence = await requireEvidenceStore(deps).complete({ agencyId: grant.agencyId, uploadId, actorId: `tenant-portal:${grant.id}`, entityType: 'remote_inspection', entityId: String(assignment.id), source: 'tenant', category: 'inspection_evidence' });
  await deps.audit.append({ id: randomUUID(), timestamp: new Date().toISOString(), actorId: `tenant-portal:${grant.id}`, actorRole: 'tenant', agencyId: grant.agencyId, capability: 'upload.create', outcome: 'allowed', reason: 'remote_inspection.evidence_upload_completed', target: { agencyId: grant.agencyId, tenancyId: grant.tenancyId, inspectionJobId: String(assignment.inspectionJobId || '') }, correlationId, entityType: 'remote_inspection_assignment', entityId: String(assignment.id), eventType: 'remote_inspection.evidence_upload_completed', metadata: { evidenceFileId: evidence.id, uploadId, generation: evidence.generation, sha256: evidence.checksum } });
  return { status: 201, body: { data: { photoId: evidence.id, evidenceFileId: evidence.id, uploadSessionId: uploadId, generation: evidence.generation, sha256: evidence.checksum, contentType: evidence.mimeType }, meta: { correlationId } } };
}

export async function routeRemoteInspectionPortalRequest(req: IncomingMessage, deps: ApiDependencies, correlationId: string): Promise<ApiResponse | undefined> {
  const route = parts(req); if (route[0] !== 'api' || route[1] !== 'v1' || route[2] !== 'external' || route[3] !== 'remote-inspections' || !route[4]) return undefined;
  const grant = await resolveGrant(
    route[4],
    deps,
  ); const assignmentId = route[5];
  if (
    req.method === 'GET'
    && !assignmentId
  ) {
    const assignments = (
      await listAll(
        deps,
        'remoteInspectionAssignments',
        grant.agencyId,
      )
    ).filter(
      (item) =>
        item.id === grant.resourceId
        && item.tenantId === grant.tenantId
        && item.tenancyId === grant.tenancyId
        && ![
          'accepted',
          'rejected',
          'expired',
        ].includes(String(item.status)),
    );

    return {
      status: 200,
      body: {
        data: assignments,
        meta: { correlationId },
      },
    };
  }
  if (!assignmentId) return undefined;

  if (assignmentId !== grant.resourceId) {
    throw new ApiError(
      404,
      'REMOTE_INSPECTION_NOT_FOUND',
      'Remote inspection assignment was not found.',
    );
  }

  const assignment = await deps.repository.get('remoteInspectionAssignments', grant.agencyId, assignmentId); if (!assignment || assignment.tenantId !== grant.tenantId || assignment.tenancyId !== grant.tenancyId) throw new ApiError(404, 'REMOTE_INSPECTION_NOT_FOUND', 'Remote inspection assignment was not found.');
  if (req.method === 'GET' && !route[6]) return { status: 200, body: { data: assignment, meta: { correlationId } } };
  if (req.method === 'POST' && route[6] === 'upload-session' && !route[7]) { const body = uploadBody(await readJson(req)); const uploadId = randomUUID(); const session = await deps.uploads.create(grant.agencyId, uploadId, { propertyId: String(assignment.propertyId || `tenancy-${grant.tenancyId}`), inspectionJobId: String(assignment.inspectionJobId), componentIds: [], fileName: body.fileName, contentType: body.contentType, size: body.size, sha256: body.sha256, mediaType: body.mediaType, externalGrantId: grant.id, externalResourceType: 'remote_inspection', externalResourceId: assignment.id }, externalPrincipal(grant)); const encodedToken = encodeURIComponent(decodeURIComponent(route[4])); const providerUrls = session.uploadProvider === 'appwrite' ? { binaryUploadUrl: `/api/v1/external/evidence/${encodedToken}/upload-session/${encodeURIComponent(uploadId)}/binary`, completionUrl: `/api/v1/external/evidence/${encodedToken}/upload-session/${encodeURIComponent(uploadId)}/complete` } : {}; return { status: 201, body: { data: { ...session, ...providerUrls, photoId: uploadId }, meta: { correlationId } } }; }
  if (req.method === 'POST' && route[6] === 'upload-session' && route[7] && route[8] === 'complete') return completeUpload(deps, grant, assignment, route[7], correlationId);
  if (req.method === 'POST' && route[6] === 'submit') {
    const body = await readJson(req); const requirementId = String(body.requirementId || ''); if (!requirementId) throw new ApiError(400, 'REQUIREMENT_REQUIRED', 'requirementId is required.'); const evidenceIds = Array.isArray(body.evidenceIds) ? body.evidenceIds.filter((item): item is string => typeof item === 'string') : []; const requirements = Array.isArray(assignment.requirements) ? assignment.requirements as Array<Record<string, unknown>> : []; const requirement = requirements.find((item) => String(item.id) === requirementId); if (!requirement) throw new ApiError(404, 'REQUIREMENT_NOT_FOUND', 'Inspection requirement was not found.'); const requiredCount = Number(requirement.requiredEvidenceCount || 0); if (evidenceIds.length < requiredCount) throw new ApiError(409, 'EVIDENCE_REQUIRED', `At least ${requiredCount} evidence item(s) are required.`); const commentaryRequired = requirement.commentaryRequired === true; if (commentaryRequired && !String(body.commentary || '').trim()) throw new ApiError(409, 'COMMENTARY_REQUIRED', 'Commentary is required for this inspection item.'); const submission = await deps.repository.create('remoteInspectionSubmissions', grant.agencyId, randomUUID(), { assignmentId, requirementId, tenantId: grant.tenantId, commentary: body.commentary, evidenceIds, source: 'tenant', submittedAt: new Date().toISOString(), reviewStatus: 'pending' }, `tenant-portal:${grant.id}`); const all = (await listAll(deps, 'remoteInspectionSubmissions', grant.agencyId)).filter((item) => item.assignmentId === assignmentId); const completed = new Set(all.map((item) => String(item.requirementId))); completed.add(requirementId); if (requirements.every((item) => completed.has(String(item.id)))) await deps.repository.update('remoteInspectionAssignments', grant.agencyId, assignmentId, { status: 'submitted', submittedAt: new Date().toISOString() }, Number(assignment.version), `tenant-portal:${grant.id}`); else if (assignment.status === 'issued') await deps.repository.update('remoteInspectionAssignments', grant.agencyId, assignmentId, { status: 'in_progress' }, Number(assignment.version), `tenant-portal:${grant.id}`); return { status: 201, body: { data: submission, meta: { correlationId } } };
  }
  return undefined;
}
