import { randomUUID } from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import type { HistoricalExtractedFinding, RoomConfigItem } from '@pcr/domain';

export const PROPERTY_DOCUMENT_PROMPT_VERSION = 'property-history-extraction-v2-canonical';
export const PROPERTY_DOCUMENT_MODEL = process.env.GEMINI_DOCUMENT_MODEL || process.env.GEMINI_MODEL || 'gemini-3.6-flash';

const PROHIBITED_CAUSATION = /\b(tenant caused|tenant damage|tenant damaged|tenant is responsible|tenant responsibility|tenant negligence|negligent|misuse|bond deduction|deduct from bond|fair wear and tear|not fair wear and tear)\b/giu;

type ConfiguredArea = Pick<
  RoomConfigItem,
  'id' | 'name' | 'roomType' | 'floorLevel' | 'canonicalAreaDefinitionId' | 'canonicalAreaDefinitionVersion' | 'componentRefs'
>;

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
  configuredAreas: ConfiguredArea[];
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
  proposedCanonicalComponentDefinitionId?: unknown;
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

function configuredAreaById(configuredAreas: ConfiguredArea[], id: unknown): ConfiguredArea | undefined {
  if (typeof id !== 'string') return undefined;
  return configuredAreas.find((area) => area.id === id.trim());
}

function canonicalComponentForArea(area: ConfiguredArea | undefined, rawId: unknown) {
  if (!area || typeof rawId !== 'string') return undefined;
  const id = rawId.trim();
  return area.componentRefs?.find((component) => component.canonicalComponentDefinitionId === id);
}

export function normaliseHistoricalExtraction(
  raw: RawExtraction,
  configuredAreas: ConfiguredArea[],
): Omit<HistoricalDocumentExtraction, 'promptVersion' | 'model'> {
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

      const proposedArea = configuredAreaById(configuredAreas, item.proposedAreaId);
      const requestedCanonicalComponentId = typeof item.proposedCanonicalComponentDefinitionId === 'string'
        ? item.proposedCanonicalComponentDefinitionId
        : item.proposedComponentId;
      const proposedComponent = canonicalComponentForArea(proposedArea, requestedCanonicalComponentId);
      const score = confidence(item.confidence);
      const mappingComplete = Boolean(
        proposedArea?.canonicalAreaDefinitionId &&
        proposedArea.canonicalAreaDefinitionVersion &&
        proposedComponent,
      );
      findings.push({
        id: `historical-${randomUUID()}`,
        sourceArea,
        sourceComponent,
        sourceCommentary,
        ...(stringOrUndefined(item.sourceCondition) ? { sourceCondition: stringOrUndefined(item.sourceCondition) } : {}),
        ...(stringOrUndefined(item.sourceCleanliness) ? { sourceCleanliness: stringOrUndefined(item.sourceCleanliness) } : {}),
        ...(stringOrUndefined(item.sourceWorkingStatus) ? { sourceWorkingStatus: stringOrUndefined(item.sourceWorkingStatus) } : {}),
        ...(pageNumber(item.sourcePage) ? { sourcePage: pageNumber(item.sourcePage) } : {}),
        ...(proposedArea ? { proposedAreaId: proposedArea.id } : {}),
        ...(proposedArea?.canonicalAreaDefinitionId ? {
          proposedCanonicalAreaDefinitionId: proposedArea.canonicalAreaDefinitionId,
          proposedCanonicalAreaDefinitionVersion: proposedArea.canonicalAreaDefinitionVersion,
        } : {}),
        ...(proposedComponent ? {
          proposedComponentId: proposedComponent.canonicalComponentDefinitionId,
          proposedCanonicalComponentDefinitionId: proposedComponent.canonicalComponentDefinitionId,
          proposedCanonicalComponentDefinitionVersion: proposedComponent.canonicalComponentDefinitionVersion,
        } : {}),
        confidence: mappingComplete ? score : Math.min(score, 0.55),
        ...(stringOrUndefined(item.uncertainty, 500)
          ? { uncertainty: stringOrUndefined(item.uncertainty, 500) }
          : !mappingComplete
            ? { uncertainty: 'Historical finding could not be mapped to an exact current Property Area occurrence and canonical Component identity.' }
            : score < 0.7
              ? { uncertainty: 'Low-confidence historical canonical mapping requires manual review.' }
              : {}),
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
    propertyAreaInstanceId: area.id,
    displayName: area.name,
    roomType: area.roomType,
    floorLevel: area.floorLevel,
    canonicalAreaDefinitionId: area.canonicalAreaDefinitionId,
    canonicalAreaDefinitionVersion: area.canonicalAreaDefinitionVersion,
    components: (area.componentRefs || []).map((component) => ({
      propertyComponentInstanceId: component.id,
      displayName: component.name,
      canonicalComponentDefinitionId: component.canonicalComponentDefinitionId,
      canonicalComponentDefinitionVersion: component.canonicalComponentDefinitionVersion,
      canonicalAreaComponentRuleId: component.canonicalAreaComponentRuleId,
      canonicalAreaComponentRuleVersion: component.canonicalAreaComponentRuleVersion,
    })),
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
- proposedAreaId must be one of the exact Property Area instance IDs supplied below or omitted.
- proposedCanonicalComponentDefinitionId must be a canonical Component ID present inside that selected Property Area or omitted.
- Never map by invented IDs. Display labels are evidence for a suggestion, not identity.
- Mapping is only a suggestion. Set lower confidence when labels are ambiguous.
- Extract no more than 500 material component findings.

Current canonical Property layout:
${JSON.stringify(areaCatalog)}

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
      "proposedAreaId": "exact-property-area-instance-id",
      "proposedCanonicalComponentDefinitionId": "canonical-component-definition-id",
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
