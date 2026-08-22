import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies, StoredRecord } from './types.js';

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
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }
}

async function listAll(dependencies: ApiDependencies, collection: string, agencyId: string): Promise<StoredRecord[]> {
  const records: StoredRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = await dependencies.repository.list(collection, agencyId, 100, cursor);
    records.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return records;
}

function daysUntil(value: string | undefined, now: Date): number | undefined {
  if (!value) return undefined;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return undefined;
  return Math.ceil((time - now.getTime()) / 86_400_000);
}

export async function routeTenantAutomationRequest(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string): Promise<ApiResponse | undefined> {
  const parts = new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean);
  if (parts[0] !== 'api' || parts[1] !== 'v1' || parts[2] !== 'tenant-automation' || parts[3] !== 'run') return undefined;
  if (req.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Tenant automation requires POST.');

  const agencyId = agencyHeader(req);
  const principal = await authenticateAndAuthorise(req, dependencies, 'notification.send', { agencyId }, correlationId);
  const body = await readJson(req);
  const now = typeof body.asOf === 'string' && !Number.isNaN(new Date(body.asOf).getTime()) ? new Date(body.asOf) : new Date();
  const dateKey = now.toISOString().slice(0, 10);
  const dryRun = body.dryRun === true;
  const [tenancies, participants, tenants, actions, documents, priorEvents] = await Promise.all([
    listAll(dependencies, 'tenancies', agencyId),
    listAll(dependencies, 'tenancyParticipants', agencyId),
    listAll(dependencies, 'tenants', agencyId),
    listAll(dependencies, 'tenantInstructions', agencyId),
    listAll(dependencies, 'tenancyDocuments', agencyId),
    listAll(dependencies, 'tenantAutomationEvents', agencyId),
  ]);

  const emitted: Array<{ rule: string; tenantId: string; tenancyId: string; recipient: string; subject: string }> = [];
  const existingKeys = new Set(priorEvents.map((item) => String(item.eventKey || '')));

  const recipientsFor = (tenancyId: string) => {
    const ids = participants
      .filter((item) => item.tenancyId === tenancyId && item.status !== 'ended' && ['primary_tenant', 'co_tenant'].includes(String(item.role)))
      .map((item) => String(item.tenantId));
    return tenants.filter((item) => ids.includes(item.id) && typeof item.email === 'string' && item.email.trim());
  };

  const emit = async (rule: string, tenancyId: string, subject: string, message: string, entityId: string, recipientTenant: StoredRecord) => {
    const recipient = typeof recipientTenant.email === 'string' ? recipientTenant.email.trim().toLowerCase() : '';
    if (!recipient) return;
    const eventKey = `${rule}:${entityId}:${recipientTenant.id}:${dateKey}`;
    if (existingKeys.has(eventKey)) return;
    emitted.push({ rule, tenantId: recipientTenant.id, tenancyId, recipient, subject });
    if (dryRun) return;
    const communicationId = randomUUID();
    await dependencies.repository.create('tenantCommunications', agencyId, communicationId, {
      tenantId: recipientTenant.id,
      tenancyId,
      channel: 'email',
      direction: 'outbound',
      subject,
      message,
      status: 'queued',
      relatedEntityType: rule.startsWith('action') ? 'tenant_instruction' : rule.startsWith('document') ? 'tenancy_document' : 'general',
      relatedEntityId: entityId,
    }, principal.uid);
    const notificationId = randomUUID();
    const notification = await dependencies.repository.create('notificationJobs', agencyId, notificationId, {
      tenantId: recipientTenant.id,
      tenancyId,
      channel: 'email',
      recipient,
      subject,
      message,
      communicationId,
      status: 'queued',
      queuedAt: now.toISOString(),
    }, principal.uid);
    await dependencies.tasks.dispatch('notification', agencyId, notificationId, notification);
    await dependencies.repository.create('tenantAutomationEvents', agencyId, randomUUID(), {
      eventKey,
      rule,
      tenantId: recipientTenant.id,
      tenancyId,
      entityId,
      occurredAt: now.toISOString(),
    }, principal.uid);
    existingKeys.add(eventKey);
  };

  for (const action of actions) {
    if (!action.tenancyId || ['resolved', 'closed', 'cancelled', 'withdrawn'].includes(String(action.status))) continue;
    const remaining = daysUntil(typeof action.dueDate === 'string' ? action.dueDate : undefined, now);
    for (const tenant of recipientsFor(String(action.tenancyId))) {
      if (remaining === 1) await emit('action_due_tomorrow', String(action.tenancyId), `Action due tomorrow: ${String(action.title || 'Tenant action')}`, 'Your requested action is due tomorrow. Please open your ProInspect tenant portal to review and respond.', String(action.id), tenant);
      if (remaining !== undefined && remaining < 0) await emit('action_overdue', String(action.tenancyId), `Action overdue: ${String(action.title || 'Tenant action')}`, 'This tenant action is overdue. Please open your ProInspect tenant portal and provide an update.', String(action.id), tenant);
    }
  }

  for (const document of documents) {
    if (!document.tenancyId || !['signature_required', 'partially_signed'].includes(String(document.status))) continue;
    const signerTenantIds = new Set(
      (Array.isArray(document.signers) ? document.signers : [])
        .filter((item) => item && typeof item === 'object' && (item as Record<string, unknown>).kind === 'tenant' && (item as Record<string, unknown>).status !== 'signed')
        .map((item) => String((item as Record<string, unknown>).tenantId || ''))
        .filter(Boolean),
    );
    for (const tenant of recipientsFor(String(document.tenancyId)).filter((item) => signerTenantIds.has(item.id))) {
      await emit('document_signature_required', String(document.tenancyId), `Signature required: ${String(document.title || 'Tenancy document')}`, 'A tenancy document is awaiting your signature or acknowledgement in ProInspect.', String(document.id), tenant);
    }
  }

  for (const tenancy of tenancies) {
    if (!tenancy.id || ['ended', 'cancelled'].includes(String(tenancy.lifecycleStatus || tenancy.status))) continue;
    const remaining = daysUntil(typeof tenancy.leaseEndDate === 'string' ? tenancy.leaseEndDate : undefined, now);
    if (remaining === 60 || remaining === 30 || remaining === 14) {
      for (const tenant of recipientsFor(String(tenancy.id))) {
        await emit(`tenancy_expiry_${remaining}`, String(tenancy.id), `Tenancy ends in ${remaining} days`, `Your recorded tenancy end date is ${String(tenancy.leaseEndDate)}. Your property manager will contact you if any action is required.`, String(tenancy.id), tenant);
      }
    }
  }

  await dependencies.audit.append({
    id: randomUUID(), timestamp: now.toISOString(), actorId: principal.uid, actorRole: principal.role, agencyId,
    capability: 'notification.send', outcome: 'allowed', reason: dryRun ? 'tenant_automation.dry_run' : 'tenant_automation.run',
    target: { agencyId }, correlationId,
  });

  return { status: 200, body: { data: { dryRun, evaluatedAt: now.toISOString(), emitted, count: emitted.length }, meta: { correlationId } } };
}
