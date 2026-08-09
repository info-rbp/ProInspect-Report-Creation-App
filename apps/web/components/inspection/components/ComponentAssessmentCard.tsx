import React, { useState } from 'react';
import { InspectionItem, Photo } from '../../../types';
import { ConditionAssessment } from './ConditionAssessment';
import { CleanlinessAssessment } from './CleanlinessAssessment';
import { WorkingStatusAssessment } from './WorkingStatusAssessment';
import { ComponentDescriptionFields } from './ComponentDescriptionFields';
import { ComponentEvidencePanel } from './ComponentEvidencePanel';
import { ComponentCommentaryPanel } from './ComponentCommentaryPanel';
import { isOperationalItem } from '../../../services/platform/propertySeedingService';
import { ChevronDown, ChevronUp, Trash2, CheckCircle2, Sparkles, Link2 } from 'lucide-react';

interface ComponentAssessmentCardProps {
  item: InspectionItem;
  areaName: string;
  areaPhotos: Photo[];
  onChange: (patch: Partial<InspectionItem>) => void;
  onRemove?: () => void;
  onRegenerateComment?: () => Promise<void>;
  isGeneratingComment?: boolean;
  disabled?: boolean;
  id?: string;
}

export const ComponentAssessmentCard: React.FC<ComponentAssessmentCardProps> = ({
  item,
  areaName,
  areaPhotos,
  onChange,
  onRemove,
  onRegenerateComment,
  isGeneratingComment = false,
  disabled = false,
  id,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const isOperational = isOperationalItem(item.name);
  const isComplete =
    item.conditionCategory !== 'unable_to_confirm' &&
    item.cleanlinessCategory !== 'unable_to_confirm' &&
    (!isOperational || item.workingStatus !== 'untested');

  const isDamaged =
    item.conditionCategory === 'repair_required' ||
    item.conditionCategory === 'replacement_recommended' ||
    item.workingStatus === 'not_working';

  const linkedPhotosCount = (item.photoReferences || []).length;

  return (
    <div
      id={id || `component-${item.id}`}
      className={`rounded-2xl border transition-all ${
        isDamaged
          ? 'border-amber-200 bg-amber-50/30 dark:border-amber-900/40 dark:bg-amber-950/20'
          : isComplete
          ? 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
          : 'border-slate-200 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-900/50'
      } shadow-2xs overflow-hidden`}
    >
      {/* Compact Header Bar */}
      <div className="flex items-center justify-between p-3.5 gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="text-xs font-bold text-slate-900 dark:text-white truncate">
                {item.name}
              </h4>
              {isComplete ? (
                <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
              ) : (
                <span className="text-[10px] font-bold text-slate-400 shrink-0">○ Pending</span>
              )}
            </div>

            {/* Sub-label badges */}
            <div className="flex flex-wrap items-center gap-1.5 mt-0.5 text-[10px]">
              <span className="capitalize font-semibold text-slate-600 dark:text-slate-300">
                Cond: {item.conditionCategory?.replace('_', ' ') || 'unconfirmed'}
              </span>
              <span className="text-slate-300">•</span>
              <span className="capitalize text-slate-600 dark:text-slate-300">
                Clean: {item.cleanlinessCategory?.replace('_', ' ') || 'unconfirmed'}
              </span>
              {isOperational && (
                <>
                  <span className="text-slate-300">•</span>
                  <span
                    className={`capitalize font-semibold ${
                      item.workingStatus === 'operation_confirmed' || item.workingStatus === 'appears_operational'
                        ? 'text-emerald-600'
                        : item.workingStatus === 'not_working'
                        ? 'text-rose-600'
                        : 'text-amber-600'
                    }`}
                  >
                    Status: {item.workingStatus?.replace('_', ' ') || 'untested'}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right Badges & Controls */}
        <div className="flex items-center gap-2 shrink-0">
          {linkedPhotosCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 dark:bg-blue-950 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:text-blue-300">
              <Link2 size={11} />
              {linkedPhotosCount} photo{linkedPhotosCount > 1 ? 's' : ''}
            </span>
          )}

          {item.aiConfidence && item.aiConfidence > 0 ? (
            <span
              className="inline-flex items-center gap-0.5 rounded-full bg-purple-50 dark:bg-purple-950 px-2 py-0.5 text-[10px] font-semibold text-purple-700 dark:text-purple-300"
              title={`AI Confidence Score: ${Math.round(item.aiConfidence * 100)}%`}
            >
              <Sparkles size={10} />
              {Math.round(item.aiConfidence * 100)}%
            </span>
          ) : null}

          {!disabled && onRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="p-1 text-slate-400 hover:text-rose-600 transition-colors"
              title="Remove component"
            >
              <Trash2 size={14} />
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="rounded-lg bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-200"
          >
            {isExpanded ? 'Collapse' : 'Edit'}
          </button>
        </div>
      </div>

      {/* Expanded Details Panel */}
      {isExpanded && (
        <div className="p-4 pt-2 border-t border-slate-100 dark:border-slate-800 space-y-3.5 bg-white dark:bg-slate-900">
          {/* Assessment Controls Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <ConditionAssessment
              value={item.conditionCategory}
              onChange={(val) => onChange({ conditionCategory: val })}
              disabled={disabled}
            />
            <CleanlinessAssessment
              value={item.cleanlinessCategory}
              onChange={(val) => onChange({ cleanlinessCategory: val })}
              disabled={disabled}
            />
            {isOperational && (
              <WorkingStatusAssessment
                value={item.workingStatus}
                onChange={(val) => onChange({ workingStatus: val })}
                disabled={disabled}
              />
            )}
          </div>

          {/* Description Fields */}
          <ComponentDescriptionFields item={item} onChange={onChange} disabled={disabled} />

          {/* Evidence Panel */}
          <ComponentEvidencePanel
            item={item}
            areaPhotos={areaPhotos}
            onChange={onChange}
            disabled={disabled}
          />

          {/* Commentary Panel */}
          <ComponentCommentaryPanel
            item={item}
            onChange={onChange}
            onRegenerateComment={onRegenerateComment}
            isGenerating={isGeneratingComment}
            disabled={disabled}
          />
        </div>
      )}
    </div>
  );
};
