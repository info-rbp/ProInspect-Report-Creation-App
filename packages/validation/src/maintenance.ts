import {
  MAINTENANCE_CATEGORIES,
  MAINTENANCE_CANDIDATE_SOURCES,
  MAINTENANCE_CANDIDATE_STATUSES,
  MAINTENANCE_ITEM_STATUSES,
  MAINTENANCE_PRIORITIES,
  EXTERNAL_CONTACT_TYPES,
  WORK_REQUEST_STATUSES,
  TENANT_INSTRUCTION_TYPES,
  TENANT_INSTRUCTION_STATUSES,
  CLIENT_APPROVAL_STATUSES,
  type MaintenanceCandidate,
  type MaintenanceItem,
  type WorkRequest,
  type TenantInstruction,
  type ExternalContact,
  type ClientApproval,
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
    error: { code: 'VALIDATION_ERROR', message: `${name} is required.`, status: 400, details: { field: name } },
  };
}

const categories = new Set(MAINTENANCE_CATEGORIES);
const priorities = new Set(MAINTENANCE_PRIORITIES);
const candidateSources = new Set(MAINTENANCE_CANDIDATE_SOURCES);
const candidateStatuses = new Set(MAINTENANCE_CANDIDATE_STATUSES);
const itemStatuses = new Set(MAINTENANCE_ITEM_STATUSES);
const externalContactTypes = new Set(EXTERNAL_CONTACT_TYPES);
const workRequestStatuses = new Set(WORK_REQUEST_STATUSES);
const tenantInstructionTypes = new Set(TENANT_INSTRUCTION_TYPES);
const tenantInstructionStatuses = new Set(TENANT_INSTRUCTION_STATUSES);
const clientApprovalStatuses = new Set(CLIENT_APPROVAL_STATUSES);

export const createMaintenanceCandidateSchema: ValidationSchema<Partial<MaintenanceCandidate>> = {
  parse(value) {
    const parsed = record(value);
    if (!parsed.ok) return parsed;
    const body = parsed.value;

    const propertyId = requireNonEmpty(body.propertyId, 'propertyId');
    if (!propertyId.ok) return propertyId;

    const title = requireNonEmpty(body.title, 'title');
    if (!title.ok) return title;

    const description = typeof body.description === 'string' ? body.description.trim() : '';
    const category = typeof body.category === 'string' && categories.has(body.category as any) ? body.category : 'General Maintenance';
    const suggestedPriority = typeof body.suggestedPriority === 'string' && priorities.has(body.suggestedPriority as any) ? body.suggestedPriority : 'routine';
    const source = typeof body.source === 'string' && candidateSources.has(body.source as any) ? body.source : 'inspector';

    return {
      ok: true,
      value: {
        propertyId: propertyId.value,
        title: title.value,
        description,
        category: category as any,
        suggestedPriority: suggestedPriority as any,
        source: source as any,
        tenancyId: typeof body.tenancyId === 'string' ? body.tenancyId : undefined,
        inspectionJobId: typeof body.inspectionJobId === 'string' ? body.inspectionJobId : undefined,
        reportId: typeof body.reportId === 'string' ? body.reportId : undefined,
        reportVersionId: typeof body.reportVersionId === 'string' ? body.reportVersionId : undefined,
        areaId: typeof body.areaId === 'string' ? body.areaId : undefined,
        componentId: typeof body.componentId === 'string' ? body.componentId : undefined,
        observationId: typeof body.observationId === 'string' ? body.observationId : undefined,
        evidencePhotoIds: Array.isArray(body.evidencePhotoIds) ? body.evidencePhotoIds.filter((id): id is string => typeof id === 'string') : [],
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

    const category = typeof body.category === 'string' && categories.has(body.category as any) ? body.category : 'General Maintenance';
    const priority = typeof body.priority === 'string' && priorities.has(body.priority as any) ? body.priority : 'routine';

    return {
      ok: true,
      value: {
        propertyId: propertyId.value,
        title: title.value,
        description: typeof body.description === 'string' ? body.description : '',
        category: category as any,
        priority: priority as any,
        status: typeof body.status === 'string' && itemStatuses.has(body.status as any) ? (body.status as any) : 'triage_required',
        approvalRequired: Boolean(body.approvalRequired),
        approvalStatus: body.approvalRequired ? 'pending' : 'not_required',
        workInstruction: typeof body.workInstruction === 'string' ? body.workInstruction : undefined,
        dueDate: typeof body.dueDate === 'string' ? body.dueDate : undefined,
        sourceEvidenceIds: Array.isArray(body.sourceEvidenceIds) ? body.sourceEvidenceIds.filter((id): id is string => typeof id === 'string') : [],
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

    const type = typeof body.type === 'string' && tenantInstructionTypes.has(body.type as any) ? body.type : 'general_followup';

    return {
      ok: true,
      value: {
        propertyId: propertyId.value,
        tenancyId: tenancyId.value,
        type: type as any,
        title: title.value,
        instruction: instruction.value,
        responseRequired: body.responseRequired !== false,
        dueDate: typeof body.dueDate === 'string' ? body.dueDate : undefined,
        sourceEvidenceIds: Array.isArray(body.sourceEvidenceIds) ? body.sourceEvidenceIds.filter((id): id is string => typeof id === 'string') : [],
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

    const type = typeof body.type === 'string' && externalContactTypes.has(body.type as any) ? body.type : 'contractor';

    return {
      ok: true,
      value: {
        name: name.value,
        email: email.value,
        businessName: typeof body.businessName === 'string' ? body.businessName : undefined,
        phone: typeof body.phone === 'string' ? body.phone : undefined,
        type: type as any,
        status: 'active',
      },
    };
  },
};
