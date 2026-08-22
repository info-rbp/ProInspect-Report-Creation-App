import type { UserRole } from './platform.js';

export type DashboardRange = 'today' | '7d' | '30d' | '90d' | 'quarter';
export type DashboardSeverity = 'info' | 'warning' | 'critical';
export type DashboardTrendDirection = 'up' | 'down' | 'flat';

export interface DashboardTrend {
  direction: DashboardTrendDirection;
  current: number;
  previous: number;
  change: number;
  changePercent?: number;
}

export interface DashboardMetric {
  key: string;
  label: string;
  value: number;
  severity?: DashboardSeverity;
  deepLink?: string;
  oldestItemAt?: string;
  slaBreached?: number;
  trend?: DashboardTrend;
}

export interface DashboardAttentionItem {
  id: string;
  kind:
    | 'inspection'
    | 'report'
    | 'maintenance'
    | 'approval'
    | 'tenant'
    | 'document'
    | 'tenancy'
    | 'integration'
    | 'commercial';
  label: string;
  severity: DashboardSeverity;
  dueAt?: string;
  entityType?: string;
  entityId?: string;
  deepLink?: string;
}

export interface DashboardPerformance {
  inspectionsCompleted: number;
  reportsFinalised: number;
  maintenanceClosed: number;
  averageReportTurnaroundHours?: number;
  averageMaintenanceTurnaroundHours?: number;
  reportSlaCompliancePercent?: number;
  maintenanceSlaCompliancePercent?: number;
  quoteAcceptancePercent?: number;
}

export interface DashboardCapacityRow {
  userId: string;
  role: 'inspector' | 'analyst' | 'reviewer';
  assigned: number;
  overdue: number;
  dueToday: number;
}

export interface DashboardCommercial {
  quotesAwaitingApproval: number;
  quoteValueAwaitingApproval: number;
  acceptedQuoteValue: number;
  workOrdersInProgress: number;
  integrationExceptions: number;
}

export interface DashboardSnapshot {
  id: string;
  agencyId: string;
  capturedAt: string;
  metrics: Record<string, number>;
  createdBy: string;
}

export interface DashboardOverview {
  generatedAt: string;
  range: DashboardRange;
  timezone: string;
  role: UserRole;
  today: DashboardMetric[];
  workQueues: DashboardMetric[];
  portfolio: DashboardMetric[];
  tenants: DashboardMetric[];
  maintenance: DashboardMetric[];
  commercial?: DashboardCommercial;
  performance: DashboardPerformance;
  capacity: DashboardCapacityRow[];
  attention: DashboardAttentionItem[];
  integrations: DashboardMetric[];
  trends: Record<string, DashboardTrend>;
}
