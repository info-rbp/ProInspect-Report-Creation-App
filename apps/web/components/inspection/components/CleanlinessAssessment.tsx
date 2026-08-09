import React from 'react';
import type { ComponentCleanlinessCategory } from '@pcr/domain';

interface CleanlinessAssessmentProps {
  value: ComponentCleanlinessCategory;
  onChange: (category: ComponentCleanlinessCategory) => void;
  disabled?: boolean;
}

const CLEANLINESS_OPTIONS: { value: ComponentCleanlinessCategory; label: string }[] = [
  { value: 'clean', label: 'Clean' },
  { value: 'requires_cleaning', label: 'Requires Cleaning' },
  { value: 'stained', label: 'Stained / Marked' },
  { value: 'unable_to_confirm', label: 'Unconfirmed' },
  { value: 'not_applicable', label: 'N/A' },
];

export const CleanlinessAssessment: React.FC<CleanlinessAssessmentProps> = ({
  value,
  onChange,
  disabled = false,
}) => {
  return (
    <div>
      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
        Cleanliness
      </label>
      <select
        value={value || 'unable_to_confirm'}
        onChange={(e) => onChange(e.target.value as ComponentCleanlinessCategory)}
        disabled={disabled}
        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
      >
        {CLEANLINESS_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
};
