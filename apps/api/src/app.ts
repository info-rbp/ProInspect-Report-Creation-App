import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthorisationTarget, DomainErrorShape, SecurityCapability } from '@pcr/domain';
import { ApiError, routeApiRequest, type ApiResponse } from './backend/router.js';
import { routePeopleRequest } from './backend/peopleRoutes.js';
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
import { routeCanonicalMaintenancePricingRequest } from './backend/canonicalMaintenancePricingRoutes.js';
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
import { routePropertyHistoryRequest } from './backend/propertyHistoryRoutes.js';
import { routeCatalogueRequest } from './backend/catalogueRoutes.js';
import { routeTemplateRequest } from './backend/templateRoutes.js';
import { buildOpenApiDocument } from './backend/openapi.js';
import type { ApiDependencies } from './backend/types.js';
import { authenticateAndAuthorise, SecurityError } from './security/authoriseRequest.js';
import { createSecurityDependencies } from './security/defaultDependencies.js';
import { SlidingWindowRateLimiter } from './security/rateLimit.js';
const limiter = new SlidingWindowRateLimiter();
function send(res: ServerResponse, response: ApiResponse, correlationId: string): void { res.writeHead(response.status, { 'content-type': 'application/json', 'x-correlation-id': correlationId, 'cache-control': 'no-store', ...response.headers }); res.end(JSON.stringify(response.body)); }
async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> { const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); if (!chunks.length) return {}; try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>; } catch { throw new ApiError(400, 'INVALID_JSON', 'Request body must be valid JSON.'); } }
function errorResponse(error: unknown, correlationId: string): ApiResponse { if (error instanceof SecurityError || error instanceof ApiError) return { status: error.status, body: { error: { code: error.code, message: error.message, status: error.status, correlationId, ...('details' in error && error.details ? { details: error.details } : {}) } } }; if (error && typeof error === 'object') { const candidate = error as { status?: unknown; code?: unknown; message?: unknown; details?: unknown }; if (typeof candidate.status === 'number' && typeof candidate.code === 'string') return { status: candidate.status, body: { error: { code: candidate.code, message: typeof candidate.message === 'string' ? candidate.message : 'The request could not be completed.', status: candidate.status, correlationId, ...(candidate.details && typeof candidate.details === 'object' ? { details: candidate.details } : {}) } } }; } console.error(JSON.stringify({ level: 'error', message: 'api.unhandled_error', correlationId, error: error instanceof Error ? error.message : String(error) })); return { status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed.', status: 500, correlationId } } }; }
function reportRoute(urlValue: string | undefined): { reportId?: string; command?: string } | undefined { const parts = new URL(urlValue ?? '/', 'http://localhost').pathname.split('/').filter(Boolean); if (parts[0] !== 'api' || parts[1] !== 'v1' || parts[2] !== 'reports') return undefined; return { ...(parts[3] ? { reportId: parts[3] } : {}), ...(parts[4] ? { command: parts[4] } : {}) }; }
function isClientManagementRoute(urlValue: string | undefined): boolean { const path = new URL(urlValue ?? '/', 'http://localhost').pathname; return path.startsWith('/api/v1/client-management/') || /^\/api\/v1\/clients\/[^/]+\/documents(?:\/|$)/u.test(path) || /^\/api\/v1\/maintenance-quotes\/[^/]+\/actions\/send$/u.test(path); }
export function createRequestHandler(dependencies: ApiDependencies = createSecurityDependencies()) { return async function requestHandler(req: IncomingMessage, res: ServerResponse): Promise<void> { const correlationId = req.headers['x-correlation-id']?.toString() ?? randomUUID(); const rateKey = `${req.socket.remoteAddress ?? 'unknown'}:${req.url ?? '/'}`; if (!limiter.consume(rateKey)) { send(res, { status: 429, body: { error: { code: 'RATE_LIMITED', message: 'Too many requests.', status: 429, correlationId } } }, correlationId); return; } try { if (req.method === 'GET' && req.url === '/health') { send(res, { status: 200, body: { status: 'ok', service: 'pcr-api', version: 'v1', correlationId } }, correlationId); return; } if (req.method === 'GET' && req.url === '/api/v1/openapi.json') { send(res, { status: 200, body: buildOpenApiDocument() }, correlationId); return; } const callbackResponse = await routeNotificationCallbackRequest(req, correlationId); if (callbackResponse) { send(res, callbackResponse, correlationId); return; } if (req.method === 'POST' && req.url === '/v1/security/authorise') { const requestBody = await readJson(req); const capability = requestBody.capability as SecurityCapability; const target = requestBody.target as AuthorisationTarget; const principal = await authenticateAndAuthorise(req, dependencies, capability, target, correlationId); send(res, { status: 200, body: { principal: { uid: principal.uid, agencyId: principal.agencyId, role: principal.role }, allowed: true } }, correlationId); return; }
 const peopleResponse = await routePeopleRequest(req, dependencies, correlationId); if (peopleResponse) { send(res, peopleResponse, correlationId); return; }
 if (isClientManagementRoute(req.url)) { const r = await routeClientManagementRequest(req, dependencies, correlationId); if (r) { send(res, r, correlationId); return; } }
 const handlers = [routeReportOperationsRequest, routeReportLifecycleActionRequest, routeShopifyIntegrationRequest, routeGoogleCalendarIntegrationRequest, routeXeroIntegrationRequest, routeInspectionOperationsRequest, routePropertyIntelligenceRequest, routePropertyDocumentRequest, routePropertyHistoryRequest, routeInspectionReportRequest] as const;
 for (const handler of handlers) { const response = await handler(req, dependencies, correlationId); if (response) { send(res, response, correlationId); return; } }
 const specialReportRoute = reportRoute(req.url); if (specialReportRoute) { const agency = req.headers['x-agency-id']?.toString().trim(); if (!agency) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.'); const response = await routeReportAggregateRequest(req, dependencies, correlationId, agency, specialReportRoute.reportId, specialReportRoute.command); if (response) { send(res, response, correlationId); return; } }
 const tailHandlers = [routeAnalysisRequest, routePriceBookUploadRequest, routeCanonicalMaintenancePricingRequest, routeMaintenanceCommercialRequest, routeMaintenanceCandidateCommercialRequest, routeMaintenanceCreateRequest, routeMaintenanceActionRequest, routeTenantDocumentRequest, routeTenantMigrationRequest, routeTenantActionSourceRequest, routeTenantActionQueueRequest, routeTenantOperationsRequest, routeTenantAutomationRequest, routeTenantPortalRequest, routeTenantInstructionGrantRequest, routeMaintenanceRequest, routeCatalogueRequest, routeTemplateRequest] as const;
 for (const handler of tailHandlers) { const response = await handler(req, dependencies, correlationId); if (response) { send(res, response, correlationId); return; } }
 const routed = await routeApiRequest(req, res, dependencies, correlationId); if (routed) { send(res, routed, correlationId); return; } const error: DomainErrorShape = { code: 'NOT_FOUND', message: 'Route not found.', status: 404, correlationId }; send(res, { status: 404, body: { error } }, correlationId); } catch (error) { send(res, errorResponse(error, correlationId), correlationId); } }; }
export const requestHandler = createRequestHandler();
