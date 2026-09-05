import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import {
  calculateWorkflowGateContext,
  evaluateReportQuality,
  type AuthorisationTarget,
  type ReportAcknowledgement,
  type ReportAggregate,
  type ReportDistribution,
  type ReportDistributionRecipientRole,
  type ReportRecipientResponse,
  type ReportReviewComment,
  type ReportSupersession,
  type SecurityCapability,
} from '@pcr/domain';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { requireExternalGrantStore } from './runtimeDependencyGuards.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies, IdempotencyResult, StoredRecord } from './types.js';

function agencyHeader(req: IncomingMessage): string {
  const agencyId = req.headers['x-agency-id']?.toString().trim();
  if (!agencyId) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.');
  return agencyId;
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Report operation payload exceeds 1 MB.');
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Object required');
    return parsed as Record<string, unknown>;
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function email(value: unknown): string {
  const result = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(result)) throw new ApiError(400, 'RECIPIENT_EMAIL_REQUIRED', 'A valid recipient email is required.');
  return result;
}

function idempotencyKey(req: IncomingMessage): string {
  const key = req.headers['idempotency-key']?.toString().trim();
  if (!key || key.length < 8 || key.length > 200) {
    throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key is required for report operation writes.');
  }
  return key;
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
    hash(JSON.stringify(body)),
    action,
  );
  return {
    status: execution.result.status,
    body: execution.result.body,
    headers: { 'idempotency-replayed': String(execution.replayed) },
  };
}

async function reportTarget(
  dependencies: ApiDependencies,
  agencyId: string,
  reportId: string,
): Promise<{ aggregate: ReportAggregate; job?: StoredRecord; target: AuthorisationTarget }> {
  const aggregate = await dependencies.reports.load(agencyId, reportId);
  if (!aggregate) throw new ApiError(404, 'REPORT_NOT_FOUND', 'Report not found.');
  const job = aggregate.report.inspectionJobId
    ? await dependencies.repository.get('inspectionJobs', agencyId, aggregate.report.inspectionJobId)
    : undefined;
  return {
    aggregate,
    job,
    target: {
      agencyId,
      reportId,
      ...(aggregate.report.propertyId ? { propertyId: aggregate.report.propertyId } : {}),
      ...(aggregate.report.tenancyId ? { tenancyId: aggregate.report.tenancyId } : {}),
      ...(aggregate.report.inspectionJobId ? { inspectionJobId: aggregate.report.inspectionJobId } : {}),
      ...(typeof job?.assignedInspectorId === 'string' ? { assignedInspectorId: job.assignedInspectorId } : {}),
      ...(typeof job?.assignedAnalystId === 'string' ? { assignedAnalystId: job.assignedAnalystId } : {}),
      ...(typeof job?.assignedReviewerId === 'string' ? { assignedReviewerId: job.assignedReviewerId } : {}),
      lifecycleStatus: aggregate.report.lifecycleStatus,
    },
  };
}

async function filteredRecords(
  dependencies: ApiDependencies,
  collection: string,
  agencyId: string,
  reportId: string,
): Promise<StoredRecord[]> {
  const page = await dependencies.repository.list(collection, agencyId, 100);
  return page.items.filter((record) => record.reportId === reportId || record.sourceReportId === reportId);
}

async function versionRecords(
  dependencies: ApiDependencies,
  agencyId: string,
  reportId: string,
): Promise<Record<string, unknown>[]> {
  const versions = await dependencies.reportVersions!.list(
    agencyId,
    reportId,
  );

  return versions.map((version) => ({
    id: version.id,
    agencyId: version.agencyId,
    reportId: version.reportId,
    version: version.version,
    sequence: version.version,
    status: version.status,
    lifecycleStatus: version.aggregate.report.lifecycleStatus,
    immutable: version.immutable,
    createdAt: version.createdAt,
    updatedAt: version.updatedAt,
    ...(version.contentHash
      ? { contentHash: version.contentHash }
      : {}),
    ...(version.finalisedAt
      ? { finalisedAt: version.finalisedAt }
      : {}),
    ...(version.supersedesVersionId
      ? { supersedesVersionId: version.supersedesVersionId }
      : {}),
  }));
}

async function audit(
  dependencies: ApiDependencies,
  agencyId: string,
  actorId: string,
  actorRole: string,
  capability: SecurityCapability,
  reportId: string,
  eventType: string,
  correlationId: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await dependencies.audit.append({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    actorId,
    actorRole,
    agencyId,
    capability,
    outcome: 'allowed',
    reason: eventType,
    target: { agencyId, reportId },
    correlationId,
    entityType: 'report',
    entityId: reportId,
    eventType,
    metadata,
  });
}

async function consoleResponse(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
  agencyId: string,
  reportId: string,
): Promise<ApiResponse> {
  const context = await reportTarget(dependencies, agencyId, reportId);
  const principal = await authenticateAndAuthorise(req, dependencies, 'report.read', context.target, correlationId);
  const [comments, distributions, acknowledgements, responses, maintenanceCandidates, maintenanceItems, versions] = await Promise.all([
    filteredRecords(dependencies, 'reportReviewComments', agencyId, reportId),
    filteredRecords(dependencies, 'reportDistributions', agencyId, reportId),
    filteredRecords(dependencies, 'reportAcknowledgements', agencyId, reportId),
    filteredRecords(dependencies, 'reportRecipientResponses', agencyId, reportId),
    filteredRecords(dependencies, 'maintenanceCandidates', agencyId, reportId),
    filteredRecords(dependencies, 'maintenanceItems', agencyId, reportId),
    versionRecords(dependencies, agencyId, reportId),
  ]);
  const workflow = calculateWorkflowGateContext(context.aggregate, context.job);
  const qc = evaluateReportQuality(context.aggregate);
  return {
    status: 200,
    body: {
      data: {
        aggregate: context.aggregate,
        job: context.job,
        workflow,
        qc,
        comments,
        distributions,
        acknowledgements,
        recipientResponses: responses,
        maintenanceCandidates,
        maintenanceItems,
        versions,
      },
      meta: { correlationId, actor: principal.uid },
    },
  };
}

function componentAt(aggregate: ReportAggregate, areaId: string, componentId: string) {
  const area = aggregate.areas.find((candidate) => candidate.id === areaId);
  const component = area?.components.find((candidate) => candidate.id === componentId);
  if (!area || !component) throw new ApiError(404, 'REPORT_COMPONENT_NOT_FOUND', 'Report component not found.');
  return { area, component };
}

async function componentReview(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
  agencyId: string,
  reportId: string,
  areaId: string,
  componentId: string,
): Promise<ApiResponse> {
  const body = await readJson(req);
  const action = typeof body.action === 'string' ? body.action : '';
  const expectedVersion = typeof body.expectedVersion === 'number' ? body.expectedVersion : undefined;
  if (!expectedVersion) throw new ApiError(400, 'EXPECTED_VERSION_REQUIRED', 'expectedVersion is required.');
  const capability: SecurityCapability = action === 'reviewer_approve' || action === 'request_changes' ? 'report.review' : 'report.edit';
  const context = await reportTarget(dependencies, agencyId, reportId);
  const principal = await authenticateAndAuthorise(req, dependencies, capability, context.target, correlationId);
  if (context.aggregate.report.version !== expectedVersion) throw new ApiError(409, 'VERSION_CONFLICT', 'Report changed before component review. Reload and retry.');
  const { component } = componentAt(context.aggregate, areaId, componentId);
  const now = new Date().toISOString();

  if (action === 'analyst_review') {
    component.reviewStatus = 'analyst_reviewed';
    component.authoritativeSource = 'analyst';
    component.lastReviewedBy = principal.uid;
    component.lastReviewedAt = now;
  } else if (action === 'reviewer_approve') {
    if (context.job?.assignedInspectorId === principal.uid || context.job?.assignedAnalystId === principal.uid) {
      throw new ApiError(403, 'SEPARATION_OF_DUTIES_VIOLATION', 'An assigned inspector or analyst cannot reviewer-approve their own component.');
    }
    component.reviewStatus = 'reviewer_approved';
    component.authoritativeSource = 'reviewer';
    component.lastReviewedBy = principal.uid;
    component.lastReviewedAt = now;
  } else if (action === 'request_changes') {
    component.reviewStatus = 'changes_requested';
    component.lastReviewedBy = principal.uid;
    component.lastReviewedAt = now;
  } else if (action === 'accept_ai') {
    if (!component.aiSuggestion || component.aiSuggestion.status !== 'suggested') throw new ApiError(409, 'AI_SUGGESTION_NOT_AVAILABLE', 'There is no pending AI suggestion for this component.');
    const proposed = component.aiSuggestion.proposed;
    for (const field of ['conditionCategory', 'cleanlinessCategory', 'workingStatus', 'testStatus', 'defects', 'maintenanceRequired', 'commentary', 'photoReferences', 'aiConfidence']) {
      if (field in proposed) (component as unknown as Record<string, unknown>)[field] = proposed[field];
    }
    component.aiSuggestion = { ...component.aiSuggestion, status: 'accepted', decidedBy: principal.uid, decidedAt: now };
    component.reviewStatus = 'analyst_reviewed';
    component.authoritativeSource = principal.role === 'reviewer' ? 'reviewer' : 'analyst';
    component.lastReviewedBy = principal.uid;
    component.lastReviewedAt = now;
  } else if (action === 'reject_ai') {
    if (!component.aiSuggestion || component.aiSuggestion.status !== 'suggested') throw new ApiError(409, 'AI_SUGGESTION_NOT_AVAILABLE', 'There is no pending AI suggestion for this component.');
    component.aiSuggestion = { ...component.aiSuggestion, status: 'rejected', decidedBy: principal.uid, decidedAt: now };
  } else {
    throw new ApiError(400, 'INVALID_COMPONENT_REVIEW_ACTION', 'Unsupported component review action.');
  }

  return idempotent(dependencies, req, agencyId, `report:${reportId}:component:${areaId}:${componentId}:${action}`, body, async () => {
    const stored = await dependencies.reports.saveDraft(context.aggregate, expectedVersion, principal.uid);
    await audit(dependencies, agencyId, principal.uid, principal.role, capability, reportId, `report.component.${action}`, correlationId, { areaId, componentId });
    return { status: 200, body: { data: stored, meta: { correlationId } } };
  });
}

async function createReviewComment(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
  agencyId: string,
  reportId: string,
): Promise<ApiResponse> {
  const body = await readJson(req);
  const context = await reportTarget(dependencies, agencyId, reportId);
  const principal = await authenticateAndAuthorise(req, dependencies, 'report.review', context.target, correlationId);
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!text) throw new ApiError(400, 'REVIEW_COMMENT_REQUIRED', 'Review comment body is required.');
  const scope = ['report', 'area', 'component', 'evidence', 'comparison'].includes(String(body.scope)) ? String(body.scope) : 'report';
  return idempotent(dependencies, req, agencyId, `report:${reportId}:review-comment`, body, async () => {
    const id = randomUUID();
    const now = new Date().toISOString();
    const record: Omit<ReportReviewComment, 'version'> = {
      id,
      agencyId,
      reportId,
      ...(context.aggregate.report.currentVersionId ? { reportVersionId: context.aggregate.report.currentVersionId } : {}),
      scope: scope as ReportReviewComment['scope'],
      ...(typeof body.areaId === 'string' ? { areaId: body.areaId } : {}),
      ...(typeof body.componentId === 'string' ? { componentId: body.componentId } : {}),
      ...(typeof body.evidencePhotoId === 'string' ? { evidencePhotoId: body.evidencePhotoId } : {}),
      ...(typeof body.category === 'string' ? { category: body.category as ReportReviewComment['category'] } : {}),
      body: text,
      status: 'open',
      createdBy: principal.uid,
      createdByRole: principal.role,
      createdAt: now,
    };
    const stored = await dependencies.repository.create('reportReviewComments', agencyId, id, record as unknown as Record<string, unknown>, principal.uid);
    await audit(dependencies, agencyId, principal.uid, principal.role, 'report.review', reportId, 'report.review_comment.created', correlationId, { commentId: id, scope });
    return { status: 201, body: { data: stored, meta: { correlationId } } };
  });
}

async function updateReviewComment(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
  agencyId: string,
  reportId: string,
  commentId: string,
): Promise<ApiResponse> {
  const body = await readJson(req);
  const context = await reportTarget(dependencies, agencyId, reportId);
  const principal = await authenticateAndAuthorise(req, dependencies, 'report.review', context.target, correlationId);
  const existing = await dependencies.repository.get('reportReviewComments', agencyId, commentId);
  if (!existing || existing.reportId !== reportId) throw new ApiError(404, 'REVIEW_COMMENT_NOT_FOUND', 'Review comment not found.');
  const action = typeof body.action === 'string' ? body.action : '';
  if (!['resolve', 'verify', 'reopen'].includes(action)) throw new ApiError(400, 'INVALID_REVIEW_COMMENT_ACTION', 'Review comment action must be resolve, verify or reopen.');
  const now = new Date().toISOString();
  const patch = action === 'resolve'
    ? { status: 'resolved', resolvedBy: principal.uid, resolvedAt: now, resolutionNote: typeof body.resolutionNote === 'string' ? body.resolutionNote.trim() : '' }
    : action === 'verify'
      ? { status: 'verified', verifiedBy: principal.uid, verifiedAt: now }
      : { status: 'open', resolvedBy: null, resolvedAt: null, verifiedBy: null, verifiedAt: null };
  return idempotent(dependencies, req, agencyId, `report:${reportId}:review-comment:${commentId}:${action}`, body, async () => {
    const stored = await dependencies.repository.update('reportReviewComments', agencyId, commentId, patch, Number(existing.version), principal.uid);
    await audit(dependencies, agencyId, principal.uid, principal.role, 'report.review', reportId, `report.review_comment.${action}`, correlationId, { commentId });
    return { status: 200, body: { data: stored, meta: { correlationId } } };
  });
}

async function createDistribution(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
  agencyId: string,
  reportId: string,
): Promise<ApiResponse> {
  const body = await readJson(req);
  const context = await reportTarget(dependencies, agencyId, reportId);
  const principal = await authenticateAndAuthorise(req, dependencies, 'report.issue', context.target, correlationId);
  const reportVersionId = context.aggregate.report.currentVersionId;
  if (!reportVersionId) throw new ApiError(422, 'IMMUTABLE_REPORT_VERSION_REQUIRED', 'Approve the report and create an immutable version before distribution.');
  if (!['approved_for_issue', 'issued_to_tenant', 'tenant_response_in_progress', 'tenant_submitted', 'agent_response_required', 'finalisation_ready', 'finalised', 'archived'].includes(context.aggregate.report.lifecycleStatus)) {
    throw new ApiError(422, 'REPORT_NOT_APPROVED_FOR_DISTRIBUTION', 'The report must be approved for issue before distribution.');
  }
  const recipientEmail = email(body.recipientEmail);
  const recipientName = typeof body.recipientName === 'string' && body.recipientName.trim() ? body.recipientName.trim() : recipientEmail;
  const roles: ReportDistributionRecipientRole[] = ['tenant', 'landlord', 'property_manager', 'client', 'other'];
  const recipientRole = roles.includes(body.recipientRole as ReportDistributionRecipientRole)
    ? body.recipientRole as ReportDistributionRecipientRole
    : 'other';
  const expiryDays = typeof body.expiryDays === 'number' && body.expiryDays > 0 && body.expiryDays <= 90 ? body.expiryDays : 14;

  return idempotent(dependencies, req, agencyId, `report:${reportId}:distribution`, body, async () => {
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + expiryDays * 86_400_000).toISOString();
    const distributionId = randomUUID();
    const grantId = randomUUID();
    const rawToken = randomBytes(32).toString('base64url');
    const distribution: Omit<ReportDistribution, 'version'> = {
      id: distributionId,
      agencyId,
      reportId,
      reportVersionId,
      recipientName,
      recipientEmail,
      recipientRole,
      status: 'queued',
      ...(typeof body.subject === 'string' && body.subject.trim() ? { subject: body.subject.trim() } : {}),
      ...(typeof body.message === 'string' && body.message.trim() ? { message: body.message.trim() } : {}),
      accessGrantId: grantId,
      expiresAt,
      createdBy: principal.uid,
      createdAt: now,
      updatedAt: now,
    };
    await dependencies.repository.create('reportDistributions', agencyId, distributionId, distribution as unknown as Record<string, unknown>, principal.uid);
    await requireExternalGrantStore(
      dependencies,
    ).issue({
      id: grantId,
      agencyId,
      resourceType: 'report_distribution',
      resourceId: distributionId,
      recipientEmail,
      tokenHash: hash(rawToken),
      expiresAt,
      actorId: principal.uid,
    });
    const notificationId = randomUUID();
    const notification = {
      type: 'report_distribution',
      reportId,
      reportVersionId,
      distributionId,
      recipientEmail,
      recipientName,
      recipientRole,
      subject: typeof body.subject === 'string' && body.subject.trim() ? body.subject.trim() : `${context.aggregate.report.reportType} - ${context.aggregate.report.propertyAddress}`,
      securePath: `/report-access/${rawToken}`,
      status: 'queued',
      queuedAt: now,
    };
    await dependencies.repository.create('notificationJobs', agencyId, notificationId, notification, principal.uid);
    await dependencies.tasks.dispatch('notification', agencyId, notificationId, notification);
    let stored = await dependencies.repository.get('reportDistributions', agencyId, distributionId);
    if (stored) {
      stored = await dependencies.repository.update('reportDistributions', agencyId, distributionId, { status: 'sent', sentAt: now, updatedAt: now }, Number(stored.version), principal.uid);
    }

    if (recipientRole === 'tenant' && context.aggregate.report.lifecycleStatus === 'approved_for_issue') {
      await dependencies.reports.transition(agencyId, {
        agencyId,
        reportId,
        status: 'issued_to_tenant',
        expectedVersion: context.aggregate.report.version ?? 1,
        actorId: principal.uid,
        actorRole: principal.role,
        correlationId,
      });
    }
    await audit(dependencies, agencyId, principal.uid, principal.role, 'report.issue', reportId, 'report.distribution.sent', correlationId, { distributionId, recipientRole, reportVersionId });
    return { status: 201, body: { data: { distribution: stored, accessPath: `/report-access/${rawToken}` }, meta: { correlationId } } };
  });
}

async function revokeDistribution(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
  agencyId: string,
  reportId: string,
  distributionId: string,
): Promise<ApiResponse> {
  const body = await readJson(req);
  const context = await reportTarget(dependencies, agencyId, reportId);
  const principal = await authenticateAndAuthorise(req, dependencies, 'report.issue', context.target, correlationId);
  const distribution = await dependencies.repository.get('reportDistributions', agencyId, distributionId);
  if (!distribution || distribution.reportId !== reportId) throw new ApiError(404, 'REPORT_DISTRIBUTION_NOT_FOUND', 'Distribution not found.');
  return idempotent(dependencies, req, agencyId, `report:${reportId}:distribution:${distributionId}:revoke`, body, async () => {
    const now = new Date().toISOString();
    const updated = await dependencies.repository.update('reportDistributions', agencyId, distributionId, { status: 'revoked', revokedAt: now, updatedAt: now }, Number(distribution.version), principal.uid);
    if (typeof distribution.accessGrantId === 'string') {
      const grantStore =
        requireExternalGrantStore(dependencies);

      const grant = await grantStore.get(
        agencyId,
        'report_distribution',
        distribution.accessGrantId,
      );

      if (grant) {
        await grantStore.revoke(
          agencyId,
          'report_distribution',
          grant.id,
          grant.version,
          principal.uid,
        );
      }
    }
    await audit(dependencies, agencyId, principal.uid, principal.role, 'report.issue', reportId, 'report.distribution.revoked', correlationId, { distributionId });
    return { status: 200, body: { data: updated, meta: { correlationId } } };
  });
}

async function resolveRecipientResponse(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
  agencyId: string,
  reportId: string,
  responseId: string,
): Promise<ApiResponse> {
  const body = await readJson(req);
  const context = await reportTarget(dependencies, agencyId, reportId);
  const principal = await authenticateAndAuthorise(req, dependencies, 'report.issue', context.target, correlationId);
  const response = await dependencies.repository.get('reportRecipientResponses', agencyId, responseId);
  if (!response || response.reportId !== reportId) throw new ApiError(404, 'RECIPIENT_RESPONSE_NOT_FOUND', 'Recipient response not found.');
  const resolutionNote = typeof body.resolutionNote === 'string' ? body.resolutionNote.trim() : '';
  if (!resolutionNote) throw new ApiError(400, 'RESOLUTION_NOTE_REQUIRED', 'A resolution note is required.');
  return idempotent(dependencies, req, agencyId, `report:${reportId}:response:${responseId}:resolve`, body, async () => {
    const now = new Date().toISOString();
    const updated = await dependencies.repository.update('reportRecipientResponses', agencyId, responseId, { status: 'resolved', resolvedAt: now, resolvedBy: principal.uid, resolutionNote }, Number(response.version), principal.uid);
    if (context.job) {
      await dependencies.repository.update('inspectionJobs', agencyId, context.job.id as string, { tenantResponseStatus: 'resolved' }, Number(context.job.version), principal.uid);
    }
    if (body.advanceToFinalisation === true && ['tenant_submitted', 'agent_response_required', 'tenant_response_in_progress', 'issued_to_tenant'].includes(context.aggregate.report.lifecycleStatus)) {
      const latest = await dependencies.reports.load(agencyId, reportId);
      if (latest) {
        await dependencies.reports.transition(agencyId, {
          agencyId,
          reportId,
          status: 'finalisation_ready',
          expectedVersion: latest.report.version ?? 1,
          actorId: principal.uid,
          actorRole: principal.role,
          correlationId,
        });
      }
    }
    await audit(dependencies, agencyId, principal.uid, principal.role, 'report.issue', reportId, 'report.recipient_response.resolved', correlationId, { responseId });
    return { status: 200, body: { data: updated, meta: { correlationId } } };
  });
}

async function supersedeReport(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
  agencyId: string,
  reportId: string,
): Promise<ApiResponse> {
  const body = await readJson(req);
  const context = await reportTarget(dependencies, agencyId, reportId);
  const principal = await authenticateAndAuthorise(req, dependencies, 'report.review', context.target, correlationId);
  const sourceVersionId = context.aggregate.report.currentVersionId;
  if (!sourceVersionId) throw new ApiError(422, 'IMMUTABLE_REPORT_VERSION_REQUIRED', 'Only an issued immutable report version can be superseded.');
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason) throw new ApiError(400, 'CORRECTION_REASON_REQUIRED', 'A correction reason is required.');
  return idempotent(dependencies, req, agencyId, `report:${reportId}:supersede`, body, async () => {
    const id = `${reportId}-superseding-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const copy = structuredClone(context.aggregate);
    copy.report = {
      ...copy.report,
      id,
      lifecycleStatus: 'draft',
      currentVersionId: undefined,
      finalPdfReportVersionId: undefined,
      finalPdfObjectPath: undefined,
      finalPdfSha256: undefined,
      finalPdfGeneration: undefined,
      renderManifestObjectPath: undefined,
      renderManifestSha256: undefined,
      pdfGeneratedAt: undefined,
      archiveReportVersionId: undefined,
      archiveManifestObjectPath: undefined,
      archiveManifestSha256: undefined,
      archiveCreatedAt: undefined,
      finalisedAt: undefined,
      archivedAt: undefined,
      supersedesReportId: reportId,
      correctionReason: reason,
      createdAt: now,
      updatedAt: now,
      version: undefined,
    };
    for (const area of copy.areas) {
      for (const component of area.components) {
        component.reviewStatus = 'draft';
        if (component.aiSuggestion?.status === 'suggested') component.aiSuggestion = { ...component.aiSuggestion, status: 'superseded' };
      }
    }
    const created = await dependencies.reports.saveDraft(copy, undefined, principal.uid);
    await dependencies.repository.update('reports', agencyId, reportId, { supersededByReportId: id }, context.aggregate.report.version ?? 1, principal.uid);
    const supersessionId = randomUUID();
    const supersession: Omit<ReportSupersession, 'version'> = { id: supersessionId, agencyId, sourceReportId: reportId, sourceReportVersionId: sourceVersionId, supersedingReportId: id, reason, createdBy: principal.uid, createdAt: now };
    await dependencies.repository.create('reportSupersessions', agencyId, supersessionId, supersession as unknown as Record<string, unknown>, principal.uid);
    await audit(dependencies, agencyId, principal.uid, principal.role, 'report.review', reportId, 'report.superseded', correlationId, { sourceVersionId, supersedingReportId: id, reason });
    return { status: 201, body: { data: { report: created, supersession }, meta: { correlationId } } };
  });
}

async function publicReportPortal(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
  rawToken: string,
): Promise<ApiResponse> {
  const grant =
    await requireExternalGrantStore(
      dependencies,
    ).resolve(
      rawToken,
      ['report_distribution'],
    );
  const distribution = await dependencies.repository.get('reportDistributions', grant.agencyId, grant.resourceId);
  if (!distribution) throw new ApiError(404, 'REPORT_DISTRIBUTION_NOT_FOUND', 'Report distribution no longer exists.');
  const reportId = String(distribution.reportId);
  const reportVersionId = String(distribution.reportVersionId);
  const aggregate = await dependencies.reports.load(grant.agencyId, reportId);
  if (!aggregate) throw new ApiError(404, 'REPORT_NOT_FOUND', 'Report no longer exists.');
  const externalActor = `external:${grant.id}`;

  const recipientEmail =
    grant.recipientEmail?.trim().toLowerCase();

  if (!recipientEmail) {
    throw new ApiError(
      409,
      'GRANT_RECIPIENT_REQUIRED',
      'Report access grant is missing its recipient email.',
    );
  }

  if (req.method === 'GET') {
    const now = new Date().toISOString();
    if (distribution.status === 'sent' || distribution.status === 'delivered') {
      await dependencies.repository.update('reportDistributions', grant.agencyId, distribution.id as string, { status: 'viewed', viewedAt: now, updatedAt: now }, Number(distribution.version), externalActor);
    }
    const priorResponses = (await filteredRecords(dependencies, 'reportRecipientResponses', grant.agencyId, reportId)).filter((record) => record.distributionId === distribution.id);
    const acknowledgements = (await filteredRecords(dependencies, 'reportAcknowledgements', grant.agencyId, reportId)).filter((record) => record.distributionId === distribution.id);
    return {
      status: 200,
      body: {
        data: {
          distribution: { ...distribution, recipientEmail },
          report: {
            id: aggregate.report.id,
            reportVersionId,
            reportType: aggregate.report.reportType,
            propertyAddress: aggregate.report.propertyAddress,
            inspectionDate: aggregate.report.inspectionDate,
            tenantName: aggregate.report.tenantName,
            clientName: aggregate.report.clientName,
            issuedAt: aggregate.report.issuedAt,
            lifecycleStatus: aggregate.report.lifecycleStatus,
          },
          areas: aggregate.areas,
          acknowledgements,
          responses: priorResponses,
        },
        meta: { correlationId },
      },
    };
  }

  if (req.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Report access supports GET and POST.');
  const body = await readJson(req);
  const action = typeof body.action === 'string' ? body.action : '';
  return idempotent(dependencies, req, grant.agencyId, `public-report:${distribution.id}:${action}`, body, async () => {
    const now = new Date().toISOString();
    if (action === 'acknowledge') {
      const types: ReportAcknowledgement['acknowledgementType'][] = ['received', 'reviewed', 'agreed', 'disagreed'];
      const acknowledgementType = types.includes(body.acknowledgementType as ReportAcknowledgement['acknowledgementType'])
        ? body.acknowledgementType as ReportAcknowledgement['acknowledgementType']
        : 'reviewed';
      const id = randomUUID();
      const acknowledgement: Omit<ReportAcknowledgement, 'version'> = {
        id,
        agencyId: grant.agencyId,
        reportId,
        reportVersionId,
        distributionId: distribution.id as string,
        recipientEmail,
        recipientRole: distribution.recipientRole as ReportDistributionRecipientRole,
        acknowledgementType,
        ...(typeof body.note === 'string' && body.note.trim() ? { note: body.note.trim() } : {}),
        createdAt: now,
        source: 'secure_link',
      };
      const stored = await dependencies.repository.create('reportAcknowledgements', grant.agencyId, id, acknowledgement as unknown as Record<string, unknown>, externalActor);
      await audit(dependencies, grant.agencyId, externalActor, 'external', 'report.read', reportId, 'report.external.acknowledged', correlationId, { distributionId: distribution.id, acknowledgementType, reportVersionId });
      return { status: 201, body: { data: stored, meta: { correlationId } } };
    }

    if (action === 'submit_response') {
      const generalNote = typeof body.generalNote === 'string' ? body.generalNote.trim() : '';
      const comments = Array.isArray(body.comments)
        ? body.comments.flatMap((value) => {
            if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
            const row = value as Record<string, unknown>;
            const note = typeof row.note === 'string' ? row.note.trim() : '';
            if (!note) return [];
            return [{
              ...(typeof row.areaId === 'string' ? { areaId: row.areaId } : {}),
              ...(typeof row.componentId === 'string' ? { componentId: row.componentId } : {}),
              note,
              evidencePhotoIds: Array.isArray(row.evidencePhotoIds) ? row.evidencePhotoIds.filter((id): id is string => typeof id === 'string') : [],
            }];
          })
        : [];
      const evidencePhotoIds = Array.isArray(body.evidencePhotoIds) ? [...new Set(body.evidencePhotoIds.filter((id): id is string => typeof id === 'string'))] : [];
      if (!generalNote && !comments.length && !evidencePhotoIds.length) throw new ApiError(400, 'RECIPIENT_RESPONSE_REQUIRED', 'A note, component comment or supporting evidence is required.');
      const id = randomUUID();
      const response: Omit<ReportRecipientResponse, 'version'> = {
        id,
        agencyId: grant.agencyId,
        reportId,
        reportVersionId,
        distributionId: distribution.id as string,
        recipientEmail,
        recipientRole: distribution.recipientRole as ReportDistributionRecipientRole,
        ...(generalNote ? { generalNote } : {}),
        comments,
        evidencePhotoIds,
        status: 'submitted',
        submittedAt: now,
      };
      const stored = await dependencies.repository.create('reportRecipientResponses', grant.agencyId, id, response as unknown as Record<string, unknown>, externalActor);
      await dependencies.repository.update('reportDistributions', grant.agencyId, distribution.id as string, { status: 'responded', respondedAt: now, updatedAt: now }, Number(distribution.version), externalActor);

      if (distribution.recipientRole === 'tenant' && aggregate.report.currentVersionId === reportVersionId) {
        let current = aggregate;
        if (current.report.lifecycleStatus === 'issued_to_tenant') {
          await dependencies.reports.transition(grant.agencyId, {
            agencyId: grant.agencyId,
            reportId,
            status: 'tenant_response_in_progress',
            expectedVersion: current.report.version ?? 1,
            actorId: externalActor,
            actorRole: 'tenant',
            correlationId,
          });
          current = (await dependencies.reports.load(grant.agencyId, reportId)) ?? current;
        }
        if (current.report.lifecycleStatus === 'tenant_response_in_progress') {
          await dependencies.reports.transition(grant.agencyId, {
            agencyId: grant.agencyId,
            reportId,
            status: 'tenant_submitted',
            expectedVersion: current.report.version ?? 1,
            actorId: externalActor,
            actorRole: 'tenant',
            correlationId,
          });
        }
      }
      await audit(dependencies, grant.agencyId, externalActor, 'external', 'tenant_response.submit', reportId, 'report.external.response_submitted', correlationId, { distributionId: distribution.id, responseId: id, reportVersionId });
      return { status: 201, body: { data: stored, meta: { correlationId } } };
    }

    throw new ApiError(400, 'INVALID_REPORT_ACCESS_ACTION', 'Report access action must be acknowledge or submit_response.');
  });
}

export async function routeReportOperationsRequest(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
): Promise<ApiResponse | undefined> {
  const parts = new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean);
  if (parts[0] !== 'api' || parts[1] !== 'v1') return undefined;

  if (parts[2] === 'public' && parts[3] === 'report-access' && parts[4]) {
    return publicReportPortal(req, dependencies, correlationId, decodeURIComponent(parts[4]));
  }
  if (parts[2] !== 'report-operations') return undefined;

  const agencyId = agencyHeader(req);
  const reportId = parts[3];
  if (!reportId) throw new ApiError(404, 'NOT_FOUND', 'Report operation route requires a report id.');

  if (req.method === 'GET' && parts.length === 4) return consoleResponse(req, dependencies, correlationId, agencyId, reportId);
  if (req.method === 'POST' && parts[4] === 'components' && parts[5] && parts[6] && parts[7] === 'review') {
    return componentReview(req, dependencies, correlationId, agencyId, reportId, decodeURIComponent(parts[5]), decodeURIComponent(parts[6]));
  }
  if (req.method === 'POST' && parts[4] === 'review-comments' && !parts[5]) {
    return createReviewComment(req, dependencies, correlationId, agencyId, reportId);
  }
  if (req.method === 'POST' && parts[4] === 'review-comments' && parts[5]) {
    return updateReviewComment(req, dependencies, correlationId, agencyId, reportId, decodeURIComponent(parts[5]));
  }
  if (req.method === 'POST' && parts[4] === 'distributions' && !parts[5]) {
    return createDistribution(req, dependencies, correlationId, agencyId, reportId);
  }
  if (req.method === 'POST' && parts[4] === 'distributions' && parts[5] && parts[6] === 'revoke') {
    return revokeDistribution(req, dependencies, correlationId, agencyId, reportId, decodeURIComponent(parts[5]));
  }
  if (req.method === 'POST' && parts[4] === 'recipient-responses' && parts[5] && parts[6] === 'resolve') {
    return resolveRecipientResponse(req, dependencies, correlationId, agencyId, reportId, decodeURIComponent(parts[5]));
  }
  if (req.method === 'POST' && parts[4] === 'supersede') {
    return supersedeReport(req, dependencies, correlationId, agencyId, reportId);
  }

  throw new ApiError(404, 'NOT_FOUND', 'Report operation route not found.');
}
