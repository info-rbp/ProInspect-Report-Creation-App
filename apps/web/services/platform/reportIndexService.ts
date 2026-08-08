import { generateId } from '../../utils';
import type { ReportData } from '../../types';
import type { InspectionJob, ReportIndex, ReportLifecycleStatus } from '../../types/platform';
import { apiRequest } from '../apiClient';
import { isFirebaseConfigured, saveReportToDB } from '../storageService';
import { getInspectionJob, updateInspectionJob } from './inspectionJobService';
import { localGet, localList, localPut } from './localPlatformStore';

type VersionedReportIndex = ReportIndex & { version?: number };

function reportIndexCommand(reportIndex: ReportIndex): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...reportIndex };
  delete payload.id;
  delete payload.createdAt;
  delete payload.updatedAt;
  return payload;
}

export const upsertReportIndexFromReport = async (report: ReportData): Promise<ReportIndex> => {
  const timestamp = new Date().toISOString();
  const existing = await getReportIndex(report.id);
  const reportIndex: ReportIndex = {
    id: existing?.id || report.id,
    reportId: report.id,
    agencyId: report.agencyId,
    propertyId: report.propertyId,
    tenancyId: report.tenancyId,
    inspectionJobId: report.inspectionJobId,
    reportType: report.reportType,
    propertyAddress: report.propertyAddress,
    clientName: report.clientName,
    tenantName: report.tenantName,
    inspectionDate: report.inspectionDate,
    lifecycleStatus: report.lifecycleStatus || existing?.lifecycleStatus || 'draft',
    ownerUid: report.ownerUid,
    createdAt: existing?.createdAt || report.createdAt || timestamp,
    updatedAt: timestamp,
  };
  if (isFirebaseConfigured() && import.meta.env.VITE_API_BASE_URL?.trim()) {
    try {
      if (existing) {
        return await apiRequest<ReportIndex>(report.agencyId, `/api/v1/reports/${report.id}`, {
          method: 'PATCH',
          body: { ...reportIndexCommand(reportIndex), expectedVersion: (existing as VersionedReportIndex).version ?? 1 },
        });
      }
      return await apiRequest<ReportIndex>(report.agencyId, '/api/v1/reports', {
        method: 'POST',
        body: { id: report.id, ...reportIndexCommand(reportIndex) },
      });
    } catch (err) {
      console.warn('API upsertReportIndexFromReport failed, saving locally:', err);
    }
  }
  await localPut('reportIndexes', reportIndex);
  return reportIndex;
};

export const createReportForInspectionJob = async (
  inspectionJobId: string,
  reportInput: Omit<ReportData, 'id' | 'rooms'> & Partial<Pick<ReportData, 'id' | 'rooms'>>,
): Promise<ReportIndex> => {
  const inspectionJob = await getInspectionJob(inspectionJobId);
  if (!inspectionJob) throw new Error('Inspection job not found.');
  const report: ReportData = {
    ...reportInput,
    id: reportInput.id || generateId(),
    agencyId: reportInput.agencyId || inspectionJob.agencyId,
    propertyId: reportInput.propertyId || inspectionJob.propertyId,
    tenancyId: reportInput.tenancyId || inspectionJob.tenancyId,
    inspectionJobId,
    lifecycleStatus: reportInput.lifecycleStatus || 'draft',
    rooms: reportInput.rooms || [],
  };
  const savedReport = await saveReportToDB(report);
  const reportIndex = await upsertReportIndexFromReport(savedReport);
  await updateInspectionJob(inspectionJobId, { reportId: savedReport.id });
  return reportIndex;
};

export const getReportIndex = async (reportId: string): Promise<ReportIndex | undefined> => {
  if (isFirebaseConfigured() && import.meta.env.VITE_API_BASE_URL?.trim()) {
    try {
      return await apiRequest<ReportIndex>(undefined, `/api/v1/reports/${reportId}`);
    } catch (error) {
      if ((error as { code?: string }).code === 'NOT_FOUND') return undefined;
      console.warn('API getReportIndex failed, getting locally:', error);
    }
  }
  return localGet<ReportIndex>('reportIndexes', reportId);
};

export const listReportIndexes = async (): Promise<ReportIndex[]> => {
  if (isFirebaseConfigured() && import.meta.env.VITE_API_BASE_URL?.trim()) {
    try {
      return await apiRequest<ReportIndex[]>(undefined, '/api/v1/reports');
    } catch (err) {
      console.warn('API listReportIndexes failed, listing locally:', err);
    }
  }
  return localList<ReportIndex>('reportIndexes');
};

export const updateReportLifecycleStatus = async (
  reportId: string,
  lifecycleStatus: ReportLifecycleStatus,
): Promise<ReportIndex> => {
  const existing = await getReportIndex(reportId);
  if (!existing) throw new Error('Report index not found.');
  if (isFirebaseConfigured() && import.meta.env.VITE_API_BASE_URL?.trim()) {
    try {
      return await apiRequest<ReportIndex>(existing.agencyId, `/api/v1/reports/${reportId}/transitions`, {
        method: 'POST',
        body: { status: lifecycleStatus, expectedVersion: (existing as VersionedReportIndex).version ?? 1 },
      });
    } catch (err) {
      console.warn('API updateReportLifecycleStatus failed, updating locally:', err);
    }
  }
  const updatedReportIndex: ReportIndex = { ...existing, lifecycleStatus, updatedAt: new Date().toISOString() };
  await localPut('reportIndexes', updatedReportIndex);
  return updatedReportIndex;
};

export const buildReportIndexFromInspectionJob = (
  inspectionJob: InspectionJob,
  reportId: string,
  report: Pick<ReportData, 'propertyAddress' | 'clientName' | 'tenantName' | 'inspectionDate'>,
): ReportIndex => {
  const timestamp = new Date().toISOString();
  return {
    id: reportId,
    reportId,
    agencyId: inspectionJob.agencyId,
    propertyId: inspectionJob.propertyId,
    tenancyId: inspectionJob.tenancyId,
    inspectionJobId: inspectionJob.id,
    reportType: inspectionJob.reportType,
    propertyAddress: report.propertyAddress,
    clientName: report.clientName,
    tenantName: report.tenantName,
    inspectionDate: report.inspectionDate,
    lifecycleStatus: 'draft',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};
