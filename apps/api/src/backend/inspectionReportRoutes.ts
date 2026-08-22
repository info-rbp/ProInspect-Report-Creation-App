import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  canonicalComponentOccurrenceIdentity,
  canonicalInspectionType,
  canonicalSemanticComponentIdentity,
  inspectionPolicy,
  type BaselineComponentSnapshot,
  type ReportAggregate,
  type ReportLifecycleStatus,
  type ReportPhotoReference,
} from '@pcr/domain';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import {
  REPORT_STRUCTURE_RESOLUTION_VERSION,
  resolveAuthoritativeReportStructure,
  resolvePublishedInspectionTemplate,
} from '../services/reportStructureResolutionService.js';
import { routeSpecialisedCloseoutRequest } from './specialisedCloseoutRoutesMounted.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies } from './types.js';

function adminApp() {
  return getApps()[0] ?? initializeApp({ credential: applicationDefault() });
}

function agencyHeader(req: IncomingMessage): string {
  const agencyId = req.headers['x-agency-id']?.toString().trim();
  if (!agencyId) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.');
  return agencyId;
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Inspection report creation payload exceeds 1 MB.');
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required');
    return value as Record<string, unknown>;
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }
}

function baselineEligible(report: Record<string, unknown>, propertyId: string, tenancyId?: string): boolean {
  if (report.propertyId !== propertyId) return false;
  if (tenancyId && report.tenancyId !== tenancyId) return false;
  if (canonicalInspectionType(String(report.reportType ?? '')) !== 'entry') return false;
  const status = String(report.lifecycleStatus ?? '') as ReportLifecycleStatus;
  if (![
    'approved_for_issue',
    'issued_to_tenant',
    'tenant_response_in_progress',
    'tenant_submitted',
    'agent_response_required',
    'finalisation_ready',
    'finalised',
    'archived',
  ].includes(status)) return false;
  return typeof report.currentVersionId === 'string' && report.currentVersionId.trim().length > 0;
}

async function resolveEntryBaseline(
  dependencies: ApiDependencies,
  agencyId: string,
  propertyId: string,
  tenancyId?: string,
): Promise<Record<string, unknown> | undefined> {
  const page = await dependencies.repository.list('reports', agencyId, 100);
  return page.items
    .filter((report) => baselineEligible(report, propertyId, tenancyId))
    .sort((left, right) => String(right.finalisedAt ?? right.updatedAt ?? '').localeCompare(String(left.finalisedAt ?? left.updatedAt ?? '')))[0];
}

interface IndexedBaselineComponent extends BaselineComponentSnapshot {
  id: string;
  areaId: string;
  canonicalAreaDefinitionId?: string;
  canonicalAreaDefinitionVersion?: number;
  canonicalComponentDefinitionId?: string;
  canonicalComponentDefinitionVersion?: number;
}

interface BaselineIndex {
  byOccurrence: Map<string, IndexedBaselineComponent>;
  byLegacyInstance: Map<string, IndexedBaselineComponent>;
  bySemantic: Map<string, IndexedBaselineComponent>;
  ambiguousSemantic: Set<string>;
}

async function loadBaselineVersion(
  agencyId: string,
  reportId: string,
  versionId: string,
): Promise<BaselineIndex> {
  const database = getFirestore(adminApp());
  const versionRef = database.doc(`agencies/${agencyId}/reports/${reportId}/versions/${versionId}`);
  const versionSnapshot = await versionRef.get();
  if (!versionSnapshot.exists || versionSnapshot.get('immutable') !== true) {
    throw new ApiError(409, 'BASELINE_VERSION_INVALID', 'The selected Entry baseline version is not immutable.');
  }

  const result: BaselineIndex = {
    byOccurrence: new Map(),
    byLegacyInstance: new Map(),
    bySemantic: new Map(),
    ambiguousSemantic: new Set(),
  };
  const areaSnapshot = await versionRef.collection('areas').get();
  for (const areaDocument of areaSnapshot.docs) {
    const area = areaDocument.data() as Record<string, unknown>;
    const areaId = String(area.id ?? areaDocument.id);
    const canonicalAreaDefinitionId = typeof area.canonicalAreaDefinitionId === 'string'
      ? area.canonicalAreaDefinitionId
      : undefined;
    const canonicalAreaDefinitionVersion = typeof area.canonicalAreaDefinitionVersion === 'number'
      ? area.canonicalAreaDefinitionVersion
      : undefined;
    const componentSnapshot = await areaDocument.ref.collection('components').get();
    for (const componentDocument of componentSnapshot.docs) {
      const component = componentDocument.data() as Record<string, unknown>;
      const indexed: IndexedBaselineComponent = {
        id: String(component.id ?? componentDocument.id),
        areaId,
        ...(canonicalAreaDefinitionId ? { canonicalAreaDefinitionId } : {}),
        ...(canonicalAreaDefinitionVersion ? { canonicalAreaDefinitionVersion } : {}),
        ...(typeof component.canonicalComponentDefinitionId === 'string'
          ? { canonicalComponentDefinitionId: component.canonicalComponentDefinitionId }
          : {}),
        ...(typeof component.canonicalComponentDefinitionVersion === 'number'
          ? { canonicalComponentDefinitionVersion: component.canonicalComponentDefinitionVersion }
          : {}),
        conditionCategory: (component.conditionCategory ?? 'unable_to_confirm') as BaselineComponentSnapshot['conditionCategory'],
        cleanlinessCategory: (component.cleanlinessCategory ?? 'unable_to_confirm') as BaselineComponentSnapshot['cleanlinessCategory'],
        workingStatus: (component.workingStatus ?? 'not_applicable') as BaselineComponentSnapshot['workingStatus'],
        testStatus: (component.testStatus ?? 'not_applicable') as BaselineComponentSnapshot['testStatus'],
        commentary: typeof component.commentary === 'string' ? component.commentary : '',
        defects: Array.isArray(component.defects)
          ? component.defects.filter((defect): defect is string => typeof defect === 'string')
          : [],
        photoReferences: Array.isArray(component.photoReferences)
          ? component.photoReferences as ReportPhotoReference[]
          : [],
      };

      result.byLegacyInstance.set(`${areaId}|${indexed.id}`, indexed);
      const occurrence = canonicalComponentOccurrenceIdentity({
        id: areaId,
        canonicalAreaDefinitionId,
        canonicalAreaDefinitionVersion,
      }, indexed);
      if (occurrence) result.byOccurrence.set(occurrence, indexed);

      const semantic = canonicalSemanticComponentIdentity({
        id: areaId,
        canonicalAreaDefinitionId,
        canonicalAreaDefinitionVersion,
      }, indexed);
      if (semantic) {
        if (result.bySemantic.has(semantic)) {
          result.ambiguousSemantic.add(semantic);
          result.bySemantic.delete(semantic);
        } else if (!result.ambiguousSemantic.has(semantic)) {
          result.bySemantic.set(semantic, indexed);
        }
      }
    }
  }
  return result;
}

function findBaselineComponent(
  area: ReportAggregate['areas'][number],
  component: ReportAggregate['areas'][number]['components'][number],
  baseline: BaselineIndex,
): { component?: IndexedBaselineComponent; method: 'stable_id' | 'explicit_mapping'; ambiguity?: string } {
  const occurrence = canonicalComponentOccurrenceIdentity(area, component);
  if (occurrence) {
    const match = baseline.byOccurrence.get(occurrence);
    if (match) return { component: match, method: 'stable_id' };
  }

  const legacy = baseline.byLegacyInstance.get(`${area.id}|${component.id}`);
  if (legacy) return { component: legacy, method: 'stable_id' };

  const semantic = canonicalSemanticComponentIdentity(area, component);
  if (semantic) {
    if (baseline.ambiguousSemantic.has(semantic)) {
      return {
        method: 'explicit_mapping',
        ambiguity: 'Multiple Entry baseline occurrences share this canonical Area/Component identity. Manual occurrence mapping is required.',
      };
    }
    const match = baseline.bySemantic.get(semantic);
    if (match) return { component: match, method: 'explicit_mapping' };
  }
  return { method: 'explicit_mapping' };
}

function bindBaseline(areas: ReportAggregate['areas'], baseline: BaselineIndex): ReportAggregate['areas'] {
  return areas.map((area) => ({
    ...area,
    components: area.components.map((component) => {
      const match = findBaselineComponent(area, component, baseline);
      const baselineComponent = match.component;
      if (!baselineComponent) {
        return {
          ...component,
          comparisonStatus: 'unable_to_compare' as const,
          comparisonMethod: match.method,
          comparisonConfidence: 0,
          comparisonReviewStatus: 'suggested' as const,
          comparisonUncertainty: match.ambiguity ?? 'No component with a compatible canonical identity exists in the selected Entry baseline.',
        };
      }
      return {
        ...component,
        baselineComponentId: baselineComponent.id,
        baselineComponentData: baselineComponent,
        baselineEvidencePhotoIds: baselineComponent.photoReferences?.map((reference) => reference.photoId) ?? [],
        comparisonMethod: match.method,
        comparisonConfidence: match.method === 'stable_id' ? 1 : 0.9,
        comparisonStatus: 'not_compared' as const,
      };
    }),
  }));
}

function bindPendingLegacyBaseline(areas: ReportAggregate['areas']): ReportAggregate['areas'] {
  return areas.map((area) => ({
    ...area,
    components: area.components.map((component) => ({
      ...component,
      comparisonStatus: 'unable_to_compare' as const,
      comparisonMethod: 'legacy_mapping' as const,
      comparisonConfidence: 0,
      comparisonReviewStatus: 'suggested' as const,
      comparisonUncertainty: 'Legacy Entry baseline mapping is required before this canonical component can be compared.',
    })),
  }));
}

function propertyAddress(property: Record<string, unknown>): string {
  return [property.address, property.suburb, property.state, property.postcode]
    .filter((value): value is string | number => typeof value === 'string' || typeof value === 'number')
    .map(String)
    .filter((value) => value.trim())
    .join(', ') || 'Property';
}

async function recoverDeterministicReport(
  dependencies: ApiDependencies,
  input: { agencyId: string; jobId: string; jobVersion: number; reportId: string; actorId: string },
): Promise<ReportAggregate | undefined> {
  const existing = await dependencies.reports.load(input.agencyId, input.reportId);
  if (!existing) return undefined;
  if (existing.report.inspectionJobId !== input.jobId) {
    throw new ApiError(409, 'DETERMINISTIC_REPORT_CONFLICT', 'The deterministic report identifier is already used by a different inspection job.');
  }
  const policy = inspectionPolicy(existing.report.reportType);
  await dependencies.repository.update('inspectionJobs', input.agencyId, input.jobId, {
    reportId: existing.report.id,
    templateId: existing.report.templateId,
    templateVersion: existing.report.templateVersion,
    propertyLayoutVersionId: existing.report.propertyLayoutVersionId,
    tenantResponseRequired: policy.tenantReviewDefault,
    ...(existing.report.baselineReportId ? { baselineReportId: existing.report.baselineReportId } : {}),
    ...(existing.report.baselineReportVersionId ? { baselineReportVersionId: existing.report.baselineReportVersionId } : {}),
  }, input.jobVersion, input.actorId);
  return existing;
}

export async function routeInspectionReportRequest(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
): Promise<ApiResponse | undefined> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  const isCreateReport = parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'inspection-jobs' && Boolean(parts[3]) && parts[4] === 'create-report';
  if (!isCreateReport) return routeSpecialisedCloseoutRequest(req, dependencies, correlationId);
  if (req.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Create-report endpoint requires POST.');

  const agencyId = agencyHeader(req);
  const jobId = parts[3];
  const job = await dependencies.repository.get('inspectionJobs', agencyId, jobId);
  if (!job) throw new ApiError(404, 'JOB_NOT_FOUND', 'Inspection job not found.');
  const principal = await authenticateAndAuthorise(req, dependencies, 'job.manage', {
    agencyId,
    inspectionJobId: jobId,
    ...(typeof job.propertyId === 'string' ? { propertyId: job.propertyId } : {}),
    ...(typeof job.tenancyId === 'string' ? { tenancyId: job.tenancyId } : {}),
    ...(typeof job.assignedInspectorId === 'string' ? { assignedInspectorId: job.assignedInspectorId } : {}),
    ...(typeof job.assignedReviewerId === 'string' ? { assignedReviewerId: job.assignedReviewerId } : {}),
  }, correlationId);

  if (typeof job.reportId === 'string' && job.reportId.trim()) {
    const existing = await dependencies.reports.load(agencyId, job.reportId);
    if (!existing) throw new ApiError(409, 'LINKED_REPORT_MISSING', 'Inspection job references a report that cannot be loaded. Repair the link before creating another report.');
    return { status: 200, body: { data: existing, meta: { correlationId, existing: true } } };
  }

  const body = await readJson(req);
  const expectedJobVersion = typeof body.expectedJobVersion === 'number' ? body.expectedJobVersion : undefined;
  if (!expectedJobVersion || expectedJobVersion !== job.version) {
    throw new ApiError(409, 'VERSION_CONFLICT', 'Inspection job changed before report creation. Reload and retry.');
  }

  const reportId = `report-${jobId}`;
  const recovered = await recoverDeterministicReport(dependencies, {
    agencyId,
    jobId,
    jobVersion: expectedJobVersion,
    reportId,
    actorId: principal.uid,
  });
  if (recovered) {
    await dependencies.audit.append({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      actorId: principal.uid,
      actorRole: principal.role,
      agencyId,
      capability: 'job.manage',
      outcome: 'allowed',
      reason: 'inspection_report_link_recovered',
      target: { agencyId, inspectionJobId: jobId, reportId },
      correlationId,
    });
    return { status: 200, body: { data: recovered, meta: { correlationId, existing: true, recovered: true } } };
  }

  const propertyId = typeof job.propertyId === 'string' ? job.propertyId : '';
  if (!propertyId) throw new ApiError(422, 'PROPERTY_REQUIRED', 'Inspection job has no linked property.');
  const property = await dependencies.repository.get('properties', agencyId, propertyId);
  if (!property) throw new ApiError(404, 'PROPERTY_NOT_FOUND', 'Linked property not found.');

  const tenancyId = typeof job.tenancyId === 'string' ? job.tenancyId : undefined;
  const tenancy = tenancyId ? await dependencies.repository.get('tenancies', agencyId, tenancyId) : undefined;
  if (tenancyId && !tenancy) throw new ApiError(404, 'TENANCY_NOT_FOUND', 'Linked tenancy not found.');

  const canonicalType = canonicalInspectionType(String(job.reportType ?? body.reportType ?? 'Property Condition Report'));
  const policy = inspectionPolicy(canonicalType);
  const template = await resolvePublishedInspectionTemplate(dependencies, agencyId, canonicalType, property, principal.uid);
  const resolved = await resolveAuthoritativeReportStructure(dependencies, {
    agencyId,
    inspectionType: canonicalType,
    propertyRecord: property,
    template,
  });
  let areas = resolved.areas;

  let baseline: Record<string, unknown> | undefined;
  let legacyPlaceholder = false;
  if (policy.requiresBaseline && canonicalType === 'exit') {
    baseline = await resolveEntryBaseline(dependencies, agencyId, propertyId, tenancyId);
    if (!baseline) {
      if (body.allowLegacyBaseline !== true) {
        throw new ApiError(422, 'ENTRY_BASELINE_REQUIRED', 'Exit Inspection requires an eligible immutable Entry Property Condition Report linked to the same property and tenancy. If only a legacy/unstructured Entry report exists, explicitly start the reviewed legacy mapping workflow.');
      }
      legacyPlaceholder = true;
      areas = bindPendingLegacyBaseline(areas);
    } else {
      areas = bindBaseline(areas, await loadBaselineVersion(agencyId, String(baseline.id), String(baseline.currentVersionId)));
    }
  }

  const tenantNames = Array.isArray(tenancy?.tenantNames)
    ? tenancy.tenantNames.filter((name): name is string => typeof name === 'string')
    : [];
  const legacyMappingId = legacyPlaceholder ? `legacy-${reportId}` : undefined;
  const aggregate: ReportAggregate = {
    report: {
      id: reportId,
      agencyId,
      propertyId,
      ...(tenancyId ? { tenancyId } : {}),
      inspectionJobId: jobId,
      propertyLayoutVersionId: resolved.propertyLayoutVersion.id,
      structureResolutionVersion: REPORT_STRUCTURE_RESOLUTION_VERSION,
      templateStructureMode: template.structureMode,
      ...(resolved.propertyLayoutVersion.canonicalCatalogueId
        ? { canonicalCatalogueId: resolved.propertyLayoutVersion.canonicalCatalogueId }
        : {}),
      ...(resolved.propertyLayoutVersion.canonicalCatalogueVersion
        ? { canonicalCatalogueVersion: resolved.propertyLayoutVersion.canonicalCatalogueVersion }
        : {}),
      reportType: policy.displayName,
      propertyAddress: propertyAddress(property),
      clientName: typeof body.clientName === 'string' ? body.clientName : '',
      tenantName: tenantNames.join(', '),
      inspectionDate: typeof body.inspectionDate === 'string' ? body.inspectionDate : new Date().toISOString().slice(0, 10),
      lifecycleStatus: 'draft',
      templateId: template.id,
      templateVersion: template.version,
      ...(baseline ? {
        baselineReportId: String(baseline.id),
        baselineReportVersionId: String(baseline.currentVersionId),
        ...(typeof baseline.inspectionJobId === 'string' ? { baselineInspectionJobId: baseline.inspectionJobId } : {}),
        ...(typeof baseline.templateId === 'string' ? { baselineTemplateId: baseline.templateId } : {}),
        ...(typeof baseline.templateVersion === 'number' ? { baselineTemplateVersion: baseline.templateVersion } : {}),
        baselineQuality: 'structured' as const,
      } : legacyMappingId ? {
        baselineReportId: `legacy:${legacyMappingId}`,
        baselineReportVersionId: legacyMappingId,
        baselineQuality: 'legacy_unstructured' as const,
      } : {}),
    },
    areas,
  };

  const stored = await dependencies.reports.saveDraft(aggregate, undefined, principal.uid);
  await dependencies.repository.update('inspectionJobs', agencyId, jobId, {
    reportId,
    templateId: template.id,
    templateVersion: template.version,
    propertyLayoutVersionId: resolved.propertyLayoutVersion.id,
    tenantResponseRequired: policy.tenantReviewDefault,
    ...(baseline ? {
      baselineReportId: baseline.id,
      baselineReportVersionId: baseline.currentVersionId,
    } : legacyMappingId ? {
      baselineReportId: `legacy:${legacyMappingId}`,
      baselineReportVersionId: legacyMappingId,
    } : {}),
  }, expectedJobVersion, principal.uid);

  await dependencies.audit.append({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    actorId: principal.uid,
    actorRole: principal.role,
    agencyId,
    capability: 'job.manage',
    outcome: 'allowed',
    reason: `inspection_report_created:${canonicalType}${legacyPlaceholder ? ':legacy_baseline_pending' : ''}`,
    target: {
      agencyId,
      propertyId,
      ...(tenancyId ? { tenancyId } : {}),
      inspectionJobId: jobId,
      reportId,
    },
    correlationId,
    metadata: {
      propertyLayoutVersionId: resolved.propertyLayoutVersion.id,
      structureResolutionVersion: REPORT_STRUCTURE_RESOLUTION_VERSION,
      templateStructureMode: template.structureMode,
      templateId: template.id,
      templateVersion: template.version,
      canonicalCatalogueId: resolved.propertyLayoutVersion.canonicalCatalogueId ?? null,
      canonicalCatalogueVersion: resolved.propertyLayoutVersion.canonicalCatalogueVersion ?? null,
      clientSuppliedStructureIgnored: Array.isArray(body.areas),
    },
  });

  return {
    status: 201,
    body: {
      data: stored,
      meta: {
        correlationId,
        inspectionType: canonicalType,
        templateId: template.id,
        templateVersion: template.version,
        propertyLayoutVersionId: resolved.propertyLayoutVersion.id,
        structureResolutionVersion: REPORT_STRUCTURE_RESOLUTION_VERSION,
        templateStructureMode: template.structureMode,
        ...(baseline ? {
          baselineReportId: baseline.id,
          baselineReportVersionId: baseline.currentVersionId,
        } : legacyMappingId ? { legacyBaselineMappingId: legacyMappingId } : {}),
      },
    },
  };
}
