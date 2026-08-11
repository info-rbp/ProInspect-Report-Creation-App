import React from 'react';
import { InspectionItem, Photo } from '../../../types';
import { ShieldAlert, CheckCircle2, AlertTriangle, HelpCircle } from 'lucide-react';

interface ExitComponentComparisonPanelProps {
  item: InspectionItem;
  areaPhotos?: Photo[];
  onChange: (patch: Partial<InspectionItem>) => void;
  disabled?: boolean;
}

export const ExitComponentComparisonPanel: React.FC<ExitComponentComparisonPanelProps> = ({
  item,
  onChange,
  disabled = false,
}) => {
  const baseline = item.baselineComponentData;
  if (!baseline) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-3 bg-slate-50 dark:bg-slate-900/40 text-xs text-slate-500">
        <span className="font-semibold text-slate-700 dark:text-slate-300">No Entry Baseline Data Attached:</span> Exit assessment is operating without a linked Entry baseline component.
      </div>
    );
  }

  const getStatusBadge = (status?: string) => {
    switch (status) {
      case 'material_change':
      case 'deteriorated':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
            <AlertTriangle size={12} /> Material Difference
          </span>
        );
      case 'no_material_change':
      case 'unchanged':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
            <CheckCircle2 size={12} /> No Material Change
          </span>
        );
      case 'unable_to_compare':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-300 dark:border-slate-700">
            <HelpCircle size={12} /> Unable to Compare
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
            Not Compared
          </span>
        );
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60 p-3.5 space-y-3">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200/80 dark:border-slate-800 pb-2">
        <div className="flex items-center gap-2">
          <ShieldAlert size={15} className="text-indigo-600 dark:text-indigo-400" />
          <h5 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
            Entry Baseline vs Exit Comparison
          </h5>
        </div>
        {getStatusBadge(item.comparisonStatus)}
      </div>

      {/* Grid comparing Baseline vs Exit */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
        {/* Entry Baseline Card */}
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 space-y-1.5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="font-bold text-slate-700 dark:text-slate-300 text-[11px] uppercase tracking-wider">
              Entry Baseline
            </span>
            <span className="text-[10px] text-slate-400">Recorded Condition</span>
          </div>
          <div className="space-y-1 text-slate-600 dark:text-slate-300 text-[11px]">
            <div><strong className="text-slate-800 dark:text-slate-200">Condition:</strong> {baseline.conditionCategory?.replace('_', ' ') || 'N/A'}</div>
            <div><strong className="text-slate-800 dark:text-slate-200">Cleanliness:</strong> {baseline.cleanlinessCategory?.replace('_', ' ') || 'N/A'}</div>
            <div><strong className="text-slate-800 dark:text-slate-200">Working:</strong> {baseline.workingStatus?.replace('_', ' ') || 'N/A'}</div>
            {baseline.defects?.length > 0 && (
              <div><strong className="text-amber-700 dark:text-amber-400">Defects:</strong> {baseline.defects.join(', ')}</div>
            )}
            {baseline.commentary && (
              <div className="mt-1.5 italic text-slate-500 bg-slate-50 dark:bg-slate-950 p-2 rounded border border-slate-100 dark:border-slate-800">
                "{baseline.commentary}"
              </div>
            )}
          </div>
        </div>

        {/* Current Exit Assessment Card */}
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 space-y-1.5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="font-bold text-indigo-700 dark:text-indigo-400 text-[11px] uppercase tracking-wider">
              Current Exit Condition
            </span>
            <span className="text-[10px] text-slate-400">Exit Assessment</span>
          </div>
          <div className="space-y-1 text-slate-600 dark:text-slate-300 text-[11px]">
            <div><strong className="text-slate-800 dark:text-slate-200">Condition:</strong> {item.conditionCategory?.replace('_', ' ')}</div>
            <div><strong className="text-slate-800 dark:text-slate-200">Cleanliness:</strong> {item.cleanlinessCategory?.replace('_', ' ')}</div>
            <div><strong className="text-slate-800 dark:text-slate-200">Working:</strong> {item.workingStatus?.replace('_', ' ')}</div>
            {item.defects?.length > 0 && (
              <div><strong className="text-rose-700 dark:text-rose-400">Defects:</strong> {item.defects.join(', ')}</div>
            )}
          </div>
        </div>
      </div>

      {/* Comparison Findings Commentary Input */}
      <div className="space-y-1">
        <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300">
          Factual Entry-to-Exit Comparison Commentary
        </label>
        <textarea
          rows={2}
          value={item.comparisonCommentary || ''}
          onChange={(e) => onChange({ comparisonCommentary: e.target.value })}
          disabled={disabled}
          placeholder="Objective Australian English comparison description without causation or liability statements..."
          className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2.5 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
        />
        <p className="text-[10px] text-slate-400 italic">
          Note: Comparison commentary must remain purely factual and avoid causation or liability claims (e.g. avoid "tenant caused", "bond deduction").
        </p>
      </div>
    </div>
  );
};
