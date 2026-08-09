import React from 'react';
import { ReportData } from '../../../types';
import { CheckCircle2, AlertTriangle, Building } from 'lucide-react';

interface ReportCompletenessPanelProps {
  report: ReportData;
}

export const ReportCompletenessPanel: React.FC<ReportCompletenessPanelProps> = ({ report }) => {
  const areas = report.rooms || [];

  let totalComponents = 0;
  let assessedComponents = 0;
  let totalPhotos = 0;
  let unassessedAreaCount = 0;
  let defectsWithoutEvidenceCount = 0;

  areas.forEach((area) => {
    totalPhotos += area.photos.length;
    let areaAssessed = true;

    area.items.forEach((item) => {
      totalComponents++;
      const isAssessed =
        item.conditionCategory !== 'unable_to_confirm' &&
        item.cleanlinessCategory !== 'unable_to_confirm';

      if (isAssessed) {
        assessedComponents++;
      } else {
        areaAssessed = false;
      }

      const isDamaged =
        item.conditionCategory === 'repair_required' ||
        item.conditionCategory === 'replacement_recommended' ||
        item.workingStatus === 'not_working';
      const hasPhoto = (item.photoReferences || []).length > 0;

      if (isDamaged && !hasPhoto) {
        defectsWithoutEvidenceCount++;
      }
    });

    if (!areaAssessed) {
      unassessedAreaCount++;
    }
  });

  const isReportComplete =
    unassessedAreaCount === 0 &&
    defectsWithoutEvidenceCount === 0 &&
    totalComponents > 0;

  const percentComplete =
    totalComponents > 0 ? Math.round((assessedComponents / totalComponents) * 100) : 0;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-900 space-y-3">
      <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 dark:border-slate-800">
        <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 uppercase tracking-wider">
          <Building size={14} className="text-blue-600" />
          Overall Report Completeness & Audit Status
        </span>

        {isReportComplete ? (
          <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 size={14} />
            100% Complete — Ready for Issuance
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-600 dark:text-amber-400">
            <AlertTriangle size={14} />
            {percentComplete}% Complete
          </span>
        )}
      </div>

      {/* Progress Bar */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 font-medium">
          <span>Assessed Components ({assessedComponents} / {totalComponents})</span>
          <span className="font-mono font-bold">{percentComplete}%</span>
        </div>
        <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden dark:bg-slate-800">
          <div
            className={`h-full transition-all duration-300 ${
              isReportComplete ? 'bg-emerald-500' : 'bg-blue-600'
            }`}
            style={{ width: `${percentComplete}%` }}
          />
        </div>
      </div>

      {/* Summary Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs pt-1">
        <div className="rounded-xl bg-slate-50 p-2.5 border border-slate-100 dark:bg-slate-800 dark:border-slate-700">
          <span className="text-[10px] font-bold text-slate-500 uppercase block">Total Areas</span>
          <span className="text-sm font-extrabold text-slate-800 dark:text-slate-100">{areas.length}</span>
        </div>

        <div className="rounded-xl bg-slate-50 p-2.5 border border-slate-100 dark:bg-slate-800 dark:border-slate-700">
          <span className="text-[10px] font-bold text-slate-500 uppercase block">Total Evidence Photos</span>
          <span className="text-sm font-extrabold text-slate-800 dark:text-slate-100">{totalPhotos}</span>
        </div>

        <div className="rounded-xl bg-slate-50 p-2.5 border border-slate-100 dark:bg-slate-800 dark:border-slate-700">
          <span className="text-[10px] font-bold text-slate-500 uppercase block">Pending Areas</span>
          <span className={`text-sm font-extrabold ${unassessedAreaCount > 0 ? 'text-amber-600' : 'text-slate-800 dark:text-slate-100'}`}>
            {unassessedAreaCount}
          </span>
        </div>

        <div className="rounded-xl bg-slate-50 p-2.5 border border-slate-100 dark:bg-slate-800 dark:border-slate-700">
          <span className="text-[10px] font-bold text-slate-500 uppercase block">Defects Missing Photos</span>
          <span className={`text-sm font-extrabold ${defectsWithoutEvidenceCount > 0 ? 'text-rose-600' : 'text-slate-800 dark:text-slate-100'}`}>
            {defectsWithoutEvidenceCount}
          </span>
        </div>
      </div>
    </div>
  );
};
