import { generateId } from '../../utils';
import type { ReportData } from '../../types';
import type { InspectionJob, ReportIndex, ReportLifecycleStatus } from '../../types/platform';
import { apiRequest } from '../apiClient';
import { isFirebaseConfigured, saveReportToDB } from '../storageService';
import { getInspectionJob, updateInspectionJob } from './inspectionJobService';
import { localGet, localList, localPut } from './localPlatformStore';
import { transitionReportLifecycle } from './reportWorkflowService';

function cloudMode(): boolean {
  return Boolean(isFirebaseConfigured() && import.meta.env.VITE_API_BASE_URL?.trim());
}

export const upsertReportIndexFromReport = async (report: ReportData): Promise<ReportIndex> => {
  if (cloudMode()) {
    const authoritative = await apiRequest<ReportIndex>(report.agencyId, `/api/v1/reports/${encodeURIComponent(report.id)}`);
    return authoritative;
  }

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
  await localPut('reportIndexes', reportIndex);
  return reportIndex;
};

/**
 * Local/demo-only helper retained for backwards compatibility. Cloud deployments must create
 * operational reports through the server-authoritative Inspection Job create-report command.
 */
export const createReportForInspectionJob = async (
  inspectionJobId: string,
  reportInput: Omit<ReportData, 'id' | 'rooms'> & Partial<Pick<ReportData, 'id' | 'rooms'>>,
): Promise<ReportIndex> => {
  if (cloudMode()) {
    throw new Error('Cloud reports must be created from the Inspection Job console so Property, tenancy, Template Version, layout version and Entry baseline are bound server-side.');
  }
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
  if (cloudMode()) {
    try {
      return await apiRequest<ReportIndex>(undefined, `/api/v1/reports/${encodeURIComponent(reportId)}`);
    } catch (error) {
      if ((error as { code?: string }).code === 'NOT_FOUND') return undefined;
      throw error;
    }
  }
  return localGet<ReportIndex>('reportIndexes', reportId);
};

export const listReportIndexes = async (): Promise<ReportIndex[]> => {
  if (cloudMode()) return apiRequest<ReportIndex[]>(undefined, '/api/v1/reports');
  return localList<ReportIndex>('reportIndexes');
};

export const updateReportLifecycleStatus = async (
  reportId: string,
  lifecycleStatus: ReportLifecycleStatus,
): Promise<ReportIndex> => {
  const existing = await getReportIndex(reportId);
  if (!existing) throw new Error('Report index not found.');
  if (cloudMode()) {
    const transitioned = await transitionReportLifecycle(
      existing.agencyId || '',
      reportId,
      lifecycleStatus,
      (existing as ReportIndex & { version?: number }).version ?? 1,
    );
    return transitioned as unknown as ReportIndex;
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
