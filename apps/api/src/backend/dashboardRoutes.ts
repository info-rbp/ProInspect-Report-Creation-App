import { randomUUID } from 'node:crypto';
import type {
  DashboardAttentionItem,
  DashboardCapacityRow,
  DashboardMetric,
  DashboardOverview,
  DashboardRange,
  DashboardTrend,
  UserRole,
} from '@pcr/domain';
import type { IncomingMessage } from 'node:http';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies, StoredRecord } from './types.js';

const DAY_MS = 86_400_000;
const REPORT_SLA_HOURS = 48;
const MAINTENANCE_SLA_HOURS = 72;

function parts(req: IncomingMessage): string[] {
  return new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean);
}

function agencyHeader(req: IncomingMessage): string {
  const agencyId = req.headers['x-agency-id']?.toString().trim();
  if (!agencyId) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.');
  return agencyId;
}

async function listAll(dependencies: ApiDependencies, collection: string, agencyId: string): Promise<StoredRecord[]> {
  const items: StoredRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = await dependencies.repository.list(collection, agencyId, 100, cursor);
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

function asTime(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function status(record: StoredRecord): string {
  return String(record.lifecycleStatus || record.status || '');
}

function terminalJob(record: StoredRecord): boolean {
  return ['finalised', 'archived', 'cancelled'].includes(status(record));
}

function terminalMaintenance(record: StoredRecord): boolean {
  return ['closed', 'dismissed', 'cancelled', 'duplicate', 'not_actionable'].includes(status(record));
}

function terminalTenantAction(record: StoredRecord): boolean {
  return ['resolved', 'closed', 'cancelled', 'withdrawn'].includes(status(record));
}

function terminalQuote(record: StoredRecord): boolean {
  return ['declined', 'expired', 'superseded', 'cancelled', 'invoiced'].includes(status(record));
}

function rangeFrom(value: string | null): DashboardRange {
  if (value === 'today' || value === '7d' || value === '30d' || value === '90d' || value === 'quarter') return value;
  return '30d';
}

function rangeStart(range: DashboardRange, now: Date): number {
  if (range === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (range === '7d') return now.getTime() - 7 * DAY_MS;
  if (range === '30d') return now.getTime() - 30 * DAY_MS;
  if (range === '90d') return now.getTime() - 90 * DAY_MS;
  const quarter = Math.floor(now.getMonth() / 3) * 3;
  return new Date(now.getFullYear(), quarter, 1).getTime();
}

function previousRangeStart(range: DashboardRange, start: number, now: number): number {
  return start - (now - start);
}

function countCreatedWithin(records: StoredRecord[], start: number, end: number): number {
  return records.filter((item) => {
    const value = asTime(item.createdAt);
    return value !== undefined && value >= start && value < end;
  }).length;
}

function trend(current: number, previous: number): DashboardTrend {
  const change = current - previous;
  return {
    current,
    previous,
    change,
    direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
    ...(previous > 0 ? { changePercent: Math.round((change / previous) * 1000) / 10 } : {}),
  };
}

function metric(key: string, label: string, value: number, deepLink?: string, severity?: DashboardMetric['severity']): DashboardMetric {
  return { key, label, value, ...(deepLink ? { deepLink } : {}), ...(severity ? { severity } : {}) };
}

function durationHours(record: StoredRecord): number | undefined {
  const start = asTime(record.createdAt);
  const end = asTime(record.finalisedAt || record.closedAt || record.completedAt || record.updatedAt);
  if (start === undefined || end === undefined || end < start) return undefined;
  return (end - start) / 3_600_000;
}

function average(values: number[]): number | undefined {
  if (!values.length) return undefined;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function percent(part: number, total: number): number | undefined {
  if (!total) return undefined;
  return Math.round((part / total) * 1000) / 10;
}

function assignmentVisible(record: StoredRecord, role: UserRole, userId: string): boolean {
  if (role === 'inspector') return record.assignedInspectorId === userId;
  if (role === 'analyst') return record.assignedAnalystId === userId || record.ownerUid === userId;
  if (role === 'reviewer') return record.assignedReviewerId === userId;
  return true;
}

function attention(
  id: string,
  kind: DashboardAttentionItem['kind'],
  label: string,
  severity: DashboardAttentionItem['severity'],
  record: StoredRecord,
  deepLink: string,
): DashboardAttentionItem {
  return {
    id,
    kind,
    label,
    severity,
    entityId: record.id,
    dueAt: typeof record.dueDate === 'string' ? record.dueDate : typeof record.scheduledAt === 'string' ? record.scheduledAt : undefined,
    deepLink,
  };
}

function capacityRows(jobs: StoredRecord[], reports: StoredRecord[], now: number): DashboardCapacityRow[] {
  const rows = new Map<string, DashboardCapacityRow>();
  const ensure = (userId: string, role: DashboardCapacityRow['role']) => {
    const key = `${role}:${userId}`;
    if (!rows.has(key)) rows.set(key, { userId, role, assigned: 0, overdue: 0, dueToday: 0 });
    return rows.get(key)!;
  };
  const today = new Date(now).toISOString().slice(0, 10);
  for (const job of jobs.filter((item) => !terminalJob(item))) {
    const userId = typeof job.assignedInspectorId === 'string' ? job.assignedInspectorId : undefined;
    if (!userId) continue;
    const row = ensure(userId, 'inspector');
    row.assigned += 1;
    const scheduled = asTime(job.scheduledAt);
    if (scheduled !== undefined && scheduled < now && !['inspection_started', 'photos_uploading', 'photos_uploaded'].includes(status(job))) row.overdue += 1;
    if (String(job.scheduledAt || '').slice(0, 10) === today) row.dueToday += 1;
  }
  for (const report of reports.filter((item) => !['finalised', 'archived', 'cancelled'].includes(status(item)))) {
    const analystId = typeof report.assignedAnalystId === 'string' ? report.assignedAnalystId : typeof report.ownerUid === 'string' ? report.ownerUid : undefined;
    const reviewerId = typeof report.assignedReviewerId === 'string' ? report.assignedReviewerId : undefined;
    if (analystId) {
      const row = ensure(analystId, 'analyst');
      row.assigned += 1;
      if ((durationHours(report) || 0) > REPORT_SLA_HOURS) row.overdue += 1;
    }
    if (reviewerId) {
      const row = ensure(reviewerId, 'reviewer');
      row.assigned += 1;
      if (['review_required', 'changes_requested'].includes(status(report)) && (durationHours(report) || 0) > REPORT_SLA_HOURS) row.overdue += 1;
    }
  }
  return [...rows.values()].sort((a, b) => b.overdue - a.overdue || b.assigned - a.assigned);
}

async function dashboardOverview(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
): Promise<ApiResponse> {
  const agencyId = agencyHeader(req);
  const principal = await authenticateAndAuthorise(req, dependencies, 'property.read', { agencyId }, correlationId);
  const url = new URL(req.url ?? '/', 'http://localhost');
  const range = rangeFrom(url.searchParams.get('range'));
  const timezone = url.searchParams.get('timezone') || 'Australia/Perth';
  const nowDate = new Date();
  const now = nowDate.getTime();
  const start = rangeStart(range, nowDate);
  const previousStart = previousRangeStart(range, start, now);

  const [
    properties,
    allJobs,
    allReports,
    maintenanceItems,
    tenantInstructions,
    tenancies,
    tenancyDocuments,
    clientApprovals,
    maintenanceQuotes,
    maintenanceWorkOrders,
    integrationExceptions,
    xeroExceptions,
    inspectionRequests,
    recurringSchedules,
  ] = await Promise.all([
    listAll(dependencies, 'properties', agencyId),
    listAll(dependencies, 'inspectionJobs', agencyId),
    listAll(dependencies, 'reports', agencyId),
    listAll(dependencies, 'maintenanceItems', agencyId),
    listAll(dependencies, 'tenantInstructions', agencyId),
    listAll(dependencies, 'tenancies', agencyId),
    listAll(dependencies, 'tenancyDocuments', agencyId),
    listAll(dependencies, 'clientApprovals', agencyId),
    listAll(dependencies, 'maintenanceQuotes', agencyId),
    listAll(dependencies, 'maintenanceWorkOrders', agencyId),
    listAll(dependencies, 'integrationSyncExceptions', agencyId),
    listAll(dependencies, 'xeroSyncExceptions', agencyId),
    listAll(dependencies, 'inspectionRequests', agencyId),
    listAll(dependencies, 'recurringInspectionSchedules', agencyId),
  ]);

  const jobs = allJobs.filter((item) => assignmentVisible(item, principal.role, principal.uid));
  const reports = allReports.filter((item) => assignmentVisible(item, principal.role, principal.uid));
  const activeJobs = jobs.filter((item) => !terminalJob(item));
  const todayKey = nowDate.toISOString().slice(0, 10);
  const tomorrowKey = new Date(now + DAY_MS).toISOString().slice(0, 10);
  const jobsToday = activeJobs.filter((item) => String(item.scheduledAt || '').slice(0, 10) === todayKey);
  const jobsTomorrow = activeJobs.filter((item) => String(item.scheduledAt || '').slice(0, 10) === tomorrowKey);
  const overdueJobs = activeJobs.filter((item) => {
    const scheduled = asTime(item.scheduledAt);
    return scheduled !== undefined && scheduled < now && !['inspection_started', 'photos_uploading', 'photos_uploaded'].includes(status(item));
  });
  const accessUnconfirmed = activeJobs.filter((item) => !['confirmed', 'instructions_available', 'not_required'].includes(String(item.accessStatus || '')));
  const unassigned = activeJobs.filter((item) => !item.assignedInspectorId);
  const reviewReports = reports.filter((item) => ['review_required', 'changes_requested'].includes(status(item)));
  const analysisFailed = reports.filter((item) => status(item) === 'analysis_failed' || item.workflowException === 'analysis_failed');

  const openMaintenance = maintenanceItems.filter((item) => !terminalMaintenance(item));
  const urgentMaintenance = openMaintenance.filter((item) => ['urgent', 'emergency'].includes(String(item.priority || '').toLowerCase()) || ['urgent_hazard', 'emergency'].includes(String(item.safetyClassification || '')));
  const overdueMaintenance = openMaintenance.filter((item) => {
    const due = asTime(item.dueDate || item.targetCompletionAt || item.slaDueAt);
    return due !== undefined && due < now;
  });
  const completionReview = openMaintenance.filter((item) => ['completion_submitted', 'awaiting_verification'].includes(status(item)));

  const openTenantActions = tenantInstructions.filter((item) => !terminalTenantAction(item));
  const overdueTenantActions = openTenantActions.filter((item) => {
    const due = asTime(item.dueDate);
    return due !== undefined && due < now;
  });
  const awaitingTenant = openTenantActions.filter((item) => ['issued', 'viewed', 'awaiting_action'].includes(status(item)));
  const vacating = tenancies.filter((item) => ['notice_given', 'vacating'].includes(String(item.lifecycleStatus || item.status || '')));
  const expiringTenancies = tenancies.filter((item) => {
    const end = asTime(item.leaseEndDate);
    return end !== undefined && end >= now && end <= now + 30 * DAY_MS;
  });
  const signatureDocuments = tenancyDocuments.filter((item) => ['signature_required', 'partially_signed'].includes(status(item)));

  const pendingApprovals = clientApprovals.filter((item) => ['pending', 'requested', 'information_requested'].includes(status(item)));
  const approvalQuotes = maintenanceQuotes.filter((item) => ['pricing_review_required', 'internally_approved', 'ready_to_send', 'sent', 'viewed', 'information_requested'].includes(status(item)));
  const acceptedQuotes = maintenanceQuotes.filter((item) => ['accepted', 'converted_to_work_order', 'invoiced'].includes(status(item)));
  const openWorkOrders = maintenanceWorkOrders.filter((item) => !['closed', 'cancelled'].includes(status(item)));
  const openXero = xeroExceptions.filter((item) => status(item) === 'open' || status(item) === 'attention_required' || status(item) === 'failed');
  const openIntegration = integrationExceptions.filter((item) => status(item) === 'open');
  const criticalIntegration = openIntegration.filter((item) => item.severity === 'critical');

  const reportsFinalised = reports.filter((item) => status(item) === 'finalised' && (asTime(item.updatedAt) || 0) >= start);
  const maintenanceClosed = maintenanceItems.filter((item) => status(item) === 'closed' && (asTime(item.updatedAt) || 0) >= start);
  const inspectionsCompleted = jobs.filter((item) => ['inspection_submitted', 'photos_uploaded', 'analysis_queued', 'analysis_running', 'analysis_complete', 'finalised'].includes(status(item)) && (asTime(item.updatedAt) || 0) >= start);
  const reportDurations = reportsFinalised.map(durationHours).filter((value): value is number => value !== undefined);
  const maintenanceDurations = maintenanceClosed.map(durationHours).filter((value): value is number => value !== undefined);
  const acceptedCount = maintenanceQuotes.filter((item) => ['accepted', 'converted_to_work_order', 'invoiced'].includes(status(item)) && (asTime(item.updatedAt) || 0) >= start).length;
  const resolvedQuoteCount = maintenanceQuotes.filter((item) => ['accepted', 'converted_to_work_order', 'invoiced', 'declined', 'expired'].includes(status(item)) && (asTime(item.updatedAt) || 0) >= start).length;

  const currentJobsCreated = countCreatedWithin(jobs, start, now + 1);
  const previousJobsCreated = countCreatedWithin(jobs, previousStart, start);
  const currentReportsCreated = countCreatedWithin(reports, start, now + 1);
  const previousReportsCreated = countCreatedWithin(reports, previousStart, start);
  const currentMaintenanceCreated = countCreatedWithin(maintenanceItems, start, now + 1);
  const previousMaintenanceCreated = countCreatedWithin(maintenanceItems, previousStart, start);
  const trends: Record<string, DashboardTrend> = {
    inspectionsCreated: trend(currentJobsCreated, previousJobsCreated),
    reportsCreated: trend(currentReportsCreated, previousReportsCreated),
    maintenanceCreated: trend(currentMaintenanceCreated, previousMaintenanceCreated),
  };

  const attentionItems: DashboardAttentionItem[] = [
    ...overdueJobs.slice(0, 10).map((item) => attention(`job-${item.id}`, 'inspection', 'Inspection overdue', 'critical', item, '/app/admin/jobs?tab=schedule')),
    ...accessUnconfirmed.slice(0, 10).map((item) => attention(`access-${item.id}`, 'inspection', 'Inspection access not confirmed', 'warning', item, '/app/admin/jobs?tab=schedule')),
    ...reviewReports.slice(0, 10).map((item) => attention(`report-${item.id}`, 'report', 'Report requires review', 'warning', item, '/app/admin/reports')),
    ...analysisFailed.slice(0, 10).map((item) => attention(`analysis-${item.id}`, 'report', 'Report analysis failed', 'critical', item, '/app/admin/reports')),
    ...urgentMaintenance.slice(0, 10).map((item) => attention(`maintenance-${item.id}`, 'maintenance', 'Urgent maintenance requires attention', 'critical', item, '/app/admin/maintenance')),
    ...overdueTenantActions.slice(0, 10).map((item) => attention(`tenant-action-${item.id}`, 'tenant', 'Tenant action overdue', 'warning', item, '/app/admin/tenants')),
    ...signatureDocuments.slice(0, 10).map((item) => attention(`document-${item.id}`, 'document', 'Tenancy document awaiting signature', 'warning', item, '/app/admin/tenants')),
    ...criticalIntegration.slice(0, 10).map((item) => attention(`integration-${item.id}`, 'integration', 'Critical integration exception', 'critical', item, '/app/admin/jobs?tab=sync')),
    ...openXero.slice(0, 10).map((item) => attention(`xero-${item.id}`, 'commercial', 'Xero synchronisation requires attention', 'warning', item, '/app/admin/maintenance')),
  ].slice(0, 40);

  const role = principal.role;
  const isAdmin = role === 'super_admin' || role === 'proinspect_admin';
  const quoteValueAwaitingApproval = approvalQuotes.reduce((sum, item) => sum + Number(item.total || 0), 0);
  const acceptedQuoteValue = acceptedQuotes.reduce((sum, item) => sum + Number(item.total || 0), 0);
  const reportSlaCompliant = reportDurations.filter((hours) => hours <= REPORT_SLA_HOURS).length;
  const maintenanceSlaCompliant = maintenanceDurations.filter((hours) => hours <= MAINTENANCE_SLA_HOURS).length;

  const overview: DashboardOverview = {
    generatedAt: nowDate.toISOString(),
    range,
    timezone,
    role,
    today: [
      metric('inspections_today', 'Inspections today', jobsToday.length, '/app/admin/jobs?tab=schedule'),
      metric('inspections_tomorrow', 'Inspections tomorrow', jobsTomorrow.length, '/app/admin/jobs?tab=schedule'),
      metric('overdue_inspections', 'Overdue inspections', overdueJobs.length, '/app/admin/jobs?tab=schedule', overdueJobs.length ? 'critical' : 'info'),
      metric('access_unconfirmed', 'Access not confirmed', accessUnconfirmed.length, '/app/admin/jobs?tab=schedule', accessUnconfirmed.length ? 'warning' : 'info'),
      metric('unassigned_jobs', 'Unassigned jobs', unassigned.length, '/app/admin/jobs?tab=assignment', unassigned.length ? 'warning' : 'info'),
      metric('reports_review', 'Reports requiring review', reviewReports.length, '/app/admin/reports', reviewReports.length ? 'warning' : 'info'),
    ],
    workQueues: [
      metric('new_intake', 'New inspection intake', inspectionRequests.filter((item) => ['received', 'needs_review'].includes(String(item.intakeStatus || ''))).length, '/app/admin/jobs?tab=intake'),
      metric('awaiting_booking', 'Awaiting booking', inspectionRequests.filter((item) => item.intakeStatus === 'awaiting_booking').length, '/app/admin/jobs?tab=intake'),
      metric('property_match', 'Property match required', inspectionRequests.filter((item) => item.intakeStatus === 'awaiting_property').length, '/app/admin/jobs?tab=intake'),
      metric('analysis_failed', 'Analysis failures', analysisFailed.length, '/app/admin/reports', analysisFailed.length ? 'critical' : 'info'),
      metric('critical_integration', 'Critical integration exceptions', criticalIntegration.length, '/app/admin/jobs?tab=sync', criticalIntegration.length ? 'critical' : 'info'),
      metric('recurring_due', 'Recurring inspections due in 30 days', recurringSchedules.filter((item) => { const due = asTime(item.nextDueAt); return item.paused !== true && due !== undefined && due <= now + 30 * DAY_MS; }).length, '/app/admin/jobs?tab=recurring'),
    ],
    portfolio: [
      metric('properties', 'Active properties', properties.filter((item) => status(item) !== 'archived').length, '/app/admin/properties'),
      metric('active_jobs', 'Active inspection jobs', activeJobs.length, '/app/admin/jobs'),
      metric('draft_reports', 'Draft reports', reports.filter((item) => status(item) === 'draft').length, '/app/admin/reports'),
      metric('finalised_reports', 'Finalised reports', allReports.filter((item) => status(item) === 'finalised').length, '/app/admin/reports'),
    ],
    tenants: [
      metric('vacating', 'Vacating tenancies', vacating.length, '/app/admin/tenants'),
      metric('tenancy_expiry', 'Tenancies expiring in 30 days', expiringTenancies.length, '/app/admin/tenants', expiringTenancies.length ? 'warning' : 'info'),
      metric('awaiting_tenant', 'Awaiting tenant action', awaitingTenant.length, '/app/admin/tenants'),
      metric('tenant_overdue', 'Overdue tenant actions', overdueTenantActions.length, '/app/admin/tenants', overdueTenantActions.length ? 'warning' : 'info'),
      metric('document_signatures', 'Documents awaiting signature', signatureDocuments.length, '/app/admin/tenants', signatureDocuments.length ? 'warning' : 'info'),
    ],
    maintenance: [
      metric('maintenance_open', 'Open maintenance', openMaintenance.length, '/app/admin/maintenance'),
      metric('maintenance_urgent', 'Urgent maintenance', urgentMaintenance.length, '/app/admin/maintenance', urgentMaintenance.length ? 'critical' : 'info'),
      metric('maintenance_overdue', 'Overdue maintenance', overdueMaintenance.length, '/app/admin/maintenance', overdueMaintenance.length ? 'critical' : 'info'),
      metric('maintenance_verification', 'Completion awaiting verification', completionReview.length, '/app/admin/maintenance'),
      metric('approvals_pending', 'Client approvals pending', pendingApprovals.length, '/app/admin/maintenance', pendingApprovals.length ? 'warning' : 'info'),
    ],
    ...(isAdmin ? { commercial: {
      quotesAwaitingApproval: approvalQuotes.length,
      quoteValueAwaitingApproval: Math.round(quoteValueAwaitingApproval * 100) / 100,
      acceptedQuoteValue: Math.round(acceptedQuoteValue * 100) / 100,
      workOrdersInProgress: openWorkOrders.length,
      xeroExceptions: openXero.length,
    } } : {}),
    performance: {
      inspectionsCompleted: inspectionsCompleted.length,
      reportsFinalised: reportsFinalised.length,
      maintenanceClosed: maintenanceClosed.length,
      averageReportTurnaroundHours: average(reportDurations),
      averageMaintenanceTurnaroundHours: average(maintenanceDurations),
      reportSlaCompliancePercent: percent(reportSlaCompliant, reportDurations.length),
      maintenanceSlaCompliancePercent: percent(maintenanceSlaCompliant, maintenanceDurations.length),
      quoteAcceptancePercent: percent(acceptedCount, resolvedQuoteCount),
    },
    capacity: capacityRows(allJobs, allReports, now).filter((row) => {
      if (['inspector', 'analyst', 'reviewer'].includes(role)) return row.role === role && row.userId === principal.uid;
      return true;
    }),
    attention: attentionItems,
    integrations: [
      metric('integration_open', 'Open integration exceptions', openIntegration.length, '/app/admin/jobs?tab=sync', openIntegration.length ? 'warning' : 'info'),
      metric('xero_open', 'Xero exceptions', isAdmin ? openXero.length : 0, '/app/admin/maintenance', isAdmin && openXero.length ? 'warning' : 'info'),
    ].filter((item) => isAdmin || item.key !== 'xero_open'),
    trends,
  };

  return { status: 200, body: { data: overview, meta: { correlationId } } };
}

async function createSnapshot(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string): Promise<ApiResponse> {
  const agencyId = agencyHeader(req);
  const principal = await authenticateAndAuthorise(req, dependencies, 'agency.manage', { agencyId }, correlationId);
  const overviewResponse = await dashboardOverview(req, dependencies, correlationId);
  const overview = (overviewResponse.body as { data: DashboardOverview }).data;
  const metrics: Record<string, number> = {};
  for (const item of [...overview.today, ...overview.workQueues, ...overview.portfolio, ...overview.tenants, ...overview.maintenance, ...overview.integrations]) metrics[item.key] = item.value;
  const id = `dashboard-${overview.generatedAt.slice(0, 10)}`;
  const existing = await dependencies.repository.get('dashboardMetricSnapshots', agencyId, id);
  const data = { capturedAt: overview.generatedAt, metrics, createdBy: principal.uid };
  const stored = existing
    ? await dependencies.repository.update('dashboardMetricSnapshots', agencyId, id, data, Number(existing.version), principal.uid)
    : await dependencies.repository.create('dashboardMetricSnapshots', agencyId, id, data, principal.uid);
  return { status: existing ? 200 : 201, body: { data: stored, meta: { correlationId } } };
}

export async function routeDashboardRequest(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string): Promise<ApiResponse | undefined> {
  const route = parts(req);
  if (route[0] !== 'api' || route[1] !== 'v1' || route[2] !== 'dashboard') return undefined;
  if (route[3] === 'overview' && req.method === 'GET') return dashboardOverview(req, dependencies, correlationId);
  if (route[3] === 'snapshots' && req.method === 'POST') return createSnapshot(req, dependencies, correlationId);
  if (route[3] === 'snapshots' && req.method === 'GET') {
    const agencyId = agencyHeader(req);
    await authenticateAndAuthorise(req, dependencies, 'agency.read', { agencyId }, correlationId);
    const records = await listAll(dependencies, 'dashboardMetricSnapshots', agencyId);
    return { status: 200, body: { data: records.sort((a, b) => String(b.capturedAt || b.createdAt).localeCompare(String(a.capturedAt || a.createdAt))), meta: { correlationId } } };
  }
  return undefined;
}
