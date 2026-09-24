import { randomUUID } from 'node:crypto';
import type { ReportPhotoReference } from '@pcr/domain';
import { downloadWorkerEvidence, saveWorkerArtifact, workerDatabase } from '@pcr/appwrite-server';
import {
  buildRenderManifest,
  buildRenderPackage,
  canonicalJson,
  renderReportPdf,
  sha256,
  type RenderAsset,
  type RenderInput,
} from './index.js';

export interface PdfGenerationTask {
  taskId: string;
  agencyId: string;
  reportId: string;
  reportVersionId?: string;
  requestedBy?: string;
}

export interface PdfGenerationResult {
  taskId: string;
  reportId: string;
  reportVersionId: string;
  status: 'completed' | 'superseded';
  pdfObjectPath: string;
  pdfSha256: string;
  renderManifestObjectPath: string;
}

export class PdfWorkerError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}


function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveInteger(value: unknown, fallback = 1): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

function templateIdFor(reportType: string): string {
  const value = reportType.toLowerCase();
  if (value.includes('routine')) return 'wa-residential-routine-inspection';
  if (value.includes('exit')) return 'wa-residential-exit-pcr';
  if (value.includes('comparison')) return 'wa-residential-comparison';
  if (value.includes('maintenance') || value.includes('follow')) return 'wa-residential-maintenance';
  return 'wa-residential-entry-pcr';
}

function photoIdsFromReferences(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => text(asRecord(item).photoId))
    .filter(Boolean);
}

function deduplicatePhotoIds(areas: Array<Record<string, unknown>>): string[] {
  const ids = new Set<string>();
  for (const area of areas) {
    for (const id of photoIdsFromReferences(area.photoReferences)) ids.add(id);
    const components = Array.isArray(area.components) ? area.components : [];
    for (const componentValue of components) {
      const component = asRecord(componentValue);
      for (const id of photoIdsFromReferences(component.photoReferences)) ids.add(id);
    }
  }
  return [...ids].sort();
}

function tenantEvidenceIds(response: Record<string, unknown>): string[] {
  const ids = new Set<string>();
  const add = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const item of value) {
      const id = text(item);
      if (id) ids.add(id);
    }
  };
  for (const key of ['photoIds', 'evidenceIds', 'photoEvidenceIds', 'evidencePhotoIds', 'responsePhotoIds', 'tenantEvidenceIds']) {
    add(response[key]);
  }
  for (const itemValue of [
    ...(Array.isArray(response.items) ? response.items : []),
    ...(Array.isArray(response.componentResponses) ? response.componentResponses : []),
  ]) {
    const item = asRecord(itemValue);
    for (const key of ['photoIds', 'evidenceIds', 'photoEvidenceIds', 'evidencePhotoIds']) add(item[key]);
  }
  return [...ids].sort();
}

async function loadTenantResponses(agencyId: string, reportId: string, reportVersionId: string): Promise<Array<Record<string, unknown>>> {
  const database = workerDatabase();
  const agencyScoped = await database.collection(`agencies/${agencyId}/tenantResponses`)
    .where('reportId', '==', reportId)
    .where('reportVersionId', '==', reportVersionId)
    .get();
  const combined = new Map<string, Record<string, unknown>>();
  for (const document of agencyScoped.docs) {
    combined.set(document.id, { id: document.id, ...(document.data() as Record<string, unknown>) });
  }
  return [...combined.values()].sort((left, right) => text(left.id).localeCompare(text(right.id)));
}

async function loadApprovedInput(task: PdfGenerationTask): Promise<{
  renderInput: RenderInput;
  imageBytes: Map<string, Uint8Array>;
  reportBucket: string;
  reportRefPath: string;
  inspectionJobId?: string;
}> {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT?.trim();
  if (!projectId) {
    throw new PdfWorkerError('PROJECT_ID_REQUIRED', 'GOOGLE_CLOUD_PROJECT is required for PDF generation.');
  }

  const database = workerDatabase();
  const reportRef = database.doc(`agencies/${task.agencyId}/reports/${task.reportId}`);
  const reportSnapshot = await reportRef.get();
  if (!reportSnapshot.exists) {
    throw new PdfWorkerError('REPORT_NOT_FOUND', 'Report not found.');
  }
  const report = reportSnapshot.data() as Record<string, unknown>;
  if (text(report.agencyId) !== task.agencyId) {
    throw new PdfWorkerError('AGENCY_SCOPE_MISMATCH', 'Report does not belong to the requested agency.');
  }

  const reportVersionId = task.reportVersionId?.trim() || text(report.currentVersionId);
  if (!reportVersionId) {
    throw new PdfWorkerError(
      'REPORT_VERSION_REQUIRED',
      'An immutable approved report version is required before a final PDF can be generated.',
    );
  }

  const versionRef = database.doc(`agencies/${task.agencyId}/reportVersions/${reportVersionId}`);
  const versionSnapshot = await versionRef.get();
  if (!versionSnapshot.exists) {
    throw new PdfWorkerError('REPORT_VERSION_NOT_FOUND', 'The requested immutable report version does not exist.');
  }
  const version = versionSnapshot.data() as Record<string, unknown>;
  if (version.reportId !== task.reportId) throw new PdfWorkerError('REPORT_VERSION_SCOPE_MISMATCH', 'Report version belongs to another report.');
  if (version.immutable !== true) {
    throw new PdfWorkerError('REPORT_VERSION_NOT_IMMUTABLE', 'Final PDFs can only be generated from immutable report versions.');
  }

  const aggregate = asRecord(version.snapshot);
  const originalSnapshot = await database.services.tables.getRow({ databaseId: database.services.databaseId, tableId: 'report_versions', rowId: reportVersionId });
  if (typeof originalSnapshot.snapshot !== 'string' || sha256(new TextEncoder().encode(originalSnapshot.snapshot)) !== version.contentHash) throw new PdfWorkerError('REPORT_SNAPSHOT_HASH_MISMATCH', 'Report snapshot hash does not match immutable version.');
  const areas = Array.isArray(aggregate.areas) ? aggregate.areas.map(asRecord) : [];
  const approvedReport = { ...asRecord(aggregate.report), ...report };

  if (!areas.length) {
    throw new PdfWorkerError('REPORT_VERSION_EMPTY', 'The immutable report version contains no inspection areas.');
  }

  const tenantResponses = await loadTenantResponses(task.agencyId, task.reportId, reportVersionId);
  const photoIdSet = new Set(deduplicatePhotoIds(areas));
  for (const response of tenantResponses) {
    for (const photoId of tenantEvidenceIds(response)) photoIdSet.add(photoId);
  }
  const photoIds = [...photoIdSet].sort();
  const assets: RenderAsset[] = [];
  const imageBytes = new Map<string, Uint8Array>();

  for (const photoId of photoIds) {
    const evidenceSnapshot = await database.doc(`agencies/${task.agencyId}/photoEvidence/${photoId}`).get();
    if (!evidenceSnapshot.exists) {
      throw new PdfWorkerError(
        'EVIDENCE_METADATA_MISSING',
        `Evidence metadata is missing for photo ${photoId}.`,
        false,
        { photoId },
      );
    }
    const evidence = evidenceSnapshot.data() as Record<string, unknown>;
    const objectPath = text(evidence.objectPath);
    const generation = text(evidence.generation);
    const evidenceHash = text(evidence.sha256).toLowerCase();
    const contentType = text(evidence.contentType);
    if (!objectPath || !generation || !/^[a-f0-9]{64}$/i.test(evidenceHash)) {
      throw new PdfWorkerError(
        'EVIDENCE_METADATA_INCOMPLETE',
        `Evidence provenance is incomplete for photo ${photoId}.`,
        false,
        { photoId },
      );
    }

    assets.push({
      photoId,
      objectPath,
      generation,
      sha256: evidenceHash,
      ...(contentType ? { contentType } : {}),
    });

    if (contentType === 'image/jpeg' || contentType === 'image/png') {
      try {
        const { bytes } = await downloadWorkerEvidence(task.agencyId, photoId, database.services);
        const actualHash = sha256(new Uint8Array(bytes));
        if (actualHash !== evidenceHash) {
          throw new PdfWorkerError(
            'EVIDENCE_HASH_MISMATCH',
            `Evidence image ${photoId} does not match its recorded SHA-256.`,
            false,
            { photoId, generation, expectedSha256: evidenceHash, actualSha256: actualHash },
          );
        }
        imageBytes.set(photoId, new Uint8Array(bytes));
      } catch (error) {
        if (error instanceof PdfWorkerError) throw error;
        throw new PdfWorkerError(
          'EVIDENCE_DOWNLOAD_FAILED',
          `Evidence image ${photoId} could not be loaded for PDF rendering.`,
          true,
          { photoId, generation, cause: error instanceof Error ? error.message : String(error) },
        );
      }
    }
  }

  const brandingSnapshot = asRecord(report.brandingSnapshot);
  const logoDocumentId = text(brandingSnapshot.logoDocumentId);
  if (logoDocumentId) {
    const logoSnapshot = await database.doc(`agencies/${task.agencyId}/brandingAssets/${logoDocumentId}`).get();
    if (!logoSnapshot.exists) {
      throw new PdfWorkerError(
        'BRANDING_LOGO_METADATA_MISSING',
        'The pinned branding profile references a logo asset that no longer exists.',
        false,
        { logoDocumentId },
      );
    }
    const logo = logoSnapshot.data() as Record<string, unknown>;
    const objectPath = text(logo.objectPath);
    const generation = text(logo.generation);
    const logoHash = text(logo.sha256).toLowerCase();
    const contentType = text(logo.contentType).toLowerCase();
    if (!objectPath || !generation || !/^[a-f0-9]{64}$/u.test(logoHash)) {
      throw new PdfWorkerError(
        'BRANDING_LOGO_METADATA_INCOMPLETE',
        'The pinned branding logo does not contain complete immutable storage provenance.',
        false,
        { logoDocumentId },
      );
    }
    if (contentType !== 'image/jpeg' && contentType !== 'image/png') {
      throw new PdfWorkerError(
        'BRANDING_LOGO_FORMAT_UNSUPPORTED',
        'Final PDF logos must be a governed PNG or JPEG asset. SVG and WebP remain valid for web branding but require a PDF-compatible raster variant.',
        false,
        { logoDocumentId, contentType },
      );
    }
    try {
      const { bytes } = await downloadWorkerEvidence(task.agencyId, logoDocumentId, database.services);
      const actualHash = sha256(new Uint8Array(bytes));
      if (actualHash !== logoHash) {
        throw new PdfWorkerError(
          'BRANDING_LOGO_HASH_MISMATCH',
          'The pinned branding logo does not match its recorded SHA-256.',
          false,
          { logoDocumentId, generation, expectedSha256: logoHash, actualSha256: actualHash },
        );
      }
      assets.push({
        photoId: logoDocumentId,
        objectPath,
        generation,
        sha256: logoHash,
        contentType,
      });
      imageBytes.set(logoDocumentId, new Uint8Array(bytes));
    } catch (error) {
      if (error instanceof PdfWorkerError) throw error;
      throw new PdfWorkerError(
        'BRANDING_LOGO_DOWNLOAD_FAILED',
        'The pinned branding logo could not be loaded for PDF rendering.',
        true,
        { logoDocumentId, generation, cause: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  const reportType = text(report.reportType) || 'Property Condition Report';
  const renderInput: RenderInput = {
    reportId: task.reportId,
    reportVersionId,
    templateId: text(report.templateId) || text(version.templateId) || templateIdFor(reportType),
    templateVersion: positiveInteger(report.templateVersion ?? version.templateVersion),
    approvedAt: text(version.createdAt) || text(report.updatedAt) || new Date().toISOString(),
    approvedBy: text(version.createdBy) || task.requestedBy || 'system',
    report: structuredClone(approvedReport),
    areas: structuredClone(areas),
    assets,
    ...(tenantResponses.length ? { tenantResponses: structuredClone(tenantResponses) } : {}),
  };

  return {
    renderInput,
    imageBytes,
    reportBucket: 'reports',
    reportRefPath: reportRef.path,
    ...(text(report.inspectionJobId) ? { inspectionJobId: text(report.inspectionJobId) } : {}),
  };
}

async function saveImmutableObject(input: {
  bucketName: string;
  objectPath: string;
  bytes: Uint8Array;
  contentType: string;
  sha: string;
  metadata: Record<string, string>;
}): Promise<{ fileId: string; generation: string }> {
  return saveWorkerArtifact(workerDatabase().services, { bucketId: input.contentType.startsWith('application/json') ? 'report-artifacts' : input.bucketName, path: input.objectPath, bytes: input.bytes, sha256: input.sha, contentType: input.contentType });
}

async function markFailed(task: PdfGenerationTask, error: unknown): Promise<void> {
  const database = workerDatabase();
  const workerError = error instanceof PdfWorkerError ? error : undefined;
  await database.doc(`agencies/${task.agencyId}/pdfJobs/${task.taskId}`).set(
    {
      status: 'failed',
      errorCode: workerError?.code ?? 'PDF_GENERATION_FAILED',
      errorMessage: error instanceof Error ? error.message : String(error),
      retryable: workerError?.retryable ?? true,
      failedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
}

export async function processPdfGenerationTask(task: PdfGenerationTask): Promise<PdfGenerationResult> {
  if (!task.taskId.trim() || !task.agencyId.trim() || !task.reportId.trim()) {
    throw new PdfWorkerError('INVALID_PDF_TASK', 'taskId, agencyId and reportId are required.');
  }

  const database = workerDatabase();
  const pdfJobRef = database.doc(`agencies/${task.agencyId}/pdfJobs/${task.taskId}`);
  const existingJob = await pdfJobRef.get();
  if (existingJob.exists && existingJob.get('status') === 'completed') {
    const data = existingJob.data() as Record<string, unknown>;
    return {
      taskId: task.taskId,
      reportId: task.reportId,
      reportVersionId: text(data.reportVersionId),
      status: 'completed',
      pdfObjectPath: text(data.pdfObjectPath),
      pdfSha256: text(data.pdfSha256),
      renderManifestObjectPath: text(data.renderManifestObjectPath),
    };
  }

  await pdfJobRef.set(
    {
      status: 'running',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );

  try {
    const approved = await loadApprovedInput(task);
    const render = buildRenderPackage(approved.renderInput);
    const pdfBytes = await renderReportPdf(approved.renderInput, approved.imageBytes);
    const pdfSha256 = sha256(pdfBytes);
    const pdfStored = await saveImmutableObject({
      bucketName: approved.reportBucket,
      objectPath: render.outputObjectPath,
      bytes: pdfBytes,
      contentType: 'application/pdf',
      sha: pdfSha256,
      metadata: {
        reportId: task.reportId,
        reportVersionId: approved.renderInput.reportVersionId,
        renderId: render.renderId,
        canonicalInputHash: render.canonicalInputHash,
      },
    });

    const generatedAt = approved.renderInput.approvedAt;
    const generatedBy = task.requestedBy || approved.renderInput.approvedBy;
    const manifest = buildRenderManifest({
      render,
      pdf: {
        objectPath: render.outputObjectPath,
        generation: pdfStored.generation,
        sha256: pdfSha256,
      },
      assets: approved.renderInput.assets,
      generatedAt,
      generatedBy,
    });
    const manifestBytes = new TextEncoder().encode(`${canonicalJson(manifest)}\n`);
    const manifestSha256 = sha256(manifestBytes);
    const manifestObjectPath = render.outputObjectPath.replace(/\.pdf$/u, '.manifest.json');
    await saveImmutableObject({
      bucketName: approved.reportBucket,
      objectPath: manifestObjectPath,
      bytes: manifestBytes,
      contentType: 'application/json; charset=utf-8',
      sha: manifestSha256,
      metadata: {
        reportId: task.reportId,
        reportVersionId: approved.renderInput.reportVersionId,
        renderId: render.renderId,
        manifestHash: manifest.manifestHash,
      },
    });

    const result = await database.runTransaction(async (transaction) => {
      const reportRef = database.doc(approved.reportRefPath);
      const latestReportSnapshot = await transaction.get(reportRef);
      if (!latestReportSnapshot.exists) {
        throw new PdfWorkerError('REPORT_NOT_FOUND', 'Report disappeared before PDF completion.');
      }
      const latestReport = latestReportSnapshot.data() as Record<string, unknown>;
      const currentVersionId = text(latestReport.currentVersionId);
      if (currentVersionId && currentVersionId !== approved.renderInput.reportVersionId) {
        transaction.set(
          pdfJobRef,
          {
            status: 'superseded',
            reportVersionId: approved.renderInput.reportVersionId,
            currentVersionId,
            completedAt: generatedAt,
            updatedAt: generatedAt,
          },
          { merge: true },
        );
        return 'superseded' as const;
      }

      const artifact = {
        finalPdfReportVersionId: approved.renderInput.reportVersionId,
        finalPdfObjectPath: pdfStored.fileId,
        finalPdfSha256: pdfSha256,
        finalPdfGeneration: pdfStored.generation,
        renderManifestObjectPath: manifestObjectPath,
        renderManifestSha256: manifestSha256,
        pdfGeneratedAt: generatedAt,
      };
      transaction.update(reportRef, artifact);

      if (approved.inspectionJobId) {
        transaction.update(database.doc(`agencies/${task.agencyId}/inspectionJobs/${approved.inspectionJobId}`), {
          ...artifact,
          finalPdfUrl: `appwrite://${approved.reportBucket}/${pdfStored.fileId}`,
          updatedAt: generatedAt,
        });
      }

      transaction.set(
        pdfJobRef,
        {
          status: 'completed',
          reportId: task.reportId,
          reportVersionId: approved.renderInput.reportVersionId,
          renderId: render.renderId,
          canonicalInputHash: render.canonicalInputHash,
          pdfObjectPath: render.outputObjectPath,
          pdfSha256,
          pdfGeneration: pdfStored.generation,
          renderManifestObjectPath: manifestObjectPath,
          renderManifestSha256: manifestSha256,
          completedAt: generatedAt,
          updatedAt: generatedAt,
        },
        { merge: true },
      );

      const auditId = randomUUID();
      transaction.create(database.doc(`agencies/${task.agencyId}/auditEvents/${auditId}`), {
        id: auditId,
        agencyId: task.agencyId,
        entityType: 'report',
        entityId: task.reportId,
        eventType: 'report.pdf_generated',
        actorId: generatedBy,
        actorRole: 'system',
        timestamp: generatedAt,
        correlationId: task.taskId,
        metadata: {
          reportVersionId: approved.renderInput.reportVersionId,
          renderId: render.renderId,
          pdfObjectPath: render.outputObjectPath,
          pdfSha256,
          renderManifestObjectPath: manifestObjectPath,
          renderManifestSha256: manifestSha256,
          tenantResponseCount: approved.renderInput.tenantResponses?.length ?? 0,
          brandingLogoDocumentId: text(asRecord(approved.renderInput.report.brandingSnapshot).logoDocumentId),
        },
      });
      return 'completed' as const;
    });

    return {
      taskId: task.taskId,
      reportId: task.reportId,
      reportVersionId: approved.renderInput.reportVersionId,
      status: result,
      pdfObjectPath: render.outputObjectPath,
      pdfSha256,
      renderManifestObjectPath: manifestObjectPath,
    };
  } catch (error) {
    await markFailed(task, error);
    throw error;
  }
}

export function parsePubSubPdfTask(body: unknown): PdfGenerationTask {
  const envelope = asRecord(body);
  const message = asRecord(envelope.message);
  const encoded = text(message.data);
  const direct = envelope.taskId ? envelope : undefined;
  let payload: Record<string, unknown>;

  if (direct) {
    payload = direct;
  } else {
    if (!encoded) throw new PdfWorkerError('INVALID_PUBSUB_MESSAGE', 'Pub/Sub message data is required.');
    try {
      payload = asRecord(JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')));
    } catch {
      throw new PdfWorkerError('INVALID_PUBSUB_MESSAGE', 'Pub/Sub message data must contain valid JSON.');
    }
  }

  const taskId = text(payload.taskId) || text(message.messageId);
  const agencyId = text(payload.agencyId);
  const reportId = text(payload.reportId);
  if (!taskId || !agencyId || !reportId) {
    throw new PdfWorkerError('INVALID_PDF_TASK', 'taskId, agencyId and reportId are required.');
  }
  return {
    taskId,
    agencyId,
    reportId,
    ...(text(payload.reportVersionId) ? { reportVersionId: text(payload.reportVersionId) } : {}),
    ...(text(payload.requestedBy) ? { requestedBy: text(payload.requestedBy) } : {}),
  };
}

export function referencedPhotoIds(areas: Array<Record<string, unknown>>): string[] {
  return deduplicatePhotoIds(areas);
}

export function clonePhotoReference(reference: ReportPhotoReference): ReportPhotoReference {
  return structuredClone(reference);
}
