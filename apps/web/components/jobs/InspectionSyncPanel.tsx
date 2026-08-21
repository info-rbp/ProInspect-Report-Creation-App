import React, { useState } from 'react';
import { CalendarDays, ShieldAlert, ShoppingBag } from 'lucide-react';
import type { IntegrationSyncException } from '../../types/platform';
import {
  beginGoogleCalendarConnection,
  configureGoogleCalendar,
  connectShopify,
  createGoogleCalendarWatch,
  getGoogleCalendarIntegrationStatus,
  getShopifyIntegrationStatus,
  listConnectedGoogleCalendars,
  reconcileGoogleCalendar,
  reconcileShopify,
  resolveIntegrationSyncException,
  seedShopifyMappings,
  type GoogleCalendarIntegrationStatus,
  type ShopifyIntegrationStatus,
} from '../../services/platform/inspectionOperationsService';
import {
  OperationBadge,
  operationDateTime,
} from './inspectionOperationsUi';

interface Props {
  shopify: ShopifyIntegrationStatus | null;
  google: GoogleCalendarIntegrationStatus | null;
  exceptions: IntegrationSyncException[];
  busy: boolean;
  onBusy: (value: boolean) => void;
  onError: (message: string) => void;
  onReload: () => Promise<void>;
}

const InspectionSyncPanel: React.FC<Props> = ({
  shopify,
  google,
  exceptions,
  busy,
  onBusy,
  onError,
  onReload,
}) => {
  const [shopDomain, setShopDomain] = useState('');
  const [shopToken, setShopToken] = useState('');
  const [calendarOptions, setCalendarOptions] = useState<
    Array<{ id: string; summary?: string }>
  >([]);
  const [calendarId, setCalendarId] = useState('');
  const [bookingPages, setBookingPages] = useState('');

  const action = async (operation: () => Promise<unknown>) => {
    onBusy(true);
    try {
      await operation();
      await onReload();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Integration action failed.');
    } finally {
      onBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShoppingBag size={18} />
              <h2 className="font-bold">Shopify Orders</h2>
            </div>
            <OperationBadge value={shopify?.connection?.status || 'disconnected'} />
          </div>
          {shopify?.connection ? (
            <div className="mt-4 space-y-3 text-xs">
              <div>
                <b>Store:</b>{' '}
                {shopify.connection.externalAccountLabel ||
                  shopify.connection.externalAccountId}
              </div>
              <div>
                <b>Last sync:</b>{' '}
                {operationDateTime(shopify.connection.lastSuccessfulSyncAt)}
              </div>
              <div>
                <b>Service mappings:</b> {shopify.mappings.length}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void action(() => reconcileShopify())}
                  className="rounded-lg bg-slate-900 px-3 py-2 font-semibold text-white"
                >
                  Sync orders now
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void action(() => seedShopifyMappings(true))}
                  className="rounded-lg border border-slate-200 px-3 py-2 font-semibold"
                >
                  Refresh mappings
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <input
                value={shopDomain}
                onChange={(event) => setShopDomain(event.target.value)}
                placeholder="store.myshopify.com"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
              />
              <input
                type="password"
                value={shopToken}
                onChange={(event) => setShopToken(event.target.value)}
                placeholder="Shopify Admin access token"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
              />
              <button
                type="button"
                disabled={busy || !shopDomain || !shopToken}
                onClick={() =>
                  void action(() =>
                    connectShopify({
                      shopDomain,
                      accessToken: shopToken,
                      publicApiBaseUrl: import.meta.env.VITE_API_BASE_URL,
                      autoConvertReadyRequests: true,
                    }),
                  )
                }
                className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
              >
                Connect Shopify
              </button>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CalendarDays size={18} />
              <h2 className="font-bold">Google Calendar</h2>
            </div>
            <OperationBadge value={google?.connection?.status || 'disconnected'} />
          </div>
          {google?.connection ? (
            <div className="mt-4 space-y-3 text-xs">
              <div>
                <b>Calendar:</b>{' '}
                {google.connection.externalAccountLabel ||
                  String(
                    google.connection.configuration.calendarLabel ||
                      google.connection.configuration.calendarId ||
                      'Not selected',
                  )}
              </div>
              <div>
                <b>Last sync:</b>{' '}
                {operationDateTime(google.connection.lastSuccessfulSyncAt)}
              </div>
              <div>
                <b>Watch expires:</b>{' '}
                {operationDateTime(
                  String(google.connection.configuration.watchExpiration || ''),
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    void action(async () => {
                      setCalendarOptions(await listConnectedGoogleCalendars());
                    })
                  }
                  className="rounded-lg border border-slate-200 px-3 py-2 font-semibold"
                >
                  Choose calendar
                </button>
                <button
                  type="button"
                  onClick={() => void action(() => reconcileGoogleCalendar())}
                  className="rounded-lg bg-slate-900 px-3 py-2 font-semibold text-white"
                >
                  Sync bookings
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void action(() =>
                      createGoogleCalendarWatch(import.meta.env.VITE_API_BASE_URL),
                    )
                  }
                  className="rounded-lg border border-slate-200 px-3 py-2 font-semibold"
                >
                  Renew watch
                </button>
              </div>
              {calendarOptions.length ? (
                <div className="grid gap-2">
                  <select
                    value={calendarId}
                    onChange={(event) => setCalendarId(event.target.value)}
                    className="rounded-xl border border-slate-200 px-3 py-2"
                  >
                    <option value="">Select calendar...</option>
                    {calendarOptions.map((calendar) => (
                      <option key={calendar.id} value={calendar.id}>
                        {calendar.summary || calendar.id}
                      </option>
                    ))}
                  </select>
                  <textarea
                    value={bookingPages}
                    onChange={(event) => setBookingPages(event.target.value)}
                    placeholder="One appointment-schedule booking-page URL per line"
                    className="rounded-xl border border-slate-200 px-3 py-2"
                  />
                  <button
                    type="button"
                    disabled={!calendarId}
                    onClick={() =>
                      void action(() =>
                        configureGoogleCalendar({
                          expectedVersion: google.connection?.version || 1,
                          calendarId,
                          calendarLabel: calendarOptions.find(
                            (item) => item.id === calendarId,
                          )?.summary,
                          timezone: 'Australia/Perth',
                          autoConvertReadyRequests: true,
                          bookingPages: bookingPages
                            .split('\n')
                            .map((value) => value.trim())
                            .filter(Boolean),
                        }),
                      )
                    }
                    className="rounded-lg bg-blue-600 px-3 py-2 font-semibold text-white disabled:opacity-40"
                  >
                    Save calendar
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="mt-4">
              <p className="text-xs text-slate-500">
                Authorise the ProInspect connection, then select the dedicated
                bookings calendar and register its watch channel.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    const url = await beginGoogleCalendarConnection(
                      `${window.location.origin}/app/admin/jobs?tab=sync`,
                    );
                    window.location.assign(url);
                  })
                }
                className="mt-3 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white"
              >
                Connect Google Calendar
              </button>
            </div>
          )}
        </section>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert size={18} />
            <h2 className="font-bold">Sync Exceptions</h2>
          </div>
          <span className="text-xs font-semibold text-slate-500">
            {exceptions.filter((item) => item.status === 'open').length} open
          </span>
        </div>
        <div className="mt-4 space-y-2">
          {exceptions.map((exception) => (
            <div
              key={exception.id}
              className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 p-3 md:flex-row"
            >
              <div>
                <div className="flex items-center gap-2">
                  <OperationBadge value={exception.severity} />
                  <b className="text-xs">{exception.title}</b>
                </div>
                <p className="mt-1 text-xs text-slate-500">{exception.detail}</p>
              </div>
              {exception.status === 'open' ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      void action(() =>
                        resolveIntegrationSyncException(
                          exception,
                          'Resolved by operator.',
                        ),
                      )
                    }
                    className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    Resolve
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void action(() =>
                        resolveIntegrationSyncException(
                          exception,
                          'Ignored by operator.',
                          true,
                        ),
                      )
                    }
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold"
                  >
                    Ignore
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default InspectionSyncPanel;
