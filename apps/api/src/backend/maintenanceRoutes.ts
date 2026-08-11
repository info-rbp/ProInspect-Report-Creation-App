import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type {
  ExternalAccessGrant,
  MaintenanceCandidate,
  MaintenanceItem,
  WorkRequest,
  TenantInstruction,
  ClientApproval,
} from '@pcr/domain';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies } from './types.js';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';

async function readJsonPayload(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 1_000_000) {
      throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Payload exceeds 1 MB.');
    }
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Object required');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }
}

function getAgencyIdFromHeader(req: IncomingMessage): string {
  return req.headers['x-agency-id']?.toString().trim() || '';
}

function hashGrantToken(rawToken: string): string {
  return createHash('sha256').update(rawToken.trim()).digest('hex');
}

export async function routeMaintenanceRequest(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
): Promise<ApiResponse | undefined> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);

  if (parts[0] !== 'api' || parts[1] !== 'v1') return undefined;

  // 1. External Scoped Portal Routes: /api/v1/external/:type/:token
  if (parts[2] === 'external') {
    const portalType = parts[3]; // 'work-requests' | 'tenant-instructions' | 'client-approvals'
    const rawToken = parts[4];

    if (!portalType || !rawToken) {
      throw new ApiError(400, 'TOKEN_REQUIRED', 'Access token is required.');
    }

    const tokenHash = hashGrantToken(rawToken);

    // Query externalAccessGrants by tokenHash
    // Since repository list returns items for agency, we query by listing or fetching
    const grantList = await dependencies.repository.list('externalAccessGrants', '', 100);
    const grant = grantList.items.find(
      (g) => (g as unknown as ExternalAccessGrant).tokenHash === tokenHash,
    ) as unknown as ExternalAccessGrant | undefined;

    if (!grant) {
      throw new ApiError(401, 'INVALID_GRANT_TOKEN', 'Access token is invalid or has expired.');
    }

    if (grant.revokedAt) {
      throw new ApiError(401, 'GRANT_TOKEN_REVOKED', 'Access token has been revoked.');
    }

    if (new Date(grant.expiresAt).getTime() < Date.now()) {
      throw new ApiError(401, 'GRANT_TOKEN_EXPIRED', 'Access token has expired.');
    }

    const agencyId = grant.agencyId;

    // Route: Contractor Work Request Portal
    if (portalType === 'work-requests') {
      const workRequest = (await dependencies.repository.get(
        'workRequests',
        agencyId,
        grant.resourceId,
      )) as unknown as WorkRequest | undefined;

      if (!workRequest) {
        throw new ApiError(404, 'NOT_FOUND', 'Work request not found.');
      }

      const maintenanceItem = (await dependencies.repository.get(
        'maintenanceItems',
        agencyId,
        workRequest.maintenanceItemId,
      )) as unknown as MaintenanceItem | undefined;

      const property = maintenanceItem?.propertyId
        ? await dependencies.repository.get('properties', agencyId, maintenanceItem.propertyId)
        : null;

      if (req.method === 'GET') {
        return {
          status: 200,
          body: {
            data: {
              workRequest,
              maintenanceItem: maintenanceItem
                ? {
                    id: maintenanceItem.id,
                    title: maintenanceItem.title,
                    description: maintenanceItem.description,
                    category: maintenanceItem.category,
                    priority: maintenanceItem.priority,
                    workInstruction: maintenanceItem.workInstruction,
                    dueDate: maintenanceItem.dueDate,
                    sourceEvidenceIds: maintenanceItem.sourceEvidenceIds,
                  }
                : null,
              propertyAddress: (property as any)?.address || (property as any)?.propertyAddress || 'Property',
            },
            meta: { correlationId },
          },
        };
      }

      if (req.method === 'POST') {
        const body = await readJsonPayload(req);
        const action = typeof body.action === 'string' ? body.action : 'acknowledge';

        let newStatus = workRequest.status;
        let responseNotes = typeof body.responseNotes === 'string' ? body.responseNotes : workRequest.responseNotes;
        let completionEvidenceIds = Array.isArray(body.completionEvidenceIds)
          ? body.completionEvidenceIds.filter((id): id is string => typeof id === 'string')
          : workRequest.completionEvidenceIds || [];

        if (action === 'acknowledge') {
          newStatus = 'acknowledged';
        } else if (action === 'in_progress') {
          newStatus = 'in_progress';
        } else if (action === 'complete') {
          newStatus = 'completed';
        } else if (action === 'unable_to_complete') {
          newStatus = 'unable_to_complete';
        }

        const updatedRequest = await dependencies.repository.update(
          'workRequests',
          agencyId,
          workRequest.id,
          {
            status: newStatus,
            responseNotes,
            completionEvidenceIds,
            ...(action === 'acknowledge' ? { acknowledgedAt: new Date().toISOString() } : {}),
            ...(action === 'complete' ? { completedAt: new Date().toISOString() } : {}),
            updatedAt: new Date().toISOString(),
          },
          workRequest.version,
          `external:${grant.recipientEmail}`,
        );

        // If completed, update parent MaintenanceItem status to 'verification_required' or 'awaiting_completion_evidence'
        if (maintenanceItem && action === 'complete') {
          await dependencies.repository.update(
            'maintenanceItems',
            agencyId,
            maintenanceItem.id,
            {
              status: 'verification_required',
              completionEvidenceIds,
              completionNote: responseNotes,
              completionDate: new Date().toISOString(),
              verificationStatus: 'verification_required',
              updatedAt: new Date().toISOString(),
            },
            maintenanceItem.version,
            `external:${grant.recipientEmail}`,
          );
        }

        return {
          status: 200,
          body: {
            data: updatedRequest,
            meta: { correlationId },
          },
        };
      }
    }

    // Route: Tenant Instruction Portal
    if (portalType === 'tenant-instructions') {
      const instruction = (await dependencies.repository.get(
        'tenantInstructions',
        agencyId,
        grant.resourceId,
      )) as unknown as TenantInstruction | undefined;

      if (!instruction) {
        throw new ApiError(404, 'NOT_FOUND', 'Tenant instruction not found.');
      }

      if (req.method === 'GET') {
        // Mark as viewed if not yet viewed
        if (!instruction.viewedAt) {
          await dependencies.repository.update(
            'tenantInstructions',
            agencyId,
            instruction.id,
            {
              viewedAt: new Date().toISOString(),
              status: instruction.status === 'issued' ? 'viewed' : instruction.status,
              updatedAt: new Date().toISOString(),
            },
            instruction.version,
            `external:${grant.recipientEmail}`,
          );
        }

        return {
          status: 200,
          body: {
            data: instruction,
            meta: { correlationId },
          },
        };
      }

      if (req.method === 'POST') {
        const body = await readJsonPayload(req);
        const tenantResponseNote = typeof body.tenantResponseNote === 'string' ? body.tenantResponseNote : '';
        const tenantEvidenceIds = Array.isArray(body.tenantEvidenceIds)
          ? body.tenantEvidenceIds.filter((id): id is string => typeof id === 'string')
          : [];

        const updated = await dependencies.repository.update(
          'tenantInstructions',
          agencyId,
          instruction.id,
          {
            status: 'tenant_responded',
            tenantResponseNote,
            tenantEvidenceIds,
            tenantSubmittedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          instruction.version,
          `external:${grant.recipientEmail}`,
        );

        return {
          status: 200,
          body: {
            data: updated,
            meta: { correlationId },
          },
        };
      }
    }

    // Route: Client / Landlord Approval Portal
    if (portalType === 'client-approvals') {
      const approval = (await dependencies.repository.get(
        'clientApprovals',
        agencyId,
        grant.resourceId,
      )) as unknown as ClientApproval | undefined;

      if (!approval) {
        throw new ApiError(404, 'NOT_FOUND', 'Client approval request not found.');
      }

      if (req.method === 'GET') {
        return {
          status: 200,
          body: {
            data: approval,
            meta: { correlationId },
          },
        };
      }

      if (req.method === 'POST') {
        const body = await readJsonPayload(req);
        const decision = typeof body.decision === 'string' ? body.decision : 'approved'; // 'approved' | 'declined' | 'information_requested'
        const clientNotes = typeof body.clientNotes === 'string' ? body.clientNotes : '';

        const updated = await dependencies.repository.update(
          'clientApprovals',
          agencyId,
          approval.id,
          {
            status: decision as any,
            clientNotes,
            respondedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          approval.version,
          `external:${grant.recipientEmail}`,
        );

        // Update maintenance item approvalStatus
        const maintenanceItem = (await dependencies.repository.get(
          'maintenanceItems',
          agencyId,
          approval.maintenanceItemId,
        )) as unknown as MaintenanceItem | undefined;

        if (maintenanceItem) {
          await dependencies.repository.update(
            'maintenanceItems',
            agencyId,
            maintenanceItem.id,
            {
              approvalStatus: decision === 'approved' ? 'approved' : decision === 'declined' ? 'declined' : 'pending',
              status: decision === 'approved' ? 'approved' : maintenanceItem.status,
              updatedAt: new Date().toISOString(),
            },
            maintenanceItem.version,
            `external:${grant.recipientEmail}`,
          );
        }

        return {
          status: 200,
          body: {
            data: updated,
            meta: { correlationId },
          },
        };
      }
    }
  }

  // 2. Candidate Extraction from Report: POST /api/v1/maintenance-candidates/extract
  if (req.method === 'POST' && parts[2] === 'maintenance-candidates' && parts[3] === 'extract') {
    const agencyId = getAgencyIdFromHeader(req);
    const principal = await authenticateAndAuthorise(
      req,
      dependencies,
      'maintenance.manage',
      { agencyId },
      correlationId,
    );

    const body = await readJsonPayload(req);
    const reportId = typeof body.reportId === 'string' ? body.reportId : '';

    if (!reportId) {
      throw new ApiError(400, 'REPORT_ID_REQUIRED', 'reportId is required for extraction.');
    }

    const reportAgg = await dependencies.reports.load(agencyId, reportId);
    if (!reportAgg) {
      throw new ApiError(404, 'NOT_FOUND', 'Report not found.');
    }

    const propertyId = reportAgg.report.propertyId;
    const areas = reportAgg.areas || [];
    const candidatesCreated: MaintenanceCandidate[] = [];

    // Scan areas and components for defects, maintenance notes, or non-intact conditions
    for (const area of areas) {
      for (const comp of area.components || []) {
        const hasDefects = Array.isArray(comp.defects) && comp.defects.length > 0;
        const needsMaintenance =
          comp.maintenanceRequired ||
          comp.conditionCategory === 'repair_required' ||
          comp.conditionCategory === 'replacement_recommended' ||
          comp.workingStatus === 'not_working' ||
          hasDefects;

        if (needsMaintenance) {
          const candidateId = randomUUID();
          const compName = comp.component || 'Component';
          const areaName = area.name || 'Area';
          const title = `${compName} in ${areaName} - ${comp.conditionCategory || 'Attention Required'}`;
          const description =
            comp.commentary ||
            (comp.defects && comp.defects.length > 0
              ? comp.defects.join('; ')
              : 'Requires maintenance evaluation.');
          const suggestedPriority =
            comp.conditionCategory === 'repair_required' ||
            comp.conditionCategory === 'replacement_recommended' ||
            comp.workingStatus === 'not_working'
              ? 'high'
              : 'routine';

          const photoIds = comp.photoReferences ? comp.photoReferences.map((pr: any) => pr.photoId) : [];

          const candidateData: Partial<MaintenanceCandidate> = {
            id: candidateId,
            agencyId,
            propertyId,
            inspectionJobId: reportAgg.report.inspectionJobId,
            reportId: reportAgg.report.id,
            reportVersionId: (reportAgg.report as any).activeVersionId || 'v1',
            areaId: area.id,
            componentId: comp.id,
            title,
            description,
            category: 'General Maintenance',
            suggestedPriority,
            evidencePhotoIds: photoIds,
            source: 'ai',
            reviewStatus: 'suggested',
            createdBy: principal.uid,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };

          const stored = (await dependencies.repository.create(
            'maintenanceCandidates',
            agencyId,
            candidateId,
            candidateData as Record<string, unknown>,
            principal.uid,
          )) as unknown as MaintenanceCandidate;

          candidatesCreated.push(stored);
        }
      }
    }

    return {
      status: 200,
      body: {
        data: candidatesCreated,
        meta: { correlationId, extractedCount: candidatesCreated.length },
      },
    };
  }

  // 3. Confirm Candidate into Maintenance Item: POST /api/v1/maintenance-candidates/:id/confirm
  if (req.method === 'POST' && parts[2] === 'maintenance-candidates' && parts[3] && parts[4] === 'confirm') {
    const candidateId = parts[3];
    const agencyId = getAgencyIdFromHeader(req);
    const principal = await authenticateAndAuthorise(
      req,
      dependencies,
      'maintenance.manage',
      { agencyId },
      correlationId,
    );

    const candidate = (await dependencies.repository.get(
      'maintenanceCandidates',
      agencyId,
      candidateId,
    )) as unknown as MaintenanceCandidate | undefined;

    if (!candidate) {
      throw new ApiError(404, 'NOT_FOUND', 'Candidate not found.');
    }

    const body = await readJsonPayload(req);
    const title = typeof body.title === 'string' ? body.title : candidate.title;
    const description = typeof body.description === 'string' ? body.description : candidate.description;
    const category = typeof body.category === 'string' ? body.category : candidate.category;
    const priority = typeof body.priority === 'string' ? body.priority : candidate.suggestedPriority;
    const workInstruction = typeof body.workInstruction === 'string' ? body.workInstruction : '';

    const itemId = randomUUID();
    const itemData: Partial<MaintenanceItem> = {
      id: itemId,
      agencyId,
      propertyId: candidate.propertyId,
      tenancyId: candidate.tenancyId,
      sourceReportId: candidate.reportId,
      sourceReportVersionId: candidate.reportVersionId,
      sourceInspectionJobId: candidate.inspectionJobId,
      sourceAreaId: candidate.areaId,
      sourceComponentId: candidate.componentId,
      candidateId,
      title,
      description,
      category: category as any,
      priority: priority as any,
      status: 'approved',
      sourceEvidenceIds: candidate.evidencePhotoIds || [],
      approvalRequired: false,
      approvalStatus: 'approved',
      workInstruction,
      verificationStatus: 'unverified',
      createdBy: principal.uid,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    };

    const createdItem = await dependencies.repository.create(
      'maintenanceItems',
      agencyId,
      itemId,
      itemData as Record<string, unknown>,
      principal.uid,
    );

    // Update Candidate status to 'confirmed'
    await dependencies.repository.update(
      'maintenanceCandidates',
      agencyId,
      candidateId,
      {
        reviewStatus: 'confirmed',
        confirmedMaintenanceItemId: itemId,
        updatedAt: new Date().toISOString(),
      },
      1,
      principal.uid,
    );

    return {
      status: 201,
      body: {
        data: createdItem,
        meta: { correlationId },
      },
    };
  }

  // 4. Generate Access Grant Token: POST /api/v1/external-access-grants/generate
  if (req.method === 'POST' && parts[2] === 'external-access-grants' && parts[3] === 'generate') {
    const agencyId = getAgencyIdFromHeader(req);
    const principal = await authenticateAndAuthorise(
      req,
      dependencies,
      'maintenance.manage',
      { agencyId },
      correlationId,
    );

    const body = await readJsonPayload(req);
    const resourceType = body.resourceType as 'work_request' | 'tenant_instruction' | 'client_approval';
    const resourceId = typeof body.resourceId === 'string' ? body.resourceId : '';
    const recipientEmail = typeof body.recipientEmail === 'string' ? body.recipientEmail : '';
    const expiresInHours = typeof body.expiresInHours === 'number' ? body.expiresInHours : 72;

    if (!resourceType || !resourceId || !recipientEmail) {
      throw new ApiError(400, 'INVALID_GRANT_REQUEST', 'resourceType, resourceId, and recipientEmail are required.');
    }

    const rawToken = `${randomUUID()}${randomUUID().replaceAll('-', '')}`;
    const tokenHash = hashGrantToken(rawToken);
    const grantId = randomUUID();
    const expiresAt = new Date(Date.now() + expiresInHours * 3600 * 1000).toISOString();

    const grantData: ExternalAccessGrant = {
      id: grantId,
      agencyId,
      resourceType,
      resourceId,
      recipientEmail,
      tokenHash,
      expiresAt,
      createdBy: principal.uid,
      createdAt: new Date().toISOString(),
    };

    await dependencies.repository.create(
      'externalAccessGrants',
      agencyId,
      grantId,
      grantData as unknown as Record<string, unknown>,
      principal.uid,
    );

    // Return the raw token ONLY on generation!
    return {
      status: 201,
      body: {
        data: {
          grantId,
          grantToken: rawToken,
          expiresAt,
          accessUrl: `/external/${resourceType === 'work_request' ? 'work-request' : resourceType === 'tenant_instruction' ? 'tenant-instruction' : 'client-approval'}/${rawToken}`,
        },
        meta: { correlationId },
      },
    };
  }

  return undefined;
}
