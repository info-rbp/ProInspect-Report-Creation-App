import React, { useEffect, useState } from 'react';
import { isAiConfigured, checkAiStatus } from '../../services/configService';
import { isFirebaseConfigured } from '../../services/storageService';

const statusClass = (enabled: boolean) => enabled ? 'bg-green-50 text-green-700 border-green-200' : 'bg-amber-50 text-amber-700 border-amber-200';

const SettingsPage: React.FC = () => {
  const firebaseConfigured = isFirebaseConfigured();
  const [aiConfigured, setAiConfigured] = useState<boolean>(isAiConfigured());

  useEffect(() => {
    checkAiStatus().then((available) => setAiConfigured(available));
  }, []);

  const rows = [
    { label: 'Firebase', value: firebaseConfigured ? 'Configured from environment or local development fallback' : 'Not configured - local device storage only', enabled: firebaseConfigured },
    { label: 'AI Service', value: aiConfigured ? 'Server-side AI service active' : 'AI service unavailable', enabled: aiConfigured },
    { label: 'Environment', value: import.meta.env.DEV ? 'Local development' : 'Production build', enabled: true },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-950">Settings</h1>
        <p className="text-sm text-gray-600">Runtime status for ProInspect services. Production Firebase secrets are not editable here.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {rows.map((row) => (
          <div key={row.label} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <div className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${statusClass(row.enabled)}`}>
              {row.enabled ? 'Ready' : 'Needs attention'}
            </div>
            <h2 className="mt-4 font-semibold text-gray-950">{row.label}</h2>
            <p className="mt-1 text-sm text-gray-600">{row.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SettingsPage;
