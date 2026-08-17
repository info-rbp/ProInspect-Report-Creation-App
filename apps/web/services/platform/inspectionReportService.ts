import type {
  LegacyBaselineComponentMapping,
  LegacyBaselineSource,
  ReportAggregate,
} from '@pcr/domain';
import type { ReportData, Room } from '../../types';
import type { InspectionJob, PropertyRecord } from '../../types/platform';
import { apiRequest } from '../apiClient';
import { seedRoomsFromProperty } from './propertySeedingService';

function roomAreas(rooms: Room[]): ReportAggregate['areas'] {
  return rooms.map((room, index) => ({
    id: room.id,
    name: room.name,
    sequence: index + 1,
    overallCommentary: room.overallComment || '',
    photoReferences: (room.photos || []).flatMap((photo, photoIndex) => {
      const objectPath = photo.objectPath || photo.downloadUrl;
      if (!objectPath) return [];
      return [{
        photoId: photo.id,
        objectPath,
        ...(photo.thumbnailObjectPath ? { thumbnailObjectPath: photo.thumbnailObjectPath } : {}),
        sequence: photoIndex + 1,
      }];
    }),
    components: room.items.map((item) => ({
      id: item.id,
      component: item.name,
      ...(item.subComponent ? { subComponent: item.subComponent } : {}),
      ...(item.material ? { material: item.material } : {}),
      ...(item.colour ? { colour: item.colour } : {}),
      ...(item.type ? { type: item.type } : {}),
      ...(typeof item.quantity === 'number' ? { quantity: item.quantity } : {}),
      conditionCategory: item.conditionCategory,
      cleanlinessCategory: item.cleanlinessCategory,
      workingStatus: item.workingStatus,
      testStatus: item.testStatus,
      defects: item.defects || [],
      maintenanceRequired: item.maintenanceRequired,
      commentary: item.comment || '',
      photoReferences: item.photoReferences || [],
      ...(typeof item.aiConfidence === 'number' ? { aiConfidence: item.aiConfidence } : {}),
      reviewStatus: item.reviewStatus || 'draft',
      comparisonStatus: item.comparisonStatus || 'not_compared',
      ...(item.presenceComparison ? { presenceComparison: item.presenceComparison } : {}),
      ...(item.conditionComparison ? { conditionComparison: item.conditionComparison } : {}),
      ...(item.cleanlinessComparison ? { cleanlinessComparison: item.cleanlinessComparison } : {}),
      ...(item.workingComparison ? { workingComparison: item.workingComparison } : {}),
      ...(item.comparisonCommentary ? { comparisonCommentary: item.comparisonCommentary } : {}),
      ...(item.baselineComponentId ? { baselineComponentId: item.baselineComponentId } : {}),
      ...(item.baselineComponentData ? { baselineComponentData: item.baselineComponentData } : {}),
      ...(item.baselineEvidencePhotoIds ? { baselineEvidencePhotoIds: item.baselineEvidencePhotoIds } : {}),
      ...(item.currentEvidencePhotoIds ? { currentEvidencePhotoIds: item.currentEvidencePhotoIds } : {}),
      ...(item.evidencePairs ? { evidencePairs: item.evidencePairs } : {}),
      ...(typeof item.comparisonConfidence === 'number' ? { comparisonConfidence: item.comparisonConfidence } : {}),
      ...(item.comparisonUncertainty ? { comparisonUncertainty: item.comparisonUncertainty } : {}),
      ...(item.comparisonReviewStatus ? { comparisonReviewStatus: item.comparisonReviewStatus } : {}),
      ...(item.comparisonMethod ? { comparisonMethod: item.comparisonMethod } : {}),
    })),
  }));
}

export async function createInspectionReportForJob(
  job: InspectionJob,
  property: PropertyRecord,
  options: { clientName?: string; inspectionDate?: string; allowLegacyBaseline?: boolean } = {},
): Promise<ReportAggregate> {
  if (!job.version) throw new Error('Inspection job version is required. Reload the job before creating its report.');
  const rooms = seedRoomsFromProperty(property);
  return apiRequest<ReportAggregate>(job.agencyId, `/api/v1/inspection-jobs/${encodeURIComponent(job.id)}/create-report`, {
    method: 'POST',
    body: {
      expectedJobVersion: job.version,
      reportType: job.reportType,
      clientName: options.clientName || '',
      inspectionDate: options.inspectionDate || new Date().toISOString().slice(0, 10),
      ...(options.allowLegacyBaseline ? { allowLegacyBaseline: true } : {}),
      areas: roomAreas(rooms),
    },
  });
}

export async function saveLegacyBaselineMapping(
  report: Pick<ReportData, 'id' | 'agencyId' | 'version'>,
  source: LegacyBaselineSource,
  mappings: LegacyBaselineComponentMapping[],
): Promise<ReportAggregate> {
  if (!report.version) throw new Error('Current report version is required before saving a legacy baseline mapping.');
  return apiRequest<ReportAggregate>(report.agencyId, `/api/v1/reports/${encodeURIComponent(report.id)}/legacy-baseline`, {
    method: 'POST',
    body: { expectedVersion: report.version, source, mappings },
  });
}

export function aggregateToReportData(aggregate: ReportAggregate): ReportData {
  return {
    id: aggregate.report.id,
    agencyId: aggregate.report.agencyId,
    propertyId: aggregate.report.propertyId,
    tenancyId: aggregate.report.tenancyId,
    inspectionJobId: aggregate.report.inspectionJobId,
    lifecycleStatus: aggregate.report.lifecycleStatus,
    currentVersionId: aggregate.report.currentVersionId,
    templateId: aggregate.report.templateId,
    templateVersion: aggregate.report.templateVersion,
    propertyAddress: aggregate.report.propertyAddress,
    agentName: '',
    agentCompany: '',
    clientName: aggregate.report.clientName || '',
    inspectionDate: aggregate.report.inspectionDate || new Date().toISOString().slice(0, 10),
    tenantName: aggregate.report.tenantName || '',
    reportType: aggregate.report.reportType,
    baselineReportId: aggregate.report.baselineReportId,
    baselineReportVersionId: aggregate.report.baselineReportVersionId,
    baselineInspectionJobId: aggregate.report.baselineInspectionJobId,
    baselineTemplateId: aggregate.report.baselineTemplateId,
    baselineTemplateVersion: aggregate.report.baselineTemplateVersion,
    baselineQuality: aggregate.report.baselineQuality,
    rooms: aggregate.areas.map((area) => ({
      id: area.id,
      name: area.name,
      status: 'draft',
      overallComment: area.overallCommentary || '',
      isExpanded: true,
      photos: [],
      items: area.components.map((component) => ({
        id: component.id,
        name: component.component,
        subComponent: component.subComponent,
        material: component.material,
        colour: component.colour,
        type: component.type,
        quantity: component.quantity,
        conditionCategory: component.conditionCategory,
        cleanlinessCategory: component.cleanlinessCategory,
        workingStatus: component.workingStatus,
        testStatus: component.testStatus,
        defects: component.defects,
        maintenanceRequired: component.maintenanceRequired,
        comment: component.commentary,
        photoReferences: component.photoReferences,
        aiConfidence: component.aiConfidence,
        reviewStatus: component.reviewStatus,
        comparisonStatus: component.comparisonStatus,
        presenceComparison: component.presenceComparison,
        conditionComparison: component.conditionComparison,
        cleanlinessComparison: component.cleanlinessComparison,
        workingComparison: component.workingComparison,
        comparisonCommentary: component.comparisonCommentary,
        baselineComponentId: component.baselineComponentId,
        baselineComponentData: component.baselineComponentData,
        baselineEvidencePhotoIds: component.baselineEvidencePhotoIds,
        currentEvidencePhotoIds: component.currentEvidencePhotoIds,
        evidencePairs: component.evidencePairs,
        comparisonConfidence: component.comparisonConfidence,
        comparisonUncertainty: component.comparisonUncertainty,
        comparisonReviewStatus: component.comparisonReviewStatus,
        comparisonMethod: component.comparisonMethod,
      })),
    })),
    version: aggregate.report.version,
    createdAt: aggregate.report.createdAt,
    updatedAt: aggregate.report.updatedAt,
  };
}
