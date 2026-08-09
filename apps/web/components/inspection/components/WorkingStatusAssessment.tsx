import React from 'react';
import type { ComponentWorkingStatus } from '@pcr/domain';

interface WorkingStatusAssessmentProps {
  value: ComponentWorkingStatus;
  onChange: (status: ComponentWorkingStatus) => void;
  disabled?: boolean;
}

const WORKING_OPTIONS: { value: ComponentWorkingStatus; label: string }[] = [
  { value: 'operation_confirmed', label: 'Operation Confirmed' },
  { value: 'appears_operational', label: 'Appears Operational' },
  { value: 'untested', label: 'Untested' },
  { value: 'not_working', label: 'Not Working / Defective' },
  { value: 'unable_to_confirm', label: 'Unable to Confirm' },
  { value: 'not_applicable', label: 'N/A (Static Item)' },
];

export const WorkingStatusAssessment: React.FC<WorkingStatusAssessmentProps> = ({
  value,
  onChange,
  disabled = false,
}) => {
  return (
    <div>
      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
        Working / Operational Status
      </label>
      <select
        value={value || 'untested'}
        onChange={(e) => onChange(e.target.value as ComponentWorkingStatus)}
        disabled={disabled}
        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
      >
        {WORKING_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
};
