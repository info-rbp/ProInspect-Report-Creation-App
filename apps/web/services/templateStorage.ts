import {
  type InspectionTypeTemplate,
  type ImportRow,
  type ImportValidationResult,
  importCommentaryBank,
  assertTemplateEditable,
  validateTemplate,
  createInitialPcrTemplate,
} from '@pcr/templates';
import { apiRequest } from './apiClient';

type ServerTemplate = InspectionTypeTemplate & {
  recordVersion: number;
  systemDefault?: boolean;
};

const recordVersions = new Map<string, number>();

function key(id: string, version: number): string {
  return `${id}@${version}`;
}

function remember(template: ServerTemplate): ServerTemplate {
  recordVersions.set(key(template.id, template.version), template.recordVersion);
  return template;
}

async function versionFor(id: string, version: number): Promise<number> {
  const cached = recordVersions.get(key(id, version));
  if (cached) return cached;
  const templates = await getTemplates();
  const found = templates.find((template) => template.id === id && template.version === version) as ServerTemplate | undefined;
  if (!found?.recordVersion) throw new Error('Template version not found or missing its server record version.');
  return found.recordVersion;
}

function versionPath(id: string, version: number): string {
  return `/api/v1/templates/${encodeURIComponent(id)}/versions/${version}`;
}

export async function getTemplates(): Promise<InspectionTypeTemplate[]> {
  const templates = await apiRequest<ServerTemplate[]>(undefined, '/api/v1/templates');
  return templates.map(remember);
}

export async function getActiveTemplateForType(type: string = 'entry'): Promise<InspectionTypeTemplate> {
  const templates = await getTemplates();
  const matches = templates
    .filter((template) => template.inspectionType === type)
    .sort((left, right) => right.version - left.version);
  const published = matches.find((template) => template.status === 'published');
  const draft = matches.find((template) => template.status === 'draft');
  return published || draft || templates[0] || createInitialPcrTemplate();
}

export async function saveTemplate(template: InspectionTypeTemplate): Promise<void> {
  validateTemplate(template);
  if (template.status !== 'draft') throw new Error('Published and retired template versions are immutable. Duplicate to a new draft before editing.');

  const knownVersion = recordVersions.get(key(template.id, template.version)) || (template as Partial<ServerTemplate>).recordVersion;
  if (knownVersion) {
    const updated = await apiRequest<ServerTemplate>(undefined, versionPath(template.id, template.version), {
      method: 'PUT',
      body: { expectedRecordVersion: knownVersion, template },
    });
    remember(updated);
    return;
  }

  const created = await apiRequest<ServerTemplate>(undefined, '/api/v1/templates/drafts', {
    method: 'POST',
    body: { template },
  });
  remember(created);
}

export async function publishTemplateVersion(id: string, version: number): Promise<InspectionTypeTemplate> {
  const recordVersion = await versionFor(id, version);
  const published = await apiRequest<ServerTemplate>(undefined, `${versionPath(id, version)}/actions/publish`, {
    method: 'POST',
    body: { expectedRecordVersion: recordVersion },
  });
  return remember(published);
}

export async function duplicateTemplateToNewDraft(id: string, version: number): Promise<InspectionTypeTemplate> {
  const sourceRecordVersion = await versionFor(id, version);
  const draft = await apiRequest<ServerTemplate>(undefined, `${versionPath(id, version)}/actions/duplicate`, {
    method: 'POST',
    body: { expectedRecordVersion: sourceRecordVersion },
  });
  return remember(draft);
}

export async function retireTemplateVersion(id: string, version: number): Promise<InspectionTypeTemplate> {
  const recordVersion = await versionFor(id, version);
  const retired = await apiRequest<ServerTemplate>(undefined, `${versionPath(id, version)}/actions/retire`, {
    method: 'POST',
    body: { expectedRecordVersion: recordVersion },
  });
  return remember(retired);
}

export async function importBankToTemplate(
  id: string,
  version: number,
  rows: ImportRow[],
): Promise<ImportValidationResult> {
  const templates = await getTemplates();
  const template = templates.find((candidate) => candidate.id === id && candidate.version === version);
  if (!template) throw new Error('Template version not found.');
  assertTemplateEditable(template);

  const result = importCommentaryBank(rows, template.commentaryBank);
  if (result.entries.length > 0) {
    await saveTemplate({ ...template, commentaryBank: [...template.commentaryBank, ...result.entries] });
  }
  return result;
}
