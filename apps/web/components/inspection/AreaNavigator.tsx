import React, { useState } from 'react';
import { Room } from '../../types';
import { ROOM_TYPES } from '../../utils';
import { Building, CheckCircle2, AlertTriangle, ChevronRight, Menu } from 'lucide-react';

interface AreaNavigatorProps {
  areas: Room[];
  activeAreaId: string;
  onSelectArea: (areaId: string) => void;
  onAddArea: (areaName: string) => void;
  disabled?: boolean;
}

export const AreaNavigator: React.FC<AreaNavigatorProps> = ({
  areas,
  activeAreaId,
  onSelectArea,
  onAddArea,
  disabled = false,
}) => {
  const [selectedTemplate, setSelectedTemplate] = useState<string>(ROOM_TYPES[0]);
  const [customName, setCustomName] = useState('');
  const [isAddingCustom, setIsAddingCustom] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  const handleAddTemplate = () => {
    if (!selectedTemplate) return;
    onAddArea(selectedTemplate);
  };

  const handleAddCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customName.trim()) return;
    onAddArea(customName.trim());
    setCustomName('');
    setIsAddingCustom(false);
  };

  return (
    <div>
      {/* Mobile Toggle Button */}
      <div className="md:hidden mb-3">
        <button
          onClick={() => setIsMobileOpen(!isMobileOpen)}
          className="w-full flex items-center justify-between rounded-xl bg-slate-100 p-3 text-xs font-bold text-slate-800 dark:bg-slate-800 dark:text-slate-200"
        >
          <span className="flex items-center gap-2">
            <Menu size={16} />
            Inspection Areas ({areas.length})
          </span>
          <ChevronRight size={16} className={`transition-transform ${isMobileOpen ? 'rotate-90' : ''}`} />
        </button>
      </div>

      {/* Navigation Container (Sidebar on desktop, Collapsible on mobile) */}
      <div className={`${isMobileOpen ? 'block' : 'hidden md:block'} space-y-4`}>
        <div className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-2xs dark:border-slate-800 dark:bg-slate-900 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 dark:border-slate-800">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Building size={14} className="text-blue-600" />
              Inspection Areas ({areas.length})
            </span>
          </div>

          {/* Area List */}
          <div className="space-y-1.5 max-h-[60vh] overflow-y-auto pr-1">
            {areas.map((area) => {
              const isActive = area.id === activeAreaId;
              const totalComps = area.items.length;
              const assessedComps = area.items.filter(
                (item) => item.conditionCategory !== 'unable_to_confirm' && item.cleanlinessCategory !== 'unable_to_confirm'
              ).length;
              const isComplete = assessedComps === totalComps && totalComps > 0;

              return (
                <button
                  key={area.id}
                  onClick={() => {
                    onSelectArea(area.id);
                    setIsMobileOpen(false);
                  }}
                  className={`w-full flex items-center justify-between rounded-xl p-3 text-left transition-all ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-md font-bold'
                      : 'bg-slate-50 hover:bg-slate-100 text-slate-800 dark:bg-slate-800/60 dark:hover:bg-slate-800 dark:text-slate-200'
                  }`}
                >
                  <div className="min-w-0 pr-2">
                    <span className="text-xs truncate block">{area.name}</span>
                    <span className={`text-[10px] block mt-0.5 ${isActive ? 'text-blue-100' : 'text-slate-500'}`}>
                      {assessedComps}/{totalComps} items • {area.photos.length} photos
                    </span>
                  </div>

                  <div className="shrink-0">
                    {isComplete ? (
                      <CheckCircle2 size={16} className={isActive ? 'text-white' : 'text-emerald-500'} />
                    ) : (
                      <AlertTriangle size={16} className={isActive ? 'text-blue-200' : 'text-amber-500'} />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Add Area Controls */}
          {!disabled && (
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                Add Inspection Area
              </span>

              <div className="flex gap-1.5">
                <select
                  value={selectedTemplate}
                  onChange={(e) => setSelectedTemplate(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-800 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  {ROOM_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleAddTemplate}
                  className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 shrink-0 dark:bg-slate-700"
                >
                  Add
                </button>
              </div>

              {!isAddingCustom ? (
                <button
                  type="button"
                  onClick={() => setIsAddingCustom(true)}
                  className="text-[11px] font-semibold text-blue-600 hover:text-blue-800 dark:text-blue-400 block"
                >
                  + Add Custom Area Name
                </button>
              ) : (
                <form onSubmit={handleAddCustom} className="flex gap-1.5 pt-1">
                  <input
                    type="text"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    placeholder="Custom area name..."
                    className="w-full rounded-xl border border-blue-500 bg-white px-2.5 py-1 text-xs text-slate-800 focus:outline-none dark:bg-slate-800 dark:text-slate-200"
                  />
                  <button
                    type="submit"
                    disabled={!customName.trim()}
                    className="rounded-xl bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    Save
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
