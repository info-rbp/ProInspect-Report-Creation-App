import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { installReconnectSync, syncStateSummary } from '../services/offlineWorkspace';
import { syncAllOfflineWork } from '../services/offlineSyncCoordinator';

interface OfflineSyncState {
  online: boolean;
  syncing: boolean;
  pending: number;
  conflicts: number;
  failures: number;
  syncNow: () => Promise<void>;
  refresh: () => Promise<void>;
}

const OfflineSyncContext = createContext<OfflineSyncState | undefined>(undefined);

export const OfflineSyncProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const [summary, setSummary] = useState({ photos: 0, mutations: 0, conflicts: 0, failures: 0, syncing: false });

  const refresh = useCallback(async () => setSummary(await syncStateSummary()), []);
  const syncNow = useCallback(async () => {
    if (syncing || !online) return;
    setSyncing(true);
    try { await syncAllOfflineWork(); }
    finally { setSyncing(false); await refresh(); }
  }, [online, refresh, syncing]);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    const uninstall = installReconnectSync(syncNow);
    void refresh();
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); uninstall(); };
  }, [refresh, syncNow]);

  const value = useMemo<OfflineSyncState>(() => ({ online, syncing: syncing || summary.syncing, pending: summary.photos + summary.mutations, conflicts: summary.conflicts, failures: summary.failures, syncNow, refresh }), [online, refresh, summary, syncNow, syncing]);
  return <OfflineSyncContext.Provider value={value}>{children}</OfflineSyncContext.Provider>;
};

export function useOfflineSync(): OfflineSyncState {
  const value = useContext(OfflineSyncContext);
  if (!value) throw new Error('useOfflineSync must be used within OfflineSyncProvider.');
  return value;
}
