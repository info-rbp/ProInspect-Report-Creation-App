import React from 'react';
import { NavLink } from 'react-router-dom';
import { BarChart3, Building2, ClipboardList, FileSignature, FileText, Gauge, Hammer, Home, KeyRound, MessagesSquare, Route, Settings, ShieldCheck, Users, Wrench, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import type { InternalSection } from '../../services/platform/roleAccess';

interface NavItem { label: string; to: string; section: InternalSection; icon: React.ComponentType<{ size?: number }>; }
interface SidebarProps { open: boolean; onClose: () => void; }

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', to: '/app/dashboard', section: 'dashboard', icon: Gauge },
  { label: 'Analytics', to: '/app/admin/analytics', section: 'analytics', icon: BarChart3 },
  { label: 'Clients', to: '/app/admin/clients', section: 'clients', icon: Building2 },
  { label: 'Properties', to: '/app/admin/properties', section: 'properties', icon: Home },
  { label: 'Inspection Jobs', to: '/app/admin/jobs', section: 'jobs', icon: ClipboardList },
  { label: 'Inspection Planner', to: '/app/admin/jobs/planner', section: 'jobs', icon: Route },
  { label: 'Reports', to: '/app/admin/reports', section: 'reports', icon: FileText },
  { label: 'Maintenance', to: '/app/admin/maintenance', section: 'maintenance', icon: Hammer },
  { label: 'Tenants', to: '/app/admin/tenants', section: 'tenants', icon: Users },
  { label: 'Tenancy Documents', to: '/app/admin/tenants/documents', section: 'tenants', icon: FileSignature },
  { label: 'Communications', to: '/app/admin/communications', section: 'communications', icon: MessagesSquare },
  { label: 'Compliance', to: '/app/admin/compliance', section: 'compliance', icon: ShieldCheck },
  { label: 'Key Register', to: '/app/admin/keys', section: 'properties', icon: KeyRound },
  { label: 'Users', to: '/app/admin/users', section: 'users', icon: Users },
  { label: 'Templates', to: '/app/admin/templates', section: 'templates', icon: Wrench },
  { label: 'Settings', to: '/app/admin/settings', section: 'settings', icon: Settings },
];

const Sidebar: React.FC<SidebarProps> = ({ open, onClose }) => {
  const { canAccess } = useAuth();
  const visibleItems = NAV_ITEMS.filter((item) => canAccess(item.section));
  const navigation = (
    <aside
      id="primary-navigation"
      aria-label="Primary navigation"
      className="flex h-full w-[min(86vw,300px)] flex-col border-r border-gray-200 bg-white lg:w-auto"
    >
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-gray-200 px-5">
        <div className="grid h-9 w-9 place-items-center rounded bg-gray-950 text-sm font-black text-white">PI</div>
        <div className="min-w-0 flex-1"><div className="text-sm font-bold text-gray-950">ProInspect</div><div className="text-xs text-gray-500">Inspection platform</div></div>
        <button type="button" onClick={onClose} aria-label="Close navigation" className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 lg:hidden"><X size={18} /></button>
      </div>
      <nav className="grid flex-1 content-start gap-1 overflow-y-auto p-3">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onClose}
              className={({ isActive }) => ['flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition', isActive ? 'bg-gray-950 text-white' : 'text-gray-700 hover:bg-gray-100 hover:text-gray-950'].join(' ')}
            >
              <Icon size={18} />{item.label}
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );

  return (
    <>
      <div className="hidden lg:sticky lg:top-0 lg:block lg:h-screen">{navigation}</div>
      <div className={`fixed inset-0 z-40 lg:hidden ${open ? 'pointer-events-auto' : 'pointer-events-none'}`} aria-hidden={!open}>
        <button type="button" aria-label="Close navigation overlay" onClick={onClose} className={`absolute inset-0 bg-black/40 transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`} />
        <div className={`relative h-full w-fit transform transition-transform duration-200 ease-out ${open ? 'translate-x-0' : '-translate-x-full'}`}>{navigation}</div>
      </div>
    </>
  );
};
export default Sidebar;
