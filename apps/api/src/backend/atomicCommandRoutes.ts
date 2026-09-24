import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { SecurityCapability } from '@pcr/domain';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies, StoredRecord } from './types.js';

const commands: Record<string, { collection: string; capability: SecurityCapability }> = {
  'quote-approve': { collection: 'operationalQuotes', capability: 'operational_quote.manage' },
  'incident-follow-up': { collection: 'incidents', capability: 'incident.manage' },
  'key-issue': { collection: 'keyRegister', capability: 'key_register.manage' },
  'key-return': { collection: 'keyRegister', capability: 'key_register.manage' },
  'device-issue': { collection: 'accessDevices', capability: 'key_register.manage' },
  'device-return': { collection: 'accessDevices', capability: 'key_register.manage' },
  'contractor-complete': { collection: 'operationalWorkOrders', capability: 'operational_work_order.manage' },
};
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
function requireState(ok: unknown, message: string): asserts ok { if (!ok) throw new ApiError(409, 'COMMAND_PRECONDITION', message); }
export async function routeAtomicCommandRequest(req: IncomingMessage, deps: ApiDependencies, correlationId: string): Promise<ApiResponse | undefined> {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean);
  if (path[0] !== 'api' || path[1] !== 'v1' || path[2] !== 'commands') return undefined;
  const command = path[3]; const policy = commands[command];
  if (!policy || path.length !== 4 || req.method !== 'POST') throw new ApiError(404, 'COMMAND_NOT_FOUND', 'Command not found.');
  const agencyId = text(req.headers['x-agency-id']); const key = text(req.headers['idempotency-key']);
  if (!agencyId || key.length < 8 || key.length > 200) throw new ApiError(400, 'COMMAND_IDENTITY_REQUIRED', 'Agency and Idempotency-Key are required.');
  let raw = ''; for await (const chunk of req) { raw += String(chunk); if (Buffer.byteLength(raw) > 65536) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Command exceeds 64 KiB.'); }
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(); }
  catch { throw new ApiError(400, 'INVALID_JSON', 'A JSON object is required.'); }
  if (!text(body.id) || !Number.isInteger(body.expectedVersion)) throw new ApiError(400, 'VERSION_REQUIRED', 'Record ID and expectedVersion are required.');
  // Authentication precedes even a receipt replay; transaction-scoped scope checks
  // below use the authoritative entity, never caller-supplied tenant/site fields.
  await authenticateAndAuthorise(req, deps, policy.capability, { agencyId }, correlationId);
  const result = await deps.idempotency.execute(agencyId, `command:${command}`, key, createHash('sha256').update(raw).digest('hex'), async () => {
    const current = await deps.repository.get(policy.collection, agencyId, text(body.id));
    if (!current) throw new ApiError(404, 'NOT_FOUND', 'Record not found.');
    const managedSiteId = text(current.managedSiteId); requireState(managedSiteId, 'Managed site is required.');
    const principal = await authenticateAndAuthorise(req, deps, policy.capability, { agencyId, managedSiteId, ...(current.contractorId ? { contractorId: text(current.contractorId) } : {}) }, correlationId);
    requireState(current.version === body.expectedVersion, 'Record changed. Reload before retrying.');
    const now = new Date().toISOString(); const relatedId = randomUUID(); let patch: Record<string, unknown>; let related: StoredRecord | undefined;
    if (command === 'quote-approve') {
      requireState(['submitted', 'pending', 'sent', 'awaiting_approval'].includes(text(current.status)), 'Quote cannot be approved from its current state.');
      requireState(!current.validUntil || Date.parse(text(current.validUntil)) > Date.now(), 'Quote expired.');
      requireState(text(current.scope) && text(current.contractorId), 'Quote scope and contractor are required.');
      related = await deps.repository.create('operationalWorkOrders', agencyId, relatedId, { managedSiteId, quoteId: current.id, ...(current.defectId ? { defectId: current.defectId } : {}), contractorId: current.contractorId, scope: current.scope, status: 'issued' }, principal.uid);
      await deps.repository.create('operationalApprovals', agencyId, randomUUID(), { managedSiteId, quoteId: current.id, entityType: 'operational_quote', entityId: current.id, decision: 'approved', decidedBy: principal.uid, decidedAt: now, status: 'approved', reason: text(body.reason) }, principal.uid);
      patch = { status: 'approved' };
    } else if (command === 'incident-follow-up') {
      requireState(!['closed', 'resolved'].includes(text(current.status)), 'Closed incidents cannot create follow-up work.');
      requireState(text(body.title) && Number.isFinite(Date.parse(text(body.dueAt))), 'Follow-up title and dueAt are required.');
      related = await deps.repository.create('tasks', agencyId, relatedId, { managedSiteId, title: text(body.title), taskType: 'incident_follow_up', linkedEntityType: 'incident', linkedEntityId: current.id, dueAt: text(body.dueAt), status: 'open' }, principal.uid);
      patch = { followUpAt: text(body.dueAt) };
    } else if (command.startsWith('key-') || command.startsWith('device-')) {
      const issue = command.endsWith('issue'); const device = command.startsWith('device-');
      const holderId = text(body.holderId); const currentHolder = text(device ? current.assignedToUserId : current.currentHolderId);
      requireState(issue ? !currentHolder && !['issued', 'checked_out'].includes(text(device ? current.status : current.custodyStatus)) : Boolean(currentHolder), 'Custody state does not permit this command.');
      requireState(!issue || holderId, 'Issue requires a holder.');
      if (issue) {
        requireState(!body.holderType || body.holderType === 'user', 'This command requires a site user as the holder.');
        const memberships = await deps.repository.list('siteMemberships', agencyId, 100, undefined, { userId: holderId, managedSiteId });
        requireState(memberships.items.some((m) => m.status === 'active' && (!m.validUntil || Date.parse(text(m.validUntil)) > Date.now())), 'Holder has no active membership for this site.');
      }
      if (device) {
        patch = { assignedToUserId: issue ? holderId : null, status: issue ? 'issued' : 'returned', ...(issue ? { issuedAt: now } : { deactivatedAt: now }) };
        related = await deps.repository.create('accessDeviceHistory', agencyId, relatedId, { accessDeviceId: current.id, action: issue ? 'issue' : 'return', actorUserId: principal.uid, assignedToUserId: issue ? holderId : currentHolder, occurredAt: now, status: 'recorded' }, principal.uid);
      } else {
        patch = { custodyStatus: issue ? 'checked_out' : 'available', currentHolderId: issue ? holderId : null, currentHolderType: issue ? text(body.holderType) || 'user' : null, currentHolderName: issue ? text(body.holderName) : null };
        related = await deps.repository.create('keyTransactions', agencyId, relatedId, { managedSiteId, keyId: current.id, holderId: issue ? holderId : currentHolder, holderType: issue ? text(body.holderType) || 'user' : current.currentHolderType, transactionType: issue ? 'issue' : 'return', occurredAt: now, authorisedBy: principal.uid, status: 'recorded' }, principal.uid);
      }
    } else {
      requireState(['in_progress', 'attended'].includes(text(current.status)), 'Work order must be in progress.');
      if (principal.contractorId) requireState(principal.contractorId === current.contractorId, 'Contractor assignment mismatch.');
      const evidence = await deps.repository.get('evidenceFiles', agencyId, text(body.evidenceFileId));
      requireState(evidence && evidence.managedSiteId === managedSiteId && evidence.entityId === current.id, 'Completion requires scoped work-order evidence.');
      const compliance = await deps.repository.list('contractorCompliance', agencyId, 100, undefined, { contractorId: text(current.contractorId) });
      requireState(!compliance.nextCursor && compliance.items.length && compliance.items.every((item) => item.complianceState === 'verified' && (!item.expiresAt || Date.parse(text(item.expiresAt)) > Date.now())), 'Contractor compliance is missing, incomplete or expired.');
      requireState(text(body.workPerformed), 'Work performed is required.');
      patch = { status: 'completed', completedAt: now, workPerformed: text(body.workPerformed), serviceReportEvidenceId: evidence.id };
    }
    const updated = await deps.repository.update(policy.collection, agencyId, current.id, patch, current.version, principal.uid);
    await deps.audit.append({ id: randomUUID(), actorId: principal.uid, agencyId, actorRole: principal.role, capability: policy.capability, outcome: 'allowed', reason: command, target: { agencyId, managedSiteId }, timestamp: now, correlationId, eventType: `command.${command}`, entityType: policy.collection, entityId: current.id, metadata: { relatedId: related?.id, previousStatus: current.status, resultingStatus: updated.status } });
    await deps.tasks.dispatch('notification', agencyId, randomUUID(), { eventType: `command.${command}`, entityId: current.id, managedSiteId, actorId: principal.uid });
    return { status: 200, body: { data: updated, ...(related ? { related } : {}), meta: { correlationId } } };
  });
  return { ...result.result, headers: { 'idempotency-replayed': String(result.replayed) } };
}
