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

function routeParts(req: IncomingMessage): string[] {
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

function recordStatus(record: StoredRecord): string {
  return String(record.lifecycleStatus || record.status || '');
}

function time(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isTerminalJob(record: StoredRecord): boolean {
  return ['finalised', 'archived', 'cancelled'].includes(recordStatus(record));
}

function isTerminalMaintenance(record: StoredRecord): boolean {
  return ['closed', 'dismissed', 'cancelled', 'duplicate', 'not_actionable'].includes(recordStatus(record));
}

function isTerminalTenantAction(record: StoredRecord): boolean {
  return ['resolved', 'closed', 'cancelled', 'withdrawn'].includes(recordStatus(record));
}

function parseRange(value: string | null): DashboardRange {
  return value === 'today' || value === '7d' || value === '30d' || value === '90d' || value === 'quarter' ? value : '30d';
}

function periodStart(range: DashboardRange, now: Date): number {
  if (range === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (range === '7d') return now.getTime() - 7 * DAY_MS;
  if (range === '30d') return now.getTime() - 30 * DAY_MS;
  if (range === '90d') return now.getTime() - 90 * DAY_MS;
  return new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1).getTime();
}

function metric(key: string, label: string, value: number, deepLink?: string, severity?: DashboardMetric['severity']): DashboardMetric {
  return { key, label, value, ...(deepLink ? { deepLink } : {}), ...(severity ? { severity } : {}) };
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

function countCreated(records: StoredRecord[], start: number, end: number): number {
  return records.filter((item) => {
    const created = time(item.createdAt);
    return created !== undefined && created >= start && created < end;
  }).length;
}

function durationHours(record: StoredRecord): number | undefined {
  const start = time(record.createdAt);
  const end = time(record.finalisedAt || record.closedAt || record.completedAt || record.updatedAt);
  if (start === undefined || end === undefined || end < start) return undefined;
  return (end - start) / 3_600_000;
}

function average(values: number[]): number | undefined {
  return values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10 : undefined;
}

function percentage(part: number, total: number): number | undefined {
  return total ? Math.round((part / total) * 1000) / 10 : undefined;
}

function visibleAssignment(record: StoredRecord, role: UserRole, uid: string): boolean {
  if (role === 'inspector') return record.assignedInspectorId === uid;
  if (role === 'analyst') return record.assignedAnalystId === uid || record.ownerUid === uid;
  if (role === 'reviewer') return record.assignedReviewerId === uid;
  return true;
}

function attention(kind: DashboardAttentionItem['kind'], label: string, severity: DashboardAttentionItem['severity'], record: StoredRecord, deepLink: string): DashboardAttentionItem {
  return {
    id: `${kind}-${record.id}`,
    kind,
    label,
    severity,
    entityId: record.id,
    ...(typeof record.dueDate === 'string' ? { dueAt: record.dueDate } : typeof record.scheduledAt === 'string' ? { dueAt: record.scheduledAt } : {}),
    deepLink,
  };
}

function capacity(jobs: StoredRecord[], reports: StoredRecord[], now: number): DashboardCapacityRow[] {
  const rows = new Map<string, DashboardCapacityRow>();
  const getRow = (userId: string, role: DashboardCapacityRow['role']) => {
    const key = `${role}:${userId}`;
    const existing = rows.get(key);
    if (existing) return existing;
    const created = { userId, role, assigned: 0, overdue: 0, dueToday: 0 };
    rows.set(key, created);
    return created;
  };
  const today = new Date(now).toISOString().slice(0, 10);
  for (const job of jobs.filter((item) => !isTerminalJob(item))) {
    if (typeof job.assignedInspectorId !== 'string') continue;
    const row = getRow(job.assignedInspectorId, 'inspector');
    row.assigned += 1;
    if (String(job.scheduledAt || '').slice(0, 10) === today) row.dueToday += 1;
    const scheduled = time(job.scheduledAt);
    if (scheduled !== undefined && scheduled < now && !['inspection_started', 'photos_uploading', 'photos_uploaded'].includes(recordStatus(job))) row.overdue += 1;
  }
  for (const report of reports.filter((item) => !['finalised', 'archived', 'cancelled'].includes(recordStatus(item)))) {
    const age = durationHours(report) || 0;
    const analystId = typeof report.assignedAnalystId === 'string' ? report.assignedAnalystId : typeof report.ownerUid === 'string' ? report.ownerUid : undefined;
    if (analystId) {
      const row = getRow(analystId, 'analyst');
      row.assigned += 1;
      if (age > REPORT_SLA_HOURS) row.overdue += 1;
    }
    if (typeof report.assignedReviewerId === 'string') {
      const row = getRow(report.assignedReviewerId, 'reviewer');
      row.assigned += 1;
      if (['review_required', 'changes_requested'].includes(recordStatus(report)) && age > REPORT_SLA_HOURS) row.overdue += 1;
    }
  }
  return [...rows.values()].sort((a, b) => b.overdue - a.overdue || b.assigned - a.assigned);
}

async function buildOverview(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string): Promise<DashboardOverview> {
  const agencyId = agencyHeader(req);
  const principal = await authenticateAndAuthorise(req, dependencies, 'property.read', { agencyId }, correlationId);
  const url = new URL(req.url ?? '/', 'http://localhost');
  const range = parseRange(url.searchParams.get('range'));
  const timezone = url.searchParams.get('timezone') || 'Australia/Perth';
  const nowDate = new Date();
  const now = nowDate.getTime();
  const start = periodStart(range, nowDate);
  const previousStart = start - (now - start);

  const names = [
    'properties', 'inspectionJobs', 'reports', 'maintenanceItems', 'tenantInstructions', 'tenancies',
    'tenancyDocuments', 'clientApprovals', 'maintenanceQuotes', 'maintenanceWorkOrders',
    'integrationSyncExceptions', 'xeroSyncExceptions', 'inspectionRequests', 'recurringInspectionSchedules',
  ] as const;
  const values = await Promise.all(names.map((name) => listAll(dependencies, name, agencyId)));
  const data = Object.fromEntries(names.map((name, index) => [name, values[index]])) as Record<(typeof names)[number], StoredRecord[]>;

  const jobs = data.inspectionJobs.filter((item) => visibleAssignment(item, principal.role, principal.uid));
  const reports = data.reports.filter((item) => visibleAssignment(item, principal.role, principal.uid));
  const activeJobs = jobs.filter((item) => !isTerminalJob(item));
  const todayKey = nowDate.toISOString().slice(0, 10);
  const tomorrowKey = new Date(now + DAY_MS).toISOString().slice(0, 10);
  const jobsToday = activeJobs.filter((item) => String(item.scheduledAt || '').slice(0, 10) === todayKey);
  const jobsTomorrow = activeJobs.filter((item) => String(item.scheduledAt || '').slice(0, 10) === tomorrowKey);
  const overdueJobs = activeJobs.filter((item) => {
    const scheduled = time(item.scheduledAt);
    return scheduled !== undefined && scheduled < now && !['inspection_started', 'photos_uploading', 'photos_uploaded'].includes(recordStatus(item));
  });
  const accessUnconfirmed = activeJobs.filter((item) => !['confirmed', 'instructions_available', 'not_required'].includes(String(item.accessStatus || '')));
  const unassigned = activeJobs.filter((item) => !item.assignedInspectorId);
  const reviewReports = reports.filter((item) => ['review_required', 'changes_requested'].includes(recordStatus(item)));
  const analysisFailed = reports.filter((item) => recordStatus(item) === 'analysis_failed' || item.workflowException === 'analysis_failed');

  const openMaintenance = data.maintenanceItems.filter((item) => !isTerminalMaintenance(item));
  const urgentMaintenance = openMaintenance.filter((item) => ['urgent', 'emergency'].includes(String(item.priority || '').toLowerCase()) || ['urgent_hazard', 'emergency'].includes(String(item.safetyClassification || '')));
  const overdueMaintenance = openMaintenance.filter((item) => {
    const due = time(item.dueDate || item.targetCompletionAt || item.slaDueAt);
    return due !== undefined && due < now;
  });
  const completionReview = openMaintenance.filter((item) => ['completion_submitted', 'awaiting_verification'].includes(recordStatus(item)));

  const openActions = data.tenantInstructions.filter((item) => !isTerminalTenantAction(item));
  const overdueActions = openActions.filter((item) => { const due = time(item.dueDate); return due !== undefined && due < now; });
  const awaitingTenant = openActions.filter((item) => ['issued', 'viewed', 'awaiting_action'].includes(recordStatus(item)));
  const vacating = data.tenancies.filter((item) => ['notice_given', 'vacating'].includes(String(item.lifecycleStatus || item.status || '')));
  const expiring = data.tenancies.filter((item) => { const end = time(item.leaseEndDate); return end !== undefined && end >= now && end <= now + 30 * DAY_MS; });
  const signatureDocuments = data.tenancyDocuments.filter((item) => ['signature_required', 'partially_signed'].includes(recordStatus(item)));

  const pendingApprovals = data.clientApprovals.filter((item) => ['pending', 'requested', 'information_requested'].includes(recordStatus(item)));
  const approvalQuotes = data.maintenanceQuotes.filter((item) => ['pricing_review_required', 'internally_approved', 'ready_to_send', 'sent', 'viewed', 'information_requested'].includes(recordStatus(item)));
  const acceptedQuotes = data.maintenanceQuotes.filter((item) => ['accepted', 'converted_to_work_order', 'invoiced'].includes(recordStatus(item)));
  const openWorkOrders = data.maintenanceWorkOrders.filter((item) => !['closed', 'cancelled'].includes(recordStatus(item)));
  const integrationOpen = data.integrationSyncExceptions.filter((item) => recordStatus(item) === 'open');
  const integrationCritical = integrationOpen.filter((item) => item.severity === 'critical');
  const xeroOpen = data.xeroSyncExceptions.filter((item) => ['open', 'attention_required', 'failed'].includes(recordStatus(item)));

  const reportsFinalised = reports.filter((item) => recordStatus(item) === 'finalised' && (time(item.updatedAt) || 0) >= start);
  const maintenanceClosed = data.maintenanceItems.filter((item) => recordStatus(item) === 'closed' && (time(item.updatedAt) || 0) >= start);
  const inspectionsCompleted = jobs.filter((item) => ['inspection_submitted', 'photos_uploaded', 'analysis_queued', 'analysis_running', 'analysis_complete', 'finalised'].includes(recordStatus(item)) && (time(item.updatedAt) || 0) >= start);
  const reportDurations = reportsFinalised.map(durationHours).filter((item): item is number => item !== undefined);
  const maintenanceDurations = maintenanceClosed.map(durationHours).filter((item): item is number => item !== undefined);
  const resolvedQuotes = data.maintenanceQuotes.filter((item) => ['accepted', 'converted_to_work_order', 'invoiced', 'declined', 'expired'].includes(recordStatus(item)) && (time(item.updatedAt) || 0) >= start);
  const acceptedInPeriod = resolvedQuotes.filter((item) => ['accepted', 'converted_to_work_order', 'invoiced'].includes(recordStatus(item)));

  const isAdmin = principal.role === 'super_admin' || principal.role === 'proinspect_admin';
  const trends: Record<string, DashboardTrend> = {
    inspectionsCreated: trend(countCreated(jobs, start, now + 1), countCreated(jobs, previousStart, start)),
    reportsCreated: trend(countCreated(reports, start, now + 1), countCreated(reports, previousStart, start)),
    maintenanceCreated: trend(countCreated(data.maintenanceItems, start, now + 1), countCreated(data.maintenanceItems, previousStart, start)),
  };
  const attentionItems = [
    ...overdueJobs.slice(0, 10).map((item) => attention('inspection', 'Inspection overdue', 'critical', item, '/app/admin/jobs?tab=schedule')),
    ...accessUnconfirmed.slice(0, 10).map((item) => attention('inspection', 'Inspection access not confirmed', 'warning', item, '/app/admin/jobs?tab=schedule')),
    ...reviewReports.slice(0, 10).map((item) => attention('report', 'Report requires review', 'warning', item, '/app/admin/reports')),
    ...analysisFailed.slice(0, 10).map((item) => attention('report', 'Report analysis failed', 'critical', item, '/app/admin/reports')),
    ...urgentMaintenance.slice(0, 10).map((item) => attention('maintenance', 'Urgent maintenance requires attention', 'critical', item, '/app/admin/maintenance')),
    ...overdueActions.slice(0, 10).map((item) => attention('tenant', 'Tenant action overdue', 'warning', item, '/app/admin/tenants')),
    ...signatureDocuments.slice(0, 10).map((item) => attention('document', 'Tenancy document awaiting signature', 'warning', item, '/app/admin/tenants')),
    ...integrationCritical.slice(0, 10).map((item) => attention('integration', 'Critical integration exception', 'critical', item, '/app/admin/jobs?tab=sync')),
    ...(isAdmin ? xeroOpen.slice(0, 10).map((item) => attention('commercial', 'Xero synchronisation requires attention', 'warning', item, '/app/admin/maintenance')) : []),
  ].slice(0, 40);

  return {
    generatedAt: nowDate.toISOString(),
    range,
    timezone,
    role: principal.role,
    today: [
      metric('inspections_today', 'Inspections today', jobsToday.length, '/app/admin/jobs?tab=schedule'),
      metric('inspections_tomorrow', 'Inspections tomorrow', jobsTomorrow.length, '/app/admin/jobs?tab=schedule'),
      metric('overdue_inspections', 'Overdue inspections', overdueJobs.length, '/app/admin/jobs?tab=schedule', overdueJobs.length ? 'critical' : 'info'),
      metric('access_unconfirmed', 'Access not confirmed', accessUnconfirmed.length, '/app/admin/jobs?tab=schedule', accessUnconfirmed.length ? 'warning' : 'info'),
      metric('unassigned_jobs', 'Unassigned jobs', unassigned.length, '/app/admin/jobs?tab=assignment', unassigned.length ? 'warning' : 'info'),
      metric('reports_review', 'Reports requiring review', reviewReports.length, '/app/admin/reports', reviewReports.length ? 'warning' : 'info'),
    ],
    workQueues: [
      metric('new_intake', 'New inspection intake', data.inspectionRequests.filter((item) => ['received', 'needs_review'].includes(String(item.intakeStatus || ''))).length, '/app/admin/jobs?tab=intake'),
      metric('awaiting_booking', 'Awaiting booking', data.inspectionRequests.filter((item) => item.intakeStatus === 'awaiting_booking').length, '/app/admin/jobs?tab=intake'),
      metric('property_match', 'Property match required', data.inspectionRequests.filter((item) => item.intakeStatus === 'awaiting_property').length, '/app/admin/jobs?tab=intake'),
      metric('analysis_failed', 'Analysis failures', analysisFailed.length, '/app/admin/reports', analysisFailed.length ? 'critical' : 'info'),
      metric('critical_integration', 'Critical integration exceptions', integrationCritical.length, '/app/admin/jobs?tab=sync', integrationCritical.length ? 'critical' : 'info'),
      metric('recurring_due', 'Recurring inspections due in 30 days', data.recurringInspectionSchedules.filter((item) => { const due = time(item.nextDueAt); return item.paused !== true && due !== undefined && due <= now + 30 * DAY_MS; }).length, '/app/admin/jobs?tab=recurring'),
    ],
    portfolio: [
      metric('properties', 'Active properties', data.properties.filter((item) => recordStatus(item) !== 'archived').length, '/app/admin/properties'),
      metric('active_jobs', 'Active inspection jobs', activeJobs.length, '/app/admin/jobs'),
      metric('draft_reports', 'Draft reports', reports.filter((item) => recordStatus(item) === 'draft').length, '/app/admin/reports'),
      metric('finalised_reports', 'Finalised reports', data.reports.filter((item) => recordStatus(item) === 'finalised').length, '/app/admin/reports'),
    ],
    tenants: [
      metric('vacating', 'Vacating tenancies', vacating.length, '/app/admin/tenants'),
      metric('tenancy_expiry', 'Tenancies expiring in 30 days', expiring.length, '/app/admin/tenants', expiring.length ? 'warning' : 'info'),
      metric('awaiting_tenant', 'Awaiting tenant action', awaitingTenant.length, '/app/admin/tenants'),
      metric('tenant_overdue', 'Overdue tenant actions', overdueActions.length, '/app/admin/tenants', overdueActions.length ? 'warning' : 'info'),
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
      quoteValueAwaitingApproval: Math.round(approvalQuotes.reduce((sum, item) => sum + Number(item.total || 0), 0) * 100) / 100,
      acceptedQuoteValue: Math.round(acceptedQuotes.reduce((sum, item) => sum + Number(item.total || 0), 0) * 100) / 100,
      workOrdersInProgress: openWorkOrders.length,
      xeroExceptions: xeroOpen.length,
    } } : {}),
    performance: {
      inspectionsCompleted: inspectionsCompleted.length,
      reportsFinalised: reportsFinalised.length,
      maintenanceClosed: maintenanceClosed.length,
      averageReportTurnaroundHours: average(reportDurations),
      averageMaintenanceTurnaroundHours: average(maintenanceDurations),
      reportSlaCompliancePercent: percentage(reportDurations.filter((hours) => hours <= REPORT_SLA_HOURS).length, reportDurations.length),
      maintenanceSlaCompliancePercent: percentage(maintenanceDurations.filter((hours) => hours <= MAINTENANCE_SLA_HOURS).length, maintenanceDurations.length),
      quoteAcceptancePercent: percentage(acceptedInPeriod.length, resolvedQuotes.length),
    },
    capacity: capacity(data.inspectionJobs, data.reports, now).filter((row) => !['inspector', 'analyst', 'reviewer'].includes(principal.role) || (row.role === principal.role && row.userId === principal.uid)),
    attention: attentionItems,
    integrations: [
      metric('integration_open', 'Open integration exceptions', integrationOpen.length, '/app/admin/jobs?tab=sync', integrationOpen.length ? 'warning' : 'info'),
      ...(isAdmin ? [metric('xero_open', 'Xero exceptions', xeroOpen.length, '/app/admin/maintenance', xeroOpen.length ? 'warning' : 'info')] : []),
    ],
    trends,
  };
}

async function snapshot(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string): Promise<ApiResponse> {
  const agencyId = agencyHeader(req);
  const principal = await authenticateAndAuthorise(req, dependencies, 'agency.manage', { agencyId }, correlationId);
  const overview = await buildOverview(req, dependencies, correlationId);
  const metrics: Record<string, number> = {};
  for (const item of [...overview.today, ...overview.workQueues, ...overview.portfolio, ...overview.tenants, ...overview.maintenance, ...overview.integrations]) metrics[item.key] = item.value;
  const id = `dashboard-${overview.generatedAt.slice(0, 10)}`;
  const existing = await dependencies.repository.get('dashboardMetricSnapshots', agencyId, id);
  const body = { capturedAt: overview.generatedAt, metrics, createdBy: principal.uid };
  const stored = existing
    ? await dependencies.repository.update('dashboardMetricSnapshots', agencyId, id, body, Number(existing.version), principal.uid)
    : await dependencies.repository.create('dashboardMetricSnapshots', agencyId, id, body, principal.uid);
  return { status: existing ? 200 : 201, body: { data: stored, meta: { correlationId } } };
}

export async function routeDashboardRequest(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string): Promise<ApiResponse | undefined> {
  const parts = routeParts(req);
  if (parts[0] !== 'api' || parts[1] !== 'v1' || parts[2] !== 'dashboard') return undefined;
  if (parts[3] === 'overview' && req.method === 'GET') return { status: 200, body: { data: await buildOverview(req, dependencies, correlationId), meta: { correlationId } } };
  if (parts[3] === 'snapshots' && req.method === 'POST') return snapshot(req, dependencies, correlationId);
  if (parts[3] === 'snapshots' && req.method === 'GET') {
    const agencyId = agencyHeader(req);
    await authenticateAndAuthorise(req, dependencies, 'agency.read', { agencyId }, correlationId);
    const records = await listAll(dependencies, 'dashboardMetricSnapshots', agencyId);
    return { status: 200, body: { data: records.sort((a, b) => String(b.capturedAt || b.createdAt).localeCompare(String(a.capturedAt || a.createdAt))), meta: { correlationId } } };
  }
  return undefined;
}
