import type { IncomingMessage } from 'node:http';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies, StoredRecord } from './types.js';

function agencyHeader(req: IncomingMessage): string {
  const agencyId = req.headers['x-agency-id']?.toString().trim();
  if (!agencyId) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.');
  return agencyId;
}

async function authorizeTenantAggregate(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string, agencyId: string, tenantId?: string): Promise<void> {
  const target = { agencyId, ...(tenantId ? { tenantId } : {}) };
  await authenticateAndAuthorise(req, dependencies, 'tenant.read', target, correlationId);
  await authenticateAndAuthorise(req, dependencies, 'tenancy.read', target, correlationId);
  await authenticateAndAuthorise(req, dependencies, 'maintenance.read', target, correlationId);
  await authenticateAndAuthorise(req, dependencies, 'tenant_instruction.manage', target, correlationId);
  await authenticateAndAuthorise(req, dependencies, 'tenant.communication.read', target, correlationId);
  await authenticateAndAuthorise(req, dependencies, 'tenant.document.read', target, correlationId);
}

async function listAll(dependencies: ApiDependencies, collection: string, agencyId: string): Promise<StoredRecord[]> {
  const items: StoredRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = await dependencies.repository.list(collection, agencyId, 100, cursor);
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

function lifecycle(record: StoredRecord | undefined): string {
  if (!record) return 'unknown';
  return String(record.lifecycleStatus || (record.status === 'inactive' ? 'ended' : record.status) || 'active');
}

function isTerminalMaintenance(status: unknown): boolean {
  return ['closed', 'dismissed', 'cancelled', 'duplicate', 'not_actionable'].includes(String(status));
}

function isTerminalAction(status: unknown): boolean {
  return ['resolved', 'closed', 'cancelled', 'withdrawn'].includes(String(status));
}

async function tenantOverview(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string): Promise<ApiResponse> {
  const agencyId = agencyHeader(req);
  await authorizeTenantAggregate(req, dependencies, correlationId, agencyId);
  const [tenants, tenancies, participants, properties, jobs, maintenance, actions] = await Promise.all([
    listAll(dependencies, 'tenants', agencyId),
    listAll(dependencies, 'tenancies', agencyId),
    listAll(dependencies, 'tenancyParticipants', agencyId),
    listAll(dependencies, 'properties', agencyId),
    listAll(dependencies, 'inspectionJobs', agencyId),
    listAll(dependencies, 'maintenanceItems', agencyId),
    listAll(dependencies, 'tenantInstructions', agencyId),
  ]);

  const rows = tenants.map((tenant) => {
    const links = participants.filter((item) => item.tenantId === tenant.id && item.status !== 'ended');
    const linkedTenancies = links
      .map((item) => tenancies.find((candidate) => candidate.id === item.tenancyId))
      .filter((item): item is StoredRecord => Boolean(item));
    const tenancy = linkedTenancies.find((item) => lifecycle(item) === 'active')
      || linkedTenancies.find((item) => !['ended', 'cancelled'].includes(lifecycle(item)))
      || linkedTenancies[0];
    const property = tenancy ? properties.find((item) => item.id === tenancy.propertyId) : undefined;
    const openActions = tenancy ? actions.filter((item) => item.tenancyId === tenancy.id && !isTerminalAction(item.status)) : [];
    const openMaintenance = tenancy ? maintenance.filter((item) => item.tenancyId === tenancy.id && !isTerminalMaintenance(item.status)) : [];
    const nextInspection = tenancy
      ? jobs
        .filter((item) => item.tenancyId === tenancy.id && item.scheduledAt && !['finalised', 'archived', 'cancelled'].includes(String(item.status)))
        .sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)))[0]
      : undefined;
    const overdue = openActions.some((item) => item.dueDate && new Date(String(item.dueDate)).getTime() < Date.now());
    return {
      tenant,
      tenancy,
      property: property ? { id: property.id, address: property.address, suburb: property.suburb, state: property.state, postcode: property.postcode } : undefined,
      lifecycle: lifecycle(tenancy),
      openActionCount: openActions.length,
      openMaintenanceCount: openMaintenance.length,
      nextInspection: nextInspection ? { id: nextInspection.id, reportType: nextInspection.reportType, scheduledAt: nextInspection.scheduledAt, status: nextInspection.status } : undefined,
      overdue,
    };
  });

  const stats = {
    activeTenants: rows.filter((row) => row.lifecycle === 'active').length,
    activeTenancies: tenancies.filter((item) => lifecycle(item) === 'active').length,
    upcoming: tenancies.filter((item) => lifecycle(item) === 'upcoming').length,
    vacating: tenancies.filter((item) => ['notice_given', 'vacating'].includes(lifecycle(item))).length,
    awaitingTenant: actions.filter((item) => ['issued', 'viewed', 'awaiting_action'].includes(String(item.status))).length,
    openMaintenance: maintenance.filter((item) => !isTerminalMaintenance(item.status)).length,
  };

  return { status: 200, body: { data: { rows, stats }, meta: { correlationId, total: rows.length } } };
}

async function tenantWorkspace(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string, tenantId: string): Promise<ApiResponse> {
  const agencyId = agencyHeader(req);
  await authorizeTenantAggregate(req, dependencies, correlationId, agencyId, tenantId);
  const tenant = await dependencies.repository.get('tenants', agencyId, tenantId);
  if (!tenant) throw new ApiError(404, 'TENANT_NOT_FOUND', 'Tenant not found.');

  const allParticipants = await listAll(dependencies, 'tenancyParticipants', agencyId);
  const tenantLinks = allParticipants.filter((item) => item.tenantId === tenantId);
  const allTenancies = await listAll(dependencies, 'tenancies', agencyId);
  const linkedTenancies = tenantLinks
    .map((item) => allTenancies.find((candidate) => candidate.id === item.tenancyId))
    .filter((item): item is StoredRecord => Boolean(item));
  const tenancyIds = new Set(linkedTenancies.map((item) => item.id));
  const relatedParticipants = allParticipants.filter((item) => tenancyIds.has(String(item.tenancyId)));
  const participantTenantIds = new Set(relatedParticipants.map((item) => String(item.tenantId)));
  const participantTenants = (await listAll(dependencies, 'tenants', agencyId)).filter((item) => participantTenantIds.has(item.id));

  const [properties, jobs, reports, maintenance, actions, communications, documents] = await Promise.all([
    listAll(dependencies, 'properties', agencyId),
    listAll(dependencies, 'inspectionJobs', agencyId),
    listAll(dependencies, 'reports', agencyId),
    listAll(dependencies, 'maintenanceItems', agencyId),
    listAll(dependencies, 'tenantInstructions', agencyId),
    listAll(dependencies, 'tenantCommunications', agencyId),
    listAll(dependencies, 'tenancyDocuments', agencyId),
  ]);

  const currentTenancy = linkedTenancies.find((item) => lifecycle(item) === 'active')
    || linkedTenancies.find((item) => !['ended', 'cancelled'].includes(lifecycle(item)))
    || linkedTenancies[0];
  const property = currentTenancy ? properties.find((item) => item.id === currentTenancy.propertyId) : undefined;

  return {
    status: 200,
    body: {
      data: {
        tenant,
        linkedTenancies,
        currentTenancy,
        property,
        participants: relatedParticipants.map((item) => ({ ...item, tenant: participantTenants.find((candidate) => candidate.id === item.tenantId) })),
        jobs: jobs.filter((item) => tenancyIds.has(String(item.tenancyId))),
        reports: reports.filter((item) => tenancyIds.has(String(item.tenancyId))),
        maintenance: maintenance.filter((item) => tenancyIds.has(String(item.tenancyId))),
        actions: actions.filter((item) => tenancyIds.has(String(item.tenancyId))),
        communications: communications.filter((item) => item.tenantId === tenantId || tenancyIds.has(String(item.tenancyId))),
        documents: documents.filter((item) => item.tenantId === tenantId || tenancyIds.has(String(item.tenancyId))),
      },
      meta: { correlationId },
    },
  };
}

export async function routeTenantOperationsRequest(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string): Promise<ApiResponse | undefined> {
  const parts = new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean);
  if (parts[0] !== 'api' || parts[1] !== 'v1') return undefined;
  if (parts[2] === 'tenants' && parts[3] === 'overview' && req.method === 'GET') return tenantOverview(req, dependencies, correlationId);
  if (parts[2] === 'tenants' && parts[3] && parts[4] === 'workspace' && req.method === 'GET') return tenantWorkspace(req, dependencies, correlationId, parts[3]);
  return undefined;
}
