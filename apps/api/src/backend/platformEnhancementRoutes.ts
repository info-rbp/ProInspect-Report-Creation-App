import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { SecurityCapability } from '@pcr/domain';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies, StoredRecord } from './types.js';

function parts(req: IncomingMessage): string[] { return new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean); }
function agencyId(req: IncomingMessage): string { const value = req.headers['x-agency-id']?.toString().trim(); if (!value) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.'); return value; }
async function readJson(req: IncomingMessage, maxBytes = 2_000_000): Promise<Record<string, unknown>> { const chunks: Buffer[] = []; let size = 0; for await (const chunk of req) { const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += buffer.length; if (size > maxBytes) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.'); chunks.push(buffer); } if (!chunks.length) return {}; const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'INVALID_JSON', 'Request body must be a JSON object.'); return value as Record<string, unknown>; }
async function listAll(deps: ApiDependencies, collection: string, agency: string): Promise<StoredRecord[]> { const out: StoredRecord[] = []; let cursor: string | undefined; do { const page = await deps.repository.list(collection, agency, 100, cursor); out.push(...page.items); cursor = page.nextCursor; } while (cursor); return out; }
function expected(body: Record<string, unknown>): number { const value = Number(body.expectedVersion); if (!Number.isInteger(value) || value < 1) throw new ApiError(400, 'EXPECTED_VERSION_REQUIRED', 'expectedVersion must be a positive integer.'); return value; }
async function authorise(req: IncomingMessage, deps: ApiDependencies, capability: SecurityCapability, agency: string, correlationId: string, target: Record<string, string | undefined> = {}) { return authenticateAndAuthorise(req, deps, capability, { agencyId: agency, ...target }, correlationId); }
function sha(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

async function collectionCrud(req: IncomingMessage, deps: ApiDependencies, correlationId: string, input: { segment: string; collection: string; read: SecurityCapability; write: SecurityCapability }): Promise<ApiResponse | undefined> {
  const route = parts(req); if (route[0] !== 'api' || route[1] !== 'v1' || route[2] !== input.segment) return undefined;
  const agency = agencyId(req); const principal = await authorise(req, deps, req.method === 'GET' ? input.read : input.write, agency, correlationId);
  const id = route[3];
  if (req.method === 'GET' && !id) return { status: 200, body: { data: await listAll(deps, input.collection, agency), meta: { correlationId } } };
  if (req.method === 'GET' && id) { const record = await deps.repository.get(input.collection, agency, id); if (!record) throw new ApiError(404, 'NOT_FOUND', `${input.segment} record was not found.`); return { status: 200, body: { data: record, meta: { correlationId } } }; }
  const body = await readJson(req);
  if (req.method === 'POST' && !id) { const recordId = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : randomUUID(); const record = await deps.repository.create(input.collection, agency, recordId, { ...body, id: undefined, agencyId: undefined }, principal.uid); return { status: 201, body: { data: record, meta: { correlationId } } }; }
  if (req.method === 'PATCH' && id) { const record = await deps.repository.update(input.collection, agency, id, { ...body, expectedVersion: undefined }, expected(body), principal.uid); return { status: 200, body: { data: record, meta: { correlationId } } }; }
  return undefined;
}

async function routeDocumentPackets(req: IncomingMessage, deps: ApiDependencies, correlationId: string): Promise<ApiResponse | undefined> {
  const route = parts(req); if (route[0] !== 'api' || route[1] !== 'v1' || route[2] !== 'document-packets') return undefined;
  const agency = agencyId(req); const id = route[3]; const action = route[4];
  if (!id || !action) return collectionCrud(req, deps, correlationId, { segment: 'document-packets', collection: 'documentPackets', read: 'document.packet.read', write: 'document.packet.manage' });
  const body = req.method === 'POST' || req.method === 'PATCH' ? await readJson(req) : {};
  const capability: SecurityCapability = action === 'approve' ? 'document.packet.approve' : action === 'issue' ? 'document.packet.issue' : 'document.packet.manage';
  const principal = await authorise(req, deps, capability, agency, correlationId);
  const current = await deps.repository.get('documentPackets', agency, id); if (!current) throw new ApiError(404, 'DOCUMENT_PACKET_NOT_FOUND', 'Document packet was not found.');
  if (req.method !== 'POST') return undefined;
  if (action === 'validate') {
    const documents = Array.isArray(current.documentIds) ? current.documentIds : [];
    const recipients = Array.isArray(current.recipients) ? current.recipients : [];
    const blockers = [...(!documents.length ? ['At least one document is required.'] : []), ...(!recipients.length ? ['At least one recipient is required.'] : [])];
    const next = blockers.length ? 'validation_required' : 'approval_required';
    const updated = await deps.repository.update('documentPackets', agency, id, { status: next, validationBlockers: blockers }, Number(current.version), principal.uid);
    return { status: 200, body: { data: updated, meta: { correlationId, blockers } } };
  }
  if (action === 'approve') { const updated = await deps.repository.update('documentPackets', agency, id, { status: 'ready_to_issue', approvedAt: new Date().toISOString(), approvedBy: principal.uid }, expected(body), principal.uid); return { status: 200, body: { data: updated, meta: { correlationId } } }; }
  if (action === 'issue') { if (String(current.status) !== 'ready_to_issue') throw new ApiError(409, 'PACKET_NOT_READY', 'Only a ready_to_issue packet may be issued.'); const updated = await deps.repository.update('documentPackets', agency, id, { status: 'issued', issuedAt: new Date().toISOString(), issuedBy: principal.uid, dataSnapshotSha256: String(current.dataSnapshotSha256 || sha(current.dataSnapshot || {})) }, expected(body), principal.uid); return { status: 200, body: { data: updated, meta: { correlationId } } }; }
  if (action === 'void') { const updated = await deps.repository.update('documentPackets', agency, id, { status: 'voided', voidedAt: new Date().toISOString(), voidedBy: principal.uid, voidReason: body.reason }, expected(body), principal.uid); return { status: 200, body: { data: updated, meta: { correlationId } } }; }
  return undefined;
}

async function routeOffline(req: IncomingMessage, deps: ApiDependencies, correlationId: string): Promise<ApiResponse | undefined> {
  const route = parts(req); if (route[0] !== 'api' || route[1] !== 'v1' || route[2] !== 'inspection-jobs' || !route[3] || !['offline-package', 'offline-sync', 'sync-status'].includes(route[4] || '')) return undefined;
  const agency = agencyId(req); const jobId = route[3]; const action = route[4]; const principal = await authorise(req, deps, 'job.offline.sync', agency, correlationId, { inspectionJobId: jobId });
  const job = await deps.repository.get('inspectionJobs', agency, jobId); if (!job) throw new ApiError(404, 'INSPECTION_JOB_NOT_FOUND', 'Inspection job was not found.');
  if (req.method === 'GET' && action === 'offline-package') {
    const propertyId = String(job.propertyId || (job.propertySnapshot as Record<string, unknown> | undefined)?.propertyId || '');
    const reportId = String(job.reportId || '');
    const [property, report, tenancy] = await Promise.all([
      propertyId ? deps.repository.get('properties', agency, propertyId) : undefined,
      reportId ? deps.repository.get('reports', agency, reportId) : undefined,
      job.tenancyId ? deps.repository.get('tenancies', agency, String(job.tenancyId)) : undefined,
    ]);
    return { status: 200, body: { data: { job, property, report, tenancy, downloadedAt: new Date().toISOString(), packageHash: sha({ job, property, report, tenancy }) }, meta: { correlationId, actor: principal.uid } } };
  }
  if (req.method === 'GET' && action === 'sync-status') { const uploads = (await listAll(deps, 'uploadSessions', agency)).filter((item) => item.inspectionJobId === jobId); const pending = uploads.filter((item) => !['completed', 'duplicate'].includes(String(item.status))).length; return { status: 200, body: { data: { inspectionJobId: jobId, cloudVersion: job.version, pendingUploads: pending, ready: pending === 0 }, meta: { correlationId } } }; }
  if (req.method === 'POST' && action === 'offline-sync') { const body = await readJson(req); const baseVersion = Number(body.baseVersion); if (baseVersion !== Number(job.version)) return { status: 409, body: { error: { code: 'OFFLINE_CONFLICT', message: 'The cloud inspection job changed after the offline package was downloaded.', status: 409, correlationId, details: { cloudVersion: job.version, baseVersion } } } }; const patch = body.patch && typeof body.patch === 'object' && !Array.isArray(body.patch) ? body.patch as Record<string, unknown> : {}; const updated = await deps.repository.update('inspectionJobs', agency, jobId, { ...patch, lastOfflineSyncAt: new Date().toISOString() }, baseVersion, principal.uid); return { status: 200, body: { data: updated, meta: { correlationId } } }; }
  return undefined;
}

async function routeKeyEvents(req: IncomingMessage, deps: ApiDependencies, correlationId: string): Promise<ApiResponse | undefined> {
  const route = parts(req); if (route[0] !== 'api' || route[1] !== 'v1' || route[2] !== 'key-register' || !route[3] || route[4] !== 'events' || req.method !== 'POST') return undefined;
  const agency = agencyId(req); const principal = await authorise(req, deps, 'key.manage', agency, correlationId); const body = await readJson(req); const item = await deps.repository.get('accessDeviceRegister', agency, route[3]); if (!item) throw new ApiError(404, 'ACCESS_DEVICE_NOT_FOUND', 'Access device was not found.');
  const eventType = String(body.eventType || ''); if (!['checked_out', 'transferred', 'returned', 'lost', 'replaced', 'deactivated'].includes(eventType)) throw new ApiError(400, 'KEY_EVENT_INVALID', 'Unsupported key custody event.');
  const event = await deps.repository.create('accessDeviceCustodyEvents', agency, randomUUID(), { accessDeviceId: item.id, propertyId: item.propertyId, inspectionJobId: body.inspectionJobId, eventType, fromHolderId: item.currentHolderId, toHolderId: body.toHolderId, notes: body.notes, occurredAt: new Date().toISOString(), actorId: principal.uid }, principal.uid);
  const status = eventType === 'returned' ? 'available' : eventType === 'lost' ? 'lost' : eventType === 'replaced' ? 'replaced' : eventType === 'deactivated' ? 'deactivated' : 'checked_out';
  const updated = await deps.repository.update('accessDeviceRegister', agency, item.id, { status, currentHolderId: eventType === 'returned' ? null : body.toHolderId || item.currentHolderId, currentInspectionJobId: eventType === 'returned' ? null : body.inspectionJobId || item.currentInspectionJobId, lastEventAt: new Date().toISOString() }, Number(item.version), principal.uid);
  return { status: 201, body: { data: { item: updated, event }, meta: { correlationId } } };
}

export async function routePlatformEnhancementRequest(req: IncomingMessage, deps: ApiDependencies, correlationId: string): Promise<ApiResponse | undefined> {
  const handlers = [routeDocumentPackets, routeOffline, routeKeyEvents] as const;
  for (const handler of handlers) { const response = await handler(req, deps, correlationId); if (response) return response; }
  const specs = [
    { segment: 'jurisdiction-policies', collection: 'jurisdictionPolicyVersions', read: 'document.policy.read', write: 'document.policy.manage' },
    { segment: 'document-template-versions', collection: 'documentTemplateVersions', read: 'document.policy.read', write: 'document.policy.manage' },
    { segment: 'esign-envelopes', collection: 'esignEnvelopes', read: 'document.packet.read', write: 'document.sign.manage' },
    { segment: 'communication-threads', collection: 'communicationThreads', read: 'communication.read', write: 'communication.manage' },
    { segment: 'communication-messages', collection: 'communicationMessages', read: 'communication.read', write: 'communication.send' },
    { segment: 'compliance-rules', collection: 'complianceRuleVersions', read: 'compliance.read', write: 'compliance.rule.manage' },
    { segment: 'compliance-obligations', collection: 'complianceObligations', read: 'compliance.read', write: 'compliance.manage' },
    { segment: 'inspection-route-plans', collection: 'inspectionRoutePlans', read: 'job.read', write: 'job.plan' },
    { segment: 'key-register', collection: 'accessDeviceRegister', read: 'key.read', write: 'key.manage' },
    { segment: 'pms-connections', collection: 'pmsConnections', read: 'integration.read', write: 'integration.manage' },
    { segment: 'integration-sync-runs', collection: 'integrationSyncRuns', read: 'integration.read', write: 'integration.sync' },
    { segment: 'external-references', collection: 'externalReferences', read: 'integration.read', write: 'integration.sync' },
    { segment: 'remote-inspection-assignments', collection: 'remoteInspectionAssignments', read: 'job.read', write: 'job.remote.manage' },
    { segment: 'remote-inspection-submissions', collection: 'remoteInspectionSubmissions', read: 'job.read', write: 'job.remote.manage' },
    { segment: 'service-records', collection: 'serviceRecords', read: 'document.packet.read', write: 'service_record.manage' },
  ] as const;
  for (const spec of specs) { const response = await collectionCrud(req, deps, correlationId, spec); if (response) return response; }
  return undefined;
}
