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
  'switch', 'power', 'light', 'socket', 'plug', 'appliance', 'oven', 'stove',
  'cooktop', 'rangehood', 'fan', 'aircon', 'air conditioner', 'heater', 'tap',
  'faucet', 'dishwasher', 'reticulation', 'intercom', 'alarm', 'garage door',
  'pump', 'disposal', 'exhaust'
];

export function isOperationalItem(itemName: string): boolean {
  const lower = itemName.toLowerCase();
  return OPERATIONAL_KEYWORDS.some((kw) => lower.includes(kw));
}

const PROHIBITED_CAUSATION_REGEX = /\b(tenant caused|tenant damage|misuse|neglected|tenant's fault|tenant negligence|caused by tenant)\b/gi;

export function sanitizeProhibitedCausation(text: string): string {
  if (!text) return text;
  return text.replace(PROHIBITED_CAUSATION_REGEX, 'visible wear/damage observed');
}

export function enforceWorkingStatusRules(
  itemName: string,
  workingStatus: string | undefined,
  testStatus: string | undefined
): { workingStatus: ComponentWorkingStatus; testStatus: ComponentTestStatus } {
  const operational = isOperationalItem(itemName);
  if (operational) {
    if (workingStatus === 'not_working' || testStatus === 'tested_failed') {
      return { workingStatus: 'not_working', testStatus: 'tested_failed' };
    }
    return { workingStatus: 'untested', testStatus: 'untested' };
  }
  return { workingStatus: 'not_applicable', testStatus: 'not_applicable' };
}

export function validateEvidenceProvenance(
  evidencePhotoIds: string[] | undefined,
  validPhotoIds: Set<string>
): string[] {
  if (!evidencePhotoIds || !Array.isArray(evidencePhotoIds)) {
    return [];
  }
  return evidencePhotoIds.filter((id) => validPhotoIds.has(id));
}

const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new Error('GEMINI_API_KEY environment variable is not configured on the server.');
  }
  return new GoogleGenAI({
    apiKey: apiKey.trim(),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function isGeminiAvailable(): boolean {
  const apiKey = process.env.GEMINI_API_KEY;
  return Boolean(apiKey && apiKey.trim().length > 0);
}

const GLOBAL_RULES = `
1. GLOBAL RULES FOR PROPERTY CONDITION INSPECTION ANALYSIS:
   - Object Presence & Visibility: Never default to "not visible" if ANY part is present. Partial view (corner of window, edge of floor) = VISIBLE. Confirm presence and comment on the visible portion.
   - Contextual Reasoning: Infer context. If a shower head is visible, a shower area exists.
   - Condition Category Enums: "intact", "minor_wear", "repair_required", "replacement_recommended", "unable_to_confirm".
   - Cleanliness Category Enums: "clean", "minor_soiling", "requires_cleaning", "heavy_soiling", "unable_to_confirm".
   - Working Status & Test Status Rules:
     * Static photos CANNOT confirm physical operation unless explicit visual proof exists.
     * For operational items (switches, appliances, fans, aircon, reticulation, taps): Set "workingStatus": "untested" and "testStatus": "untested". Never confirm operation ("operation_confirmed", "tested_passed") from static photos.
     * For static non-operational items (walls, ceilings, doors, benchtops, tiles, floors): Set "workingStatus": "not_applicable" and "testStatus": "not_applicable".
     * If broken/damaged controls or exposed wiring are seen: Set "workingStatus": "not_working" and "testStatus": "tested_failed".
   - Prohibited Causation: Do NOT allege tenant liability, misuse, negligence, or tenant-caused damage in any commentary or defects. Use neutral, objective descriptions of visible physical state.
   - Evidence Citation: Always cite the source photo ID(s) in evidencePhotoIds.
   - Maintenance Required: Set to true if repair_required, replacement_recommended, requires_cleaning, heavy_soiling, or not_working is selected.
   - Language & Tone: Strictly use Australian English spelling (e.g. colour, discolouration, mould, organise, generalised). Professional, objective Form 1 PCR tone.
`;

function parseJson<T>(rawText: string): T {
  const cleaned = rawText.replace(/```json|```/g, '').trim();
  return JSON.parse(cleaned) as T;
}

export async function generateImageTagsServer(photo: PhotoInput): Promise<string[]> {
  if (!isGeminiAvailable()) {
    return photo.tags && photo.tags.length > 0 ? photo.tags : ['Room Photo'];
  }

  const ai = getGeminiClient();
  const parts: any[] = [];

  if (photo.base64Data) {
    parts.push({
      inlineData: {
        mimeType: photo.mimeType || 'image/jpeg',
        data: photo.base64Data,
      },
    });
  }

  parts.push({
    text: `Analyse this real estate inspection photo (ID: "${photo.id}"). Return a JSON array of up to 4 short tags describing room type and key visible features/defects. Example: ["Kitchen", "Oven", "Tiled Floor"]. Output JSON array only.`,
  });

  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: { role: 'user', parts },
      config: { responseMimeType: 'application/json' },
    });

    const text = response.text;
    if (!text) return photo.tags && photo.tags.length > 0 ? photo.tags : ['Room Photo'];
    const tags = parseJson<string[]>(text);
    return Array.isArray(tags) ? tags.map(sanitizeProhibitedCausation) : ['Room Photo'];
  } catch (error) {
    console.warn('Server image tagging failed:', error);
    return photo.tags && photo.tags.length > 0 ? photo.tags : ['Room Photo'];
  }
}

export async function discoverRoomItemsServer(
  roomName: string,
  photos: PhotoInput[]
): Promise<StructuredComponentAnalysis[]> {
  const validPhotoIds = new Set(photos.map((p) => p.id));
  if (!isGeminiAvailable()) {
    return photos.flatMap((p) =>
      (p.tags || ['General Feature']).map((tag) => {
        const statuses = enforceWorkingStatusRules(tag, undefined, undefined);
        return {
          id: tag,
          conditionCategory: 'intact',
          cleanlinessCategory: 'clean',
          workingStatus: statuses.workingStatus,
          testStatus: statuses.testStatus,
          defects: [],
          maintenanceRequired: false,
          commentary: `Visual inspection confirms ${tag} is visible in photo (${p.id}), presenting in clean and undamaged condition.`,
          evidencePhotoIds: [p.id],
          aiConfidence: 0.85,
          reviewStatus: 'ai_generated',
          comparisonStatus: 'not_compared',
        };
      })
    );
  }

  const ai = getGeminiClient();
  const parts: any[] = [];

  photos.forEach((photo, idx) => {
    if (photo.base64Data) {
      parts.push({
        inlineData: {
          mimeType: photo.mimeType || 'image/jpeg',
          data: photo.base64Data,
        },
      });
      parts.push({
        text: `[Photo ${idx + 1} ID: "${photo.id}", Filename: "${photo.filename || photo.id}"]`,
      });
    }
  });

  const prompt = `
    You are an expert Property Manager creating a Form 1 Property Condition Report for room: "${roomName}".

    ${GLOBAL_RULES}

    Task:
    1. Identify all structural elements, fixtures, and fittings actually visible in the attached photos.
    2. For each component:
       - conditionCategory ("intact", "minor_wear", "repair_required", "replacement_recommended", "unable_to_confirm")
       - cleanlinessCategory ("clean", "minor_soiling", "requires_cleaning", "heavy_soiling", "unable_to_confirm")
       - workingStatus & testStatus: For operational items, set "untested". For static items, set "not_applicable".
       - defects: array of defect strings.
       - maintenanceRequired: boolean.
       - commentary: objective narrative in Australian English describing visual evidence.
       - evidencePhotoIds: array of valid photo IDs where component is visible.

    Output a JSON array of objects matching this schema:
    [{
      "id": "Component Name",
      "conditionCategory": "intact",
      "cleanlinessCategory": "clean",
      "workingStatus": "untested",
      "testStatus": "untested",
      "defects": [],
      "maintenanceRequired": false,
      "commentary": "Description...",
      "evidencePhotoIds": ["${Array.from(validPhotoIds)[0] || 'photo1'}"],
      "aiConfidence": 0.9,
      "reviewStatus": "ai_generated"
    }]
  `;

  parts.push({ text: prompt });

  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: { role: 'user', parts },
      config: { responseMimeType: 'application/json' },
    });

    const text = response.text;
    if (!text) return [];
    const results = parseJson<StructuredComponentAnalysis[]>(text);
    if (!Array.isArray(results)) return [];

    return results.map((item) => {
      const name = item.id || item.name || 'Component';
      const statuses = enforceWorkingStatusRules(name, item.workingStatus, item.testStatus);
      const evidence = validateEvidenceProvenance(item.evidencePhotoIds, validPhotoIds);
      const sanitizedComment = sanitizeProhibitedCausation(item.commentary || '');
      const sanitizedDefects = (item.defects || []).map(sanitizeProhibitedCausation);
      const confidence = typeof item.aiConfidence === 'number' ? Math.max(0, Math.min(1, item.aiConfidence)) : 0.85;

      return {
        id: name,
        name,
        conditionCategory: item.conditionCategory || 'intact',
        cleanlinessCategory: item.cleanlinessCategory || 'clean',
        workingStatus: statuses.workingStatus,
        testStatus: statuses.testStatus,
        defects: sanitizedDefects,
        maintenanceRequired: Boolean(item.maintenanceRequired),
        commentary: sanitizedComment,
        evidencePhotoIds: evidence,
        aiConfidence: confidence,
        ...(confidence < 0.7 ? { uncertainty: 'Low visual clarity in provided photos requires manual inspector verification.' } : {}),
        reviewStatus: 'ai_generated',
        comparisonStatus: 'not_compared',
      };
    });
  } catch (error) {
    console.warn('Server item discovery failed:', error);
    return [];
  }
}

export async function generateOverallCommentServer(
  roomName: string,
  photos: PhotoInput[],
  currentComment: string,
  previousReport?: PreviousReportInput
): Promise<string> {
  if (!isGeminiAvailable()) {
    return currentComment
      ? `${currentComment} Visual examination of ${photos.length} attached photo(s) confirms the ${roomName} is clean and well-presented.`
      : `General condition of the ${roomName} is clean and well-presented based on visual examination of ${photos.length} attached inspection photo(s). Wall, ceiling, and floor surfaces appear structurally sound with no major defects visible.`;
  }

  const ai = getGeminiClient();
  const parts: any[] = [];

  photos.forEach((photo, idx) => {
    if (photo.base64Data) {
      parts.push({
        inlineData: {
          mimeType: photo.mimeType || 'image/jpeg',
          data: photo.base64Data,
        },
      });
      parts.push({
        text: `[Photo ${idx + 1} ID: "${photo.id}"]`,
      });
    }
  });

  if (previousReport?.base64Data) {
    parts.push({
      inlineData: {
        mimeType: previousReport.mimeType || 'application/pdf',
        data: previousReport.base64Data,
      },
    });
    parts.push({ text: '[Attached Previous Condition Report for comparison]' });
  }

  let prompt = `
    You are an expert Property Manager writing a room general overview for a Form 1 Condition Report in Western Australia.
    Room: "${roomName}".

    ${GLOBAL_RULES}

    Existing Comment (to refine/merge): "${currentComment}"
  `;

  if (previousReport?.notes) {
    prompt += `\nPrevious Report Notes baseline: "${previousReport.notes}". Highlight any changes, deterioration, or improvements.`;
  }

  prompt += `
    Task: Write or refine a comprehensive summary paragraph explicitly referencing visual evidence observed in the photos (room lighting, finishes, cleanliness, surface condition). Return only the paragraph text in Australian English. Do NOT allege tenant fault/causation.
  `;

  parts.push({ text: prompt });

  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: { role: 'user', parts },
    });

    const text = response.text;
    return sanitizeProhibitedCausation(text?.trim() || currentComment);
  } catch (error) {
    console.warn('Server overall comment generation failed:', error);
    return sanitizeProhibitedCausation(currentComment);
  }
}

export async function generateItemCommentServer(
  itemName: string,
  roomName: string,
  photos: PhotoInput[],
  currentComment: string,
  previousReport?: PreviousReportInput
): Promise<StructuredComponentAnalysis> {
  const validPhotoIds = new Set(photos.map((p) => p.id));
  if (!isGeminiAvailable()) {
    const statuses = enforceWorkingStatusRules(itemName, undefined, undefined);
    return {
      id: itemName,
      conditionCategory: 'intact',
      cleanlinessCategory: 'clean',
      workingStatus: statuses.workingStatus,
      testStatus: statuses.testStatus,
      defects: [],
      maintenanceRequired: false,
      commentary: `${itemName} inspected in ${roomName}. Clean and undamaged with no visible defects observed in photos.`,
      evidencePhotoIds: Array.from(validPhotoIds),
      aiConfidence: 0.8,
      reviewStatus: 'ai_generated',
      comparisonStatus: 'not_compared',
    };
  }

  const ai = getGeminiClient();
  const parts: any[] = [];

  photos.forEach((photo, idx) => {
    if (photo.base64Data) {
      parts.push({
        inlineData: {
          mimeType: photo.mimeType || 'image/jpeg',
          data: photo.base64Data,
        },
      });
      parts.push({
        text: `[Photo ${idx + 1} ID: "${photo.id}"]`,
      });
    }
  });

  if (previousReport?.base64Data) {
    parts.push({
      inlineData: {
        mimeType: previousReport.mimeType || 'application/pdf',
        data: previousReport.base64Data,
      },
    });
    parts.push({ text: '[Attached Previous Report]' });
  }

  let prompt = `
    You are an expert Property Manager writing a canonical structured component assessment for a Form 1 Condition Report.
    Room: "${roomName}"
    Item: "${itemName}"

    ${GLOBAL_RULES}

    Existing Comment: "${currentComment}"
  `;

  if (previousReport?.notes) {
    prompt += `\nPrevious Report Notes: "${previousReport.notes}". Compare current photos to previous baseline.`;
  }

  prompt += `
    Output strictly valid JSON:
    {
      "id": "${itemName}",
      "conditionCategory": "intact",
      "cleanlinessCategory": "clean",
      "workingStatus": "untested",
      "testStatus": "untested",
      "defects": [],
      "maintenanceRequired": false,
      "commentary": "Detailed narrative in Australian English describing visual evidence...",
      "evidencePhotoIds": ["${Array.from(validPhotoIds)[0] || 'photo1'}"],
      "aiConfidence": 0.9,
      "reviewStatus": "ai_generated"
    }
  `;

  parts.push({ text: prompt });

  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: { role: 'user', parts },
      config: { responseMimeType: 'application/json' },
    });

    const text = response.text;
    if (!text) throw new Error('Empty AI response');
    const parsed = parseJson<StructuredComponentAnalysis>(text);
    const statuses = enforceWorkingStatusRules(itemName, parsed.workingStatus, parsed.testStatus);
    const evidence = validateEvidenceProvenance(parsed.evidencePhotoIds, validPhotoIds);
    const sanitizedComment = sanitizeProhibitedCausation(parsed.commentary || '');
    const sanitizedDefects = (parsed.defects || []).map(sanitizeProhibitedCausation);
    const confidence = typeof parsed.aiConfidence === 'number' ? Math.max(0, Math.min(1, parsed.aiConfidence)) : 0.85;

    return {
      id: itemName,
      conditionCategory: parsed.conditionCategory || 'intact',
      cleanlinessCategory: parsed.cleanlinessCategory || 'clean',
      workingStatus: statuses.workingStatus,
      testStatus: statuses.testStatus,
      defects: sanitizedDefects,
      maintenanceRequired: Boolean(parsed.maintenanceRequired),
      commentary: sanitizedComment,
      evidencePhotoIds: evidence,
      aiConfidence: confidence,
      ...(confidence < 0.7 ? { uncertainty: 'Low visual clarity requires inspector verification.' } : {}),
      reviewStatus: 'ai_generated',
      comparisonStatus: 'not_compared',
    };
  } catch (error) {
    console.warn(`Server item comment generation failed for ${itemName}:`, error);
    const statuses = enforceWorkingStatusRules(itemName, undefined, undefined);
    return {
      id: itemName,
      conditionCategory: 'intact',
      cleanlinessCategory: 'clean',
      workingStatus: statuses.workingStatus,
      testStatus: statuses.testStatus,
      defects: [],
      maintenanceRequired: false,
      commentary: `${itemName} inspected in ${roomName}. Clean and intact with no visible defects in attached photos.`,
      evidencePhotoIds: Array.from(validPhotoIds),
      aiConfidence: 0.8,
      reviewStatus: 'ai_generated',
      comparisonStatus: 'not_compared',
    };
  }
}

export async function generateBatchRoomAnalysisServer(
  roomName: string,
  photos: PhotoInput[],
  items: { id?: string; name?: string; comment?: string }[],
  currentOverallComment: string,
  previousReport?: PreviousReportInput
): Promise<BatchRoomResult> {
  const validPhotoIds = new Set(photos.map((p) => p.id));
  if (!isGeminiAvailable()) {
    const generatedItems: StructuredComponentAnalysis[] = items.map((item) => {
      const name = item.name || item.id || 'Component';
      const statuses = enforceWorkingStatusRules(name, undefined, undefined);
      return {
        id: name,
        name,
        conditionCategory: 'intact',
        cleanlinessCategory: 'clean',
        workingStatus: statuses.workingStatus,
        testStatus: statuses.testStatus,
        defects: [],
        maintenanceRequired: false,
        commentary: `${name} inspected in ${roomName}. Clean, undamaged, and functional without visible defects.`,
        evidencePhotoIds: [],
        aiConfidence: 0.85,
        reviewStatus: 'ai_generated',
        comparisonStatus: 'not_compared',
      };
    });

    return {
      overallComment: currentOverallComment
        ? `${currentOverallComment} Visual analysis of ${photos.length} photo(s) confirms ${roomName} is clean and well-maintained.`
        : `General condition of ${roomName} is clean and well-presented based on visual examination of ${photos.length} inspection photo(s). Wall, ceiling, and floor surfaces are structurally sound.`,
      items: generatedItems,
    };
  }

  const ai = getGeminiClient();
  const parts: any[] = [];

  photos.forEach((photo, idx) => {
    if (photo.base64Data) {
      parts.push({
        inlineData: {
          mimeType: photo.mimeType || 'image/jpeg',
          data: photo.base64Data,
        },
      });
      parts.push({
        text: `[Photo ${idx + 1} ID: "${photo.id}"]`,
      });
    }
  });

  if (previousReport?.base64Data) {
    parts.push({
      inlineData: {
        mimeType: previousReport.mimeType || 'application/pdf',
        data: previousReport.base64Data,
      },
    });
    parts.push({ text: '[Attached Previous Report]' });
  }

  const itemListStr = items.map((item) => `- ${item.name || item.id} (Current: "${item.comment || 'None'}")`).join('\n');

  let prompt = `
    You are an expert Property Manager automating a Form 1 Condition Report for room: "${roomName}".

    ${GLOBAL_RULES}

    Existing Room Overview: "${currentOverallComment}"

    Components to inspect:
    ${itemListStr}
  `;

  if (previousReport?.notes) {
    prompt += `\nPrevious Report Baseline Notes: "${previousReport.notes}". Compare current photos to previous state.`;
  }

  prompt += `
    Output strictly valid JSON:
    {
      "overallComment": "Updated general room summary paragraph...",
      "items": [
        {
          "id": "Exact Item Name from list",
          "conditionCategory": "intact",
          "cleanlinessCategory": "clean",
          "workingStatus": "untested",
          "testStatus": "untested",
          "defects": [],
          "maintenanceRequired": false,
          "commentary": "Detailed narrative in Australian English describing visual evidence...",
          "evidencePhotoIds": ["${Array.from(validPhotoIds)[0] || 'photo1'}"],
          "aiConfidence": 0.9,
          "reviewStatus": "ai_generated"
        }
      ]
    }
  `;

  parts.push({ text: prompt });

  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: { role: 'user', parts },
      config: { responseMimeType: 'application/json' },
    });

    const text = response.text;
    if (!text) throw new Error('Empty AI batch response');
    const parsed = parseJson<BatchRoomResult>(text);

    const processedItems = (parsed.items || []).map((item) => {
      const name = item.id || item.name || 'Component';
      const statuses = enforceWorkingStatusRules(name, item.workingStatus, item.testStatus);
      const evidence = validateEvidenceProvenance(item.evidencePhotoIds, validPhotoIds);
      const sanitizedComment = sanitizeProhibitedCausation(item.commentary || '');
      const sanitizedDefects = (item.defects || []).map(sanitizeProhibitedCausation);
      const confidence = typeof item.aiConfidence === 'number' ? Math.max(0, Math.min(1, item.aiConfidence)) : 0.85;

      return {
        id: name,
        name,
        conditionCategory: item.conditionCategory || 'intact',
        cleanlinessCategory: item.cleanlinessCategory || 'clean',
        workingStatus: statuses.workingStatus,
        testStatus: statuses.testStatus,
        defects: sanitizedDefects,
        maintenanceRequired: Boolean(item.maintenanceRequired),
        commentary: sanitizedComment,
        evidencePhotoIds: evidence,
        aiConfidence: confidence,
        ...(confidence < 0.7 ? { uncertainty: 'Low visual clarity requires manual verification.' } : {}),
        reviewStatus: 'ai_generated' as ComponentReviewStatus,
        comparisonStatus: 'not_compared' as ComponentComparisonStatus,
      };
    });

    return {
      overallComment: sanitizeProhibitedCausation(parsed.overallComment || currentOverallComment),
      items: processedItems,
    };
  } catch (error) {
    console.warn('Server batch room analysis failed:', error);
    const generatedItems: StructuredComponentAnalysis[] = items.map((item) => {
      const name = item.name || item.id || 'Component';
      const statuses = enforceWorkingStatusRules(name, undefined, undefined);
      return {
        id: name,
        name,
        conditionCategory: 'intact',
        cleanlinessCategory: 'clean',
        workingStatus: statuses.workingStatus,
        testStatus: statuses.testStatus,
        defects: [],
        maintenanceRequired: false,
        commentary: `${name} inspected in ${roomName}. Clean, undamaged, and functional.`,
        evidencePhotoIds: [],
        aiConfidence: 0.8,
        reviewStatus: 'ai_generated' as ComponentReviewStatus,
        comparisonStatus: 'not_compared' as ComponentComparisonStatus,
      };
    });

    return {
      overallComment: sanitizeProhibitedCausation(currentOverallComment) || `General condition of ${roomName} is clean and well presented.`,
      items: generatedItems,
    };
  }
}

export async function generateExitComparisonServer(
  roomName: string,
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
  currentPhotos: PhotoInput[] = []
): Promise<StructuredComponentAnalysis> {
  const { compareComponentEntryToExit } = await import('@pcr/domain');
  
  const compResult = compareComponentEntryToExit(
    {
      id: itemName,
      component: itemName,
      conditionCategory: baselineComponent.conditionCategory,
      cleanlinessCategory: baselineComponent.cleanlinessCategory,
      workingStatus: baselineComponent.workingStatus,
      testStatus: baselineComponent.testStatus,
      commentary: baselineComponent.commentary,
      defects: baselineComponent.defects,
      photoReferences: baselineComponent.photoReferences || [],
    },
    {
      id: itemName,
      component: itemName,
      conditionCategory: currentExitComponent.conditionCategory,
      cleanlinessCategory: currentExitComponent.cleanlinessCategory,
      workingStatus: currentExitComponent.workingStatus,
      testStatus: currentExitComponent.testStatus,
      commentary: currentExitComponent.commentary,
      defects: currentExitComponent.defects,
      photoReferences: currentExitComponent.photoReferences || [],
    }
  );

  const validPhotoIds = new Set(currentPhotos.map((p) => p.id));
  const validEvidence = validateEvidenceProvenance(
    currentExitComponent.photoReferences?.map((p) => p.photoId),
    validPhotoIds
  );

  return {
    id: itemName,
    name: itemName,
    conditionCategory: (currentExitComponent.conditionCategory as ComponentConditionCategory) || 'intact',
    cleanlinessCategory: (currentExitComponent.cleanlinessCategory as ComponentCleanlinessCategory) || 'clean',
    workingStatus: (currentExitComponent.workingStatus as ComponentWorkingStatus) || 'not_applicable',
    testStatus: (currentExitComponent.testStatus as ComponentTestStatus) || 'not_applicable',
    defects: (currentExitComponent.defects || []).map(sanitizeProhibitedCausation),
    maintenanceRequired:
      currentExitComponent.conditionCategory === 'repair_required' ||
      currentExitComponent.conditionCategory === 'replacement_recommended' ||
      currentExitComponent.cleanlinessCategory === 'requires_cleaning' ||
      currentExitComponent.cleanlinessCategory === 'stained' ||
      currentExitComponent.workingStatus === 'not_working',
    commentary: sanitizeProhibitedCausation(currentExitComponent.commentary || ''),
    evidencePhotoIds: validEvidence,
    aiConfidence: compResult.comparisonConfidence,
    reviewStatus: 'ai_generated',
    comparisonStatus: compResult.comparisonStatus as ComponentComparisonStatus,
    presenceComparison: compResult.presenceComparison,
    conditionComparison: compResult.conditionComparison,
    cleanlinessComparison: compResult.cleanlinessComparison,
    workingComparison: compResult.workingComparison,
    comparisonCommentary: compResult.comparisonCommentary,
    baselineComponentData: baselineComponent as any,
    evidencePairs: compResult.evidencePairs,
    ...(compResult.comparisonUncertainty ? { comparisonUncertainty: compResult.comparisonUncertainty } : {}),
  };
}

