import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DomainErrorShape, SecurityCapability } from '@pcr/domain';
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
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new ApiError(400, 'EXPECTED_VERSION_REQUIRED', 'expectedVersion must be a positive integer.');
  return value;
}

function writeBody(body: Record<string, unknown>): Record<string, unknown> {
  const data = { ...validation(resourceWriteSchema.parse(body)) };
  delete data.id;
  delete data.agencyId;
  delete data.version;
  delete data.expectedVersion;
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
  const execution = await dependencies.idempotency.execute(agencyId, operation, idempotencyKey(req), payloadHash(body), action);
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
  if (!resourceName) return { status: 200, body: { name: 'Property Condition Report API', version: 'v1', documentation: '/api/v1/openapi.json' } };
  if (resourceName === 'openapi.json') return undefined;
  const policy = ROUTE_POLICIES[resourceName];
  if (!policy) throw new ApiError(404, 'NOT_FOUND', 'Route not found.');

  const agencyId = agencyHeader(req);
  const id = parts[3];
  const command = parts[4];
  const body = req.method === 'GET' ? {} : await readJson(req);
  const targetBody = { ...body, agencyId };

  if (req.method === 'GET') {
    if (id) {
      const record = await dependencies.repository.get(policy.collection, agencyId, id);
      if (!record) throw new ApiError(404, 'NOT_FOUND', 'Record not found.');
      const principal = await authenticateAndAuthorise(req, dependencies, policy.readCapability, policy.target({ ...record, agencyId }, id), correlationId);
      return { status: 200, body: { data: record, meta: { correlationId, actor: principal.uid } } };
    }
    const principal = await authenticateAndAuthorise(req, dependencies, policy.readCapability, policy.target({ agencyId }), correlationId);
    const url = new URL(req.url ?? '/', 'http://localhost');
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50), 1), 100);
    const page = await dependencies.repository.list(policy.collection, agencyId, limit, url.searchParams.get('cursor') ?? undefined);
    return { status: 200, body: { data: page.items, meta: { correlationId, actor: principal.uid, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) } } };
  }

  const writeCapability = policy.writeCapability;
  if (!writeCapability) throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'This resource is read-only.');

  if (req.method === 'POST' && command === 'transitions' && id) {
    const transition = validation(workflowTransitionSchema.parse(body));
    const existing = await dependencies.repository.get(policy.collection, agencyId, id);
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Record not found.');
    const principal = await authenticateAndAuthorise(req, dependencies, writeCapability, policy.target({ ...existing, agencyId }, id), correlationId);
    return idempotent(dependencies, req, agencyId, `${resourceName}:${id}:transition`, body, async () => {
      const field = resourceName === 'reports' ? 'lifecycleStatus' : 'status';
      const updated = await dependencies.repository.update(
        policy.collection,
        agencyId,
        id,
        { [field]: transition.status, ...(transition.reason ? { transitionReason: transition.reason } : {}) },
        transition.expectedVersion,
        principal.uid,
      );
      await appendMaterialAudit(dependencies, principal, writeCapability, `${resourceName}.transition`, correlationId, updated);
      return { status: 200, body: { data: updated, meta: { correlationId } } };
    });
  }

  if (req.method === 'POST' && resourceName === 'uploads') {
    const input = validation(uploadSessionSchema.parse(body));
    const principal = await authenticateAndAuthorise(req, dependencies, writeCapability, policy.target({ ...input, agencyId }), correlationId);
    return idempotent(dependencies, req, agencyId, 'uploads.create', body, async () => {
      const uploadId = randomUUID();
      const session = await dependencies.uploads.create(agencyId, uploadId, input as unknown as Record<string, unknown>, principal);
      const stored = await dependencies.repository.create(policy.collection, agencyId, uploadId, session, principal.uid);
      await appendMaterialAudit(dependencies, principal, writeCapability, 'uploads.create', correlationId, stored);
      return { status: 201, body: { data: stored, meta: { correlationId } } };
    });
  }

  if (req.method === 'POST' && (resourceName === 'analysis-jobs' || resourceName === 'pdf-jobs' || resourceName === 'notifications')) {
    const input = resourceName === 'notifications' ? validation(resourceWriteSchema.parse(body)) : validation(taskCreationSchema.parse(body));
    const principal = await authenticateAndAuthorise(req, dependencies, writeCapability, policy.target({ ...input, agencyId }), correlationId);
    return idempotent(dependencies, req, agencyId, `${resourceName}.create`, body, async () => {
      const taskId = randomUUID();
      const data = { ...input, status: 'queued', queuedAt: new Date().toISOString() } as Record<string, unknown>;
      const stored = await dependencies.repository.create(policy.collection, agencyId, taskId, data, principal.uid);
      const kind = resourceName === 'analysis-jobs' ? 'analysis' : resourceName === 'pdf-jobs' ? 'pdf' : 'notification';
      await dependencies.tasks.dispatch(kind, agencyId, taskId, data);
      await appendMaterialAudit(dependencies, principal, writeCapability, `${resourceName}.create`, correlationId, stored);
      return { status: 202, body: { data: stored, meta: { correlationId } } };
    });
  }

  if (req.method === 'POST' && resourceName === 'tenant-responses') {
    const input = validation(tenantResponseSchema.parse(body));
    const principal = await authenticateAndAuthorise(req, dependencies, writeCapability, policy.target({ ...input, agencyId }), correlationId);
    return idempotent(dependencies, req, agencyId, 'tenant-responses.submit', body, async () => {
      const responseId = randomUUID();
      const stored = await dependencies.repository.create(policy.collection, agencyId, responseId, { ...input, status: 'submitted', submittedAt: new Date().toISOString() }, principal.uid);
      await appendMaterialAudit(dependencies, principal, writeCapability, 'tenant-responses.submit', correlationId, stored);
      return { status: 201, body: { data: stored, meta: { correlationId } } };
    });
  }

  if (req.method === 'POST' && !id) {
    const principal = await authenticateAndAuthorise(req, dependencies, writeCapability, policy.target(targetBody), correlationId);
    return idempotent(dependencies, req, agencyId, `${resourceName}.create`, body, async () => {
      const recordId = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : randomUUID();
      const stored = await dependencies.repository.create(policy.collection, agencyId, recordId, writeBody(body), principal.uid);
      await appendMaterialAudit(dependencies, principal, writeCapability, `${resourceName}.create`, correlationId, stored);
      return { status: 201, body: { data: stored, meta: { correlationId } } };
    });
  }

  if ((req.method === 'PATCH' || req.method === 'PUT') && id) {
    const existing = await dependencies.repository.get(policy.collection, agencyId, id);
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Record not found.');
    const principal = await authenticateAndAuthorise(req, dependencies, writeCapability, policy.target({ ...existing, ...targetBody }, id), correlationId);
    return idempotent(dependencies, req, agencyId, `${resourceName}:${id}.update`, body, async () => {
      const stored = await dependencies.repository.update(policy.collection, agencyId, id, writeBody(body), expectedVersion(body), principal.uid);
      await appendMaterialAudit(dependencies, principal, writeCapability, `${resourceName}.update`, correlationId, stored);
      return { status: 200, body: { data: stored, meta: { correlationId } } };
    });
  }

  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for this route.');
}
