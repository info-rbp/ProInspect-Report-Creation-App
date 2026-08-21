import React from 'react';
import type { ComponentTestStatus, ReportTestRecord } from '@pcr/domain';
import type { Photo } from '../../../types';
import { useAuth } from '../../../contexts/AuthContext';

interface ComponentTestingAssessmentProps {
  testStatus: ComponentTestStatus;
  testRecord?: ReportTestRecord;
  areaPhotos: Photo[];
  onChange: (patch: { testStatus: ComponentTestStatus; testRecord?: ReportTestRecord }) => void;
  disabled?: boolean;
}

function statusFor(record: ReportTestRecord): ComponentTestStatus {
  if (record.status === 'not_applicable') return 'not_applicable';
  if (record.status === 'not_tested') return 'untested';
  if (record.result === 'passed') return 'tested_passed';
  if (record.result === 'failed') return 'tested_failed';
  return 'unable_to_confirm';
}

export const ComponentTestingAssessment: React.FC<ComponentTestingAssessmentProps> = ({
  testStatus,
  testRecord,
  areaPhotos,
  onChange,
  disabled = false,
}) => {
  const { userProfile } = useAuth();
  const record: ReportTestRecord = testRecord || {
    status: testStatus === 'not_applicable' ? 'not_applicable' : testStatus === 'untested' ? 'not_tested' : 'tested',
    ...(testStatus === 'tested_passed' ? { result: 'passed' } : {}),
    ...(testStatus === 'tested_failed' ? { result: 'failed' } : {}),
  };

  const update = (patch: Partial<ReportTestRecord>) => {
    const next: ReportTestRecord = { ...record, ...patch };
    if (next.status === 'tested') {
      next.testedBy = next.testedBy || userProfile?.id;
      next.testedAt = next.testedAt || new Date().toISOString();
      next.result = next.result || 'inconclusive';
    } else {
      delete next.result;
      delete next.testedBy;
      delete next.testedAt;
      delete next.method;
      next.evidencePhotoIds = [];
    }
    onChange({ testStatus: statusFor(next), testRecord: next });
  };

  const evidenceIds = new Set(record.evidencePhotoIds || []);

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Operational Test</label>
          <select
            value={record.status}
            disabled={disabled}
            onChange={(event) => update({ status: event.target.value as ReportTestRecord['status'] })}
            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
          >
            <option value="not_tested">Not Tested</option>
            <option value="tested">Tested</option>
            <option value="not_applicable">Not Applicable</option>
          </select>
        </div>
        {record.status === 'tested' && (
          <>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Test Result</label>
              <select
                value={record.result || 'inconclusive'}
                disabled={disabled}
                onChange={(event) => update({ result: event.target.value as NonNullable<ReportTestRecord['result']> })}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
              >
                <option value="passed">Passed</option>
                <option value="failed">Failed</option>
                <option value="inconclusive">Inconclusive</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Test Method</label>
              <input
                value={record.method || ''}
                disabled={disabled}
                onChange={(event) => update({ method: event.target.value })}
                placeholder="e.g. Power-on cycle"
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
              />
            </div>
          </>
        )}
      </div>

      {record.status === 'tested' && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="text-[11px] text-slate-600 dark:text-slate-300">
            <div><span className="font-semibold">Tested by:</span> {record.testedBy || userProfile?.id || 'Not recorded'}</div>
            <div><span className="font-semibold">Tested at:</span> {record.testedAt ? new Date(record.testedAt).toLocaleString() : 'Not recorded'}</div>
          </div>
          <div>
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Test Evidence</div>
            {areaPhotos.length === 0 ? (
              <div className="text-[11px] text-slate-500">No area photographs are available to link.</div>
            ) : (
              <div className="max-h-28 space-y-1 overflow-y-auto">
                {areaPhotos.map((photo) => (
                  <label key={photo.id} className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                    <input
                      type="checkbox"
                      disabled={disabled}
                      checked={evidenceIds.has(photo.id)}
                      onChange={(event) => {
                        const next = new Set(evidenceIds);
                        if (event.target.checked) next.add(photo.id); else next.delete(photo.id);
                        update({ evidencePhotoIds: [...next] });
                      }}
                    />
                    <span className="truncate">{photo.file?.name || photo.id}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <p className="mt-2 text-[10px] leading-4 text-slate-500">
        Operation Confirmed is only valid when a qualifying test is recorded as passed. Photographs alone do not confirm operation.
      </p>
    </div>
  );
};

export default ComponentTestingAssessment;
