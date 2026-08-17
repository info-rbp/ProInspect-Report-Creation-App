import type { IncomingMessage } from 'node:http';
import { routeExternalEvidenceRequest } from './externalEvidenceRoutes.js';
import { routeLegacyBaselineRequest } from './legacyBaselineRoutes.js';
import { routeMaintenanceReportRequest } from './maintenanceReportRoutes.js';
import { routePropertyHistoryRequest } from './propertyHistoryRoutes.js';
import type { ApiResponse } from './router.js';
import type { ApiDependencies } from './types.js';

export async function routeSpecialisedCloseoutRequest(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
): Promise<ApiResponse | undefined> {
  return (
    await routeLegacyBaselineRequest(req, dependencies, correlationId)
    ?? await routeExternalEvidenceRequest(req, dependencies, correlationId)
    ?? await routeMaintenanceReportRequest(req, dependencies, correlationId)
    ?? await routePropertyHistoryRequest(req, dependencies, correlationId)
  );
}
