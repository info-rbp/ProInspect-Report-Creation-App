import type { IncomingMessage } from 'node:http';
import type { IntegrationHealth, SettingsHealthItem, SettingsOverview } from '@pcr/domain';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies, StoredRecord } from './types.js';

function agencyHeader(req: IncomingMessage): string {
  const value = req.headers['x-agency-id']?.toString().trim();
  if (!value) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.');
  return value;
}
async function listAll(dependencies: ApiDependencies, collection: string, agencyId: string): Promise<StoredRecord[]> {
  const result: StoredRecord[] = []; let cursor: string | undefined;
  do { const page = await dependencies.repository.list(collection, agencyId, 100, cursor); result.push(...page.items); cursor = page.nextCursor; } while (cursor);
  return result;
}
function connectionHealth(provider: string, connection: StoredRecord | undefined, exceptions: StoredRecord[]): IntegrationHealth {
  const open = exceptions.filter((item) => ['open','failed','attention_required'].includes(String(item.status)) && (!item.provider || item.provider === provider));
  const connected = connection?.status === 'connected';
  const status: IntegrationHealth['status'] = !connection ? 'not_configured' : open.some((item) => item.severity === 'critical') ? 'error' : open.length ? 'warning' : connected ? 'healthy' : 'warning';
  const accountLabel = typeof connection?.externalAccountLabel === 'string' ? connection.externalAccountLabel : typeof connection?.tenantName === 'string' ? connection.tenantName : typeof connection?.provider === 'string' ? connection.provider : undefined;
  const lastError = typeof connection?.lastErrorMessage === 'string' ? connection.lastErrorMessage : typeof connection?.lastError === 'string' ? connection.lastError : open[0] && typeof open[0].detail === 'string' ? open[0].detail : undefined;
  return { provider, status, accountLabel, connectedAt: typeof connection?.connectedAt === 'string' ? connection.connectedAt : undefined, lastSuccessfulSyncAt: typeof connection?.lastSuccessfulSyncAt === 'string' ? connection.lastSuccessfulSyncAt : undefined, lastAttemptedSyncAt: typeof connection?.lastAttemptedSyncAt === 'string' ? connection.lastAttemptedSyncAt : undefined, openExceptionCount: open.length, lastError };
}

export async function routeSettingsOverviewRequest(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string): Promise<ApiResponse | undefined> {
  const route = new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean);
  if (route[0] !== 'api' || route[1] !== 'v1' || route[2] !== 'settings' || !['overview', 'integrations'].includes(route[3] || '')) return undefined;
  if (req.method !== 'GET') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Settings overview is read-only.');
  const agencyId = agencyHeader(req);
  const principal = await authenticateAndAuthorise(req, dependencies, route[3] === 'integrations' ? 'integration.read' : 'settings.read', { agencyId }, correlationId);
  const [settings, branding, connections, pmsConnections, syncExceptions, syncRuns] = await Promise.all([
    listAll(dependencies, 'agencySettings', agencyId),
    listAll(dependencies, 'brandingProfiles', agencyId),
    listAll(dependencies, 'integrationConnections', agencyId),
    listAll(dependencies, 'pmsConnections', agencyId),
    listAll(dependencies, 'integrationSyncExceptions', agencyId),
    listAll(dependencies, 'integrationSyncRuns', agencyId),
  ]);
  const find = (provider: string) => connections.find((item) => item.id === provider || item.provider === provider);
  const pmsFailures: StoredRecord[] = syncRuns.filter((item) => item.status === 'failed').map((item) => ({ ...item, detail: item.error || item.failureReason }));
  const integrations: IntegrationHealth[] = [
    connectionHealth('shopify', find('shopify'), syncExceptions),
    connectionHealth('google_calendar', find('google_calendar'), syncExceptions),
    ...pmsConnections.map((connection) => connectionHealth(String(connection.provider || 'pms'), connection, pmsFailures)),
  ];
  if (route[3] === 'integrations') return { status: 200, body: { data: integrations, meta: { actor: principal.uid, correlationId } } };
  const has = (id: string) => settings.some((item) => item.id === id);
  const activeBranding = branding.some((item) => item.status === 'active');
  const missingItems = [
    !has('organisation') ? 'Organisation profile is not configured' : '',
    !activeBranding ? 'No active branding profile' : '',
    !has('operational') ? 'Inspection operational defaults are not configured' : '',
    !has('communications') ? 'Communication policy is not configured' : '',
    !has('maintenance') ? 'Maintenance policy is not configured' : '',
    ...integrations.filter((item) => item.status === 'not_configured').map((item) => `${item.provider} is not configured`),
  ].filter(Boolean);
  const configuredChecks = Math.max(7, 5 + integrations.length);
  const completionPercent = Math.max(0, Math.round(((configuredChecks - missingItems.length) / configuredChecks) * 100));
  const checkedAt = new Date().toISOString();
  const health: SettingsHealthItem[] = [
    { key: 'api', label: 'API', status: 'healthy', detail: 'Settings API is responding', checkedAt },
    { key: 'configuration', label: 'Configuration', status: missingItems.length ? 'warning' : 'healthy', detail: `${completionPercent}% complete`, checkedAt },
    { key: 'integrations', label: 'Integrations', status: integrations.some((item) => item.status === 'error') ? 'error' : integrations.some((item) => item.status !== 'healthy') ? 'warning' : 'healthy', detail: `${integrations.reduce((sum, item) => sum + item.openExceptionCount, 0)} open exception(s)`, checkedAt },
  ];
  const data: SettingsOverview = { completionPercent, missingItems, health, integrations };
  return { status: 200, body: { data, meta: { actor: principal.uid, correlationId } } };
}
