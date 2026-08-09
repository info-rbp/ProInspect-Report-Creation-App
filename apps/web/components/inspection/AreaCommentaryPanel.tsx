import React from 'react';
import { InspectionItem, Photo } from '../../types';
import { Sparkles, Loader2, FileText } from 'lucide-react';

interface AreaCommentaryPanelProps {
  areaName: string;
  overallComment: string;
  items: InspectionItem[];
  photos: Photo[];
  onChange: (comment: string) => void;
  onGenerateOverall?: () => Promise<void>;
  isGenerating?: boolean;
  disabled?: boolean;
}

export const AreaCommentaryPanel: React.FC<AreaCommentaryPanelProps> = ({
  areaName,
  overallComment,
  onChange,
  onGenerateOverall,
  isGenerating = false,
  disabled = false,
}) => {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-900 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
          <FileText size={14} className="text-blue-600" />
          Overall Area Summary & Observations
        </span>

        {!disabled && onGenerateOverall && (
          <button
            type="button"
            onClick={onGenerateOverall}
            disabled={isGenerating}
            className="inline-flex items-center gap-1.5 rounded-xl bg-purple-50 dark:bg-purple-950/60 border border-purple-200 dark:border-purple-900 px-3 py-1 text-xs font-semibold text-purple-700 dark:text-purple-300 hover:bg-purple-100 disabled:opacity-50"
          >
            {isGenerating ? (
              <Loader2 size={13} className="animate-spin text-purple-600" />
            ) : (
              <Sparkles size={13} className="text-purple-600" />
            )}
            <span>Generate Area Summary</span>
          </button>
        )}
      </div>

      <textarea
        rows={3}
        value={overallComment || ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={`Enter overall summary observations for ${areaName}...`}
        className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
      />
    </div>
  );
};
