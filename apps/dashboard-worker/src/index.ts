import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Query, createAppwriteServerServices, loadAppwriteServerConfig } from '@pcr/appwrite-server';

type Row = Record<string, unknown> & { $id: string; agencyId?: string };

const services = createAppwriteServerServices(loadAppwriteServerConfig());
const SYSTEM_ACTOR = 'system:dashboard-worker';
const SNAPSHOT_TABLE = 'dashboard_metric_snapshots';

function snapshotId(agencyId: string, dateKey: string): string {
  return `d${createHash('sha256').update(`${agencyId}:${dateKey}`).digest('hex').slice(0, 35)}`;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function perthDateKey(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Perth', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function text(value: unknown): string { return typeof value === 'string' ? value : ''; }
function status(row: Row): string { return text(row.lifecycleStatus || row.status); }
function isOneOf(value: string, values: string[]): boolean { return values.includes(value); }
function dateValue(row: Row, ...keys: string[]): string {
  for (const key of keys) if (typeof row[key] === 'string' && row[key]) return String(row[key]);
  return '';
}

async function listRows(tableId: string, queries: string[] = []): Promise<Row[]> {
  const rows: Row[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10_000; page += 1) {
    const result = await services.tables.listRows({
      databaseId: services.databaseId,
      tableId,
      queries: [...queries, Query.limit(100), ...(cursor ? [Query.cursorAfter(cursor)] : [])],
    });
    const batch = result.rows as unknown as Row[];
    rows.push(...batch);
    if (rows.length >= result.total || batch.length === 0) return rows;
    cursor = batch.at(-1)?.$id;
    if (!cursor) throw new Error(`Appwrite ${tableId} pagination did not advance.`);
  }
  throw new Error(`Appwrite ${tableId} pagination safety limit exceeded.`);
}

function listAgencyRows(tableId: string, agencyId: string): Promise<Row[]> {
  return listRows(tableId, [Query.equal('agencyId', [agencyId])]);
}

async function metricsForAgency(agencyId: string, now = new Date()): Promise<Record<string, number>> {
  const today = perthDateKey(now);
  const tomorrow = perthDateKey(new Date(now.getTime() + 86_400_000));
  const nowMs = now.getTime();
  const thirtyDaysMs = nowMs + 30 * 86_400_000;

  const [properties, jobs, reports, maintenance, actions, tenancies, approvals, quotes, exceptions, documents, compliance, communications, routes, keys, inspectionRequests, integrationEvents, evidence] = await Promise.all([
    listAgencyRows('properties', agencyId),
    listAgencyRows('inspection_jobs', agencyId),
    listAgencyRows('reports', agencyId),
    listAgencyRows('maintenance_items', agencyId),
    listAgencyRows('tenant_instructions', agencyId),
    listAgencyRows('tenancies', agencyId),
    listAgencyRows('client_approvals', agencyId),
    listAgencyRows('maintenance_quotes', agencyId),
    listAgencyRows('integration_exceptions', agencyId),
    listAgencyRows('tenancy_documents', agencyId),
    listAgencyRows('contractor_compliance', agencyId),
    listAgencyRows('tenant_communications', agencyId),
    listAgencyRows('route_plans', agencyId),
    listAgencyRows('key_register', agencyId),
    listAgencyRows('inspection_requests', agencyId),
    listAgencyRows('integration_events', agencyId),
    listAgencyRows('evidence_files', agencyId),
  ]);

  const activeJobs = jobs.filter((row) => !isOneOf(status(row), ['finalised', 'archived', 'cancelled']));
  const jobDate = (row: Row) => dateValue(row, 'scheduledDate', 'scheduledAt').slice(0, 10);
  const openMaintenance = maintenance.filter((row) => !isOneOf(status(row), ['closed', 'dismissed', 'cancelled', 'duplicate', 'not_actionable']));
  const openActions = actions.filter((row) => !isOneOf(status(row), ['resolved', 'closed', 'cancelled', 'withdrawn']));
  const expiringTenancies = tenancies.filter((row) => {
    const parsed = Date.parse(dateValue(row, 'endDate', 'leaseEndDate'));
    return Number.isFinite(parsed) && parsed >= nowMs && parsed <= thirtyDaysMs;
  });
  const tenantAssisted = inspectionRequests.filter((row) => ['tenant', 'resident', 'remote'].some((needle) => text(row.source).toLowerCase().includes(needle)));

  return {
    properties_total: properties.length,
    inspection_jobs_active: activeJobs.length,
    inspections_today: activeJobs.filter((row) => jobDate(row) === today).length,
    inspections_tomorrow: activeJobs.filter((row) => jobDate(row) === tomorrow).length,
    inspection_jobs_unassigned: activeJobs.filter((row) => !text(row.inspectorId || row.assignedInspectorId)).length,
    reports_review_required: reports.filter((row) => isOneOf(status(row), ['review_required', 'changes_requested'])).length,
    maintenance_open: openMaintenance.length,
    maintenance_urgent: openMaintenance.filter((row) => isOneOf(text(row.priority).toLowerCase(), ['urgent', 'emergency'])).length,
    tenant_actions_open: openActions.length,
    tenancies_expiring_30d: expiringTenancies.length,
    client_approvals_pending: approvals.filter((row) => isOneOf(status(row), ['pending', 'requested', 'information_requested'])).length,
    maintenance_quotes_awaiting_approval: quotes.filter((row) => isOneOf(status(row), ['pricing_review_required', 'internally_approved', 'ready_to_send', 'sent', 'viewed', 'information_requested'])).length,
    integration_exceptions_open: exceptions.filter((row) => isOneOf(status(row), ['open', 'attention_required', 'failed'])).length,
    integration_sync_runs_failed: integrationEvents.filter((row) => isOneOf(text(row.processingStatus || row.status), ['failed', 'partially_processed'])).length,
    document_packets_awaiting_signature: documents.filter((row) => isOneOf(status(row), ['issued', 'signature_required', 'viewed', 'partially_signed'])).length,
    document_packets_completed: documents.filter((row) => isOneOf(status(row), ['completed', 'signed'])).length,
    compliance_open: compliance.filter((row) => !isOneOf(text(row.complianceState || row.status), ['compliant', 'verified', 'closed', 'expired'])).length,
    compliance_overdue: compliance.filter((row) => isOneOf(text(row.complianceState || row.status), ['expired', 'overdue', 'non_compliant'])).length,
    communications_failed: communications.filter((row) => status(row) === 'failed').length,
    route_plans_published: routes.filter((row) => isOneOf(text(row.routeState || row.status), ['published', 'active'])).length,
    keys_checked_out: keys.filter((row) => isOneOf(status(row), ['checked_out', 'issued'])).length,
    tenant_assisted_inspections_open: tenantAssisted.filter((row) => isOneOf(status(row), ['issued', 'in_progress', 'requested', 'scheduled'])).length,
    tenant_assisted_inspections_submitted: tenantAssisted.filter((row) => isOneOf(status(row), ['submitted', 'completed'])).length,
    evidence_processing_failed: evidence.filter((row) => isOneOf(text(row.processingStatus || row.status), ['failed', 'processing_failed'])).length,
  };
}

function appwriteCode(error: unknown): number | undefined {
  return error && typeof error === 'object' && 'code' in error ? Number((error as { code?: unknown }).code) : undefined;
}

async function writeSnapshot(agencyId: string, metrics: Record<string, number>, now: Date): Promise<void> {
  const rowId = snapshotId(agencyId, perthDateKey(now));
  const timestamp = now.toISOString();
  const update = {
    capturedAt: timestamp,
    timezone: 'Australia/Perth',
    source: 'scheduled-count-aggregation-appwrite-v1',
    metrics: JSON.stringify(metrics),
    updatedAt: timestamp,
    updatedBy: SYSTEM_ACTOR,
  };
  try {
    const existing = await services.tables.getRow({ databaseId: services.databaseId, tableId: SNAPSHOT_TABLE, rowId }) as unknown as Row;
    if (existing.agencyId !== agencyId) throw new Error('Dashboard snapshot ID collides across agencies.');
    await services.tables.updateRow({ databaseId: services.databaseId, tableId: SNAPSHOT_TABLE, rowId, data: { ...update, version: Number(existing.version || 1) + 1 } });
  } catch (error) {
    if (appwriteCode(error) !== 404) throw error;
    await services.tables.createRow({
      databaseId: services.databaseId,
      tableId: SNAPSHOT_TABLE,
      rowId,
      permissions: [],
      data: {
        agencyId,
        status: 'active',
        createdAt: timestamp,
        updatedAt: timestamp,
        createdBy: SYSTEM_ACTOR,
        updatedBy: SYSTEM_ACTOR,
        capturedAt: timestamp,
        timezone: 'Australia/Perth',
        source: 'scheduled-count-aggregation-appwrite-v1',
        metrics: JSON.stringify(metrics),
        version: 1,
      },
    });
  }
}

export async function captureDailyDashboardSnapshots(now = new Date()): Promise<{ agencies: number; snapshots: number; failures: number }> {
  const agencies = await listRows('agencies');
  let snapshots = 0;
  let failures = 0;
  for (const agency of agencies) {
    try {
      const metrics = await metricsForAgency(agency.$id, now);
      await writeSnapshot(agency.$id, metrics, now);
      snapshots += 1;
    } catch (error) {
      failures += 1;
      console.error(JSON.stringify({ level: 'error', message: 'dashboard.snapshot.failed', agencyId: agency.$id, error: error instanceof Error ? error.message : String(error) }));
    }
  }
  return { agencies: agencies.length, snapshots, failures };
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = new URL(req.url || '/', 'http://localhost').pathname;
  if (req.method === 'GET' && path === '/health') {
    json(res, 200, { status: 'ok', service: 'dashboard-worker', aggregation: 'appwrite-table-v1' });
    return;
  }
  if (req.method === 'POST' && path === '/tasks/daily-snapshot') {
    const result = await captureDailyDashboardSnapshots();
    json(res, result.failures ? 207 : 200, { status: result.failures ? 'partial' : 'completed', ...result });
    return;
  }
  json(res, req.method === 'POST' ? 404 : 405, { error: req.method === 'POST' ? 'Route not found.' : 'Method not allowed.' });
}

const port = Number(process.env.PORT || 8080);
createServer((req, res) => void handle(req, res)).listen(port, '0.0.0.0', () => {
  console.log(JSON.stringify({ level: 'info', message: 'dashboard-worker.listening', port }));
});
