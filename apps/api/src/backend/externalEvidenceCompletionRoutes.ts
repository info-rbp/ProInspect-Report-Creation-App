import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { ApiError, type ApiResponse } from './router.js';
import {
  requireEvidenceStore,
  requireExternalGrantStore,
} from './runtimeDependencyGuards.js';
import type {
  ApiDependencies,
  ExternalGrantRecord,
} from './types.js';

type VersionedGrant = ExternalGrantRecord;

async function resolveGrant(
  rawToken: string,
  dependencies: ApiDependencies,
): Promise<VersionedGrant> {
  return requireExternalGrantStore(dependencies).resolve(
    rawToken,
    [
      'work_request',
      'tenant_instruction',
      'report_distribution',
      'tenant_portal',
      'remote_inspection',
    ],
  );
}

function actorId(grant: VersionedGrant): string {
  return grant.resourceType === 'remote_inspection'
    ? `tenant-portal:${grant.id}`
    : `external:${grant.id}`;
}

async function readBinary(
  req: IncomingMessage,
  maxBytes = 100 * 1024 * 1024,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
      throw new ApiError(
        413,
        'PAYLOAD_TOO_LARGE',
        'Evidence binary exceeds the maximum upload size.',
      );
    }
    chunks.push(buffer);
  }
  if (!chunks.length) {
    throw new ApiError(
      400,
      'EVIDENCE_BINARY_REQUIRED',
      'Evidence binary content is required.',
    );
  }
  return Buffer.concat(chunks);
}

function routeParts(req: IncomingMessage): string[] {
  return new URL(req.url ?? '/', 'http://localhost')
    .pathname.split('/').filter(Boolean);
}

function sourceFor(grant: VersionedGrant): string {
  if (grant.resourceType === 'tenant_portal') return 'tenant_portal';
  if (grant.resourceType === 'remote_inspection') return 'tenant';
  return 'external_portal';
}

export async function routeExternalEvidenceCompletionRequest(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
): Promise<ApiResponse | undefined> {
  const parts = routeParts(req);
  if (
    parts.length !== 8
    || parts[0] !== 'api'
    || parts[1] !== 'v1'
    || parts[2] !== 'external'
    || parts[3] !== 'evidence'
    || !parts[4]
    || parts[5] !== 'upload-session'
    || !parts[6]
  ) return undefined;

  const operation = parts[7];
  if (!['binary', 'complete'].includes(operation)) return undefined;

  const grant = await resolveGrant(decodeURIComponent(parts[4]), dependencies);
  const uploadId = decodeURIComponent(parts[6]);
  const evidence = requireEvidenceStore(dependencies);
  const principal = actorId(grant);

  if (operation === 'binary') {
    if (req.method !== 'PUT') {
      throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'External evidence binary upload requires PUT.');
    }
    const bytes = await readBinary(req);
    const session = await evidence.uploadBinary({
      agencyId: grant.agencyId,
      uploadId,
      actorId: principal,
      entityType: String(grant.resourceType),
      entityId: grant.resourceId,
      contentType: req.headers['content-type']?.toString().split(';')[0]?.trim(),
      bytes,
    });
    await dependencies.audit.append({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      actorId: principal,
      actorRole: grant.resourceType === 'remote_inspection' ? 'tenant' : 'external',
      agencyId: grant.agencyId,
      capability: 'upload.create',
      outcome: 'allowed',
      reason: 'external.evidence_binary_uploaded',
      target: { agencyId: grant.agencyId },
      correlationId,
      entityType: String(grant.resourceType),
      entityId: grant.resourceId,
      eventType: 'external.evidence_binary_uploaded',
      metadata: { uploadId, bucketId: session.bucketId, fileId: session.fileId, sha256: session.checksum },
    });
    return { status: 204, body: undefined };
  }

  if (req.method !== 'POST') {
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'External evidence completion requires POST.');
  }
  const completed = await evidence.complete({
    agencyId: grant.agencyId,
    uploadId,
    actorId: principal,
    entityType: String(grant.resourceType),
    entityId: grant.resourceId,
    source: sourceFor(grant),
    category: 'inspection_evidence',
  });
  await dependencies.audit.append({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    actorId: principal,
    actorRole: grant.resourceType === 'remote_inspection' ? 'tenant' : 'external',
    agencyId: grant.agencyId,
    capability: 'upload.create',
    outcome: 'allowed',
    reason: 'external.evidence_upload_completed',
    target: { agencyId: grant.agencyId },
    correlationId,
    entityType: String(grant.resourceType),
    entityId: grant.resourceId,
    eventType: 'external.evidence_upload_completed',
    metadata: {
      evidenceFileId: completed.id,
      uploadId,
      bucketId: completed.bucketId,
      fileId: completed.fileId,
      generation: completed.generation,
      sha256: completed.checksum,
    },
  });
  return {
    status: 201,
    body: {
      data: {
        photoId: completed.id,
        evidenceFileId: completed.id,
        bucketId: completed.bucketId,
        fileId: completed.fileId,
        objectPath: completed.fileId,
        generation: completed.generation,
        sha256: completed.checksum,
        contentType: completed.mimeType,
      },
      meta: { correlationId },
    },
  };
}
