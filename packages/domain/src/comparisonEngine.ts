import type {
  BaselineComponentSnapshot,
  CleanlinessComparison,
  ComponentEvidencePair,
  ConditionComparison,
  PresenceComparison,
  WorkingComparison,
} from './reportModel.js';
import { sanitizeProhibitedCausation } from './security.js';

export interface ComparisonInputComponent {
  id: string;
  component: string;
  conditionCategory: string;
  cleanlinessCategory: string;
  workingStatus: string;
  testStatus: string;
  defects: string[];
  commentary: string;
  photoReferences?: Array<{ photoId: string; objectPath: string }>;
}

export interface ComparisonEngineResult {
  presenceComparison: PresenceComparison;
  conditionComparison: ConditionComparison;
  cleanlinessComparison: CleanlinessComparison;
  workingComparison: WorkingComparison;
  comparisonStatus: 'no_material_change' | 'material_change' | 'unable_to_compare';
  comparisonCommentary: string;
  evidencePairs: ComponentEvidencePair[];
  comparisonConfidence: number;
  comparisonUncertainty?: string;
}

export function compareComponentEntryToExit(
  baseline?: ComparisonInputComponent | BaselineComponentSnapshot | null,
  current?: ComparisonInputComponent | null
): ComparisonEngineResult {
  const evidencePairs: ComponentEvidencePair[] = [];
  
  if (baseline?.photoReferences?.length && current?.photoReferences?.length) {
    const minLen = Math.min(baseline.photoReferences.length, current.photoReferences.length);
    for (let i = 0; i < minLen; i += 1) {
      evidencePairs.push({
        baselinePhotoId: baseline.photoReferences[i].photoId,
        currentPhotoId: current.photoReferences[i].photoId,
        matchingMethod: 'stable_id',
        matchingConfidence: 0.95,
      });
    }
  }

  // 1. Presence comparison
  let presenceComparison: PresenceComparison = 'present_both';
  if (!baseline) {
    presenceComparison = 'not_recorded_at_entry_present_at_exit';
  } else if (!current) {
    presenceComparison = 'present_at_entry_not_identified_at_exit';
  } else if (baseline.conditionCategory === 'not_visible') {
    presenceComparison = 'not_visible_at_entry';
  } else if (current.conditionCategory === 'not_visible') {
    presenceComparison = 'not_visible_at_exit';
  } else if (baseline.conditionCategory === 'not_applicable' && current.conditionCategory === 'not_applicable') {
    presenceComparison = 'not_applicable';
  }

  if (!baseline || !current) {
    const compStatus = presenceComparison === 'not_applicable' ? 'no_material_change' : 'material_change';
    const commentary = !baseline
      ? `Component was not recorded in the Entry baseline and is present at Exit.`
      : `Component recorded at Entry was not identified in the Exit inspection evidence.`;
    return {
      presenceComparison,
      conditionComparison: 'not_applicable',
      cleanlinessComparison: 'not_applicable',
      workingComparison: 'not_applicable',
      comparisonStatus: compStatus,
      comparisonCommentary: sanitizeProhibitedCausation(commentary),
      evidencePairs,
      comparisonConfidence: 1.0,
    };
  }

  // 2. Condition comparison
  let conditionComparison: ConditionComparison = 'no_material_change';
  if (baseline.conditionCategory === 'unable_to_confirm' || current.conditionCategory === 'unable_to_confirm') {
    conditionComparison = 'unable_to_compare';
  } else if (baseline.conditionCategory === current.conditionCategory) {
    if (current.defects?.length && current.defects.length > (baseline.defects?.length || 0)) {
      conditionComparison = 'different_condition';
    } else {
      conditionComparison = 'no_material_change';
    }
  } else {
    const isBaselineGood = ['intact', 'minor_wear'].includes(baseline.conditionCategory);
    const isCurrentBad = ['repair_required', 'replacement_recommended'].includes(current.conditionCategory);
    const isBaselineBad = ['repair_required', 'replacement_recommended'].includes(baseline.conditionCategory);
    const isCurrentGood = ['intact', 'minor_wear'].includes(current.conditionCategory);

    if (isBaselineGood && isCurrentBad) {
      conditionComparison = 'deteriorated';
    } else if (isBaselineBad && isCurrentGood) {
      conditionComparison = 'improved';
    } else {
      conditionComparison = 'different_condition';
    }
  }

  // 3. Cleanliness comparison
  let cleanlinessComparison: CleanlinessComparison = 'no_material_change';
  if (baseline.cleanlinessCategory === 'unable_to_confirm' || current.cleanlinessCategory === 'unable_to_confirm') {
    cleanlinessComparison = 'unable_to_compare';
  } else if (baseline.cleanlinessCategory === current.cleanlinessCategory) {
    cleanlinessComparison = 'no_material_change';
  } else if (baseline.cleanlinessCategory === 'clean' && ['requires_cleaning', 'stained'].includes(current.cleanlinessCategory)) {
    cleanlinessComparison = 'deteriorated';
  } else if (['requires_cleaning', 'stained'].includes(baseline.cleanlinessCategory) && current.cleanlinessCategory === 'clean') {
    cleanlinessComparison = 'improved';
  } else {
    cleanlinessComparison = 'no_material_change';
  }

  // 4. Working & Test Status comparison
  let workingComparison: WorkingComparison = 'no_material_change';
  if (baseline.workingStatus === 'unable_to_confirm' || current.workingStatus === 'unable_to_confirm') {
    workingComparison = 'unable_to_compare';
  } else if (['operation_confirmed', 'tested_passed'].includes(baseline.workingStatus) && current.workingStatus === 'untested') {
    // CRITICAL SAFEGUARD: Absence of testing at Exit does NOT mean failure
    workingComparison = 'unable_to_compare';
  } else if (['operation_confirmed', 'tested_passed'].includes(baseline.workingStatus) && ['not_working', 'tested_failed'].includes(current.workingStatus)) {
    workingComparison = 'deteriorated';
  } else if (['not_working', 'tested_failed'].includes(baseline.workingStatus) && ['operation_confirmed', 'tested_passed'].includes(current.workingStatus)) {
    workingComparison = 'improved';
  } else if (baseline.workingStatus === current.workingStatus) {
    workingComparison = 'no_material_change';
  }

  // 5. Overall Comparison Status
  let comparisonStatus: 'no_material_change' | 'material_change' | 'unable_to_compare' = 'no_material_change';
  if (
    conditionComparison === 'deteriorated' ||
    cleanlinessComparison === 'deteriorated' ||
    workingComparison === 'deteriorated' ||
    conditionComparison === 'different_condition'
  ) {
    comparisonStatus = 'material_change';
  } else if (
    conditionComparison === 'unable_to_compare' ||
    cleanlinessComparison === 'unable_to_compare' ||
    workingComparison === 'unable_to_compare'
  ) {
    comparisonStatus = 'unable_to_compare';
  }

  // 6. Generate Factual Neutral Commentary
  const commentaryParts: string[] = [];

  if (comparisonStatus === 'no_material_change') {
    if (current.defects?.length) {
      commentaryParts.push(`Pre-existing defects recorded at Entry remain evident. No material change identified.`);
    } else {
      commentaryParts.push(`Presents in consistent condition relative to Entry baseline with no material change identified.`);
    }
  } else {
    if (conditionComparison === 'deteriorated') {
      const newDefects = (current.defects || []).filter((d) => !(baseline.defects || []).includes(d));
      if (newDefects.length) {
        commentaryParts.push(`Condition change noted: ${newDefects.join(', ')} recorded at Exit was not noted in Entry baseline.`);
      } else {
        commentaryParts.push(`Condition change noted relative to Entry baseline (${baseline.conditionCategory} at Entry vs ${current.conditionCategory} at Exit).`);
      }
    } else if (conditionComparison === 'improved') {
      commentaryParts.push(`Condition improvement noted relative to Entry baseline.`);
    }

    if (cleanlinessComparison === 'deteriorated') {
      commentaryParts.push(`Recorded clean at Entry; soiling/cleaning requirement observed at Exit.`);
    } else if (cleanlinessComparison === 'improved') {
      commentaryParts.push(`Cleaning noted relative to Entry baseline.`);
    }

    if (workingComparison === 'deteriorated') {
      commentaryParts.push(`Operational testing passed at Entry; item was not operational when tested at Exit.`);
    } else if (workingComparison === 'unable_to_compare' && baseline.workingStatus !== 'untested') {
      commentaryParts.push(`Operation confirmed at Entry; operational testing was not conducted at Exit.`);
    }
  }

  const comparisonCommentary = sanitizeProhibitedCausation(commentaryParts.join(' '));

  return {
    presenceComparison,
    conditionComparison,
    cleanlinessComparison,
    workingComparison,
    comparisonStatus,
    comparisonCommentary,
    evidencePairs,
    comparisonConfidence: 0.9,
    ...(workingComparison === 'unable_to_compare' ? { comparisonUncertainty: 'Operational testing was not conducted at Exit.' } : {}),
  };
}
