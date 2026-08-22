import React from 'react';
import { CloudOff, RefreshCw, TriangleAlert } from 'lucide-react';
import { useOfflineSync } from '../../contexts/OfflineSyncContext';

const SyncStatusIndicator: React.FC = () => {
  const { online, syncing, pending, conflicts, failures, syncNow } = useOfflineSync();
  if (online && !syncing && pending === 0 && conflicts === 0 && failures === 0) return null;
  const critical = conflicts > 0 || failures > 0;
  return (
    <button
      type="button"
      onClick={() => { void syncNow(); }}
      disabled={!online || syncing}
      title={critical ? `${conflicts} conflict(s), ${failures} failure(s)` : `${pending} item(s) awaiting sync`}
      style={{ position: 'fixed', right: 18, bottom: 18, zIndex: 1000, display: 'flex', alignItems: 'center', gap: 8, borderRadius: 999, border: '1px solid #cbd5e1', padding: '9px 13px', background: '#fff', boxShadow: '0 4px 18px rgba(15,23,42,.16)', cursor: online && !syncing ? 'pointer' : 'default' }}
    >
      {!online ? <CloudOff size={16} /> : critical ? <TriangleAlert size={16} /> : <RefreshCw size={16} className={syncing ? 'spin' : undefined} />}
      <span>{!online ? 'Offline' : syncing ? 'Syncing' : critical ? 'Sync needs attention' : `${pending} pending`}</span>
    </button>
  );
};

export default SyncStatusIndicator;
