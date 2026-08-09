import React from 'react';
import { Room } from '../../types';
import { isOperationalItem } from '../../services/platform/propertySeedingService';
import { CheckCircle2, AlertTriangle, ArrowRight, Layers } from 'lucide-react';

interface AreaCompletenessPanelProps {
  area: Room;
  onFocusBlocker?: (componentId: string) => void;
}

export const AreaCompletenessPanel: React.FC<AreaCompletenessPanelProps> = ({
  area,
  onFocusBlocker,
}) => {
  const totalComponents = area.items.length;
  const unassessedItems = area.items.filter(
    (item) => item.conditionCategory === 'unable_to_confirm' || item.cleanlinessCategory === 'unable_to_confirm'
  );

  const untestedOperational = area.items.filter(
    (item) => isOperationalItem(item.name) && item.workingStatus === 'untested'
  );

  const defectsMissingPhotos = area.items.filter((item) => {
    const isDamaged =
      item.conditionCategory === 'repair_required' ||
      item.conditionCategory === 'replacement_recommended' ||
      item.workingStatus === 'not_working';
    const photoCount = (item.photoReferences || []).length;
    return isDamaged && photoCount === 0;
  });

  const totalBlockers = unassessedItems.length + defectsMissingPhotos.length;
  const isAreaComplete = totalBlockers === 0 && totalComponents > 0;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-900 space-y-3">
      <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 dark:border-slate-800">
        <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
          <Layers size={14} className="text-blue-600" />
          Area Completeness & Validation
        </span>

        {isAreaComplete ? (
          <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 size={14} />
            Ready for Review
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-600 dark:text-amber-400">
            <AlertTriangle size={14} />
            {totalBlockers} Issue(s) Pending
          </span>
        )}
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div className="rounded-xl bg-slate-50 p-2.5 border border-slate-100 dark:bg-slate-800 dark:border-slate-700">
          <span className="text-[10px] font-bold text-slate-500 uppercase block">Components</span>
          <span className="text-sm font-extrabold text-slate-800 dark:text-slate-100">
            {totalComponents - unassessedItems.length} / {totalComponents}
          </span>
        </div>

        <div className="rounded-xl bg-slate-50 p-2.5 border border-slate-100 dark:bg-slate-800 dark:border-slate-700">
          <span className="text-[10px] font-bold text-slate-500 uppercase block">Photographs</span>
          <span className="text-sm font-extrabold text-slate-800 dark:text-slate-100">
            {area.photos.length}
          </span>
        </div>

        <div className="rounded-xl bg-slate-50 p-2.5 border border-slate-100 dark:bg-slate-800 dark:border-slate-700">
          <span className="text-[10px] font-bold text-slate-500 uppercase block">Untested Operational</span>
          <span className={`text-sm font-extrabold ${untestedOperational.length > 0 ? 'text-amber-600' : 'text-slate-800 dark:text-slate-100'}`}>
            {untestedOperational.length}
          </span>
        </div>

        <div className="rounded-xl bg-slate-50 p-2.5 border border-slate-100 dark:bg-slate-800 dark:border-slate-700">
          <span className="text-[10px] font-bold text-slate-500 uppercase block">Defects w/o Evidence</span>
          <span className={`text-sm font-extrabold ${defectsMissingPhotos.length > 0 ? 'text-rose-600' : 'text-slate-800 dark:text-slate-100'}`}>
            {defectsMissingPhotos.length}
          </span>
        </div>
      </div>

      {/* List of Blockers with Click to Scroll */}
      {totalBlockers > 0 && onFocusBlocker && (
        <div className="space-y-1.5 pt-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
            Click an issue below to jump to component:
          </span>
          <div className="space-y-1">
            {unassessedItems.map((item) => (
              <button
                key={item.id}
                onClick={() => onFocusBlocker(item.id)}
                className="w-full flex items-center justify-between rounded-lg bg-amber-50/60 p-2 text-left text-xs text-amber-900 border border-amber-200/60 hover:bg-amber-100/80 transition-colors dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-900/40"
              >
                <span className="font-semibold flex items-center gap-1.5 truncate">
                  <AlertTriangle size={13} className="shrink-0 text-amber-600" />
                  {item.name} — Pending condition or cleanliness assessment
                </span>
                <ArrowRight size={13} className="shrink-0 text-amber-600" />
              </button>
            ))}

            {defectsMissingPhotos.map((item) => (
              <button
                key={item.id}
                onClick={() => onFocusBlocker(item.id)}
                className="w-full flex items-center justify-between rounded-lg bg-rose-50/60 p-2 text-left text-xs text-rose-900 border border-rose-200/60 hover:bg-rose-100/80 transition-colors dark:bg-rose-950/30 dark:text-rose-200 dark:border-rose-900/40"
              >
                <span className="font-semibold flex items-center gap-1.5 truncate">
                  <AlertTriangle size={13} className="shrink-0 text-rose-600" />
                  {item.name} — Defect recorded without photograph
                </span>
                <ArrowRight size={13} className="shrink-0 text-rose-600" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
