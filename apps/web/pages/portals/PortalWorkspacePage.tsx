import React from 'react';
import {
  Building2,
  CalendarDays,
  ClipboardCheck,
  FileText,
  HardHat,
  Home,
  KeyRound,
  LayoutDashboard,
  ListTodo,
  MessageSquare,
  PackageCheck,
  ShieldCheck,
  ShoppingBag,
  UserCog,
  Users,
  Wrench,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import type { PortalId } from '@pcr/domain';
import AccessDenied from '../../components/layout/AccessDenied';
import { useAuth } from '../../contexts/AuthContext';
import { availablePortals, canOpenPortal, portalDefinition } from '../../services/platform/portalAccess';

const ICONS = [
  LayoutDashboard, ListTodo, Building2, ClipboardCheck, Wrench, HardHat, Users,
  KeyRound, CalendarDays, FileText, MessageSquare, ShieldCheck, ShoppingBag,
  PackageCheck, UserCog, Home,
] as const;

const ADMIN_DESTINATIONS: Record<string, string> = {
  Dashboard: '/app/dashboard',
  Clients: '/app/admin/clients',
  'Properties & Sites': '/app/admin/properties',
  Inspections: '/app/admin/jobs',
  Reports: '/app/admin/reports',
  Maintenance: '/app/admin/maintenance',
  'Users & Access': '/app/admin/users',
  Integrations: '/app/admin/settings/integrations',
  Settings: '/app/admin/settings',
};

const INSPECTOR_DESTINATIONS: Record<string, string> = {
  Today: '/app/admin/jobs',
  'My Schedule': '/app/admin/jobs/planner',
  Assignments: '/app/admin/jobs',
  Reports: '/app/admin/reports',
  'Keys & Access': '/app/admin/keys',
};

function moduleDestination(portalId: PortalId, module: string): string {
  if (portalId === 'admin' && ADMIN_DESTINATIONS[module]) return ADMIN_DESTINATIONS[module];
  if (portalId === 'inspector' && INSPECTOR_DESTINATIONS[module]) return INSPECTOR_DESTINATIONS[module];
  return `/${portalId}?module=${encodeURIComponent(module)}`;
}

const styles = {
  page: { minHeight: '100vh', background: '#f7f8fa', color: '#111827' },
  header: { background: '#111827', color: '#fff', padding: '22px 28px', borderBottom: '1px solid #273244' },
  content: { maxWidth: 1440, margin: '0 auto', padding: '28px' },
  portalNav: { display: 'flex', gap: 8, flexWrap: 'wrap' as const, marginTop: 18 },
  navLink: { color: '#d1d5db', textDecoration: 'none', border: '1px solid #374151', borderRadius: 8, padding: '7px 11px', fontSize: 13 },
  navLinkActive: { color: '#111827', background: '#fff', borderColor: '#fff' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(235px, 1fr))', gap: 14 },
  card: { display: 'block', background: '#fff', color: '#111827', textDecoration: 'none', border: '1px solid #e5e7eb', borderRadius: 12, padding: 18, boxShadow: '0 1px 2px rgba(0,0,0,.04)' },
  icon: { width: 38, height: 38, borderRadius: 9, display: 'grid', placeItems: 'center', background: '#eef2ff', color: '#4338ca', marginBottom: 14 },
  panel: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 22, marginBottom: 22 },
} as const;

const PortalWorkspacePage: React.FC<{ portalId: PortalId }> = ({ portalId }) => {
  const { userProfile } = useAuth();
  const [searchParams] = useSearchParams();
  const role = userProfile?.role as string | undefined;
  const portal = portalDefinition(portalId);
  const portals = availablePortals(role);
  const selectedModule = searchParams.get('module');

  if (!canOpenPortal(role, portalId)) return <AccessDenied />;

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <div style={{ maxWidth: 1440, margin: '0 auto' }}>
          <div style={{ fontSize: 12, letterSpacing: '.09em', textTransform: 'uppercase', color: '#9ca3af' }}>ProInspect Platform</div>
          <h1 style={{ margin: '5px 0 0', fontSize: 27 }}>{portal.name}</h1>
          <p style={{ margin: '8px 0 0', maxWidth: 820, color: '#cbd5e1', lineHeight: 1.5 }}>{portal.summary}</p>
          {portals.length > 1 && (
            <nav aria-label="Portal switcher" style={styles.portalNav}>
              {portals.map((item) => (
                <Link key={item.id} to={item.route} style={{ ...styles.navLink, ...(item.id === portalId ? styles.navLinkActive : {}) }}>
                  {item.name}
                </Link>
              ))}
            </nav>
          )}
        </div>
      </header>

      <section style={styles.content}>
        {selectedModule && (
          <div style={styles.panel}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.08em', color: '#6b7280' }}>{portal.name}</div>
                <h2 style={{ margin: '4px 0 0', fontSize: 22 }}>{selectedModule}</h2>
                <p style={{ margin: '8px 0 0', color: '#4b5563' }}>
                  This workspace uses the shared ProInspect domain, API, Appwrite permissions, audit and evidence services.
                </p>
              </div>
              <Link to={`/${portalId}`} style={{ color: '#4338ca', fontWeight: 600, textDecoration: 'none' }}>Back to portal home</Link>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'end', justifyContent: 'space-between', gap: 18, marginBottom: 16, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20 }}>{selectedModule ? 'Related workspaces' : 'Workspaces'}</h2>
            <p style={{ margin: '6px 0 0', color: '#6b7280' }}>The navigation shown here is determined by your role and current portal entitlement.</p>
          </div>
          <div style={{ color: '#6b7280', fontSize: 13 }}>Signed in as {userProfile?.displayName ?? userProfile?.email ?? role}</div>
        </div>

        <div style={styles.grid}>
          {portal.primaryNavigation.map((module, index) => {
            const Icon = ICONS[index % ICONS.length];
            return (
              <Link key={module} to={moduleDestination(portalId, module)} style={styles.card}>
                <span style={styles.icon}><Icon size={20} /></span>
                <strong style={{ display: 'block', fontSize: 15 }}>{module}</strong>
                <span style={{ display: 'block', marginTop: 7, color: '#6b7280', fontSize: 13, lineHeight: 1.45 }}>
                  Open the shared {module.toLowerCase()} capability for this portal and its permitted scope.
                </span>
              </Link>
            );
          })}
        </div>
      </section>
    </main>
  );
};

export default PortalWorkspacePage;
