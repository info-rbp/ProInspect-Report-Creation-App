import type { AuthorisationTarget } from '@pcr/domain';
import type { RoutePolicy } from './types.js';

function target(body: Record<string, unknown>, id?: string): AuthorisationTarget {
  const agencyId = typeof body.agencyId === 'string' ? body.agencyId : '';
  return {
    agencyId,
    ...(typeof body.propertyId === 'string' ? { propertyId: body.propertyId } : {}),
    ...(typeof body.tenancyId === 'string' ? { tenancyId: body.tenancyId } : {}),
    ...(typeof body.inspectionJobId === 'string' ? { inspectionJobId: body.inspectionJobId } : {}),
    ...(typeof body.reportId === 'string' ? { reportId: body.reportId } : {}),
    ...(typeof body.assignedInspectorId === 'string' ? { assignedInspectorId: body.assignedInspectorId } : {}),
    ...(typeof body.assignedAnalystId === 'string' ? { assignedAnalystId: body.assignedAnalystId } : {}),
    ...(typeof body.assignedReviewerId === 'string' ? { assignedReviewerId: body.assignedReviewerId } : {}),
    ...(typeof body.lifecycleStatus === 'string' ? { lifecycleStatus: body.lifecycleStatus } : {}),
    ...(!body.reportId && id ? { reportId: id } : {}),
  };
}

export const ROUTE_POLICIES: Record<string, RoutePolicy> = {
  agencies: { collection: 'agencies', readCapability: 'agency.read', writeCapability: 'agency.manage', target },
  users: { collection: 'users', readCapability: 'agency.read', writeCapability: 'user.suspend', target },
  invitations: { collection: 'invitations', readCapability: 'agency.read', writeCapability: 'user.invite', target },
  clients: { collection: 'clients', readCapability: 'property.read', writeCapability: 'property.manage', target },
  properties: { collection: 'properties', readCapability: 'property.read', writeCapability: 'property.manage', target },
  tenancies: { collection: 'tenancies', readCapability: 'tenancy.read', writeCapability: 'tenancy.manage', target },
  'inspection-jobs': { collection: 'inspectionJobs', readCapability: 'job.read', writeCapability: 'job.manage', target },
  reports: { collection: 'reports', readCapability: 'report.read', writeCapability: 'report.edit', target },
  templates: { collection: 'templates', readCapability: 'report.read', writeCapability: 'template.manage', target },
  'report-versions': { collection: 'reportVersions', readCapability: 'report.read', writeCapability: 'report.edit', target },
  uploads: { collection: 'uploadSessions', readCapability: 'report.read', writeCapability: 'upload.create', target },
  'analysis-jobs': { collection: 'analysisJobs', readCapability: 'report.read', writeCapability: 'analysis.create', target },
  'pdf-jobs': { collection: 'pdfJobs', readCapability: 'report.read', writeCapability: 'pdf.create', target },
  'tenant-responses': { collection: 'tenantResponses', readCapability: 'report.read', writeCapability: 'tenant_response.submit', target },
  notifications: { collection: 'notificationJobs', readCapability: 'audit.read', writeCapability: 'notification.send', target },
  'audit-history': { collection: 'auditEvents', readCapability: 'audit.read', target },
};

export const API_ROUTE_NAMES = Object.freeze(Object.keys(ROUTE_POLICIES));
