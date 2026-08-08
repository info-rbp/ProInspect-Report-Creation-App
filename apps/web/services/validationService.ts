import { ReportData } from '../types';

export const MAX_IMAGE_SIZE_BYTES = 15 * 1024 * 1024;
export const MAX_PREVIOUS_REPORT_SIZE_BYTES = 20 * 1024 * 1024;
export const MAX_PHOTOS_PER_ROOM = 100;
export const MAX_ROOMS_PER_REPORT = 50;

const VALID_REPORT_TYPES = new Set([
  'Property Condition Report',
  'Routine Inspection',
  'Exit Inspection',
]);

const VALID_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const isHeicExtension = (name: string): boolean => /\.(heic|heif)$/i.test(name);

export const sanitizeText = (value: string | undefined | null, maxLength = 250): string => {
  if (!value) {
    return '';
  }

  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
};

export const sanitizeMultilineText = (value: string | undefined | null, maxLength = 4000): string => {
  if (!value) {
    return '';
  }

  return value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim()
    .slice(0, maxLength);
};

export const validateImageFiles = (files: File[], existingCount = 0) => {
  const validFiles: File[] = [];
  const errors: string[] = [];

  for (const file of files) {
    const isSupportedImage = VALID_IMAGE_TYPES.has(file.type) || isHeicExtension(file.name);

    if (!isSupportedImage) {
      errors.push(`${file.name}: unsupported file type.`);
      continue;
    }

    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      errors.push(`${file.name}: exceeds the 15MB per-image limit.`);
      continue;
    }

    if (existingCount + validFiles.length >= MAX_PHOTOS_PER_ROOM) {
      errors.push(`Only ${MAX_PHOTOS_PER_ROOM} photos can be stored per room.`);
      break;
    }

    validFiles.push(file);
  }

  return { validFiles, errors };
};

export const validatePreviousReportFile = (file: File): string[] => {
  const errors: string[] = [];
  const isSupported = file.type === 'application/pdf' || file.type.startsWith('image/') || isHeicExtension(file.name);

  if (!isSupported) {
    errors.push('Previous report attachments must be a PDF or image file.');
  }

  if (file.size > MAX_PREVIOUS_REPORT_SIZE_BYTES) {
    errors.push('Previous report attachments must be 20MB or smaller.');
  }

  return errors;
};

export const sanitizeReportData = (report: ReportData): ReportData => ({
  ...report,
  propertyAddress: sanitizeText(report.propertyAddress, 250),
  agentName: sanitizeText(report.agentName || (report as any).inspectorName, 120),
  agentCompany: sanitizeText(report.agentCompany, 160),
  agentAddress: sanitizeText(report.agentAddress, 250),
  agentPhone: sanitizeText(report.agentPhone, 80),
  agentEmail: sanitizeText(report.agentEmail, 160),
  clientName: sanitizeText(report.clientName || (report as any).landlordName, 160),
  tenantName: sanitizeText(report.tenantName, 160),
  reportType: sanitizeText(report.reportType, 80),
  previousReportNotes: sanitizeMultilineText(report.previousReportNotes, 4000),
  rooms: (report.rooms || []).map((room) => ({
    ...room,
    name: sanitizeText(room.name, 160),
    overallComment: sanitizeMultilineText(room.overallComment, 2000),
    items: (room.items || []).map((item) => ({
      ...item,
      name: sanitizeText(item.name, 120),
      comment: sanitizeMultilineText(item.comment, 1000),
    })),
    photos: room.photos || [],
  })),
});

export const validateReport = (report: ReportData): { errors: string[] } => {
  const errors: string[] = [];

  if (!report.propertyAddress?.trim()) {
    errors.push('Property address is required.');
  }

  if (!report.agentName?.trim()) {
    errors.push('Inspector name is required.');
  }

  if (!report.agentCompany?.trim()) {
    errors.push('Company name is required.');
  }

  if (!report.inspectionDate) {
    errors.push('Inspection date is required.');
  }

  if (!VALID_REPORT_TYPES.has(report.reportType)) {
    errors.push('A supported report type must be selected.');
  }

  const rooms = report.rooms || [];

  if (rooms.length === 0) {
    errors.push('At least one room or area must be added before saving or exporting a report.');
  }

  if (rooms.length > MAX_ROOMS_PER_REPORT) {
    errors.push(`A report can contain at most ${MAX_ROOMS_PER_REPORT} rooms or areas.`);
  }

  for (const room of rooms) {
    if (!room.name?.trim()) {
      errors.push('Every room requires a display name.');
      break;
    }

    if ((room.photos || []).length > MAX_PHOTOS_PER_ROOM) {
      errors.push(`${room.name}: more than ${MAX_PHOTOS_PER_ROOM} photos are attached.`);
    }
  }

  return { errors };
};
