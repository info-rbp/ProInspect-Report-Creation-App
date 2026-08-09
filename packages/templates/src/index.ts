import type { InspectionType } from '@pcr/domain';

export * from './pcrPreset.js';

export type TemplateStatus = 'draft' | 'published' | 'retired';
export type VisibilityState = 'visible' | 'partially_visible' | 'not_visible' | 'not_applicable';
export type WorkingState = 'tested_working' | 'tested_not_working' | 'not_tested' | 'not_relevant';
export type ConditionState = 'clean_intact' | 'requires_cleaning' | 'minor_wear' | 'repair_required' | 'damaged' | 'unable_to_confirm';

export interface CommentaryEntry {
  id: string;
  area: string;
  component: string;
  subComponent?: string;
  inspectionTypes: InspectionType[];
  condition: ConditionState | string;
  cleanliness?: string;
  workingStatus?: string;
  material?: string;
  text: string;
  status?: TemplateStatus | 'active' | 'inactive';
  version?: number;
  priority?: number;
  propertyType?: string;
  notes?: string;
  active?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface TemplateComponent {
  id: string;
  name: string;
  required: boolean;
  photoRequired: boolean;
}

export interface TemplateArea {
  id: string;
  name: string;
  components: TemplateComponent[];
}

export interface InspectionTypeTemplate {
  id: string;
  version: number;
  inspectionType: InspectionType;
  propertyType: string;
  status: TemplateStatus;
  areas: TemplateArea[];
  commentaryBank: CommentaryEntry[];
  createdAt: string;
  publishedAt?: string;
  retiredAt?: string;
}

export interface StructuredInspectionFact {
  area: string;
  component: string;
  subComponent?: string;
  material?: string;
  colour?: string;
  type?: string;
  quantity?: number;
  visibility: VisibilityState;
  condition: ConditionState;
  cleanliness?: string;
  cleanlinessIssue?: string;
  conditionIssue?: string;
  workingState: WorkingState;
  photoReferences: string[];
  inspectionType?: InspectionType;
}

export interface GeneratedCommentary {
  area: string;
  component: string;
  commentary: string;
  photoReferences: string[];
  bankEntryId?: string;
  generationMethod: 'bank_rule' | 'fallback_rule' | 'ai_refined' | 'manual';
  templateId?: string;
  templateVersion?: number;
}

export interface ImportRow {
  area: string;
  component: string;
  condition: string;
  inspectionTypes: string;
  text: string;
  subComponent?: string;
  cleanliness?: string;
  workingStatus?: string;
}

export interface ImportValidationIssue {
  row: number;
  code: 'DUPLICATE' | 'MISSING_VALUE' | 'INVALID_CONDITION' | 'INVALID_INSPECTION_TYPE' | 'PROHIBITED_LANGUAGE' | 'INVALID_PLACEHOLDER';
  message: string;
}

export interface ImportValidationResult {
  entries: CommentaryEntry[];
  issues: ImportValidationIssue[];
  totalRows: number;
  validRows: number;
  duplicateRows: number;
}

const conditions = new Set<string>(['clean_intact', 'requires_cleaning', 'minor_wear', 'repair_required', 'damaged', 'unable_to_confirm']);
const inspectionTypes = new Set<InspectionType>(['entry', 'routine', 'exit', 'comparison', 'maintenance']);
export const prohibitedLiabilityLanguage = /\b(tenant caused|tenant damage|damaged by tenant|misuse|neglected|poorly maintained|tenant responsibility|bond deduction|negligent)\b/i;
const ALLOWED_PLACEHOLDERS = new Set([
  'details', 'component', 'area', 'subComponent', 'material', 'colour', 'color', 'type', 'quantity', 'condition_issue', 'cleanliness_issue', 'working_status'
]);

export const templateKey = (template: Pick<InspectionTypeTemplate, 'id' | 'version'>): string => `${template.id}@${template.version}`;

export function publishTemplate(template: InspectionTypeTemplate, publishedAt = new Date().toISOString()): InspectionTypeTemplate {
  if (template.status !== 'draft') throw new Error('Only draft templates can be published.');
  validateTemplate(template);
  return structuredClone({ ...template, status: 'published', publishedAt });
}

export function retireTemplate(template: InspectionTypeTemplate, retiredAt = new Date().toISOString()): InspectionTypeTemplate {
  if (template.status !== 'published') throw new Error('Only published templates can be retired.');
  return structuredClone({ ...template, status: 'retired', retiredAt });
}

export function assertTemplateEditable(template: InspectionTypeTemplate): void {
  if (template.status !== 'draft') throw new Error('Published and retired template versions are immutable.');
}

export function validateCommentaryText(text: string): void {
  if (!text || !text.trim()) throw new Error('Commentary text cannot be empty.');
  if (prohibitedLiabilityLanguage.test(text)) {
    throw new Error('Commentary contains unsupported liability or causation language.');
  }
  const matches = text.matchAll(/\{\{([^}]+)\}\}/g);
  for (const match of matches) {
    const placeholder = match[1]?.trim();
    if (placeholder && !ALLOWED_PLACEHOLDERS.has(placeholder)) {
      throw new Error(`Unknown template placeholder: {{${placeholder}}}`);
    }
  }
}

export function validateTemplate(template: InspectionTypeTemplate): void {
  if (!template.id.trim() || template.version < 1) throw new Error('Template identity and positive version are required.');
  if (!template.areas.length) throw new Error('Template must contain at least one area.');
  const areaIds = new Set<string>();
  for (const area of template.areas) {
    if (!area.id.trim() || !area.name.trim()) throw new Error('Area identity and name are required.');
    if (areaIds.has(area.id)) throw new Error(`Duplicate area id: ${area.id}`);
    areaIds.add(area.id);
    const componentIds = new Set<string>();
    for (const component of area.components) {
      if (!component.id.trim() || !component.name.trim()) throw new Error('Component identity and name are required.');
      if (componentIds.has(component.id)) throw new Error(`Duplicate component id in ${area.id}: ${component.id}`);
      componentIds.add(component.id);
    }
  }
  for (const entry of template.commentaryBank) {
    validateCommentaryText(entry.text);
  }
}

export function importCommentaryBank(rows: ImportRow[], existingBank: CommentaryEntry[] = []): ImportValidationResult {
  const issues: ImportValidationIssue[] = [];
  const entries: CommentaryEntry[] = [];
  const existingKeys = new Set<string>(
    existingBank.map((e) => `${normalizeName(e.area)}|${normalizeName(e.component)}|${e.condition}|${[...e.inspectionTypes].sort().join(',')}|${e.text.trim().toLowerCase()}`)
  );
  const batchKeys = new Set<string>();
  let duplicateCount = 0;

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const area = normalizeName(row.area);
    const component = normalizeName(row.component);
    const text = row.text ? row.text.trim() : '';

    if (!area || !component || !text) {
      issues.push({ row: rowNumber, code: 'MISSING_VALUE', message: 'Area, component and commentary text are required.' });
      return;
    }

    if (!conditions.has(row.condition)) {
      issues.push({ row: rowNumber, code: 'INVALID_CONDITION', message: `Unsupported condition: ${row.condition}` });
      return;
    }

    const parsedTypes = row.inspectionTypes.split(',').map((v) => v.trim()).filter(Boolean);
    if (!parsedTypes.length || parsedTypes.some((v) => !inspectionTypes.has(v as InspectionType))) {
      issues.push({ row: rowNumber, code: 'INVALID_INSPECTION_TYPE', message: 'Inspection types must use supported canonical values.' });
      return;
    }

    if (prohibitedLiabilityLanguage.test(text)) {
      issues.push({ row: rowNumber, code: 'PROHIBITED_LANGUAGE', message: 'Commentary text contains prohibited liability/causation language.' });
      return;
    }

    const placeholderMatches = text.matchAll(/\{\{([^}]+)\}\}/g);
    let invalidPlaceholder = false;
    for (const match of placeholderMatches) {
      const ph = match[1]?.trim();
      if (ph && !ALLOWED_PLACEHOLDERS.has(ph)) {
        issues.push({ row: rowNumber, code: 'INVALID_PLACEHOLDER', message: `Unknown placeholder: {{${ph}}}` });
        invalidPlaceholder = true;
        break;
      }
    }
    if (invalidPlaceholder) return;

    const key = `${area}|${component}|${row.condition}|${parsedTypes.sort().join(',')}|${text.toLowerCase()}`;
    if (existingKeys.has(key) || batchKeys.has(key)) {
      duplicateCount++;
      issues.push({ row: rowNumber, code: 'DUPLICATE', message: 'Duplicate commentary-bank entry.' });
      return;
    }
    batchKeys.add(key);

    entries.push({
      id: `commentary-${Date.now().toString(36)}-${String(index + 1).padStart(4, '0')}`,
      area,
      component,
      subComponent: row.subComponent ? row.subComponent.trim() : undefined,
      condition: row.condition as ConditionState,
      cleanliness: row.cleanliness ? row.cleanliness.trim() : undefined,
      workingStatus: row.workingStatus ? row.workingStatus.trim() : undefined,
      inspectionTypes: parsedTypes as InspectionType[],
      text,
      active: true,
      createdAt: new Date().toISOString(),
    });
  });

  return {
    entries,
    issues,
    totalRows: rows.length,
    validRows: entries.length,
    duplicateRows: duplicateCount,
  };
}

export function matchBankEntry(template: InspectionTypeTemplate, fact: StructuredInspectionFact): CommentaryEntry | undefined {
  const area = normalizeName(fact.area);
  const component = normalizeName(fact.component);
  const activeType = fact.inspectionType || template.inspectionType;

  const candidates = template.commentaryBank.filter((entry) => {
    if (entry.active === false) return false;
    if (normalizeName(entry.area) !== area) return false;
    if (normalizeName(entry.component) !== component) return false;
    if (entry.condition !== fact.condition && entry.condition !== 'any') return false;
    if (entry.inspectionTypes.length > 0 && !entry.inspectionTypes.includes(activeType)) return false;
    return true;
  });

  if (!candidates.length) return undefined;

  // Score candidate specificity
  let bestCandidate = candidates[0];
  let maxScore = -1;

  for (const candidate of candidates) {
    let score = 0;
    if (candidate.subComponent && fact.subComponent && candidate.subComponent.toLowerCase() === fact.subComponent.toLowerCase()) score += 10;
    if (candidate.cleanliness && fact.cleanliness && candidate.cleanliness.toLowerCase() === fact.cleanliness.toLowerCase()) score += 5;
    if (candidate.workingStatus && fact.workingState && candidate.workingStatus.toLowerCase() === fact.workingState.toLowerCase()) score += 5;
    if (candidate.material && fact.material && candidate.material.toLowerCase() === fact.material.toLowerCase()) score += 5;
    if (candidate.priority) score += candidate.priority;

    if (score > maxScore) {
      maxScore = score;
      bestCandidate = candidate;
    }
  }

  return bestCandidate;
}

export function generateCommentary(template: InspectionTypeTemplate, fact: StructuredInspectionFact): GeneratedCommentary {
  const component = normalizeName(fact.component);

  if (fact.visibility === 'not_applicable') {
    return result(fact, `${component} - Not applicable to this property.`, 'fallback_rule', template);
  }
  if (fact.visibility === 'not_visible') {
    return result(fact, `${component} - Not visible in photos, condition unable to be confirmed.`, 'fallback_rule', template);
  }
  if (fact.visibility === 'partially_visible') {
    return result(fact, `${component} - Partially visible in photos, appears intact where visible, full condition unable to be confirmed.`, 'fallback_rule', template);
  }

  const bank = matchBankEntry(template, fact);

  // Description construction
  const descriptionParts: string[] = [];
  if (fact.colour) descriptionParts.push(capitalizeFirst(fact.colour.trim()));
  if (fact.material) descriptionParts.push(fact.material.trim());

  let typeStr = fact.type ? fact.type.trim() : '';
  if (typeStr) {
    // Avoid repeating component name if typeStr already includes it
    if (typeStr.toLowerCase().startsWith(component.toLowerCase())) {
      typeStr = typeStr.slice(component.length).trim();
    }
    descriptionParts.push(typeStr);
  }
  if (!fact.type && !fact.material && !fact.colour) {
    descriptionParts.push(component.toLowerCase());
  }

  const descString = descriptionParts.join(' ').trim();
  const quantityPrefix = fact.quantity && fact.quantity > 1 ? `${fact.quantity}x ` : '';
  const fullDesc = `${quantityPrefix}${descString}`.trim();

  // Observations
  const obsParts: string[] = [];
  if (fact.conditionIssue && fact.conditionIssue.trim()) {
    let condIssue = fact.conditionIssue.trim();
    if (!condIssue.toLowerCase().includes('noted') && !condIssue.toLowerCase().includes('observed')) {
      condIssue = `${condIssue} noted`;
    }
    obsParts.push(condIssue);
  }
  if (fact.cleanlinessIssue && fact.cleanlinessIssue.trim()) {
    let cleanIssue = fact.cleanlinessIssue.trim();
    if (!cleanIssue.toLowerCase().includes('noted') && !cleanIssue.toLowerCase().includes('observed')) {
      cleanIssue = `${cleanIssue} noted`;
    }
    obsParts.push(cleanIssue);
  }

  const observations = obsParts.join(', ');
  const working = workingText(fact.workingState);
  const fallbackCondition = fact.condition === 'clean_intact' ? '' : humanize(fact.condition);

  const detailParts = [fullDesc || component, observations || fallbackCondition, working].filter(Boolean);
  const detail = detailParts.join(', ');

  let commentary = '';
  let generationMethod: GeneratedCommentary['generationMethod'] = 'fallback_rule';

  if (bank) {
    commentary = adaptBank(bank.text, fact, detail, component);
    generationMethod = 'bank_rule';
  } else {
    const otherwiseIntact = shouldUseOtherwiseIntact(fact) ? ', otherwise intact' : '';
    commentary = `${component} - ${detail}${otherwiseIntact}.`.replace(/\s+/g, ' ').replace(/,\s*\./g, '.');
  }

  // Ensure clean capitalization
  commentary = commentary.charAt(0).toUpperCase() + commentary.slice(1);

  validateGeneratedClaim(fact, commentary);

  return {
    ...result(fact, commentary, generationMethod, template),
    ...(bank ? { bankEntryId: bank.id } : {}),
  };
}

export function validateGeneratedClaim(fact: StructuredInspectionFact, commentary: string): void {
  if (prohibitedLiabilityLanguage.test(commentary)) {
    throw new Error('Commentary contains unsupported liability or causation language.');
  }
  if (/\b(operational|working condition|tested and working|operation confirmed)\b/i.test(commentary) && fact.workingState !== 'tested_working') {
    throw new Error('Working-status claims require recorded operational testing.');
  }
  if (fact.visibility === 'visible' && !fact.photoReferences.length) {
    throw new Error('Visible-condition claims require at least one photo reference.');
  }
  if (/otherwise intact/i.test(commentary) && (fact.condition === 'damaged' || fact.condition === 'repair_required' || fact.workingState === 'tested_not_working')) {
    throw new Error('Otherwise intact cannot be used for broken, unsafe or non-working items.');
  }
}

function result(
  fact: StructuredInspectionFact,
  commentary: string,
  method: GeneratedCommentary['generationMethod'],
  template?: InspectionTypeTemplate
): GeneratedCommentary {
  return {
    area: normalizeName(fact.area),
    component: normalizeName(fact.component),
    commentary,
    photoReferences: [...fact.photoReferences],
    generationMethod: method,
    ...(template ? { templateId: template.id, templateVersion: template.version } : {}),
  };
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function capitalizeFirst(value: string): string {
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function workingText(state: WorkingState): string | undefined {
  if (state === 'tested_working') return 'operation confirmed and in working condition and order';
  if (state === 'tested_not_working') return 'tested and not working';
  if (state === 'not_tested') return 'operation not confirmed';
  return undefined;
}

function humanize(value: string): string {
  return value.replaceAll('_', ' ');
}

function shouldUseOtherwiseIntact(fact: StructuredInspectionFact): boolean {
  return Boolean(
    (fact.conditionIssue || fact.cleanlinessIssue) &&
    fact.condition !== 'damaged' &&
    fact.condition !== 'repair_required' &&
    fact.workingState !== 'tested_not_working'
  );
}

function adaptBank(bankText: string, fact: StructuredInspectionFact, detail: string, component: string): string {
  let text = bankText;
  if (text.includes('{{details}}')) {
    text = text.replace(/\{\{details\}\}/g, detail);
  }
  text = text.replace(/\{\{component\}\}/g, component);
  text = text.replace(/\{\{area\}\}/g, fact.area);
  text = text.replace(/\{\{material\}\}/g, fact.material || '');
  text = text.replace(/\{\{colour\}\}/g, fact.colour || '');
  text = text.replace(/\{\{color\}\}/g, fact.colour || '');
  text = text.replace(/\{\{type\}\}/g, fact.type || '');
  text = text.replace(/\{\{quantity\}\}/g, fact.quantity ? `${fact.quantity}x` : '');
  text = text.replace(/\{\{condition_issue\}\}/g, fact.conditionIssue || '');
  text = text.replace(/\{\{cleanliness_issue\}\}/g, fact.cleanlinessIssue || '');
  text = text.replace(/\{\{working_status\}\}/g, workingText(fact.workingState) || '');

  // If entry didn't have placeholders but was custom text, prepend component if not present
  if (!text.toLowerCase().startsWith(component.toLowerCase())) {
    text = `${component} - ${text}`;
  }
  return text.trim();
}

export const PCR_STANDARD_AREAS = [
  'Exterior Front', 'Exterior Back', 'Garage / Carport', 'Entry', 'Lounge Room', 'Family Room', 'Dining Room',
  'Lounge / Dining Room', 'Kitchen', 'Passage / Hallway', 'Linen Press / Walk-in Linen Closet', 'Bedroom', 'Study',
  'Activity Room', 'Bathroom', 'Ensuite', 'Toilet / WC', 'Laundry', 'Security / Safety', 'General External Items',
  'Garden Shed / External Storage',
] as const;

