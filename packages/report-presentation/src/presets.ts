import { defaultPresentationTemplate, type ReportPresentationTemplate } from './index.js';

function clone(now: string): ReportPresentationTemplate {
  return structuredClone(defaultPresentationTemplate(now));
}

export function presentationTemplateForReportType(reportType: string, now = new Date().toISOString()): ReportPresentationTemplate {
  const template = clone(now);
  const value = reportType.toLowerCase();
  if (value.includes('routine')) {
    return {
      ...template,
      id: 'system-routine-report',
      name: 'Routine Inspection Report',
      cover: { ...template.cover, style: 'minimal' },
      sections: template.sections.map((section) => section.type === 'area_findings'
        ? { ...section, style: 'exception_first', showOrdinaryItems: false, maxPhotosPerComponent: 3 }
        : section),
    };
  }
  if (value.includes('exit')) {
    return {
      ...template,
      id: 'system-exit-report',
      name: 'Exit Inspection Report',
      sections: template.sections.map((section) => {
        if (section.type === 'comparison_summary') return { ...section, visible: true, pageBreakBefore: true, style: 'comparison' };
        if (section.type === 'area_findings') return { ...section, style: 'comparison', showOrdinaryItems: true, maxPhotosPerComponent: 4 };
        return section;
      }),
    };
  }
  if (value.includes('comparison')) {
    return {
      ...template,
      id: 'system-comparison-report',
      name: 'Inspection Comparison Report',
      sections: template.sections.map((section) => section.type === 'comparison_summary'
        ? { ...section, visible: true, pageBreakBefore: true, style: 'comparison' }
        : section),
    };
  }
  if (value.includes('maintenance') || value.includes('follow')) {
    return {
      ...template,
      id: 'system-maintenance-follow-up-report',
      name: 'Maintenance / Follow-Up Report',
      sections: template.sections.map((section) => {
        if (section.type === 'maintenance_summary') return { ...section, visible: true, pageBreakBefore: true, style: 'exception_first' };
        if (section.type === 'area_findings') return { ...section, style: 'exception_first', showOrdinaryItems: false };
        return section;
      }),
    };
  }
  return { ...template, id: 'system-entry-report', name: 'Property Condition Report' };
}
