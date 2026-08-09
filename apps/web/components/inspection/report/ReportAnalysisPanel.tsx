import React from 'react';
import { ReportAnalysisState } from '../../../hooks/inspection/useReportAnalysis';
import { Sparkles, Loader2, AlertTriangle } from 'lucide-react';

interface ReportAnalysisPanelProps {
  analysisState: ReportAnalysisState;
  onAnalyseFullReport: () => void;
  disabled?: boolean;
}

export const ReportAnalysisPanel: React.FC<ReportAnalysisPanelProps> = ({
  analysisState,
  onAnalyseFullReport,
  disabled = false,
}) => {
  return (
    <div className="rounded-2xl border border-purple-200 bg-purple-50/50 p-4 shadow-2xs dark:border-purple-900/60 dark:bg-purple-950/20 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-purple-600 animate-pulse" />
          <h3 className="text-xs font-bold text-purple-900 dark:text-purple-200 uppercase tracking-wider">
            Bulk AI Area & Component Analysis
          </h3>
        </div>

        {!disabled && (
          <button
            onClick={onAnalyseFullReport}
            disabled={analysisState.isAnalyzing}
            className="inline-flex items-center gap-1.5 rounded-xl bg-purple-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-purple-700 disabled:opacity-50 shadow-2xs transition-colors"
          >
            {analysisState.isAnalyzing ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Sparkles size={13} />
            )}
            <span>{analysisState.isAnalyzing ? 'Analyzing Report...' : 'Analyse All Areas with AI'}</span>
          </button>
        )}
      </div>

      {analysisState.isAnalyzing && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-purple-900 dark:text-purple-200">
            <span>{analysisState.statusMessage}</span>
            <span className="font-mono">{analysisState.progressPercent}%</span>
          </div>

          <div className="h-2 w-full bg-purple-200 rounded-full overflow-hidden dark:bg-purple-900">
            <div
              className="h-full bg-purple-600 transition-all duration-300"
              style={{ width: `${analysisState.progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {analysisState.error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs font-semibold text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200 flex items-center gap-2">
          <AlertTriangle size={15} className="shrink-0 text-rose-600" />
          <span>{analysisState.error}</span>
        </div>
      )}
    </div>
  );
};
