import type { AgencyOrganisationSettings, DashboardOverview, SecurityRole } from '@pcr/domain';

export type { SecurityRole, UserRole } from '@pcr/domain';
export type DashboardSectionKey = 'dashboard' | 'analytics' | 'clients' | 'properties' | 'jobs' | 'reports' | 'maintenance' | 'tenants' | 'communications' | 'compliance' | 'users' | 'templates' | 'settings';

export interface UserProfile {
  id: string;
  uid?: string;
  email: string;
  role: SecurityRole;
  status: 'active' | 'inactive' | 'archived';
  displayName?: string;
  photoURL?: string;
  agencyId?: string;
  providerId?: string;
  effectiveCapabilities?: string[];
  disabled?: boolean;
}

export interface CurrentUserWorkspace {
  id: string;
  label: string;
  role: SecurityRole;
  providerId?: string;
  agencyId?: string;
}

export interface QuickStat {
  id: string;
  label: string;
  value: number | string;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  icon?: string;
}

export interface ChartDataPoint {
  name: string;
  value: number;
  [key: string]: string | number;
}

export interface DashboardData {
  quickStats: QuickStat[];
  recentActivity: ActivityItem[];
  urgentItems: UrgentItem[];
  inspectionsByType: ChartDataPoint[];
  inspectionsByStatus: ChartDataPoint[];
  maintenanceByStatus: ChartDataPoint[];
  reportsByStatus: ChartDataPoint[];
  upcomingInspections: UpcomingInspection[];
  staffPerformance: StaffPerformance[];
}

export interface ActivityItem { id: string; type: 'inspection' | 'report' | 'maintenance' | 'user' | 'system'; title: string; description: string; timestamp: Date; user?: { name: string; avatar?: string }; metadata?: Record<string, unknown>; }
export interface UrgentItem { id: string; type: 'overdue' | 'urgent' | 'failed' | 'review'; title: string; description: string; priority: 'high' | 'medium' | 'low'; dueDate?: Date; assignedTo?: string; actionUrl?: string; }
export interface UpcomingInspection { id: string; jobId: string; propertyAddress: string; inspectionType: string; scheduledAt: Date; inspector?: { id: string; name: string }; status: string; clientName?: string; }
export interface StaffPerformance { userId: string; userName: string; role: string; inspectionsCompleted: number; reportsCompleted: number; averageCompletionTime: number; rating?: number; }

export interface DashboardViewModel extends DashboardOverview {
  source: 'snapshot' | 'legacy';
}

export type AgencySettingsViewModel = AgencyOrganisationSettings;

export interface FilterOptions { dateRange?: { start: Date; end: Date }; inspectionType?: string[]; status?: string[]; assignedTo?: string[]; clientId?: string; propertyId?: string; }
export interface PaginationState { page: number; pageSize: number; total: number; }
export interface SortState { field: string; direction: 'asc' | 'desc'; }
export interface TableColumn<T = unknown> { id: string; header: string; accessor: keyof T | ((row: T) => unknown); sortable?: boolean; width?: string; render?: (value: unknown, row: T) => React.ReactNode; }
export interface ApiResponse<T = unknown> { data?: T; error?: { code: string; message: string; details?: Record<string, unknown> }; pagination?: PaginationState; }
export interface LoadingState { isLoading: boolean; error?: Error | null; }
export interface FormState<T = Record<string, unknown>> { values: T; errors: Partial<Record<keyof T, string>>; touched: Partial<Record<keyof T, boolean>>; isSubmitting: boolean; isValid: boolean; }
export interface Notification { id: string; type: 'success' | 'error' | 'warning' | 'info'; title: string; message?: string; duration?: number; action?: { label: string; onClick: () => void }; }
