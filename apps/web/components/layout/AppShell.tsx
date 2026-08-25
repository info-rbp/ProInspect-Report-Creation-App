import React, { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { OfflineSyncProvider } from '../../contexts/OfflineSyncContext';
import SyncStatusIndicator from '../sync/SyncStatusIndicator';
import Sidebar from './Sidebar';
import TopBar from './TopBar';

const AppShell: React.FC = () => {
  const [navigationOpen, setNavigationOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setNavigationOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!navigationOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNavigationOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [navigationOpen]);

  return (
    <OfflineSyncProvider>
      <div className="min-h-screen bg-gray-50 text-gray-950 lg:grid lg:grid-cols-[260px_1fr]">
        <Sidebar open={navigationOpen} onClose={() => setNavigationOpen(false)} />
        <div className="min-w-0">
          <TopBar navigationOpen={navigationOpen} onOpenNavigation={() => setNavigationOpen(true)} />
          <main className="p-4 lg:p-6"><Outlet /></main>
        </div>
        <SyncStatusIndicator />
      </div>
    </OfflineSyncProvider>
  );
};

export default AppShell;
