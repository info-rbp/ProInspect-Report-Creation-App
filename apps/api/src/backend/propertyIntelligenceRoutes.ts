import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import type {
  AuthenticatedPrincipal,
  HistoricalExtractedFinding,
  HistoricalMappingCandidate,
  PropertyDocument,
  PropertyFloorPlanHotspot,
  RoomConfigItem,
} from '@pcr/domain';
import { authenticateAndAuthorise } from '../security/authoriseRequest.js';
import {
  extractHistoricalPropertyDocument,
  PROPERTY_DOCUMENT_MODEL,
  PROPERTY_DOCUMENT_PROMPT_VERSION,
} from '../services/propertyDocumentIntelligenceService.js';
import { ApiError, type ApiResponse } from './router.js';
import type { ApiDependencies, StoredRecord } from './types.js';

const MAX_AI_DOCUMENT_BYTES = 25 * 1024 * 1024;
const HISTORICAL_REPORT_TYPES = new Set([
  'entry_report',
  'routine_report',
  'exit_report',
  'maintenance_report',
  'comparison_report',
]);

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
    if (size > 2_000_000) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Property intelligence command exceeds 2 MB.');
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required');
    return parsed as Record<string, unknown>;
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }
}

function positiveVersion(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new ApiError(400, 'EXPECTED_VERSION_REQUIRED', `${field} must be a positive integer.`);
  }
  return value;
}

function documents(property: StoredRecord): PropertyDocument[] {
  return Array.isArray(property.documents)
    ? property.documents.filter((item): item is PropertyDocument => Boolean(item && typeof item === 'object'))
    : [];
}

function rooms(property: StoredRecord): RoomConfigItem[] {
  return Array.isArray(property.roomsConfig)
    ? property.roomsConfig.filter((item): item is RoomConfigItem => Boolean(item && typeof item === 'object'))
    : [];
}

function findDocument(property: StoredRecord, documentId: string): PropertyDocument {
  const document = documents(property).find((item) => item.id === documentId);
  if (!document) throw new ApiError(404, 'PROPERTY_DOCUMENT_NOT_FOUND', 'Property document was not found.');
  return document;
}

function deterministicAnalysisId(document: PropertyDocument): string {
  return `property-analysis-${createHash('sha256')
    .update(`${document.id}:${document.sha256 || ''}:${PROPERTY_DOCUMENT_PROMPT_VERSION}:${PROPERTY_DOCUMENT_MODEL}`)
    .digest('hex')
    .slice(0, 32)}`;
}

function candidates(findings: HistoricalExtractedFinding[]): HistoricalMappingCandidate[] {
  return findings.map((finding) => ({
    id: finding.id,
    sourceLabel: `${finding.sourceArea} / ${finding.sourceComponent}`,
    ...(finding.proposedAreaId ? { proposedAreaId: finding.proposedAreaId } : {}),
    ...(finding.proposedComponentId ? { proposedComponentId: finding.proposedComponentId } : {}),
    ...(finding.proposedCanonicalAreaDefinitionId ? {
      proposedCanonicalAreaDefinitionId: finding.proposedCanonicalAreaDefinitionId,
      proposedCanonicalAreaDefinitionVersion: finding.proposedCanonicalAreaDefinitionVersion,
    } : {}),
    ...(finding.proposedCanonicalComponentDefinitionId ? {
      proposedCanonicalComponentDefinitionId: finding.proposedCanonicalComponentDefinitionId,
      proposedCanonicalComponentDefinitionVersion: finding.proposedCanonicalComponentDefinitionVersion,
    } : {}),
    confidence: finding.confidence,
    status: finding.decision,
    ...(finding.uncertainty ? { reviewerNote: finding.uncertainty } : {}),
  }));
}

function floorPlanHotspots(value: unknown, currentRooms: RoomConfigItem[]): PropertyFloorPlanHotspot[] {
  if (!Array.isArray(value)) throw new ApiError(400, 'FLOOR_PLAN_HOTSPOTS_INVALID', 'hotspots must be an array.');
  const roomById = new Map(currentRooms.map((area) => [area.id, area]));
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new ApiError(400, 'FLOOR_PLAN_HOTSPOT_INVALID', `Hotspot ${index + 1} is invalid.`);
    }
    const raw = item as Record<string, unknown>;
    const areaId = typeof raw.areaId === 'string' ? raw.areaId.trim() : '';
    const area = roomById.get(areaId);
    if (!area) {
      throw new ApiError(400, 'FLOOR_PLAN_AREA_INVALID', `Hotspot ${index + 1} must reference a current configured property area.`);
    }
    const number = (field: string, fallback: number): number => {
      const candidate = raw[field];
      return typeof candidate === 'number' && Number.isFinite(candidate)
        ? Math.max(0, Math.min(100, candidate))
        : fallback;
    };
    return {
      id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `hotspot-${randomUUID()}`,
      areaId,
      areaName: typeof raw.areaName === 'string' && raw.areaName.trim() ? raw.areaName.trim() : area.name,
      ...(area.canonicalAreaDefinitionId ? {
        canonicalAreaDefinitionId: area.canonicalAreaDefinitionId,
        canonicalAreaDefinitionVersion: area.canonicalAreaDefinitionVersion,
      } : {}),
      x: number('x', 0),
      y: number('y', 0),
      width: Math.max(2, number('width', 12)),
      height: Math.max(2, number('height', 8)),
      ...(typeof raw.label === 'string' && raw.label.trim() ? { label: raw.label.trim().slice(0, 120) } : {}),
    };
  });
}

function reviewedCanonicalMapping(
  propertyAreas: RoomConfigItem[],
  finding: HistoricalExtractedFinding,
  review: Record<string, unknown>,
): Pick<
  HistoricalExtractedFinding,
  | 'proposedAreaId'
  | 'proposedComponentId'
  | 'proposedCanonicalAreaDefinitionId'
  | 'proposedCanonicalAreaDefinitionVersion'
  | 'proposedCanonicalComponentDefinitionId'
  | 'proposedCanonicalComponentDefinitionVersion'
> {
  const requestedAreaId = typeof review.proposedAreaId === 'string' && review.proposedAreaId.trim()
    ? review.proposedAreaId.trim()
    : finding.proposedAreaId;
  const area = requestedAreaId ? propertyAreas.find((candidate) => candidate.id === requestedAreaId) : undefined;
  if (!area) return {};

  const requestedComponentId = typeof review.proposedCanonicalComponentDefinitionId === 'string' && review.proposedCanonicalComponentDefinitionId.trim()
    ? review.proposedCanonicalComponentDefinitionId.trim()
    : typeof review.proposedComponentId === 'string' && review.proposedComponentId.trim()
      ? review.proposedComponentId.trim()
      : finding.proposedCanonicalComponentDefinitionId || finding.proposedComponentId;
  const component = requestedComponentId
    ? area.componentRefs?.find((candidate) => candidate.canonicalComponentDefinitionId === requestedComponentId)
    : undefined;

  return {
    proposedAreaId: area.id,
    ...(area.canonicalAreaDefinitionId ? {
      proposedCanonicalAreaDefinitionId: area.canonicalAreaDefinitionId,
      proposedCanonicalAreaDefinitionVersion: area.canonicalAreaDefinitionVersion,
    } : {}),
    ...(component ? {
      proposedComponentId: component.canonicalComponentDefinitionId,
      proposedCanonicalComponentDefinitionId: component.canonicalComponentDefinitionId,
      proposedCanonicalComponentDefinitionVersion: component.canonicalComponentDefinitionVersion,
    } : {}),
  };
}

async function appendAudit(
  dependencies: ApiDependencies,
  principal: AuthenticatedPrincipal,
  correlationId: string,
  propertyId: string,
  entityType: string,
  entityId: string,
  eventType: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await dependencies.audit.append({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    actorId: principal.uid,
    actorRole: principal.role,
    agencyId: principal.agencyId,
    capability: 'property.manage',
    outcome: 'allowed',
    reason: eventType,
    target: { agencyId: principal.agencyId, propertyId },
    correlationId,
    entityType,
    entityId,
    eventType,
    ...(metadata ? { metadata } : {}),
  });
}

export async function routePropertyIntelligenceRequest(
  req: IncomingMessage,
  dependencies: ApiDependencies,
  correlationId: string,
): Promise<ApiResponse | undefined> {
  const parts = new URL(req.url ?? '/', 'http://localhost').pathname.split('/').filter(Boolean);
  if (parts[0] !== 'api' || parts[1] !== 'v1' || parts[2] !== 'properties' || !parts[3]) return undefined;

  const propertyId = decodeURIComponent(parts[3]);
  const agencyId = agencyHeader(req);
  const property = await dependencies.repository.get('properties', agencyId, propertyId);
  if (!property) throw new ApiError(404, 'PROPERTY_NOT_FOUND', 'Property record was not found.');

  if (parts[4] === 'documents' && parts[5]) {
    const documentId = decodeURIComponent(parts[5]);
    const document = findDocument(property, documentId);

    if (req.method === 'GET' && parts[6] === 'view' && parts.length === 7) {
      await authenticateAndAuthorise(req, dependencies, 'property.read', { agencyId, propertyId }, correlationId);
      if (!document.objectPath) throw new ApiError(422, 'PROPERTY_DOCUMENT_OBJECT_REQUIRED', 'This property document has no cloud object to view.');
      const bucketName = process.env.UPLOAD_BUCKET?.trim();
      if (!bucketName) throw new ApiError(503, 'UPLOAD_BUCKET_REQUIRED', 'UPLOAD_BUCKET is required.');
      const expiresAt = Date.now() + 15 * 60 * 1000;
      const [url] = await getStorage(adminApp()).bucket(bucketName).file(document.objectPath).getSignedUrl({ action: 'read', expires: expiresAt });
      return { status: 200, body: { data: { url, expiresAt: new Date(expiresAt).toISOString() }, meta: { correlationId } } };
    }

    if (req.method === 'GET' && parts[6] === 'analysis' && parts.length === 7) {
      await authenticateAndAuthorise(req, dependencies, 'property.read', { agencyId, propertyId }, correlationId);
      const page = await dependencies.repository.list('propertyDocumentAnalyses', agencyId, 100);
      const record = page.items
        .filter((item) => item.propertyId === propertyId && item.documentId === documentId)
        .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))[0];
      return { status: 200, body: { data: record || null, meta: { correlationId } } };
    }

    if (req.method === 'POST' && parts[6] === 'analyse' && parts.length === 7) {
      const body = await readJson(req);
      const principal = await authenticateAndAuthorise(req, dependencies, 'property.manage', { agencyId, propertyId }, correlationId);
      const expectedPropertyVersion = positiveVersion(body.expectedPropertyVersion, 'expectedPropertyVersion');
      if (!HISTORICAL_REPORT_TYPES.has(document.type)) {
        throw new ApiError(422, 'HISTORICAL_REPORT_REQUIRED', 'AI historical extraction is available only for historical inspection report documents.');
      }
      if (!document.objectPath || !document.sha256) {
        throw new ApiError(422, 'VERIFIED_DOCUMENT_REQUIRED', 'Historical extraction requires a verified cloud property document.');
      }
      if (document.fileSize > MAX_AI_DOCUMENT_BYTES) {
        throw new ApiError(413, 'DOCUMENT_TOO_LARGE_FOR_ANALYSIS', 'Historical AI extraction currently supports verified files up to 25 MB. The original remains available for manual mapping.');
      }

      const analysisId = deterministicAnalysisId(document);
      if (body.force !== true) {
        const existing = await dependencies.repository.get('propertyDocumentAnalyses', agencyId, analysisId);
        if (existing && existing.propertyId === propertyId && existing.documentId === documentId) {
          return { status: 200, body: { data: existing, meta: { correlationId, replayed: true } } };
        }
      }

      const bucketName = process.env.UPLOAD_BUCKET?.trim();
      if (!bucketName) throw new ApiError(503, 'UPLOAD_BUCKET_REQUIRED', 'UPLOAD_BUCKET is required.');
      const file = getStorage(adminApp()).bucket(bucketName).file(document.objectPath);
      const [metadata] = await file.getMetadata();
      if (document.generation && String(metadata.generation || '') !== String(document.generation)) {
        throw new ApiError(409, 'PROPERTY_DOCUMENT_GENERATION_CHANGED', 'Historical source generation no longer matches the accepted property document.');
      }
      const [bytes] = await file.download({ validation: false });
      const actualHash = createHash('sha256').update(bytes).digest('hex');
      if (actualHash !== document.sha256) {
        throw new ApiError(409, 'PROPERTY_DOCUMENT_HASH_CHANGED', 'Historical source bytes no longer match the accepted SHA-256.');
      }

      const extraction = await extractHistoricalPropertyDocument({
        fileName: document.fileName,
        contentType: document.contentType,
        base64Data: bytes.toString('base64'),
        configuredAreas: rooms(property),
      });
      const analysisData = {
        propertyId,
        documentId,
        sourceSha256: document.sha256,
        sourceGeneration: document.generation,
        promptVersion: extraction.promptVersion,
        model: extraction.model,
        status: 'review_required',
        ...(extraction.detectedReportType ? { detectedReportType: extraction.detectedReportType } : {}),
        ...(extraction.detectedInspectionDate ? { detectedInspectionDate: extraction.detectedInspectionDate } : {}),
        summary: extraction.summary,
        findings: extraction.findings,
        createdBy: principal.uid,
      };
      const existing = await dependencies.repository.get('propertyDocumentAnalyses', agencyId, analysisId);
      const stored = existing
        ? await dependencies.repository.update('propertyDocumentAnalyses', agencyId, analysisId, analysisData, Number(existing.version), principal.uid)
        : await dependencies.repository.create('propertyDocumentAnalyses', agencyId, analysisId, analysisData, principal.uid);

      const updatedDocuments = documents(property).map((item) => item.id === documentId
        ? { ...item, mappingCandidates: candidates(extraction.findings), importStatus: 'review_required' as const }
        : item);
      await dependencies.repository.update('properties', agencyId, propertyId, { documents: updatedDocuments }, expectedPropertyVersion, principal.uid);
      await appendAudit(dependencies, principal, correlationId, propertyId, 'property_document', documentId, 'property.document_analysis_completed', {
        analysisId,
        promptVersion: extraction.promptVersion,
        model: extraction.model,
        findingCount: extraction.findings.length,
        canonicalFindingCount: extraction.findings.filter((finding) => finding.proposedCanonicalComponentDefinitionId).length,
        sourceSha256: document.sha256,
      });
      return { status: 201, body: { data: stored, meta: { correlationId } } };
    }

    if (req.method === 'POST' && parts[6] === 'analysis' && parts[7] && parts[8] === 'review' && parts.length === 9) {
      const analysisId = decodeURIComponent(parts[7]);
      const body = await readJson(req);
      const principal = await authenticateAndAuthorise(req, dependencies, 'property.manage', { agencyId, propertyId }, correlationId);
      const expectedPropertyVersion = positiveVersion(body.expectedPropertyVersion, 'expectedPropertyVersion');
      const expectedAnalysisVersion = positiveVersion(body.expectedAnalysisVersion, 'expectedAnalysisVersion');
      const analysis = await dependencies.repository.get('propertyDocumentAnalyses', agencyId, analysisId);
      if (!analysis || analysis.propertyId !== propertyId || analysis.documentId !== documentId) {
        throw new ApiError(404, 'PROPERTY_DOCUMENT_ANALYSIS_NOT_FOUND', 'Historical document analysis was not found.');
      }
      if (!Array.isArray(body.decisions)) throw new ApiError(400, 'REVIEW_DECISIONS_REQUIRED', 'decisions must be an array.');
      const propertyAreas = rooms(property);
      const decisions = new Map<string, Record<string, unknown>>();
      for (const value of body.decisions) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
        const decision = value as Record<string, unknown>;
        if (typeof decision.findingId === 'string') decisions.set(decision.findingId, decision);
      }
      const sourceFindings = Array.isArray(analysis.findings) ? analysis.findings as HistoricalExtractedFinding[] : [];
      const reviewedFindings: HistoricalExtractedFinding[] = sourceFindings.map((finding): HistoricalExtractedFinding => {
        const review = decisions.get(finding.id);
        if (!review) return finding;
        const decision = review.decision;
        if (decision !== 'confirmed' && decision !== 'edited' && decision !== 'rejected') {
          throw new ApiError(400, 'REVIEW_DECISION_INVALID', `Unsupported review decision for ${finding.id}.`);
        }
        if (decision === 'rejected') {
          return {
            ...finding,
            decision,
            proposedAreaId: undefined,
            proposedComponentId: undefined,
            proposedCanonicalAreaDefinitionId: undefined,
            proposedCanonicalAreaDefinitionVersion: undefined,
            proposedCanonicalComponentDefinitionId: undefined,
            proposedCanonicalComponentDefinitionVersion: undefined,
            ...(typeof review.reviewerNote === 'string' && review.reviewerNote.trim() ? { reviewerNote: review.reviewerNote.trim().slice(0, 1_000) } : {}),
          };
        }
        const mapping = reviewedCanonicalMapping(propertyAreas, finding, review);
        if (!mapping.proposedAreaId || !mapping.proposedCanonicalAreaDefinitionId || !mapping.proposedCanonicalComponentDefinitionId) {
          throw new ApiError(400, 'CANONICAL_REVIEW_MAPPING_REQUIRED', `Accepted historical finding ${finding.id} must reference a current Property Area and canonical Component identity.`);
        }
        return {
          ...finding,
          ...mapping,
          decision,
          ...(typeof review.reviewerNote === 'string' && review.reviewerNote.trim() ? { reviewerNote: review.reviewerNote.trim().slice(0, 1_000) } : {}),
        };
      });
      const stillSuggested = reviewedFindings.some((finding) => finding.decision === 'suggested');
      const accepted = reviewedFindings.some((finding) => finding.decision === 'confirmed' || finding.decision === 'edited');
      const analysisStatus = stillSuggested ? 'review_required' : accepted ? 'mapped' : 'rejected';
      const updatedAnalysis = await dependencies.repository.update(
        'propertyDocumentAnalyses',
        agencyId,
        analysisId,
        { findings: reviewedFindings, status: analysisStatus },
        expectedAnalysisVersion,
        principal.uid,
      );
      const updatedDocuments = documents(property).map((item) => item.id === documentId
        ? { ...item, mappingCandidates: candidates(reviewedFindings), importStatus: analysisStatus === 'mapped' ? 'mapped' as const : analysisStatus === 'rejected' ? 'rejected' as const : 'review_required' as const }
        : item);
      await dependencies.repository.update('properties', agencyId, propertyId, { documents: updatedDocuments }, expectedPropertyVersion, principal.uid);
      await appendAudit(dependencies, principal, correlationId, propertyId, 'property_document', documentId, 'property.document_analysis_reviewed', {
        analysisId,
        status: analysisStatus,
        acceptedCount: reviewedFindings.filter((finding) => finding.decision === 'confirmed' || finding.decision === 'edited').length,
        rejectedCount: reviewedFindings.filter((finding) => finding.decision === 'rejected').length,
        canonicalAcceptedCount: reviewedFindings.filter((finding) =>
          (finding.decision === 'confirmed' || finding.decision === 'edited') &&
          finding.proposedCanonicalAreaDefinitionId &&
          finding.proposedCanonicalComponentDefinitionId,
        ).length,
      });
      return { status: 200, body: { data: updatedAnalysis, meta: { correlationId } } };
    }
  }

  if (parts[4] === 'floor-plans') {
    if (req.method === 'GET' && parts.length === 5) {
      await authenticateAndAuthorise(req, dependencies, 'property.read', { agencyId, propertyId }, correlationId);
      const page = await dependencies.repository.list('propertyFloorPlans', agencyId, 100);
      return { status: 200, body: { data: page.items.filter((item) => item.propertyId === propertyId), meta: { correlationId } } };
    }

    if (req.method === 'POST' && parts.length === 5) {
      const body = await readJson(req);
      const principal = await authenticateAndAuthorise(req, dependencies, 'property.manage', { agencyId, propertyId }, correlationId);
      const documentId = typeof body.documentId === 'string' ? body.documentId.trim() : '';
      if (!documentId) throw new ApiError(400, 'FLOOR_PLAN_DOCUMENT_REQUIRED', 'documentId is required.');
      const document = findDocument(property, documentId);
      if (!['floor_plan', 'building_plan'].includes(document.type) || !document.contentType.startsWith('image/')) {
        throw new ApiError(422, 'INTERACTIVE_FLOOR_PLAN_IMAGE_REQUIRED', 'Interactive floor plans require an uploaded floor/building plan image. PDF plans remain available as documents but cannot receive graphical hotspots.');
      }
      const hotspots = body.hotspots === undefined ? [] : floorPlanHotspots(body.hotspots, rooms(property));
      const mapId = randomUUID();
      const stored = await dependencies.repository.create('propertyFloorPlans', agencyId, mapId, {
        propertyId,
        documentId,
        title: typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 180) : document.title,
        ...(typeof body.layoutVersionId === 'string' && body.layoutVersionId.trim() ? { layoutVersionId: body.layoutVersionId.trim() } : {}),
        hotspots,
        status: 'active',
      }, principal.uid);
      await appendAudit(dependencies, principal, correlationId, propertyId, 'property_layout', mapId, 'property.floor_plan_created', { documentId });
      return { status: 201, body: { data: stored, meta: { correlationId } } };
    }

    if ((req.method === 'PATCH' || req.method === 'PUT') && parts[5] && parts.length === 6) {
      const mapId = decodeURIComponent(parts[5]);
      const body = await readJson(req);
      const principal = await authenticateAndAuthorise(req, dependencies, 'property.manage', { agencyId, propertyId }, correlationId);
      const map = await dependencies.repository.get('propertyFloorPlans', agencyId, mapId);
      if (!map || map.propertyId !== propertyId) throw new ApiError(404, 'FLOOR_PLAN_NOT_FOUND', 'Interactive floor plan was not found.');
      const update: Record<string, unknown> = {};
      if (body.hotspots !== undefined) update.hotspots = floorPlanHotspots(body.hotspots, rooms(property));
      if (typeof body.title === 'string' && body.title.trim()) update.title = body.title.trim().slice(0, 180);
      if (body.status === 'active' || body.status === 'archived') update.status = body.status;
      const stored = await dependencies.repository.update(
        'propertyFloorPlans',
        agencyId,
        mapId,
        update,
        positiveVersion(body.expectedVersion, 'expectedVersion'),
        principal.uid,
      );
      await appendAudit(dependencies, principal, correlationId, propertyId, 'property_layout', mapId, 'property.floor_plan_updated', { hotspotCount: Array.isArray(stored.hotspots) ? stored.hotspots.length : 0 });
      return { status: 200, body: { data: stored, meta: { correlationId } } };
    }
  }

  return undefined;
}
