import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ExternalLink, ShoppingBag } from 'lucide-react';
import { isAiConfigured, checkAiStatus } from '../../services/configService';
import {
  getGoogleCalendarIntegrationStatus,
  getShopifyIntegrationStatus,
  type GoogleCalendarIntegrationStatus,
  type ShopifyIntegrationStatus,
} from '../../services/platform/inspectionOperationsService';
import { isFirebaseConfigured } from '../../services/storageService';

const statusClass = (enabled: boolean) => enabled
  ? 'bg-green-50 text-green-700 border-green-200'
  : 'bg-amber-50 text-amber-700 border-amber-200';

const SettingsPage: React.FC = () => {
  const firebaseConfigured = isFirebaseConfigured();
  const [aiConfigured, setAiConfigured] = useState<boolean>(isAiConfigured());
  const [shopify, setShopify] = useState<ShopifyIntegrationStatus | null>(null);
  const [google, setGoogle] = useState<GoogleCalendarIntegrationStatus | null>(null);

  useEffect(() => {
    void Promise.all([
      checkAiStatus(),
      getShopifyIntegrationStatus().catch(() => ({ connection: null, mappings: [] })),
      getGoogleCalendarIntegrationStatus().catch(() => ({ connection: null, mappings: [] })),
    ]).then(([available, shopifyStatus, calendarStatus]) => {
      setAiConfigured(available);
      setShopify(shopifyStatus);
      setGoogle(calendarStatus);
    });
  }, []);

  const rows = [
    {
      label: 'Firebase',
      value: firebaseConfigured
        ? 'Configured from environment or local development fallback'
        : 'Not configured - local device storage only',
      enabled: firebaseConfigured,
    },
    {
      label: 'AI Service',
      value: aiConfigured ? 'Server-side AI service active' : 'AI service unavailable',
      enabled: aiConfigured,
    },
    {
      label: 'Environment',
      value: import.meta.env.DEV ? 'Local development' : 'Production build',
      enabled: true,
    },
  ];

  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-2xl font-bold text-gray-950">Settings</h1>
        <p className="text-sm text-gray-600">Runtime status and links to controlled ProInspect service configuration.</p>
      </div>

      <section>
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-500">Platform services</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {rows.map((row) => (
            <div key={row.label} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <div className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${statusClass(row.enabled)}`}>
                {row.enabled ? 'Ready' : 'Needs attention'}
              </div>
              <h3 className="mt-4 font-semibold text-gray-950">{row.label}</h3>
              <p className="mt-1 text-sm text-gray-600">{row.value}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500">Inspection intake integrations</h2>
          <Link to="/app/admin/jobs?tab=sync" className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600">
            Manage integrations <ExternalLink size={13} />
          </Link>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-semibold text-gray-950"><ShoppingBag size={18} /> Shopify Orders</div>
              <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${statusClass(shopify?.connection?.status === 'connected')}`}>
                {shopify?.connection?.status === 'connected' ? 'Connected' : 'Not connected'}
              </span>
            </div>
            <p className="mt-3 text-sm text-gray-600">
              {shopify?.connection
                ? `${shopify.connection.externalAccountLabel || shopify.connection.externalAccountId || 'Shopify store'} · ${shopify.mappings.length} service mapping(s)`
                : 'Connect the Shopify custom app to receive inspection orders and payment changes.'}
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-semibold text-gray-950"><CalendarDays size={18} /> Google Calendar</div>
              <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${statusClass(google?.connection?.status === 'connected')}`}>
                {google?.connection?.status === 'connected' ? 'Connected' : 'Not connected'}
              </span>
            </div>
            <p className="mt-3 text-sm text-gray-600">
              {google?.connection
                ? `${google.connection.externalAccountLabel || String(google.connection.configuration.calendarLabel || 'Calendar')} · ${google.mappings.length} booking mapping(s)`
                : 'Connect a dedicated bookings calendar to receive appointments and synchronise job schedules.'}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};

export default SettingsPage;
