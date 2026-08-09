import {
  type InspectionTypeTemplate,
  type ImportRow,
  type ImportValidationResult,
  publishTemplate as publishTemplateCore,
  retireTemplate as retireTemplateCore,
  importCommentaryBank,
  assertTemplateEditable,
  validateTemplate,
  createInitialPcrTemplate,
  createRoutineInspectionTemplate,
  createExitInspectionTemplate,
} from '@pcr/templates';

const TEMPLATES_STORAGE_KEY = 'proinspect_templates_v2';

export function loadTemplatesFromStorage(): InspectionTypeTemplate[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(TEMPLATES_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed as InspectionTypeTemplate[];
      }
    }
  } catch (err) {
    console.warn('Failed to parse stored templates, initializing defaults:', err);
  }

  // Initial default presets
  const defaults = [
    publishTemplateCore(createInitialPcrTemplate()),
    publishTemplateCore(createRoutineInspectionTemplate()),
    publishTemplateCore(createExitInspectionTemplate()),
  ];
  saveTemplatesToStorage(defaults);
  return defaults;
}

export function saveTemplatesToStorage(templates: InspectionTypeTemplate[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(templates));
  } catch (err) {
    console.error('Failed to save templates to storage:', err);
  }
}

export async function getTemplates(): Promise<InspectionTypeTemplate[]> {
  return loadTemplatesFromStorage();
}

export async function getActiveTemplateForType(
  type: string = 'entry'
): Promise<InspectionTypeTemplate> {
  const templates = loadTemplatesFromStorage();
  const matched = templates.find(
    (t) => t.inspectionType === type && (t.status === 'published' || t.status === 'draft')
  );
  if (matched) return matched;
  return templates[0] || createInitialPcrTemplate();
}

export async function saveTemplate(template: InspectionTypeTemplate): Promise<void> {
  validateTemplate(template);
  const templates = loadTemplatesFromStorage();
  const index = templates.findIndex((t) => t.id === template.id && t.version === template.version);
  if (index >= 0) {
    templates[index] = template;
  } else {
    templates.push(template);
  }
  saveTemplatesToStorage(templates);
}

export async function publishTemplateVersion(
  id: string,
  version: number
): Promise<InspectionTypeTemplate> {
  const templates = loadTemplatesFromStorage();
  const index = templates.findIndex((t) => t.id === id && t.version === version);
  if (index === -1) throw new Error('Template version not found.');

  const published = publishTemplateCore(templates[index]);
  templates[index] = published;
  saveTemplatesToStorage(templates);
  return published;
}

export async function duplicateTemplateToNewDraft(
  id: string,
  version: number
): Promise<InspectionTypeTemplate> {
  const templates = loadTemplatesFromStorage();
  const source = templates.find((t) => t.id === id && t.version === version);
  if (!source) throw new Error('Source template not found.');

  const existingVersions = templates
    .filter((t) => t.id === id)
    .map((t) => t.version);
  const maxVersion = Math.max(...existingVersions, 0);

  const newDraft: InspectionTypeTemplate = {
    ...structuredClone(source),
    version: maxVersion + 1,
    status: 'draft',
    createdAt: new Date().toISOString(),
    publishedAt: undefined,
    retiredAt: undefined,
  };

  templates.push(newDraft);
  saveTemplatesToStorage(templates);
  return newDraft;
}

export async function retireTemplateVersion(
  id: string,
  version: number
): Promise<InspectionTypeTemplate> {
  const templates = loadTemplatesFromStorage();
  const index = templates.findIndex((t) => t.id === id && t.version === version);
  if (index === -1) throw new Error('Template version not found.');

  const retired = retireTemplateCore(templates[index]);
  templates[index] = retired;
  saveTemplatesToStorage(templates);
  return retired;
}

export async function importBankToTemplate(
  id: string,
  version: number,
  rows: ImportRow[]
): Promise<ImportValidationResult> {
  const templates = loadTemplatesFromStorage();
  const index = templates.findIndex((t) => t.id === id && t.version === version);
  if (index === -1) throw new Error('Template version not found.');

  const template = templates[index];
  assertTemplateEditable(template);

  const result = importCommentaryBank(rows, template.commentaryBank);
  if (result.entries.length > 0) {
    template.commentaryBank = [...template.commentaryBank, ...result.entries];
    templates[index] = template;
    saveTemplatesToStorage(templates);
  }
  return result;
}
