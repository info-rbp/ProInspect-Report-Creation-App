import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  calculateWorkflowGateContext,
  INSPECTION_TRANSITION_MATRIX,
  REPORT_TRANSITION_MATRIX,
  missingInspectionTransitionGates,
  missingReportTransitionGates,
  transitionInspectionJob,
  WorkflowError,
  type DomainErrorShape,
  type InspectionJobStatus,
  type ReportLifecycleStatus,
  type SecurityCapability,
  type UserRole,
} from '@pcr/domain';
import {
  resourceWriteSchema,
  taskCreationSchema,
  tenantResponseSchema,
  uploadSessionSchema,
  workflowTransitionSchema,
} from '@pcr/validation';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { ROUTE_POLICIES } from './routeCatalog.js';
import type { ApiDependencies, IdempotencyResult } from './types.js';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export interface ApiResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

const PROTECTED_WORKFLOW_FIELDS = new Set([
  'status',
  'lifecycleStatus',
  'finalisedAt',
  'issuedAt',
  'archivedAt',
  'reviewStatus',
  'finalPdfUrl',
  'finalPdfReportVersionId',
  'finalPdfObjectPath',
  'finalPdfSha256',
  'finalPdfGeneration',
  'renderManifestObjectPath',
  'renderManifestSha256',
  'pdfGeneratedAt',
  'archiveManifestObjectPath',
  'archiveManifestSha256',
]);

function mapJobStatusToReportStatus(status: InspectionJobStatus): ReportLifecycleStatus | undefined {
  const map: Partial<Record<InspectionJobStatus, ReportLifecycleStatus>> = {
    draft: 'draft',
    booked: 'draft',
    assigned: 'draft',
    inspection_started: 'draft',
    photos_uploading: 'draft',
    photos_uploaded: 'photos_uploaded',
    inspection_submitted: 'internal_review',
    analysis_queued: 'analysis_queued',
    analysis_running: 'analysis_running',
    analysis_complete: 'analysis_complete',
    analyst_review_in_progress: 'internal_review',
    review_required: 'review_required',
    reviewer_review_in_progress: 'internal_review',
    changes_requested: 'changes_requested',
    reviewer_approved: 'approved_for_issue',
    ready_to_issue: 'approved_for_issue',
    issued_to_tenant: 'issued_to_tenant',
    tenant_response_in_progress: 'tenant_response_in_progress',
    tenant_submitted: 'tenant_submitted',
    agent_response_required: 'agent_response_required',
    finalisation_ready: 'finalisation_ready',
    finalised: 'finalised',
    archived: 'archived',
    cancelled: 'cancelled',
  };
  return map[status];
}

function agencyHeader(req: IncomingMessage): string {
  const value = req.headers['x-agency-id']?.toString().trim();
  if (!value) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.');
  return value;
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 1_000_000) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 1 MB.');
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required');
    return parsed as Record<string, unknown>;
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }
}

function validation<T>(result: { ok: true; value: T } | { ok: false; error: DomainErrorShape }): T {
  if (!result.ok) throw new ApiError(result.error.status, result.error.code, result.error.message, result.error.details);
  return result.value;
}

function idempotencyKey(req: IncomingMessage): string {
  const key = req.headers['idempotency-key']?.toString().trim();
  if (!key) throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key is required for material writes.');
  if (key.length < 8 || key.length > 200) throw new ApiError(400, 'IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key must contain 8 to 200 characters.');
  return key;
}

function payloadHash(body: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

function expectedVersion(body: Record<string, unknown>): number {
  const value = body.expectedVersion;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new ApiError(400, 'EXPECTED_VERSION_REQUIRED', 'expectedVersion must be a positive integer.');
  }
  return value;
}

function writeBody(
  body: Record<string, unknown>,
  resourceName?: string,
  mode: 'create' | 'update' = 'update',
): Record<string, unknown> {
  const data = { ...validation(resourceWriteSchema.parse(body)) };
  delete data.id;
  delete data.agencyId;
  delete data.version;
  delete data.expectedVersion;

  if (resourceName === 'inspection-jobs' || resourceName === 'reports') {
    const suppliedProtected = Object.keys(data).filter((field) => PROTECTED_WORKFLOW_FIELDS.has(field));
    if (mode === 'update' && suppliedProtected.length > 0) {
      throw new ApiError(
        400,
        'WORKFLOW_FIELD_PROTECTED',
        `Protected workflow fields (${suppliedProtected.join(', ')}) cannot be modified via generic update APIs. Use the transitions endpoint.`,
        { fields: suppliedProtected },
      );
    }
    for (const field of suppliedProtected) delete data[field];
  }

  return data;
}

async function appendMaterialAudit(
  dependencies: ApiDependencies,
  principal: { uid: string; role: string; agencyId: string },
  capability: SecurityCapability,
  action: string,
  correlationId: string,
  target: Record<string, unknown>,
): Promise<void> {
  await dependencies.audit.append({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    actorId: principal.uid,
    actorRole: principal.role,
    agencyId: principal.agencyId,
    capability,
    outcome: 'allowed',
    reason: `material_action:${action}`,
    target: {
      agencyId: principal.agencyId,
      ...(typeof target.propertyId === 'string' ? { propertyId: target.propertyId } : {}),
      ...(typeof target.tenancyId === 'string' ? { tenancyId: target.tenancyId } : {}),
      ...(typeof target.inspectionJobId === 'string' ? { inspectionJobId: target.inspectionJobId } : {}),
      ...(typeof target.reportId === 'string' ? { reportId: target.reportId } : {}),
    },
    correlationId,
  });
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
    idempotencyKey(req),
    payloadHash(body),
    action,
  );
  return {
    status: execution.result.status,
    body: execution.result.body,
    headers: { 'idempotency-replayed': String(execution.replayed) },
  };
}

function routeParts(urlValue: string | undefined): string[] {
  const url = new URL(urlValue ?? '/', 'http://localhost');
  return url.pathname.split('/').filter(Boolean);
}

export async function routeApiRequest(
  req: IncomingMessage,
  _res: ServerResponse,
  dependencies: ApiDependencies,
  correlationId: string,
): Promise<ApiResponse | undefined> {
  const parts = routeParts(req.url);
  if (parts[0] !== 'api' || parts[1] !== 'v1') return undefined;
  const resourceName = parts[2];
  if (!resourceName) {
    return { status: 200, body: { name: 'Property Condition Report API', version: 'v1', documentation: '/api/v1/openapi.json' } };
  }
  if (resourceName === 'openapi.json') return undefined;
  const policy = ROUTE_POLICIES[resourceName];
  if (!policy) throw new ApiError(404, 'NOT_FOUND', 'Route not found.');

  const agencyId = agencyHeader(req);
  const id = parts[3];
  const command = parts[4];
  const body = req.method === 'GET' ? {} : await readJson(req);
  const targetBody = { ...body, agencyId };

  if (req.method === 'GET') {
    if (id && command === 'workflow') {
      if (resourceName !== 'reports' && resourceName !== 'inspection-jobs') {
        throw new ApiError(404, 'NOT_FOUND', 'Workflow actions are only available for reports and inspection jobs.');
      }

      const existing = await dependencies.repository.get(policy.collection, agencyId, id);
      if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Record not found.');
      const principal = await authenticateAndAuthorise(
        req,
        dependencies,
        policy.readCapability,
        policy.target({ ...existing, agencyId }, id),
        correlationId,
      );

      const linkedReportId = typeof existing.reportId === 'string'
        ? existing.reportId
        : resourceName === 'reports'
          ? id
          : undefined;
      const linkedReport = linkedReportId ? await dependencies.reports.load(agencyId, linkedReportId) : null;
      const gateEval = calculateWorkflowGateContext(linkedReport, existing);
      const currentStatus = (resourceName === 'reports' ? existing.lifecycleStatus : existing.status) as string;
      const matrix = resourceName === 'reports' ? REPORT_TRANSITION_MATRIX : INSPECTION_TRANSITION_MATRIX;
      const possibleTargets = (matrix as Record<string, readonly string[]>)[currentStatus] ?? [];

      const availableActions: Array<{ action: string; targetStatus: string; label: string; reasonRequired: boolean }> = [];
      const blockedActions: Array<{
        action: string;
        targetStatus: string;
        label: string;
        missingGates: string[];
        blockers: typeof gateEval.blockers;
      }> = [];
      const reasonRequiredSet = new Set(['changes_requested', 'on_hold', 'cancelled', 'draft']);

      for (const targetStatus of possibleTargets) {
        const missingGates = resourceName === 'reports'
          ? missingReportTransitionGates(targetStatus as ReportLifecycleStatus, gateEval.context)
          : missingInspectionTransitionGates(targetStatus as InspectionJobStatus, gateEval.context);
        const missingSet = new Set<string>(missingGates);
        const targetBlockers = gateEval.blockers.filter((blocker) => missingSet.has(blocker.gate));
        const label = targetStatus.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());

        if (missingGates.length === 0) {
          availableActions.push({
            action: targetStatus,
            targetStatus,
            label,
            reasonRequired: reasonRequiredSet.has(targetStatus),
          });
        } else {
          blockedActions.push({ action: targetStatus, targetStatus, label, missingGates, blockers: targetBlockers });
        }
      }

      return {
        status: 200,
        body: {
          data: {
            entityId: id,
            currentStatus,
            version: existing.version,
            availableActions,
            blockedActions,
            gateContext: gateEval.context,
          },
          meta: { correlationId, actor: principal.uid },
        },
      };
    }

    if (id) {
      const record = await dependencies.repository.get(policy.collection, agencyId, id);
      if (!record) throw new ApiError(404, 'NOT_FOUND', 'Record not found.');
      const principal = await authenticateAndAuthorise(
        req,
        dependencies,
        policy.readCapability,
        policy.target({ ...record, agencyId }, id),
        correlationId,
      );
      return { status: 200, body: { data: record, meta: { correlationId, actor: principal.uid } } };
    }

    const principal = await authenticateAndAuthorise(
      req,
      dependencies,
      policy.readCapability,
      policy.target({ agencyId }),
      correlationId,
    );
    const url = new URL(req.url ?? '/', 'http://localhost');
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50), 1), 100);
    const page = await dependencies.repository.list(
      policy.collection,
      agencyId,
      limit,
      url.searchParams.get('cursor') ?? undefined,
    );
    return {
      status: 200,
      body: {
        data: page.items,
        meta: { correlationId, actor: principal.uid, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) },
      },
    };
  }

  const writeCapability = policy.writeCapability;
  if (!writeCapability) throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'This resource is read-only.');

  if (req.method === 'POST' && command === 'transitions' && id) {
    const transition = validation(workflowTransitionSchema.parse(body));
    const existing = await dependencies.repository.get(policy.collection, agencyId, id);
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Record not found.');
    const principal = await authenticateAndAuthorise(
      req,
      dependencies,
      writeCapability,
      policy.target({ ...existing, agencyId }, id),
      correlationId,
    );

    const linkedReportId = typeof existing.reportId === 'string'
      ? existing.reportId
      : resourceName === 'reports'
        ? id
        : undefined;
    const linkedReport = linkedReportId ? await dependencies.reports.load(agencyId, linkedReportId) : null;
    const gateEval = calculateWorkflowGateContext(linkedReport, existing);

    if (
      (transition.status === 'reviewer_approved' || transition.status === 'ready_to_issue' || transition.status === 'approved_for_issue') &&
      (existing.assignedInspectorId === principal.uid || existing.assignedAnalystId === principal.uid)
    ) {
      throw new ApiError(
        403,
        'SEPARATION_OF_DUTIES_VIOLATION',
        'An assigned inspector or analyst cannot perform reviewer approval on their own inspection.',
      );
    }

    if (resourceName === 'inspection-jobs') {
      let transitionEvent;
      try {
        transitionEvent = transitionInspectionJob({
          entityId: id,
          current: existing.status as InspectionJobStatus,
          requested: transition.status as InspectionJobStatus,
          currentVersion: existing.version as number,
          expectedVersion: transition.expectedVersion,
          actorId: principal.uid,
          actorRole: principal.role as UserRole,
          correlationId,
          context: gateEval.context,
          reason: transition.reason,
        });
      } catch (err) {
        if (err instanceof WorkflowError) {
          if (err.code === 'GATE_NOT_MET') {
            throw new ApiError(422, 'WORKFLOW_GATES_NOT_MET', err.message, { blockers: gateEval.blockers });
          }
          if (err.code === 'INVALID_TRANSITION') throw new ApiError(400, 'INVALID_TRANSITION', err.message);
          if (err.code === 'REASON_REQUIRED') throw new ApiError(400, 'REASON_REQUIRED', err.message);
          if (err.code === 'VERSION_CONFLICT') throw new ApiError(409, 'VERSION_CONFLICT', err.message);
        }
        throw err;
      }

      return idempotent(dependencies, req, agencyId, `${resourceName}:${id}:transition`, body, async () => {
        const updated = await dependencies.repository.update(
          policy.collection,
          agencyId,
          id,
          {
            status: transitionEvent.to,
            ...(transitionEvent.reason ? { transitionReason: transitionEvent.reason } : {}),
            ...(transition.assignedUserId ? { assignedUserId: transition.assignedUserId } : {}),
            updatedAt: transitionEvent.occurredAt,
          },
          transition.expectedVersion,
          principal.uid,
        );

        if (linkedReportId && linkedReport) {
          try {
            const matchingReportStatus = mapJobStatusToReportStatus(transitionEvent.to);
            if (matchingReportStatus && linkedReport.report.lifecycleStatus !== matchingReportStatus) {
              await dependencies.reports.transition(agencyId, {
                agencyId,
                reportId: linkedReportId,
                status: matchingReportStatus,
                expectedVersion: linkedReport.report.version ?? 1,
                actorId: principal.uid,
                actorRole: principal.role,
                correlationId,
                ...(transitionEvent.reason ? { reason: transitionEvent.reason } : {}),
              });
            }
          } catch (syncErr) {
            console.warn('Report status synchronisation warning:', syncErr);
          }
        }

        await appendMaterialAudit(dependencies, principal, writeCapability, `${resourceName}.transition`, correlationId, updated);
        return { status: 200, body: { data: updated, meta: { correlationId } } };
      });
    }

    if (resourceName === 'reports') {
      return idempotent(dependencies, req, agencyId, `reports:${id}:transition`, body, async () => {
        const stored = await dependencies.reports.transition(agencyId, {
          agencyId,
          reportId: id,
          status: transition.status as ReportLifecycleStatus,
          expectedVersion: transition.expectedVersion,
          actorId: principal.uid,
          actorRole: principal.role,
          correlationId,
          ...(transition.reason ? { reason: transition.reason } : {}),
          ...(transition.assignedUserId ? { assignedUserId: transition.assignedUserId } : {}),
        });
        await appendMaterialAudit(dependencies, principal, writeCapability, 'reports.transition', correlationId, stored);
        return { status: 200, body: { data: stored, meta: { correlationId } } };
      });
    }
  }

  if (req.method === 'POST' && resourceName === 'uploads') {
    const input = validation(uploadSessionSchema.parse(body));
    const principal = await authenticateAndAuthorise(
      req,
      dependencies,
      writeCapability,
      policy.target({ ...input, agencyId }),
      correlationId,
    );
    return idempotent(dependencies, req, agencyId, 'uploads.create', body, async () => {
      const uploadId = randomUUID();
      const session = await dependencies.uploads.create(
        agencyId,
        uploadId,
        input as unknown as Record<string, unknown>,
        principal,
      );
      const stored = await dependencies.repository.create(policy.collection, agencyId, uploadId, session, principal.uid);
      await appendMaterialAudit(dependencies, principal, writeCapability, 'uploads.create', correlationId, stored);
      return { status: 201, body: { data: stored, meta: { correlationId } } };
    });
  }

  if (
    req.method === 'POST' &&
    (resourceName === 'analysis-jobs' || resourceName === 'pdf-jobs' || resourceName === 'notifications')
  ) {
    const input = resourceName === 'notifications'
      ? validation(resourceWriteSchema.parse(body))
      : validation(taskCreationSchema.parse(body));
    const principal = await authenticateAndAuthorise(
      req,
      dependencies,
      writeCapability,
      policy.target({ ...input, agencyId }),
      correlationId,
    );

    let resolvedTaskInput = input as Record<string, unknown>;
    if (resourceName === 'pdf-jobs') {
      const report = await dependencies.reports.load(agencyId, input.reportId);
      if (!report) throw new ApiError(404, 'REPORT_NOT_FOUND', 'Report not found.');
      if (report.report.lifecycleStatus !== 'finalisation_ready') {
        throw new ApiError(
          422,
          'REPORT_NOT_FINALISATION_READY',
          'The audited final PDF can only be generated when the report is finalisation ready.',
        );
      }
      const currentVersionId = report.report.currentVersionId?.trim();
      if (!currentVersionId) {
        throw new ApiError(
          422,
          'REPORT_VERSION_REQUIRED',
          'An immutable current report version is required before final PDF generation.',
        );
      }
      if (input.reportVersionId && input.reportVersionId !== currentVersionId) {
        throw new ApiError(
          409,
          'REPORT_VERSION_SUPERSEDED',
          'The requested report version is no longer the current immutable version.',
          { requestedVersionId: input.reportVersionId, currentVersionId },
        );
      }
      resolvedTaskInput = { ...input, reportVersionId: currentVersionId, requestedBy: principal.uid };
    }

    return idempotent(dependencies, req, agencyId, `${resourceName}.create`, body, async () => {
      const taskId = randomUUID();
      const data = {
        ...resolvedTaskInput,
        status: 'queued',
        queuedAt: new Date().toISOString(),
      } as Record<string, unknown>;
      const stored = await dependencies.repository.create(policy.collection, agencyId, taskId, data, principal.uid);
      const kind = resourceName === 'analysis-jobs'
        ? 'analysis'
        : resourceName === 'pdf-jobs'
          ? 'pdf'
          : 'notification';
      await dependencies.tasks.dispatch(kind, agencyId, taskId, data);
      await appendMaterialAudit(dependencies, principal, writeCapability, `${resourceName}.create`, correlationId, stored);
      return { status: 202, body: { data: stored, meta: { correlationId } } };
    });
  }

  if (req.method === 'POST' && resourceName === 'tenant-responses') {
    const input = validation(tenantResponseSchema.parse(body));
    const principal = await authenticateAndAuthorise(
      req,
      dependencies,
      writeCapability,
      policy.target({ ...input, agencyId }),
      correlationId,
    );
    return idempotent(dependencies, req, agencyId, 'tenant-responses.submit', body, async () => {
      const responseId = randomUUID();
      const stored = await dependencies.repository.create(
        policy.collection,
        agencyId,
        responseId,
        { ...input, status: 'submitted', submittedAt: new Date().toISOString() },
        principal.uid,
      );
      await appendMaterialAudit(dependencies, principal, writeCapability, 'tenant-responses.submit', correlationId, stored);
      return { status: 201, body: { data: stored, meta: { correlationId } } };
    });
  }

  if (req.method === 'POST' && !id) {
    const principal = await authenticateAndAuthorise(
      req,
      dependencies,
      writeCapability,
      policy.target(targetBody),
      correlationId,
    );
    return idempotent(dependencies, req, agencyId, `${resourceName}.create`, body, async () => {
      const recordId = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : randomUUID();
      const initial = writeBody(body, resourceName, 'create');
      if (resourceName === 'inspection-jobs') initial.status = 'draft';
      if (resourceName === 'reports') initial.lifecycleStatus = 'draft';
      const stored = await dependencies.repository.create(policy.collection, agencyId, recordId, initial, principal.uid);
      await appendMaterialAudit(dependencies, principal, writeCapability, `${resourceName}.create`, correlationId, stored);
      return { status: 201, body: { data: stored, meta: { correlationId } } };
    });
  }

  if ((req.method === 'PATCH' || req.method === 'PUT') && id) {
    const existing = await dependencies.repository.get(policy.collection, agencyId, id);
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Record not found.');
    const principal = await authenticateAndAuthorise(
      req,
      dependencies,
      writeCapability,
      policy.target({ ...existing, ...targetBody }, id),
      correlationId,
    );
    return idempotent(dependencies, req, agencyId, `${resourceName}:${id}.update`, body, async () => {
      const stored = await dependencies.repository.update(
        policy.collection,
        agencyId,
        id,
        writeBody(body, resourceName, 'update'),
        expectedVersion(body),
        principal.uid,
      );
      await appendMaterialAudit(dependencies, principal, writeCapability, `${resourceName}.update`, correlationId, stored);
      return { status: 200, body: { data: stored, meta: { correlationId } } };
    });
  }

  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for this route.');
}
