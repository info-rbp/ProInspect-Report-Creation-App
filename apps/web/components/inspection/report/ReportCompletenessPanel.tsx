import React from 'react';
import { Link } from 'react-router-dom';
import { ReportData } from '../../../types';
import { CheckCircle2, AlertTriangle, Building, ShieldCheck } from 'lucide-react';

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
      totalComponents += 1;
      const isAssessed = item.conditionCategory !== 'unable_to_confirm' && item.cleanlinessCategory !== 'unable_to_confirm';
      if (isAssessed) assessedComponents += 1; else areaAssessed = false;
      const isException = item.conditionCategory === 'repair_required' || item.conditionCategory === 'replacement_recommended' || item.workingStatus === 'not_working' || Boolean(item.defects?.length);
      if (isException && !(item.photoReferences || []).length) defectsWithoutEvidenceCount += 1;
    });
    if (!areaAssessed) unassessedAreaCount += 1;
  });

  const draftFieldsComplete = unassessedAreaCount === 0 && defectsWithoutEvidenceCount === 0 && totalComponents > 0;
  const percentComplete = totalComponents > 0 ? Math.round((assessedComponents / totalComponents) * 100) : 0;

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col justify-between gap-2 border-b border-slate-100 pb-2.5 dark:border-slate-800 sm:flex-row sm:items-center">
        <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
          <Building size={14} className="text-blue-600" /> Draft Field Completeness
        </span>
        {draftFieldsComplete ? (
          <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 dark:text-emerald-400"><CheckCircle2 size={14} /> Draft fields complete</span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-600 dark:text-amber-400"><AlertTriangle size={14} /> {percentComplete}% assessed</span>
        )}
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs font-medium text-slate-600 dark:text-slate-400"><span>Assessed Components ({assessedComponents} / {totalComponents})</span><span className="font-mono font-bold">{percentComplete}%</span></div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className={`h-full transition-all duration-300 ${draftFieldsComplete ? 'bg-emerald-500' : 'bg-blue-600'}`} style={{ width: `${percentComplete}%` }} /></div>
      </div>

      <div className="grid grid-cols-2 gap-2 pt-1 text-xs sm:grid-cols-4">
        <div className="rounded-xl border border-slate-100 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800"><span className="block text-[10px] font-bold uppercase text-slate-500">Total Areas</span><span className="text-sm font-extrabold text-slate-800 dark:text-slate-100">{areas.length}</span></div>
        <div className="rounded-xl border border-slate-100 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800"><span className="block text-[10px] font-bold uppercase text-slate-500">Evidence Photos</span><span className="text-sm font-extrabold text-slate-800 dark:text-slate-100">{totalPhotos}</span></div>
        <div className="rounded-xl border border-slate-100 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800"><span className="block text-[10px] font-bold uppercase text-slate-500">Pending Areas</span><span className={`text-sm font-extrabold ${unassessedAreaCount > 0 ? 'text-amber-600' : 'text-slate-800 dark:text-slate-100'}`}>{unassessedAreaCount}</span></div>
        <div className="rounded-xl border border-slate-100 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800"><span className="block text-[10px] font-bold uppercase text-slate-500">Exceptions Missing Evidence</span><span className={`text-sm font-extrabold ${defectsWithoutEvidenceCount > 0 ? 'text-rose-600' : 'text-slate-800 dark:text-slate-100'}`}>{defectsWithoutEvidenceCount}</span></div>
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-[11px] text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100">
        <ShieldCheck size={15} className="mt-0.5 shrink-0" />
        <div>
          This panel measures draft field completion only. Issuance readiness is determined by the authoritative Report Console, including Template Version, testing, QC, analysis, human review, comparison, recipient response and final-artifact gates.
          <div className="mt-1"><Link to={`/app/admin/reports/${report.id}`} className="font-bold underline">Open authoritative readiness</Link></div>
        </div>
      </div>
    </div>
  );
};
