import React, { useState } from 'react';
import type { InspectionItem, Photo } from '../../../types';
import { generateExitComparison } from '../../../services/geminiService';
import { AlertTriangle, CheckCircle2, HelpCircle, RefreshCw, ShieldAlert, XCircle } from 'lucide-react';

interface ExitComponentComparisonPanelProps {
  item: InspectionItem;
  areaName: string;
  areaPhotos?: Photo[];
  onChange: (patch: Partial<InspectionItem>) => void;
  disabled?: boolean;
}

function statusBadge(status?: string) {
  switch (status) {
    case 'material_change':
    case 'deteriorated':
      return <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800 dark:border-amber-800 dark:bg-amber-950/80 dark:text-amber-300"><AlertTriangle size={12} /> Material Difference</span>;
    case 'no_material_change':
    case 'unchanged':
      return <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300"><CheckCircle2 size={12} /> No Material Change</span>;
    case 'unable_to_compare':
      return <span className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"><HelpCircle size={12} /> Unable to Compare</span>;
    default:
      return <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">Not Compared</span>;
  }
}

export const ExitComponentComparisonPanel: React.FC<ExitComponentComparisonPanelProps> = ({
  item,
  areaName,
  areaPhotos = [],
  onChange,
  disabled = false,
}) => {
  const [comparing, setComparing] = useState(false);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const baseline = item.baselineComponentData;

  const runComparison = async () => {
    if (!baseline || disabled) return;
    setComparing(true);
    setComparisonError(null);
    try {
      const result = await generateExitComparison(areaName, item, areaPhotos);
      onChange({
        comparisonStatus: result.comparisonStatus || 'unable_to_compare',
        presenceComparison: result.presenceComparison,
        conditionComparison: result.conditionComparison,
        cleanlinessComparison: result.cleanlinessComparison,
        workingComparison: result.workingComparison,
        comparisonCommentary: result.comparisonCommentary || '',
        evidencePairs: result.evidencePairs || [],
        comparisonConfidence: result.comparisonConfidence ?? result.aiConfidence,
        comparisonUncertainty: result.comparisonUncertainty,
        comparisonReviewStatus: 'suggested',
        comparisonMethod: 'stable_id',
      });
    } catch (error) {
      setComparisonError(error instanceof Error ? error.message : 'Entry-to-Exit comparison could not be completed.');
    } finally {
      setComparing(false);
    }
  };

  const confirmUnableToCompare = () => {
    onChange({
      comparisonStatus: 'unable_to_compare',
      comparisonReviewStatus: 'confirmed',
      comparisonMethod: 'stable_id',
      comparisonUncertainty: item.comparisonUncertainty || 'No component with this stable identity was available in the selected Entry baseline.',
      comparisonCommentary: item.comparisonCommentary || 'This Exit component could not be directly compared with the selected Entry baseline because an equivalent baseline component was not recorded.',
    });
  };

  if (!baseline) {
    return (
      <div className="space-y-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3.5 text-xs dark:border-slate-700 dark:bg-slate-900/40">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300"><HelpCircle size={15} /><span className="font-semibold">No matching Entry baseline component</span></div>
          {statusBadge(item.comparisonStatus)}
        </div>
        <p className="text-slate-500">The report is linked to an immutable Entry baseline, but this stable component identity was not present in that baseline. Current Exit condition remains independently assessable.</p>
        <textarea
          rows={2}
          value={item.comparisonCommentary || ''}
          onChange={(event) => onChange({ comparisonCommentary: event.target.value, comparisonReviewStatus: 'edited' })}
          disabled={disabled}
          placeholder="Record the factual limitation or current-only observation."
          className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-xs dark:border-slate-700 dark:bg-slate-900"
        />
        {!disabled && item.comparisonReviewStatus !== 'confirmed' && item.comparisonReviewStatus !== 'edited' ? (
          <button type="button" onClick={confirmUnableToCompare} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-700"><CheckCircle2 size={13} /> Confirm unable to compare</button>
        ) : null}
        {item.comparisonReviewStatus === 'confirmed' || item.comparisonReviewStatus === 'edited' ? <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700"><CheckCircle2 size={13} /> Human reviewed</div> : null}
      </div>
    );
  }

  const reviewed = item.comparisonReviewStatus === 'confirmed' || item.comparisonReviewStatus === 'edited';

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 dark:border-slate-800 dark:bg-slate-900/60">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200/80 pb-2 dark:border-slate-800">
        <div className="flex items-center gap-2"><ShieldAlert size={15} className="text-indigo-600 dark:text-indigo-400" /><h5 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-white">Entry Baseline vs Exit Comparison</h5></div>
        {statusBadge(item.comparisonStatus)}
      </div>

      <div className="grid grid-cols-1 gap-3 text-xs md:grid-cols-2">
        <div className="space-y-1.5 rounded-lg border border-slate-200 bg-white p-3 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between"><span className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">Entry Baseline</span><span className="text-[10px] text-slate-400">Immutable version</span></div>
          <div className="space-y-1 text-[11px] text-slate-600 dark:text-slate-300">
            <div><strong>Condition:</strong> {baseline.conditionCategory?.replaceAll('_', ' ') || 'N/A'}</div>
            <div><strong>Cleanliness:</strong> {baseline.cleanlinessCategory?.replaceAll('_', ' ') || 'N/A'}</div>
            <div><strong>Working:</strong> {baseline.workingStatus?.replaceAll('_', ' ') || 'N/A'}</div>
            {baseline.defects?.length ? <div><strong className="text-amber-700">Defects:</strong> {baseline.defects.join(', ')}</div> : null}
            {baseline.commentary ? <div className="mt-1.5 rounded border border-slate-100 bg-slate-50 p-2 italic text-slate-500 dark:border-slate-800 dark:bg-slate-950">{baseline.commentary}</div> : null}
          </div>
        </div>

        <div className="space-y-1.5 rounded-lg border border-slate-200 bg-white p-3 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between"><span className="text-[11px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-400">Current Exit</span><span className="text-[10px] text-slate-400">Current assessment</span></div>
          <div className="space-y-1 text-[11px] text-slate-600 dark:text-slate-300">
            <div><strong>Condition:</strong> {item.conditionCategory?.replaceAll('_', ' ')}</div>
            <div><strong>Cleanliness:</strong> {item.cleanlinessCategory?.replaceAll('_', ' ')}</div>
            <div><strong>Working:</strong> {item.workingStatus?.replaceAll('_', ' ')}</div>
            {item.defects?.length ? <div><strong className="text-rose-700">Defects:</strong> {item.defects.join(', ')}</div> : null}
          </div>
        </div>
      </div>

      {!disabled ? (
        <button type="button" onClick={() => void runComparison()} disabled={comparing} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
          <RefreshCw size={13} className={comparing ? 'animate-spin' : ''} /> {item.comparisonStatus === 'not_compared' ? 'Run structured comparison' : 'Re-run structured comparison'}
        </button>
      ) : null}
      {comparisonError ? <div className="text-[11px] text-rose-700">{comparisonError}</div> : null}

      <div className="space-y-1">
        <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300">Factual Entry-to-Exit Comparison Commentary</label>
        <textarea
          rows={2}
          value={item.comparisonCommentary || ''}
          onChange={(event) => onChange({ comparisonCommentary: event.target.value, comparisonReviewStatus: item.comparisonStatus === 'not_compared' ? item.comparisonReviewStatus : 'edited' })}
          disabled={disabled}
          placeholder="Objective Australian English comparison description without causation or liability statements..."
          className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-xs text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
        <p className="text-[10px] italic text-slate-400">Comparison commentary records observable differences only. It must not assign causation, tenant responsibility, liability or bond outcomes.</p>
      </div>

      {item.comparisonStatus && item.comparisonStatus !== 'not_compared' && !disabled ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-2 dark:border-slate-800">
          <button type="button" onClick={() => onChange({ comparisonReviewStatus: 'confirmed' })} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-700"><CheckCircle2 size={13} /> Confirm comparison</button>
          <button type="button" onClick={() => onChange({ comparisonReviewStatus: 'rejected' })} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300"><XCircle size={13} /> Needs rework</button>
          <span className={`text-[11px] font-semibold ${reviewed ? 'text-emerald-700' : item.comparisonReviewStatus === 'rejected' ? 'text-rose-700' : 'text-amber-700'}`}>Review: {item.comparisonReviewStatus?.replaceAll('_', ' ') || 'suggested'}</span>
        </div>
      ) : null}
    </div>
  );
};
