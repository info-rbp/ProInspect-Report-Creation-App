import type { ReportPresentationTemplate, ReportBrandingSnapshot } from './index.js';
import type { ReportPresentationViewModel, PresentationComponentView } from './viewModel.js';

export type ReportDocumentBlock =
  | { type: 'cover'; title: string; propertyAddress: string; agencyName: string; inspectionDate?: string; inspectorName?: string; clientName?: string }
  | { type: 'summary'; heading: string; metrics: Array<{ label: string; value: number }> }
  | { type: 'finding-list'; heading: string; items: Array<{ areaName: string; component: PresentationComponentView }> }
  | { type: 'area'; heading: string; commentary: string; components: PresentationComponentView[] }
  | { type: 'text'; heading: string; body: string }
  | { type: 'approval'; reportVersionId?: string; inspectorName?: string }
  | { type: 'photo-index'; heading: string; photos: Array<{ photoId: string; caption?: string; areaName: string; componentLabel?: string }> };

export interface ReportDocumentModel {
  title: string;
  reportId: string;
  reportVersionId?: string;
  branding: ReportBrandingSnapshot;
  templateId: string;
  templateVersion: number;
  blocks: ReportDocumentBlock[];
}

function sectionEnabled(template: ReportPresentationTemplate, type: string): boolean {
  return template.sections.some((section) => section.type === type && section.visible);
}

export function buildReportDocumentModel(input: {
  view: ReportPresentationViewModel;
  template: ReportPresentationTemplate;
  branding: ReportBrandingSnapshot;
}): ReportDocumentModel {
  const { view, template, branding } = input;
  const blocks: ReportDocumentBlock[] = [];

  if (sectionEnabled(template, 'cover')) {
    blocks.push({
      type: 'cover',
      title: view.title,
      propertyAddress: view.propertyAddress,
      agencyName: branding.tradingName || branding.agencyName,
      ...(view.inspectionDate ? { inspectionDate: view.inspectionDate } : {}),
      ...(view.inspectorName ? { inspectorName: view.inspectorName } : {}),
      ...(view.clientName ? { clientName: view.clientName } : {}),
    });
  }

  if (sectionEnabled(template, 'executive_summary')) {
    blocks.push({
      type: 'summary',
      heading: 'Executive Summary',
      metrics: [
        { label: 'Areas inspected', value: view.summary.areaCount },
        { label: 'Components assessed', value: view.summary.componentCount },
        { label: 'Exceptions', value: view.summary.exceptionCount },
        { label: 'Maintenance items', value: view.summary.maintenanceCount },
        { label: 'Condition exceptions', value: view.summary.conditionExceptionCount },
        { label: 'Cleaning exceptions', value: view.summary.cleaningExceptionCount },
        { label: 'Operational exceptions', value: view.summary.operationalExceptionCount },
        { label: 'Unable to confirm', value: view.summary.unableToConfirmCount },
      ],
    });
  }

  if (sectionEnabled(template, 'key_findings')) {
    const items = view.areas.flatMap((area) => area.exceptions.map((component) => ({ areaName: area.name, component })));
    blocks.push({ type: 'finding-list', heading: 'Key Findings', items });
  }

  if (sectionEnabled(template, 'maintenance_summary') && view.maintenanceFindings.length) {
    blocks.push({ type: 'finding-list', heading: 'Maintenance Summary', items: view.maintenanceFindings.map(({ areaName, component }) => ({ areaName, component })) });
  }

  if (sectionEnabled(template, 'comparison_summary') && view.comparisonFindings.length) {
    blocks.push({ type: 'finding-list', heading: view.isExit ? 'Entry to Exit Comparison' : 'Comparison Summary', items: view.comparisonFindings.map(({ areaName, component }) => ({ areaName, component })) });
  }

  if (sectionEnabled(template, 'area_findings')) {
    const section = template.sections.find((candidate) => candidate.type === 'area_findings');
    for (const area of view.areas) {
      const components = view.isRoutine && section?.showOrdinaryItems !== true ? area.exceptions : area.components;
      blocks.push({ type: 'area', heading: area.name, commentary: area.commentary, components });
    }
  }

  if (sectionEnabled(template, 'approval_record')) {
    blocks.push({
      type: 'approval',
      ...(view.identity.reportVersionId ? { reportVersionId: view.identity.reportVersionId } : {}),
      ...(view.inspectorName ? { inspectorName: view.inspectorName } : {}),
    });
  }

  if (sectionEnabled(template, 'disclaimer')) {
    blocks.push({
      type: 'text',
      heading: 'Report Scope',
      body: 'This report records observed property condition and approved inspection evidence. It does not determine legal liability, bond deductions, causation, or specialist compliance matters.',
    });
  }

  if (sectionEnabled(template, 'photo_appendix')) {
    const photos = view.areas.flatMap((area) => [
      ...area.photos.map((photo) => ({ photoId: photo.photoId, ...(photo.caption ? { caption: photo.caption } : {}), areaName: area.name })),
      ...area.components.flatMap((component) => component.photos.map((photo) => ({
        photoId: photo.photoId,
        ...(photo.caption ? { caption: photo.caption } : {}),
        areaName: area.name,
        componentLabel: component.label,
      }))),
    ]);
    if (photos.length) blocks.push({ type: 'photo-index', heading: `Photo Evidence (${photos.length})`, photos });
  }

  return {
    title: view.title,
    reportId: view.identity.reportId,
    ...(view.identity.reportVersionId ? { reportVersionId: view.identity.reportVersionId } : {}),
    branding,
    templateId: template.id,
    templateVersion: template.version,
    blocks,
  };
}
