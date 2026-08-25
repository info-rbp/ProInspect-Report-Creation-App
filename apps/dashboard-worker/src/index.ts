import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { FieldPath, type CollectionReference, type Query } from 'firebase-admin/firestore';
import { firestoreDb } from './firestoreDatabase.js';

function adminApp() { return getApps()[0] ?? initializeApp({ credential: applicationDefault() }); }
function database() { return firestoreDb(adminApp()); }
function json(res: ServerResponse, status: number, body: unknown): void { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); }
function perthDateKey(now = new Date()): string { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Perth', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now); const value = (type: string) => parts.find((part) => part.type === type)?.value || ''; return `${value('year')}-${value('month')}-${value('day')}`; }
async function count(query: Query): Promise<number> { const snapshot = await query.count().get(); return snapshot.data().count; }
function collection(agencyId: string, name: string): CollectionReference { return database().collection(`agencies/${agencyId}/${name}`); }

async function metricsForAgency(agencyId: string, now = new Date()): Promise<Record<string, number>> {
  const today = perthDateKey(now); const tomorrow = perthDateKey(new Date(now.getTime() + 86_400_000)); const thirtyDays = new Date(now.getTime() + 30 * 86_400_000).toISOString(); const nowIso = now.toISOString();
  const jobs = collection(agencyId, 'inspectionJobs'); const reports = collection(agencyId, 'reports'); const maintenance = collection(agencyId, 'maintenanceItems'); const actions = collection(agencyId, 'tenantInstructions'); const tenancies = collection(agencyId, 'tenancies'); const approvals = collection(agencyId, 'clientApprovals'); const quotes = collection(agencyId, 'maintenanceQuotes'); const syncExceptions = collection(agencyId, 'integrationSyncExceptions');
  const packets = collection(agencyId, 'documentPackets'); const obligations = collection(agencyId, 'complianceObligations'); const communications = collection(agencyId, 'communicationMessages'); const routePlans = collection(agencyId, 'inspectionRoutePlans'); const keys = collection(agencyId, 'accessDeviceRegister'); const remote = collection(agencyId, 'remoteInspectionAssignments'); const syncRuns = collection(agencyId, 'integrationSyncRuns'); const evidence = collection(agencyId, 'photoEvidence');

  const [propertiesTotal, activeJobs, jobsToday, jobsTomorrow, unassignedJobs, reviewReports, openMaintenance, urgentMaintenance, openTenantActions, expiringTenancies, pendingApprovals, quotesAwaitingApproval, integrationExceptions, packetsAwaitingSignature, packetsCompleted, complianceOpen, complianceOverdue, communicationsFailed, publishedRoutes, keysOut, remoteOpen, remoteSubmitted, failedSyncRuns, evidenceFailed] = await Promise.all([
    count(collection(agencyId, 'properties')),
    count(jobs.where('status', 'not-in', ['finalised', 'archived', 'cancelled'])),
    count(jobs.where('scheduledAt', '>=', `${today}T00:00:00`).where('scheduledAt', '<', `${tomorrow}T00:00:00`)),
    count(jobs.where('scheduledAt', '>=', `${tomorrow}T00:00:00`).where('scheduledAt', '<', new Date(now.getTime() + 2 * 86_400_000).toISOString().slice(0, 10) + 'T00:00:00')),
    count(jobs.where('assignedInspectorId', '==', null).where('status', 'not-in', ['finalised', 'archived', 'cancelled'])),
    count(reports.where('status', 'in', ['review_required', 'changes_requested'])),
    count(maintenance.where('status', 'not-in', ['closed', 'dismissed', 'cancelled', 'duplicate', 'not_actionable'])),
    count(maintenance.where('priority', 'in', ['urgent', 'emergency'])),
    count(actions.where('status', 'not-in', ['resolved', 'closed', 'cancelled', 'withdrawn'])),
    count(tenancies.where('leaseEndDate', '>=', nowIso).where('leaseEndDate', '<=', thirtyDays)),
    count(approvals.where('status', 'in', ['pending', 'requested', 'information_requested'])),
    count(quotes.where('status', 'in', ['pricing_review_required', 'internally_approved', 'ready_to_send', 'sent', 'viewed', 'information_requested'])),
    count(syncExceptions.where('status', '==', 'open')),
    count(packets.where('status', 'in', ['issued', 'viewed', 'partially_signed'])),
    count(packets.where('status', '==', 'completed')),
    count(obligations.where('status', '==', 'open')),
    count(obligations.where('status', '==', 'overdue')),
    count(communications.where('status', '==', 'failed')),
    count(routePlans.where('status', '==', 'published')),
    count(keys.where('status', '==', 'checked_out')),
    count(remote.where('status', 'in', ['issued', 'in_progress'])),
    count(remote.where('status', '==', 'submitted')),
    count(syncRuns.where('status', '==', 'failed')),
    count(evidence.where('processingStatus', '==', 'failed')),
  ]);

  return {
    properties_total: propertiesTotal,
    inspection_jobs_active: activeJobs,
    inspections_today: jobsToday,
    inspections_tomorrow: jobsTomorrow,
    inspection_jobs_unassigned: unassignedJobs,
    reports_review_required: reviewReports,
    maintenance_open: openMaintenance,
    maintenance_urgent: urgentMaintenance,
    tenant_actions_open: openTenantActions,
    tenancies_expiring_30d: expiringTenancies,
    client_approvals_pending: pendingApprovals,
    maintenance_quotes_awaiting_approval: quotesAwaitingApproval,
    integration_exceptions_open: integrationExceptions,
    integration_sync_runs_failed: failedSyncRuns,
    document_packets_awaiting_signature: packetsAwaitingSignature,
    document_packets_completed: packetsCompleted,
    compliance_open: complianceOpen,
    compliance_overdue: complianceOverdue,
    communications_failed: communicationsFailed,
    route_plans_published: publishedRoutes,
    keys_checked_out: keysOut,
    tenant_assisted_inspections_open: remoteOpen,
    tenant_assisted_inspections_submitted: remoteSubmitted,
    evidence_processing_failed: evidenceFailed,
  };
}

export async function captureDailyDashboardSnapshots(now = new Date()): Promise<{ agencies: number; snapshots: number; failures: number }> {
  const agencies = await database().collection('agencies').select(FieldPath.documentId()).get(); let snapshots = 0; let failures = 0;
  for (const agency of agencies.docs) {
    try { const metrics = await metricsForAgency(agency.id, now); const dateKey = perthDateKey(now); await database().doc(`agencies/${agency.id}/dashboardMetricSnapshots/dashboard-${dateKey}`).set({ id: `dashboard-${dateKey}`, agencyId: agency.id, capturedAt: now.toISOString(), timezone: 'Australia/Perth', source: 'scheduled-count-aggregation-v2', metrics, createdBy: 'system:dashboard-worker', updatedAt: now.toISOString(), version: 2 }, { merge: true }); snapshots += 1; }
    catch (error) { failures += 1; console.error(JSON.stringify({ level: 'error', message: 'dashboard.snapshot.failed', agencyId: agency.id, error: error instanceof Error ? error.message : String(error) })); }
  }
  return { agencies: agencies.size, snapshots, failures };
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> { const path = new URL(req.url || '/', 'http://localhost').pathname; if (req.method === 'GET' && path === '/health') { json(res, 200, { status: 'ok', service: 'dashboard-worker', aggregation: 'firestore-count-v2' }); return; } if (req.method === 'POST' && path === '/tasks/daily-snapshot') { const result = await captureDailyDashboardSnapshots(); json(res, result.failures ? 207 : 200, { status: result.failures ? 'partial' : 'completed', ...result }); return; } json(res, req.method === 'POST' ? 404 : 405, { error: req.method === 'POST' ? 'Route not found.' : 'Method not allowed.' }); }
const port = Number(process.env.PORT || 8080); createServer((req, res) => void handle(req, res)).listen(port, '0.0.0.0', () => { console.log(JSON.stringify({ level: 'info', message: 'dashboard-worker.listening', port })); });
