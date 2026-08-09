import React from 'react';
import { Room } from '../../types';
import { Trash2, ChevronDown, ChevronUp, CheckCircle2, AlertTriangle, Image as ImageIcon, Layers } from 'lucide-react';

interface AreaHeaderProps {
  area: Room;
  onDeleteArea?: () => void;
  onToggleExpand?: () => void;
  isExpanded?: boolean;
  disabled?: boolean;
}

export const AreaHeader: React.FC<AreaHeaderProps> = ({
  area,
  onDeleteArea,
  onToggleExpand,
  isExpanded = true,
  disabled = false,
}) => {
  const totalComponents = area.items.length;
  const assessedComponents = area.items.filter(
    (item) => item.conditionCategory !== 'unable_to_confirm' && item.cleanlinessCategory !== 'unable_to_confirm'
  ).length;

  const totalPhotos = area.photos.length;
  const isComplete = assessedComponents === totalComponents && totalComponents > 0;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3.5">
      <div className="flex items-center gap-3">
        {onToggleExpand && (
          <button
            type="button"
            onClick={onToggleExpand}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
        )}

        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              {area.name}
            </h2>
            {isComplete ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-900 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 size={12} />
                Area Complete
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-900 px-2.5 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                <AlertTriangle size={12} />
                {totalComponents - assessedComponents} Pending
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 mt-1 text-xs text-slate-500 dark:text-slate-400">
            <span className="flex items-center gap-1">
              <Layers size={13} className="text-slate-400" />
              {assessedComponents} / {totalComponents} Components
            </span>
            <span>•</span>
            <span className="flex items-center gap-1">
              <ImageIcon size={13} className="text-slate-400" />
              {totalPhotos} Photos
            </span>
          </div>
        </div>
      </div>

      {!disabled && onDeleteArea && (
        <button
          type="button"
          onClick={onDeleteArea}
          className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300"
        >
          <Trash2 size={13} />
          <span>Delete Area</span>
        </button>
      )}
    </div>
  );
};
