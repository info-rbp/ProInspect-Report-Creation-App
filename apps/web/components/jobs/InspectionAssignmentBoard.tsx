import React from 'react';
import { Sparkles } from 'lucide-react';
import type { InspectionJob, PropertyRecord, UserProfile } from '../../types/platform';
import type { getAssignmentSuggestions } from '../../services/platform/inspectionOperationsService';
import {
  OperationBadge,
  operationDateTime,
} from './inspectionOperationsUi';

type Suggestions = Awaited<ReturnType<typeof getAssignmentSuggestions>>;

interface Props {
  jobs: InspectionJob[];
  properties: Map<string, PropertyRecord>;
  inspectors: UserProfile[];
  suggestions: Record<string, Suggestions>;
  onSuggest: (job: InspectionJob) => Promise<void>;
  onAssign: (job: InspectionJob, inspectorId: string) => Promise<void>;
}

function userName(user: UserProfile): string {
  return user.displayName?.trim() || user.email;
}

const InspectionAssignmentBoard: React.FC<Props> = ({
  jobs,
  properties,
  inspectors,
  suggestions,
  onSuggest,
  onAssign,
}) => {
  if (!jobs.length) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 p-12 text-center text-sm text-slate-500">
        All active inspections have an assigned inspector.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {jobs.map((job) => (
        <section
          key={job.id}
          className="rounded-2xl border border-slate-200 bg-white p-5"
        >
          <div className="flex flex-col justify-between gap-4 lg:flex-row">
            <div>
              <h3 className="font-bold">
                {properties.get(job.propertyId)?.address || job.propertyId}
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                {job.reportType} · {operationDateTime(job.scheduledAt)}
              </p>
              <div className="mt-2 flex gap-1">
                <OperationBadge value={job.priority || 'normal'} />
                <OperationBadge value={job.accessStatus || 'unknown'} />
              </div>
            </div>
            <div className="flex flex-wrap items-start gap-2">
              <select
                className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
                defaultValue=""
                onChange={(event) => {
                  if (event.target.value) {
                    void onAssign(job, event.target.value);
                  }
                }}
              >
                <option value="">Assign inspector...</option>
                {inspectors.map((user) => (
                  <option key={user.id} value={user.id}>
                    {userName(user)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void onSuggest(job)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold"
              >
                <Sparkles size={14} className="inline" /> Suggest
              </button>
            </div>
          </div>
          {suggestions[job.id]?.length ? (
            <div className="mt-4 grid gap-2 md:grid-cols-3">
              {suggestions[job.id].slice(0, 3).map((candidate) => (
                <button
                  key={candidate.userId}
                  type="button"
                  onClick={() => void onAssign(job, candidate.userId)}
                  className="rounded-xl border border-slate-200 p-3 text-left"
                >
                  <div className="flex justify-between">
                    <b className="text-xs">{candidate.displayName}</b>
                    <span className="text-xs font-bold text-blue-600">
                      {candidate.score}
                    </span>
                  </div>
                  <div className="mt-1 text-[10px] text-slate-500">
                    {candidate.reasons.join(' ')}
                  </div>
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ))}
    </div>
  );
};

export default InspectionAssignmentBoard;
