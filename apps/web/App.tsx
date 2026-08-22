import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import AuthRedirect from './components/auth/AuthRedirect';
import ProtectedRoute from './components/auth/ProtectedRoute';
import RoleProtectedRoute from './components/auth/RoleProtectedRoute';
import AppShell from './components/layout/AppShell';
import NotFound from './components/layout/NotFound';
import { AuthProvider } from './contexts/AuthContext';
import DashboardPage from './pages/DashboardPage';
import LoginRoutePage from './pages/LoginRoutePage';
import AdminHomePage from './pages/admin/AdminHomePage';
import ClientBulkImportPage from './pages/admin/ClientBulkImportPage';
import ClientOnboardingPage from './pages/admin/ClientOnboardingPage';
import ClientWorkspacePage from './pages/admin/ClientWorkspacePage';
import ClientsPage from './pages/admin/ClientsPage';
import InspectionJobConsolePage from './pages/admin/InspectionJobConsolePage';
import InspectionJobsPage from './pages/admin/InspectionJobsPage';
import InspectionOperationsConfigurationPage from './pages/admin/InspectionOperationsConfigurationPage';
import InspectionPlannerPage from './pages/admin/InspectionPlannerPage';
import PropertiesPage from './pages/admin/PropertiesPage';
import PropertyBulkImportPage from './pages/admin/PropertyBulkImportPage';
import PropertyOnboardingPage from './pages/admin/PropertyOnboardingPage';
import PropertyDetailWithHistoryPage from './pages/admin/PropertyDetailWithHistoryPage';
import ReportDetailPage from './pages/admin/ReportDetailPage';
import ReportsPage from './pages/admin/ReportsPage';
import SettingsPage from './pages/admin/SettingsPage';
import TemplatesPage from './pages/admin/TemplatesPage';
import UsersPage from './pages/admin/UsersPage';
import UserWorkspacePage from './pages/admin/UserWorkspacePage';
import MaintenancePage from './pages/admin/MaintenancePage';
import MaintenanceConfigurationPage from './pages/admin/MaintenanceConfigurationPage';
import MaintenanceItemConsolePage from './pages/admin/MaintenanceItemConsolePage';
import TenantFollowUpPage from './pages/admin/TenantFollowUpPage';
import TenantsPage from './pages/admin/TenantsPage';
import TenantWorkspacePage from './pages/admin/TenantWorkspacePage';
import TenantPortalAccessPage from './pages/admin/TenantPortalAccessPage';
import DocumentOperationsPage from './pages/admin/DocumentOperationsPage';
import CommunicationsPage from './pages/admin/CommunicationsPage';
import CompliancePage from './pages/admin/CompliancePage';
import KeyRegisterPage from './pages/admin/KeyRegisterPage';
import IntegrationConnectionsPage from './pages/admin/IntegrationConnectionsPage';
import ExternalWorkRequestPage from './pages/external/ExternalWorkRequestPage';
import ExternalTenantInstructionPage from './pages/external/ExternalTenantInstructionPage';
import ExternalClientApprovalPage from './pages/external/ExternalClientApprovalPage';
import ExternalMaintenanceQuotePage from './pages/external/ExternalMaintenanceQuotePage';
import TenantPortalPage from './pages/external/TenantPortalPage';
import ClientPortalPage from './pages/external/ClientPortalPage';
import RemoteInspectionPage from './pages/external/RemoteInspectionPage';
import ReportRecipientPortalPage from './pages/external/ReportRecipientPortalPage';
import ReportEditWithLegacyBaselinePage from './pages/reports/ReportEditWithLegacyBaselinePage';
import ReportPreviewPage from './pages/reports/ReportPreviewPage';

const App: React.FC = () => (
  <AuthProvider><BrowserRouter><Routes>
    <Route path="/" element={<AuthRedirect />} /><Route path="/auth/login" element={<LoginRoutePage />} />
    <Route path="/external/work-request/:grantToken" element={<ExternalWorkRequestPage />} /><Route path="/external/tenant-instruction/:grantToken" element={<ExternalTenantInstructionPage />} /><Route path="/tenant-portal/:grantToken" element={<TenantPortalPage />} /><Route path="/tenant-portal/:grantToken/inspection/:assignmentId" element={<RemoteInspectionPage />} /><Route path="/external/client-approval/:grantToken" element={<ExternalClientApprovalPage />} /><Route path="/external/maintenance-quote/:grantToken" element={<ExternalMaintenanceQuotePage />} /><Route path="/report-access/:grantToken" element={<ReportRecipientPortalPage />} />
    <Route element={<ProtectedRoute />}><Route path="/client-portal/:clientAccountId" element={<ClientPortalPage />} /></Route>
    <Route path="/app" element={<ProtectedRoute />}><Route element={<AppShell />}><Route index element={<Navigate to="/app/dashboard" replace />} />
      <Route element={<RoleProtectedRoute section="dashboard" />}><Route path="dashboard" element={<DashboardPage />} /><Route path="admin" element={<AdminHomePage />} /></Route>
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
  </Routes></BrowserRouter></AuthProvider>
);
export default App;
