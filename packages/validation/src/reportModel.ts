import {
  COMPONENT_CLEANLINESS_CATEGORIES,
  COMPONENT_COMPARISON_STATUSES,
  COMPONENT_CONDITION_CATEGORIES,
  COMPONENT_REVIEW_STATUSES,
  COMPONENT_TEST_STATUSES,
  COMPONENT_WORKING_STATUSES,
  type ReportAggregate,
} from '@pcr/domain';
import type { ValidationResult, ValidationSchema } from './index.js';

const conditions = new Set<string>(COMPONENT_CONDITION_CATEGORIES);
const cleanliness = new Set<string>(COMPONENT_CLEANLINESS_CATEGORIES);
const working = new Set<string>(COMPONENT_WORKING_STATUSES);
const testing = new Set<string>(COMPONENT_TEST_STATUSES);
const reviews = new Set<string>(COMPONENT_REVIEW_STATUSES);
const comparisons = new Set<string>(COMPONENT_COMPARISON_STATUSES);

function failure(message: string, field: string): ValidationResult<never> {
  return { ok: false, error: { code: 'VALIDATION_ERROR', message, status: 400, details: { field } } };
}

function object(value: unknown, field: string): ValidationResult<Record<string, unknown>> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return { ok: true, value: value as Record<string, unknown> };
  return failure(`${field} must be an object.`, field);
}

function string(value: unknown, field: string): ValidationResult<string> {
  if (typeof value === 'string' && value.trim()) return { ok: true, value: value.trim() };
  return failure(`${field} is required.`, field);
}

function positiveInteger(value: unknown, field: string): ValidationResult<number> {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return { ok: true, value };
  return failure(`${field} must be a positive integer.`, field);
}

function enumValue(value: unknown, values: Set<string>, field: string): ValidationResult<string> {
  if (typeof value === 'string' && values.has(value)) return { ok: true, value };
  return failure(`${field} is not supported.`, field);
}

function assertNoBinary(value: unknown, path = 'aggregate'): ValidationResult<true> {
  if (typeof value === 'string' && (value.startsWith('data:') || value.length > 200_000)) {
    return failure('Binary or oversized inline content is not permitted in Firestore report data.', path);
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const result = assertNoBinary(value[index], `${path}[${index}]`);
      if (!result.ok) return result;
    }
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (['file', 'blob', 'bytes', 'base64', 'previewUrl'].includes(key)) return failure('Binary fields are not permitted in Firestore report data.', `${path}.${key}`);
      const result = assertNoBinary(child, `${path}.${key}`);
      if (!result.ok) return result;
    }
  }
  return { ok: true, value: true };
}

export const reportAggregateSchema: ValidationSchema<ReportAggregate> = {
  parse(value) {
    const aggregate = object(value, 'aggregate');
    if (!aggregate.ok) return aggregate;
    const binaryCheck = assertNoBinary(aggregate.value);
    if (!binaryCheck.ok) return binaryCheck;

    const report = object(aggregate.value.report, 'report');
    if (!report.ok) return report;
    for (const field of ['id', 'agencyId', 'reportType', 'propertyAddress', 'lifecycleStatus']) {
      const result = string(report.value[field], `report.${field}`);
      if (!result.ok) return result;
    }
    if (!Array.isArray(aggregate.value.areas)) return failure('areas must be an array.', 'areas');

    const sequences = new Set<number>();
    for (let areaIndex = 0; areaIndex < aggregate.value.areas.length; areaIndex += 1) {
      const area = object(aggregate.value.areas[areaIndex], `areas[${areaIndex}]`);
      if (!area.ok) return area;
      for (const field of ['id', 'name']) {
        const result = string(area.value[field], `areas[${areaIndex}].${field}`);
        if (!result.ok) return result;
      }
      const sequence = positiveInteger(area.value.sequence, `areas[${areaIndex}].sequence`);
      if (!sequence.ok) return sequence;
      if (sequences.has(sequence.value)) return failure('Area sequence values must be unique.', `areas[${areaIndex}].sequence`);
      sequences.add(sequence.value);
      if (!Array.isArray(area.value.components)) return failure('components must be an array.', `areas[${areaIndex}].components`);
      for (let componentIndex = 0; componentIndex < area.value.components.length; componentIndex += 1) {
        const prefix = `areas[${areaIndex}].components[${componentIndex}]`;
        const component = object(area.value.components[componentIndex], prefix);
        if (!component.ok) return component;
        for (const field of ['id', 'component', 'commentary']) {
          const result = string(component.value[field], `${prefix}.${field}`);
          if (!result.ok) return result;
        }
        const categoryChecks = [
          enumValue(component.value.conditionCategory, conditions, `${prefix}.conditionCategory`),
          enumValue(component.value.cleanlinessCategory, cleanliness, `${prefix}.cleanlinessCategory`),
          enumValue(component.value.workingStatus, working, `${prefix}.workingStatus`),
          enumValue(component.value.testStatus, testing, `${prefix}.testStatus`),
          enumValue(component.value.reviewStatus, reviews, `${prefix}.reviewStatus`),
          enumValue(component.value.comparisonStatus, comparisons, `${prefix}.comparisonStatus`),
        ];
        const invalid = categoryChecks.find((result) => !result.ok);
        if (invalid && !invalid.ok) return invalid;
        if (typeof component.value.maintenanceRequired !== 'boolean') return failure('maintenanceRequired must be a boolean.', `${prefix}.maintenanceRequired`);
        if (!Array.isArray(component.value.defects) || component.value.defects.some((defect) => typeof defect !== 'string')) {
          return failure('defects must be an array of strings.', `${prefix}.defects`);
        }
        if (!Array.isArray(component.value.photoReferences)) return failure('photoReferences must be an array.', `${prefix}.photoReferences`);
        for (const [photoIndex, reference] of component.value.photoReferences.entries()) {
          const photo = object(reference, `${prefix}.photoReferences[${photoIndex}]`);
          if (!photo.ok) return photo;
          for (const field of ['photoId', 'objectPath']) {
            const result = string(photo.value[field], `${prefix}.photoReferences[${photoIndex}].${field}`);
            if (!result.ok) return result;
          }
        }
        if (component.value.quantity !== undefined && (typeof component.value.quantity !== 'number' || component.value.quantity < 0)) {
          return failure('quantity must be a non-negative number.', `${prefix}.quantity`);
        }
        if (component.value.aiConfidence !== undefined && (typeof component.value.aiConfidence !== 'number' || component.value.aiConfidence < 0 || component.value.aiConfidence > 1)) {
          return failure('aiConfidence must be between 0 and 1.', `${prefix}.aiConfidence`);
        }
      }
    }
    return { ok: true, value: value as ReportAggregate };
  },
};
