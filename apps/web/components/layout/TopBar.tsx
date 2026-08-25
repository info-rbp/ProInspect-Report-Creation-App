import React from 'react';
import { LogOut, Menu } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

interface TopBarProps {
  navigationOpen: boolean;
  onOpenNavigation: () => void;
}

const TopBar: React.FC<TopBarProps> = ({ navigationOpen, onOpenNavigation }) => {
  const { logout, userProfile } = useAuth();

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-gray-200 bg-white/95 px-4 backdrop-blur lg:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <button
          className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 lg:hidden"
          type="button"
          aria-label="Open navigation"
          aria-controls="primary-navigation"
          aria-expanded={navigationOpen}
          onClick={onOpenNavigation}
        >
          <Menu size={20} />
        </button>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-gray-950">Platform workspace</div>
          <div className="hidden truncate text-xs text-gray-500 sm:block">Properties, inspection jobs and reports</div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="hidden text-right sm:block">
          <div className="text-sm font-semibold text-gray-950">{userProfile?.displayName || userProfile?.email || 'Operator'}</div>
          <div className="text-xs capitalize text-gray-500">{(userProfile?.role || 'inspector').replaceAll('_', ' ')}</div>
        </div>
        <button
          type="button"
          onClick={() => logout()}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
        >
          <LogOut size={16} />
          <span className="hidden sm:inline">Logout</span>
        </button>
      </div>
    </header>
  );
};

export default TopBar;
