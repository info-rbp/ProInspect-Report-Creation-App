import { describe, expect, it } from 'vitest';
import type { InspectionTypeTemplate } from '../src/index.js';
import { InMemoryTemplateRepository, TemplateRegistry } from '../src/registry.js';

const draft = (): InspectionTypeTemplate => ({
  id: 'wa-entry',
  version: 1,
  inspectionType: 'entry',
  propertyType: 'residential',
  status: 'draft',
  createdAt: '2026-07-20T00:00:00.000Z',
  commentaryBank: [],
  areas: [
    {
      id: 'entry',
      name: 'Entry',
      components: [{ id: 'front-door', name: 'Front Door', required: true, photoRequired: true }],
    },
  ],
});

describe('TemplateRegistry', () => {
  it('publishes a draft and binds a report to the immutable published version', async () => {
    const registry = new TemplateRegistry(new InMemoryTemplateRepository());
    await registry.createDraft(draft());
    await registry.publish('wa-entry', 1, '2026-07-20T01:00:00.000Z');
    const assignment = await registry.assignReport('report-1', 'wa-entry', 1, '2026-07-20T02:00:00.000Z');
    expect(assignment).toEqual({
      reportId: 'report-1',
      templateId: 'wa-entry',
      templateVersion: 1,
      assignedAt: '2026-07-20T02:00:00.000Z',
    });
    expect((await registry.resolveReportTemplate('report-1')).status).toBe('published');
  });

  it('prevents editing a published version in place', async () => {
    const repository = new InMemoryTemplateRepository();
    const registry = new TemplateRegistry(repository);
    await registry.createDraft(draft());
    const published = await registry.publish('wa-entry', 1);
    await expect(registry.updateDraft({ ...published, status: 'draft' })).rejects.toThrow('immutable');
  });

  it('creates a new draft version from the latest published version', async () => {
    const registry = new TemplateRegistry(new InMemoryTemplateRepository());
    await registry.createDraft(draft());
    await registry.publish('wa-entry', 1);
    const next = await registry.createNextDraft('wa-entry', '2026-07-21T00:00:00.000Z');
    expect(next).toMatchObject({ id: 'wa-entry', version: 2, status: 'draft' });
    expect(next.publishedAt).toBeUndefined();
  });

  it('refuses to rebind an existing report to a different version', async () => {
    const registry = new TemplateRegistry(new InMemoryTemplateRepository());
    await registry.createDraft(draft());
    await registry.publish('wa-entry', 1);
    await registry.assignReport('report-1', 'wa-entry', 1);
    await expect(registry.assignReport('report-1', 'wa-entry', 2)).rejects.toThrow('retain their original template version');
  });
});
