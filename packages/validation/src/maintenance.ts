import {
  MAINTENANCE_CATEGORIES,
  MAINTENANCE_CANDIDATE_SOURCES,
  MAINTENANCE_ITEM_STATUSES,
  MAINTENANCE_PRIORITIES,
  EXTERNAL_CONTACT_TYPES,
  TENANT_INSTRUCTION_TYPES,
  type ExternalContact,
  type MaintenanceCandidate,
  type MaintenanceCategory,
  type MaintenanceItem,
  type MaintenancePriority,
  type MaintenanceCandidateSource,
  type MaintenanceItemStatus,
  type TenantInstruction,
  type TenantInstructionType,
  type ExternalContactType,
} from '@pcr/domain';
import type { ValidationResult, ValidationSchema } from './index.js';

function record(value: unknown): ValidationResult<Record<string, unknown>> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ok: true, value: value as Record<string, unknown> };
  }
  return {
    ok: false,
    error: { code: 'VALIDATION_ERROR', message: 'Request body must be a JSON object.', status: 400 },
  };
}

function requireNonEmpty(value: unknown, name: string): ValidationResult<string> {
  if (typeof value === 'string' && value.trim().length > 0) {
    return { ok: true, value: value.trim() };
  }
  return {
    ok: false,
    error: {
      code: 'VALIDATION_ERROR',
      message: `${name} is required.`,
      status: 400,
      details: { field: name },
    },
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

const categories = new Set<string>(MAINTENANCE_CATEGORIES);
const priorities = new Set<string>(MAINTENANCE_PRIORITIES);
const candidateSources = new Set<string>(MAINTENANCE_CANDIDATE_SOURCES);
const itemStatuses = new Set<string>(MAINTENANCE_ITEM_STATUSES);
const externalContactTypes = new Set<string>(EXTERNAL_CONTACT_TYPES);
const tenantInstructionTypes = new Set<string>(TENANT_INSTRUCTION_TYPES);

export const createMaintenanceCandidateSchema: ValidationSchema<Partial<MaintenanceCandidate>> = {
  parse(value) {
    const parsed = record(value);
    if (!parsed.ok) return parsed;
    const body = parsed.value;

    const propertyId = requireNonEmpty(body.propertyId, 'propertyId');
    if (!propertyId.ok) return propertyId;
    const title = requireNonEmpty(body.title, 'title');
    if (!title.ok) return title;

    const category: MaintenanceCategory =
      typeof body.category === 'string' && categories.has(body.category)
        ? body.category as MaintenanceCategory
        : 'General Maintenance';
    const suggestedPriority: MaintenancePriority =
      typeof body.suggestedPriority === 'string' && priorities.has(body.suggestedPriority)
        ? body.suggestedPriority as MaintenancePriority
        : 'routine';
    const source: MaintenanceCandidateSource =
      typeof body.source === 'string' && candidateSources.has(body.source)
        ? body.source as MaintenanceCandidateSource
        : 'inspector';

    return {
      ok: true,
      value: {
        propertyId: propertyId.value,
        title: title.value,
        description: typeof body.description === 'string' ? body.description.trim() : '',
        category,
        suggestedPriority,
        source,
        tenancyId: typeof body.tenancyId === 'string' ? body.tenancyId : undefined,
        inspectionJobId: typeof body.inspectionJobId === 'string' ? body.inspectionJobId : undefined,
        reportId: typeof body.reportId === 'string' ? body.reportId : undefined,
        reportVersionId: typeof body.reportVersionId === 'string' ? body.reportVersionId : undefined,
        areaId: typeof body.areaId === 'string' ? body.areaId : undefined,
        componentId: typeof body.componentId === 'string' ? body.componentId : undefined,
        observationId: typeof body.observationId === 'string' ? body.observationId : undefined,
        evidencePhotoIds: stringArray(body.evidencePhotoIds),
      },
    };
  },
};

export const createMaintenanceItemSchema: ValidationSchema<Partial<MaintenanceItem>> = {
  parse(value) {
    const parsed = record(value);
    if (!parsed.ok) return parsed;
    const body = parsed.value;

    const propertyId = requireNonEmpty(body.propertyId, 'propertyId');
    if (!propertyId.ok) return propertyId;
    const title = requireNonEmpty(body.title, 'title');
    if (!title.ok) return title;

    const category: MaintenanceCategory =
      typeof body.category === 'string' && categories.has(body.category)
        ? body.category as MaintenanceCategory
        : 'General Maintenance';
    const priority: MaintenancePriority =
      typeof body.priority === 'string' && priorities.has(body.priority)
        ? body.priority as MaintenancePriority
        : 'routine';
    const status: MaintenanceItemStatus =
      typeof body.status === 'string' && itemStatuses.has(body.status)
        ? body.status as MaintenanceItemStatus
        : 'triage_required';

    return {
      ok: true,
      value: {
        propertyId: propertyId.value,
        title: title.value,
        description: typeof body.description === 'string' ? body.description : '',
        category,
        priority,
        status,
        approvalRequired: Boolean(body.approvalRequired),
        approvalStatus: body.approvalRequired ? 'pending' : 'not_required',
        workInstruction: typeof body.workInstruction === 'string' ? body.workInstruction : undefined,
        dueDate: typeof body.dueDate === 'string' ? body.dueDate : undefined,
        sourceEvidenceIds: stringArray(body.sourceEvidenceIds),
      },
    };
  },
};

export const createTenantInstructionSchema: ValidationSchema<Partial<TenantInstruction>> = {
  parse(value) {
    const parsed = record(value);
    if (!parsed.ok) return parsed;
    const body = parsed.value;

    const propertyId = requireNonEmpty(body.propertyId, 'propertyId');
    if (!propertyId.ok) return propertyId;
    const tenancyId = requireNonEmpty(body.tenancyId, 'tenancyId');
    if (!tenancyId.ok) return tenancyId;
    const title = requireNonEmpty(body.title, 'title');
    if (!title.ok) return title;
    const instruction = requireNonEmpty(body.instruction, 'instruction');
    if (!instruction.ok) return instruction;

    const type: TenantInstructionType =
      typeof body.type === 'string' && tenantInstructionTypes.has(body.type)
        ? body.type as TenantInstructionType
        : 'general_followup';

    return {
      ok: true,
      value: {
        propertyId: propertyId.value,
        tenancyId: tenancyId.value,
        type,
        title: title.value,
        instruction: instruction.value,
        responseRequired: body.responseRequired !== false,
        dueDate: typeof body.dueDate === 'string' ? body.dueDate : undefined,
        sourceEvidenceIds: stringArray(body.sourceEvidenceIds),
      },
    };
  },
};

export const createExternalContactSchema: ValidationSchema<Partial<ExternalContact>> = {
  parse(value) {
    const parsed = record(value);
    if (!parsed.ok) return parsed;
    const body = parsed.value;

    const name = requireNonEmpty(body.name, 'name');
    if (!name.ok) return name;
    const email = requireNonEmpty(body.email, 'email');
    if (!email.ok) return email;

    const type: ExternalContactType =
      typeof body.type === 'string' && externalContactTypes.has(body.type)
        ? body.type as ExternalContactType
        : 'contractor';

    return {
      ok: true,
      value: {
        name: name.value,
        email: email.value,
        businessName: typeof body.businessName === 'string' ? body.businessName : undefined,
        phone: typeof body.phone === 'string' ? body.phone : undefined,
        type,
        status: 'active',
      },
    };
  },
};
