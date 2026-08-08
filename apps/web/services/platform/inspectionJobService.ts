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

export const createInspectionJob = async (input: CreateInspectionJobInput): Promise<InspectionJob> => {
  if (isFirebaseConfigured() && import.meta.env.VITE_API_BASE_URL?.trim()) {
    try {
      return await apiRequest<InspectionJob>(input.agencyId, '/api/v1/inspection-jobs', {
        method: 'POST',
        body: { ...input, id: generateId(), status: input.status || 'draft' },
      });
    } catch (err) {
      console.warn('API createInspectionJob failed, storing locally:', err);
    }
  }
  const timestamp = new Date().toISOString();
  const inspectionJob: InspectionJob = { ...input, id: generateId(), status: input.status || 'draft', createdAt: timestamp, updatedAt: timestamp };
  await localPut('inspectionJobs', inspectionJob);
  return inspectionJob;
};

export const getInspectionJob = async (inspectionJobId: string): Promise<InspectionJob | undefined> => {
  if (isFirebaseConfigured() && import.meta.env.VITE_API_BASE_URL?.trim()) {
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
  if (isFirebaseConfigured() && import.meta.env.VITE_API_BASE_URL?.trim()) {
    try {
      return await apiRequest<InspectionJob[]>(undefined, '/api/v1/inspection-jobs');
    } catch {
      // Fall through
    }
  }
  const localJobs = await localList<InspectionJob>('inspectionJobs');
  if (localJobs.length === 0) {
    for (const sampleJob of SAMPLE_INSPECTION_JOBS) {
      await localPut('inspectionJobs', sampleJob);
    }
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
  if (isFirebaseConfigured() && import.meta.env.VITE_API_BASE_URL?.trim()) {
    try {
      return await apiRequest<InspectionJob>(existing.agencyId, `/api/v1/inspection-jobs/${inspectionJobId}`, {
        method: 'PATCH',
        body: { ...updates, expectedVersion: (existing as VersionedInspectionJob).version ?? 1 },
      });
    } catch (err) {
      console.warn('API updateInspectionJob failed, updating locally:', err);
    }
  }
  const updatedInspectionJob: InspectionJob = { ...existing, ...updates, id: inspectionJobId, updatedAt: new Date().toISOString() };
  await localPut('inspectionJobs', updatedInspectionJob);
  return updatedInspectionJob;
};

export const assignInspector = async (inspectionJobId: string, assignedInspectorId: string): Promise<InspectionJob> =>
  updateInspectionJob(inspectionJobId, { assignedInspectorId, status: 'assigned' });

export const assignReviewer = async (inspectionJobId: string, assignedReviewerId: string): Promise<InspectionJob> =>
  updateInspectionJob(inspectionJobId, { assignedReviewerId });

export const updateInspectionJobStatus = async (
  inspectionJobId: string,
  status: InspectionJobStatus,
): Promise<InspectionJob> => {
  const existing = await getInspectionJob(inspectionJobId);
  if (!existing) throw new Error('Inspection job not found.');
  if (isFirebaseConfigured() && import.meta.env.VITE_API_BASE_URL?.trim()) {
    try {
      return await apiRequest<InspectionJob>(existing.agencyId, `/api/v1/inspection-jobs/${inspectionJobId}/transitions`, {
        method: 'POST',
        body: { status, expectedVersion: (existing as VersionedInspectionJob).version ?? 1 },
      });
    } catch (err) {
      console.warn('API updateInspectionJobStatus failed, updating status locally:', err);
    }
  }
  return updateInspectionJob(inspectionJobId, { status });
};

export const deleteInspectionJob = async (inspectionJobId: string): Promise<void> => {
  const existing = await getInspectionJob(inspectionJobId);
  if (!existing) return;
  if (isFirebaseConfigured() && import.meta.env.VITE_API_BASE_URL?.trim()) {
    try {
      await apiRequest<void>(existing.agencyId, `/api/v1/inspection-jobs/${inspectionJobId}`, {
        method: 'DELETE',
      });
    } catch (err) {
      console.warn('API deleteInspectionJob failed, deleting locally:', err);
    }
  }
  await localDelete('inspectionJobs', inspectionJobId);
};
