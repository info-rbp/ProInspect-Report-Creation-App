import React from 'react';
import type { InspectionRequest, PropertyRecord } from '../../types/platform';
import {
  OperationBadge,
  operationDateTime,
  sourceIcon,
} from './inspectionOperationsUi';

interface Props {
  requests: InspectionRequest[];
  properties: PropertyRecord[];
  matchSelections: Record<string, string>;
  busy: boolean;
  onSelection: (requestId: string, propertyId: string) => void;
  onLink: (request: InspectionRequest) => Promise<void>;
  onConvert: (request: InspectionRequest) => Promise<void>;
  onCancel: (request: InspectionRequest) => Promise<void>;
}

const InspectionIntakeQueue: React.FC<Props> = ({
  requests,
  properties,
  matchSelections,
  busy,
  onSelection,
  onLink,
  onConvert,
  onCancel,
}) => {
  const ordered = [...requests].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );

  if (!ordered.length) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 p-12 text-center text-sm text-slate-500">
        No intake requests have been received yet. Shopify orders and Google Calendar
        bookings will appear here after their integrations are connected.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {ordered.map((request) => {
        const selectedPropertyId =
          matchSelections[request.id] ||
          request.propertyId ||
          request.propertyMatchCandidates?.[0]?.propertyId ||
          '';
        return (
          <section
            key={request.id}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <div className="flex flex-col justify-between gap-4 xl:flex-row">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1 font-bold text-slate-950">
                    {sourceIcon(request.source)}{' '}
                    {request.customerName ||
                      request.shopifyOrder?.orderNumber ||
                      request.googleCalendar?.summary ||
                      request.id}
                  </span>
                  <OperationBadge value={request.intakeStatus} />
                  <OperationBadge value={request.paymentStatus} />
                  <OperationBadge value={request.bookingStatus} />
                  <OperationBadge value={request.propertyMatchStatus} />
                </div>
                <div className="mt-2 grid gap-3 text-xs text-slate-600 md:grid-cols-4">
                  <div>
                    <b>Service</b>
                    <br />
                    {request.reportType || request.serviceCode || 'Mapping required'}
                  </div>
                  <div>
                    <b>Property candidate</b>
                    <br />
                    {request.propertyAddressCandidate || 'Not supplied'}
                  </div>
                  <div>
                    <b>Appointment</b>
                    <br />
                    {operationDateTime(request.requestedStartAt)}
                  </div>
                  <div>
                    <b>External reference</b>
                    <br />
                    {request.shopifyOrder?.orderNumber ||
                      request.googleCalendar?.eventId ||
                      request.sourceExternalId}
                  </div>
                </div>
                {request.propertyMatchCandidates?.length ? (
                  <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs">
                    <b>Suggested matches:</b>{' '}
                    {request.propertyMatchCandidates
                      .map(
                        (candidate) =>
                          `${candidate.address} (${Math.round(candidate.score * 100)}%)`,
                      )
                      .join(' · ')}
                  </div>
                ) : null}
              </div>
              <div className="flex w-full flex-col gap-2 xl:w-72">
                <select
                  value={selectedPropertyId}
                  onChange={(event) => onSelection(request.id, event.target.value)}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
                >
                  <option value="">Select property...</option>
                  {properties.map((property) => (
                    <option key={property.id} value={property.id}>
                      {property.address}
                      {property.suburb ? `, ${property.suburb}` : ''}
                    </option>
                  ))}
                </select>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    disabled={busy || request.propertyMatchStatus === 'matched'}
                    onClick={() => void onLink(request)}
                    className="rounded-lg border border-slate-200 px-2 py-2 text-[11px] font-semibold disabled:opacity-40"
                  >
                    Link
                  </button>
                  <button
                    type="button"
                    disabled={busy || request.intakeStatus !== 'ready_for_job'}
                    onClick={() => void onConvert(request)}
                    className="rounded-lg bg-blue-600 px-2 py-2 text-[11px] font-semibold text-white disabled:opacity-40"
                  >
                    Convert
                  </button>
                  <button
                    type="button"
                    disabled={
                      busy || ['converted', 'cancelled'].includes(request.intakeStatus)
                    }
                    onClick={() => void onCancel(request)}
                    className="rounded-lg border border-rose-200 px-2 py-2 text-[11px] font-semibold text-rose-700 disabled:opacity-40"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
};

export default InspectionIntakeQueue;
