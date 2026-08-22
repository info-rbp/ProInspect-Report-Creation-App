import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthorisationTarget, DomainErrorShape, SecurityCapability } from '@pcr/domain';
import { ApiError, routeApiRequest, type ApiResponse } from './backend/router.js';
import { routeClientManagementRequest } from './backend/clientManagementRoutes.js';
import { routeReportAggregateRequest } from './backend/reportRoutes.js';
import { routeReportOperationsRequest } from './backend/reportOperationsRoutes.js';
import { routeReportLifecycleActionRequest } from './backend/reportLifecycleActionRoutes.js';
import { routeAnalysisRequest } from './backend/analysisRoutes.js';
import { routeInspectionReportRequest } from './backend/inspectionReportRoutes.js';
import { routeInspectionOperationsRequest } from './backend/inspectionOperationsRoutes.js';
import { routeShopifyIntegrationRequest } from './backend/shopifyIntegrationRoutes.js';
import { routeGoogleCalendarIntegrationRequest } from './backend/googleCalendarIntegrationRoutes.js';
import { routeXeroIntegrationRequest } from './backend/xeroIntegrationRoutes.js';
import { routePriceBookUploadRequest } from './backend/priceBookUploadRoutes.js';
import { routeMaintenanceCommercialRequest } from './backend/maintenanceCommercialRoutes.js';
import { routeMaintenanceCandidateCommercialRequest } from './backend/maintenanceCandidateCommercialRoutes.js';
import { routeMaintenanceCreateRequest } from './backend/maintenanceCreateRoutes.js';
import { routeMaintenanceActionRequest } from './backend/maintenanceActionRoutes.js';
import { routeMaintenanceRequest } from './backend/maintenanceRoutes.js';
import { routeNotificationCallbackRequest } from './backend/notificationCallbackRoutes.js';
import { routeTenantActionQueueRequest } from './backend/tenantActionQueueRoutes.js';
import { routeTenantActionSourceRequest } from './backend/tenantActionSourceRoutes.js';
import { routeTenantDocumentRequest } from './backend/tenantDocumentRoutes.js';
import { routeTenantInstructionGrantRequest } from './backend/tenantInstructionGrantRoutes.js';
import { routeTenantMigrationRequest } from './backend/tenantMigrationRoutes.js';
import { routeTenantPortalRequest } from './backend/tenantPortalRoutes.js';
import { routeTenantAutomationRequest } from './backend/tenantAutomationRoutes.js';
import { routeTenantOperationsRequest } from './backend/tenantOperationsRoutes.js';
import { routePropertyIntelligenceRequest } from './backend/propertyIntelligenceRoutes.js';
import { routePropertyDocumentRequest } from './backend/propertyDocumentRoutes.js';
import { routeCatalogueRequest } from './backend/catalogueRoutes.js';
import { routeTemplateRequest } from './backend/templateRoutes.js';
import { buildOpenApiDocument } from './backend/openapi.js';
import type { ApiDependencies } from './backend/types.js';
import { authenticateAndAuthorise, SecurityError } from './security/authoriseRequest.js';
import { createSecurityDependencies } from './security/defaultDependencies.js';
import { SlidingWindowRateLimiter } from './security/rateLimit.js';

const limiter = new SlidingWindowRateLimiter();

function send(res: ServerResponse, response: ApiResponse, correlationId: string): void {
  res.writeHead(response.status, {
    'content-type': 'application/json',
    'x-correlation-id': correlationId,
    'cache-control': 'no-store',
    ...response.headers,
  });
  res.end(JSON.stringify(response.body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>; }
  catch { throw new ApiError(400, 'INVALID_JSON', 'Request body must be valid JSON.'); }
}

function errorResponse(error: unknown, correlationId: string): ApiResponse {
  if (error instanceof SecurityError || error instanceof ApiError) {
    return { status: error.status, body: { error: { code: error.code, message: error.message, status: error.status, correlationId, ...('details' in error && error.details ? { details: error.details } : {}) } } };
  }
  if (error && typeof error === 'object') {
    const candidate = error as { status?: unknown; code?: unknown; message?: unknown; details?: unknown };
    if (typeof candidate.status === 'number' && typeof candidate.code === 'string') {
      return { status: candidate.status, body: { error: { code: candidate.code, message: typeof candidate.message === 'string' ? candidate.message : 'The request could not be completed.', status: candidate.status, correlationId, ...(candidate.details && typeof candidate.details === 'object' ? { details: candidate.details } : {}) } } };
    }
  }
  console.error(JSON.stringify({ level: 'error', message: 'api.unhandled_error', correlationId, error: error instanceof Error ? error.message : String(error) }));
  return { status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed.', status: 500, correlationId } } };
}

function reportRoute(urlValue: string | undefined): { reportId?: string; command?: string } | undefined {
  const parts = new URL(urlValue ?? '/', 'http://localhost').pathname.split('/').filter(Boolean);
  if (parts[0] !== 'api' || parts[1] !== 'v1' || parts[2] !== 'reports') return undefined;
  return { ...(parts[3] ? { reportId: parts[3] } : {}), ...(parts[4] ? { command: parts[4] } : {}) };
}

function isClientManagementRoute(urlValue: string | undefined): boolean {
  const path = new URL(urlValue ?? '/', 'http://localhost').pathname;
  return (
    path.startsWith('/api/v1/client-management/') ||
    /^\/api\/v1\/clients\/[^/]+\/documents(?:\/|$)/u.test(path) ||
    /^\/api\/v1\/maintenance-quotes\/[^/]+\/actions\/send$/u.test(path)
  );
}

export function createRequestHandler(dependencies: ApiDependencies = createSecurityDependencies()) {
  return async function requestHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const correlationId = req.headers['x-correlation-id']?.toString() ?? randomUUID();
    const rateKey = `${req.socket.remoteAddress ?? 'unknown'}:${req.url ?? '/'}`;
    if (!limiter.consume(rateKey)) { send(res, { status: 429, body: { error: { code: 'RATE_LIMITED', message: 'Too many requests.', status: 429, correlationId } } }, correlationId); return; }

    try {
      if (req.method === 'GET' && req.url === '/health') { send(res, { status: 200, body: { status: 'ok', service: 'pcr-api', version: 'v1', correlationId } }, correlationId); return; }
      if (req.method === 'GET' && req.url === '/api/v1/openapi.json') { send(res, { status: 200, body: buildOpenApiDocument() }, correlationId); return; }
      const callbackResponse = await routeNotificationCallbackRequest(req, correlationId); if (callbackResponse) { send(res, callbackResponse, correlationId); return; }
      if (req.method === 'POST' && req.url === '/v1/security/authorise') {
        const body = await readJson(req); const capability = body.capability as SecurityCapability; const target = body.target as AuthorisationTarget;
        const principal = await authenticateAndAuthorise(req, dependencies, capability, target, correlationId);
        send(res, { status: 200, body: { principal: { uid: principal.uid, agencyId: principal.agencyId, role: principal.role }, allowed: true } }, correlationId); return;
      }

      if (isClientManagementRoute(req.url)) {
        const clientManagementResponse = await routeClientManagementRequest(req, dependencies, correlationId);
        if (clientManagementResponse) { send(res, clientManagementResponse, correlationId); return; }
      }

      const reportOperationsResponse = await routeReportOperationsRequest(req, dependencies, correlationId); if (reportOperationsResponse) { send(res, reportOperationsResponse, correlationId); return; }
      const reportLifecycleResponse = await routeReportLifecycleActionRequest(req, dependencies, correlationId); if (reportLifecycleResponse) { send(res, reportLifecycleResponse, correlationId); return; }
      const shopifyResponse = await routeShopifyIntegrationRequest(req, dependencies, correlationId); if (shopifyResponse) { send(res, shopifyResponse, correlationId); return; }
      const googleCalendarResponse = await routeGoogleCalendarIntegrationRequest(req, dependencies, correlationId); if (googleCalendarResponse) { send(res, googleCalendarResponse, correlationId); return; }
      const xeroResponse = await routeXeroIntegrationRequest(req, dependencies, correlationId); if (xeroResponse) { send(res, xeroResponse, correlationId); return; }
      const inspectionOperationsResponse = await routeInspectionOperationsRequest(req, dependencies, correlationId); if (inspectionOperationsResponse) { send(res, inspectionOperationsResponse, correlationId); return; }
      const propertyIntelligenceResponse = await routePropertyIntelligenceRequest(req, dependencies, correlationId); if (propertyIntelligenceResponse) { send(res, propertyIntelligenceResponse, correlationId); return; }
      const propertyDocumentResponse = await routePropertyDocumentRequest(req, dependencies, correlationId); if (propertyDocumentResponse) { send(res, propertyDocumentResponse, correlationId); return; }
      const inspectionReportResponse = await routeInspectionReportRequest(req, dependencies, correlationId); if (inspectionReportResponse) { send(res, inspectionReportResponse, correlationId); return; }

      const specialReportRoute = reportRoute(req.url);
      if (specialReportRoute) {
        const agencyId = req.headers['x-agency-id']?.toString().trim(); if (!agencyId) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.');
        const reportResponse = await routeReportAggregateRequest(req, dependencies, correlationId, agencyId, specialReportRoute.reportId, specialReportRoute.command);
        if (reportResponse) { send(res, reportResponse, correlationId); return; }
      }

      const analysisResponse = await routeAnalysisRequest(req, dependencies, correlationId); if (analysisResponse) { send(res, analysisResponse, correlationId); return; }
      const priceBookUploadResponse = await routePriceBookUploadRequest(req, dependencies, correlationId); if (priceBookUploadResponse) { send(res, priceBookUploadResponse, correlationId); return; }
      const maintenanceCommercialResponse = await routeMaintenanceCommercialRequest(req, dependencies, correlationId); if (maintenanceCommercialResponse) { send(res, maintenanceCommercialResponse, correlationId); return; }
      const maintenanceCandidateResponse = await routeMaintenanceCandidateCommercialRequest(req, dependencies, correlationId); if (maintenanceCandidateResponse) { send(res, maintenanceCandidateResponse, correlationId); return; }
      const maintenanceCreateResponse = await routeMaintenanceCreateRequest(req, dependencies, correlationId); if (maintenanceCreateResponse) { send(res, maintenanceCreateResponse, correlationId); return; }
      const maintenanceActionResponse = await routeMaintenanceActionRequest(req, dependencies, correlationId); if (maintenanceActionResponse) { send(res, maintenanceActionResponse, correlationId); return; }
      const tenantDocumentResponse = await routeTenantDocumentRequest(req, dependencies, correlationId); if (tenantDocumentResponse) { send(res, tenantDocumentResponse, correlationId); return; }
      const tenantMigrationResponse = await routeTenantMigrationRequest(req, dependencies, correlationId); if (tenantMigrationResponse) { send(res, tenantMigrationResponse, correlationId); return; }
      const tenantActionSourceResponse = await routeTenantActionSourceRequest(req, dependencies, correlationId); if (tenantActionSourceResponse) { send(res, tenantActionSourceResponse, correlationId); return; }
      const tenantActionQueueResponse = await routeTenantActionQueueRequest(req, dependencies, correlationId); if (tenantActionQueueResponse) { send(res, tenantActionQueueResponse, correlationId); return; }
      const tenantOperationsResponse = await routeTenantOperationsRequest(req, dependencies, correlationId); if (tenantOperationsResponse) { send(res, tenantOperationsResponse, correlationId); return; }
      const tenantAutomationResponse = await routeTenantAutomationRequest(req, dependencies, correlationId); if (tenantAutomationResponse) { send(res, tenantAutomationResponse, correlationId); return; }
      const tenantPortalResponse = await routeTenantPortalRequest(req, dependencies, correlationId); if (tenantPortalResponse) { send(res, tenantPortalResponse, correlationId); return; }
      const tenantGrantResponse = await routeTenantInstructionGrantRequest(req, dependencies, correlationId); if (tenantGrantResponse) { send(res, tenantGrantResponse, correlationId); return; }
      const maintenanceResponse = await routeMaintenanceRequest(req, dependencies, correlationId); if (maintenanceResponse) { send(res, maintenanceResponse, correlationId); return; }
      const catalogueResponse = await routeCatalogueRequest(req, dependencies, correlationId); if (catalogueResponse) { send(res, catalogueResponse, correlationId); return; }
      const templateResponse = await routeTemplateRequest(req, dependencies, correlationId); if (templateResponse) { send(res, templateResponse, correlationId); return; }
      const routed = await routeApiRequest(req, res, dependencies, correlationId); if (routed) { send(res, routed, correlationId); return; }

      const error: DomainErrorShape = { code: 'NOT_FOUND', message: 'Route not found.', status: 404, correlationId };
      send(res, { status: 404, body: { error } }, correlationId);
    } catch (error) { send(res, errorResponse(error, correlationId), correlationId); }
  };
}

export const requestHandler = createRequestHandler();
