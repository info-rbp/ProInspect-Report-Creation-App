import {
  type InspectionTypeTemplate,
  type ImportRow,
  type ImportValidationResult,
  importCommentaryBank,
  assertTemplateEditable,
  validateTemplate,
  createInitialPcrTemplate,
  systemInspectionTemplateContract,
} from '@pcr/templates';
import {
  areaComponentRulesForArea,
  findAreaDefinition,
  resolveComponentDefinitionId,
} from '@pcr/templates/canonicalCatalogue';
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

function defaultPropertyUses(template: InspectionTypeTemplate) {
  const contract = systemInspectionTemplateContract(template.inspectionType);
  const propertyType = template.propertyType.trim().toLowerCase();
  if (propertyType === 'residential') return ['residential'] as const;
  if (propertyType === 'strata' || propertyType === 'common_property') return ['strata_common_property'] as const;
  if (propertyType === 'commercial') return ['commercial', 'retail', 'industrial', 'mixed_use'] as const;
  return contract.propertyUses;
}

function migrateLegacyAreaReferences(template: InspectionTypeTemplate) {
  return template.areas.map((legacyArea, index) => {
    const areaDefinition = findAreaDefinition(legacyArea.id);
    if (!areaDefinition) {
      throw new Error(`Legacy Template Area "${legacyArea.name}" (${legacyArea.id}) has no deterministic canonical mapping. Review this Area manually before publishing a new Template Version.`);
    }
    const availableRules = areaComponentRulesForArea(legacyArea.id);
    const ruleReferences = legacyArea.components.map((legacyComponent) => {
      const componentDefinitionId = resolveComponentDefinitionId(legacyComponent.id);
      if (!componentDefinitionId) {
        throw new Error(`Legacy Template Component "${legacyComponent.name}" (${legacyComponent.id}) has no deterministic canonical mapping.`);
      }
      const exact = availableRules.find((rule) =>
        rule.legacyComponentId === legacyComponent.id && rule.componentDefinitionId === componentDefinitionId,
      ) || availableRules.find((rule) => rule.componentDefinitionId === componentDefinitionId);
      if (!exact) {
        throw new Error(`Legacy Template Component "${legacyComponent.name}" cannot be reconciled with an Area-Component rule for ${areaDefinition.name}.`);
      }
      return { id: exact.id, version: exact.version };
    });
    return {
      id: `template-area-${index + 1}-${areaDefinition.id}`,
      canonicalAreaDefinitionId: areaDefinition.id,
      canonicalAreaDefinitionVersion: areaDefinition.version,
      inclusion: 'default' as const,
      canonicalAreaComponentRuleReferences: ruleReferences,
    };
  });
}

/**
 * Converts a legacy editable Template into a canonical draft without guessing.
 * Known historic PCR IDs are mapped through the retained migration map. Unknown custom IDs stop the
 * migration and require human review. This keeps historical published versions untouched while making
 * the next draft version safe for Property Layout + Catalogue report resolution.
 */
function canonicalDraft(template: InspectionTypeTemplate): InspectionTypeTemplate {
  if (template.structureMode === 'property_layout_catalogue') return template;
  const contract = systemInspectionTemplateContract(template.inspectionType);
  const canonicalAreaReferences = template.areas.length ? migrateLegacyAreaReferences(template) : [];
  return {
    ...template,
    areas: [],
    structureMode: 'property_layout_catalogue',
    includeUnreferencedPropertyAreas: template.areas.length === 0,
    canonicalAreaReferences,
    propertyUses: [...defaultPropertyUses(template)],
    physicalPropertyTypes: [...contract.physicalPropertyTypes],
  };
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
  return published || draft || templates[0] || canonicalDraft(createInitialPcrTemplate());
}

export async function saveTemplate(template: InspectionTypeTemplate): Promise<void> {
  const canonical = canonicalDraft(template);
  validateTemplate(canonical);
  if (canonical.status !== 'draft') throw new Error('Published and retired template versions are immutable. Duplicate to a new draft before editing.');

  const knownVersion = recordVersions.get(key(canonical.id, canonical.version)) || (template as Partial<ServerTemplate>).recordVersion;
  if (knownVersion) {
    const updated = await apiRequest<ServerTemplate>(undefined, versionPath(canonical.id, canonical.version), {
      method: 'PUT',
      body: { expectedRecordVersion: knownVersion, template: canonical },
    });
    remember(updated);
    return;
  }

  const created = await apiRequest<ServerTemplate>(undefined, '/api/v1/templates/drafts', {
    method: 'POST',
    body: { template: canonical },
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
  const draft = remember(await apiRequest<ServerTemplate>(undefined, `${versionPath(id, version)}/actions/duplicate`, {
    method: 'POST',
    body: { expectedRecordVersion: sourceRecordVersion },
  }));
  if (draft.structureMode === 'property_layout_catalogue') return draft;
  const migrated = canonicalDraft(draft);
  await saveTemplate(migrated);
  return migrated;
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
