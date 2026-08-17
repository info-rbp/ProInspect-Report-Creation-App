import {
  PDFDocument,
  PageSizes,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';

export interface RenderAsset {
  photoId: string;
  objectPath: string;
  generation: string;
  sha256: string;
  contentType?: string;
}

export interface RenderInput {
  reportId: string;
  reportVersionId: string;
  templateId: string;
  templateVersion: number;
  approvedAt: string;
  approvedBy: string;
  report: Record<string, unknown>;
  areas: Array<Record<string, unknown>>;
  assets: RenderAsset[];
}

interface PageState {
  page: PDFPage;
  y: number;
}

const PAGE_WIDTH = PageSizes.A4[0];
const PAGE_HEIGHT = PageSizes.A4[1];
const MARGIN = 42;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BODY_SIZE = 9;
const BODY_LEADING = 12;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function valueText(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

/**
 * The built-in PDF standard fonts use WinAnsi encoding. Keep the persisted wording
 * intact where possible, but normalise punctuation that cannot be represented so a
 * single typographic character cannot make final report generation fail.
 */
export function pdfSafeText(value: string): string {
  return value
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u2022/g, '*')
    .replace(/\u00A0/g, ' ')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '?');
}

function splitLongToken(font: PDFFont, token: string, size: number, maxWidth: number): string[] {
  if (font.widthOfTextAtSize(token, size) <= maxWidth) return [token];
  const chunks: string[] = [];
  let current = '';
  for (const character of token) {
    const candidate = `${current}${character}`;
    if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      chunks.push(current);
      current = character;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function wrapText(font: PDFFont, source: string, size: number, maxWidth: number): string[] {
  const paragraphs = pdfSafeText(source).split(/\r?\n/);
  const output: string[] = [];

  for (const paragraph of paragraphs) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      output.push('');
      continue;
    }

    let line = '';
    for (const word of words) {
      for (const token of splitLongToken(font, word, size, maxWidth)) {
        const candidate = line ? `${line} ${token}` : token;
        if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
          output.push(line);
          line = token;
        } else {
          line = candidate;
        }
      }
    }
    if (line) output.push(line);
  }

  return output.length ? output : [''];
}

function formatDate(value: unknown): string {
  const raw = valueText(value);
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat('en-AU', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Australia/Perth',
  }).format(date);
}

function titleFor(reportType: string): string {
  const lower = reportType.toLowerCase();
  if (lower.includes('routine')) return 'Routine Inspection Report';
  if (lower.includes('exit')) return 'Exit Inspection Report';
  if (lower.includes('comparison')) return 'Inspection Comparison Report';
  if (lower.includes('maintenance') || lower.includes('follow')) return 'Maintenance / Follow-Up Report';
  return 'Property Condition Report';
}

function statusSummary(component: Record<string, unknown>): string {
  const condition = valueText(component.conditionCategory, 'unable_to_confirm').replaceAll('_', ' ');
  const cleanliness = valueText(component.cleanlinessCategory, 'unable_to_confirm').replaceAll('_', ' ');
  const working = valueText(component.workingStatus, 'unable_to_confirm').replaceAll('_', ' ');
  return `Condition: ${condition} | Cleanliness: ${cleanliness} | Working: ${working}`;
}

function evidenceIds(record: Record<string, unknown>): string[] {
  const refs = asArray(record.photoReferences);
  const ids = refs
    .map((reference) => valueText(asRecord(reference).photoId))
    .filter(Boolean);
  return [...new Set(ids)];
}

function drawFooter(page: PDFPage, font: PDFFont, reportId: string, pageNumber: number): void {
  page.drawLine({
    start: { x: MARGIN, y: 28 },
    end: { x: PAGE_WIDTH - MARGIN, y: 28 },
    thickness: 0.5,
    color: rgb(0.75, 0.75, 0.75),
  });
  page.drawText(pdfSafeText(`Report ${reportId} | Page ${pageNumber}`), {
    x: MARGIN,
    y: 15,
    size: 7,
    font,
    color: rgb(0.4, 0.4, 0.4),
  });
}

export async function renderReportPdf(
  input: RenderInput,
  imageBytes: ReadonlyMap<string, Uint8Array> = new Map(),
): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const italic = await document.embedFont(StandardFonts.HelveticaOblique);

  document.setTitle(pdfSafeText(titleFor(valueText(input.report.reportType))));
  document.setAuthor(pdfSafeText(valueText(input.report.agentCompany, 'ProInspect')));
  document.setSubject(pdfSafeText(`Property inspection report ${input.reportId}`));
  document.setCreator('ProInspect Property Reporting App');
  document.setProducer('ProInspect PDF Worker');
  const deterministicDate = new Date(input.approvedAt);
  if (!Number.isNaN(deterministicDate.getTime())) {
    document.setCreationDate(deterministicDate);
    document.setModificationDate(deterministicDate);
  }

  let pageNumber = 0;
  const newPage = (): PageState => {
    const page = document.addPage(PageSizes.A4);
    pageNumber += 1;
    drawFooter(page, regular, input.reportId, pageNumber);
    return { page, y: PAGE_HEIGHT - MARGIN };
  };

  const ensureSpace = (state: PageState, required: number): PageState =>
    state.y - required < 42 ? newPage() : state;

  const drawLines = (
    initialState: PageState,
    text: string,
    options: { font?: PDFFont; size?: number; leading?: number; indent?: number; color?: ReturnType<typeof rgb> } = {},
  ): PageState => {
    const font = options.font ?? regular;
    const size = options.size ?? BODY_SIZE;
    const leading = options.leading ?? BODY_LEADING;
    const indent = options.indent ?? 0;
    const lines = wrapText(font, text, size, CONTENT_WIDTH - indent);
    let state = initialState;
    for (const line of lines) {
      state = ensureSpace(state, leading + 2);
      state.page.drawText(line, {
        x: MARGIN + indent,
        y: state.y,
        size,
        font,
        color: options.color ?? rgb(0.08, 0.08, 0.08),
      });
      state.y -= leading;
    }
    return state;
  };

  const drawRule = (state: PageState): PageState => {
    state.page.drawLine({
      start: { x: MARGIN, y: state.y },
      end: { x: PAGE_WIDTH - MARGIN, y: state.y },
      thickness: 0.7,
      color: rgb(0.72, 0.72, 0.72),
    });
    state.y -= 10;
    return state;
  };

  // Cover page
  let state = newPage();
  const company = valueText(input.report.agentCompany, 'ProInspect');
  const reportType = valueText(input.report.reportType, 'Property Condition Report');
  state = drawLines(state, company.toUpperCase(), { font: bold, size: 15, leading: 20 });
  state.y -= 38;
  state = drawLines(state, titleFor(reportType), { font: bold, size: 23, leading: 30 });
  state.y -= 12;
  state = drawLines(state, valueText(input.report.propertyAddress, 'Property address not recorded'), {
    font: bold,
    size: 14,
    leading: 19,
  });
  state.y -= 36;
  state = drawLines(state, `Inspection date: ${formatDate(input.report.inspectionDate) || 'Not recorded'}`, {
    size: 10,
    leading: 15,
  });
  state = drawLines(state, `Prepared by: ${valueText(input.report.agentName, input.approvedBy) || 'Not recorded'}`, {
    size: 10,
    leading: 15,
  });
  state = drawLines(state, `Approved: ${formatDate(input.approvedAt) || input.approvedAt}`, { size: 10, leading: 15 });
  state = drawLines(state, `Approved by: ${input.approvedBy}`, { size: 10, leading: 15 });
  state.y -= 28;
  state = drawLines(state, `Immutable report version: ${input.reportVersionId}`, {
    font: italic,
    size: 8,
    leading: 12,
    color: rgb(0.35, 0.35, 0.35),
  });

  // Area/component detail
  state = newPage();
  state = drawLines(state, 'Inspection Findings', { font: bold, size: 16, leading: 23 });
  state = drawRule(state);

  for (const rawArea of input.areas) {
    const area = asRecord(rawArea);
    state = ensureSpace(state, 54);
    state = drawLines(state, valueText(area.name, valueText(area.id, 'Area')), { font: bold, size: 13, leading: 18 });

    const overall = valueText(area.overallCommentary);
    if (overall) {
      state = drawLines(state, 'Overall commentary', { font: bold, size: 8, leading: 11 });
      state = drawLines(state, overall, { size: 9, leading: 12, indent: 8 });
    }

    const areaEvidence = evidenceIds(area);
    if (areaEvidence.length) {
      state = drawLines(state, `Area evidence: ${areaEvidence.join(', ')}`, {
        font: italic,
        size: 7,
        leading: 10,
        color: rgb(0.35, 0.35, 0.35),
      });
    }

    for (const rawComponent of asArray(area.components)) {
      const component = asRecord(rawComponent);
      state = ensureSpace(state, 42);
      state = drawLines(state, valueText(component.component, valueText(component.id, 'Component')), {
        font: bold,
        size: 9,
        leading: 12,
        indent: 8,
      });
      state = drawLines(state, statusSummary(component), {
        font: italic,
        size: 7,
        leading: 10,
        indent: 16,
        color: rgb(0.35, 0.35, 0.35),
      });
      const commentary = valueText(component.commentary, 'No component commentary recorded.');
      state = drawLines(state, commentary, { size: 8.5, leading: 11.5, indent: 16 });
      const ids = evidenceIds(component);
      if (ids.length) {
        state = drawLines(state, `Evidence: ${ids.join(', ')}`, {
          font: italic,
          size: 7,
          leading: 10,
          indent: 16,
          color: rgb(0.35, 0.35, 0.35),
        });
      }
      state.y -= 4;
    }

    state.y -= 8;
    state = drawRule(state);
  }

  // Evidence appendix. Persisted photo metadata remains authoritative even when an
  // image encoding cannot be embedded directly into the PDF.
  if (input.assets.length) {
    state = newPage();
    state = drawLines(state, `Evidence Appendix (${input.assets.length} photo${input.assets.length === 1 ? '' : 's'})`, {
      font: bold,
      size: 16,
      leading: 23,
    });
    state = drawRule(state);

    for (const asset of [...input.assets].sort((left, right) => left.photoId.localeCompare(right.photoId))) {
      state = ensureSpace(state, 250);
      state = drawLines(state, `Photo ${asset.photoId}`, { font: bold, size: 10, leading: 14 });
      state = drawLines(state, `${asset.objectPath} | generation ${asset.generation} | sha256 ${asset.sha256}`, {
        font: italic,
        size: 6.5,
        leading: 9,
        color: rgb(0.35, 0.35, 0.35),
      });

      const bytes = imageBytes.get(asset.photoId);
      let image: PDFImage | undefined;
      if (bytes && asset.contentType === 'image/jpeg') {
        image = await document.embedJpg(bytes).catch(() => undefined);
      } else if (bytes && asset.contentType === 'image/png') {
        image = await document.embedPng(bytes).catch(() => undefined);
      }

      const boxHeight = 185;
      const boxWidth = CONTENT_WIDTH;
      state = ensureSpace(state, boxHeight + 18);
      if (image) {
        const scale = Math.min(boxWidth / image.width, boxHeight / image.height);
        const width = image.width * scale;
        const height = image.height * scale;
        state.page.drawRectangle({
          x: MARGIN,
          y: state.y - boxHeight,
          width: boxWidth,
          height: boxHeight,
          borderWidth: 0.5,
          borderColor: rgb(0.75, 0.75, 0.75),
        });
        state.page.drawImage(image, {
          x: MARGIN + (boxWidth - width) / 2,
          y: state.y - boxHeight + (boxHeight - height) / 2,
          width,
          height,
        });
      } else {
        state.page.drawRectangle({
          x: MARGIN,
          y: state.y - boxHeight,
          width: boxWidth,
          height: boxHeight,
          borderWidth: 0.5,
          borderColor: rgb(0.65, 0.65, 0.65),
          color: rgb(0.96, 0.96, 0.96),
        });
        state.page.drawText(pdfSafeText(`Image preview unavailable (${asset.contentType || 'unknown format'}). Evidence metadata retained.`), {
          x: MARGIN + 12,
          y: state.y - boxHeight / 2,
          size: 8,
          font: italic,
          color: rgb(0.35, 0.35, 0.35),
        });
      }
      state.y -= boxHeight + 18;
    }
  }

  // Scope note deliberately avoids creating or altering inspection findings.
  state = ensureSpace(state, 75);
  state = drawLines(state, 'Report scope', { font: bold, size: 9, leading: 13 });
  state = drawLines(
    state,
    'This document records the persisted inspection findings and evidence for the approved report version. Working status is only represented as recorded in the approved assessment; the PDF renderer does not infer condition, operation, causation, tenant responsibility, or liability.',
    { size: 7.5, leading: 10.5 },
  );

  return document.save({ useObjectStreams: false });
}
