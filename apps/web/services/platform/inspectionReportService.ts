import type {
  LegacyBaselineComponentMapping,
  LegacyBaselineSource,
  ReportAggregate,
} from '@pcr/domain';
import type { ReportData } from '../../types';
import type { InspectionJob, PropertyRecord } from '../../types/platform';
import { apiRequest } from '../apiClient';
import { snapshotReportClientContext } from './clientManagementService';

export async function createInspectionReportForJob(
  job: InspectionJob,
  property: PropertyRecord,
  options: { clientName?: string; inspectionDate?: string; allowLegacyBaseline?: boolean } = {},
): Promise<ReportAggregate> {
  if (!job.version) throw new Error('Inspection job version is required. Reload the job before creating its report.');
  const aggregate = await apiRequest<ReportAggregate>(job.agencyId, `/api/v1/inspection-jobs/${encodeURIComponent(job.id)}/create-report`, {
    method: 'POST',
    body: {
      expectedJobVersion: job.version,
      reportType: job.reportType,
      clientName: options.clientName || job.clientSnapshot?.clientName || '',
      inspectionDate: options.inspectionDate || new Date().toISOString().slice(0, 10),
      ...(options.allowLegacyBaseline ? { allowLegacyBaseline: true } : {}),
    },
  });
  if (!job.clientSnapshot && !property.clientIds.length) return aggregate;
  try {
    const metadata = await snapshotReportClientContext(aggregate.report.id);
    return { ...aggregate, report: { ...aggregate.report, ...(metadata as ReportAggregate['report']) } };
  } catch (failure) {
    console.warn('Report created but Client context snapshot requires attention:', failure);
    return aggregate;
  }
}

export async function saveLegacyBaselineMapping(
  report: Pick<ReportData, 'id' | 'agencyId' | 'version'>,
  source: LegacyBaselineSource,
  mappings: LegacyBaselineComponentMapping[],
): Promise<ReportAggregate> {
  if (!report.version) throw new Error('Current report version is required before saving a legacy baseline mapping.');
  return apiRequest<ReportAggregate>(report.agencyId, `/api/v1/reports/${encodeURIComponent(report.id)}/legacy-baseline`, {
    method: 'POST', body: { expectedVersion: report.version, source, mappings },
  });
}

export function aggregateToReportData(aggregate: ReportAggregate): ReportData {
  return {
    id: aggregate.report.id,
    agencyId: aggregate.report.agencyId,
    propertyId: aggregate.report.propertyId,
    tenancyId: aggregate.report.tenancyId,
    inspectionJobId: aggregate.report.inspectionJobId,
    propertyLayoutVersionId: aggregate.report.propertyLayoutVersionId,
    structureResolutionVersion: aggregate.report.structureResolutionVersion,
    templateStructureMode: aggregate.report.templateStructureMode,
    canonicalCatalogueId: aggregate.report.canonicalCatalogueId,
    canonicalCatalogueVersion: aggregate.report.canonicalCatalogueVersion,
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
      canonicalAreaDefinitionId: area.canonicalAreaDefinitionId,
      canonicalAreaDefinitionVersion: area.canonicalAreaDefinitionVersion,
      templateAreaReferenceId: area.templateAreaReferenceId,
      status: area.components.every((component) => component.reviewStatus === 'reviewer_approved') ? 'complete' : 'draft',
      overallComment: area.overallCommentary || '',
      isExpanded: true,
      photos: [],
      items: area.components.map((component) => ({
        id: component.id,
        name: component.component,
        canonicalComponentDefinitionId: component.canonicalComponentDefinitionId,
        canonicalComponentDefinitionVersion: component.canonicalComponentDefinitionVersion,
        canonicalAreaComponentRuleId: component.canonicalAreaComponentRuleId,
        canonicalAreaComponentRuleVersion: component.canonicalAreaComponentRuleVersion,
        requirementSnapshot: component.requirementSnapshot,
        subComponent: component.subComponent,
        material: component.material,
        colour: component.colour,
        type: component.type,
        quantity: component.quantity,
        conditionCategory: component.conditionCategory,
        cleanlinessCategory: component.cleanlinessCategory,
        workingStatus: component.workingStatus,
        testStatus: component.testStatus,
        testRecord: component.testRecord,
        defects: component.defects,
        maintenanceRequired: component.maintenanceRequired,
        comment: component.commentary,
        photoReferences: component.photoReferences,
        aiConfidence: component.aiConfidence,
        aiSuggestion: component.aiSuggestion,
        authoritativeSource: component.authoritativeSource,
        lastReviewedBy: component.lastReviewedBy,
        lastReviewedAt: component.lastReviewedAt,
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
