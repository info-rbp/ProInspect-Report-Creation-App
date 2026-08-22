import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type {
  ClientApproval,
  ExternalAccessGrant,
  MaintenanceItem,
  MaintenanceQuote,
  MaintenanceQuoteStatus,
  MaintenanceQuoteVersion,
  MaintenanceVariation,
  MaintenanceWorkOrder,
  QuoteApprovalPolicy,
  SecurityCapability,
} from '@pcr/domain';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import {
  createMaintenanceWorkOrder,
  createPriceBookImport,
  createQuoteFromEstimate,
  extractMaintenanceForReport,
  generateMaintenanceEstimate,
  listAllOperationalRecords,
  publishPriceBookImport,
  runMaintenanceAutomation,
  sendMaintenanceQuoteForApproval,
  transitionMaintenanceQuote,
} from '../services/maintenanceCommercialService.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies, IdempotencyResult, StoredRecord } from './types.js';

function adminApp() { return getApps()[0] ?? initializeApp({ credential: applicationDefault() }); }
function routeParts(req: IncomingMessage): string[] { return new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean); }
function agencyHeader(req: IncomingMessage): string { const value = req.headers['x-agency-id']?.toString().trim(); if (!value) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.'); return value; }
async function readJson(req: IncomingMessage, maxBytes = 10 * 1024 * 1024): Promise<Record<string, unknown>> { const chunks: Buffer[] = []; let size = 0; for await (const chunk of req) { const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += buffer.length; if (size > maxBytes) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Maintenance commercial payload is too large.'); chunks.push(buffer); } if (!chunks.length) return {}; try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required'); return value as Record<string, unknown>; } catch { throw new ApiError(400, 'INVALID_JSON', 'Request body must be valid JSON.'); } }
function idempotencyKey(req: IncomingMessage): string { const value = req.headers['idempotency-key']?.toString().trim(); if (!value || value.length < 8 || value.length > 200) throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key is required.'); return value; }
function payloadHash(body: Record<string, unknown>): string { return createHash('sha256').update(JSON.stringify(body)).digest('hex'); }
async function idempotent(dependencies: ApiDependencies, req: IncomingMessage, agencyId: string, operation: string, body: Record<string, unknown>, action: () => Promise<IdempotencyResult>): Promise<ApiResponse> { const execution = await dependencies.idempotency.execute(agencyId, operation, idempotencyKey(req), payloadHash(body), action); return { status: execution.result.status, body: execution.result.body, headers: { 'idempotency-replayed': String(execution.replayed) } }; }
function expectedVersion(body: Record<string, unknown>): number { const value = body.expectedVersion; if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new ApiError(400, 'EXPECTED_VERSION_REQUIRED', 'expectedVersion must be a positive integer.'); return value; }
function requiredString(body: Record<string, unknown>, field: string): string { const value = typeof body[field] === 'string' ? body[field].trim() : ''; if (!value) throw new ApiError(400, 'FIELD_REQUIRED', `${field} is required.`); return value; }
function record<T>(value: StoredRecord | undefined): T { return value as unknown as T; }
function secureEqual(left: string, right: string): boolean { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); }
async function automationPrincipal(req: IncomingMessage, dependencies: ApiDependencies, agencyId: string, correlationId: string): Promise<{ uid: string; role: string; agencyId: string }> { const supplied = req.headers['x-proinspect-automation-secret']?.toString(); const expected = process.env.AUTOMATION_RUNNER_SECRET?.trim(); if (supplied && expected && secureEqual(supplied, expected)) return { uid: 'system:maintenance-automation', role: 'operations', agencyId }; return authenticateAndAuthorise(req, dependencies, 'maintenance.triage', { agencyId }, correlationId); }
async function principal(req: IncomingMessage, dependencies: ApiDependencies, capability: SecurityCapability, agencyId: string, correlationId: string, target: Record<string, unknown> = {}) { return authenticateAndAuthorise(req, dependencies, capability, { agencyId, ...target }, correlationId); }
function grantTokenHash(rawToken: string): string { return createHash('sha256').update(rawToken.trim()).digest('hex'); }

async function resolveQuoteGrant(rawToken: string): Promise<{ grant: ExternalAccessGrant & { version: number }; approval: ClientApproval & { version: number } }> {
  const snapshot = await getFirestore(adminApp()).collectionGroup('externalAccessGrants').where('tokenHash', '==', grantTokenHash(rawToken)).limit(2).get();
  if (snapshot.empty || snapshot.size !== 1) throw new ApiError(401, 'INVALID_GRANT_TOKEN', 'Quote approval link is invalid or expired.');
  const document = snapshot.docs[0]; const grant = document.data() as ExternalAccessGrant & { version: number };
  if (grant.resourceType !== 'client_approval' || grant.revokedAt) throw new ApiError(403, 'GRANT_SCOPE_MISMATCH', 'Quote approval link is not valid for this resource.');
  if (Date.parse(grant.expiresAt) <= Date.now()) throw new ApiError(401, 'GRANT_TOKEN_EXPIRED', 'Quote approval link has expired.');
  const approval = await document.ref.parent.parent?.collection('clientApprovals').doc(grant.resourceId).get();
  if (!approval?.exists) throw new ApiError(404, 'APPROVAL_NOT_FOUND', 'Quote approval record was not found.');
  await document.ref.update({ lastAccessedAt: new Date().toISOString() });
  return { grant, approval: approval.data() as ClientApproval & { version: number } };
}

async function externalQuotePortal(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string, rawToken: string): Promise<ApiResponse> {
  const { grant, approval } = await resolveQuoteGrant(rawToken);
  if (!approval.quoteId || !approval.quoteVersionId) throw new ApiError(409, 'QUOTE_APPROVAL_INCOMPLETE', 'Approval is not linked to an immutable quote version.');
  const [quoteRecord, versionRecord, itemRecord, propertyRecord] = await Promise.all([
    dependencies.repository.get('maintenanceQuotes', grant.agencyId, approval.quoteId),
    dependencies.repository.get('maintenanceQuoteVersions', grant.agencyId, approval.quoteVersionId),
    dependencies.repository.get('maintenanceItems', grant.agencyId, approval.maintenanceItemId),
    dependencies.repository.get('properties', grant.agencyId, approval.propertyId),
  ]);
  if (!quoteRecord || !versionRecord || !itemRecord) throw new ApiError(404, 'QUOTE_CONTEXT_NOT_FOUND', 'Quote context could not be loaded.');
  const quote = record<MaintenanceQuote>(quoteRecord); const quoteVersion = record<MaintenanceQuoteVersion>(versionRecord); const item = record<MaintenanceItem>(itemRecord);
  if (req.method === 'GET') {
    if (quote.status === 'sent') await dependencies.repository.update('maintenanceQuotes', grant.agencyId, quote.id, { status: 'viewed', viewedAt: new Date().toISOString() }, Number(quoteRecord.version), `external:${grant.id}`);
    await dependencies.audit.append({ id: randomUUID(), timestamp: new Date().toISOString(), actorId: `external:${grant.id}`, actorRole: 'external', agencyId: grant.agencyId, capability: 'client_approval.manage', outcome: 'allowed', reason: 'maintenance.quote_viewed', target: { agencyId: grant.agencyId, propertyId: approval.propertyId, maintenanceItemId: item.id }, correlationId, entityType: 'maintenance_quote', entityId: quote.id, eventType: 'maintenance.quote_viewed', metadata: { quoteVersionId: quoteVersion.id } });
    return { status: 200, body: { data: { quote: { ...quote, status: quote.status === 'sent' ? 'viewed' : quote.status }, version: quoteVersion, maintenanceItem: { id: item.id, title: item.title, description: item.description, priority: item.priority, category: item.category, sourceEvidenceIds: item.sourceEvidenceIds }, propertyAddress: propertyRecord ? [propertyRecord.address, propertyRecord.suburb, propertyRecord.state, propertyRecord.postcode].filter(Boolean).join(', ') : 'Property', approval }, meta: { correlationId } } };
  }
  if (req.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
  const body = await readJson(req); const decision = typeof body.decision === 'string' ? body.decision : '';
  if (!['accepted', 'declined', 'information_requested'].includes(decision)) throw new ApiError(400, 'INVALID_QUOTE_DECISION', 'Decision must be accepted, declined or information_requested.');
  if (!['sent', 'viewed', 'information_requested'].includes(quote.status)) throw new ApiError(409, 'QUOTE_ALREADY_RESOLVED', 'This quote is no longer awaiting a client decision.');
  const now = new Date().toISOString(); const actorId = `external:${grant.id}`; const comments = typeof body.comments === 'string' ? body.comments.trim() : '';
  const quoteStored = await dependencies.repository.update('maintenanceQuotes', grant.agencyId, quote.id, { status: decision, ...(decision === 'accepted' ? { acceptedAt: now } : {}), ...(decision === 'declined' ? { declinedAt: now } : {}), ...(decision === 'information_requested' ? { informationRequestedAt: now } : {}), ...(comments ? { clientComments: comments } : {}) }, Number(quoteRecord.version), actorId);
  await dependencies.repository.update('clientApprovals', grant.agencyId, approval.id, { status: decision === 'accepted' ? 'approved' : decision, clientNotes: comments, respondedAt: now, decisionTokenVerifiedAt: now }, Number(approval.version), actorId);
  const itemPatch: Record<string, unknown> = decision === 'accepted' ? { approvalStatus: 'approved', pricingStatus: 'quote_approved', approvedQuoteVersionId: quoteVersion.id } : decision === 'declined' ? { approvalStatus: 'declined', pricingStatus: 'review_required' } : { approvalStatus: 'pending', pricingStatus: 'review_required' };
  await dependencies.repository.update('maintenanceItems', grant.agencyId, item.id, itemPatch, Number(itemRecord.version), actorId);
  let workOrder: MaintenanceWorkOrder | undefined;
  if (decision === 'accepted') workOrder = await createMaintenanceWorkOrder(dependencies, { agencyId: grant.agencyId, quoteId: quote.id, actorId });
  await dependencies.audit.append({ id: randomUUID(), timestamp: now, actorId, actorRole: 'external', agencyId: grant.agencyId, capability: 'client_approval.manage', outcome: 'allowed', reason: `maintenance.quote_${decision}`, target: { agencyId: grant.agencyId, propertyId: approval.propertyId, maintenanceItemId: item.id }, correlationId, entityType: 'maintenance_quote', entityId: quote.id, eventType: `maintenance.quote_${decision}`, metadata: { quoteVersionId: quoteVersion.id, comments, workOrderId: workOrder?.id } });
  return { status: 200, body: { data: { quote: quoteStored, approvalStatus: decision, workOrder }, meta: { correlationId } } };
}

async function overview(dependencies: ApiDependencies, agencyId: string): Promise<Record<string, unknown>> {
  const [candidates, items, estimates, quotes, workOrders, variations, syncExceptions, syncRuns] = await Promise.all([
    listAllOperationalRecords(dependencies, 'maintenanceCandidates', agencyId),
    listAllOperationalRecords(dependencies, 'maintenanceItems', agencyId),
    listAllOperationalRecords(dependencies, 'maintenanceEstimates', agencyId),
    listAllOperationalRecords(dependencies, 'maintenanceQuotes', agencyId),
    listAllOperationalRecords(dependencies, 'maintenanceWorkOrders', agencyId),
    listAllOperationalRecords(dependencies, 'maintenanceVariations', agencyId),
    listAllOperationalRecords(dependencies, 'integrationSyncExceptions', agencyId),
    listAllOperationalRecords(dependencies, 'integrationSyncRuns', agencyId),
  ]);
  const quoteValue = quotes.filter((quote) => ['sent', 'viewed', 'accepted', 'converted_to_work_order'].includes(String(quote.status))).reduce((sum, quote) => sum + Number(quote.total || 0), 0);
  const integrationFailures = syncExceptions.filter((entry) => ['open', 'attention_required', 'failed'].includes(String(entry.status))).length + syncRuns.filter((entry) => entry.status === 'failed').length;
  return {
    candidates: { awaitingTriage: candidates.filter((candidate) => candidate.reviewStatus === 'suggested').length, urgent: candidates.filter((candidate) => ['urgent_hazard', 'emergency'].includes(String(candidate.safetyClassification))).length },
    items: { total: items.length, awaitingPricing: items.filter((item) => ['not_started', 'price_match_found'].includes(String(item.pricingStatus || 'not_started'))).length, pricingReview: items.filter((item) => item.pricingStatus === 'review_required').length, overdue: items.filter((item) => item.slaStatus === 'overdue').length, verification: items.filter((item) => item.status === 'verification_required').length },
    estimates: { total: estimates.length, reviewRequired: estimates.filter((estimate) => estimate.status === 'review_required').length },
    quotes: { total: quotes.length, awaitingInternalApproval: quotes.filter((quote) => ['draft', 'pricing_review_required'].includes(String(quote.status))).length, awaitingClient: quotes.filter((quote) => ['sent', 'viewed', 'information_requested'].includes(String(quote.status))).length, accepted: quotes.filter((quote) => ['accepted', 'converted_to_work_order'].includes(String(quote.status))).length, pipelineValue: Math.round(quoteValue * 100) / 100 },
    workOrders: { total: workOrders.length, active: workOrders.filter((order) => !['verified', 'closed', 'cancelled'].includes(String(order.status))).length },
    variations: { awaitingApproval: variations.filter((variation) => ['review_required', 'approval_required'].includes(String(variation.status))).length },
    integrations: { syncExceptions: integrationFailures },
  };
}

export async function routeMaintenanceCommercialRequest(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string): Promise<ApiResponse | undefined> {
  const parts = routeParts(req); if (parts[0] !== 'api' || parts[1] !== 'v1') return undefined;
  if (parts[2] === 'external' && parts[3] === 'maintenance-quotes' && parts[4]) return externalQuotePortal(req, dependencies, correlationId, parts[4]);
  const resource = parts[2];
  const supported = new Set(['maintenance-operations', 'price-book-imports', 'maintenance-candidates', 'maintenance-items', 'maintenance-quotes', 'maintenance-variations', 'contractor-quote-requests', 'quote-approval-policies', 'warranty-claims']);
  if (!resource || !supported.has(resource)) return undefined;
  const agencyId = agencyHeader(req);

  if (resource === 'maintenance-operations' && parts[3] === 'overview' && req.method === 'GET') {
    const actor = await principal(req, dependencies, 'maintenance.read', agencyId, correlationId);
    return { status: 200, body: { data: await overview(dependencies, agencyId), meta: { correlationId, actor: actor.uid } } };
  }
  if (resource === 'maintenance-operations' && parts[3] === 'run-automation' && req.method === 'POST') {
    const actor = await automationPrincipal(req, dependencies, agencyId, correlationId); const body = await readJson(req);
    return idempotent(dependencies, req, agencyId, 'maintenance-operations:run-automation', body, async () => ({ status: 200, body: { data: await runMaintenanceAutomation(dependencies, { agencyId, actorId: actor.uid, actorRole: actor.role, correlationId }), meta: { correlationId } } }));
  }
  if (resource === 'maintenance-candidates' && parts[3] === 'extract-automatic' && req.method === 'POST') {
    const body = await readJson(req); const reportId = requiredString(body, 'reportId'); const actor = await principal(req, dependencies, 'maintenance.triage', agencyId, correlationId, { reportId });
    return idempotent(dependencies, req, agencyId, `maintenance-extraction:${reportId}`, body, async () => ({ status: 200, body: { data: await extractMaintenanceForReport(dependencies, { agencyId, reportId, actorId: actor.uid, actorRole: actor.role, correlationId, preliminary: body.preliminary === true }), meta: { correlationId } } }));
  }
  if (resource === 'price-book-imports' && !parts[3] && req.method === 'POST') {
    const body = await readJson(req); const actor = await principal(req, dependencies, 'price_book.manage', agencyId, correlationId);
    const rows = Array.isArray(body.rows) ? body.rows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object' && !Array.isArray(row)) : [];
    if (!rows.length) throw new ApiError(400, 'PRICE_BOOK_ROWS_REQUIRED', 'At least one spreadsheet row is required.'); if (rows.length > 20_000) throw new ApiError(413, 'PRICE_BOOK_TOO_LARGE', 'Price-book import is limited to 20,000 rows.');
    const sha256 = requiredString(body, 'sha256').toLowerCase(); if (!/^[a-f0-9]{64}$/u.test(sha256)) throw new ApiError(400, 'SHA256_INVALID', 'sha256 must be a valid digest.');
    return idempotent(dependencies, req, agencyId, 'price-book-import:create', body, async () => { const created = await createPriceBookImport(dependencies, { agencyId, actorId: actor.uid, fileName: requiredString(body, 'fileName'), contentType: requiredString(body, 'contentType'), fileSize: Number(body.fileSize || 0), sha256, ...(typeof body.sheetName === 'string' ? { sheetName: body.sheetName } : {}), ...(typeof body.proposedPriceBookName === 'string' ? { proposedPriceBookName: body.proposedPriceBookName } : {}), rows }); return { status: 201, body: { data: created, meta: { correlationId } } }; });
  }
  if (resource === 'price-book-imports' && parts[3] && parts[4] === 'publish' && req.method === 'POST') {
    const body = await readJson(req); const actor = await principal(req, dependencies, 'price_book.manage', agencyId, correlationId);
    return idempotent(dependencies, req, agencyId, `price-book-import:${parts[3]}:publish`, body, async () => ({ status: 201, body: { data: await publishPriceBookImport(dependencies, { agencyId, importId: parts[3], actorId: actor.uid, ...(typeof body.name === 'string' ? { name: body.name } : {}), ...(typeof body.currency === 'string' ? { currency: body.currency } : {}), ...(typeof body.effectiveFrom === 'string' ? { effectiveFrom: body.effectiveFrom } : {}) }), meta: { correlationId } } }));
  }
  if (resource === 'maintenance-items' && parts[3] && parts[4] === 'estimate' && req.method === 'POST') {
    const body = await readJson(req); const item = await dependencies.repository.get('maintenanceItems', agencyId, parts[3]); if (!item) throw new ApiError(404, 'MAINTENANCE_ITEM_NOT_FOUND', 'Maintenance item not found.'); const actor = await principal(req, dependencies, 'maintenance.quote.prepare', agencyId, correlationId, { propertyId: item.propertyId, maintenanceItemId: item.id });
    return idempotent(dependencies, req, agencyId, `maintenance-item:${parts[3]}:estimate`, body, async () => ({ status: 201, body: { data: await generateMaintenanceEstimate(dependencies, { agencyId, maintenanceItemId: parts[3], actorId: actor.uid, ...(typeof body.preferredPriceBookId === 'string' ? { preferredPriceBookId: body.preferredPriceBookId } : {}), ...(typeof body.quantity === 'number' ? { quantity: body.quantity } : {}), afterHours: body.afterHours === true, saturday: body.saturday === true, sunday: body.sunday === true, publicHoliday: body.publicHoliday === true }), meta: { correlationId } } }));
  }
  if (resource === 'maintenance-items' && parts[3] && parts[4] === 'quotes' && req.method === 'POST') {
    const body = await readJson(req); const item = await dependencies.repository.get('maintenanceItems', agencyId, parts[3]); if (!item) throw new ApiError(404, 'MAINTENANCE_ITEM_NOT_FOUND', 'Maintenance item not found.'); const actor = await principal(req, dependencies, 'maintenance.quote.prepare', agencyId, correlationId, { propertyId: item.propertyId, maintenanceItemId: item.id });
    return idempotent(dependencies, req, agencyId, `maintenance-item:${parts[3]}:quote`, body, async () => ({ status: 201, body: { data: await createQuoteFromEstimate(dependencies, { agencyId, maintenanceItemId: parts[3], estimateId: requiredString(body, 'estimateId'), ...(typeof body.optionId === 'string' ? { optionId: body.optionId } : {}), actorId: actor.uid, ...(typeof body.validDays === 'number' ? { validDays: body.validDays } : {}) }), meta: { correlationId } } }));
  }
  if (resource === 'maintenance-quotes' && parts[3] && parts[4] === 'actions' && parts[5] && req.method === 'POST') {
    const body = await readJson(req); const quoteRecord = await dependencies.repository.get('maintenanceQuotes', agencyId, parts[3]); if (!quoteRecord) throw new ApiError(404, 'QUOTE_NOT_FOUND', 'Maintenance quote not found.'); const action = parts[5];
    if (action === 'sync-xero' || action === 'invoice') throw new ApiError(410, 'ACCOUNTING_EXECUTION_REMOVED', 'Accounting execution is outside ProInspect. Publish the operational record to the connected PMS or accounting system instead.');
    const capability: SecurityCapability = action === 'send' ? 'maintenance.quote.send' : 'maintenance.quote.approve';
    const actor = await principal(req, dependencies, capability, agencyId, correlationId, { propertyId: quoteRecord.propertyId, maintenanceItemId: quoteRecord.maintenanceItemId, maintenanceQuoteId: quoteRecord.id });
    if (action === 'send') return idempotent(dependencies, req, agencyId, `maintenance-quote:${parts[3]}:send`, body, async () => ({ status: 200, body: { data: await sendMaintenanceQuoteForApproval(dependencies, { agencyId, quoteId: parts[3], expectedVersion: expectedVersion(body), actorId: actor.uid, actorRole: actor.role, correlationId, ...(typeof body.recipientEmail === 'string' ? { recipientEmail: body.recipientEmail } : {}) }), meta: { correlationId } } }));
    if (action === 'convert') return idempotent(dependencies, req, agencyId, `maintenance-quote:${parts[3]}:convert`, body, async () => ({ status: 201, body: { data: await createMaintenanceWorkOrder(dependencies, { agencyId, quoteId: parts[3], actorId: actor.uid, ...(typeof body.externalContactId === 'string' ? { externalContactId: body.externalContactId } : {}) }), meta: { correlationId } } }));
    const nextByAction: Record<string, MaintenanceQuoteStatus> = { 'request-pricing-review': 'pricing_review_required', 'internal-approve': 'internally_approved', ready: 'ready_to_send', cancel: 'cancelled', supersede: 'superseded' };
    const nextStatus = nextByAction[action]; if (!nextStatus) return undefined;
    return idempotent(dependencies, req, agencyId, `maintenance-quote:${parts[3]}:${action}`, body, async () => ({ status: 200, body: { data: await transitionMaintenanceQuote(dependencies, { agencyId, quoteId: parts[3], expectedVersion: expectedVersion(body), nextStatus, actorId: actor.uid, ...(typeof body.reason === 'string' ? { reason: body.reason } : {}) }), meta: { correlationId } } }));
  }
  if (resource === 'maintenance-variations' && req.method === 'POST' && !parts[3]) {
    const body = await readJson(req); const item = await dependencies.repository.get('maintenanceItems', agencyId, requiredString(body, 'maintenanceItemId')); if (!item) throw new ApiError(404, 'MAINTENANCE_ITEM_NOT_FOUND', 'Maintenance item not found.'); const actor = await principal(req, dependencies, 'maintenance.quote.prepare', agencyId, correlationId, { propertyId: item.propertyId, maintenanceItemId: item.id }); const id = randomUUID(); const now = new Date().toISOString(); const exTax = Number(body.amountExcludingTax || 0); const tax = Number(body.taxAmount || 0);
    const variation: Omit<MaintenanceVariation, 'version'> = { id, agencyId, maintenanceItemId: item.id, workOrderId: requiredString(body, 'workOrderId'), quoteId: requiredString(body, 'quoteId'), status: 'review_required', reason: requiredString(body, 'reason'), scopeChange: requiredString(body, 'scopeChange'), amountExcludingTax: exTax, taxAmount: tax, total: exTax + tax, evidenceIds: Array.isArray(body.evidenceIds) ? body.evidenceIds.filter((value): value is string => typeof value === 'string') : [], requestedBy: actor.uid, requestedAt: now, createdAt: now, updatedAt: now };
    return idempotent(dependencies, req, agencyId, 'maintenance-variation:create', body, async () => ({ status: 201, body: { data: await dependencies.repository.create('maintenanceVariations', agencyId, id, variation as unknown as Record<string, unknown>, actor.uid), meta: { correlationId } } }));
  }
  if (resource === 'maintenance-variations' && parts[3] && parts[4] === 'actions' && parts[5] && req.method === 'POST') {
    const body = await readJson(req); const variation = await dependencies.repository.get('maintenanceVariations', agencyId, parts[3]); if (!variation) throw new ApiError(404, 'VARIATION_NOT_FOUND', 'Maintenance variation not found.'); const actor = await principal(req, dependencies, 'maintenance.quote.approve', agencyId, correlationId); const action = parts[5]; const nextStatus = action === 'approve' ? 'approved' : action === 'decline' ? 'declined' : action === 'request-approval' ? 'approval_required' : action === 'cancel' ? 'cancelled' : undefined; if (!nextStatus) return undefined;
    return idempotent(dependencies, req, agencyId, `maintenance-variation:${parts[3]}:${action}`, body, async () => ({ status: 200, body: { data: await dependencies.repository.update('maintenanceVariations', agencyId, parts[3], { status: nextStatus, ...(nextStatus === 'approved' ? { approvedBy: actor.uid, approvedAt: new Date().toISOString() } : {}) }, expectedVersion(body), actor.uid), meta: { correlationId } } }));
  }
  if (resource === 'contractor-quote-requests' && req.method === 'POST' && !parts[3]) {
    const body = await readJson(req); const item = await dependencies.repository.get('maintenanceItems', agencyId, requiredString(body, 'maintenanceItemId')); if (!item) throw new ApiError(404, 'MAINTENANCE_ITEM_NOT_FOUND', 'Maintenance item not found.'); const actor = await principal(req, dependencies, 'maintenance.quote.prepare', agencyId, correlationId, { propertyId: item.propertyId, maintenanceItemId: item.id });
    const contractorIds = Array.isArray(body.contractorIds) ? [...new Set(body.contractorIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))] : []; if (!contractorIds.length) throw new ApiError(400, 'CONTRACTOR_REQUIRED', 'Select at least one contractor.'); const id = randomUUID();
    return idempotent(dependencies, req, agencyId, 'contractor-quote-request:create', body, async () => ({ status: 201, body: { data: await dependencies.repository.create('contractorQuoteRequests', agencyId, id, { maintenanceItemId: item.id, contractorIds, status: 'draft', scope: requiredString(body, 'scope'), evidencePhotoIds: Array.isArray(item.sourceEvidenceIds) ? item.sourceEvidenceIds : [], ...(typeof body.dueAt === 'string' ? { dueAt: body.dueAt } : {}), createdBy: actor.uid }, actor.uid), meta: { correlationId } } }));
  }
  if (resource === 'quote-approval-policies' && req.method === 'POST' && !parts[3]) {
    const body = await readJson(req); const actor = await principal(req, dependencies, 'maintenance.quote.approve', agencyId, correlationId); const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : randomUUID();
    const policy: Omit<QuoteApprovalPolicy, 'version'> = { id, agencyId, name: requiredString(body, 'name'), active: body.active !== false, propertyUses: Array.isArray(body.propertyUses) ? body.propertyUses as QuoteApprovalPolicy['propertyUses'] : [], ...(typeof body.propertyManagerDelegatedLimit === 'number' ? { propertyManagerDelegatedLimit: body.propertyManagerDelegatedLimit } : {}), landlordApprovalThreshold: Number(body.landlordApprovalThreshold || 0), ...(typeof body.secondApprovalThreshold === 'number' ? { secondApprovalThreshold: body.secondApprovalThreshold } : {}), ...(typeof body.emergencyAuthorisationLimit === 'number' ? { emergencyAuthorisationLimit: body.emergencyAuthorisationLimit } : {}), mandatoryReplacementApproval: body.mandatoryReplacementApproval !== false, mandatoryCapitalApproval: body.mandatoryCapitalApproval !== false, mandatoryCosmeticApproval: body.mandatoryCosmeticApproval !== false, autoApprovePreauthorisedServices: body.autoApprovePreauthorisedServices === true, approvalLinkExpiryHours: Number(body.approvalLinkExpiryHours || 168), reminderHours: Array.isArray(body.reminderHours) ? body.reminderHours.filter((value): value is number => typeof value === 'number') : [24, 72, 120], createdBy: actor.uid, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    return idempotent(dependencies, req, agencyId, 'quote-approval-policy:create', body, async () => ({ status: 201, body: { data: await dependencies.repository.create('quoteApprovalPolicies', agencyId, id, policy as unknown as Record<string, unknown>, actor.uid), meta: { correlationId } } }));
  }
  if (resource === 'warranty-claims' && req.method === 'POST' && !parts[3]) {
    const body = await readJson(req); const item = await dependencies.repository.get('maintenanceItems', agencyId, requiredString(body, 'maintenanceItemId')); if (!item) throw new ApiError(404, 'MAINTENANCE_ITEM_NOT_FOUND', 'Maintenance item not found.'); const actor = await principal(req, dependencies, 'maintenance.triage', agencyId, correlationId, { propertyId: item.propertyId, maintenanceItemId: item.id }); const id = randomUUID();
    return idempotent(dependencies, req, agencyId, 'warranty-claim:create', body, async () => ({ status: 201, body: { data: await dependencies.repository.create('warrantyClaims', agencyId, id, { maintenanceItemId: item.id, propertyId: item.propertyId, ...(typeof body.assetId === 'string' ? { assetId: body.assetId } : {}), ...(typeof body.previousWorkOrderId === 'string' ? { previousWorkOrderId: body.previousWorkOrderId } : {}), ...(typeof body.providerName === 'string' ? { providerName: body.providerName } : {}), ...(typeof body.warrantyExpiresAt === 'string' ? { warrantyExpiresAt: body.warrantyExpiresAt } : {}), status: 'review_required', ...(typeof body.notes === 'string' ? { notes: body.notes } : {}), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, actor.uid), meta: { correlationId } } }));
  }
  return undefined;
}
