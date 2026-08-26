import React, { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { OfflineSyncProvider } from '../../contexts/OfflineSyncContext';
import SyncStatusIndicator from '../sync/SyncStatusIndicator';
import Sidebar from './Sidebar';
import TopBar from './TopBar';

const AppShell: React.FC = () => {
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);

  useEffect(() => {
    if (!mobileNavigationOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNavigationOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [mobileNavigationOpen]);

  return (
    <OfflineSyncProvider>
      <div className="min-h-screen bg-gray-50 text-gray-950 lg:grid lg:grid-cols-[260px_1fr]">
        <Sidebar open={mobileNavigationOpen} onClose={() => setMobileNavigationOpen(false)} />
        <div className="min-w-0">
          <TopBar
            navigationOpen={mobileNavigationOpen}
            onOpenNavigation={() => setMobileNavigationOpen(true)}
          />
          <main className="p-4 lg:p-6"><Outlet /></main>
        </div>
        <SyncStatusIndicator />
      </div>
    </OfflineSyncProvider>
  );
};

export default AppShell;
