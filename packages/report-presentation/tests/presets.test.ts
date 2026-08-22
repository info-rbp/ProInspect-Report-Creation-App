import { describe, expect, it } from 'vitest';
import { presentationTemplateForReportType } from '../src/presets.js';

describe('professional report presentation presets', () => {
  it('uses exception-first Area presentation for Routine inspections', () => {
    const template = presentationTemplateForReportType('Routine Inspection', '2026-08-22T00:00:00.000Z');
    const areas = template.sections.find((section) => section.type === 'area_findings');
    expect(template.id).toBe('system-routine-report');
    expect(areas?.style).toBe('exception_first');
    expect(areas?.showOrdinaryItems).toBe(false);
  });

  it('promotes comparison presentation for Exit inspections', () => {
    const template = presentationTemplateForReportType('Exit Inspection', '2026-08-22T00:00:00.000Z');
    const comparison = template.sections.find((section) => section.type === 'comparison_summary');
    expect(template.id).toBe('system-exit-report');
    expect(comparison?.visible).toBe(true);
    expect(comparison?.style).toBe('comparison');
    expect(comparison?.pageBreakBefore).toBe(true);
  });

  it('promotes maintenance summaries for follow-up reports', () => {
    const template = presentationTemplateForReportType('Maintenance Follow-Up', '2026-08-22T00:00:00.000Z');
    const maintenance = template.sections.find((section) => section.type === 'maintenance_summary');
    expect(template.id).toBe('system-maintenance-follow-up-report');
    expect(maintenance?.visible).toBe(true);
    expect(maintenance?.style).toBe('exception_first');
  });
});
