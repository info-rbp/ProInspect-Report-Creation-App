import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import {
  MAINTENANCE_CATEGORIES,
  MAINTENANCE_PRIORITIES,
  TENANT_INSTRUCTION_TYPES,
  type MaintenanceCategory,
  type MaintenanceItem,
  type MaintenancePriority,
  type TenantInstructionType,
} from '@pcr/domain';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies, IdempotencyResult } from './types.js';

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Command payload exceeds 1 MB.');
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required');
    return value as Record<string, unknown>;
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }
}

function agencyHeader(req: IncomingMessage): string {
  const agencyId = req.headers['x-agency-id']?.toString().trim();
  if (!agencyId) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.');
  return agencyId;
}

function idempotencyKey(req: IncomingMessage): string {
  const key = req.headers['idempotency-key']?.toString().trim();
  if (!key || key.length < 8 || key.length > 200) {
    throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key is required for maintenance commands.');
  }
  return key;
}

function payloadHash(body: Record<string, unknown>): string {
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

function requiredString(body: Record<string, unknown>, field: string, label = field): string {
  const value = typeof body[field] === 'string' ? body[field].trim() : '';
  if (!value) throw new ApiError(400, 'FIELD_REQUIRED', `${label} is required.`);
  return value;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))]
    : [];
}

function maintenanceCategory(value: unknown): MaintenanceCategory {
  if (typeof value !== 'string' || !MAINTENANCE_CATEGORIES.includes(value as MaintenanceCategory)) {
    throw new ApiError(400, 'INVALID_MAINTENANCE_CATEGORY', 'A valid maintenance category is required.');
  }
  return value as MaintenanceCategory;
}

function maintenancePriority(value: unknown): MaintenancePriority {
  if (typeof value !== 'string' || !MAINTENANCE_PRIORITIES.includes(value as MaintenancePriority)) {
    throw new ApiError(400, 'INVALID_MAINTENANCE_PRIORITY', 'A valid maintenance priority is required.');
  }
  return value as MaintenancePriority;
}

function tenantInstructionType(value: unknown): TenantInstructionType {
  if (typeof value !== 'string' || !TENANT_INSTRUCTION_TYPES.includes(value as TenantInstructionType)) {
    throw new ApiError(400, 'INVALID_TENANT_INSTRUCTION_TYPE', 'A valid tenant instruction type is required.');
  }
  return value as TenantInstructionType;
}

async function audit(
  dependencies: ApiDependencies,
  principal: { uid: string; role: string; agencyId: string },
  capability: 'maintenance.manage' | 'tenant_instruction.manage',
  eventType: string,
  entityType: string,
  entityId: string,
  correlationId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await dependencies.audit.append({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    actorId: principal.uid,
    actorRole: principal.role,
    agencyId: principal.agencyId,
    capability,
    outcome: 'allowed',
    reason: eventType,
    target: { agencyId: principal.agencyId },
    correlationId,
    entityType,
    entityId,
    eventType,
    metadata,
  });
}

async function createMaintenanceItem(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
  agencyId: string,
  body: Record<string, unknown>,
): Promise<ApiResponse> {
  const propertyId = requiredString(body, 'propertyId', 'propertyId');
  const principal = await authenticateAndAuthorise(
    req,
    dependencies,
    'maintenance.manage',
    { agencyId, propertyId, ...(typeof body.tenancyId === 'string' && body.tenancyId.trim() ? { tenancyId: body.tenancyId.trim() } : {}) },
    correlationId,
  );
  const title = requiredString(body, 'title', 'title');
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const category = maintenanceCategory(body.category);
  const priority = maintenancePriority(body.priority);
  const approvalRequired = Boolean(body.approvalRequired);
  const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : randomUUID();

  return idempotent(dependencies, req, agencyId, 'maintenance-item:create', body, async () => {
    const existing = await dependencies.repository.get('maintenanceItems', agencyId, id);
    if (existing) {
      return { status: 200, body: { data: existing, meta: { correlationId, existing: true } } };
    }
    const created = await dependencies.repository.create('maintenanceItems', agencyId, id, {
      propertyId,
      ...(typeof body.tenancyId === 'string' && body.tenancyId.trim() ? { tenancyId: body.tenancyId.trim() } : {}),
      ...(typeof body.sourceReportId === 'string' && body.sourceReportId.trim() ? { sourceReportId: body.sourceReportId.trim() } : {}),
      ...(typeof body.sourceReportVersionId === 'string' && body.sourceReportVersionId.trim() ? { sourceReportVersionId: body.sourceReportVersionId.trim() } : {}),
      ...(typeof body.sourceInspectionJobId === 'string' && body.sourceInspectionJobId.trim() ? { sourceInspectionJobId: body.sourceInspectionJobId.trim() } : {}),
      ...(typeof body.sourceAreaId === 'string' && body.sourceAreaId.trim() ? { sourceAreaId: body.sourceAreaId.trim() } : {}),
      ...(typeof body.sourceComponentId === 'string' && body.sourceComponentId.trim() ? { sourceComponentId: body.sourceComponentId.trim() } : {}),
      ...(typeof body.candidateId === 'string' && body.candidateId.trim() ? { candidateId: body.candidateId.trim() } : {}),
      title,
      description,
      category,
      priority,
      status: 'triage_required',
      sourceEvidenceIds: stringArray(body.sourceEvidenceIds),
      approvalRequired,
      approvalStatus: approvalRequired ? 'pending' : 'not_required',
      verificationStatus: 'unverified',
      ...(typeof body.dueDate === 'string' && body.dueDate.trim() ? { dueDate: body.dueDate.trim() } : {}),
      ...(typeof body.targetCompletionDate === 'string' && body.targetCompletionDate.trim() ? { targetCompletionDate: body.targetCompletionDate.trim() } : {}),
      ...(typeof body.workInstruction === 'string' && body.workInstruction.trim() ? { workInstruction: body.workInstruction.trim() } : {}),
      createdBy: principal.uid,
    }, principal.uid);
    await audit(dependencies, principal, 'maintenance.manage', 'maintenance.created', 'maintenance_item', id, correlationId, { propertyId, priority, category });
    return { status: 201, body: { data: created, meta: { correlationId } } };
  });
}

async function createWorkRequest(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
  agencyId: string,
  body: Record<string, unknown>,
): Promise<ApiResponse> {
  const maintenanceItemId = requiredString(body, 'maintenanceItemId', 'maintenanceItemId');
  const maintenance = await dependencies.repository.get('maintenanceItems', agencyId, maintenanceItemId) as unknown as (MaintenanceItem & { version: number }) | undefined;
  if (!maintenance) throw new ApiError(404, 'MAINTENANCE_ITEM_NOT_FOUND', 'Maintenance item not found.');
  if (!['approved', 'assigned', 'in_progress'].includes(maintenance.status)) {
    throw new ApiError(409, 'MAINTENANCE_NOT_APPROVED', 'Maintenance must be approved before a contractor work request can be created.');
  }
  const principal = await authenticateAndAuthorise(
    req,
    dependencies,
    'maintenance.manage',
    { agencyId, propertyId: maintenance.propertyId, ...(maintenance.tenancyId ? { tenancyId: maintenance.tenancyId } : {}) },
    correlationId,
  );
  const externalContactId = requiredString(body, 'externalContactId', 'externalContactId');
  const contact = await dependencies.repository.get('externalContacts', agencyId, externalContactId);
  if (!contact || contact.status !== 'active') throw new ApiError(400, 'EXTERNAL_CONTACT_INVALID', 'An active external contact is required.');
  const instructions = requiredString(body, 'instructions', 'instructions');
  const priority = maintenancePriority(body.priority ?? maintenance.priority);
  const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : randomUUID();

  return idempotent(dependencies, req, agencyId, 'work-request:create', body, async () => {
    const existing = await dependencies.repository.get('workRequests', agencyId, id);
    if (existing) return { status: 200, body: { data: existing, meta: { correlationId, existing: true } } };
    const created = await dependencies.repository.create('workRequests', agencyId, id, {
      maintenanceItemId,
      externalContactId,
      instructions,
      status: 'draft',
      priority,
      ...(typeof body.dueDate === 'string' && body.dueDate.trim() ? { dueDate: body.dueDate.trim() } : {}),
    }, principal.uid);
    await audit(dependencies, principal, 'maintenance.manage', 'work_request.created', 'work_request', id, correlationId, { maintenanceItemId, externalContactId });
    return { status: 201, body: { data: created, meta: { correlationId } } };
  });
}

async function createTenantInstruction(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
  agencyId: string,
  body: Record<string, unknown>,
): Promise<ApiResponse> {
  const propertyId = requiredString(body, 'propertyId', 'propertyId');
  const tenancyId = requiredString(body, 'tenancyId', 'tenancyId');
  const principal = await authenticateAndAuthorise(
    req,
    dependencies,
    'tenant_instruction.manage',
    { agencyId, propertyId, tenancyId },
    correlationId,
  );
  const tenancy = await dependencies.repository.get('tenancies', agencyId, tenancyId);
  if (!tenancy || tenancy.propertyId !== propertyId) {
    throw new ApiError(400, 'TENANCY_PROPERTY_MISMATCH', 'The tenancy must belong to the selected property.');
  }
  const type = tenantInstructionType(body.type);
  const title = requiredString(body, 'title', 'title');
  const instruction = requiredString(body, 'instruction', 'instruction');
  const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : randomUUID();

  return idempotent(dependencies, req, agencyId, 'tenant-instruction:create', body, async () => {
    const existing = await dependencies.repository.get('tenantInstructions', agencyId, id);
    if (existing) return { status: 200, body: { data: existing, meta: { correlationId, existing: true } } };
    const created = await dependencies.repository.create('tenantInstructions', agencyId, id, {
      propertyId,
      tenancyId,
      ...(typeof body.sourceReportId === 'string' && body.sourceReportId.trim() ? { sourceReportId: body.sourceReportId.trim() } : {}),
      ...(typeof body.sourceReportVersionId === 'string' && body.sourceReportVersionId.trim() ? { sourceReportVersionId: body.sourceReportVersionId.trim() } : {}),
      ...(typeof body.sourceAreaId === 'string' && body.sourceAreaId.trim() ? { sourceAreaId: body.sourceAreaId.trim() } : {}),
      ...(typeof body.sourceComponentId === 'string' && body.sourceComponentId.trim() ? { sourceComponentId: body.sourceComponentId.trim() } : {}),
      type,
      title,
      instruction,
      sourceEvidenceIds: stringArray(body.sourceEvidenceIds),
      status: 'draft',
      responseRequired: body.responseRequired !== false,
      ...(typeof body.dueDate === 'string' && body.dueDate.trim() ? { dueDate: body.dueDate.trim() } : {}),
    }, principal.uid);
    await audit(dependencies, principal, 'tenant_instruction.manage', 'tenant_instruction.created', 'tenant_instruction', id, correlationId, { propertyId, tenancyId, type });
    return { status: 201, body: { data: created, meta: { correlationId } } };
  });
}

export async function routeMaintenanceCreateRequest(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
): Promise<ApiResponse | undefined> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'api' || parts[1] !== 'v1' || parts[3] !== 'create' || parts.length !== 4) return undefined;
  const resource = parts[2];
  if (!['maintenance-items', 'work-requests', 'tenant-instructions'].includes(resource)) return undefined;
  if (req.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Creation commands require POST.');

  const agencyId = agencyHeader(req);
  const body = await readJson(req);
  if (resource === 'maintenance-items') return createMaintenanceItem(req, dependencies, correlationId, agencyId, body);
  if (resource === 'work-requests') return createWorkRequest(req, dependencies, correlationId, agencyId, body);
  return createTenantInstruction(req, dependencies, correlationId, agencyId, body);
}
