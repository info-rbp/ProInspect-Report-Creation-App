import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import {
  canonicalInspectionType,
  validateLegacyMapping,
  type LegacyBaselineComponentMapping,
  type LegacyBaselineMappingRecord,
  type LegacyBaselineSource,
  type ReportAggregate,
} from '@pcr/domain';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies } from './types.js';

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 2_000_000) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Legacy baseline mapping payload exceeds 2 MB.');
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Object required');
    return parsed as Record<string, unknown>;
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }
}

function agencyHeader(req: IncomingMessage): string {
  const agencyId = req.headers['x-agency-id']?.toString().trim();
  if (!agencyId) throw new ApiError(400, 'AGENCY_HEADER_REQUIRED', 'x-agency-id is required.');
  return agencyId;
}

function expectedVersion(body: Record<string, unknown>): number {
  const value = body.expectedVersion;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new ApiError(400, 'EXPECTED_VERSION_REQUIRED', 'expectedVersion must be a positive integer.');
  return value;
}

function source(value: unknown): LegacyBaselineSource {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'LEGACY_SOURCE_REQUIRED', 'Legacy baseline source provenance is required.');
  const raw = value as Record<string, unknown>;
  const sourceType = typeof raw.sourceType === 'string' ? raw.sourceType : '';
  const sourceId = typeof raw.sourceId === 'string' ? raw.sourceId.trim() : '';
  const sourceName = typeof raw.sourceName === 'string' ? raw.sourceName.trim() : '';
  if (!sourceId || !sourceName || !['pdf', 'document', 'manual'].includes(sourceType)) throw new ApiError(400, 'LEGACY_SOURCE_INVALID', 'Legacy source requires sourceId, sourceName and a supported sourceType.');
  const sourceSha256 = typeof raw.sourceSha256 === 'string' ? raw.sourceSha256.trim().toLowerCase() : undefined;
  if (sourceSha256 && !/^[a-f0-9]{64}$/u.test(sourceSha256)) throw new ApiError(400, 'LEGACY_SOURCE_HASH_INVALID', 'sourceSha256 must be a SHA-256 hash.');
  return {
    sourceId,
    sourceName,
    sourceType: sourceType as LegacyBaselineSource['sourceType'],
    ...(typeof raw.sourceObjectPath === 'string' && raw.sourceObjectPath.trim() ? { sourceObjectPath: raw.sourceObjectPath.trim() } : {}),
    ...(sourceSha256 ? { sourceSha256 } : {}),
    ...(typeof raw.sourceDate === 'string' && raw.sourceDate.trim() ? { sourceDate: raw.sourceDate.trim() } : {}),
  };
}

function mappings(value: unknown): LegacyBaselineComponentMapping[] {
  if (!Array.isArray(value) || value.length === 0) throw new ApiError(400, 'LEGACY_MAPPINGS_REQUIRED', 'At least one reviewed legacy component mapping is required.');
  const seen = new Set<string>();
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new ApiError(400, 'LEGACY_MAPPING_INVALID', `Legacy mapping ${index + 1} is invalid.`);
    const mapping = structuredClone(item) as LegacyBaselineComponentMapping;
    try { validateLegacyMapping(mapping); } catch (error) { throw new ApiError(400, 'LEGACY_MAPPING_INVALID', error instanceof Error ? error.message : `Legacy mapping ${index + 1} is invalid.`); }
    const key = `${mapping.areaId}::${mapping.componentId}`;
    if (seen.has(key)) throw new ApiError(400, 'LEGACY_MAPPING_DUPLICATE', `Component ${key} is mapped more than once.`);
    seen.add(key);
    if (mapping.baseline.workingStatus === 'operation_confirmed' && mapping.baseline.testStatus !== 'tested_passed') {
      throw new ApiError(400, 'LEGACY_OPERATION_UNSUPPORTED', `Legacy mapping ${key} cannot confirm operation without tested_passed evidence.`);
    }
    if (mapping.baseline.workingStatus === 'not_working' && mapping.baseline.testStatus !== 'tested_failed') {
      throw new ApiError(400, 'LEGACY_FAILURE_UNSUPPORTED', `Legacy mapping ${key} cannot record not_working without tested_failed evidence.`);
    }
    return mapping;
  });
}

function bindMappings(aggregate: ReportAggregate, reviewedMappings: LegacyBaselineComponentMapping[]): ReportAggregate['areas'] {
  const byTarget = new Map(reviewedMappings.map((mapping) => [`${mapping.areaId}::${mapping.componentId}`, mapping]));
  const existingTargets = new Set<string>();
  const areas = aggregate.areas.map((area) => ({
    ...area,
    components: area.components.map((component) => {
      const key = `${area.id}::${component.id}`;
      existingTargets.add(key);
      const mapping = byTarget.get(key);
      if (!mapping) {
        return {
          ...component,
          baselineComponentId: undefined,
          baselineComponentData: undefined,
          baselineEvidencePhotoIds: [],
          comparisonStatus: 'unable_to_compare' as const,
          comparisonMethod: 'legacy_mapping' as const,
          comparisonConfidence: 0,
          comparisonReviewStatus: 'suggested' as const,
          comparisonUncertainty: 'No reviewed legacy baseline mapping was supplied for this component.',
        };
      }
      const evidence = mapping.evidenceReferences ?? mapping.baseline.photoReferences ?? [];
      return {
        ...component,
        baselineComponentId: `legacy:${mapping.sourceAreaLabel}:${mapping.sourceComponentLabel}`,
        baselineComponentData: { ...mapping.baseline, photoReferences: evidence },
        baselineEvidencePhotoIds: evidence.map((reference) => reference.photoId),
        comparisonStatus: 'not_compared' as const,
        comparisonMethod: mapping.mappingMethod,
        comparisonConfidence: mapping.confidence,
        comparisonReviewStatus: 'suggested' as const,
        comparisonUncertainty: mapping.reviewNote || 'Legacy baseline is unstructured and requires human review of any comparison.',
      };
    }),
  }));
  const unknown = [...byTarget.keys()].filter((key) => !existingTargets.has(key));
  if (unknown.length) throw new ApiError(400, 'LEGACY_MAPPING_TARGET_UNKNOWN', `Legacy mappings target unknown stable components: ${unknown.join(', ')}`);
  return areas;
}

export async function routeLegacyBaselineRequest(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
): Promise<ApiResponse | undefined> {
  const parts = new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean);
  if (parts[0] !== 'api' || parts[1] !== 'v1' || parts[2] !== 'reports' || !parts[3] || parts[4] !== 'legacy-baseline') return undefined;
  if (req.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Legacy baseline mapping requires POST.');
  const agencyId = agencyHeader(req);
  const reportId = parts[3];
  const aggregate = await dependencies.reports.load(agencyId, reportId);
  if (!aggregate) throw new ApiError(404, 'REPORT_NOT_FOUND', 'Exit report not found.');
  if (canonicalInspectionType(aggregate.report.reportType) !== 'exit') throw new ApiError(409, 'EXIT_REPORT_REQUIRED', 'Legacy Entry mapping can only be applied to an Exit Inspection.');
  if (aggregate.report.baselineQuality !== 'legacy_unstructured') throw new ApiError(409, 'LEGACY_BASELINE_NOT_ENABLED', 'This Exit report is not in the legacy baseline mapping workflow.');
  if (!['draft', 'changes_requested'].includes(aggregate.report.lifecycleStatus)) throw new ApiError(409, 'REPORT_CONTENT_LOCKED', 'Legacy baseline mapping can only be changed while report content is editable.');

  const body = await readJson(req);
  const version = expectedVersion(body);
  if (aggregate.report.version !== version) throw new ApiError(409, 'VERSION_CONFLICT', 'Exit report changed before the legacy baseline mapping was saved. Reload and retry.');
  const principal = await authenticateAndAuthorise(req, dependencies, 'report.edit', {
    agencyId,
    propertyId: aggregate.report.propertyId,
    ...(aggregate.report.tenancyId ? { tenancyId: aggregate.report.tenancyId } : {}),
    reportId,
    lifecycleStatus: aggregate.report.lifecycleStatus,
  }, correlationId);

  const legacySource = source(body.source);
  const reviewedMappings = mappings(body.mappings);
  const mappingId = aggregate.report.baselineReportVersionId || `legacy-${reportId}`;
  const now = new Date().toISOString();
  const mappingRecord: LegacyBaselineMappingRecord = {
    id: mappingId,
    agencyId,
    exitReportId: reportId,
    propertyId: aggregate.report.propertyId,
    ...(aggregate.report.tenancyId ? { tenancyId: aggregate.report.tenancyId } : {}),
    source: legacySource,
    mappings: reviewedMappings,
    reviewedBy: principal.uid,
    reviewedAt: now,
    createdAt: now,
  };
  const existing = await dependencies.repository.get('legacyBaselineMappings', agencyId, mappingId);
  if (existing) await dependencies.repository.update('legacyBaselineMappings', agencyId, mappingId, mappingRecord as unknown as Record<string, unknown>, existing.version, principal.uid);
  else await dependencies.repository.create('legacyBaselineMappings', agencyId, mappingId, mappingRecord as unknown as Record<string, unknown>, principal.uid);

  const stored = await dependencies.reports.saveDraft({
    report: {
      ...aggregate.report,
      baselineReportId: `legacy:${legacySource.sourceId}`,
      baselineReportVersionId: mappingId,
      baselineQuality: 'legacy_unstructured',
    },
    areas: bindMappings(aggregate, reviewedMappings),
  }, version, principal.uid);

  await dependencies.audit.append({
    id: randomUUID(), timestamp: now, actorId: principal.uid, actorRole: principal.role, agencyId,
    capability: 'report.edit', outcome: 'allowed', reason: 'legacy_baseline_mapping_saved',
    target: { agencyId, propertyId: aggregate.report.propertyId, ...(aggregate.report.tenancyId ? { tenancyId: aggregate.report.tenancyId } : {}), reportId },
    correlationId, entityType: 'report', entityId: reportId, eventType: 'report.legacy_baseline_mapped',
    metadata: { mappingId, sourceId: legacySource.sourceId, mappedComponents: reviewedMappings.length, baselineQuality: 'legacy_unstructured' },
  });
  return { status: existing ? 200 : 201, body: { data: stored, meta: { correlationId, mappingId, mappedComponents: reviewedMappings.length } } };
}
