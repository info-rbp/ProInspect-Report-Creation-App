import type { IncomingMessage } from 'node:http';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies } from './types.js';

function agencyHeader(req: IncomingMessage): string {
  const agencyId = req.headers['x-agency-id']?.toString().trim();
  if (!agencyId) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.');
  return agencyId;
}

export async function routeTenantActionSourceRequest(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string): Promise<ApiResponse | undefined> {
  const parts = new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean);
  if (req.method !== 'GET' || parts[0] !== 'api' || parts[1] !== 'v1' || parts[2] !== 'tenant-action-sources' || !parts[3]) return undefined;
  const agencyId = agencyHeader(req);
  await authenticateAndAuthorise(req, dependencies, 'tenant_instruction.manage', { agencyId }, correlationId);
  const reportId = decodeURIComponent(parts[3]);
  const aggregate = await dependencies.reports.load(agencyId, reportId);
  if (!aggregate) throw new ApiError(404, 'REPORT_NOT_FOUND', 'Source inspection report was not found.');
  if (!aggregate.report.tenancyId) throw new ApiError(409, 'REPORT_TENANCY_REQUIRED', 'Source report is not linked to a tenancy.');
  return { status: 200, body: { data: aggregate, meta: { correlationId } } };
}
