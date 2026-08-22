import type { IncomingMessage } from 'node:http';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies, StoredRecord } from './types.js';

function parts(req: IncomingMessage) { return new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean); }
function agencyId(req: IncomingMessage) { const value = req.headers['x-agency-id']?.toString().trim(); if (!value) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.'); return value; }
async function listAll(deps: ApiDependencies, collection: string, agency: string): Promise<StoredRecord[]> { const out: StoredRecord[] = []; let cursor: string | undefined; do { const page = await deps.repository.list(collection, agency, 100, cursor); out.push(...page.items); cursor = page.nextCursor; } while (cursor); return out; }

export async function routeClientPortalRequest(req: IncomingMessage, deps: ApiDependencies, correlationId: string): Promise<ApiResponse | undefined> {
  const route = parts(req); if (route[0] !== 'api' || route[1] !== 'v1' || route[2] !== 'client-portal' || !route[3]) return undefined;
  const agency = agencyId(req); const clientAccountId = route[3]; const principal = await authenticateAndAuthorise(req, deps, 'client.portal.read', { agencyId: agency, clientAccountId }, correlationId);
  const client = await deps.repository.get('clients', agency, clientAccountId); if (!client) throw new ApiError(404, 'CLIENT_NOT_FOUND', 'Client account was not found.');
  if (req.method === 'GET' && route[4] === 'overview') {
    const [relationships, properties, jobs, reports, maintenance, quotes, documents, obligations] = await Promise.all([
      listAll(deps, 'propertyClientRelationships', agency), listAll(deps, 'properties', agency), listAll(deps, 'inspectionJobs', agency), listAll(deps, 'reports', agency), listAll(deps, 'maintenanceItems', agency), listAll(deps, 'maintenanceQuotes', agency), listAll(deps, 'clientDocuments', agency), listAll(deps, 'complianceObligations', agency),
    ]);
    const propertyIds = new Set(relationships.filter((item) => item.clientAccountId === clientAccountId && item.isCurrent !== false).map((item) => String(item.propertyId)));
    const visibleProperties = properties.filter((item) => propertyIds.has(item.id));
    const visibleJobs = jobs.filter((item) => propertyIds.has(String(item.propertyId || (item.propertySnapshot as Record<string, unknown> | undefined)?.propertyId || '')));
    const visibleReports = reports.filter((item) => propertyIds.has(String(item.propertyId || '')));
    const visibleMaintenance = maintenance.filter((item) => propertyIds.has(String(item.propertyId || '')));
    const maintenanceIds = new Set(visibleMaintenance.map((item) => item.id));
    const visibleQuotes = quotes.filter((item) => maintenanceIds.has(String(item.maintenanceItemId || ''))).map((item) => ({ id: item.id, maintenanceItemId: item.maintenanceItemId, status: item.status, title: item.title || item.summary, totalIncludingTax: item.totalIncludingTax || item.total, expiresAt: item.expiresAt }));
    const visibleDocuments = documents.filter((item) => item.clientAccountId === clientAccountId);
    const visibleObligations = obligations.filter((item) => propertyIds.has(String(item.entityId || '')) || item.entityId === clientAccountId);
    return { status: 200, body: { data: { client: { id: client.id, legalName: client.legalName, tradingName: client.tradingName, status: client.status }, properties: visibleProperties, inspections: visibleJobs, reports: visibleReports, maintenance: visibleMaintenance, quotes: visibleQuotes, documents: visibleDocuments, compliance: visibleObligations }, meta: { correlationId, actor: principal.uid, financialBoundary: 'No trust balances, rent ledgers, payments or disbursements are exposed.' } } };
  }
  return undefined;
}
