import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import AuthRedirect from './components/auth/AuthRedirect';
import ProtectedRoute from './components/auth/ProtectedRoute';
import RoleProtectedRoute from './components/auth/RoleProtectedRoute';
import AppShell from './components/layout/AppShell';
import NotFound from './components/layout/NotFound';
import { AuthProvider } from './contexts/AuthContext';
import DashboardPage from './pages/DashboardPage';
import LoginRoutePage from './pages/LoginRoutePage';

const AdminHomePage = lazy(() => import('./pages/admin/AdminHomePage'));
const AnalyticsPage = lazy(() => import('./pages/admin/AnalyticsPage'));
const ClientBulkImportPage = lazy(() => import('./pages/admin/ClientBulkImportPage'));
const ClientOnboardingPage = lazy(() => import('./pages/admin/ClientOnboardingPage'));
const ClientWorkspacePage = lazy(() => import('./pages/admin/ClientWorkspacePage'));
const ClientsPage = lazy(() => import('./pages/admin/ClientsPage'));
const InspectionJobConsolePage = lazy(() => import('./pages/admin/InspectionJobConsolePage'));
const InspectionJobsPage = lazy(() => import('./pages/admin/InspectionJobsPage'));
const InspectionOperationsConfigurationPage = lazy(() => import('./pages/admin/InspectionOperationsConfigurationPage'));
const InspectionPlannerPage = lazy(() => import('./pages/admin/InspectionPlannerPage'));
const PropertiesPage = lazy(() => import('./pages/admin/PropertiesPage'));
const PropertyBulkImportPage = lazy(() => import('./pages/admin/PropertyBulkImportPage'));
const PropertyOnboardingPage = lazy(() => import('./pages/admin/PropertyOnboardingPage'));
const PropertyDetailWithHistoryPage = lazy(() => import('./pages/admin/PropertyDetailWithHistoryPage'));
const ReportDetailPage = lazy(() => import('./pages/admin/ReportDetailPage'));
const ReportsPage = lazy(() => import('./pages/admin/ReportsPage'));
const SettingsPage = lazy(() => import('./pages/admin/SettingsPage'));
const TemplatesPage = lazy(() => import('./pages/admin/TemplatesPage'));
const UsersPage = lazy(() => import('./pages/admin/UsersPage'));
const UserWorkspacePage = lazy(() => import('./pages/admin/UserWorkspacePage'));
const MaintenancePage = lazy(() => import('./pages/admin/MaintenancePage'));
const MaintenanceConfigurationPage = lazy(() => import('./pages/admin/MaintenanceConfigurationPage'));
const MaintenanceItemConsolePage = lazy(() => import('./pages/admin/MaintenanceItemConsolePage'));
const TenantFollowUpPage = lazy(() => import('./pages/admin/TenantFollowUpPage'));
const TenantsPage = lazy(() => import('./pages/admin/TenantsPage'));
const TenantWorkspacePage = lazy(() => import('./pages/admin/TenantWorkspacePage'));
const TenantPortalAccessPage = lazy(() => import('./pages/admin/TenantPortalAccessPage'));
const DocumentOperationsPage = lazy(() => import('./pages/admin/DocumentOperationsPage'));
const CommunicationsPage = lazy(() => import('./pages/admin/CommunicationsPage'));
const CompliancePage = lazy(() => import('./pages/admin/CompliancePage'));
const KeyRegisterPage = lazy(() => import('./pages/admin/KeyRegisterPage'));
const IntegrationConnectionsPage = lazy(() => import('./pages/admin/IntegrationConnectionsPage'));
const ExternalWorkRequestPage = lazy(() => import('./pages/external/ExternalWorkRequestPage'));
const ExternalTenantInstructionPage = lazy(() => import('./pages/external/ExternalTenantInstructionPage'));
const ExternalClientApprovalPage = lazy(() => import('./pages/external/ExternalClientApprovalPage'));
const ExternalMaintenanceQuotePage = lazy(() => import('./pages/external/ExternalMaintenanceQuotePage'));
const TenantPortalPage = lazy(() => import('./pages/external/TenantPortalPage'));
const ClientPortalPage = lazy(() => import('./pages/external/ClientPortalPage'));
const RemoteInspectionPage = lazy(() => import('./pages/external/RemoteInspectionPage'));
const ReportRecipientPortalPage = lazy(() => import('./pages/external/ReportRecipientPortalPage'));
const ReportEditWithLegacyBaselinePage = lazy(() => import('./pages/reports/ReportEditWithLegacyBaselinePage'));
const ReportPreviewPage = lazy(() => import('./pages/reports/ReportPreviewPage'));

const RouteLoading = () => <div className="rounded-xl border border-gray-200 bg-white p-8 text-sm text-gray-500">Loading workspace…</div>;

const App: React.FC = () => (
  <AuthProvider><BrowserRouter><Suspense fallback={<RouteLoading />}><Routes>
    <Route path="/" element={<AuthRedirect />} /><Route path="/auth/login" element={<LoginRoutePage />} />
    <Route path="/external/work-request/:grantToken" element={<ExternalWorkRequestPage />} /><Route path="/external/tenant-instruction/:grantToken" element={<ExternalTenantInstructionPage />} /><Route path="/tenant-portal/:grantToken" element={<TenantPortalPage />} /><Route path="/tenant-portal/:grantToken/inspection/:assignmentId" element={<RemoteInspectionPage />} /><Route path="/external/client-approval/:grantToken" element={<ExternalClientApprovalPage />} /><Route path="/external/maintenance-quote/:grantToken" element={<ExternalMaintenanceQuotePage />} /><Route path="/report-access/:grantToken" element={<ReportRecipientPortalPage />} />
    <Route element={<ProtectedRoute />}><Route path="/client-portal/:clientAccountId" element={<ClientPortalPage />} /></Route>
    <Route path="/app" element={<ProtectedRoute />}><Route element={<AppShell />}><Route index element={<Navigate to="/app/dashboard" replace />} />
      <Route element={<RoleProtectedRoute section="dashboard" />}><Route path="dashboard" element={<DashboardPage />} /><Route path="admin" element={<AdminHomePage />} /></Route>
      <Route element={<RoleProtectedRoute section="analytics" />}><Route path="admin/analytics" element={<AnalyticsPage />} /></Route>
      <Route element={<RoleProtectedRoute section="clients" />}><Route path="admin/clients" element={<ClientsPage />} /><Route path="admin/clients/new" element={<ClientOnboardingPage />} /><Route path="admin/clients/import" element={<ClientBulkImportPage />} /><Route path="admin/clients/:clientId" element={<ClientWorkspacePage />} /></Route>
      <Route element={<RoleProtectedRoute section="properties" />}><Route path="admin/properties" element={<PropertiesPage />} /><Route path="admin/properties/new" element={<PropertyOnboardingPage />} /><Route path="admin/properties/import" element={<PropertyBulkImportPage />} /><Route path="admin/properties/:propertyId" element={<PropertyDetailWithHistoryPage />} /><Route path="admin/keys" element={<KeyRegisterPage />} /></Route>
      <Route element={<RoleProtectedRoute section="jobs" />}><Route path="admin/jobs" element={<InspectionJobsPage />} /><Route path="admin/jobs/planner" element={<InspectionPlannerPage />} /><Route path="admin/jobs/configuration" element={<InspectionOperationsConfigurationPage />} /><Route path="admin/jobs/:jobId" element={<InspectionJobConsolePage />} /></Route>
      <Route element={<RoleProtectedRoute section="reports" />}><Route path="admin/reports" element={<ReportsPage />} /><Route path="admin/reports/:reportId" element={<ReportDetailPage />} /><Route path="admin/reports/:reportId/edit" element={<ReportEditWithLegacyBaselinePage />} /><Route path="admin/reports/:reportId/preview" element={<ReportPreviewPage />} /></Route>
      <Route element={<RoleProtectedRoute section="maintenance" />}><Route path="admin/maintenance" element={<MaintenancePage />} /><Route path="admin/maintenance/configuration" element={<MaintenanceConfigurationPage />} /><Route path="admin/maintenance/:maintenanceId" element={<MaintenanceItemConsolePage />} /></Route>
      <Route element={<RoleProtectedRoute section="tenants" />}><Route path="admin/tenants" element={<TenantsPage />} /><Route path="admin/tenants/actions" element={<TenantFollowUpPage />} /><Route path="admin/tenants/documents" element={<DocumentOperationsPage />} /><Route path="admin/tenants/:tenantId/portal" element={<TenantPortalAccessPage />} /><Route path="admin/tenants/:tenantId" element={<TenantWorkspacePage />} /><Route path="admin/tenant-followup" element={<Navigate to="/app/admin/tenants/actions" replace />} /></Route>
      <Route element={<RoleProtectedRoute section="communications" />}><Route path="admin/communications" element={<CommunicationsPage />} /></Route>
      <Route element={<RoleProtectedRoute section="compliance" />}><Route path="admin/compliance" element={<CompliancePage />} /></Route>
      <Route element={<RoleProtectedRoute section="users" />}><Route path="admin/users" element={<UsersPage />} /><Route path="admin/users/:userId" element={<UserWorkspacePage />} /></Route>
      <Route element={<RoleProtectedRoute section="templates" />}><Route path="admin/templates" element={<TemplatesPage />} /></Route>
      <Route element={<RoleProtectedRoute section="settings" />}><Route path="admin/settings" element={<SettingsPage />} /><Route path="admin/settings/integrations" element={<IntegrationConnectionsPage />} /></Route>
    </Route></Route><Route path="*" element={<NotFound />} />
  </Routes></Suspense></BrowserRouter></AuthProvider>
);
export default App;
