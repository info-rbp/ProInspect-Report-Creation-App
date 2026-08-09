import React from 'react';
import { InspectionItem } from '../../../types';

interface ComponentDescriptionFieldsProps {
  item: InspectionItem;
  onChange: (patch: Partial<InspectionItem>) => void;
  disabled?: boolean;
}

export const ComponentDescriptionFields: React.FC<ComponentDescriptionFieldsProps> = ({
  item,
  onChange,
  disabled = false,
}) => {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
      <div>
        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
          Material
        </label>
        <input
          type="text"
          value={item.material || ''}
          onChange={(e) => onChange({ material: e.target.value })}
          placeholder="e.g. Timber, Tile, Glass"
          disabled={disabled}
          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        />
      </div>

      <div>
        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
          Colour / Finish
        </label>
        <input
          type="text"
          value={item.colour || ''}
          onChange={(e) => onChange({ colour: e.target.value })}
          placeholder="e.g. White Satin, Chrome"
          disabled={disabled}
          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        />
      </div>

      <div>
        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
          Sub-Component
        </label>
        <input
          type="text"
          value={item.subComponent || ''}
          onChange={(e) => onChange({ subComponent: e.target.value })}
          placeholder="e.g. Handles, Seals"
          disabled={disabled}
          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        />
      </div>

      <div>
        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
          Quantity
        </label>
        <input
          type="number"
          min={1}
          value={item.quantity ?? 1}
          onChange={(e) => onChange({ quantity: parseInt(e.target.value, 10) || 1 })}
          disabled={disabled}
          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-800 focus:bg-white focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        />
      </div>
    </div>
  );
};
