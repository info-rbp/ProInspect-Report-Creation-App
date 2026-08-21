import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import {
  MAINTENANCE_CATEGORIES,
  MAINTENANCE_PRIORITIES,
  inferMaintenanceIssueType,
  maintenanceSlaDueAt,
  type MaintenanceCandidate,
  type MaintenanceCategory,
  type MaintenanceItem,
  type MaintenancePriority,
} from '@pcr/domain';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies, IdempotencyResult } from './types.js';

function parts(req: IncomingMessage): string[] {
  return new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean);
}

function agencyHeader(req: IncomingMessage): string {
  const value = req.headers['x-agency-id']?.toString().trim();
  if (!value) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.');
  return value;
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (!chunks.length) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required');
    return parsed as Record<string, unknown>;
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }
}

function key(req: IncomingMessage): string {
  const value = req.headers['idempotency-key']?.toString().trim();
  if (!value || value.length < 8 || value.length > 200) throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key is required.');
  return value;
}

async function idempotent(
  dependencies: ApiDependencies,
  req: IncomingMessage,
  agencyId: string,
  operation: string,
  body: Record<string, unknown>,
  action: () => Promise<IdempotencyResult>,
): Promise<ApiResponse> {
  const execution = await dependencies.idempotency.execute(
    agencyId,
    operation,
    key(req),
    createHash('sha256').update(JSON.stringify(body)).digest('hex'),
    action,
  );
  return {
    status: execution.result.status,
    body: execution.result.body,
    headers: { 'idempotency-replayed': String(execution.replayed) },
  };
}

export async function routeMaintenanceCandidateCommercialRequest(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
): Promise<ApiResponse | undefined> {
  const route = parts(req);
  if (
    route[0] !== 'api' ||
    route[1] !== 'v1' ||
    route[2] !== 'maintenance-candidates' ||
    !route[3] ||
    route[4] !== 'confirm'
  ) {
    return undefined;
  }
  if (req.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Candidate confirmation requires POST.');
  const agencyId = agencyHeader(req);
  const body = await readJson(req);
  const candidateRecord = await dependencies.repository.get('maintenanceCandidates', agencyId, route[3]);
  if (!candidateRecord) throw new ApiError(404, 'CANDIDATE_NOT_FOUND', 'Maintenance candidate was not found.');
  const candidate = candidateRecord as unknown as MaintenanceCandidate & { version: number };
  if (candidate.reviewStatus !== 'suggested') {
    if (candidate.confirmedMaintenanceItemId) {
      const existing = await dependencies.repository.get('maintenanceItems', agencyId, candidate.confirmedMaintenanceItemId);
      if (existing) return { status: 200, body: { data: existing, meta: { correlationId, existing: true } } };
    }
    throw new ApiError(409, 'CANDIDATE_ALREADY_REVIEWED', `Candidate is already ${candidate.reviewStatus}.`);
  }
  const principal = await authenticateAndAuthorise(
    req,
    dependencies,
    'maintenance.triage',
    {
      agencyId,
      propertyId: candidate.propertyId,
      ...(candidate.tenancyId ? { tenancyId: candidate.tenancyId } : {}),
      ...(candidate.reportId ? { reportId: candidate.reportId } : {}),
    },
    correlationId,
  );
  return idempotent(dependencies, req, agencyId, `maintenance-candidate:${candidate.id}:confirm`, body, async () => {
    const category =
      typeof body.category === 'string' && (MAINTENANCE_CATEGORIES as readonly string[]).includes(body.category)
        ? (body.category as MaintenanceCategory)
        : candidate.category;
    const priority =
      typeof body.priority === 'string' && (MAINTENANCE_PRIORITIES as readonly string[]).includes(body.priority)
        ? (body.priority as MaintenancePriority)
        : candidate.suggestedPriority;
    const approvalRequired = body.approvalRequired !== false;
    const itemId = randomUUID();
    const now = new Date().toISOString();
    const item: MaintenanceItem = {
      id: itemId,
      agencyId,
      propertyId: candidate.propertyId,
      ...(candidate.tenancyId ? { tenancyId: candidate.tenancyId } : {}),
      ...(candidate.reportId ? { sourceReportId: candidate.reportId } : {}),
      ...(candidate.reportVersionId ? { sourceReportVersionId: candidate.reportVersionId } : {}),
      ...(candidate.inspectionJobId ? { sourceInspectionJobId: candidate.inspectionJobId } : {}),
      ...(candidate.areaId ? { sourceAreaId: candidate.areaId } : {}),
      ...(candidate.componentId ? { sourceComponentId: candidate.componentId } : {}),
      ...(candidate.observationId ? { sourceObservationId: candidate.observationId } : {}),
      candidateId: candidate.id,
      title: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : candidate.title,
      description:
        typeof body.description === 'string' && body.description.trim()
          ? body.description.trim()
          : candidate.description,
      category,
      priority,
      status: 'triage_required',
      sourceEvidenceIds: candidate.evidencePhotoIds,
      approvalRequired,
      approvalStatus: approvalRequired ? 'pending' : 'not_required',
      ...(typeof body.workInstruction === 'string' && body.workInstruction.trim()
        ? { workInstruction: body.workInstruction.trim() }
        : {}),
      verificationStatus: 'unverified',
      issueType: candidate.issueType || inferMaintenanceIssueType(candidate),
      recommendedAction:
        typeof body.recommendedAction === 'string' && body.recommendedAction.trim()
          ? body.recommendedAction.trim()
          : candidate.recommendedAction,
      safetyClassification: candidate.safetyClassification || 'none',
      pricingStatus: 'not_started',
      slaDueAt: maintenanceSlaDueAt(priority),
      slaStatus: 'on_track',
      warrantyReviewStatus: 'not_checked',
      responsibility: 'unknown',
      createdBy: principal.uid,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    const stored = await dependencies.repository.create(
      'maintenanceItems',
      agencyId,
      itemId,
      item as unknown as Record<string, unknown>,
      principal.uid,
    );
    await dependencies.repository.update(
      'maintenanceCandidates',
      agencyId,
      candidate.id,
      {
        reviewStatus: 'confirmed',
        confirmedMaintenanceItemId: itemId,
        pricingStatus: 'not_started',
      },
      Number(candidateRecord.version),
      principal.uid,
    );
    await dependencies.audit.append({
      id: randomUUID(),
      timestamp: now,
      actorId: principal.uid,
      actorRole: principal.role,
      agencyId,
      capability: 'maintenance.triage',
      outcome: 'allowed',
      reason: 'maintenance.candidate_confirmed',
      target: { agencyId, propertyId: item.propertyId, maintenanceItemId: itemId },
      correlationId,
      entityType: 'maintenance_item',
      entityId: itemId,
      eventType: 'maintenance.candidate_confirmed',
      metadata: {
        candidateId: candidate.id,
        reportId: candidate.reportId,
        reportVersionId: candidate.reportVersionId,
        approvalRequired,
      },
    });
    return { status: 201, body: { data: stored, meta: { correlationId } } };
  });
}
