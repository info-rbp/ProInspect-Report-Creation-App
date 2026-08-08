import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { AuthorisationTarget, ReportAggregate, ReportLifecycleStatus } from '@pcr/domain';
import { reportAggregateSchema, workflowTransitionSchema } from '@pcr/validation';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import type { ApiResponse } from './router.js';
import type { ApiDependencies, IdempotencyResult } from './types.js';

const REPORT_STATUSES = new Set<ReportLifecycleStatus>([
  'draft', 'internal_review', 'photos_uploaded', 'analysis_queued', 'analysis_running', 'analysis_complete',
  'review_required', 'changes_requested', 'approved_for_issue', 'issued_to_tenant', 'tenant_response_in_progress',
  'tenant_submitted', 'agent_response_required', 'finalisation_ready', 'finalised', 'archived', 'cancelled',
]);

class ReportRouteError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: Record<string, unknown>) {
    super(message);
  }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 1_000_000) throw new ReportRouteError(413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 1 MB.');
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required');
    return parsed as Record<string, unknown>;
  } catch {
    throw new ReportRouteError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }
}

function parse<T>(result: { ok: true; value: T } | { ok: false; error: { status: number; code: string; message: string; details?: Record<string, unknown> } }): T {
  if (!result.ok) throw new ReportRouteError(result.error.status, result.error.code, result.error.message, result.error.details);
  return result.value;
}

function target(agencyId: string, reportId: string, aggregate: ReportAggregate, assignedUserId?: string): AuthorisationTarget {
  return {
    agencyId,
    reportId,
    ...(aggregate.report.propertyId ? { propertyId: aggregate.report.propertyId } : {}),
    ...(aggregate.report.tenancyId ? { tenancyId: aggregate.report.tenancyId } : {}),
    ...(aggregate.report.inspectionJobId ? { inspectionJobId: aggregate.report.inspectionJobId } : {}),
    lifecycleStatus: aggregate.report.lifecycleStatus,
    ...(assignedUserId ? { assignedReviewerId: assignedUserId } : {}),
  };
}

function idempotencyKey(req: IncomingMessage): string {
  const key = req.headers['idempotency-key']?.toString().trim();
  if (!key) throw new ReportRouteError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key is required for material writes.');
  if (key.length < 8 || key.length > 200) throw new ReportRouteError(400, 'IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key must contain 8 to 200 characters.');
  return key;
}

function hash(body: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

async function idempotent(
  dependencies: ApiDependencies,
  req: IncomingMessage,
  agencyId: string,
  operation: string,
  body: Record<string, unknown>,
  action: () => Promise<IdempotencyResult>,
): Promise<ApiResponse> {
  const execution = await dependencies.idempotency.execute(agencyId, operation, idempotencyKey(req), hash(body), action);
  return { status: execution.result.status, body: execution.result.body, headers: { 'idempotency-replayed': String(execution.replayed) } };
}

export async function routeReportAggregateRequest(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
  agencyId: string,
  reportId: string | undefined,
  command: string | undefined,
): Promise<ApiResponse | undefined> {
  if (!reportId) return undefined;

  if (req.method === 'GET' && command === 'aggregate') {
    const aggregate = await dependencies.reports.load(agencyId, reportId);
    if (!aggregate) throw new ReportRouteError(404, 'NOT_FOUND', 'Report not found.');
    const principal = await authenticateAndAuthorise(req, dependencies, 'report.read', target(agencyId, reportId, aggregate), correlationId);
    return { status: 200, body: { data: aggregate, meta: { correlationId, actor: principal.uid } } };
  }

  if ((req.method === 'PUT' || req.method === 'POST') && command === 'aggregate') {
    const body = await readJson(req);
    const aggregate = parse(reportAggregateSchema.parse(body)) as ReportAggregate;
    if (aggregate.report.id !== reportId || aggregate.report.agencyId !== agencyId) {
      throw new ReportRouteError(400, 'REPORT_ID_MISMATCH', 'Report and agency identifiers must match the request path and headers.');
    }
    const expectedVersion = body.expectedVersion;
    if (expectedVersion !== undefined && (typeof expectedVersion !== 'number' || !Number.isInteger(expectedVersion) || expectedVersion < 1)) {
      throw new ReportRouteError(400, 'EXPECTED_VERSION_INVALID', 'expectedVersion must be a positive integer.');
    }
    const principal = await authenticateAndAuthorise(req, dependencies, 'report.edit', target(agencyId, reportId, aggregate), correlationId);
    return idempotent(dependencies, req, agencyId, `reports:${reportId}:aggregate`, body, async () => {
      const stored = await dependencies.reports.saveDraft(aggregate, expectedVersion as number | undefined, principal.uid);
      return { status: expectedVersion === undefined ? 201 : 200, body: { data: stored, meta: { correlationId } } };
    });
  }

  if (req.method === 'POST' && command === 'transitions') {
    const body = await readJson(req);
    const transition = parse(workflowTransitionSchema.parse(body));
    if (!REPORT_STATUSES.has(transition.status as ReportLifecycleStatus)) {
      throw new ReportRouteError(400, 'INVALID_REPORT_STATUS', 'status is not a supported report lifecycle state.');
    }
    const aggregate = await dependencies.reports.load(agencyId, reportId);
    if (!aggregate) throw new ReportRouteError(404, 'NOT_FOUND', 'Report not found.');
    const principal = await authenticateAndAuthorise(req, dependencies, 'report.edit', target(agencyId, reportId, aggregate, transition.assignedUserId), correlationId);
    return idempotent(dependencies, req, agencyId, `reports:${reportId}:transition`, body, async () => {
      const stored = await dependencies.reports.transition(agencyId, {
        agencyId,
        reportId,
        status: transition.status as ReportLifecycleStatus,
        expectedVersion: transition.expectedVersion,
        actorId: principal.uid,
        actorRole: principal.role,
        correlationId,
        ...(transition.reason ? { reason: transition.reason } : {}),
        ...(transition.assignedUserId ? { assignedUserId: transition.assignedUserId } : {}),
      });
      return { status: 200, body: { data: stored, meta: { correlationId } } };
    });
  }

  return undefined;
}
