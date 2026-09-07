import type { IncomingMessage } from 'node:http';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies } from './types.js';

function parts(req: IncomingMessage): string[] { return new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean); }
function agencyId(req: IncomingMessage): string { const value = req.headers['x-agency-id']?.toString().trim(); if (!value) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.'); return value; }

export async function routeClientPortalCatalogueRequest(req: IncomingMessage, deps: ApiDependencies, correlationId: string): Promise<ApiResponse | undefined> {
  const route = parts(req); if (route[0] !== 'api' || route[1] !== 'v1' || route[2] !== 'client-portal' || !route[3] || route[4] !== 'service-definitions') return undefined;
  if (req.method !== 'GET') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Service definitions are read-only in the Client Portal.');
  const agency = agencyId(req); const clientAccountId = route[3]; await authenticateAndAuthorise(req, deps, 'client.portal.read', { agencyId: agency, clientAccountId }, correlationId);
  const rows = (await deps.repository.list('serviceDefinitions', agency, 100, undefined, { status: 'active' })).items;
  return { status: 200, body: { data: rows.map((item) => ({ id: item.id, code: item.code, name: item.name, category: item.category, workflowType: item.workflowType, description: item.description })), meta: { correlationId } } };
}
