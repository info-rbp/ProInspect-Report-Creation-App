import { generateId } from '../../utils';
import type { InspectionJob, InspectionJobStatus } from '../../types/platform';
import { apiRequest } from '../apiClient';
import { isFirebaseConfigured } from '../storageService';
import { localDelete, localGet, localList, localPut } from './localPlatformStore';

export type CreateInspectionJobInput = Omit<InspectionJob, 'id' | 'status' | 'createdAt' | 'updatedAt'> &
  Partial<Pick<InspectionJob, 'status'>>;
type VersionedInspectionJob = InspectionJob & { version?: number };

const SAMPLE_INSPECTION_JOBS: InspectionJob[] = [
  {
    id: 'job-sample-01',
    agencyId: 'proinspect-agency',
    propertyId: 'prop-sample-01',
    reportType: 'Property Condition Report',
    scheduledAt: new Date(Date.now() + 86400000 * 2).toISOString(),
    assignedInspectorId: 'David Taylor (Senior Inspector)',
    assignedReviewerId: 'Sarah Connor (Review Manager)',
    status: 'booked',
    notes: 'Entry inspection before new tenancy starts. Key lockbox code: 4821.',
    googleDriveFolderId: 'folder_drive_01',
    shopifyOrderId: 'SHP-98421',
    createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 1).toISOString(),
  },
  {
    id: 'job-sample-02',
    agencyId: 'proinspect-agency',
    propertyId: 'prop-sample-02',
    reportType: 'Routine Inspection',
    scheduledAt: new Date(Date.now() - 86400000 * 1).toISOString(),
    assignedInspectorId: 'Emily Watson (Field Inspector)',
    assignedReviewerId: 'Sarah Connor (Review Manager)',
    status: 'inspection_started',
    notes: '6-month routine inspection. Check kitchen sink seals and balcony drainage.',
    createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 4).toISOString(),
  },
  {
    id: 'job-sample-03',
    agencyId: 'proinspect-agency',
    propertyId: 'prop-sample-03',
    reportType: 'Exit Inspection',
    scheduledAt: new Date(Date.now() - 86400000 * 4).toISOString(),
    assignedInspectorId: 'David Taylor (Senior Inspector)',
    assignedReviewerId: 'Michael Scott (Operations Lead)',
    status: 'review_required',
    notes: 'Outgoing tenant exit inspection. Comparing against initial Entry PCR.',
    createdAt: new Date(Date.now() - 86400000 * 7).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 12).toISOString(),
  },
  {
    id: 'job-sample-04',
    agencyId: 'proinspect-agency',
    propertyId: 'prop-sample-01',
    reportType: 'Maintenance and Follow-Up Report',
    scheduledAt: new Date(Date.now() - 86400000 * 10).toISOString(),
    assignedInspectorId: 'James Bond (Property Analyst)',
    assignedReviewerId: 'Sarah Connor (Review Manager)',
    status: 'finalised',
    notes: 'Follow up on repaired bathroom tiles.',
    createdAt: new Date(Date.now() - 86400000 * 12).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 9).toISOString(),
  },
];

function cloudMode(): boolean {
  return isFirebaseConfigured() && Boolean(import.meta.env.VITE_API_BASE_URL?.trim());
}

async function transitionInspectionJobApi(
  existing: VersionedInspectionJob,
  status: InspectionJobStatus,
  reason?: string,
): Promise<InspectionJob> {
  return apiRequest<InspectionJob>(existing.agencyId, `/api/v1/inspection-jobs/${existing.id}/transitions`, {
    method: 'POST',
    body: {
      status,
      expectedVersion: existing.version ?? 1,
      ...(reason ? { reason } : {}),
    },
  });
}

async function transitionNewJobToRequestedStatus(
  job: VersionedInspectionJob,
  requestedStatus: InspectionJobStatus,
): Promise<InspectionJob> {
  if (requestedStatus === 'draft') return job;

  let current = await transitionInspectionJobApi(job, 'booked');
  if (requestedStatus === 'booked') return current;

  if (requestedStatus === 'assigned') {
    if (!current.assignedInspectorId) {
      throw new Error('An inspector must be assigned before creating an inspection job in the assigned state.');
    }
    return transitionInspectionJobApi(current as VersionedInspectionJob, 'assigned');
  }

  throw new Error('New inspection jobs may only be created as draft, booked or assigned.');
}

async function transitionJobToRequestedStatus(
  job: VersionedInspectionJob,
  requestedStatus: InspectionJobStatus,
): Promise<InspectionJob> {
  if (job.status === requestedStatus) return job;

  // Existing UI flows may start a booked inspection immediately after linking its report.
  // Traverse the authoritative intermediate state rather than bypassing the state machine.
  if (job.status === 'booked' && requestedStatus === 'inspection_started') {
    if (!job.assignedInspectorId) {
      throw new Error('Assign an inspector before starting this inspection.');
    }
    const assigned = await transitionInspectionJobApi(job, 'assigned');
    return transitionInspectionJobApi(assigned as VersionedInspectionJob, 'inspection_started');
  }

  return transitionInspectionJobApi(job, requestedStatus);
}

export const createInspectionJob = async (input: CreateInspectionJobInput): Promise<InspectionJob> => {
  const requestedStatus = input.status || 'draft';

  if (cloudMode()) {
    try {
      const { status: _ignoredStatus, ...creationInput } = input;
      const created = await apiRequest<InspectionJob>(input.agencyId, '/api/v1/inspection-jobs', {
        method: 'POST',
        body: { ...creationInput, id: generateId() },
      });
      return transitionNewJobToRequestedStatus(created as VersionedInspectionJob, requestedStatus);
    } catch (err) {
      console.warn('API createInspectionJob failed, storing locally:', err);
    }
  }

  const timestamp = new Date().toISOString();
  const inspectionJob: InspectionJob = {
    ...input,
    id: generateId(),
    status: requestedStatus,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await localPut('inspectionJobs', inspectionJob);
  return inspectionJob;
};

export const getInspectionJob = async (inspectionJobId: string): Promise<InspectionJob | undefined> => {
  if (cloudMode()) {
    try {
      return await apiRequest<InspectionJob>(undefined, `/api/v1/inspection-jobs/${inspectionJobId}`);
    } catch (error) {
      if ((error as { code?: string }).code === 'NOT_FOUND') return undefined;
      console.warn('API getInspectionJob failed, getting locally:', error);
    }
  }
  const job = await localGet<InspectionJob>('inspectionJobs', inspectionJobId);
  if (job) return job;
  return SAMPLE_INSPECTION_JOBS.find((item) => item.id === inspectionJobId);
};

export const listInspectionJobs = async (): Promise<InspectionJob[]> => {
  if (cloudMode()) {
    try {
      return await apiRequest<InspectionJob[]>(undefined, '/api/v1/inspection-jobs');
    } catch {
      // Fall through to local development data.
    }
  }
  const localJobs = await localList<InspectionJob>('inspectionJobs');
  if (localJobs.length === 0) {
    for (const sampleJob of SAMPLE_INSPECTION_JOBS) await localPut('inspectionJobs', sampleJob);
    return SAMPLE_INSPECTION_JOBS;
  }
  return localJobs;
};

export const updateInspectionJob = async (
  inspectionJobId: string,
  updates: Partial<Omit<InspectionJob, 'id' | 'createdAt'>>,
): Promise<InspectionJob> => {
  const existing = await getInspectionJob(inspectionJobId);
  if (!existing) throw new Error('Inspection job not found.');

  const { status: requestedStatus, ...ordinaryUpdates } = updates;

  if (cloudMode()) {
    let current: InspectionJob = existing;

    if (Object.keys(ordinaryUpdates).length > 0) {
      current = await apiRequest<InspectionJob>(existing.agencyId, `/api/v1/inspection-jobs/${inspectionJobId}`, {
        method: 'PATCH',
        body: { ...ordinaryUpdates, expectedVersion: (existing as VersionedInspectionJob).version ?? 1 },
      });
    }

    if (requestedStatus && requestedStatus !== current.status) {
      return transitionJobToRequestedStatus(current as VersionedInspectionJob, requestedStatus);
    }

    return current;
  }

  const updatedInspectionJob: InspectionJob = {
    ...existing,
    ...ordinaryUpdates,
    ...(requestedStatus ? { status: requestedStatus } : {}),
    id: inspectionJobId,
    updatedAt: new Date().toISOString(),
  };
  await localPut('inspectionJobs', updatedInspectionJob);
  return updatedInspectionJob;
};

export const assignInspector = async (inspectionJobId: string, assignedInspectorId: string): Promise<InspectionJob> => {
  const updated = await updateInspectionJob(inspectionJobId, { assignedInspectorId });
  if (updated.status === 'booked') return transitionJobToRequestedStatus(updated as VersionedInspectionJob, 'assigned');
  return updated;
};

export const assignReviewer = async (inspectionJobId: string, assignedReviewerId: string): Promise<InspectionJob> =>
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

export const getInspectionJobWorkflow = async (inspectionJobId: string): Promise<InspectionJobWorkflowInfo | undefined> => {
  const existing = await getInspectionJob(inspectionJobId);
  if (!existing) return undefined;

  if (cloudMode()) {
    try {
      return await apiRequest<InspectionJobWorkflowInfo>(existing.agencyId, `/api/v1/inspection-jobs/${inspectionJobId}/workflow`);
    } catch (err) {
      console.warn('API getInspectionJobWorkflow failed:', err);
    }
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
    if (reason) return transitionInspectionJobApi(existing as VersionedInspectionJob, status, reason);
    return transitionJobToRequestedStatus(existing as VersionedInspectionJob, status);
  }

  const updatedInspectionJob: InspectionJob = {
    ...existing,
    status,
    updatedAt: new Date().toISOString(),
  };
  await localPut('inspectionJobs', updatedInspectionJob);
  return updatedInspectionJob;
};

export const deleteInspectionJob = async (inspectionJobId: string): Promise<void> => {
  const existing = await getInspectionJob(inspectionJobId);
  if (!existing) return;
  if (cloudMode()) {
    try {
      await apiRequest<InspectionJob>(existing.agencyId, `/api/v1/inspection-jobs/${inspectionJobId}/transitions`, {
        method: 'POST',
        body: {
          status: 'cancelled',
          expectedVersion: (existing as VersionedInspectionJob).version ?? 1,
          reason: 'inspection_job_deleted_by_operator',
        },
      });
      return;
    } catch (err) {
      console.warn('API cancellation failed; preserving the cloud inspection job:', err);
      throw err;
    }
  }
  await localDelete('inspectionJobs', inspectionJobId);
};
