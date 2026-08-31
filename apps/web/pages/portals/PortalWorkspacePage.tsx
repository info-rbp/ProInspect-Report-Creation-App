import React, { useMemo } from 'react';
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
import { contextLabel, portalContexts } from '../../services/platform/portalEntitlementService';
import { featureForLabel } from '../../services/platform/portalFeatureRegistry';

const ICONS = [
  LayoutDashboard, ListTodo, Building2, ClipboardCheck, Wrench, HardHat, Users,
  KeyRound, CalendarDays, FileText, MessageSquare, ShieldCheck, ShoppingBag,
  PackageCheck, UserCog, Home,
] as const;

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
  panel: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 18, marginBottom: 22 },
  select: { border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 10px', minWidth: 280, background: '#fff' },
} as const;

const PortalWorkspacePage: React.FC<{ portalId: PortalId }> = ({ portalId }) => {
  const { userProfile, portalEntitlements } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const role = userProfile?.role as string | undefined;
  const portal = portalDefinition(portalId);
  const portals = availablePortals(role, portalEntitlements);
  const contexts = useMemo(() => portalContexts(portalEntitlements, portalId), [portalEntitlements, portalId]);
  const selectedContext = contexts.find((item) => item.entitlementId === searchParams.get('context')) ?? contexts[0];

  if (!canOpenPortal(role, portalId, portalEntitlements)) return <AccessDenied />;

  const selectContext = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set('context', value); else next.delete('context');
    setSearchParams(next);
  };

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
        <div style={{ ...styles.panel, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <strong>Current workspace</strong>
            <div style={{ color: '#6b7280', fontSize: 13, marginTop: 4 }}>
              {selectedContext ? contextLabel(selectedContext) : portalId === 'admin' || portalId === 'inspector' ? 'Agency workspace' : 'No scoped entitlement has been selected.'}
            </div>
          </div>
          {contexts.length > 1 && <select aria-label="Portal context" value={selectedContext?.entitlementId ?? ''} onChange={(event) => selectContext(event.target.value)} style={styles.select}><option value="">Choose workspace</option>{contexts.map((item) => <option key={item.entitlementId} value={item.entitlementId}>{contextLabel(item)}</option>)}</select>}
        </div>

        <div style={{ display: 'flex', alignItems: 'end', justifyContent: 'space-between', gap: 18, marginBottom: 16, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20 }}>Workspaces</h2>
            <p style={{ margin: '6px 0 0', color: '#6b7280' }}>Each workspace uses the same canonical records, API permissions and audit trail with a role-specific view.</p>
          </div>
          <div style={{ color: '#6b7280', fontSize: 13 }}>Signed in as {userProfile?.displayName ?? userProfile?.email ?? role}</div>
        </div>

        <div style={styles.grid}>
          {portal.primaryNavigation.map((module, index) => {
            const Icon = ICONS[index % ICONS.length];
            const feature = featureForLabel(portalId, module);
            const query = selectedContext ? `?context=${encodeURIComponent(selectedContext.entitlementId)}` : '';
            const destination = feature ? `/${portalId}/${feature.slug}${query}` : `/${portalId}`;
            return (
              <Link key={module} to={destination} style={styles.card}>
                <span style={styles.icon}><Icon size={20} /></span>
                <strong style={{ display: 'block', fontSize: 15 }}>{module}</strong>
                <span style={{ display: 'block', marginTop: 7, color: '#6b7280', fontSize: 13, lineHeight: 1.45 }}>
                  {feature?.summary ?? `Open ${module.toLowerCase()} within your permitted portal scope.`}
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
