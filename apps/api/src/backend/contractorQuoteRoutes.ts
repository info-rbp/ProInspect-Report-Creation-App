import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type {
  ContractorQuote,
  ContractorQuoteRequest,
  ExternalContact,
  MaintenanceEstimate,
  MaintenanceEstimateOption,
  MaintenanceItem,
  PriceBookUnit,
} from '@pcr/domain';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies, IdempotencyResult, StoredRecord } from './types.js';

function adminApp() {
  return getApps()[0] ?? initializeApp({ credential: applicationDefault() });
}

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
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 2_000_000) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Contractor quote payload exceeds 2 MB.');
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

function idempotencyKey(req: IncomingMessage): string {
  const value = req.headers['idempotency-key']?.toString().trim();
  if (!value || value.length < 8 || value.length > 200) {
    throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key is required.');
  }
  return value;
}

async function idempotent(
  dependencies: ApiDependencies,
  req: IncomingMessage,
  agencyId: string,
  operation: string,
  body: Record<string, unknown>,
  action: () => Promise<IdempotencyResult>,
): Promise<ApiResponse> {
  const result = await dependencies.idempotency.execute(
    agencyId,
    operation,
    idempotencyKey(req),
    createHash('sha256').update(JSON.stringify(body)).digest('hex'),
    action,
  );
  return {
    status: result.result.status,
    body: result.result.body,
    headers: { 'idempotency-replayed': String(result.replayed) },
  };
}

function expectedVersion(body: Record<string, unknown>): number {
  const value = body.expectedVersion;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new ApiError(400, 'EXPECTED_VERSION_REQUIRED', 'expectedVersion must be a positive integer.');
  }
  return value;
}

function hashToken(value: string): string {
  return createHash('sha256').update(value.trim()).digest('hex');
}

function typed<T>(value: StoredRecord | undefined): T {
  return value as unknown as T;
}

async function resolveGrant(token: string): Promise<{
  grant: Record<string, unknown> & { id: string; agencyId: string; version: number };
  reference: FirebaseFirestore.DocumentReference;
}> {
  const snapshot = await getFirestore(adminApp())
    .collectionGroup('contractorQuoteAccessGrants')
    .where('tokenHash', '==', hashToken(token))
    .limit(2)
    .get();
  if (snapshot.empty || snapshot.size !== 1) {
    throw new ApiError(401, 'INVALID_GRANT_TOKEN', 'Contractor quote link is invalid or expired.');
  }
  const document = snapshot.docs[0];
  const grant = document.data() as Record<string, unknown> & {
    id: string;
    agencyId: string;
    version: number;
  };
  if (grant.revokedAt || typeof grant.expiresAt !== 'string' || Date.parse(grant.expiresAt) <= Date.now()) {
    throw new ApiError(401, 'GRANT_TOKEN_EXPIRED', 'Contractor quote link is expired or revoked.');
  }
  await document.ref.update({ lastAccessedAt: new Date().toISOString() });
  return { grant, reference: document.ref };
}

async function externalPortal(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
  token: string,
): Promise<ApiResponse> {
  const { grant } = await resolveGrant(token);
  const requestId = String(grant.contractorQuoteRequestId || '');
  const contactId = String(grant.externalContactId || '');
  const [requestRecord, contactRecord] = await Promise.all([
    dependencies.repository.get('contractorQuoteRequests', grant.agencyId, requestId),
    dependencies.repository.get('externalContacts', grant.agencyId, contactId),
  ]);
  if (!requestRecord || !contactRecord) {
    throw new ApiError(404, 'CONTRACTOR_QUOTE_CONTEXT_NOT_FOUND', 'Contractor quote request could not be loaded.');
  }
  const request = typed<ContractorQuoteRequest>(requestRecord);
  const contact = typed<ExternalContact>(contactRecord);
  const itemRecord = await dependencies.repository.get(
    'maintenanceItems',
    grant.agencyId,
    request.maintenanceItemId,
  );
  if (!itemRecord) throw new ApiError(404, 'MAINTENANCE_ITEM_NOT_FOUND', 'Maintenance item was not found.');
  const item = typed<MaintenanceItem>(itemRecord);
  const property = await dependencies.repository.get('properties', grant.agencyId, item.propertyId);
  if (req.method === 'GET') {
    return {
      status: 200,
      body: {
        data: {
          request,
          contractor: {
            id: contact.id,
            name: contact.name,
            businessName: contact.businessName,
            email: contact.email,
          },
          maintenanceItem: {
            id: item.id,
            title: item.title,
            description: item.description,
            category: item.category,
            priority: item.priority,
            sourceEvidenceIds: item.sourceEvidenceIds,
          },
          propertyAddress: property
            ? [property.address, property.suburb, property.state, property.postcode]
                .filter(Boolean)
                .join(', ')
            : 'Property',
        },
        meta: { correlationId },
      },
    };
  }
  if (req.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
  if (!['issued', 'responses_received'].includes(request.status)) {
    throw new ApiError(409, 'CONTRACTOR_QUOTE_REQUEST_CLOSED', 'This quote request is not accepting responses.');
  }
  const body = await readJson(req);
  const subtotal = Number(body.subtotal || 0);
  const tax = Number(body.tax || 0);
  if (!Number.isFinite(subtotal) || subtotal < 0 || !Number.isFinite(tax) || tax < 0) {
    throw new ApiError(400, 'CONTRACTOR_QUOTE_TOTAL_INVALID', 'Subtotal and tax must be valid non-negative amounts.');
  }
  const scope = typeof body.scope === 'string' ? body.scope.trim() : '';
  if (!scope) throw new ApiError(400, 'CONTRACTOR_SCOPE_REQUIRED', 'A contractor scope is required.');
  const existingQuotes = await dependencies.repository.list('contractorQuotes', grant.agencyId, 100);
  const existing = existingQuotes.items.find(
    (quote) =>
      quote.contractorQuoteRequestId === request.id &&
      quote.externalContactId === contact.id &&
      !['withdrawn', 'expired'].includes(String(quote.status)),
  );
  const now = new Date().toISOString();
  const data = {
    contractorQuoteRequestId: request.id,
    maintenanceItemId: item.id,
    externalContactId: contact.id,
    status: 'submitted',
    scope,
    exclusions: Array.isArray(body.exclusions)
      ? body.exclusions.filter((value): value is string => typeof value === 'string')
      : [],
    ...(typeof body.estimatedStartAt === 'string' ? { estimatedStartAt: body.estimatedStartAt } : {}),
    ...(typeof body.estimatedCompletionAt === 'string'
      ? { estimatedCompletionAt: body.estimatedCompletionAt }
      : {}),
    subtotal,
    tax,
    total: subtotal + tax,
    currency: typeof body.currency === 'string' ? body.currency.toUpperCase() : 'AUD',
    evidenceDocumentIds: Array.isArray(body.evidenceDocumentIds)
      ? body.evidenceDocumentIds.filter((value): value is string => typeof value === 'string')
      : [],
    submittedAt: now,
  };
  const quote = existing
    ? await dependencies.repository.update(
        'contractorQuotes',
        grant.agencyId,
        existing.id,
        data,
        Number(existing.version),
        `external:${grant.id}`,
      )
    : await dependencies.repository.create(
        'contractorQuotes',
        grant.agencyId,
        randomUUID(),
        data,
        `external:${grant.id}`,
      );
  if (request.status === 'issued') {
    await dependencies.repository.update(
      'contractorQuoteRequests',
      grant.agencyId,
      request.id,
      { status: 'responses_received' },
      Number(requestRecord.version),
      `external:${grant.id}`,
    );
  }
  await dependencies.audit.append({
    id: randomUUID(),
    timestamp: now,
    actorId: `external:${grant.id}`,
    actorRole: 'external',
    agencyId: grant.agencyId,
    capability: 'maintenance.quote.prepare',
    outcome: 'allowed',
    reason: 'contractor_quote.submitted',
    target: { agencyId: grant.agencyId, propertyId: item.propertyId, maintenanceItemId: item.id },
    correlationId,
    entityType: 'contractor_quote',
    entityId: quote.id,
    eventType: 'contractor_quote.submitted',
    metadata: { contractorQuoteRequestId: request.id, externalContactId: contact.id, total: subtotal + tax },
  });
  return { status: existing ? 200 : 201, body: { data: quote, meta: { correlationId } } };
}

function estimateFromContractorQuote(
  agencyId: string,
  item: MaintenanceItem,
  quote: ContractorQuote,
  actorId: string,
): Omit<MaintenanceEstimate, 'version'> {
  const line = {
    id: `contractor-estimate-line-${quote.id}`,
    description: quote.scope,
    quantity: 1,
    unit: 'fixed' as PriceBookUnit,
    labourCost: 0,
    materialCost: 0,
    calloutCost: 0,
    travelCost: 0,
    disposalCost: 0,
    subcontractorCost: quote.subtotal,
    otherDirectCost: 0,
    directCost: quote.subtotal,
    markupAmount: 0,
    administrationFee: 0,
    sellPriceExcludingTax: quote.subtotal,
    taxAmount: quote.tax,
    totalIncludingTax: quote.total,
    confidence: 1,
    matchReasons: ['Submitted contractor quote selected by an authorised operator.'],
    requiresReview: true,
  };
  const option: MaintenanceEstimateOption = {
    id: `contractor-option-${quote.id}`,
    type: 'custom',
    label: 'Selected contractor quote',
    description: quote.scope,
    recommended: true,
    lineItems: [line],
    subtotal: quote.subtotal,
    tax: quote.tax,
    total: quote.total,
    exclusions: quote.exclusions,
    siteAssessmentRequired: false,
  };
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    agencyId,
    maintenanceItemId: item.id,
    status: 'review_required',
    currency: quote.currency,
    options: [option],
    selectedOptionId: option.id,
    confidence: 1,
    reviewReasons: ['Contractor price requires internal commercial review before client issue.'],
    sourceFingerprint: createHash('sha256').update(`${item.id}|${quote.id}|${quote.updatedAt}`).digest('hex'),
    calculatedAt: now,
    calculatedBy: actorId,
    createdAt: now,
    updatedAt: now,
  };
}

export async function routeContractorQuoteRequest(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
): Promise<ApiResponse | undefined> {
  const route = parts(req);
  if (route[0] !== 'api' || route[1] !== 'v1') return undefined;
  if (route[2] === 'external' && route[3] === 'contractor-quotes' && route[4]) {
    return externalPortal(req, dependencies, correlationId, route[4]);
  }
  if (route[2] !== 'contractor-quote-requests' || !route[3] || route[4] !== 'actions' || !route[5]) {
    return undefined;
  }
  if (req.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Contractor quote actions require POST.');
  const agencyId = agencyHeader(req);
  const body = await readJson(req);
  const requestRecord = await dependencies.repository.get('contractorQuoteRequests', agencyId, route[3]);
  if (!requestRecord) throw new ApiError(404, 'CONTRACTOR_QUOTE_REQUEST_NOT_FOUND', 'Contractor quote request was not found.');
  const request = typed<ContractorQuoteRequest>(requestRecord);
  const itemRecord = await dependencies.repository.get('maintenanceItems', agencyId, request.maintenanceItemId);
  if (!itemRecord) throw new ApiError(404, 'MAINTENANCE_ITEM_NOT_FOUND', 'Maintenance item was not found.');
  const item = typed<MaintenanceItem>(itemRecord);
  const principal = await authenticateAndAuthorise(
    req,
    dependencies,
    route[5] === 'select' ? 'maintenance.quote.approve' : 'maintenance.quote.prepare',
    { agencyId, propertyId: item.propertyId, maintenanceItemId: item.id },
    correlationId,
  );

  if (route[5] === 'issue') {
    return idempotent(dependencies, req, agencyId, `contractor-quote-request:${request.id}:issue`, body, async () => {
      if (request.status !== 'draft') {
        throw new ApiError(409, 'CONTRACTOR_QUOTE_REQUEST_NOT_DRAFT', 'Only a draft request can be issued.');
      }
      if (expectedVersion(body) !== Number(requestRecord.version)) {
        throw new ApiError(409, 'VERSION_CONFLICT', 'Contractor quote request changed. Reload and retry.');
      }
      const links: Array<{ externalContactId: string; email: string; accessUrl: string; expiresAt: string }> = [];
      const webBase = process.env.WEB_APP_BASE_URL?.trim()?.replace(/\/$/u, '') || '';
      for (const contactId of request.contractorIds) {
        const contactRecord = await dependencies.repository.get('externalContacts', agencyId, contactId);
        if (!contactRecord || contactRecord.status !== 'active') continue;
        const contact = typed<ExternalContact>(contactRecord);
        const grantId = randomUUID();
        const token = `${randomUUID()}${randomUUID().replaceAll('-', '')}`;
        const expiresAt = request.dueAt || new Date(Date.now() + 7 * 86_400_000).toISOString();
        await dependencies.repository.create(
          'contractorQuoteAccessGrants',
          agencyId,
          grantId,
          {
            contractorQuoteRequestId: request.id,
            externalContactId: contact.id,
            recipientEmail: contact.email.toLowerCase(),
            tokenHash: hashToken(token),
            expiresAt,
            createdBy: principal.uid,
          },
          principal.uid,
        );
        const accessUrl = `${webBase}/external/contractor-quote/${token}`;
        const notificationId = randomUUID();
        const notification = {
          recipientEmail: contact.email,
          template: 'contractor_quote_request',
          status: 'queued',
          subject: `Quote requested: ${item.title}`,
          data: {
            accessUrl,
            maintenanceTitle: item.title,
            scope: request.scope,
            dueAt: request.dueAt,
          },
          queuedAt: new Date().toISOString(),
        };
        await dependencies.repository.create('notificationJobs', agencyId, notificationId, notification, principal.uid);
        await dependencies.tasks.dispatch('notification', agencyId, notificationId, notification);
        links.push({ externalContactId: contact.id, email: contact.email, accessUrl, expiresAt });
      }
      if (!links.length) throw new ApiError(422, 'ACTIVE_CONTRACTOR_REQUIRED', 'No active contractor recipients were available.');
      const stored = await dependencies.repository.update(
        'contractorQuoteRequests',
        agencyId,
        request.id,
        { status: 'issued', issuedAt: new Date().toISOString(), issuedRecipientCount: links.length },
        Number(requestRecord.version),
        principal.uid,
      );
      return { status: 200, body: { data: { request: stored, links }, meta: { correlationId } } };
    });
  }

  if (route[5] === 'select') {
    return idempotent(dependencies, req, agencyId, `contractor-quote-request:${request.id}:select`, body, async () => {
      if (!['responses_received', 'issued'].includes(request.status)) {
        throw new ApiError(409, 'CONTRACTOR_QUOTE_REQUEST_NOT_SELECTABLE', 'Request is not ready for quote selection.');
      }
      if (expectedVersion(body) !== Number(requestRecord.version)) {
        throw new ApiError(409, 'VERSION_CONFLICT', 'Contractor quote request changed. Reload and retry.');
      }
      const quoteId = typeof body.contractorQuoteId === 'string' ? body.contractorQuoteId.trim() : '';
      if (!quoteId) throw new ApiError(400, 'CONTRACTOR_QUOTE_REQUIRED', 'contractorQuoteId is required.');
      const quoteRecord = await dependencies.repository.get('contractorQuotes', agencyId, quoteId);
      if (!quoteRecord) throw new ApiError(404, 'CONTRACTOR_QUOTE_NOT_FOUND', 'Contractor quote was not found.');
      const quote = typed<ContractorQuote>(quoteRecord);
      if (quote.contractorQuoteRequestId !== request.id) {
        throw new ApiError(409, 'CONTRACTOR_QUOTE_CONTEXT_MISMATCH', 'Quote does not belong to this request.');
      }
      const estimate = estimateFromContractorQuote(agencyId, item, quote, principal.uid);
      const estimateStored = await dependencies.repository.create(
        'maintenanceEstimates',
        agencyId,
        estimate.id,
        estimate as unknown as Record<string, unknown>,
        principal.uid,
      );
      await dependencies.repository.update(
        'contractorQuoteRequests',
        agencyId,
        request.id,
        { status: 'selected', selectedContractorQuoteId: quote.id },
        Number(requestRecord.version),
        principal.uid,
      );
      await dependencies.repository.update(
        'contractorQuotes',
        agencyId,
        quote.id,
        { status: 'selected' },
        Number(quoteRecord.version),
        principal.uid,
      );
      await dependencies.repository.update(
        'maintenanceItems',
        agencyId,
        item.id,
        {
          estimateId: estimate.id,
          pricingStatus: 'review_required',
          externalContactId: quote.externalContactId,
        },
        Number(itemRecord.version),
        principal.uid,
      );
      return { status: 200, body: { data: { requestId: request.id, contractorQuote: quote, estimate: estimateStored }, meta: { correlationId } } };
    });
  }

  if (route[5] === 'cancel') {
    return idempotent(dependencies, req, agencyId, `contractor-quote-request:${request.id}:cancel`, body, async () => ({
      status: 200,
      body: {
        data: await dependencies.repository.update(
          'contractorQuoteRequests',
          agencyId,
          request.id,
          { status: 'cancelled', cancellationReason: typeof body.reason === 'string' ? body.reason.trim() : '' },
          expectedVersion(body),
          principal.uid,
        ),
        meta: { correlationId },
      },
    }));
  }

  return undefined;
}
