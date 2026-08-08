import React from 'react';
import { NavLink } from 'react-router-dom';
import { ClipboardList, FileText, Gauge, Home, Settings, Users, Wrench } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import type { InternalSection } from '../../services/platform/roleAccess';

interface NavItem {
  label: string;
  to: string;
  section: InternalSection;
  icon: React.ComponentType<{ size?: number }>;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', to: '/app/dashboard', section: 'dashboard', icon: Gauge },
  { label: 'Properties', to: '/app/admin/properties', section: 'properties', icon: Home },
  { label: 'Inspection Jobs', to: '/app/admin/jobs', section: 'jobs', icon: ClipboardList },
  { label: 'Reports', to: '/app/admin/reports', section: 'reports', icon: FileText },
  { label: 'Users', to: '/app/admin/users', section: 'users', icon: Users },
  { label: 'Templates', to: '/app/admin/templates', section: 'templates', icon: Wrench },
  { label: 'Settings', to: '/app/admin/settings', section: 'settings', icon: Settings },
];

const Sidebar: React.FC = () => {
  const { canAccess } = useAuth();
  const visibleItems = NAV_ITEMS.filter((item) => canAccess(item.section));

  return (
    <aside className="border-r border-gray-200 bg-white lg:sticky lg:top-0 lg:h-screen">
      <div className="flex h-16 items-center gap-3 border-b border-gray-200 px-5">
        <div className="grid h-9 w-9 place-items-center rounded bg-gray-950 text-sm font-black text-white">PI</div>
        <div>
          <div className="text-sm font-bold text-gray-950">ProInspect</div>
          <div className="text-xs text-gray-500">Inspection platform</div>
        </div>
      </div>
      <nav className="grid gap-1 p-3">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => [
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
                isActive ? 'bg-gray-950 text-white' : 'text-gray-700 hover:bg-gray-100 hover:text-gray-950',
              ].join(' ')}
            >
              <Icon size={18} />
              {item.label}
            </NavLink>
          );
        })}
      </nav>
      {/* Navigation links */}
    </aside>
  );
};

export default Sidebar;
