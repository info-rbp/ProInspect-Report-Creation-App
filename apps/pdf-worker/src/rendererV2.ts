import { PDFDocument, PageSizes, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import { type ReportBrandingSnapshot } from '@pcr/report-presentation';
import { buildReportPresentationViewModel } from '@pcr/report-presentation/view-model';
import { buildReportDocumentModel, type ReportDocumentBlock } from '@pcr/report-presentation/document-model';
import { presentationTemplateForReportType } from '@pcr/report-presentation/presets';
import type { RenderInput, RenderAsset } from './renderer.js';

export type { RenderInput, RenderAsset } from './renderer.js';

const PAGE_WIDTH = PageSizes.A4[0];
const PAGE_HEIGHT = PageSizes.A4[1];
const MARGIN = 42;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

function safe(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

export function pdfSafeText(value: string): string {
  return value.replace(/[\u2018\u2019]/gu, "'").replace(/[\u201C\u201D]/gu, '"').replace(/[\u2013\u2014]/gu, '-').replace(/\u2026/gu, '...').replace(/\u00a0/gu, ' ');
}

export function wrapText(font: PDFFont, source: string, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of pdfSafeText(source).split(/\r?\n/gu)) {
    const words = paragraph.split(/\s+/gu).filter(Boolean);
    if (!words.length) { lines.push(''); continue; }
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) { lines.push(line); line = word; }
      else line = candidate;
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [''];
}

interface State { page: PDFPage; y: number; pageNumber: number }

export async function renderReportPdf(input: RenderInput, imageBytes: ReadonlyMap<string, Uint8Array> = new Map()): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
  const assets = new Map(input.assets.map((asset) => [asset.photoId, asset] as const));

  const areas = input.areas.map((area) => ({
    id: safe(area.id, 'area'),
    name: safe(area.name, safe(area.id, 'Area')),
    overallCommentary: safe(area.overallCommentary),
    photoReferences: Array.isArray(area.photoReferences) ? area.photoReferences as Array<{ photoId: string; caption?: string; sequence?: number }> : [],
    components: (Array.isArray(area.components) ? area.components : []).map((componentValue) => {
      const component = componentValue as Record<string, unknown>;
      return {
        id: safe(component.id, 'component'),
        component: safe(component.component, safe(component.name, 'Component')),
        conditionCategory: safe(component.conditionCategory),
        cleanlinessCategory: safe(component.cleanlinessCategory),
        workingStatus: safe(component.workingStatus),
        testStatus: safe(component.testStatus),
        commentary: safe(component.commentary),
        defects: Array.isArray(component.defects) ? component.defects.filter((value): value is string => typeof value === 'string') : [],
        maintenanceRequired: component.maintenanceRequired === true,
        comparisonStatus: safe(component.comparisonStatus),
        comparisonCommentary: safe(component.comparisonCommentary),
        photoReferences: Array.isArray(component.photoReferences) ? component.photoReferences as Array<{ photoId: string; caption?: string; sequence?: number }> : [],
      };
    }),
  }));

  const view = buildReportPresentationViewModel({
    reportId: input.reportId,
    reportVersionId: input.reportVersionId,
    reportType: safe(input.report.reportType, 'Property Condition Report'),
    propertyAddress: safe(input.report.propertyAddress, 'Property address not recorded'),
    inspectionDate: safe(input.report.inspectionDate),
    clientName: safe(input.report.clientName),
    tenantName: safe(input.report.tenantName),
    inspectorName: safe(input.report.agentName, input.approvedBy),
    agencyName: safe(input.report.agentCompany, 'ProInspect'),
    areas,
  });
  const branding: ReportBrandingSnapshot = {
    profileId: safe((input as RenderInput & { brandingProfileId?: string }).brandingProfileId, 'system-branding'),
    profileVersion: 1,
    agencyName: safe(input.report.agentCompany, 'ProInspect'),
    address: safe(input.report.agentAddress),
    phone: safe(input.report.agentPhone),
    email: safe(input.report.agentEmail),
    primaryColour: '#1D4ED8', secondaryColour: '#0F172A', accentColour: '#0284C7', headingFont: 'Inter', bodyFont: 'Inter', capturedAt: input.approvedAt,
  };
  const model = buildReportDocumentModel({ view, template: presentationTemplateForReportType(view.identity.reportType, input.approvedAt), branding });

  doc.setTitle(model.title);
  doc.setAuthor(branding.agencyName);
  doc.setSubject(`Property inspection report ${input.reportId}`);
  doc.setCreator('ProInspect Property Reporting App');
  doc.setProducer('ProInspect PDF Worker shared document renderer');

  let pageNumber = 0;
  const newPage = (): State => {
    const page = doc.addPage(PageSizes.A4);
    pageNumber += 1;
    page.drawLine({ start: { x: MARGIN, y: 28 }, end: { x: PAGE_WIDTH - MARGIN, y: 28 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
    page.drawText(`Report ${input.reportId} | Page ${pageNumber}`, { x: MARGIN, y: 15, size: 7, font: regular, color: rgb(0.4, 0.4, 0.4) });
    return { page, y: PAGE_HEIGHT - MARGIN, pageNumber };
  };
  let state = newPage();
  const ensure = (height: number) => { if (state.y - height < 42) state = newPage(); };
  const text = (value: string, options: { size?: number; leading?: number; font?: PDFFont; indent?: number; colour?: ReturnType<typeof rgb> } = {}) => {
    const size = options.size ?? 9; const leading = options.leading ?? size + 3; const font = options.font ?? regular; const indent = options.indent ?? 0;
    for (const line of wrapText(font, value, size, CONTENT_WIDTH - indent)) {
      ensure(leading + 2);
      state.page.drawText(line, { x: MARGIN + indent, y: state.y, size, font, color: options.colour ?? rgb(0.08, 0.08, 0.08) });
      state.y -= leading;
    }
  };
  const heading = (value: string, major = false) => { ensure(36); text(value, { font: bold, size: major ? 20 : 14, leading: major ? 27 : 20 }); state.y -= 6; };
  const rule = () => { state.page.drawLine({ start: { x: MARGIN, y: state.y }, end: { x: PAGE_WIDTH - MARGIN, y: state.y }, thickness: 0.7, color: rgb(0.75, 0.75, 0.75) }); state.y -= 10; };

  const drawImage = async (photoId: string, height = 150) => {
    const asset: RenderAsset | undefined = assets.get(photoId);
    const bytes = imageBytes.get(photoId);
    if (!asset || !bytes) return;
    let image: PDFImage | undefined;
    if (asset.contentType === 'image/jpeg') image = await doc.embedJpg(bytes).catch(() => undefined);
    if (asset.contentType === 'image/png') image = await doc.embedPng(bytes).catch(() => undefined);
    if (!image) return;
    ensure(height + 10);
    const scale = Math.min(CONTENT_WIDTH / image.width, height / image.height);
    const width = image.width * scale; const imageHeight = image.height * scale;
    state.page.drawImage(image, { x: MARGIN + (CONTENT_WIDTH - width) / 2, y: state.y - imageHeight, width, height: imageHeight });
    state.y -= imageHeight + 10;
  };

  for (let index = 0; index < model.blocks.length; index += 1) {
    const block: ReportDocumentBlock = model.blocks[index]!;
    if (index > 0 && (block.type === 'summary' || block.type === 'area' || block.type === 'photo-index')) state = newPage();
    if (block.type === 'cover') {
      text(block.agencyName.toUpperCase(), { font: bold, size: 15, leading: 20, colour: rgb(0.11, 0.3, 0.7) });
      state.y -= 44; heading(block.title, true); text(block.propertyAddress, { font: bold, size: 14, leading: 19 }); state.y -= 28;
      if (block.inspectionDate) text(`Inspection date: ${block.inspectionDate}`);
      if (block.inspectorName) text(`Prepared by: ${block.inspectorName}`);
      if (block.clientName) text(`Client: ${block.clientName}`);
      state.y -= 12; text(`Immutable report version: ${input.reportVersionId}`, { font: italic, size: 8, colour: rgb(0.35, 0.35, 0.35) });
      continue;
    }
    if (block.type === 'summary') {
      heading(block.heading, true); rule();
      for (const metric of block.metrics) text(`${metric.label}: ${metric.value}`, { font: metric.value > 0 ? bold : regular, size: 10, leading: 15 });
      continue;
    }
    if (block.type === 'finding-list') {
      heading(block.heading); rule();
      if (!block.items.length) text('No exceptions recorded.', { font: italic, colour: rgb(0.4, 0.4, 0.4) });
      for (const item of block.items) { ensure(50); text(`${item.areaName} / ${item.component.label}`, { font: bold, size: 10 }); text(item.component.commentary, { indent: 8 }); state.y -= 6; }
      continue;
    }
    if (block.type === 'area') {
      heading(block.heading, true); text(block.commentary, { font: italic, colour: rgb(0.35, 0.35, 0.35) }); rule();
      for (const component of block.components) {
        ensure(56); text(component.label, { font: bold, size: 10 });
        text(`Condition: ${component.condition.replaceAll('_', ' ')} | Cleanliness: ${component.cleanliness.replaceAll('_', ' ')} | Working: ${component.working.replaceAll('_', ' ')} | Test: ${component.test.replaceAll('_', ' ')}`, { font: italic, size: 7, colour: rgb(0.35, 0.35, 0.35), indent: 8 });
        text(component.commentary, { indent: 8 });
        for (const photo of component.photos.slice(0, 1)) await drawImage(photo.photoId, 115);
        state.y -= 5;
      }
      continue;
    }
    if (block.type === 'approval') { heading('Approval Record'); text(`Prepared by: ${block.inspectorName || 'Recorded inspector'}`); text(`Report version: ${block.reportVersionId || input.reportVersionId}`); continue; }
    if (block.type === 'text') { heading(block.heading); text(block.body, { size: 8, leading: 11 }); continue; }
    if (block.type === 'photo-index') {
      heading(block.heading, true); rule();
      for (const photo of block.photos) { text(`${photo.areaName}${photo.componentLabel ? ` / ${photo.componentLabel}` : ''}${photo.caption ? ` - ${photo.caption}` : ''}`, { font: bold, size: 8 }); await drawImage(photo.photoId, 180); }
    }
  }

  return doc.save({ useObjectStreams: false });
}
