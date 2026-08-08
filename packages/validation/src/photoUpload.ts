import type { ValidationResult, ValidationSchema } from './index.js';

export interface EvidenceUploadSessionInput {
  fileName: string;
  contentType: string;
  size: number;
  sha256: string;
  propertyId: string;
  inspectionJobId: string;
  reportId?: string;
  areaId?: string;
  componentIds: string[];
}

function invalid(message: string, field: string): ValidationResult<never> {
  return { ok: false, error: { code: 'VALIDATION_ERROR', message, status: 400, details: { field } } };
}

function requiredString(record: Record<string, unknown>, field: string): ValidationResult<string> {
  const value = record[field];
  return typeof value === 'string' && value.trim() ? { ok: true, value: value.trim() } : invalid(`${field} is required.`, field);
}

export const evidenceUploadSessionSchema: ValidationSchema<EvidenceUploadSessionInput> = {
  parse(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('Request body must be a JSON object.', 'body');
    const record = value as Record<string, unknown>;
    const fileName = requiredString(record, 'fileName');
    if (!fileName.ok) return fileName;
    const contentType = requiredString(record, 'contentType');
    if (!contentType.ok) return contentType;
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(contentType.value)) {
      return invalid('Unsupported evidence image content type.', 'contentType');
    }
    const size = record.size;
    if (typeof size !== 'number' || !Number.isInteger(size) || size < 1 || size > 50_000_000) {
      return invalid('size must be an integer between 1 byte and 50 MB.', 'size');
    }
    const sha256 = requiredString(record, 'sha256');
    if (!sha256.ok) return sha256;
    if (!/^[a-f0-9]{64}$/i.test(sha256.value)) return invalid('sha256 must be a 64-character hexadecimal digest.', 'sha256');
    const propertyId = requiredString(record, 'propertyId');
    if (!propertyId.ok) return propertyId;
    const inspectionJobId = requiredString(record, 'inspectionJobId');
    if (!inspectionJobId.ok) return inspectionJobId;
    const componentIds = record.componentIds === undefined ? [] : record.componentIds;
    if (!Array.isArray(componentIds) || componentIds.some((item) => typeof item !== 'string' || !item.trim())) {
      return invalid('componentIds must be an array of non-empty strings.', 'componentIds');
    }
    return {
      ok: true,
      value: {
        fileName: fileName.value,
        contentType: contentType.value,
        size,
        sha256: sha256.value.toLowerCase(),
        propertyId: propertyId.value,
        inspectionJobId: inspectionJobId.value,
        ...(typeof record.reportId === 'string' && record.reportId.trim() ? { reportId: record.reportId.trim() } : {}),
        ...(typeof record.areaId === 'string' && record.areaId.trim() ? { areaId: record.areaId.trim() } : {}),
        componentIds: componentIds.map((item) => String(item).trim()),
      },
    };
  },
};
