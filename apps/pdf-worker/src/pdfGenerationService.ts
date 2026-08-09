import { randomUUID } from 'node:crypto';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import type { ReportPhotoReference } from '@pcr/domain';
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

function adminApp() {
  return getApps()[0] ?? initializeApp({ credential: applicationDefault() });
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

  const database = getFirestore(adminApp());
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

  const versionRef = reportRef.collection('versions').doc(reportVersionId);
  const versionSnapshot = await versionRef.get();
  if (!versionSnapshot.exists) {
    throw new PdfWorkerError('REPORT_VERSION_NOT_FOUND', 'The requested immutable report version does not exist.');
  }
  const version = versionSnapshot.data() as Record<string, unknown>;
  if (version.immutable !== true) {
    throw new PdfWorkerError('REPORT_VERSION_NOT_IMMUTABLE', 'Final PDFs can only be generated from immutable report versions.');
  }

  const areaSnapshot = await versionRef.collection('areas').orderBy('sequence').get();
  const areas: Array<Record<string, unknown>> = [];
  for (const areaDocument of areaSnapshot.docs) {
    const area = areaDocument.data() as Record<string, unknown>;
    const componentSnapshot = await areaDocument.ref.collection('components').get();
    areas.push({
      ...area,
      components: componentSnapshot.docs
        .map((document) => document.data() as Record<string, unknown>)
        .sort((left, right) => text(left.id).localeCompare(text(right.id))),
    });
  }

  if (!areas.length) {
    throw new PdfWorkerError('REPORT_VERSION_EMPTY', 'The immutable report version contains no inspection areas.');
  }

  const photoIds = deduplicatePhotoIds(areas);
  const assets: RenderAsset[] = [];
  const imageBytes = new Map<string, Uint8Array>();
  const uploadBucketName = process.env.UPLOAD_BUCKET?.trim() || `${projectId}-uploads`;
  const uploadBucket = getStorage(adminApp()).bucket(uploadBucketName);

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
    const evidenceHash = text(evidence.sha256);
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
      sha256: evidenceHash.toLowerCase(),
      ...(contentType ? { contentType } : {}),
    });

    if (contentType === 'image/jpeg' || contentType === 'image/png') {
      try {
        const [bytes] = await uploadBucket.file(objectPath).download({
          validation: false,
        });
        imageBytes.set(photoId, new Uint8Array(bytes));
      } catch (error) {
        throw new PdfWorkerError(
          'EVIDENCE_DOWNLOAD_FAILED',
          `Evidence image ${photoId} could not be loaded for PDF rendering.`,
          true,
          { photoId, cause: error instanceof Error ? error.message : String(error) },
        );
      }
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
    report: structuredClone(report),
    areas: structuredClone(areas),
    assets,
  };

  return {
    renderInput,
    imageBytes,
    reportBucket: process.env.REPORT_BUCKET?.trim() || `${projectId}-reports`,
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
}): Promise<{ generation: string }> {
  const bucket = getStorage(adminApp()).bucket(input.bucketName);
  const file = bucket.file(input.objectPath);

  const verifyExisting = async (): Promise<{ generation: string }> => {
    const [metadata] = await file.getMetadata();
    const existingSha = metadata.metadata?.sha256;
    if (existingSha !== input.sha) {
      throw new PdfWorkerError(
        'IMMUTABLE_ARTIFACT_CONFLICT',
        `Immutable artifact ${input.objectPath} already exists with a different hash.`,
      );
    }
    return { generation: String(metadata.generation ?? '') };
  };

  const [exists] = await file.exists();
  if (exists) return verifyExisting();

  try {
    await file.save(Buffer.from(input.bytes), {
      resumable: false,
      validation: false,
      metadata: {
        contentType: input.contentType,
        cacheControl: 'private, max-age=31536000, immutable',
        metadata: { ...input.metadata, sha256: input.sha, immutable: 'true' },
      },
      preconditionOpts: { ifGenerationMatch: 0 },
    });
  } catch (error) {
    const code = (error as { code?: number | string }).code;
    if (code === 412 || code === '412') return verifyExisting();
    throw new PdfWorkerError(
      'ARTIFACT_STORAGE_FAILED',
      `Failed to persist immutable artifact ${input.objectPath}.`,
      true,
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }

  return verifyExisting();
}

async function markFailed(task: PdfGenerationTask, error: unknown): Promise<void> {
  const database = getFirestore(adminApp());
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

  const database = getFirestore(adminApp());
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

    const generatedAt = new Date().toISOString();
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
        finalPdfObjectPath: render.outputObjectPath,
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
          finalPdfUrl: `gs://${approved.reportBucket}/${render.outputObjectPath}`,
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
