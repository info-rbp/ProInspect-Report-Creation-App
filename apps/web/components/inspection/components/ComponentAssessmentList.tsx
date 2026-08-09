import React, { useState } from 'react';
import { InspectionItem, Photo } from '../../../types';
import { ComponentAssessmentCard } from './ComponentAssessmentCard';
import { createSeededItem } from '../../../services/platform/propertySeedingService';
import { Plus, Search } from 'lucide-react';

interface ComponentAssessmentListProps {
  areaName: string;
  items: InspectionItem[];
  areaPhotos: Photo[];
  onUpdateComponent: (componentId: string, patch: Partial<InspectionItem>) => void;
  onAddComponent: (newItem: InspectionItem) => void;
  onRemoveComponent: (componentId: string) => void;
  onRegenerateComment?: (component: InspectionItem) => Promise<void>;
  loadingItems?: Record<string, string>;
  disabled?: boolean;
}

export const ComponentAssessmentList: React.FC<ComponentAssessmentListProps> = ({
  areaName,
  items,
  areaPhotos,
  onUpdateComponent,
  onAddComponent,
  onRemoveComponent,
  onRegenerateComment,
  loadingItems = {},
  disabled = false,
}) => {
  const [filterMode, setFilterMode] = useState<'all' | 'incomplete' | 'defects'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [newComponentName, setNewComponentName] = useState('');
  const [isAddingCustom, setIsAddingCustom] = useState(false);

  const filteredItems = items.filter((item) => {
    const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;

    if (filterMode === 'incomplete') {
      return (
        item.conditionCategory === 'unable_to_confirm' ||
        item.cleanlinessCategory === 'unable_to_confirm' ||
        item.workingStatus === 'untested'
      );
    }
    if (filterMode === 'defects') {
      return (
        item.conditionCategory === 'repair_required' ||
        item.conditionCategory === 'replacement_recommended' ||
        item.workingStatus === 'not_working' ||
        (item.defects && item.defects.length > 0)
      );
    }
    return true;
  });

  const handleAddCustomComponent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComponentName.trim()) return;
    const newItem = createSeededItem(newComponentName.trim());
    onAddComponent(newItem);
    setNewComponentName('');
    setIsAddingCustom(false);
  };

  return (
    <div className="space-y-3">
      {/* Search, Filter & Add Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex items-center gap-2">
          {/* Search Input */}
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search components..."
              className="rounded-xl border border-slate-200 bg-white pl-8 pr-3 py-1 text-xs text-slate-800 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            />
          </div>

          {/* Filter Segment */}
          <div className="inline-flex rounded-xl bg-slate-100 p-0.5 dark:bg-slate-800 text-xs">
            <button
              onClick={() => setFilterMode('all')}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all ${
                filterMode === 'all'
                  ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-700 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
              }`}
            >
              All ({items.length})
            </button>
            <button
              onClick={() => setFilterMode('incomplete')}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all ${
                filterMode === 'incomplete'
                  ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-700 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
              }`}
            >
              Incomplete
            </button>
            <button
              onClick={() => setFilterMode('defects')}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all ${
                filterMode === 'defects'
                  ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-700 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
              }`}
            >
              Defects
            </button>
          </div>
        </div>

        {/* Add Custom Component */}
        {!disabled && (
          <div>
            {!isAddingCustom ? (
              <button
                type="button"
                onClick={() => setIsAddingCustom(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 shadow-2xs"
              >
                <Plus size={14} />
                <span>Add Component</span>
              </button>
            ) : (
              <form onSubmit={handleAddCustomComponent} className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={newComponentName}
                  onChange={(e) => setNewComponentName(e.target.value)}
                  placeholder="Component name..."
                  autoFocus
                  className="rounded-xl border border-blue-500 bg-white px-3 py-1 text-xs text-slate-800 focus:outline-none dark:bg-slate-800 dark:text-slate-200"
                />
                <button
                  type="submit"
                  disabled={!newComponentName.trim()}
                  className="rounded-xl bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => setIsAddingCustom(false)}
                  className="rounded-xl border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300"
                >
                  Cancel
                </button>
              </form>
            )}
          </div>
        )}
      </div>

      {/* Component Cards */}
      {filteredItems.length > 0 ? (
        <div className="space-y-2.5">
          {filteredItems.map((item) => (
            <ComponentAssessmentCard
              key={item.id}
              id={`component-${item.id}`}
              item={item}
              areaName={areaName}
              areaPhotos={areaPhotos}
              onChange={(patch) => onUpdateComponent(item.id, patch)}
              onRemove={() => onRemoveComponent(item.id)}
              onRegenerateComment={
                onRegenerateComment ? () => onRegenerateComment(item) : undefined
              }
              isGeneratingComment={!!loadingItems[item.id]}
              disabled={disabled}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 p-6 text-center text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/30 dark:text-slate-400">
          <p className="font-semibold text-slate-700 dark:text-slate-300">No components match your filter</p>
          <p className="mt-0.5 text-[11px]">Try clearing your search query or selecting &quot;All&quot;.</p>
        </div>
      )}
    </div>
  );
};
