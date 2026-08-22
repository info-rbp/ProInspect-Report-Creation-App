import { randomUUID } from 'node:crypto';
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
  const records: StoredRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = await dependencies.repository.list(collection, agencyId, 100, cursor);
    records.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return records;
}

export async function routeTenantMigrationRequest(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string): Promise<ApiResponse | undefined> {
  const parts = new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean);
  if (req.method !== 'POST' || parts[0] !== 'api' || parts[1] !== 'v1' || parts[2] !== 'tenants' || parts[3] !== 'migrate-legacy') return undefined;
  const agencyId = agencyHeader(req);
  const principal = await authenticateAndAuthorise(req, dependencies, 'tenant.manage', { agencyId }, correlationId);
  const [tenancies, tenants, participants] = await Promise.all([
    listAll(dependencies, 'tenancies', agencyId),
    listAll(dependencies, 'tenants', agencyId),
    listAll(dependencies, 'tenancyParticipants', agencyId),
  ]);

  let tenantsCreated = 0;
  let participantsCreated = 0;
  let reviewRequired = 0;
  let skipped = 0;

  for (const tenancy of tenancies) {
    const names = Array.isArray(tenancy.tenantNames) ? tenancy.tenantNames.filter((value): value is string => typeof value === 'string') : [];
    const emails = Array.isArray(tenancy.tenantEmails) ? tenancy.tenantEmails.filter((value): value is string => typeof value === 'string') : [];
    for (let index = 0; index < names.length; index += 1) {
      const fullName = names[index]?.trim();
      if (!fullName) {
        skipped += 1;
        continue;
      }
      const email = emails[index]?.trim().toLowerCase() || '';
      const emailMatches = email ? tenants.filter((candidate) => typeof candidate.email === 'string' && candidate.email.trim().toLowerCase() === email) : [];
      if (emailMatches.length > 1) {
        reviewRequired += 1;
        continue;
      }
      let tenant = emailMatches[0];
      if (!tenant) {
        const tenantId = randomUUID();
        tenant = await dependencies.repository.create('tenants', agencyId, tenantId, {
          fullName,
          ...(email ? { email, preferredCommunication: 'email' } : { preferredCommunication: 'portal' }),
          status: 'active',
        }, principal.uid);
        tenants.push(tenant);
        tenantsCreated += 1;
      }
      if (!participants.some((candidate) => candidate.tenancyId === tenancy.id && candidate.tenantId === tenant!.id)) {
        const participant = await dependencies.repository.create('tenancyParticipants', agencyId, randomUUID(), {
          tenancyId: tenancy.id,
          tenantId: tenant.id,
          role: index === 0 ? 'primary_tenant' : 'co_tenant',
          status: ['ended', 'cancelled'].includes(String(tenancy.lifecycleStatus || tenancy.status)) ? 'ended' : 'active',
          ...(tenancy.leaseStartDate ? { startDate: tenancy.leaseStartDate } : {}),
          ...(['ended', 'cancelled'].includes(String(tenancy.lifecycleStatus || tenancy.status)) && tenancy.leaseEndDate ? { endDate: tenancy.leaseEndDate } : {}),
        }, principal.uid);
        participants.push(participant);
        participantsCreated += 1;
      }
    }
  }

  await dependencies.audit.append({
    id: randomUUID(), timestamp: new Date().toISOString(), actorId: principal.uid, actorRole: principal.role,
    agencyId, capability: 'tenant.manage', outcome: 'allowed', reason: 'tenant_directory.legacy_migration',
    target: { agencyId }, correlationId,
    metadata: { tenantsCreated, participantsCreated, reviewRequired, skipped },
  });
  return { status: 200, body: { data: { tenantsCreated, participantsCreated, reviewRequired, skipped }, meta: { correlationId } } };
}
