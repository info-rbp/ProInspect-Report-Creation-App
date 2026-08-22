import type { IncomingMessage } from 'node:http';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { ApiError } from './router.js';
import type { ApiDependencies } from './types.js';

function agencyHeader(req: IncomingMessage): string {
  const agencyId = req.headers['x-agency-id']?.toString().trim();
  if (!agencyId) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.');
  return agencyId;
}

/**
 * Tenancy agreements are one shared immutable artifact for every required
 * tenancy signer. Other tenancy documents may remain scoped to one tenant.
 * This preprocessor runs before the authoritative issue route and deliberately
 * does not consume the request body.
 */
export async function normalizeTenancyAgreementScope(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
): Promise<void> {
  const parts = new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean);
  if (req.method !== 'POST' || parts[0] !== 'api' || parts[1] !== 'v1' || parts[2] !== 'tenancy-documents' || !parts[3] || parts[4] !== 'issue') return;
  const agencyId = agencyHeader(req);
  const document = await dependencies.repository.get('tenancyDocuments', agencyId, parts[3]);
  if (!document || document.type !== 'tenancy_agreement' || !document.tenantId || document.immutable === true) return;
  const principal = await authenticateAndAuthorise(req, dependencies, 'tenant.document.manage', { agencyId, tenancyId: typeof document.tenancyId === 'string' ? document.tenancyId : undefined }, correlationId);
  await dependencies.repository.update(
    'tenancyDocuments',
    agencyId,
    document.id,
    { tenantId: undefined },
    Number(document.version || 1),
    principal.uid,
  );
}
