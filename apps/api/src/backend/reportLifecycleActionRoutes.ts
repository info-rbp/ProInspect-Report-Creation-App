import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { ReportLifecycleStatus, SecurityCapability } from '@pcr/domain';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies } from './types.js';

function agencyHeader(req: IncomingMessage): string {
  const agencyId = req.headers['x-agency-id']?.toString().trim();
  if (!agencyId) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.');
  return agencyId;
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (!chunks.length) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Object required');
    return parsed as Record<string, unknown>;
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }
}

function capabilityFor(status: ReportLifecycleStatus): SecurityCapability {
  if (status === 'approved_for_issue' || status === 'changes_requested') return 'report.review';
  if (['issued_to_tenant', 'tenant_response_in_progress', 'tenant_submitted', 'agent_response_required', 'finalisation_ready'].includes(status)) return 'report.issue';
  if (status === 'finalised' || status === 'archived') return 'report.finalise';
  return 'report.edit';
}

export async function routeReportLifecycleActionRequest(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
): Promise<ApiResponse | undefined> {
  const parts = new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean);
  if (
    parts.length !== 6 ||
    parts[0] !== 'api' ||
    parts[1] !== 'v1' ||
    parts[2] !== 'report-actions' ||
    !parts[3] ||
    parts[4] !== 'lifecycle' ||
    parts[5] !== 'transition'
  ) return undefined;
  if (req.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Report lifecycle transition requires POST.');

  const agencyId = agencyHeader(req);
  const reportId = decodeURIComponent(parts[3]);
  const body = await readJson(req);
  const status = typeof body.status === 'string' ? body.status as ReportLifecycleStatus : undefined;
  const expectedVersion = typeof body.expectedVersion === 'number' ? body.expectedVersion : undefined;
  if (!status || !expectedVersion) throw new ApiError(400, 'TRANSITION_INPUT_REQUIRED', 'status and expectedVersion are required.');

  const aggregate = await dependencies.reports.load(agencyId, reportId);
  if (!aggregate) throw new ApiError(404, 'REPORT_NOT_FOUND', 'Report not found.');
  const job = aggregate.report.inspectionJobId
    ? await dependencies.repository.get('inspectionJobs', agencyId, aggregate.report.inspectionJobId)
    : undefined;
  const capability = capabilityFor(status);
  const principal = await authenticateAndAuthorise(req, dependencies, capability, {
    agencyId,
    reportId,
    ...(aggregate.report.propertyId ? { propertyId: aggregate.report.propertyId } : {}),
    ...(aggregate.report.tenancyId ? { tenancyId: aggregate.report.tenancyId } : {}),
    ...(aggregate.report.inspectionJobId ? { inspectionJobId: aggregate.report.inspectionJobId } : {}),
    ...(typeof job?.assignedInspectorId === 'string' ? { assignedInspectorId: job.assignedInspectorId } : {}),
    ...(typeof job?.assignedAnalystId === 'string' ? { assignedAnalystId: job.assignedAnalystId } : {}),
    ...(typeof job?.assignedReviewerId === 'string' ? { assignedReviewerId: job.assignedReviewerId } : {}),
    lifecycleStatus: aggregate.report.lifecycleStatus,
  }, correlationId);

  if (status === 'approved_for_issue' && (job?.assignedInspectorId === principal.uid || job?.assignedAnalystId === principal.uid)) {
    throw new ApiError(403, 'SEPARATION_OF_DUTIES_VIOLATION', 'An assigned inspector or analyst cannot approve their own report for issue.');
  }

  const key = req.headers['idempotency-key']?.toString().trim();
  if (!key) throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key is required.');
  const payloadHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  const result = await dependencies.idempotency.execute(
    agencyId,
    `report:${reportId}:lifecycle:${status}`,
    key,
    payloadHash,
    async () => {
      const stored = await dependencies.reports.transition(agencyId, {
        agencyId,
        reportId,
        status,
        expectedVersion,
        actorId: principal.uid,
        actorRole: principal.role,
        correlationId,
        ...(typeof body.reason === 'string' && body.reason.trim() ? { reason: body.reason.trim() } : {}),
        ...(typeof body.assignedUserId === 'string' && body.assignedUserId.trim() ? { assignedUserId: body.assignedUserId.trim() } : {}),
      });
      await dependencies.audit.append({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        actorId: principal.uid,
        actorRole: principal.role,
        agencyId,
        capability,
        outcome: 'allowed',
        reason: 'report.lifecycle.transition',
        target: { agencyId, reportId },
        correlationId,
        entityType: 'report',
        entityId: reportId,
        eventType: 'report.lifecycle.transition',
        metadata: { from: aggregate.report.lifecycleStatus, to: status },
      });
      return { status: 200, body: { data: stored, meta: { correlationId } } };
    },
  );
  return {
    status: result.result.status,
    body: result.result.body,
    headers: { 'idempotency-replayed': String(result.replayed) },
  };
}
