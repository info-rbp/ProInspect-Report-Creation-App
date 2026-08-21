import { propertySnapshot } from '../../types/platform';
import type { InspectionJob, InspectionJobStatus } from '../../types/platform';
import { generateId } from '../../utils';
import { apiRequest } from '../apiClient';
import { isFirebaseConfigured } from '../storageService';
import { localDelete, localGet, localList, localPut } from './localPlatformStore';
import { getProperty } from './propertyService';

export type CreateInspectionJobInput = Omit<InspectionJob, 'id' | 'status' | 'createdAt' | 'updatedAt'> &
  Partial<Pick<InspectionJob, 'status'>>;
type VersionedInspectionJob = InspectionJob & { version?: number };

const SAMPLE_INSPECTION_JOBS: InspectionJob[] = [
  {
    id: 'job-sample-01',
    agencyId: 'proinspect-agency',
    propertyId: 'prop-sample-01',
    reportType: 'Property Condition Report',
    scheduledAt: new Date(Date.now() + 86_400_000 * 2).toISOString(),
    durationMinutes: 60,
    timezone: 'Australia/Perth',
    assignedInspectorId: 'sample-inspector',
    assignedReviewerId: 'sample-reviewer',
    source: 'manual',
    paymentStatus: 'not_required',
    bookingStatus: 'booked',
    propertyMatchStatus: 'matched',
    priority: 'normal',
    accessStatus: 'instructions_available',
    status: 'booked',
    notes: 'Entry inspection before the new tenancy starts.',
    createdAt: new Date(Date.now() - 86_400_000 * 3).toISOString(),
    updatedAt: new Date(Date.now() - 86_400_000).toISOString(),
  },
  {
    id: 'job-sample-02',
    agencyId: 'proinspect-agency',
    propertyId: 'prop-sample-02',
    reportType: 'Routine Inspection',
    scheduledAt: new Date(Date.now() - 86_400_000).toISOString(),
    durationMinutes: 30,
    timezone: 'Australia/Perth',
    source: 'manual',
    paymentStatus: 'not_required',
    bookingStatus: 'booked',
    propertyMatchStatus: 'matched',
    priority: 'normal',
    accessStatus: 'confirmed',
    assignedInspectorId: 'sample-inspector',
    assignedReviewerId: 'sample-reviewer',
    status: 'inspection_started',
    notes: 'Six-month routine inspection.',
    createdAt: new Date(Date.now() - 86_400_000 * 5).toISOString(),
    updatedAt: new Date(Date.now() - 3_600_000 * 4).toISOString(),
  },
];

function cloudMode(): boolean {
  return isFirebaseConfigured() && Boolean(import.meta.env.VITE_API_BASE_URL?.trim());
}

function calculatedEnd(startAt: string | undefined, durationMinutes: number): string | undefined {
  if (!startAt || !Number.isFinite(Date.parse(startAt))) return undefined;
  return new Date(Date.parse(startAt) + durationMinutes * 60_000).toISOString();
}

async function normaliseCreateInput(input: CreateInspectionJobInput): Promise<CreateInspectionJobInput> {
  const property = await getProperty(input.propertyId);
  const durationMinutes = Math.max(1, input.durationMinutes || 60);
  const scheduledEndAt =
    input.scheduledEndAt || calculatedEnd(input.scheduledAt, durationMinutes);
  return {
    ...input,
    source: input.source || 'manual',
    paymentStatus: input.paymentStatus || 'not_required',
    bookingStatus:
      input.bookingStatus || (input.scheduledAt ? 'booked' : 'awaiting_booking'),
    propertyMatchStatus: input.propertyMatchStatus || 'matched',
    priority: input.priority || 'normal',
    durationMinutes,
    ...(scheduledEndAt ? { scheduledEndAt } : {}),
    timezone: input.timezone || 'Australia/Perth',
    accessStatus:
      input.accessStatus ||
      (property?.accessDetails?.accessNotes ? 'instructions_available' : 'unknown'),
    ...(property
      ? {
          propertySnapshot:
            input.propertySnapshot || propertySnapshot(property, input.tenancyId),
          ...(property.currentLayoutVersionId
            ? { propertyLayoutVersionId: property.currentLayoutVersionId }
            : {}),
        }
      : {}),
  };
}

async function transitionInspectionJobApi(
  existing: VersionedInspectionJob,
  status: InspectionJobStatus,
  reason?: string,
): Promise<InspectionJob> {
  return apiRequest<InspectionJob>(
    existing.agencyId,
    `/api/v1/inspection-jobs/${existing.id}/transitions`,
    {
      method: 'POST',
      body: {
        status,
        expectedVersion: existing.version ?? 1,
        ...(reason ? { reason } : {}),
      },
    },
  );
}

async function transitionNewJobToRequestedStatus(
  job: VersionedInspectionJob,
  requestedStatus: InspectionJobStatus,
): Promise<InspectionJob> {
  if (requestedStatus === 'draft') return job;
  const booked = await transitionInspectionJobApi(job, 'booked');
  if (requestedStatus === 'booked') return booked;
  if (requestedStatus === 'assigned') {
    if (!booked.assignedInspectorId) {
      throw new Error('An inspector must be assigned before creating an assigned job.');
    }
    return transitionInspectionJobApi(booked as VersionedInspectionJob, 'assigned');
  }
  throw new Error('New inspection jobs may only start as draft, booked or assigned.');
}

async function transitionJobToRequestedStatus(
  job: VersionedInspectionJob,
  requestedStatus: InspectionJobStatus,
): Promise<InspectionJob> {
  if (job.status === requestedStatus) return job;
  if (job.status === 'booked' && requestedStatus === 'inspection_started') {
    if (!job.assignedInspectorId) throw new Error('Assign an inspector before starting this inspection.');
    const assigned = await transitionInspectionJobApi(job, 'assigned');
    return transitionInspectionJobApi(assigned as VersionedInspectionJob, 'inspection_started');
  }
  return transitionInspectionJobApi(job, requestedStatus);
}

export const createInspectionJob = async (
  input: CreateInspectionJobInput,
): Promise<InspectionJob> => {
  const normalised = await normaliseCreateInput(input);
  const requestedStatus = normalised.status || 'draft';

  if (cloudMode()) {
    const creationInput = { ...normalised };
    delete creationInput.status;
    const created = await apiRequest<InspectionJob>(
      normalised.agencyId,
      '/api/v1/inspection-jobs',
      {
        method: 'POST',
        body: { ...creationInput, id: generateId() },
      },
    );
    return transitionNewJobToRequestedStatus(
      created as VersionedInspectionJob,
      requestedStatus,
    );
  }

  const timestamp = new Date().toISOString();
  const inspectionJob: InspectionJob = {
    ...normalised,
    id: generateId(),
    status: requestedStatus,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await localPut('inspectionJobs', inspectionJob);
  return inspectionJob;
};

export const getInspectionJob = async (
  inspectionJobId: string,
): Promise<InspectionJob | undefined> => {
  if (cloudMode()) {
    try {
      return await apiRequest<InspectionJob>(
        undefined,
        `/api/v1/inspection-jobs/${inspectionJobId}`,
      );
    } catch (error) {
      if ((error as { code?: string }).code === 'NOT_FOUND') return undefined;
      throw error;
    }
  }
  const job = await localGet<InspectionJob>('inspectionJobs', inspectionJobId);
  return job || SAMPLE_INSPECTION_JOBS.find((item) => item.id === inspectionJobId);
};

export const listInspectionJobs = async (): Promise<InspectionJob[]> => {
  if (cloudMode()) {
    return apiRequest<InspectionJob[]>(undefined, '/api/v1/inspection-jobs?limit=100');
  }
  const localJobs = await localList<InspectionJob>('inspectionJobs');
  if (localJobs.length) return localJobs;
  for (const sampleJob of SAMPLE_INSPECTION_JOBS) {
    await localPut('inspectionJobs', sampleJob);
  }
  return SAMPLE_INSPECTION_JOBS;
};

export const updateInspectionJob = async (
  inspectionJobId: string,
  updates: Partial<Omit<InspectionJob, 'id' | 'createdAt'>>,
): Promise<InspectionJob> => {
  const existing = await getInspectionJob(inspectionJobId);
  if (!existing) throw new Error('Inspection job not found.');
  const { status: requestedStatus, ...ordinaryUpdates } = updates;
  const scheduleChanged =
    ordinaryUpdates.scheduledAt !== undefined ||
    ordinaryUpdates.scheduledEndAt !== undefined ||
    ordinaryUpdates.timezone !== undefined;
  const patch = {
    ...ordinaryUpdates,
    ...(scheduleChanged && existing.googleCalendar
      ? { lastCalendarSyncStatus: 'pending' }
      : {}),
  };

  if (cloudMode()) {
    let current: InspectionJob = existing;
    if (Object.keys(patch).length > 0) {
      current = await apiRequest<InspectionJob>(
        existing.agencyId,
        `/api/v1/inspection-jobs/${inspectionJobId}`,
        {
          method: 'PATCH',
          body: {
            ...patch,
            expectedVersion: (existing as VersionedInspectionJob).version ?? 1,
          },
        },
      );
    }
    if (requestedStatus && requestedStatus !== current.status) {
      return transitionJobToRequestedStatus(
        current as VersionedInspectionJob,
        requestedStatus,
      );
    }
    return current;
  }

  const updatedInspectionJob: InspectionJob = {
    ...existing,
    ...patch,
    ...(requestedStatus ? { status: requestedStatus } : {}),
    id: inspectionJobId,
    updatedAt: new Date().toISOString(),
  };
  await localPut('inspectionJobs', updatedInspectionJob);
  return updatedInspectionJob;
};

export const assignInspector = async (
  inspectionJobId: string,
  assignedInspectorId: string,
): Promise<InspectionJob> => {
  const updated = await updateInspectionJob(inspectionJobId, {
    assignedInspectorId,
  });
  if (updated.status === 'booked') {
    return transitionJobToRequestedStatus(
      updated as VersionedInspectionJob,
      'assigned',
    );
  }
  return updated;
};

export const assignReviewer = async (
  inspectionJobId: string,
  assignedReviewerId: string,
): Promise<InspectionJob> =>
  updateInspectionJob(inspectionJobId, { assignedReviewerId });

export interface WorkflowAction {
  action: string;
  targetStatus: string;
  label: string;
  reasonRequired: boolean;
}

export interface WorkflowBlocker {
  gate: string;
  code: string;
  message: string;
  field?: string;
}

export interface WorkflowBlockedAction {
  action: string;
  targetStatus: string;
  label: string;
  missingGates: string[];
  blockers: WorkflowBlocker[];
}

export interface InspectionJobWorkflowInfo {
  entityId: string;
  currentStatus: string;
  version: number;
  availableActions: WorkflowAction[];
  blockedActions: WorkflowBlockedAction[];
  gateContext: Record<string, boolean>;
}

export const getInspectionJobWorkflow = async (
  inspectionJobId: string,
): Promise<InspectionJobWorkflowInfo | undefined> => {
  const existing = await getInspectionJob(inspectionJobId);
  if (!existing) return undefined;
  if (cloudMode()) {
    return apiRequest<InspectionJobWorkflowInfo>(
      existing.agencyId,
      `/api/v1/inspection-jobs/${inspectionJobId}/workflow`,
    );
  }
  return {
    entityId: inspectionJobId,
    currentStatus: existing.status,
    version: (existing as VersionedInspectionJob).version ?? 1,
    availableActions: [],
    blockedActions: [],
    gateContext: {},
  };
};

export const updateInspectionJobStatus = async (
  inspectionJobId: string,
  status: InspectionJobStatus,
  reason?: string,
): Promise<InspectionJob> => {
  const existing = await getInspectionJob(inspectionJobId);
  if (!existing) throw new Error('Inspection job not found.');
  if (cloudMode()) {
    if (reason) {
      return transitionInspectionJobApi(
        existing as VersionedInspectionJob,
        status,
        reason,
      );
    }
    return transitionJobToRequestedStatus(
      existing as VersionedInspectionJob,
      status,
    );
  }
  const updatedInspectionJob: InspectionJob = {
    ...existing,
    status,
    updatedAt: new Date().toISOString(),
  };
  await localPut('inspectionJobs', updatedInspectionJob);
  return updatedInspectionJob;
};

export const deleteInspectionJob = async (
  inspectionJobId: string,
): Promise<void> => {
  const existing = await getInspectionJob(inspectionJobId);
  if (!existing) return;
  if (cloudMode()) {
    await apiRequest<InspectionJob>(
      existing.agencyId,
      `/api/v1/inspection-jobs/${inspectionJobId}/transitions`,
      {
        method: 'POST',
        body: {
          status: 'cancelled',
          expectedVersion: (existing as VersionedInspectionJob).version ?? 1,
          reason: 'inspection_job_deleted_by_operator',
        },
      },
    );
    return;
  }
  await localDelete('inspectionJobs', inspectionJobId);
};
