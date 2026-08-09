import React from 'react';
import { InspectionItem } from '../../../types';
import { Sparkles, Loader2, ShieldCheck } from 'lucide-react';

interface ComponentCommentaryPanelProps {
  item: InspectionItem;
  onChange: (patch: Partial<InspectionItem>) => void;
  onRegenerateComment?: () => Promise<void>;
  isGenerating?: boolean;
  disabled?: boolean;
}

export const ComponentCommentaryPanel: React.FC<ComponentCommentaryPanelProps> = ({
  item,
  onChange,
  onRegenerateComment,
  isGenerating = false,
  disabled = false,
}) => {
  const isReviewed = item.reviewStatus === 'reviewer_approved' || item.reviewStatus === 'analyst_reviewed';

  return (
    <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-slate-800">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
          Component Commentary
          {isReviewed && (
            <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400 font-semibold">
              <ShieldCheck size={12} />
              (Reviewed)
            </span>
          )}
        </span>

        {!disabled && onRegenerateComment && (
          <button
            type="button"
            onClick={onRegenerateComment}
            disabled={isGenerating || isReviewed}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-purple-600 hover:text-purple-800 dark:text-purple-400 disabled:opacity-50"
            title={isReviewed ? 'Commentary reviewed — unlock to regenerate' : 'Generate structured commentary with AI'}
          >
            {isGenerating ? (
              <Loader2 size={12} className="animate-spin text-purple-600" />
            ) : (
              <Sparkles size={12} className="text-purple-600" />
            )}
            <span>{item.comment ? 'Refine AI Comment' : 'Generate AI Comment'}</span>
          </button>
        )}
      </div>

      <textarea
        rows={2}
        value={item.comment || ''}
        onChange={(e) => onChange({ comment: e.target.value })}
        disabled={disabled || isReviewed}
        placeholder="Enter component observation commentary..."
        className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 disabled:opacity-75"
      />
    </div>
  );
};
