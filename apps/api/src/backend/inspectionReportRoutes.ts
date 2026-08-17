import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  canonicalInspectionType,
  inspectionPolicy,
  type BaselineComponentSnapshot,
  type ReportAggregate,
  type ReportLifecycleStatus,
  type ReportPhotoReference,
} from '@pcr/domain';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
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
    if (size > 5_000_000) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Inspection report creation payload exceeds 5 MB.');
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

function reportAreas(value: unknown): ReportAggregate['areas'] {
  if (!Array.isArray(value) || value.length === 0) throw new ApiError(400, 'REPORT_AREAS_REQUIRED', 'A seeded canonical area/component structure is required.');
  return value.map((area, areaIndex) => {
    if (!area || typeof area !== 'object' || Array.isArray(area)) throw new ApiError(400, 'INVALID_REPORT_AREA', `Area ${areaIndex + 1} is invalid.`);
    const rawArea = area as Record<string, unknown>;
    const id = typeof rawArea.id === 'string' && rawArea.id.trim() ? rawArea.id.trim() : '';
    const name = typeof rawArea.name === 'string' && rawArea.name.trim() ? rawArea.name.trim() : '';
    const components = Array.isArray(rawArea.components) ? rawArea.components : [];
    if (!id || !name || components.length === 0) throw new ApiError(400, 'INVALID_REPORT_AREA', `Area ${areaIndex + 1} must have a stable id, name and components.`);
    return {
      id,
      name,
      sequence: typeof rawArea.sequence === 'number' ? rawArea.sequence : areaIndex + 1,
      ...(typeof rawArea.overallCommentary === 'string' ? { overallCommentary: rawArea.overallCommentary } : {}),
      photoReferences: Array.isArray(rawArea.photoReferences) ? rawArea.photoReferences as ReportPhotoReference[] : [],
      components: components.map((component, componentIndex) => {
        if (!component || typeof component !== 'object' || Array.isArray(component)) throw new ApiError(400, 'INVALID_REPORT_COMPONENT', `Component ${componentIndex + 1} in ${name} is invalid.`);
        const raw = component as Record<string, unknown>;
        const componentId = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : '';
        const componentName = typeof raw.component === 'string' ? raw.component : typeof raw.name === 'string' ? raw.name : '';
        if (!componentId || !componentName.trim()) throw new ApiError(400, 'INVALID_REPORT_COMPONENT', `Every component in ${name} requires a stable id and name.`);
        return {
          ...raw,
          id: componentId,
          component: componentName.trim(),
          conditionCategory: typeof raw.conditionCategory === 'string' ? raw.conditionCategory : 'unable_to_confirm',
          cleanlinessCategory: typeof raw.cleanlinessCategory === 'string' ? raw.cleanlinessCategory : 'unable_to_confirm',
          workingStatus: typeof raw.workingStatus === 'string' ? raw.workingStatus : 'not_applicable',
          testStatus: typeof raw.testStatus === 'string' ? raw.testStatus : 'not_applicable',
          defects: Array.isArray(raw.defects) ? raw.defects.filter((defect): defect is string => typeof defect === 'string') : [],
          maintenanceRequired: Boolean(raw.maintenanceRequired),
          commentary: typeof raw.commentary === 'string' ? raw.commentary : '',
          photoReferences: Array.isArray(raw.photoReferences) ? raw.photoReferences as ReportPhotoReference[] : [],
          reviewStatus: typeof raw.reviewStatus === 'string' ? raw.reviewStatus : 'draft',
          comparisonStatus: typeof raw.comparisonStatus === 'string' ? raw.comparisonStatus : 'not_compared',
        } as ReportAggregate['areas'][number]['components'][number];
      }),
    };
  });
}

function templateMatches(record: Record<string, unknown>, canonicalType: string): boolean {
  const type = typeof record.inspectionType === 'string'
    ? record.inspectionType
    : typeof record.reportType === 'string'
      ? canonicalInspectionType(record.reportType)
      : '';
  return canonicalInspectionType(String(type)) === canonicalType && record.status === 'published';
}

async function resolvePublishedTemplate(dependencies: ApiDependencies, agencyId: string, canonicalType: string, actorId: string): Promise<{ id: string; version: number }> {
  const templates = await dependencies.repository.list('templates', agencyId, 100);
  const matches = templates.items
    .filter((record) => templateMatches(record, canonicalType))
    .sort((left, right) => Number(right.templateVersion ?? right.version ?? 0) - Number(left.templateVersion ?? left.version ?? 0));
  const chosen = matches[0];
  if (chosen) return { id: String(chosen.templateId ?? chosen.id), version: Number(chosen.templateVersion ?? chosen.version ?? 1) };

  const policy = inspectionPolicy(canonicalType);
  const templateId = `system-${canonicalType}-v1`;
  const existing = await dependencies.repository.get('templates', agencyId, templateId);
  if (!existing) {
    await dependencies.repository.create('templates', agencyId, templateId, {
      templateId,
      inspectionType: canonicalType,
      reportType: policy.displayName,
      name: `${policy.displayName} - System Default`,
      templateVersion: 1,
      status: 'published',
      systemDefault: true,
      publishedAt: new Date().toISOString(),
    }, actorId);
  }
  return { id: templateId, version: 1 };
}

function baselineEligible(report: Record<string, unknown>, propertyId: string, tenancyId?: string): boolean {
  if (report.propertyId !== propertyId) return false;
  if (tenancyId && report.tenancyId !== tenancyId) return false;
  if (canonicalInspectionType(String(report.reportType ?? '')) !== 'entry') return false;
  const status = String(report.lifecycleStatus ?? '') as ReportLifecycleStatus;
  if (!['approved_for_issue', 'issued_to_tenant', 'tenant_response_in_progress', 'tenant_submitted', 'agent_response_required', 'finalisation_ready', 'finalised', 'archived'].includes(status)) return false;
  return typeof report.currentVersionId === 'string' && report.currentVersionId.trim().length > 0;
}

async function resolveEntryBaseline(dependencies: ApiDependencies, agencyId: string, propertyId: string, tenancyId?: string): Promise<Record<string, unknown> | undefined> {
  const page = await dependencies.repository.list('reports', agencyId, 100);
  return page.items
    .filter((report) => baselineEligible(report, propertyId, tenancyId))
    .sort((left, right) => String(right.finalisedAt ?? right.updatedAt ?? '').localeCompare(String(left.finalisedAt ?? left.updatedAt ?? '')))[0];
}

async function loadBaselineVersion(agencyId: string, reportId: string, versionId: string): Promise<Map<string, Map<string, BaselineComponentSnapshot & { id: string }>>> {
  const database = getFirestore(adminApp());
  const versionRef = database.doc(`agencies/${agencyId}/reports/${reportId}/versions/${versionId}`);
  const versionSnapshot = await versionRef.get();
  if (!versionSnapshot.exists || versionSnapshot.get('immutable') !== true) throw new ApiError(409, 'BASELINE_VERSION_INVALID', 'The selected Entry baseline version is not immutable.');
  const areaSnapshot = await versionRef.collection('areas').get();
  const result = new Map<string, Map<string, BaselineComponentSnapshot & { id: string }>>();
  for (const areaDocument of areaSnapshot.docs) {
    const componentSnapshot = await areaDocument.ref.collection('components').get();
    const components = new Map<string, BaselineComponentSnapshot & { id: string }>();
    for (const componentDocument of componentSnapshot.docs) {
      const component = componentDocument.data() as Record<string, unknown>;
      components.set(componentDocument.id, {
        id: componentDocument.id,
        conditionCategory: component.conditionCategory as BaselineComponentSnapshot['conditionCategory'],
        cleanlinessCategory: component.cleanlinessCategory as BaselineComponentSnapshot['cleanlinessCategory'],
        workingStatus: component.workingStatus as BaselineComponentSnapshot['workingStatus'],
        testStatus: component.testStatus as BaselineComponentSnapshot['testStatus'],
        commentary: typeof component.commentary === 'string' ? component.commentary : '',
        defects: Array.isArray(component.defects) ? component.defects.filter((defect): defect is string => typeof defect === 'string') : [],
        photoReferences: Array.isArray(component.photoReferences) ? component.photoReferences as ReportPhotoReference[] : [],
      });
    }
    result.set(areaDocument.id, components);
  }
  return result;
}

function bindBaseline(areas: ReportAggregate['areas'], baseline: Map<string, Map<string, BaselineComponentSnapshot & { id: string }>>): ReportAggregate['areas'] {
  return areas.map((area) => ({
    ...area,
    components: area.components.map((component) => {
      const baselineComponent = baseline.get(area.id)?.get(component.id);
      if (!baselineComponent) {
        return { ...component, comparisonStatus: 'unable_to_compare', comparisonMethod: 'stable_id', comparisonConfidence: 0, comparisonUncertainty: 'No component with this stable identity exists in the selected Entry baseline.' };
      }
      return {
        ...component,
        baselineComponentId: baselineComponent.id,
        baselineComponentData: baselineComponent,
        baselineEvidencePhotoIds: baselineComponent.photoReferences?.map((reference) => reference.photoId) ?? [],
        comparisonMethod: 'stable_id',
        comparisonStatus: 'not_compared',
      };
    }),
  }));
}

function bindPendingLegacyBaseline(areas: ReportAggregate['areas']): ReportAggregate['areas'] {
  return areas.map((area) => ({
    ...area,
    components: area.components.map((component) => ({
      ...component,
      comparisonStatus: 'unable_to_compare',
      comparisonMethod: 'legacy_mapping',
      comparisonConfidence: 0,
      comparisonReviewStatus: 'suggested',
      comparisonUncertainty: 'Legacy Entry baseline mapping is required before this component can be compared.',
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

async function recoverDeterministicReport(dependencies: ApiDependencies, input: { agencyId: string; jobId: string; jobVersion: number; reportId: string; actorId: string }): Promise<ReportAggregate | undefined> {
  const existing = await dependencies.reports.load(input.agencyId, input.reportId);
  if (!existing) return undefined;
  if (existing.report.inspectionJobId !== input.jobId) throw new ApiError(409, 'DETERMINISTIC_REPORT_CONFLICT', 'The deterministic report identifier is already used by a different inspection job.');
  const policy = inspectionPolicy(existing.report.reportType);
  await dependencies.repository.update('inspectionJobs', input.agencyId, input.jobId, {
    reportId: existing.report.id,
    templateId: existing.report.templateId,
    templateVersion: existing.report.templateVersion,
    tenantResponseRequired: policy.tenantReviewDefault,
    ...(existing.report.baselineReportId ? { baselineReportId: existing.report.baselineReportId } : {}),
    ...(existing.report.baselineReportVersionId ? { baselineReportVersionId: existing.report.baselineReportVersionId } : {}),
  }, input.jobVersion, input.actorId);
  return existing;
}

export async function routeInspectionReportRequest(req: IncomingMessage, dependencies: ApiDependencies, correlationId: string): Promise<ApiResponse | undefined> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'api' || parts[1] !== 'v1' || parts[2] !== 'inspection-jobs' || !parts[3] || parts[4] !== 'create-report') return undefined;
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
  if (!expectedJobVersion || expectedJobVersion !== job.version) throw new ApiError(409, 'VERSION_CONFLICT', 'Inspection job changed before report creation. Reload and retry.');

  const reportId = `report-${jobId}`;
  const recovered = await recoverDeterministicReport(dependencies, { agencyId, jobId, jobVersion: expectedJobVersion, reportId, actorId: principal.uid });
  if (recovered) {
    await dependencies.audit.append({
      id: randomUUID(), timestamp: new Date().toISOString(), actorId: principal.uid, actorRole: principal.role, agencyId,
      capability: 'job.manage', outcome: 'allowed', reason: 'inspection_report_link_recovered', target: { agencyId, inspectionJobId: jobId, reportId }, correlationId,
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
  const template = await resolvePublishedTemplate(dependencies, agencyId, canonicalType, principal.uid);
  let areas = reportAreas(body.areas);

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

  const tenantNames = Array.isArray(tenancy?.tenantNames) ? tenancy.tenantNames.filter((name): name is string => typeof name === 'string') : [];
  const legacyMappingId = legacyPlaceholder ? `legacy-${reportId}` : undefined;
  const aggregate: ReportAggregate = {
    report: {
      id: reportId,
      agencyId,
      propertyId,
      ...(tenancyId ? { tenancyId } : {}),
      inspectionJobId: jobId,
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
    tenantResponseRequired: policy.tenantReviewDefault,
    ...(baseline ? { baselineReportId: baseline.id, baselineReportVersionId: baseline.currentVersionId } : legacyMappingId ? { baselineReportId: `legacy:${legacyMappingId}`, baselineReportVersionId: legacyMappingId } : {}),
  }, expectedJobVersion, principal.uid);

  await dependencies.audit.append({
    id: randomUUID(), timestamp: new Date().toISOString(), actorId: principal.uid, actorRole: principal.role, agencyId,
    capability: 'job.manage', outcome: 'allowed', reason: `inspection_report_created:${canonicalType}${legacyPlaceholder ? ':legacy_baseline_pending' : ''}`,
    target: { agencyId, propertyId, ...(tenancyId ? { tenancyId } : {}), inspectionJobId: jobId, reportId }, correlationId,
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
        ...(baseline ? { baselineReportId: baseline.id, baselineReportVersionId: baseline.currentVersionId } : legacyMappingId ? { legacyBaselineMappingId: legacyMappingId } : {}),
      },
    },
  };
}
