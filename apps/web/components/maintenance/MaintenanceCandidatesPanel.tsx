import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, ShieldAlert, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { MaintenanceCandidate, MaintenanceCategory, MaintenancePriority } from '../../types/platform';
import {
  confirmMaintenanceCandidate,
  dismissMaintenanceCandidate,
} from '../../services/platform/maintenanceService';

function label(value?: string): string {
  return value
    ? value.replaceAll('_', ' ').replace(/\b\w/gu, (character) => character.toUpperCase())
    : 'Not set';
}

export const MaintenanceCandidatesPanel: React.FC<{
  candidates: MaintenanceCandidate[];
  onChanged: () => Promise<void>;
}> = ({ candidates, onChanged }) => {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useMemo(
    () => candidates.filter((candidate) => candidate.reviewStatus === 'suggested'),
    [candidates],
  );

  const confirm = async (candidate: MaintenanceCandidate) => {
    setBusyId(candidate.id);
    setError(null);
    try {
      await confirmMaintenanceCandidate(candidate.id, {
        category: candidate.category as MaintenanceCategory,
        priority: candidate.suggestedPriority as MaintenancePriority,
        workInstruction: candidate.recommendedAction,
        approvalRequired: true,
      } as never);
      await onChanged();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Candidate could not be confirmed.');
    } finally {
      setBusyId(null);
    }
  };

  const dismiss = async (candidate: MaintenanceCandidate) => {
    const reason = window.prompt('Reason for dismissing this maintenance candidate:');
    if (!reason?.trim()) return;
    setBusyId(candidate.id);
    setError(null);
    try {
      await dismissMaintenanceCandidate(candidate.id, reason.trim(), candidate.version || 1);
      await onChanged();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Candidate could not be dismissed.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-start justify-between rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          <span>{error}</span>
          <button onClick={() => setError(null)}><XCircle size={16} /></button>
        </div>
      )}
      {pending.map((candidate) => {
        const urgent = ['urgent_hazard', 'emergency'].includes(candidate.safetyClassification || '');
        return (
          <section
            key={candidate.id}
            className={`rounded-2xl border bg-white p-5 shadow-sm ${urgent ? 'border-rose-300' : 'border-slate-200'}`}
          >
            <div className="flex flex-col justify-between gap-4 xl:flex-row">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {urgent ? <ShieldAlert className="text-rose-600" size={18} /> : <AlertTriangle className="text-amber-600" size={18} />}
                  <h3 className="font-bold text-slate-950">{candidate.title}</h3>
                  <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600">
                    {label(candidate.source)}
                  </span>
                  {candidate.preliminary && (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-800">
                      Preliminary
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm text-slate-600">{candidate.description}</p>
                <div className="mt-3 grid gap-3 text-xs text-slate-500 sm:grid-cols-2 lg:grid-cols-5">
                  <div><b className="text-slate-700">Category</b><br />{candidate.category}</div>
                  <div><b className="text-slate-700">Priority</b><br />{label(candidate.suggestedPriority)}</div>
                  <div><b className="text-slate-700">Issue</b><br />{label(candidate.issueType)}</div>
                  <div><b className="text-slate-700">Safety</b><br />{label(candidate.safetyClassification)}</div>
                  <div><b className="text-slate-700">Evidence</b><br />{candidate.evidencePhotoIds.length} photo reference(s)</div>
                </div>
                {candidate.recommendedAction && (
                  <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-700">
                    <b>Recommended action:</b> {candidate.recommendedAction}
                  </div>
                )}
                <div className="mt-3 flex flex-wrap gap-3 text-xs font-semibold">
                  {candidate.reportId && (
                    <Link
                      to={`/app/admin/reports/${encodeURIComponent(candidate.reportId)}/edit`}
                      className="inline-flex items-center gap-1 text-blue-600"
                    >
                      <ExternalLink size={12} /> Open source report
                    </Link>
                  )}
                  <span className="text-slate-500">
                    Confidence: {typeof candidate.confidence === 'number' ? `${Math.round(candidate.confidence * 100)}%` : 'Not supplied'}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 items-start gap-2">
                <button
                  disabled={busyId === candidate.id}
                  onClick={() => void confirm(candidate)}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                >
                  <CheckCircle2 size={14} /> Confirm & Price
                </button>
                <button
                  disabled={busyId === candidate.id}
                  onClick={() => void dismiss(candidate)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </section>
        );
      })}
      {!pending.length && (
        <div className="rounded-2xl border border-dashed border-slate-300 p-12 text-center text-sm text-slate-500">
          No maintenance candidates are awaiting triage.
        </div>
      )}
    </div>
  );
};

export default MaintenanceCandidatesPanel;
