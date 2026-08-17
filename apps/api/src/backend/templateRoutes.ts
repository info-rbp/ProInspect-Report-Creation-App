import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { InspectionType } from '@pcr/domain';
import {
  assertTemplateEditable,
  createExitInspectionTemplate,
  createInitialPcrTemplate,
  createRoutineInspectionTemplate,
  publishTemplate,
  retireTemplate,
  validateTemplate,
  type InspectionTypeTemplate,
} from '@pcr/templates';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies, IdempotencyResult, StoredRecord } from './types.js';

const VERSION_COLLECTION = 'templateVersions';
const POINTER_COLLECTION = 'templates';

type StoredTemplate = StoredRecord & {
  templateId: string;
  templateVersion: number;
  inspectionType: InspectionType;
  propertyType: string;
  status: InspectionTypeTemplate['status'];
  areas: InspectionTypeTemplate['areas'];
  commentaryBank: InspectionTypeTemplate['commentaryBank'];
  templateCreatedAt: string;
  publishedAt?: string;
  retiredAt?: string;
  immutable?: boolean;
  systemDefault?: boolean;
};

type TemplateView = InspectionTypeTemplate & { recordVersion: number; systemDefault?: boolean };

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 5_000_000) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Template payload exceeds 5 MB.');
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

function storageId(templateId: string, version: number): string {
  const logicalId = templateId.trim();
  if (!logicalId || logicalId.includes('/')) throw new ApiError(400, 'INVALID_TEMPLATE_ID', 'Template ID must be non-empty and cannot contain a slash.');
  return `${logicalId}--v${version}`;
}

function view(record: StoredTemplate): TemplateView {
  return {
    id: record.templateId,
    version: record.templateVersion,
    inspectionType: record.inspectionType,
    propertyType: record.propertyType,
    status: record.status,
    areas: structuredClone(record.areas),
    commentaryBank: structuredClone(record.commentaryBank),
    createdAt: record.templateCreatedAt,
    ...(record.publishedAt ? { publishedAt: record.publishedAt } : {}),
    ...(record.retiredAt ? { retiredAt: record.retiredAt } : {}),
    recordVersion: record.version,
    ...(record.systemDefault ? { systemDefault: true } : {}),
  };
}

function recordData(template: InspectionTypeTemplate, extras: { immutable?: boolean; systemDefault?: boolean } = {}): Record<string, unknown> {
  return {
    templateId: template.id,
    templateVersion: template.version,
    inspectionType: template.inspectionType,
    propertyType: template.propertyType,
    status: template.status,
    areas: structuredClone(template.areas),
    commentaryBank: structuredClone(template.commentaryBank),
    templateCreatedAt: template.createdAt,
    ...(template.publishedAt ? { publishedAt: template.publishedAt } : {}),
    ...(template.retiredAt ? { retiredAt: template.retiredAt } : {}),
    immutable: extras.immutable ?? template.status !== 'draft',
    ...(extras.systemDefault ? { systemDefault: true } : {}),
  };
}

function pointerData(template: InspectionTypeTemplate, versionRecordId: string, systemDefault = false): Record<string, unknown> {
  return {
    templateId: template.id,
    templateVersion: template.version,
    inspectionType: template.inspectionType,
    reportType: template.inspectionType,
    propertyType: template.propertyType,
    status: template.status,
    versionRecordId,
    immutable: true,
    ...(template.publishedAt ? { publishedAt: template.publishedAt } : {}),
    ...(template.retiredAt ? { retiredAt: template.retiredAt } : {}),
    ...(systemDefault ? { systemDefault: true } : {}),
  };
}

function templateFromBody(value: unknown): InspectionTypeTemplate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'TEMPLATE_REQUIRED', 'A template object is required.');
  const candidate = structuredClone(value) as InspectionTypeTemplate;
  try { validateTemplate(candidate); } catch (error) {
    throw new ApiError(400, 'TEMPLATE_INVALID', error instanceof Error ? error.message : 'Template is invalid.');
  }
  return candidate;
}

function expectedRecordVersion(body: Record<string, unknown>): number {
  const value = body.expectedRecordVersion;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new ApiError(400, 'EXPECTED_VERSION_REQUIRED', 'expectedRecordVersion must be a positive integer.');
  }
  return value;
}

function idempotencyKey(req: IncomingMessage): string {
  const key = req.headers['idempotency-key']?.toString().trim();
  if (!key || key.length < 8 || key.length > 200) throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key is required.');
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

async function appendAudit(
  dependencies: ApiDependencies,
  principal: { uid: string; role: string; agencyId: string },
  eventType: string,
  templateId: string,
  correlationId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await dependencies.audit.append({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    actorId: principal.uid,
    actorRole: principal.role,
    agencyId: principal.agencyId,
    capability: 'template.manage',
    outcome: 'allowed',
    reason: eventType,
    target: { agencyId: principal.agencyId },
    correlationId,
    entityType: 'template',
    entityId: templateId,
    eventType,
    metadata,
  });
}

async function loadTemplate(dependencies: ApiDependencies, agencyId: string, templateId: string, version: number): Promise<StoredTemplate> {
  const record = await dependencies.repository.get(VERSION_COLLECTION, agencyId, storageId(templateId, version));
  if (!record) throw new ApiError(404, 'TEMPLATE_NOT_FOUND', 'Template version not found.');
  return record as StoredTemplate;
}

async function upsertPublishedPointer(
  dependencies: ApiDependencies,
  agencyId: string,
  template: InspectionTypeTemplate,
  actorId: string,
  versionRecordId: string,
  systemDefault = false,
): Promise<void> {
  const existing = await dependencies.repository.get(POINTER_COLLECTION, agencyId, template.id);
  const data = pointerData(template, versionRecordId, systemDefault);
  if (existing) {
    await dependencies.repository.update(POINTER_COLLECTION, agencyId, template.id, data, existing.version, actorId);
  } else {
    await dependencies.repository.create(POINTER_COLLECTION, agencyId, template.id, data, actorId);
  }
}

function defaults(): InspectionTypeTemplate[] {
  const createdAt = new Date().toISOString();
  return [
    { ...createInitialPcrTemplate(), id: 'system-entry-v1', version: 1, status: 'draft', createdAt },
    { ...createRoutineInspectionTemplate(), id: 'system-routine-v1', version: 1, status: 'draft', createdAt },
    { ...createExitInspectionTemplate(), id: 'system-exit-v1', version: 1, status: 'draft', createdAt },
  ];
}

async function ensureSystemDefaults(dependencies: ApiDependencies, agencyId: string, actorId: string): Promise<void> {
  for (const draft of defaults()) {
    const published = publishTemplate(draft);
    const id = storageId(published.id, published.version);
    const existingVersion = await dependencies.repository.get(VERSION_COLLECTION, agencyId, id);
    if (!existingVersion) {
      await dependencies.repository.create(VERSION_COLLECTION, agencyId, id, recordData(published, { immutable: true, systemDefault: true }), actorId);
    }
    const pointer = await dependencies.repository.get(POINTER_COLLECTION, agencyId, published.id);
    if (!pointer || pointer.status !== 'published' || pointer.templateVersion !== published.version) {
      await upsertPublishedPointer(dependencies, agencyId, published, actorId, id, true);
    }
  }
}

async function listTemplates(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string, agencyId: string): Promise<ApiResponse> {
  const principal = await authenticateAndAuthorise(req, dependencies, 'report.read', { agencyId }, correlationId);
  await ensureSystemDefaults(dependencies, agencyId, principal.uid);
  const page = await dependencies.repository.list(VERSION_COLLECTION, agencyId, 100);
  const templates = page.items
    .filter((record) => typeof record.templateId === 'string' && typeof record.templateVersion === 'number')
    .map((record) => view(record as StoredTemplate))
    .sort((left, right) => left.id.localeCompare(right.id) || right.version - left.version);
  return { status: 200, body: { data: templates, meta: { correlationId } } };
}

async function createDraft(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string, agencyId: string, body: Record<string, unknown>): Promise<ApiResponse> {
  const principal = await authenticateAndAuthorise(req, dependencies, 'template.manage', { agencyId }, correlationId);
  const template = templateFromBody(body.template ?? body);
  if (template.status !== 'draft') throw new ApiError(400, 'DRAFT_REQUIRED', 'New template versions must be created as drafts.');
  const id = storageId(template.id, template.version);
  return idempotent(dependencies, req, agencyId, `template:${id}:create`, body, async () => {
    if (await dependencies.repository.get(VERSION_COLLECTION, agencyId, id)) throw new ApiError(409, 'TEMPLATE_VERSION_EXISTS', 'This template version already exists.');
    const created = await dependencies.repository.create(VERSION_COLLECTION, agencyId, id, recordData(template), principal.uid) as StoredTemplate;
    await appendAudit(dependencies, principal, 'template.created', template.id, correlationId, { version: template.version });
    return { status: 201, body: { data: view(created), meta: { correlationId } } };
  });
}

async function updateDraft(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string, agencyId: string, templateId: string, version: number, body: Record<string, unknown>): Promise<ApiResponse> {
  const principal = await authenticateAndAuthorise(req, dependencies, 'template.manage', { agencyId }, correlationId);
  return idempotent(dependencies, req, agencyId, `template:${templateId}:${version}:update`, body, async () => {
    const existing = await loadTemplate(dependencies, agencyId, templateId, version);
    if (existing.status !== 'draft' || existing.immutable) throw new ApiError(409, 'TEMPLATE_IMMUTABLE', 'Published and retired template versions cannot be edited.');
    const recordVersion = expectedRecordVersion(body);
    if (recordVersion !== existing.version) throw new ApiError(409, 'VERSION_CONFLICT', 'Template changed. Reload and retry.');
    const template = templateFromBody(body.template);
    if (template.id !== templateId || template.version !== version || template.status !== 'draft') throw new ApiError(400, 'TEMPLATE_IDENTITY_MISMATCH', 'Template identity, version and draft status cannot be changed by an edit.');
    const updated = await dependencies.repository.update(VERSION_COLLECTION, agencyId, existing.id, recordData(template), existing.version, principal.uid) as StoredTemplate;
    await appendAudit(dependencies, principal, 'template.updated', templateId, correlationId, { version });
    return { status: 200, body: { data: view(updated), meta: { correlationId } } };
  });
}

async function publish(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string, agencyId: string, templateId: string, version: number, body: Record<string, unknown>): Promise<ApiResponse> {
  const principal = await authenticateAndAuthorise(req, dependencies, 'template.manage', { agencyId }, correlationId);
  return idempotent(dependencies, req, agencyId, `template:${templateId}:${version}:publish`, body, async () => {
    const existing = await loadTemplate(dependencies, agencyId, templateId, version);
    const recordVersion = expectedRecordVersion(body);
    if (recordVersion !== existing.version) throw new ApiError(409, 'VERSION_CONFLICT', 'Template changed. Reload and retry.');
    const current = view(existing);
    assertTemplateEditable(current);
    let published: InspectionTypeTemplate;
    try { published = publishTemplate(current); } catch (error) { throw new ApiError(400, 'TEMPLATE_INVALID', error instanceof Error ? error.message : 'Template cannot be published.'); }
    const updated = await dependencies.repository.update(VERSION_COLLECTION, agencyId, existing.id, recordData(published, { immutable: true, systemDefault: existing.systemDefault }), existing.version, principal.uid) as StoredTemplate;
    await upsertPublishedPointer(dependencies, agencyId, published, principal.uid, existing.id, Boolean(existing.systemDefault));
    await appendAudit(dependencies, principal, 'template.published', templateId, correlationId, { version });
    return { status: 200, body: { data: view(updated), meta: { correlationId } } };
  });
}

async function retire(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string, agencyId: string, templateId: string, version: number, body: Record<string, unknown>): Promise<ApiResponse> {
  const principal = await authenticateAndAuthorise(req, dependencies, 'template.manage', { agencyId }, correlationId);
  return idempotent(dependencies, req, agencyId, `template:${templateId}:${version}:retire`, body, async () => {
    const existing = await loadTemplate(dependencies, agencyId, templateId, version);
    const recordVersion = expectedRecordVersion(body);
    if (recordVersion !== existing.version) throw new ApiError(409, 'VERSION_CONFLICT', 'Template changed. Reload and retry.');
    let retired: InspectionTypeTemplate;
    try { retired = retireTemplate(view(existing)); } catch (error) { throw new ApiError(409, 'TEMPLATE_NOT_PUBLISHED', error instanceof Error ? error.message : 'Only published templates can be retired.'); }
    const updated = await dependencies.repository.update(VERSION_COLLECTION, agencyId, existing.id, recordData(retired, { immutable: true, systemDefault: existing.systemDefault }), existing.version, principal.uid) as StoredTemplate;

    const versions = await dependencies.repository.list(VERSION_COLLECTION, agencyId, 100);
    const fallback = versions.items
      .filter((record) => record.templateId === templateId && record.status === 'published' && record.templateVersion !== version)
      .sort((left, right) => Number(right.templateVersion ?? 0) - Number(left.templateVersion ?? 0))[0] as StoredTemplate | undefined;
    if (fallback) {
      await upsertPublishedPointer(dependencies, agencyId, view(fallback), principal.uid, fallback.id, Boolean(fallback.systemDefault));
    } else {
      const pointer = await dependencies.repository.get(POINTER_COLLECTION, agencyId, templateId);
      if (pointer) await dependencies.repository.update(POINTER_COLLECTION, agencyId, templateId, pointerData(retired, existing.id, Boolean(existing.systemDefault)), pointer.version, principal.uid);
    }
    await appendAudit(dependencies, principal, 'template.retired', templateId, correlationId, { version });
    return { status: 200, body: { data: view(updated), meta: { correlationId } } };
  });
}

async function duplicate(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string, agencyId: string, templateId: string, version: number, body: Record<string, unknown>): Promise<ApiResponse> {
  const principal = await authenticateAndAuthorise(req, dependencies, 'template.manage', { agencyId }, correlationId);
  return idempotent(dependencies, req, agencyId, `template:${templateId}:${version}:duplicate`, body, async () => {
    const source = await loadTemplate(dependencies, agencyId, templateId, version);
    const page = await dependencies.repository.list(VERSION_COLLECTION, agencyId, 100);
    const maxVersion = Math.max(0, ...page.items.filter((record) => record.templateId === templateId).map((record) => Number(record.templateVersion ?? 0)));
    const sourceView = view(source);
    const draft: InspectionTypeTemplate = {
      id: sourceView.id,
      version: maxVersion + 1,
      inspectionType: sourceView.inspectionType,
      propertyType: sourceView.propertyType,
      status: 'draft',
      areas: structuredClone(sourceView.areas),
      commentaryBank: structuredClone(sourceView.commentaryBank),
      createdAt: new Date().toISOString(),
    };
    validateTemplate(draft);
    const id = storageId(draft.id, draft.version);
    const created = await dependencies.repository.create(VERSION_COLLECTION, agencyId, id, recordData(draft), principal.uid) as StoredTemplate;
    await appendAudit(dependencies, principal, 'template.duplicated', templateId, correlationId, { sourceVersion: version, version: draft.version });
    return { status: 201, body: { data: view(created), meta: { correlationId } } };
  });
}

export async function routeTemplateRequest(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string): Promise<ApiResponse | undefined> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'api' || parts[1] !== 'v1' || parts[2] !== 'templates') return undefined;
  const agencyId = agencyHeader(req);

  if (parts.length === 3 && req.method === 'GET') return listTemplates(req, dependencies, correlationId, agencyId);
  if (parts.length === 4 && parts[3] === 'drafts' && req.method === 'POST') return createDraft(req, dependencies, correlationId, agencyId, await readJson(req));

  const templateId = parts[3] ? decodeURIComponent(parts[3]) : '';
  const version = parts[4] === 'versions' && parts[5] ? Number(parts[5]) : NaN;
  if (!templateId || !Number.isInteger(version) || version < 1) return undefined;

  if (parts.length === 6 && req.method === 'GET') {
    const principal = await authenticateAndAuthorise(req, dependencies, 'report.read', { agencyId }, correlationId);
    const record = await loadTemplate(dependencies, agencyId, templateId, version);
    return { status: 200, body: { data: view(record), meta: { correlationId, actor: principal.uid } } };
  }
  if (parts.length === 6 && req.method === 'PUT') return updateDraft(req, dependencies, correlationId, agencyId, templateId, version, await readJson(req));
  if (parts[6] === 'actions' && parts[7] && parts.length === 8 && req.method === 'POST') {
    const body = await readJson(req);
    if (parts[7] === 'publish') return publish(req, dependencies, correlationId, agencyId, templateId, version, body);
    if (parts[7] === 'retire') return retire(req, dependencies, correlationId, agencyId, templateId, version, body);
    if (parts[7] === 'duplicate') return duplicate(req, dependencies, correlationId, agencyId, templateId, version, body);
    throw new ApiError(404, 'UNKNOWN_TEMPLATE_ACTION', `Unknown template action ${parts[7]}.`);
  }
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method ?? '')) throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Template mutations must use draft/version action commands.');
  return undefined;
}
