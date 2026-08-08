import type { InspectionTypeTemplate } from './index.js';
import { assertTemplateEditable, publishTemplate, retireTemplate, templateKey, validateTemplate } from './index.js';

export interface ReportTemplateAssignment {
  reportId: string;
  templateId: string;
  templateVersion: number;
  assignedAt: string;
}

export interface TemplateRepository {
  get(id: string, version: number): Promise<InspectionTypeTemplate | undefined>;
  save(template: InspectionTypeTemplate): Promise<void>;
  list(id?: string): Promise<InspectionTypeTemplate[]>;
  findAssignment(reportId: string): Promise<ReportTemplateAssignment | undefined>;
  saveAssignment(assignment: ReportTemplateAssignment): Promise<void>;
}

export class InMemoryTemplateRepository implements TemplateRepository {
  private readonly templates = new Map<string, InspectionTypeTemplate>();
  private readonly assignments = new Map<string, ReportTemplateAssignment>();

  async get(id: string, version: number): Promise<InspectionTypeTemplate | undefined> {
    const value = this.templates.get(`${id}@${version}`);
    return value ? structuredClone(value) : undefined;
  }

  async save(template: InspectionTypeTemplate): Promise<void> {
    this.templates.set(templateKey(template), structuredClone(template));
  }

  async list(id?: string): Promise<InspectionTypeTemplate[]> {
    return [...this.templates.values()]
      .filter((template) => !id || template.id === id)
      .sort((left, right) => left.id.localeCompare(right.id) || left.version - right.version)
      .map((template) => structuredClone(template));
  }

  async findAssignment(reportId: string): Promise<ReportTemplateAssignment | undefined> {
    const value = this.assignments.get(reportId);
    return value ? structuredClone(value) : undefined;
  }

  async saveAssignment(assignment: ReportTemplateAssignment): Promise<void> {
    this.assignments.set(assignment.reportId, structuredClone(assignment));
  }
}

export class TemplateRegistry {
  constructor(private readonly repository: TemplateRepository) {}

  async createDraft(template: InspectionTypeTemplate): Promise<InspectionTypeTemplate> {
    if (template.status !== 'draft') throw new Error('New template versions must start as draft.');
    validateTemplate(template);
    if (await this.repository.get(template.id, template.version)) throw new Error('Template version already exists.');
    await this.repository.save(template);
    return structuredClone(template);
  }

  async updateDraft(template: InspectionTypeTemplate): Promise<InspectionTypeTemplate> {
    const existing = await this.required(template.id, template.version);
    assertTemplateEditable(existing);
    if (template.status !== 'draft') throw new Error('Draft updates cannot change lifecycle status.');
    validateTemplate(template);
    await this.repository.save(template);
    return structuredClone(template);
  }

  async publish(id: string, version: number, at = new Date().toISOString()): Promise<InspectionTypeTemplate> {
    const published = publishTemplate(await this.required(id, version), at);
    await this.repository.save(published);
    return published;
  }

  async retire(id: string, version: number, at = new Date().toISOString()): Promise<InspectionTypeTemplate> {
    const retired = retireTemplate(await this.required(id, version), at);
    await this.repository.save(retired);
    return retired;
  }

  async createNextDraft(id: string, createdAt = new Date().toISOString()): Promise<InspectionTypeTemplate> {
    const versions = await this.repository.list(id);
    const source = versions.filter((template) => template.status === 'published').at(-1);
    if (!source) throw new Error('A published source version is required.');
    const draft: InspectionTypeTemplate = {
      ...structuredClone(source),
      version: Math.max(...versions.map((template) => template.version)) + 1,
      status: 'draft',
      createdAt,
    };
    delete draft.publishedAt;
    delete draft.retiredAt;
    await this.repository.save(draft);
    return draft;
  }

  async assignReport(reportId: string, templateId: string, templateVersion: number, assignedAt = new Date().toISOString()): Promise<ReportTemplateAssignment> {
    const existing = await this.repository.findAssignment(reportId);
    if (existing) {
      if (existing.templateId !== templateId || existing.templateVersion !== templateVersion) {
        throw new Error('Reports retain their original template version assignment.');
      }
      return existing;
    }
    const template = await this.required(templateId, templateVersion);
    if (template.status !== 'published') throw new Error('Reports can only be assigned to published template versions.');
    const assignment = { reportId, templateId, templateVersion, assignedAt };
    await this.repository.saveAssignment(assignment);
    return structuredClone(assignment);
  }

  async resolveReportTemplate(reportId: string): Promise<InspectionTypeTemplate> {
    const assignment = await this.repository.findAssignment(reportId);
    if (!assignment) throw new Error('Report has no template assignment.');
    return this.required(assignment.templateId, assignment.templateVersion);
  }

  private async required(id: string, version: number): Promise<InspectionTypeTemplate> {
    const template = await this.repository.get(id, version);
    if (!template) throw new Error(`Template version not found: ${id}@${version}`);
    return template;
  }
}
