import type { IncomingMessage } from 'node:http';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies, StoredRecord } from './types.js';

function agencyHeader(req: IncomingMessage): string {
  const agencyId = req.headers['x-agency-id']?.toString().trim();
  if (!agencyId) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.');
  return agencyId;
}

async function listAll(dependencies: ApiDependencies, collection: string, agencyId: string): Promise<StoredRecord[]> {
  const result: StoredRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = await dependencies.repository.list(collection, agencyId, 100, cursor);
    result.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return result;
}

export async function routeTenantActionQueueRequest(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string): Promise<ApiResponse | undefined> {
  const parts = new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean);
  if (req.method !== 'GET' || parts[0] !== 'api' || parts[1] !== 'v1' || parts[2] !== 'tenant-actions' || parts[3] !== 'queue') return undefined;
  const agencyId = agencyHeader(req);
  await authenticateAndAuthorise(req, dependencies, 'tenant_instruction.manage', { agencyId }, correlationId);
  const [actions, tenancies, participants, tenants, properties] = await Promise.all([
    listAll(dependencies, 'tenantInstructions', agencyId),
    listAll(dependencies, 'tenancies', agencyId),
    listAll(dependencies, 'tenancyParticipants', agencyId),
    listAll(dependencies, 'tenants', agencyId),
    listAll(dependencies, 'properties', agencyId),
  ]);
  const data = actions.map((action) => {
    const tenancy = tenancies.find((item) => item.id === action.tenancyId);
    const activeParticipants = participants.filter((item) => item.tenancyId === action.tenancyId && item.status !== 'ended');
    const primary = activeParticipants.find((item) => item.role === 'primary_tenant') || activeParticipants[0];
    const tenant = primary ? tenants.find((item) => item.id === primary.tenantId) : undefined;
    const property = tenancy ? properties.find((item) => item.id === tenancy.propertyId) : undefined;
    return {
      ...action,
      tenant: tenant ? { id: tenant.id, fullName: tenant.fullName, email: tenant.email, phone: tenant.phone } : undefined,
      property: property ? { id: property.id, address: property.address, suburb: property.suburb } : undefined,
    };
  }).sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
  return { status: 200, body: { data, meta: { correlationId, total: data.length } } };
}
