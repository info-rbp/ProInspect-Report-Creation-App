import React from 'react';
import { Sparkles, Loader2, RefreshCw } from 'lucide-react';

interface AreaActionBarProps {
  onAnalyseArea?: () => void;
  onGenerateSummary?: () => void;
  isAnalyzing?: boolean;
  disabled?: boolean;
}

export const AreaActionBar: React.FC<AreaActionBarProps> = ({
  onAnalyseArea,
  onGenerateSummary,
  isAnalyzing = false,
  disabled = false,
}) => {
  if (disabled) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
        <Sparkles size={16} className="text-purple-600 animate-pulse" />
        <span>Area AI Intelligence Actions</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {onAnalyseArea && (
          <button
            type="button"
            onClick={onAnalyseArea}
            disabled={isAnalyzing}
            className="inline-flex items-center gap-1.5 rounded-xl bg-purple-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-purple-700 disabled:opacity-50 shadow-2xs transition-colors"
          >
            {isAnalyzing ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Sparkles size={13} />
            )}
            <span>{isAnalyzing ? 'Analyzing Area...' : 'Analyse Area with AI'}</span>
          </button>
        )}

        {onGenerateSummary && (
          <button
            type="button"
            onClick={onGenerateSummary}
            disabled={isAnalyzing}
            className="inline-flex items-center gap-1.5 rounded-xl border border-purple-200 bg-purple-50 px-3.5 py-1.5 text-xs font-bold text-purple-700 hover:bg-purple-100 dark:border-purple-900 dark:bg-purple-950/60 dark:text-purple-300 disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={13} />
            <span>Generate Area Summary</span>
          </button>
        )}
      </div>
    </div>
  );
};
