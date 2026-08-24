import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { ApiError, type ApiResponse } from './router.js';
import { routeDashboardRequest } from './dashboardRoutes.js';
import type { ApiDependencies } from './types.js';

const LIVE_OVERVIEW_TTL_MS = 30_000;
const MAX_CACHE_ENTRIES = 250;

interface CacheEntry {
  data: unknown;
  expiresAt: number;
}

const overviewCache = new Map<string, CacheEntry>();

function isOverviewRequest(req: IncomingMessage): boolean {
  if (req.method !== 'GET') return false;
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  return path === '/api/v1/dashboard/overview';
}

function agencyId(req: IncomingMessage): string {
  const value = req.headers['x-agency-id']?.toString().trim();
  if (!value) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.');
  return value;
}

function requestIdentityKey(req: IncomingMessage): string {
  const scopedAgencyId = req.headers['x-agency-id']?.toString().trim() || 'missing-agency';
  const authorisation = req.headers.authorization || '';
  const identityHash = createHash('sha256').update(authorisation).digest('hex');
  return `${scopedAgencyId}:${identityHash}:${req.url || '/api/v1/dashboard/overview'}`;
}

function responseData(response: ApiResponse): unknown | undefined {
  if (response.status !== 200 || !response.body || typeof response.body !== 'object') return undefined;
  return (response.body as { data?: unknown }).data;
}

function roleFromOverview(data: unknown): string | undefined {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  const role = (data as { role?: unknown }).role;
  return typeof role === 'string' ? role : undefined;
}

function compactCache(now: number): void {
  for (const [key, entry] of overviewCache) {
    if (entry.expiresAt <= now) overviewCache.delete(key);
  }
  while (overviewCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = overviewCache.keys().next().value as string | undefined;
    if (!oldest) break;
    overviewCache.delete(oldest);
  }
}

/**
 * Shields the live command-centre overview from repeated whole-collection scans
 * when a browser refreshes, multiple dashboard widgets render together, or a
 * user revisits the page within a short interval. The key includes a one-way
 * hash of the bearer identity because dashboard visibility is role/assignment
 * scoped. Cached responses are re-authorised on every hit and are discarded if
 * the current server-side membership role differs from the role that produced
 * the cached overview. This prevents a role downgrade from receiving stale
 * privileged dashboard data while retaining the short-lived identity cache.
 */
export async function routeCachedDashboardRequest(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
): Promise<ApiResponse | undefined> {
  if (!isOverviewRequest(req)) return routeDashboardRequest(req, dependencies, correlationId);

  const now = Date.now();
  const key = requestIdentityKey(req);
  const cached = overviewCache.get(key);
  if (cached && cached.expiresAt > now) {
    const scopedAgencyId = agencyId(req);
    const principal = await authenticateAndAuthorise(req, dependencies, 'property.read', { agencyId: scopedAgencyId }, correlationId);
    if (roleFromOverview(cached.data) === principal.role) {
      return {
        status: 200,
        body: {
          data: structuredClone(cached.data),
          meta: { correlationId, cache: { source: 'identity-scoped-memory', maxAgeSeconds: 30 } },
        },
      };
    }
    overviewCache.delete(key);
  }

  const response = await routeDashboardRequest(req, dependencies, correlationId);
  if (!response) return undefined;
  const data = responseData(response);
  if (data !== undefined) {
    compactCache(now);
    overviewCache.set(key, { data: structuredClone(data), expiresAt: now + LIVE_OVERVIEW_TTL_MS });
  }
  return response;
}
