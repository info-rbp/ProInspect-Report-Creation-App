import React from 'react';
import { CheckCircle2, Loader2, RefreshCw, Sparkles } from 'lucide-react';

interface AreaActionBarProps {
  onAnalyseArea?: () => void;
  onGenerateSummary?: () => void;
  onMarkRoutineOrdinary?: () => void;
  routineQuickActionDisabled?: boolean;
  isAnalyzing?: boolean;
  disabled?: boolean;
}

export const AreaActionBar: React.FC<AreaActionBarProps> = ({
  onAnalyseArea,
  onGenerateSummary,
  onMarkRoutineOrdinary,
  routineQuickActionDisabled = false,
  isAnalyzing = false,
  disabled = false,
}) => {
  if (disabled) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
        <Sparkles size={16} className="animate-pulse text-purple-600" />
        <span>Area Inspection Actions</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {onMarkRoutineOrdinary ? (
          <button
            type="button"
            onClick={onMarkRoutineOrdinary}
            disabled={routineQuickActionDisabled || isAnalyzing}
            title={routineQuickActionDisabled ? 'Add at least one area overview photo before using the Routine ordinary-item action.' : 'Marks only currently unassessed, non-exception condition and cleanliness fields. Working/test status is never changed.'}
            className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-1.5 text-xs font-bold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300"
          >
            <CheckCircle2 size={13} />
            <span>Mark Ordinary Items Intact / Clean</span>
          </button>
        ) : null}

        {onAnalyseArea ? (
          <button
            type="button"
            onClick={onAnalyseArea}
            disabled={isAnalyzing}
            className="inline-flex items-center gap-1.5 rounded-xl bg-purple-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-2xs transition-colors hover:bg-purple-700 disabled:opacity-50"
          >
            {isAnalyzing ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            <span>{isAnalyzing ? 'Analyzing Area...' : 'Analyse Area with AI'}</span>
          </button>
        ) : null}

        {onGenerateSummary ? (
          <button
            type="button"
            onClick={onGenerateSummary}
            disabled={isAnalyzing}
            className="inline-flex items-center gap-1.5 rounded-xl border border-purple-200 bg-purple-50 px-3.5 py-1.5 text-xs font-bold text-purple-700 transition-colors hover:bg-purple-100 disabled:opacity-50 dark:border-purple-900 dark:bg-purple-950/60 dark:text-purple-300"
          >
            <RefreshCw size={13} />
            <span>Generate Area Summary</span>
          </button>
        ) : null}
      </div>
    </div>
  );
};
