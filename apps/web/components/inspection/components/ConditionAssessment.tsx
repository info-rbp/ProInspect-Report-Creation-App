import React from 'react';
import type { ComponentConditionCategory } from '@pcr/domain';

interface ConditionAssessmentProps {
  value: ComponentConditionCategory;
  onChange: (category: ComponentConditionCategory) => void;
  disabled?: boolean;
}

const CONDITION_OPTIONS: { value: ComponentConditionCategory; label: string; badgeColor: string }[] = [
  { value: 'intact', label: 'Clean & Intact', badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300' },
  { value: 'minor_wear', label: 'Minor Wear / Fair', badgeColor: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300' },
  { value: 'repair_required', label: 'Repair Required', badgeColor: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300' },
  { value: 'replacement_recommended', label: 'Replace Recommended', badgeColor: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/50 dark:text-purple-300' },
  { value: 'unable_to_confirm', label: 'Unconfirmed', badgeColor: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300' },
  { value: 'not_applicable', label: 'N/A', badgeColor: 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400' },
];

export const ConditionAssessment: React.FC<ConditionAssessmentProps> = ({
  value,
  onChange,
  disabled = false,
}) => {
  return (
    <div>
      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
        Physical Condition
      </label>
      <select
        value={value || 'unable_to_confirm'}
        onChange={(e) => onChange(e.target.value as ComponentConditionCategory)}
        disabled={disabled}
        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
      >
        {CONDITION_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
};
