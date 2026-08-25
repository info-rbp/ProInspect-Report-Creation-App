import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import {
  MAINTENANCE_CATEGORIES,
  MAINTENANCE_PRIORITIES,
  type ClientApproval,
  type ClientApprovalStatus,
  type ExternalAccessGrant,
  type ExternalContact,
  type MaintenanceCandidate,
  type MaintenanceCandidateSource,
  type MaintenanceCategory,
  type MaintenanceItem,
  type MaintenancePriority,
  type TenantInstruction,
  type TenantInstructionStatus,
  type WorkRequest,
  type WorkRequestStatus,
} from '@pcr/domain';
import { firestoreDb } from '../firestoreDatabase.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies, StoredRecord } from './types.js';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';

type Versioned<T> = T & { version: number };

function adminApp() {
  return getApps()[0] ?? initializeApp({ credential: applicationDefault() });
}

async function readJsonPayload(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 1_000_000) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Payload exceeds 1 MB.');
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

function getAgencyIdFromHeader(req: IncomingMessage): string {
  const agencyId = req.headers['x-agency-id']?.toString().trim();
  if (!agencyId) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.');
  return agencyId;
}

function hashGrantToken(rawToken: string): string {
  return createHash('sha256').update(rawToken.trim()).digest('hex');
}

function emailAddress(value: unknown): string {
  if (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value.trim())) {
    throw new ApiError(400, 'EMAIL_REQUIRED', 'A valid recipientEmail is required.');
  }
  return value.trim().toLowerCase();
}

function categoryFor(componentName: string): MaintenanceCategory {
  const name = componentName.toLowerCase();
  if (name.includes('tap') || name.includes('sink') || name.includes('basin') || name.includes('plumb')) return 'Plumbing';
  if (name.includes('light') || name.includes('power') || name.includes('switch') || name.includes('electrical')) return 'Electrical';
  if (name.includes('oven') || name.includes('cooktop') || name.includes('dishwasher') || name.includes('appliance')) return 'Appliance';
  if (name.includes('clean')) return 'Cleaning';
  if (name.includes('door') || name.includes('lock')) return 'Doors / Locks';
  return 'General Maintenance';
}

function priorityFor(component: { conditionCategory?: string; workingStatus?: string }): MaintenancePriority {
  if (component.conditionCategory === 'replacement_recommended' || component.workingStatus === 'not_working') return 'high';
  return 'routine';
}

function candidateSource(reviewStatus?: string): MaintenanceCandidateSource {
  if (reviewStatus === 'reviewer_approved') return 'reviewer';
  if (reviewStatus === 'analyst_reviewed') return 'analyst';
  if (reviewStatus === 'ai_generated') return 'ai';
  return 'inspector';
}

function portalResourceType(portalType: string): ExternalAccessGrant['resourceType'] | undefined {
  if (portalType === 'work-requests') return 'work_request';
  if (portalType === 'tenant-instructions') return 'tenant_instruction';
  if (portalType === 'client-approvals') return 'client_approval';
  return undefined;
}

async function resolveExternalGrant(
  rawToken: string,
  portalType: string,
): Promise<Versioned<ExternalAccessGrant>> {
  const expectedResourceType = portalResourceType(portalType);
  if (!expectedResourceType) throw new ApiError(404, 'NOT_FOUND', 'External portal not found.');

  const tokenHash = hashGrantToken(rawToken);
  const snapshot = await firestoreDb(adminApp())
    .collectionGroup('externalAccessGrants')
    .where('tokenHash', '==', tokenHash)
    .limit(2)
    .get();

  if (snapshot.empty) throw new ApiError(401, 'INVALID_GRANT_TOKEN', 'Access link is invalid or expired.');
  if (snapshot.size !== 1) throw new ApiError(401, 'AMBIGUOUS_GRANT_TOKEN', 'Access link cannot be resolved safely.');

  const document = snapshot.docs[0];
  const grant = document.data() as Versioned<ExternalAccessGrant>;
  if (grant.resourceType !== expectedResourceType) throw new ApiError(403, 'GRANT_SCOPE_MISMATCH', 'Access link is not valid for this resource type.');
  if (grant.revokedAt) throw new ApiError(401, 'GRANT_TOKEN_REVOKED', 'Access link has been revoked.');
  if (new Date(grant.expiresAt).getTime() <= Date.now()) throw new ApiError(401, 'GRANT_TOKEN_EXPIRED', 'Access link has expired.');

  await document.ref.update({ lastAccessedAt: new Date().toISOString() });
  return grant;
}

async function auditExternal(
  dependencies: ApiDependencies,
  grant: ExternalAccessGrant,
  event: string,
  correlationId: string,
): Promise<void> {
  await dependencies.audit.append({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    actorId: `external:${grant.id}`,
    actorRole: 'external',
    agencyId: grant.agencyId,
    capability: 'maintenance.manage',
    outcome: 'allowed',
    reason: event,
    target: { agencyId: grant.agencyId },
    correlationId,
  });
}

async function loadVersioned<T>(
  dependencies: ApiDependencies,
  collection: string,
  agencyId: string,
  id: string,
): Promise<Versioned<T>> {
  const record = await dependencies.repository.get(collection, agencyId, id);
  if (!record) throw new ApiError(404, 'NOT_FOUND', 'Record not found.');
  return record as unknown as Versioned<T>;
}

async function routeExternalPortal(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
  portalType: string,
  rawToken: string,
): Promise<ApiResponse> {
  const grant = await resolveExternalGrant(rawToken, portalType);
  const externalActor = `external:${grant.id}`;

  if (portalType === 'work-requests') {
    const request = await loadVersioned<WorkRequest>(dependencies, 'workRequests', grant.agencyId, grant.resourceId);
    const maintenance = await loadVersioned<MaintenanceItem>(dependencies, 'maintenanceItems', grant.agencyId, request.maintenanceItemId);
    const property = maintenance.propertyId
      ? await dependencies.repository.get('properties', grant.agencyId, maintenance.propertyId)
      : undefined;

    if (req.method === 'GET') {
      await auditExternal(dependencies, grant, 'external.work_request.viewed', correlationId);
      return {
        status: 200,
        body: {
          data: {
            workRequest: request,
            maintenanceItem: {
              id: maintenance.id,
              title: maintenance.title,
              description: maintenance.description,
              category: maintenance.category,
              priority: maintenance.priority,
              workInstruction: maintenance.workInstruction,
              dueDate: maintenance.dueDate,
              sourceEvidenceIds: maintenance.sourceEvidenceIds,
            },
            propertyAddress: typeof property?.address === 'string' ? property.address : 'Property',
          },
          meta: { correlationId },
        },
      };
    }

    if (req.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
    const body = await readJsonPayload(req);
    const action = typeof body.action === 'string' ? body.action : '';
    const transitions: Record<string, { allowed: WorkRequestStatus[]; next: WorkRequestStatus }> = {
      acknowledge: { allowed: ['issued'], next: 'acknowledged' },
      in_progress: { allowed: ['issued', 'acknowledged'], next: 'in_progress' },
      complete: { allowed: ['acknowledged', 'in_progress'], next: 'completed' },
      unable_to_complete: { allowed: ['issued', 'acknowledged', 'in_progress'], next: 'unable_to_complete' },
    };
    const transition = transitions[action];
    if (!transition || !transition.allowed.includes(request.status)) {
      throw new ApiError(409, 'INVALID_WORK_REQUEST_TRANSITION', `Action ${action || '(missing)'} is not valid from ${request.status}.`);
    }

    const responseNotes = typeof body.responseNotes === 'string' ? body.responseNotes.trim() : '';
    const completionEvidenceIds = Array.isArray(body.completionEvidenceIds)
      ? [...new Set(body.completionEvidenceIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))]
      : request.completionEvidenceIds || [];
    if ((action === 'complete' || action === 'unable_to_complete') && !responseNotes) {
      throw new ApiError(400, 'RESPONSE_NOTE_REQUIRED', 'A completion or inability note is required.');
    }

    const now = new Date().toISOString();
    const updated = await dependencies.repository.update(
      'workRequests',
      grant.agencyId,
      request.id,
      {
        status: transition.next,
        responseNotes,
        completionEvidenceIds,
        ...(action === 'acknowledge' ? { acknowledgedAt: now } : {}),
        ...(action === 'complete' ? { completedAt: now } : {}),
      },
      request.version,
      externalActor,
    );

    if (action === 'complete') {
      await dependencies.repository.update(
        'maintenanceItems',
        grant.agencyId,
        maintenance.id,
        {
          status: 'verification_required',
          completionEvidenceIds,
          completionNote: responseNotes,
          completionDate: now,
          verificationStatus: 'verification_required',
        },
        maintenance.version,
        externalActor,
      );
    }
    await auditExternal(dependencies, grant, `external.work_request.${action}`, correlationId);
    return { status: 200, body: { data: updated, meta: { correlationId } } };
  }

  if (portalType === 'tenant-instructions') {
    const instruction = await loadVersioned<TenantInstruction>(dependencies, 'tenantInstructions', grant.agencyId, grant.resourceId);

    if (req.method === 'GET') {
      let returned: StoredRecord | Versioned<TenantInstruction> = instruction;
      if (instruction.status === 'issued') {
        returned = await dependencies.repository.update(
          'tenantInstructions',
          grant.agencyId,
          instruction.id,
          { status: 'viewed', viewedAt: new Date().toISOString() },
          instruction.version,
          externalActor,
        );
      }
      await auditExternal(dependencies, grant, 'external.tenant_instruction.viewed', correlationId);
      return { status: 200, body: { data: returned, meta: { correlationId } } };
    }

    if (req.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
    const allowedStatuses: TenantInstructionStatus[] = ['issued', 'viewed', 'awaiting_action'];
    if (!allowedStatuses.includes(instruction.status)) {
      throw new ApiError(409, 'TENANT_INSTRUCTION_NOT_RESPONDABLE', `Instruction cannot be answered from ${instruction.status}.`);
    }
    const body = await readJsonPayload(req);
    const tenantResponseNote = typeof body.tenantResponseNote === 'string' ? body.tenantResponseNote.trim() : '';
    const tenantEvidenceIds = Array.isArray(body.tenantEvidenceIds)
      ? [...new Set(body.tenantEvidenceIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))]
      : [];
    if (!tenantResponseNote && tenantEvidenceIds.length === 0) {
      throw new ApiError(400, 'TENANT_RESPONSE_REQUIRED', 'A tenant response note or supporting evidence is required.');
    }
    const updated = await dependencies.repository.update(
      'tenantInstructions',
      grant.agencyId,
      instruction.id,
      {
        status: 'tenant_responded',
        tenantResponseNote,
        tenantEvidenceIds,
        tenantSubmittedAt: new Date().toISOString(),
      },
      instruction.version,
      externalActor,
    );
    await auditExternal(dependencies, grant, 'external.tenant_instruction.responded', correlationId);
    return { status: 200, body: { data: updated, meta: { correlationId } } };
  }

  if (portalType === 'client-approvals') {
    const approval = await loadVersioned<ClientApproval>(dependencies, 'clientApprovals', grant.agencyId, grant.resourceId);
    if (req.method === 'GET') {
      await auditExternal(dependencies, grant, 'external.client_approval.viewed', correlationId);
      return { status: 200, body: { data: approval, meta: { correlationId } } };
    }
    if (req.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
    if (!['pending', 'information_requested'].includes(approval.status)) {
      throw new ApiError(409, 'CLIENT_APPROVAL_ALREADY_RESOLVED', 'This approval request has already been resolved.');
    }
    const body = await readJsonPayload(req);
    const validDecisions: ClientApprovalStatus[] = ['approved', 'declined', 'information_requested'];
    const decision = typeof body.decision === 'string' && validDecisions.includes(body.decision as ClientApprovalStatus)
      ? body.decision as ClientApprovalStatus
      : undefined;
    if (!decision) throw new ApiError(400, 'INVALID_CLIENT_DECISION', 'Decision must be approved, declined or information_requested.');
    const clientNotes = typeof body.clientNotes === 'string' ? body.clientNotes.trim() : '';
    const updated = await dependencies.repository.update(
      'clientApprovals',
      grant.agencyId,
      approval.id,
      { status: decision, clientNotes, respondedAt: new Date().toISOString() },
      approval.version,
      externalActor,
    );

    const maintenance = await loadVersioned<MaintenanceItem>(dependencies, 'maintenanceItems', grant.agencyId, approval.maintenanceItemId);
    await dependencies.repository.update(
      'maintenanceItems',
      grant.agencyId,
      maintenance.id,
      {
        approvalStatus: decision === 'approved' ? 'approved' : decision === 'declined' ? 'declined' : 'pending',
        ...(decision === 'approved' ? { status: 'approved' } : {}),
      },
      maintenance.version,
      externalActor,
    );
    await auditExternal(dependencies, grant, `external.client_approval.${decision}`, correlationId);
    return { status: 200, body: { data: updated, meta: { correlationId } } };
  }

  throw new ApiError(404, 'NOT_FOUND', 'External portal not found.');
}

async function validateGrantResource(
  dependencies: ApiDependencies,
  agencyId: string,
  resourceType: ExternalAccessGrant['resourceType'],
  resourceId: string,
  recipientEmail: string,
): Promise<Versioned<WorkRequest | TenantInstruction | ClientApproval>> {
  if (resourceType === 'work_request') {
    const request = await loadVersioned<WorkRequest>(dependencies, 'workRequests', agencyId, resourceId);
    const contact = await loadVersioned<ExternalContact>(dependencies, 'externalContacts', agencyId, request.externalContactId);
    if (contact.status !== 'active') throw new ApiError(409, 'EXTERNAL_CONTACT_INACTIVE', 'External contact is inactive.');
    if (contact.email.trim().toLowerCase() !== recipientEmail) throw new ApiError(400, 'RECIPIENT_SCOPE_MISMATCH', 'Recipient email does not match the assigned external contact.');
    return request;
  }
  if (resourceType === 'tenant_instruction') {
    const instruction = await loadVersioned<TenantInstruction>(dependencies, 'tenantInstructions', agencyId, resourceId);
    const tenancy = await dependencies.repository.get('tenancies', agencyId, instruction.tenancyId);
    const tenantEmails = Array.isArray(tenancy?.tenantEmails)
      ? tenancy.tenantEmails.filter((email): email is string => typeof email === 'string').map((email) => email.toLowerCase())
      : [];
    if (tenantEmails.length > 0 && !tenantEmails.includes(recipientEmail)) {
      throw new ApiError(400, 'RECIPIENT_SCOPE_MISMATCH', 'Recipient email is not linked to the instruction tenancy.');
    }
    return instruction;
  }
  const approval = await loadVersioned<ClientApproval>(dependencies, 'clientApprovals', agencyId, resourceId);
  if (approval.recipientEmail.trim().toLowerCase() !== recipientEmail) throw new ApiError(400, 'RECIPIENT_SCOPE_MISMATCH', 'Recipient email does not match the client approval recipient.');
  return approval;
}

export async function routeMaintenanceRequest(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
): Promise<ApiResponse | undefined> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'api' || parts[1] !== 'v1') return undefined;

  if (parts[2] === 'external') {
    const portalType = parts[3];
    const rawToken = parts[4];
    if (!portalType || !rawToken) throw new ApiError(400, 'TOKEN_REQUIRED', 'Access token is required.');
    return routeExternalPortal(req, dependencies, correlationId, portalType, rawToken);
  }

  if (req.method === 'POST' && parts[2] === 'maintenance-candidates' && parts[3] === 'extract') {
    const agencyId = getAgencyIdFromHeader(req);
    const principal = await authenticateAndAuthorise(req, dependencies, 'maintenance.manage', { agencyId }, correlationId);
    const body = await readJsonPayload(req);
    const reportId = typeof body.reportId === 'string' ? body.reportId.trim() : '';
    if (!reportId) throw new ApiError(400, 'REPORT_ID_REQUIRED', 'reportId is required for extraction.');

    const aggregate = await dependencies.reports.load(agencyId, reportId);
    if (!aggregate) throw new ApiError(404, 'NOT_FOUND', 'Report not found.');
    const existingCandidates = await dependencies.repository.list('maintenanceCandidates', agencyId, 100);
    const existingItems = await dependencies.repository.list('maintenanceItems', agencyId, 100);
    const created: MaintenanceCandidate[] = [];

    for (const area of aggregate.areas) {
      for (const component of area.components) {
        const hasDefects = component.defects.length > 0;
        const needsMaintenance = component.maintenanceRequired || component.conditionCategory === 'repair_required' || component.conditionCategory === 'replacement_recommended' || component.workingStatus === 'not_working' || hasDefects;
        if (!needsMaintenance) continue;

        const openItem = existingItems.items.find((item) =>
          item.sourceReportId === reportId && item.sourceAreaId === area.id && item.sourceComponentId === component.id && !['closed', 'cancelled', 'dismissed', 'duplicate', 'not_actionable'].includes(String(item.status)),
        );
        const pendingCandidate = existingCandidates.items.find((candidate) =>
          candidate.reportId === reportId && candidate.areaId === area.id && candidate.componentId === component.id && ['suggested', 'confirmed'].includes(String(candidate.reviewStatus)),
        );
        if (openItem || pendingCandidate) continue;

        const candidateId = randomUUID();
        const title = `${component.component} in ${area.name} requires review`;
        const description = component.commentary || component.defects.join('; ') || 'Structured inspection assessment indicates maintenance review is required.';
        const candidate: MaintenanceCandidate = {
          id: candidateId,
          agencyId,
          propertyId: aggregate.report.propertyId || '',
          ...(aggregate.report.tenancyId ? { tenancyId: aggregate.report.tenancyId } : {}),
          ...(aggregate.report.inspectionJobId ? { inspectionJobId: aggregate.report.inspectionJobId } : {}),
          reportId: aggregate.report.id,
          ...(aggregate.report.currentVersionId ? { reportVersionId: aggregate.report.currentVersionId } : {}),
          areaId: area.id,
          componentId: component.id,
          title,
          description,
          category: categoryFor(component.component),
          suggestedPriority: priorityFor(component),
          evidencePhotoIds: component.photoReferences.map((reference) => reference.photoId),
          source: candidateSource(component.reviewStatus),
          ...(typeof component.aiConfidence === 'number' ? { confidence: component.aiConfidence } : {}),
          reviewStatus: 'suggested',
          createdBy: principal.uid,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        const stored = await dependencies.repository.create('maintenanceCandidates', agencyId, candidateId, candidate as unknown as Record<string, unknown>, principal.uid);
        created.push(stored as unknown as MaintenanceCandidate);
      }
    }

    return { status: 200, body: { data: created, meta: { correlationId, extractedCount: created.length } } };
  }

  if (req.method === 'POST' && parts[2] === 'maintenance-candidates' && parts[3] && parts[4] === 'confirm') {
    const agencyId = getAgencyIdFromHeader(req);
    const principal = await authenticateAndAuthorise(req, dependencies, 'maintenance.manage', { agencyId }, correlationId);
    const candidate = await loadVersioned<MaintenanceCandidate>(dependencies, 'maintenanceCandidates', agencyId, parts[3]);
    if (candidate.reviewStatus !== 'suggested') throw new ApiError(409, 'CANDIDATE_ALREADY_REVIEWED', `Candidate is already ${candidate.reviewStatus}.`);

    const body = await readJsonPayload(req);
    const category = typeof body.category === 'string' && (MAINTENANCE_CATEGORIES as readonly string[]).includes(body.category)
      ? body.category as MaintenanceCategory
      : candidate.category;
    const priority = typeof body.priority === 'string' && (MAINTENANCE_PRIORITIES as readonly string[]).includes(body.priority)
      ? body.priority as MaintenancePriority
      : candidate.suggestedPriority;
    const itemId = randomUUID();
    const timestamp = new Date().toISOString();
    const item: MaintenanceItem = {
      id: itemId,
      agencyId,
      propertyId: candidate.propertyId,
      ...(candidate.tenancyId ? { tenancyId: candidate.tenancyId } : {}),
      ...(candidate.reportId ? { sourceReportId: candidate.reportId } : {}),
      ...(candidate.reportVersionId ? { sourceReportVersionId: candidate.reportVersionId } : {}),
      ...(candidate.inspectionJobId ? { sourceInspectionJobId: candidate.inspectionJobId } : {}),
      ...(candidate.areaId ? { sourceAreaId: candidate.areaId } : {}),
      ...(candidate.componentId ? { sourceComponentId: candidate.componentId } : {}),
      ...(candidate.observationId ? { sourceObservationId: candidate.observationId } : {}),
      candidateId: candidate.id,
      title: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : candidate.title,
      description: typeof body.description === 'string' && body.description.trim() ? body.description.trim() : candidate.description,
      category,
      priority,
      status: 'triage_required',
      sourceEvidenceIds: candidate.evidencePhotoIds,
      approvalRequired: Boolean(body.approvalRequired),
      approvalStatus: body.approvalRequired ? 'pending' : 'not_required',
      ...(typeof body.workInstruction === 'string' && body.workInstruction.trim() ? { workInstruction: body.workInstruction.trim() } : {}),
      verificationStatus: 'unverified',
      createdBy: principal.uid,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    };
    const stored = await dependencies.repository.create('maintenanceItems', agencyId, itemId, item as unknown as Record<string, unknown>, principal.uid);
    await dependencies.repository.update('maintenanceCandidates', agencyId, candidate.id, { reviewStatus: 'confirmed', confirmedMaintenanceItemId: itemId }, candidate.version, principal.uid);
    return { status: 201, body: { data: stored, meta: { correlationId } } };
  }

  if (req.method === 'POST' && parts[2] === 'external-access-grants' && parts[3] === 'generate') {
    const agencyId = getAgencyIdFromHeader(req);
    const principal = await authenticateAndAuthorise(req, dependencies, 'maintenance.manage', { agencyId }, correlationId);
    const body = await readJsonPayload(req);
    const validResourceTypes: ExternalAccessGrant['resourceType'][] = ['work_request', 'tenant_instruction', 'client_approval'];
    const resourceType = typeof body.resourceType === 'string' && validResourceTypes.includes(body.resourceType as ExternalAccessGrant['resourceType'])
      ? body.resourceType as ExternalAccessGrant['resourceType']
      : undefined;
    const resourceId = typeof body.resourceId === 'string' ? body.resourceId.trim() : '';
    const recipientEmail = emailAddress(body.recipientEmail);
    if (!resourceType || !resourceId) throw new ApiError(400, 'INVALID_GRANT_REQUEST', 'resourceType and resourceId are required.');
    const resource = await validateGrantResource(dependencies, agencyId, resourceType, resourceId, recipientEmail);
    const expiresInHours = typeof body.expiresInHours === 'number' && Number.isFinite(body.expiresInHours)
      ? Math.min(Math.max(Math.floor(body.expiresInHours), 1), 168)
      : 72;

    const rawToken = `${randomUUID()}${randomUUID().replaceAll('-', '')}`;
    const grantId = randomUUID();
    const timestamp = new Date().toISOString();
    const grant: ExternalAccessGrant = {
      id: grantId,
      agencyId,
      resourceType,
      resourceId,
      recipientEmail,
      tokenHash: hashGrantToken(rawToken),
      expiresAt: new Date(Date.now() + expiresInHours * 3_600_000).toISOString(),
      createdBy: principal.uid,
      createdAt: timestamp,
    };
    await dependencies.repository.create('externalAccessGrants', agencyId, grantId, grant as unknown as Record<string, unknown>, principal.uid);

    const collection = resourceType === 'work_request' ? 'workRequests' : resourceType === 'tenant_instruction' ? 'tenantInstructions' : 'clientApprovals';
    await dependencies.repository.update(collection, agencyId, resourceId, { accessGrantId: grantId }, resource.version, principal.uid);

    const route = resourceType === 'work_request' ? 'work-request' : resourceType === 'tenant_instruction' ? 'tenant-instruction' : 'client-approval';
    return {
      status: 201,
      body: {
        data: {
          grantId,
          grantToken: rawToken,
          expiresAt: grant.expiresAt,
          accessUrl: `/external/${route}/${rawToken}`,
        },
        meta: { correlationId },
      },
    };
  }

  if (req.method === 'POST' && parts[2] === 'external-access-grants' && parts[3] && parts[4] === 'revoke') {
    const agencyId = getAgencyIdFromHeader(req);
    const principal = await authenticateAndAuthorise(req, dependencies, 'maintenance.manage', { agencyId }, correlationId);
    const grant = await loadVersioned<ExternalAccessGrant>(dependencies, 'externalAccessGrants', agencyId, parts[3]);
    const updated = await dependencies.repository.update('externalAccessGrants', agencyId, grant.id, { revokedAt: new Date().toISOString() }, grant.version, principal.uid);
    return { status: 200, body: { data: updated, meta: { correlationId } } };
  }

  return undefined;
}
