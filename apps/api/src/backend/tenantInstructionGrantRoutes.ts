import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies, StoredRecord } from './types.js';

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

function agencyHeader(req: IncomingMessage): string {
  const agencyId = req.headers['x-agency-id']?.toString().trim();
  if (!agencyId) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.');
  return agencyId;
}

function email(value: unknown): string {
  const result = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(result)) throw new ApiError(400, 'EMAIL_REQUIRED', 'A valid recipientEmail is required.');
  return result;
}

async function listAll(dependencies: ApiDependencies, collection: string, agencyId: string): Promise<StoredRecord[]> {
  const result: StoredRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = await dependencies.repository.list(collection, agencyId, 100, cursor);
    result.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return result;
}

export async function routeTenantInstructionGrantRequest(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string): Promise<ApiResponse | undefined> {
  const parts = new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean);
  if (req.method !== 'POST' || parts[0] !== 'api' || parts[1] !== 'v1' || parts[2] !== 'external-access-grants' || parts[3] !== 'generate') return undefined;
  const body = await readJson(req);
  if (body.resourceType !== 'tenant_instruction') return undefined;

  const agencyId = agencyHeader(req);
  const resourceId = typeof body.resourceId === 'string' ? body.resourceId.trim() : '';
  const recipientEmail = email(body.recipientEmail);
  if (!resourceId) throw new ApiError(400, 'RESOURCE_ID_REQUIRED', 'resourceId is required.');
  const principal = await authenticateAndAuthorise(req, dependencies, 'tenant_instruction.manage', { agencyId }, correlationId);
  const instruction = await dependencies.repository.get('tenantInstructions', agencyId, resourceId);
  if (!instruction) throw new ApiError(404, 'TENANT_INSTRUCTION_NOT_FOUND', 'Tenant instruction was not found.');
  const tenancyId = typeof instruction.tenancyId === 'string' ? instruction.tenancyId : '';
  if (!tenancyId) throw new ApiError(409, 'TENANCY_REQUIRED', 'Tenant instruction is not linked to a tenancy.');

  const [participants, tenants] = await Promise.all([
    listAll(dependencies, 'tenancyParticipants', agencyId),
    listAll(dependencies, 'tenants', agencyId),
  ]);
  const activeTenantIds = new Set(participants.filter((item) => item.tenancyId === tenancyId && item.status !== 'ended').map((item) => String(item.tenantId)));
  const verifiedEmails = tenants.filter((item) => activeTenantIds.has(item.id)).map((item) => typeof item.email === 'string' ? item.email.trim().toLowerCase() : '').filter(Boolean);
  if (!verifiedEmails.length) throw new ApiError(409, 'VERIFIED_TENANT_EMAIL_REQUIRED', 'A verified tenant email is required before issuing a tenant action.');
  if (!verifiedEmails.includes(recipientEmail)) throw new ApiError(400, 'RECIPIENT_SCOPE_MISMATCH', 'Recipient email is not linked to an active tenant on this tenancy.');

  const expiresInHours = typeof body.expiresInHours === 'number' && Number.isFinite(body.expiresInHours)
    ? Math.min(Math.max(Math.floor(body.expiresInHours), 1), 168)
    : 72;
  const rawToken = `${randomUUID()}${randomUUID().replaceAll('-', '')}`;
  const grantId = randomUUID();
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + expiresInHours * 3_600_000).toISOString();
  const grant = await dependencies.repository.create('externalAccessGrants', agencyId, grantId, {
    resourceType: 'tenant_instruction', resourceId, recipientEmail, tokenHash, expiresAt,
  }, principal.uid);
  await dependencies.repository.update('tenantInstructions', agencyId, resourceId, { accessGrantId: grantId }, Number(instruction.version || 1), principal.uid);
  await dependencies.audit.append({
    id: randomUUID(), timestamp: new Date().toISOString(), actorId: principal.uid, actorRole: principal.role,
    agencyId, capability: 'tenant_instruction.manage', outcome: 'allowed', reason: 'tenant_instruction.grant_generated',
    target: { agencyId, tenancyId }, correlationId,
  });
  return { status: 201, body: { data: { grantId, grantToken: rawToken, expiresAt: grant.expiresAt, accessUrl: `/external/tenant-instruction/${rawToken}` }, meta: { correlationId } } };
}
