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
import InspectionJobDetailPage from './pages/admin/InspectionJobDetailPage';
import InspectionJobsPage from './pages/admin/InspectionJobsPage';
import PropertiesPage from './pages/admin/PropertiesPage';
import PropertyBulkImportPage from './pages/admin/PropertyBulkImportPage';
import PropertyOnboardingPage from './pages/admin/PropertyOnboardingPage';
import PropertyDetailWithHistoryPage from './pages/admin/PropertyDetailWithHistoryPage';
import ReportDetailPage from './pages/admin/ReportDetailPage';
import ReportsPage from './pages/admin/ReportsPage';
import SettingsPage from './pages/admin/SettingsPage';
import TemplatesPage from './pages/admin/TemplatesPage';
import UsersPage from './pages/admin/UsersPage';
import MaintenancePage from './pages/admin/MaintenancePage';
import MaintenanceDetailPage from './pages/admin/MaintenanceDetailPage';
import TenantFollowUpPage from './pages/admin/TenantFollowUpPage';
import ExternalWorkRequestPage from './pages/external/ExternalWorkRequestPage';
import ExternalTenantInstructionPage from './pages/external/ExternalTenantInstructionPage';
import ExternalClientApprovalPage from './pages/external/ExternalClientApprovalPage';
import ReportEditWithLegacyBaselinePage from './pages/reports/ReportEditWithLegacyBaselinePage';
import ReportPreviewPage from './pages/reports/ReportPreviewPage';

const App: React.FC = () => (
  <AuthProvider>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AuthRedirect />} />
        <Route path="/auth/login" element={<LoginRoutePage />} />
        <Route path="/external/work-request/:grantToken" element={<ExternalWorkRequestPage />} />
        <Route path="/external/tenant-instruction/:grantToken" element={<ExternalTenantInstructionPage />} />
        <Route path="/external/client-approval/:grantToken" element={<ExternalClientApprovalPage />} />
        <Route path="/app" element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/app/dashboard" replace />} />
            <Route element={<RoleProtectedRoute section="dashboard" />}>
              <Route path="dashboard" element={<DashboardPage />} />
              <Route path="admin" element={<AdminHomePage />} />
            </Route>
            <Route element={<RoleProtectedRoute section="properties" />}>
              <Route path="admin/properties" element={<PropertiesPage />} />
              <Route path="admin/properties/new" element={<PropertyOnboardingPage />} />
              <Route path="admin/properties/import" element={<PropertyBulkImportPage />} />
              <Route path="admin/properties/:propertyId" element={<PropertyDetailWithHistoryPage />} />
            </Route>
            <Route element={<RoleProtectedRoute section="jobs" />}>
              <Route path="admin/jobs" element={<InspectionJobsPage />} />
              <Route path="admin/jobs/:jobId" element={<InspectionJobDetailPage />} />
            </Route>
            <Route element={<RoleProtectedRoute section="reports" />}>
              <Route path="admin/reports" element={<ReportsPage />} />
              <Route path="admin/reports/:reportId" element={<ReportDetailPage />} />
              <Route path="admin/reports/:reportId/edit" element={<ReportEditWithLegacyBaselinePage />} />
              <Route path="admin/reports/:reportId/preview" element={<ReportPreviewPage />} />
            </Route>
            <Route element={<RoleProtectedRoute section="maintenance" />}>
              <Route path="admin/maintenance" element={<MaintenancePage />} />
              <Route path="admin/maintenance/:maintenanceId" element={<MaintenanceDetailPage />} />
            </Route>
            <Route element={<RoleProtectedRoute section="tenant-followup" />}>
              <Route path="admin/tenant-followup" element={<TenantFollowUpPage />} />
            </Route>
            <Route element={<RoleProtectedRoute section="users" />}><Route path="admin/users" element={<UsersPage />} /></Route>
            <Route element={<RoleProtectedRoute section="templates" />}><Route path="admin/templates" element={<TemplatesPage />} /></Route>
            <Route element={<RoleProtectedRoute section="settings" />}><Route path="admin/settings" element={<SettingsPage />} /></Route>
          </Route>
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  </AuthProvider>
);
export default App;
