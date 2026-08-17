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
  photoReferences?: Array<{
    photoId: string;
    objectPath: string;
    caption?: string;
    sequence?: number;
  }>;
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

function normaliseText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, ' ');
}

/**
 * Deterministic comparison must not pretend that two photographs show the same
 * physical view merely because they happen to occupy the same array position.
 * Only an explicit stable marker, currently a matching non-empty caption, may
 * produce an automatic pair here. AI-assisted and manual pairing are separate
 * reviewable workflows and must record their own method/confidence.
 */
export function pairEvidenceByExplicitMarker(
  baseline?: ComparisonInputComponent | BaselineComponentSnapshot | null,
  current?: ComparisonInputComponent | null,
): ComponentEvidencePair[] {
  if (!baseline?.photoReferences?.length || !current?.photoReferences?.length) return [];

  const currentByCaption = new Map<string, string>();
  for (const reference of current.photoReferences) {
    const caption = reference.caption ? normaliseText(reference.caption) : '';
    if (caption) currentByCaption.set(caption, reference.photoId);
  }

  const pairs: ComponentEvidencePair[] = [];
  for (const reference of baseline.photoReferences) {
    const caption = reference.caption ? normaliseText(reference.caption) : '';
    const currentPhotoId = caption ? currentByCaption.get(caption) : undefined;
    if (!currentPhotoId) continue;
    pairs.push({
      baselinePhotoId: reference.photoId,
      currentPhotoId,
      matchingMethod: 'explicit_mapping',
      matchingConfidence: 1,
    });
  }
  return pairs;
}

function comparePresence(
  baseline?: ComparisonInputComponent | BaselineComponentSnapshot | null,
  current?: ComparisonInputComponent | null,
): PresenceComparison {
  if (!baseline && !current) return 'unable_to_compare';
  if (!baseline) return 'not_recorded_at_entry_present_at_exit';
  if (!current) return 'present_at_entry_not_identified_at_exit';
  if (baseline.conditionCategory === 'not_visible') return 'not_visible_at_entry';
  if (current.conditionCategory === 'not_visible') return 'not_visible_at_exit';
  if (baseline.conditionCategory === 'not_applicable' && current.conditionCategory === 'not_applicable') {
    return 'not_applicable';
  }
  return 'present_both';
}

function compareCondition(
  baseline: ComparisonInputComponent | BaselineComponentSnapshot,
  current: ComparisonInputComponent,
): ConditionComparison {
  if (
    ['unable_to_confirm', 'not_visible', 'partially_visible'].includes(baseline.conditionCategory) ||
    ['unable_to_confirm', 'not_visible', 'partially_visible'].includes(current.conditionCategory)
  ) {
    return 'unable_to_compare';
  }
  if (baseline.conditionCategory === 'not_applicable' || current.conditionCategory === 'not_applicable') {
    return baseline.conditionCategory === current.conditionCategory ? 'not_applicable' : 'unable_to_compare';
  }

  if (baseline.conditionCategory === current.conditionCategory) {
    const baselineDefects = new Set((baseline.defects || []).map(normaliseText));
    const additionalDefects = (current.defects || []).filter((defect) => !baselineDefects.has(normaliseText(defect)));
    return additionalDefects.length > 0 ? 'different_condition' : 'no_material_change';
  }

  const baselineGood = ['intact', 'minor_wear'].includes(baseline.conditionCategory);
  const currentBad = ['repair_required', 'replacement_recommended'].includes(current.conditionCategory);
  const baselineBad = ['repair_required', 'replacement_recommended'].includes(baseline.conditionCategory);
  const currentGood = ['intact', 'minor_wear'].includes(current.conditionCategory);

  if (baselineGood && currentBad) return 'deteriorated';
  if (baselineBad && currentGood) return 'improved';
  return 'different_condition';
}

function compareCleanliness(
  baseline: ComparisonInputComponent | BaselineComponentSnapshot,
  current: ComparisonInputComponent,
): CleanlinessComparison {
  if (
    baseline.cleanlinessCategory === 'unable_to_confirm' ||
    current.cleanlinessCategory === 'unable_to_confirm'
  ) {
    return 'unable_to_compare';
  }
  if (baseline.cleanlinessCategory === 'not_applicable' || current.cleanlinessCategory === 'not_applicable') {
    return baseline.cleanlinessCategory === current.cleanlinessCategory ? 'not_applicable' : 'unable_to_compare';
  }
  if (baseline.cleanlinessCategory === current.cleanlinessCategory) return 'no_material_change';
  if (
    baseline.cleanlinessCategory === 'clean' &&
    ['requires_cleaning', 'stained'].includes(current.cleanlinessCategory)
  ) {
    return 'deteriorated';
  }
  if (
    ['requires_cleaning', 'stained'].includes(baseline.cleanlinessCategory) &&
    current.cleanlinessCategory === 'clean'
  ) {
    return 'improved';
  }
  return 'unable_to_compare';
}

function isTestedWorking(workingStatus: string, testStatus: string): boolean {
  return workingStatus === 'operation_confirmed' || testStatus === 'tested_passed';
}

function isTestedFailed(workingStatus: string, testStatus: string): boolean {
  return workingStatus === 'not_working' || testStatus === 'tested_failed';
}

function compareWorking(
  baseline: ComparisonInputComponent | BaselineComponentSnapshot,
  current: ComparisonInputComponent,
): WorkingComparison {
  if (baseline.workingStatus === 'not_applicable' && current.workingStatus === 'not_applicable') {
    return 'not_applicable';
  }
  if (
    ['unable_to_confirm', 'untested'].includes(baseline.workingStatus) ||
    ['unable_to_confirm', 'untested'].includes(current.workingStatus) ||
    ['unable_to_confirm', 'untested'].includes(baseline.testStatus) ||
    ['unable_to_confirm', 'untested'].includes(current.testStatus)
  ) {
    return 'unable_to_compare';
  }

  const baselineWorks = isTestedWorking(baseline.workingStatus, baseline.testStatus);
  const currentWorks = isTestedWorking(current.workingStatus, current.testStatus);
  const baselineFailed = isTestedFailed(baseline.workingStatus, baseline.testStatus);
  const currentFailed = isTestedFailed(current.workingStatus, current.testStatus);

  if (baselineWorks && currentFailed) return 'deteriorated';
  if (baselineFailed && currentWorks) return 'improved';
  if ((baselineWorks && currentWorks) || (baselineFailed && currentFailed)) return 'no_material_change';
  return 'unable_to_compare';
}

function statusFor(
  condition: ConditionComparison,
  cleanliness: CleanlinessComparison,
  working: WorkingComparison,
): ComparisonEngineResult['comparisonStatus'] {
  if (
    condition === 'deteriorated' ||
    condition === 'different_condition' ||
    condition === 'new_condition_observation' ||
    cleanliness === 'deteriorated' ||
    working === 'deteriorated'
  ) {
    return 'material_change';
  }
  if (
    condition === 'unable_to_compare' ||
    cleanliness === 'unable_to_compare' ||
    working === 'unable_to_compare'
  ) {
    return 'unable_to_compare';
  }
  return 'no_material_change';
}

function comparisonLanguage(
  baseline: ComparisonInputComponent | BaselineComponentSnapshot,
  current: ComparisonInputComponent,
  condition: ConditionComparison,
  cleanliness: CleanlinessComparison,
  working: WorkingComparison,
  status: ComparisonEngineResult['comparisonStatus'],
): string {
  const parts: string[] = [];
  if (status === 'no_material_change') {
    parts.push('No material change identified compared with the Entry baseline where directly comparable.');
  }

  if (condition === 'deteriorated' || condition === 'different_condition') {
    const baselineDefects = new Set((baseline.defects || []).map(normaliseText));
    const additional = (current.defects || []).filter((defect) => !baselineDefects.has(normaliseText(defect)));
    if (additional.length) {
      parts.push(`Current Exit evidence records additional condition observations not recorded at Entry: ${additional.join('; ')}.`);
    } else {
      parts.push(`Current physical condition differs from the Entry baseline (${baseline.conditionCategory} at Entry; ${current.conditionCategory} at Exit).`);
    }
  } else if (condition === 'improved') {
    parts.push('The condition concern recorded at Entry is not evident to the same extent in the current Exit assessment.');
  } else if (condition === 'unable_to_compare') {
    parts.push('Physical condition cannot be conclusively compared from the available Entry and Exit evidence.');
  }

  if (cleanliness === 'deteriorated') {
    parts.push('The component was recorded clean at Entry and currently requires cleaning or shows staining at Exit.');
  } else if (cleanliness === 'improved') {
    parts.push('The Entry cleanliness concern is not evident in the current Exit assessment.');
  }

  if (working === 'deteriorated') {
    parts.push('Operation was confirmed at Entry and the component was tested as not operational at Exit.');
  } else if (working === 'improved') {
    parts.push('The component was recorded as not operational at Entry and operation was confirmed at Exit.');
  } else if (working === 'unable_to_compare' && baseline.workingStatus !== 'not_applicable') {
    const exitUntested = current.workingStatus === 'untested' || current.testStatus === 'untested';
    parts.push(exitUntested
      ? 'Operational status cannot be directly compared because operational testing was not conducted at Exit.'
      : 'Operational status cannot be directly compared because equivalent testing evidence is unavailable.');
  }

  return sanitizeProhibitedCausation(parts.join(' '));
}

export function compareComponentEntryToExit(
  baseline?: ComparisonInputComponent | BaselineComponentSnapshot | null,
  current?: ComparisonInputComponent | null,
): ComparisonEngineResult {
  const presenceComparison = comparePresence(baseline, current);
  const evidencePairs = pairEvidenceByExplicitMarker(baseline, current);

  if (!baseline || !current) {
    const comparisonStatus = presenceComparison === 'not_applicable' ? 'no_material_change' : 'material_change';
    const comparisonCommentary = !baseline
      ? 'Component was not recorded in the Entry baseline and is present at Exit.'
      : 'Component recorded at Entry was not identified in the current Exit inspection evidence.';
    return {
      presenceComparison,
      conditionComparison: 'not_applicable',
      cleanlinessComparison: 'not_applicable',
      workingComparison: 'not_applicable',
      comparisonStatus,
      comparisonCommentary: sanitizeProhibitedCausation(comparisonCommentary),
      evidencePairs,
      comparisonConfidence: 0.8,
      comparisonUncertainty: 'Presence comparison requires human review before a material conclusion is approved.',
    };
  }

  if (presenceComparison === 'not_visible_at_entry' || presenceComparison === 'not_visible_at_exit') {
    return {
      presenceComparison,
      conditionComparison: 'unable_to_compare',
      cleanlinessComparison: 'unable_to_compare',
      workingComparison: 'unable_to_compare',
      comparisonStatus: 'unable_to_compare',
      comparisonCommentary: 'Current condition is recorded independently, but the component cannot be conclusively compared because it was not sufficiently visible at one inspection.',
      evidencePairs,
      comparisonConfidence: 0.4,
      comparisonUncertainty: 'Visibility is insufficient for a direct Entry-to-Exit comparison.',
    };
  }

  const conditionComparison = compareCondition(baseline, current);
  const cleanlinessComparison = compareCleanliness(baseline, current);
  const workingComparison = compareWorking(baseline, current);
  const comparisonStatus = statusFor(conditionComparison, cleanlinessComparison, workingComparison);
  const comparisonCommentary = comparisonLanguage(
    baseline,
    current,
    conditionComparison,
    cleanlinessComparison,
    workingComparison,
    comparisonStatus,
  );

  const uncertainty = comparisonStatus === 'unable_to_compare'
    ? 'One or more comparison dimensions lack equivalent Entry and Exit evidence.'
    : evidencePairs.length === 0 && (baseline.photoReferences?.length || current.photoReferences?.length)
      ? 'No Entry-to-Exit photo pair has been explicitly confirmed; structured component facts were compared without assuming matching camera views.'
      : undefined;

  return {
    presenceComparison,
    conditionComparison,
    cleanlinessComparison,
    workingComparison,
    comparisonStatus,
    comparisonCommentary,
    evidencePairs,
    comparisonConfidence: comparisonStatus === 'unable_to_compare' ? 0.5 : evidencePairs.length > 0 ? 0.95 : 0.8,
    ...(uncertainty ? { comparisonUncertainty: uncertainty } : {}),
  };
}
