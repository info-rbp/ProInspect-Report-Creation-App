import { GoogleGenAI } from '@google/genai';
import type {
  ComponentConditionCategory,
  ComponentCleanlinessCategory,
  ComponentWorkingStatus,
  ComponentTestStatus,
  ComponentReviewStatus,
  ComponentComparisonStatus,
  PresenceComparison,
  ConditionComparison,
  CleanlinessComparison,
  WorkingComparison,
  ComponentEvidencePair,
  BaselineComponentSnapshot,
  ReportPhotoReference,
} from '@pcr/domain';

export interface PhotoInput {
  id: string;
  filename?: string;
  mimeType?: string;
  base64Data?: string;
  tags?: string[];
  previewUrl?: string;
}

export interface StructuredComponentAnalysis {
  id: string;
  name?: string;
  conditionCategory: ComponentConditionCategory;
  cleanlinessCategory: ComponentCleanlinessCategory;
  workingStatus: ComponentWorkingStatus;
  testStatus: ComponentTestStatus;
  defects: string[];
  maintenanceRequired: boolean;
  commentary: string;
  evidencePhotoIds?: string[];
  photoReferences?: ReportPhotoReference[];
  aiConfidence?: number;
  uncertainty?: string;
  reviewStatus?: ComponentReviewStatus;
  comparisonStatus?: ComponentComparisonStatus;
  presenceComparison?: PresenceComparison;
  conditionComparison?: ConditionComparison;
  cleanlinessComparison?: CleanlinessComparison;
  workingComparison?: WorkingComparison;
  comparisonCommentary?: string;
  baselineComponentData?: BaselineComponentSnapshot;
  evidencePairs?: ComponentEvidencePair[];
}

export interface BatchRoomResult {
  overallComment: string;
  items: StructuredComponentAnalysis[];
}

export interface PreviousReportInput {
  filename?: string;
  mimeType?: string;
  base64Data?: string;
  notes?: string;
}

const OPERATIONAL_KEYWORDS = [
  'switch', 'power', 'light', 'socket', 'plug', 'appliance', 'oven', 'stove', 'cooktop',
  'rangehood', 'fan', 'aircon', 'air conditioner', 'heater', 'tap', 'faucet', 'dishwasher',
  'reticulation', 'intercom', 'alarm', 'garage door', 'pump', 'disposal', 'exhaust', 'motor',
];

const CONDITION_VALUES = new Set<ComponentConditionCategory>([
  'not_applicable', 'not_visible', 'partially_visible', 'intact', 'minor_wear', 'repair_required',
  'replacement_recommended', 'unable_to_confirm',
]);
const CLEANLINESS_VALUES = new Set<ComponentCleanlinessCategory>([
  'not_applicable', 'clean', 'requires_cleaning', 'stained', 'unable_to_confirm',
]);

export function isOperationalItem(itemName: string): boolean {
  const lower = itemName.toLowerCase();
  return OPERATIONAL_KEYWORDS.some((keyword) => lower.includes(keyword));
}

const PROHIBITED_CAUSATION_REGEX = /\b(tenant caused|tenant damage|tenant damaged|tenant is responsible|tenant responsibility|tenant's fault|tenant negligence|negligent|misuse|neglected|caused by tenant|bond deduction|deduct from bond|fair wear and tear|not fair wear and tear)\b/gi;

export function sanitizeProhibitedCausation(text: string): string {
  if (!text) return text;
  return text.replace(PROHIBITED_CAUSATION_REGEX, '[causation or liability omitted]').trim();
}

/**
 * Photo analysis never proves operation. Tests are recorded separately by the inspector.
 * Even a visibly damaged operational item is assessed physically here and remains untested.
 */
export function enforceWorkingStatusRules(
  itemName: string,
  _workingStatus: string | undefined,
  _testStatus: string | undefined,
): { workingStatus: ComponentWorkingStatus; testStatus: ComponentTestStatus } {
  if (isOperationalItem(itemName)) return { workingStatus: 'untested', testStatus: 'untested' };
  return { workingStatus: 'not_applicable', testStatus: 'not_applicable' };
}

export function validateEvidenceProvenance(
  evidencePhotoIds: string[] | undefined,
  validPhotoIds: Set<string>,
): string[] {
  if (!Array.isArray(evidencePhotoIds)) return [];
  return [...new Set(evidencePhotoIds.filter((id) => typeof id === 'string' && validPhotoIds.has(id)))];
}

const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey?.trim()) {
    throw new Error('GEMINI_API_KEY environment variable is not configured on the server.');
  }
  return new GoogleGenAI({
    apiKey: apiKey.trim(),
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
  });
}

export function isGeminiAvailable(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

function requireGemini(): GoogleGenAI {
  if (!isGeminiAvailable()) {
    throw new Error('AI analysis is unavailable because GEMINI_API_KEY is not configured.');
  }
  return getGeminiClient();
}

const GLOBAL_RULES = `
PROPERTY CONDITION INSPECTION ANALYSIS RULES
- Analyse only what is supported by the supplied evidence. Do not invent hidden condition.
- If a component is only partly shown, describe only the visible portion and retain uncertainty.
- Condition values: not_applicable, not_visible, partially_visible, intact, minor_wear, repair_required, replacement_recommended, unable_to_confirm.
- Cleanliness values: not_applicable, clean, requires_cleaning, stained, unable_to_confirm.
- Static photographs cannot confirm operation. For operational items return workingStatus=untested and testStatus=untested. For static non-operational items return not_applicable for both.
- Do not assign tenant causation, negligence, legal responsibility, fair wear and tear, breach, compensation or bond deductions.
- evidencePhotoIds must contain only supplied photo IDs where the stated observation is actually visible.
- Use Australian English and objective property-inspection language.
`;

function parseJson<T>(rawText: string): T {
  const cleaned = rawText.replace(/```json|```/g, '').trim();
  return JSON.parse(cleaned) as T;
}

function normaliseCondition(value: unknown): ComponentConditionCategory {
  return typeof value === 'string' && CONDITION_VALUES.has(value as ComponentConditionCategory)
    ? value as ComponentConditionCategory
    : 'unable_to_confirm';
}

function normaliseCleanliness(value: unknown): ComponentCleanlinessCategory {
  return typeof value === 'string' && CLEANLINESS_VALUES.has(value as ComponentCleanlinessCategory)
    ? value as ComponentCleanlinessCategory
    : 'unable_to_confirm';
}

function confidence(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5;
}

function buildPhotoParts(photos: PhotoInput[]): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [];
  photos.forEach((photo, index) => {
    if (photo.base64Data) {
      parts.push({ inlineData: { mimeType: photo.mimeType || 'image/jpeg', data: photo.base64Data } });
      parts.push({ text: `[Photo ${index + 1} ID: "${photo.id}", Filename: "${photo.filename || photo.id}"]` });
    }
  });
  return parts;
}

function addPreviousReportParts(parts: Array<Record<string, unknown>>, previousReport?: PreviousReportInput): void {
  if (previousReport?.base64Data) {
    parts.push({
      inlineData: {
        mimeType: previousReport.mimeType || 'application/pdf',
        data: previousReport.base64Data,
      },
    });
    parts.push({ text: '[Attached Previous Condition Report. Treat as historical context, not proof of current condition.]' });
  }
}

function normaliseAnalysis(
  itemName: string,
  raw: Partial<StructuredComponentAnalysis>,
  validPhotoIds: Set<string>,
): StructuredComponentAnalysis {
  const statuses = enforceWorkingStatusRules(itemName, raw.workingStatus, raw.testStatus);
  const evidence = validateEvidenceProvenance(raw.evidencePhotoIds, validPhotoIds);
  const aiConfidence = confidence(raw.aiConfidence);
  const conditionCategory = normaliseCondition(raw.conditionCategory);
  const cleanlinessCategory = normaliseCleanliness(raw.cleanlinessCategory);
  const defects = Array.isArray(raw.defects)
    ? raw.defects.filter((defect): defect is string => typeof defect === 'string').map(sanitizeProhibitedCausation)
    : [];

  return {
    id: itemName,
    name: raw.name || itemName,
    conditionCategory,
    cleanlinessCategory,
    workingStatus: statuses.workingStatus,
    testStatus: statuses.testStatus,
    defects,
    maintenanceRequired: Boolean(
      raw.maintenanceRequired ||
      conditionCategory === 'repair_required' ||
      conditionCategory === 'replacement_recommended' ||
      cleanlinessCategory === 'requires_cleaning' ||
      cleanlinessCategory === 'stained'
    ),
    commentary: sanitizeProhibitedCausation(raw.commentary || ''),
    evidencePhotoIds: evidence,
    aiConfidence,
    ...(aiConfidence < 0.7 || evidence.length === 0
      ? { uncertainty: evidence.length === 0 ? 'No specific supporting photo was identified; manual verification is required.' : 'Low-confidence visual assessment requires manual verification.' }
      : {}),
    reviewStatus: 'ai_generated',
    comparisonStatus: 'not_compared',
  };
}

export async function generateImageTagsServer(photo: PhotoInput): Promise<string[]> {
  if (!isGeminiAvailable()) return photo.tags?.length ? photo.tags : ['Inspection Photo'];

  const ai = getGeminiClient();
  const parts = buildPhotoParts([photo]);
  parts.push({
    text: `Analyse inspection photo ID "${photo.id}". Return a JSON array of up to four short tags for visible room/component identity only. Do not infer condition or operation. Output JSON array only.`,
  });

  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: { role: 'user', parts },
      config: { responseMimeType: 'application/json' },
    });
    if (!response.text) return photo.tags?.length ? photo.tags : ['Inspection Photo'];
    const tags = parseJson<unknown>(response.text);
    return Array.isArray(tags)
      ? tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 4).map(sanitizeProhibitedCausation)
      : (photo.tags?.length ? photo.tags : ['Inspection Photo']);
  } catch (error) {
    console.warn('Server image tagging failed:', error);
    return photo.tags?.length ? photo.tags : ['Inspection Photo'];
  }
}

export async function discoverRoomItemsServer(
  roomName: string,
  photos: PhotoInput[],
): Promise<StructuredComponentAnalysis[]> {
  const ai = requireGemini();
  const validPhotoIds = new Set(photos.map((photo) => photo.id));
  const parts = buildPhotoParts(photos);
  parts.push({
    text: `
You are identifying components visible in the inspection area "${roomName}".
${GLOBAL_RULES}
Return a JSON array. Each item must contain id, conditionCategory, cleanlinessCategory, workingStatus, testStatus, defects, maintenanceRequired, commentary, evidencePhotoIds and aiConfidence.
Do not return a component unless it is actually visible in at least one supplied photo.
`,
  });

  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: { role: 'user', parts },
      config: { responseMimeType: 'application/json' },
    });
    if (!response.text) throw new Error('Empty AI component-discovery response.');
    const parsed = parseJson<unknown>(response.text);
    if (!Array.isArray(parsed)) throw new Error('AI component-discovery response was not an array.');
    return parsed
      .filter((item): item is Partial<StructuredComponentAnalysis> => Boolean(item && typeof item === 'object'))
      .map((item) => normaliseAnalysis(String(item.id || item.name || 'Component'), item, validPhotoIds))
      .filter((item) => (item.evidencePhotoIds?.length || 0) > 0);
  } catch (error) {
    console.warn('Server component discovery failed:', error);
    throw new Error('AI component discovery failed; no component assessments were changed.');
  }
}

export async function generateOverallCommentServer(
  roomName: string,
  photos: PhotoInput[],
  currentComment: string,
  previousReport?: PreviousReportInput,
): Promise<string> {
  const ai = requireGemini();
  const parts = buildPhotoParts(photos);
  addPreviousReportParts(parts, previousReport);
  parts.push({
    text: `
Write an objective area-level inspection summary for "${roomName}" using only visible evidence.
${GLOBAL_RULES}
Existing reviewed/manual comment: "${currentComment}"
${previousReport?.notes ? `Historical notes: "${previousReport.notes}". State differences cautiously and only where comparable.` : ''}
Return only the Australian-English paragraph. Do not overwrite existing facts with unsupported positive assumptions.
`,
  });

  try {
    const response = await ai.models.generateContent({ model: MODEL_NAME, contents: { role: 'user', parts } });
    if (!response.text?.trim()) throw new Error('Empty AI area-comment response.');
    return sanitizeProhibitedCausation(response.text.trim());
  } catch (error) {
    console.warn('Server area-comment generation failed:', error);
    throw new Error('AI area commentary generation failed; existing commentary was preserved.');
  }
}

export async function generateItemCommentServer(
  itemName: string,
  roomName: string,
  photos: PhotoInput[],
  currentComment: string,
  previousReport?: PreviousReportInput,
): Promise<StructuredComponentAnalysis> {
  const ai = requireGemini();
  const validPhotoIds = new Set(photos.map((photo) => photo.id));
  const parts = buildPhotoParts(photos);
  addPreviousReportParts(parts, previousReport);
  parts.push({
    text: `
Assess the component "${itemName}" in inspection area "${roomName}".
${GLOBAL_RULES}
Existing reviewed/manual commentary: "${currentComment}"
${previousReport?.notes ? `Historical notes: "${previousReport.notes}". Historical content must not be copied into current facts unless current evidence supports it.` : ''}
Return strictly valid JSON:
{
  "id": "${itemName}",
  "conditionCategory": "unable_to_confirm",
  "cleanlinessCategory": "unable_to_confirm",
  "workingStatus": "untested",
  "testStatus": "untested",
  "defects": [],
  "maintenanceRequired": false,
  "commentary": "Evidence-based visual observation",
  "evidencePhotoIds": [],
  "aiConfidence": 0.5
}
`,
  });

  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: { role: 'user', parts },
      config: { responseMimeType: 'application/json' },
    });
    if (!response.text) throw new Error('Empty AI component response.');
    return normaliseAnalysis(itemName, parseJson<Partial<StructuredComponentAnalysis>>(response.text), validPhotoIds);
  } catch (error) {
    console.warn(`Server component analysis failed for ${itemName}:`, error);
    throw new Error(`AI component analysis failed for ${itemName}; existing assessment was preserved.`);
  }
}

export async function generateBatchRoomAnalysisServer(
  roomName: string,
  photos: PhotoInput[],
  items: { id?: string; name?: string; comment?: string }[],
  currentOverallComment: string,
  previousReport?: PreviousReportInput,
): Promise<BatchRoomResult> {
  const ai = requireGemini();
  const validPhotoIds = new Set(photos.map((photo) => photo.id));
  const parts = buildPhotoParts(photos);
  addPreviousReportParts(parts, previousReport);
  const itemList = items.map((item) => `- ${item.id || item.name}: ${item.name || item.id} (existing comment: "${item.comment || ''}")`).join('\n');
  parts.push({
    text: `
Analyse inspection area "${roomName}".
${GLOBAL_RULES}
Existing area commentary: "${currentOverallComment}"
Components to assess:
${itemList}
${previousReport?.notes ? `Historical notes: "${previousReport.notes}". Use only for cautious comparison.` : ''}
Return strictly valid JSON with {"overallComment":"...","items":[...]}. Each returned item must use the supplied component id/name and include the same structured fields required for component analysis. If evidence does not support a dimension, return unable_to_confirm rather than a positive assumption.
`,
  });

  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: { role: 'user', parts },
      config: { responseMimeType: 'application/json' },
    });
    if (!response.text) throw new Error('Empty AI area-analysis response.');
    const parsed = parseJson<Partial<BatchRoomResult>>(response.text);
    const returnedItems = Array.isArray(parsed.items) ? parsed.items : [];
    const processedItems = items.map((requested) => {
      const key = requested.id || requested.name || 'Component';
      const match = returnedItems.find((item) => item.id === key || item.name === requested.name);
      if (!match) {
        const statuses = enforceWorkingStatusRules(requested.name || key, undefined, undefined);
        return {
          id: key,
          name: requested.name || key,
          conditionCategory: 'unable_to_confirm' as const,
          cleanlinessCategory: 'unable_to_confirm' as const,
          workingStatus: statuses.workingStatus,
          testStatus: statuses.testStatus,
          defects: [],
          maintenanceRequired: false,
          commentary: '',
          evidencePhotoIds: [],
          aiConfidence: 0,
          uncertainty: 'The AI response did not contain an assessment for this component; manual assessment is required.',
          reviewStatus: 'ai_generated' as ComponentReviewStatus,
          comparisonStatus: 'not_compared' as ComponentComparisonStatus,
        };
      }
      return normaliseAnalysis(key, { ...match, name: requested.name || match.name }, validPhotoIds);
    });

    return {
      overallComment: sanitizeProhibitedCausation(parsed.overallComment || currentOverallComment),
      items: processedItems,
    };
  } catch (error) {
    console.warn('Server batch area analysis failed:', error);
    throw new Error('AI area analysis failed; existing area and component assessments were preserved.');
  }
}

function conditionValue(value: string): ComponentConditionCategory {
  return CONDITION_VALUES.has(value as ComponentConditionCategory)
    ? value as ComponentConditionCategory
    : 'unable_to_confirm';
}

function cleanlinessValue(value: string): ComponentCleanlinessCategory {
  return CLEANLINESS_VALUES.has(value as ComponentCleanlinessCategory)
    ? value as ComponentCleanlinessCategory
    : 'unable_to_confirm';
}

function workingValue(value: string): ComponentWorkingStatus {
  return ['not_applicable', 'operation_confirmed', 'appears_operational', 'not_working', 'untested', 'unable_to_confirm'].includes(value)
    ? value as ComponentWorkingStatus
    : 'unable_to_confirm';
}

function testValue(value: string): ComponentTestStatus {
  return ['not_applicable', 'tested_passed', 'tested_failed', 'untested', 'unable_to_confirm'].includes(value)
    ? value as ComponentTestStatus
    : 'unable_to_confirm';
}

export async function generateExitComparisonServer(
  _roomName: string,
  itemName: string,
  baselineComponent: {
    conditionCategory: string;
    cleanlinessCategory: string;
    workingStatus: string;
    testStatus: string;
    commentary: string;
    defects: string[];
    photoReferences?: ReportPhotoReference[];
  },
  currentExitComponent: {
    conditionCategory: string;
    cleanlinessCategory: string;
    workingStatus: string;
    testStatus: string;
    commentary: string;
    defects: string[];
    photoReferences?: ReportPhotoReference[];
  },
  currentPhotos: PhotoInput[] = [],
): Promise<StructuredComponentAnalysis> {
  const { compareComponentEntryToExit } = await import('@pcr/domain');

  const baseline: BaselineComponentSnapshot & { component: string } = {
    id: itemName,
    component: itemName,
    conditionCategory: conditionValue(baselineComponent.conditionCategory),
    cleanlinessCategory: cleanlinessValue(baselineComponent.cleanlinessCategory),
    workingStatus: workingValue(baselineComponent.workingStatus),
    testStatus: testValue(baselineComponent.testStatus),
    commentary: sanitizeProhibitedCausation(baselineComponent.commentary || ''),
    defects: (baselineComponent.defects || []).map(sanitizeProhibitedCausation),
    photoReferences: baselineComponent.photoReferences || [],
  };
  const current = {
    id: itemName,
    component: itemName,
    conditionCategory: conditionValue(currentExitComponent.conditionCategory),
    cleanlinessCategory: cleanlinessValue(currentExitComponent.cleanlinessCategory),
    workingStatus: workingValue(currentExitComponent.workingStatus),
    testStatus: testValue(currentExitComponent.testStatus),
    commentary: sanitizeProhibitedCausation(currentExitComponent.commentary || ''),
    defects: (currentExitComponent.defects || []).map(sanitizeProhibitedCausation),
    photoReferences: currentExitComponent.photoReferences || [],
  };

  const comparison = compareComponentEntryToExit(baseline, current);
  const validPhotoIds = new Set(currentPhotos.map((photo) => photo.id));
  const validEvidence = validateEvidenceProvenance(
    currentExitComponent.photoReferences?.map((reference) => reference.photoId),
    validPhotoIds,
  );

  return {
    id: itemName,
    name: itemName,
    conditionCategory: current.conditionCategory,
    cleanlinessCategory: current.cleanlinessCategory,
    workingStatus: current.workingStatus,
    testStatus: current.testStatus,
    defects: current.defects,
    maintenanceRequired:
      current.conditionCategory === 'repair_required' ||
      current.conditionCategory === 'replacement_recommended' ||
      current.cleanlinessCategory === 'requires_cleaning' ||
      current.cleanlinessCategory === 'stained' ||
      current.workingStatus === 'not_working',
    commentary: current.commentary,
    evidencePhotoIds: validEvidence,
    aiConfidence: comparison.comparisonConfidence,
    reviewStatus: 'ai_generated',
    comparisonStatus: comparison.comparisonStatus as ComponentComparisonStatus,
    presenceComparison: comparison.presenceComparison,
    conditionComparison: comparison.conditionComparison,
    cleanlinessComparison: comparison.cleanlinessComparison,
    workingComparison: comparison.workingComparison,
    comparisonCommentary: comparison.comparisonCommentary,
    baselineComponentData: baseline,
    evidencePairs: comparison.evidencePairs,
    ...(comparison.comparisonUncertainty ? { comparisonUncertainty: comparison.comparisonUncertainty } : {}),
  };
}
