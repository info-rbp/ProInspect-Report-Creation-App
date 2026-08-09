import React from 'react';
import { Save, Eye, FolderOpen, Loader2, CheckCircle2, Lock } from 'lucide-react';

interface ReportActionBarProps {
  onSaveDraft: () => void;
  onPreview: () => void;
  onBackToList: () => void;
  isSaving?: boolean;
  isDirty?: boolean;
  readOnly?: boolean;
}

export const ReportActionBar: React.FC<ReportActionBarProps> = ({
  onSaveDraft,
  onPreview,
  onBackToList,
  isSaving = false,
  isDirty = false,
  readOnly = false,
}) => {
  return (
    <div className="sticky bottom-4 z-30 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/95 backdrop-blur-md p-4 shadow-xl dark:border-slate-800 dark:bg-slate-900/95">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBackToList}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        >
          <FolderOpen size={15} />
          <span>Return to Reports</span>
        </button>

        {/* Dirty State Indicator */}
        {!readOnly && (
          <span className="text-xs font-semibold flex items-center gap-1.5">
            {isDirty ? (
              <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                Unsaved changes
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 size={13} />
                All changes saved
              </span>
            )}
          </span>
        )}

        {readOnly && (
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500">
            <Lock size={13} />
            Report Immutable / Locked
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPreview}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 shadow-2xs"
        >
          <Eye size={15} className="text-blue-600" />
          <span>Preview Report PDF</span>
        </button>

        {!readOnly && (
          <button
            type="button"
            onClick={onSaveDraft}
            disabled={isSaving}
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-5 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50 shadow-md transition-colors"
          >
            {isSaving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            <span>{isSaving ? 'Saving Draft...' : 'Save Draft'}</span>
          </button>
        )}
      </div>
    </div>
  );
};
