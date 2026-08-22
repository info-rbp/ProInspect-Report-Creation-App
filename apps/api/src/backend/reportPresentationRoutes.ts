import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import {
  publishPresentationTemplate,
  validatePresentationTemplate,
  type ReportPresentationTemplate,
} from '@pcr/report-presentation';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies, StoredRecord } from './types.js';

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
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required');
    return value as Record<string, unknown>;
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }
}

function expectedVersion(body: Record<string, unknown>): number {
  const value = body.expectedVersion;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new ApiError(400, 'EXPECTED_VERSION_REQUIRED', 'expectedVersion must be a positive integer.');
  }
  return value;
}

function asTemplate(record: StoredRecord): ReportPresentationTemplate {
  const template = structuredClone(record) as unknown as ReportPresentationTemplate;
  try {
    validatePresentationTemplate(template);
  } catch (error) {
    throw new ApiError(
      422,
      'PRESENTATION_TEMPLATE_INVALID',
      error instanceof Error ? error.message : 'Presentation template is invalid.',
    );
  }
  return template;
}

async function auditLifecycle(
  dependencies: ApiDependencies,
  input: {
    agencyId: string;
    actorId: string;
    actorRole: string;
    correlationId: string;
    id: string;
    action: 'published' | 'retired';
    version: number;
  },
): Promise<void> {
  await dependencies.audit.append({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    actorId: input.actorId,
    actorRole: input.actorRole,
    agencyId: input.agencyId,
    capability: 'template.manage',
    outcome: 'allowed',
    reason: `report_presentation.${input.action}`,
    target: { agencyId: input.agencyId },
    correlationId: input.correlationId,
    entityType: 'report_presentation_template',
    entityId: input.id,
    eventType: `report_presentation.${input.action}`,
    metadata: { version: input.version },
  });
}

export async function routeReportPresentationRequest(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
): Promise<ApiResponse | undefined> {
  const route = parts(req);
  if (route[0] !== 'api' || route[1] !== 'v1' || route[2] !== 'report-presentation-templates') return undefined;
  const id = route[3];
  const action = route[4] === 'actions' ? route[5] : undefined;
  if (!id || !action || req.method !== 'POST') return undefined;

  const agencyId = agencyHeader(req);
  const body = await readJson(req);
  const principal = await authenticateAndAuthorise(req, dependencies, 'template.manage', { agencyId }, correlationId);
  const existing = await dependencies.repository.get('reportPresentationTemplateVersions', agencyId, id);
  if (!existing) throw new ApiError(404, 'PRESENTATION_TEMPLATE_NOT_FOUND', 'Report presentation template was not found.');

  if (action === 'publish') {
    const template = asTemplate(existing);
    if (template.status !== 'draft') {
      throw new ApiError(409, 'PRESENTATION_TEMPLATE_NOT_DRAFT', 'Only draft presentation templates can be published.');
    }
    const published = publishPresentationTemplate(template);
    const updated = await dependencies.repository.update(
      'reportPresentationTemplateVersions',
      agencyId,
      id,
      { status: published.status, publishedAt: published.publishedAt, immutable: true },
      expectedVersion(body),
      principal.uid,
    );
    await auditLifecycle(dependencies, {
      agencyId,
      actorId: principal.uid,
      actorRole: principal.role,
      correlationId,
      id,
      action: 'published',
      version: Number(updated.version),
    });
    return { status: 200, body: { data: updated, meta: { correlationId } } };
  }

  if (action === 'retire') {
    if (existing.status !== 'published') {
      throw new ApiError(409, 'PRESENTATION_TEMPLATE_NOT_PUBLISHED', 'Only a published presentation template can be retired.');
    }
    const updated = await dependencies.repository.update(
      'reportPresentationTemplateVersions',
      agencyId,
      id,
      { status: 'retired', retiredAt: new Date().toISOString(), immutable: true },
      expectedVersion(body),
      principal.uid,
    );
    await auditLifecycle(dependencies, {
      agencyId,
      actorId: principal.uid,
      actorRole: principal.role,
      correlationId,
      id,
      action: 'retired',
      version: Number(updated.version),
    });
    return { status: 200, body: { data: updated, meta: { correlationId } } };
  }

  throw new ApiError(404, 'PRESENTATION_ACTION_NOT_FOUND', 'Report presentation action was not found.');
}
