import React, { useState } from 'react';
import type { InspectionItem, Photo } from '../../../types';
import { ConditionAssessment } from './ConditionAssessment';
import { CleanlinessAssessment } from './CleanlinessAssessment';
import { WorkingStatusAssessment } from './WorkingStatusAssessment';
import { ComponentTestingAssessment } from './ComponentTestingAssessment';
import { ComponentDescriptionFields } from './ComponentDescriptionFields';
import { ComponentEvidencePanel } from './ComponentEvidencePanel';
import { ComponentCommentaryPanel } from './ComponentCommentaryPanel';
import { ExitComponentComparisonPanel } from './ExitComponentComparisonPanel';
import { isOperationalItem } from '../../../services/platform/propertySeedingService';
import { ChevronDown, ChevronUp, Trash2, CheckCircle2, Sparkles, Link2, ShieldCheck } from 'lucide-react';

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
  const testComplete = !isOperational || item.testStatus === 'not_applicable' || item.testStatus === 'untested' || (
    ['tested_passed', 'tested_failed'].includes(item.testStatus) && Boolean(item.testRecord?.method?.trim())
  );
  const isComplete =
    item.conditionCategory !== 'unable_to_confirm' &&
    item.cleanlinessCategory !== 'unable_to_confirm' &&
    (!isOperational || item.workingStatus !== 'unable_to_confirm') &&
    testComplete;

  const isDamaged =
    item.conditionCategory === 'repair_required' ||
    item.conditionCategory === 'replacement_recommended' ||
    item.workingStatus === 'not_working';

  const hasMaterialChange = item.comparisonStatus === 'material_change' || item.comparisonStatus === 'deteriorated';
  const linkedPhotosCount = (item.photoReferences || []).length;
  const protectedReview = item.reviewStatus === 'analyst_reviewed' || item.reviewStatus === 'reviewer_approved';

  return (
    <div
      id={id || `component-${item.id}`}
      className={`rounded-2xl border transition-all ${
        hasMaterialChange
          ? 'border-amber-300 bg-amber-50/40 dark:border-amber-900/60 dark:bg-amber-950/30'
          : isDamaged
            ? 'border-amber-200 bg-amber-50/30 dark:border-amber-900/40 dark:bg-amber-950/20'
            : isComplete
              ? 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
              : 'border-slate-200 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-900/50'
      } shadow-2xs overflow-hidden`}
    >
      <div className="flex items-center justify-between gap-3 p-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <button type="button" onClick={() => setIsExpanded(!isExpanded)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="truncate text-xs font-bold text-slate-900 dark:text-white">{item.name}</h4>
              {isComplete ? <CheckCircle2 size={13} className="shrink-0 text-emerald-500" /> : <span className="shrink-0 text-[10px] font-bold text-slate-400">○ Pending</span>}
              {protectedReview && <ShieldCheck size={13} className="shrink-0 text-blue-600" />}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px]">
              <span className="font-semibold capitalize text-slate-600 dark:text-slate-300">Cond: {item.conditionCategory?.replaceAll('_', ' ') || 'unconfirmed'}</span>
              <span className="text-slate-300">•</span>
              <span className="capitalize text-slate-600 dark:text-slate-300">Clean: {item.cleanlinessCategory?.replaceAll('_', ' ') || 'unconfirmed'}</span>
              {isOperational ? (
                <>
                  <span className="text-slate-300">•</span>
                  <span className={`font-semibold capitalize ${item.workingStatus === 'operation_confirmed' || item.workingStatus === 'appears_operational' ? 'text-emerald-600' : item.workingStatus === 'not_working' ? 'text-rose-600' : 'text-amber-600'}`}>
                    Status: {item.workingStatus?.replaceAll('_', ' ') || 'untested'}
                  </span>
                  <span className="text-slate-300">•</span>
                  <span className="capitalize text-slate-600 dark:text-slate-300">Test: {item.testStatus?.replaceAll('_', ' ') || 'untested'}</span>
                </>
              ) : null}
              {item.comparisonStatus && item.comparisonStatus !== 'not_compared' ? (
                <>
                  <span className="text-slate-300">•</span>
                  <span className="font-semibold capitalize text-indigo-600">Compare: {item.comparisonStatus.replaceAll('_', ' ')}</span>
                </>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {linkedPhotosCount > 0 ? <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300"><Link2 size={11} />{linkedPhotosCount} photo{linkedPhotosCount > 1 ? 's' : ''}</span> : null}
          {item.aiConfidence && item.aiConfidence > 0 ? <span className="inline-flex items-center gap-0.5 rounded-full bg-purple-50 px-2 py-0.5 text-[10px] font-semibold text-purple-700 dark:bg-purple-950 dark:text-purple-300" title={`AI Confidence Score: ${Math.round(item.aiConfidence * 100)}%`}><Sparkles size={10} />{Math.round(item.aiConfidence * 100)}%</span> : null}
          {!disabled && onRemove ? <button type="button" onClick={onRemove} className="p-1 text-slate-400 transition-colors hover:text-rose-600" title="Remove component"><Trash2 size={14} /></button> : null}
          <button type="button" onClick={() => setIsExpanded(!isExpanded)} className="rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300">{isExpanded ? 'Collapse' : 'Edit'}</button>
        </div>
      </div>

      {item.aiSuggestion?.status === 'suggested' && (
        <div className="border-t border-purple-100 bg-purple-50 px-4 py-2 text-[11px] font-medium text-purple-800 dark:border-purple-900 dark:bg-purple-950/30 dark:text-purple-200">
          AI produced a new suggestion after human review. The reviewed values remain authoritative until an analyst or reviewer explicitly accepts the suggestion in the Report Console.
        </div>
      )}

      {isExpanded ? (
        <div className="space-y-3.5 border-t border-slate-100 bg-white p-4 pt-2 dark:border-slate-800 dark:bg-slate-900">
          {(item.baselineComponentData || (item.comparisonStatus && item.comparisonStatus !== 'not_compared')) ? (
            <ExitComponentComparisonPanel item={item} areaName={areaName} areaPhotos={areaPhotos} onChange={onChange} disabled={disabled} />
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <ConditionAssessment value={item.conditionCategory} onChange={(value) => onChange({ conditionCategory: value })} disabled={disabled} />
            <CleanlinessAssessment value={item.cleanlinessCategory} onChange={(value) => onChange({ cleanlinessCategory: value })} disabled={disabled} />
            {isOperational ? <WorkingStatusAssessment value={item.workingStatus} onChange={(value) => onChange({ workingStatus: value })} disabled={disabled} /> : null}
          </div>

          {isOperational && (
            <ComponentTestingAssessment
              testStatus={item.testStatus}
              testRecord={item.testRecord}
              areaPhotos={areaPhotos}
              onChange={(patch) => onChange(patch)}
              disabled={disabled}
            />
          )}

          <ComponentDescriptionFields item={item} onChange={onChange} disabled={disabled} />
          <ComponentEvidencePanel item={item} areaPhotos={areaPhotos} onChange={onChange} disabled={disabled} />
          <ComponentCommentaryPanel item={item} onChange={onChange} onRegenerateComment={onRegenerateComment} isGenerating={isGeneratingComment} disabled={disabled} />
        </div>
      ) : null}
    </div>
  );
};
