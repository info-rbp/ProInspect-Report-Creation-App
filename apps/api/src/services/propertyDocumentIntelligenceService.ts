import { randomUUID } from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import type { HistoricalExtractedFinding, RoomConfigItem } from '@pcr/domain';
import { pcrStandardAreas } from '@pcr/templates';

export const PROPERTY_DOCUMENT_PROMPT_VERSION = 'property-history-extraction-v1';
export const PROPERTY_DOCUMENT_MODEL = process.env.GEMINI_DOCUMENT_MODEL || process.env.GEMINI_MODEL || 'gemini-3.6-flash';

const PROHIBITED_CAUSATION = /\b(tenant caused|tenant damage|tenant damaged|tenant is responsible|tenant responsibility|tenant negligence|negligent|misuse|bond deduction|deduct from bond|fair wear and tear|not fair wear and tear)\b/giu;

export interface HistoricalDocumentExtraction {
  promptVersion: string;
  model: string;
  detectedReportType?: string;
  detectedInspectionDate?: string;
  summary: string;
  findings: HistoricalExtractedFinding[];
}

export interface HistoricalDocumentExtractionInput {
  fileName: string;
  contentType: string;
  base64Data: string;
  configuredAreas: Array<Pick<RoomConfigItem, 'id' | 'name' | 'roomType' | 'floorLevel'>>;
}

function client(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error('GEMINI_API_KEY is required for historical property document extraction.');
  return new GoogleGenAI({ apiKey, httpOptions: { headers: { 'User-Agent': 'proinspect-property-import' } } });
}

function parseJson<T>(text: string): T {
  return JSON.parse(text.replace(/```json|```/giu, '').trim()) as T;
}

function cleanText(value: unknown, maxLength = 2_000): string {
  if (typeof value !== 'string') return '';
  return value.replace(PROHIBITED_CAUSATION, '[liability statement omitted]').replace(/\s+/gu, ' ').trim().slice(0, maxLength);
}

function confidence(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : 0.5;
}

function pageNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function stringOrUndefined(value: unknown, maxLength = 300): string | undefined {
  const text = cleanText(value, maxLength);
  return text || undefined;
}

interface RawFinding {
  sourceArea?: unknown;
  sourceComponent?: unknown;
  sourceCommentary?: unknown;
  sourceCondition?: unknown;
  sourceCleanliness?: unknown;
  sourceWorkingStatus?: unknown;
  sourcePage?: unknown;
  proposedAreaId?: unknown;
  proposedComponentId?: unknown;
  confidence?: unknown;
  uncertainty?: unknown;
}

interface RawExtraction {
  detectedReportType?: unknown;
  detectedInspectionDate?: unknown;
  summary?: unknown;
  findings?: unknown;
}

export function normaliseHistoricalExtraction(
  raw: RawExtraction,
  configuredAreas: Array<Pick<RoomConfigItem, 'id' | 'name' | 'roomType' | 'floorLevel'>>,
): Omit<HistoricalDocumentExtraction, 'promptVersion' | 'model'> {
  const validAreaIds = new Set(configuredAreas.map((area) => area.id));
  const validComponentIds = new Set(pcrStandardAreas.flatMap((area) => area.components.map((component) => component.id)));
  const seen = new Set<string>();
  const findings: HistoricalExtractedFinding[] = [];

  if (Array.isArray(raw.findings)) {
    for (const candidate of raw.findings.slice(0, 500)) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
      const item = candidate as RawFinding;
      const sourceArea = cleanText(item.sourceArea, 200) || 'Unspecified Area';
      const sourceComponent = cleanText(item.sourceComponent, 200) || 'Unspecified Component';
      const sourceCommentary = cleanText(item.sourceCommentary, 2_000);
      if (!sourceCommentary) continue;
      const key = `${sourceArea.toLowerCase()}|${sourceComponent.toLowerCase()}|${sourceCommentary.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const proposedAreaId = typeof item.proposedAreaId === 'string' && validAreaIds.has(item.proposedAreaId)
        ? item.proposedAreaId
        : undefined;
      const proposedComponentId = typeof item.proposedComponentId === 'string' && validComponentIds.has(item.proposedComponentId)
        ? item.proposedComponentId
        : undefined;
      const score = confidence(item.confidence);
      findings.push({
        id: `historical-${randomUUID()}`,
        sourceArea,
        sourceComponent,
        sourceCommentary,
        ...(stringOrUndefined(item.sourceCondition) ? { sourceCondition: stringOrUndefined(item.sourceCondition) } : {}),
        ...(stringOrUndefined(item.sourceCleanliness) ? { sourceCleanliness: stringOrUndefined(item.sourceCleanliness) } : {}),
        ...(stringOrUndefined(item.sourceWorkingStatus) ? { sourceWorkingStatus: stringOrUndefined(item.sourceWorkingStatus) } : {}),
        ...(pageNumber(item.sourcePage) ? { sourcePage: pageNumber(item.sourcePage) } : {}),
        ...(proposedAreaId ? { proposedAreaId } : {}),
        ...(proposedComponentId ? { proposedComponentId } : {}),
        confidence: score,
        ...(stringOrUndefined(item.uncertainty, 500) ? { uncertainty: stringOrUndefined(item.uncertainty, 500) } : score < 0.7 ? { uncertainty: 'Low-confidence historical mapping requires manual review.' } : {}),
        decision: 'suggested',
      });
    }
  }

  return {
    ...(stringOrUndefined(raw.detectedReportType, 100) ? { detectedReportType: stringOrUndefined(raw.detectedReportType, 100) } : {}),
    ...(typeof raw.detectedInspectionDate === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(raw.detectedInspectionDate.trim())
      ? { detectedInspectionDate: raw.detectedInspectionDate.trim() }
      : {}),
    summary: cleanText(raw.summary, 3_000) || `Historical document extracted with ${findings.length} review candidate(s).`,
    findings,
  };
}

export async function extractHistoricalPropertyDocument(
  input: HistoricalDocumentExtractionInput,
): Promise<HistoricalDocumentExtraction> {
  const areaCatalog = input.configuredAreas.map((area) => ({
    areaId: area.id,
    name: area.name,
    roomType: area.roomType,
    floorLevel: area.floorLevel,
  }));
  const componentCatalog = pcrStandardAreas.map((area) => ({
    canonicalArea: area.name,
    components: area.components.map((component) => ({ componentId: component.id, name: component.name })),
  }));

  const prompt = `
You are extracting structured historical property-inspection information for ProInspect.
The attached file is an immutable historical source. Extract what the source actually states. Do not invent facts and do not rewrite the source document.

Rules:
- Return Australian-English factual observations only.
- Do not assign tenant liability, causation, negligence, fair-wear-and-tear conclusions, compensation or bond deductions.
- A historical source may state that an operational item was tested/working. Preserve that only when the source explicitly says so. Otherwise do not infer operation from appearance.
- sourceCommentary must be supported by the source document.
- sourcePage is the 1-based PDF page when identifiable.
- proposedAreaId must be one of the configured area IDs supplied below or omitted.
- proposedComponentId must be one of the canonical component IDs supplied below or omitted.
- Mapping is only a suggestion. Set lower confidence when labels are ambiguous.
- Extract no more than 500 material component findings.

Configured property areas:
${JSON.stringify(areaCatalog)}

Canonical component catalogue:
${JSON.stringify(componentCatalog)}

Return strictly valid JSON with this shape:
{
  "detectedReportType": "Property Condition Report | Routine Inspection | Exit Inspection | other",
  "detectedInspectionDate": "YYYY-MM-DD",
  "summary": "brief source-only summary",
  "findings": [
    {
      "sourceArea": "area heading in source",
      "sourceComponent": "component label in source",
      "sourceCommentary": "source-supported factual observation",
      "sourceCondition": "source condition wording if stated",
      "sourceCleanliness": "source cleanliness wording if stated",
      "sourceWorkingStatus": "source operation/test wording if explicitly stated",
      "sourcePage": 1,
      "proposedAreaId": "configured-area-id",
      "proposedComponentId": "canonical-component-id",
      "confidence": 0.8,
      "uncertainty": "reason when uncertain"
    }
  ]
}
`;

  const response = await client().models.generateContent({
    model: PROPERTY_DOCUMENT_MODEL,
    contents: {
      role: 'user',
      parts: [
        { inlineData: { mimeType: input.contentType, data: input.base64Data } },
        { text: `[Historical file: ${input.fileName}]` },
        { text: prompt },
      ],
    },
    config: { responseMimeType: 'application/json' },
  });
  if (!response.text?.trim()) throw new Error('Historical document extraction returned an empty response.');
  return {
    promptVersion: PROPERTY_DOCUMENT_PROMPT_VERSION,
    model: PROPERTY_DOCUMENT_MODEL,
    ...normaliseHistoricalExtraction(parseJson<RawExtraction>(response.text), input.configuredAreas),
  };
}
