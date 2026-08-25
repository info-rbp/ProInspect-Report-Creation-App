import React, { useState } from 'react';
import { Repeat2 } from 'lucide-react';
import type {
  InspectionReportType,
  PropertyRecord,
  RecurringInspectionSchedule,
} from '../../types/platform';
import { requireSelectedAgencyId } from '../../services/platform/userProfileService';
import {
  OperationBadge,
  operationDate,
  operationLabel,
} from './inspectionOperationsUi';

const REPORT_TYPES: InspectionReportType[] = [
  'Property Condition Report',
  'Routine Inspection',
  'Exit Inspection',
  'Maintenance and Follow-Up Report',
];

interface Props {
  schedules: RecurringInspectionSchedule[];
  properties: PropertyRecord[];
  onCreate: (
    input: Omit<
      RecurringInspectionSchedule,
      'id' | 'createdAt' | 'updatedAt'
    > &
      Partial<Pick<RecurringInspectionSchedule, 'id'>>,
  ) => Promise<void>;
  onMaterialise: (schedule: RecurringInspectionSchedule) => Promise<void>;
}

const RecurringInspectionPanel: React.FC<Props> = ({
  schedules,
  properties,
  onCreate,
  onMaterialise,
}) => {
  const [propertyId, setPropertyId] = useState(properties[0]?.id || '');
  const [reportType, setReportType] =
    useState<InspectionReportType>('Routine Inspection');
  const [cadence, setCadence] =
    useState<RecurringInspectionSchedule['cadence']>('quarterly');
  const [nextDueAt, setNextDueAt] = useState(
    new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
  );

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-bold">Create Recurring Inspection</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-5">
          <select
            value={propertyId}
            onChange={(event) => setPropertyId(event.target.value)}
            className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
          >
            {properties.map((property) => (
              <option key={property.id} value={property.id}>
                {property.address}
              </option>
            ))}
          </select>
          <select
            value={reportType}
            onChange={(event) =>
              setReportType(event.target.value as InspectionReportType)
            }
            className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
          >
            {REPORT_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <select
            value={cadence}
            onChange={(event) =>
              setCadence(event.target.value as RecurringInspectionSchedule['cadence'])
            }
            className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
          >
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="six_monthly">Six monthly</option>
            <option value="annual">Annual</option>
          </select>
          <input
            type="date"
            value={nextDueAt}
            onChange={(event) => setNextDueAt(event.target.value)}
            className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
          />
          <button
            type="button"
            disabled={!propertyId}
            onClick={() =>
              void onCreate({
                agencyId:
                  properties.find((property) => property.id === propertyId)
                    ?.agencyId || requireSelectedAgencyId(),
                propertyId,
                reportType,
                cadence,
                nextDueAt: new Date(`${nextDueAt}T09:00:00`).toISOString(),
                bookingLeadDays: 21,
                noticeLeadDays: 14,
                autoCreateRequest: true,
                autoConvertToJob: false,
                paused: false,
              })
            }
            className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
          >
            Create
          </button>
        </div>
      </section>

      <div className="space-y-3">
        {schedules.map((schedule) => (
          <section
            key={schedule.id}
            className="flex flex-col justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5 md:flex-row"
          >
            <div>
              <div className="flex items-center gap-2 font-bold">
                <Repeat2 size={16} />{' '}
                {properties.find((property) => property.id === schedule.propertyId)
                  ?.address || schedule.propertyId}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {schedule.reportType} · {operationLabel(schedule.cadence)} · next due{' '}
                {operationDate(schedule.nextDueAt)}
              </div>
            </div>
            <div className="flex gap-2">
              <OperationBadge value={schedule.paused ? 'paused' : 'active'} />
              <button
                type="button"
                onClick={() => void onMaterialise(schedule)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold"
              >
                Create intake now
              </button>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
};

export default RecurringInspectionPanel;
