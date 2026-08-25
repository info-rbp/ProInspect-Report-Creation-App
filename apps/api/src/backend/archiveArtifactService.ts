import { createHash, randomUUID } from 'node:crypto';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { type DocumentData, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { firestoreDb } from '../firestoreDatabase.js';

export interface CreateArchiveArtifactInput {
  agencyId: string;
  reportId: string;
  expectedVersion: number;
  actorId: string;
  actorRole: string;
  correlationId: string;
}

export interface ArchiveArtifactResult {
  reportId: string;
  reportVersionId: string;
  objectPath: string;
  sha256: string;
  createdAt: string;
  alreadyExists: boolean;
  reportVersion: number;
}

function adminApp() {
  return getApps()[0] ?? initializeApp({ credential: applicationDefault() });
}

function archiveError(code: string, status: number, message: string, details?: Record<string, unknown>): Error {
  return Object.assign(new Error(message), { code, status, ...(details ? { details } : {}) });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function validSha(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/iu.test(value);
}

function photoIdsFromReferences(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((reference) => text(asRecord(reference).photoId))
    .filter(Boolean);
}

function responsePhotoIds(response: Record<string, unknown>): string[] {
  const ids = new Set<string>();
  for (const key of ['photoIds', 'evidencePhotoIds', 'responsePhotoIds']) {
    const value = response[key];
    if (Array.isArray(value)) {
      for (const item of value) if (typeof item === 'string' && item.trim()) ids.add(item.trim());
    }
  }
  const items = Array.isArray(response.items) ? response.items : [];
  for (const itemValue of items) {
    const item = asRecord(itemValue);
    for (const key of ['photoIds', 'evidencePhotoIds']) {
      const value = item[key];
      if (Array.isArray(value)) {
        for (const photoId of value) if (typeof photoId === 'string' && photoId.trim()) ids.add(photoId.trim());
      }
    }
  }
  return [...ids];
}

function serialiseDocuments(documents: QueryDocumentSnapshot<DocumentData>[]): Array<Record<string, unknown>> {
  return documents
    .map((document) => ({ id: document.id, ...(document.data() as Record<string, unknown>) }))
    .sort((left, right) => text(left.id).localeCompare(text(right.id)));
}

async function verifyStoredArtifact(input: {
  bucketName: string;
  objectPath: string;
  expectedSha256: string;
  generation?: string;
  label: string;
}): Promise<void> {
  const bucket = getStorage(adminApp()).bucket(input.bucketName);
  const file = input.generation
    ? bucket.file(input.objectPath, { generation: input.generation })
    : bucket.file(input.objectPath);
  let bytes: Buffer;
  try {
    [bytes] = await file.download({ validation: false });
  } catch (error) {
    throw archiveError(
      'ARCHIVE_SOURCE_ARTIFACT_MISSING',
      422,
      `${input.label} could not be loaded from immutable report storage.`,
      { objectPath: input.objectPath, generation: input.generation ?? null, cause: error instanceof Error ? error.message : String(error) },
    );
  }
  const actualSha256 = sha256(new Uint8Array(bytes));
  if (actualSha256 !== input.expectedSha256.toLowerCase()) {
    throw archiveError(
      'ARCHIVE_SOURCE_HASH_MISMATCH',
      422,
      `${input.label} does not match its recorded SHA-256.`,
      { objectPath: input.objectPath, expectedSha256: input.expectedSha256, actualSha256 },
    );
  }
}

async function loadVersionContent(agencyId: string, reportId: string, reportVersionId: string) {
  const database = firestoreDb(adminApp());
  const versionRef = database.doc(`agencies/${agencyId}/reports/${reportId}/versions/${reportVersionId}`);
  const versionSnapshot = await versionRef.get();
  if (!versionSnapshot.exists) {
    throw archiveError('REPORT_VERSION_NOT_FOUND', 404, 'The immutable report version to archive does not exist.');
  }
  const version = versionSnapshot.data() as Record<string, unknown>;
  if (version.immutable !== true) {
    throw archiveError('REPORT_VERSION_NOT_IMMUTABLE', 409, 'Only an immutable report version can be archived.');
  }

  const areaSnapshot = await versionRef.collection('areas').orderBy('sequence').get();
  const areas: Array<Record<string, unknown>> = [];
  const photoIds = new Set<string>();
  for (const areaDocument of areaSnapshot.docs) {
    const area = areaDocument.data() as Record<string, unknown>;
    for (const id of photoIdsFromReferences(area.photoReferences)) photoIds.add(id);
    const componentSnapshot = await areaDocument.ref.collection('components').get();
    const components = componentSnapshot.docs
      .map((document) => document.data() as Record<string, unknown>)
      .sort((left, right) => text(left.id).localeCompare(text(right.id)));
    for (const component of components) {
      for (const id of photoIdsFromReferences(component.photoReferences)) photoIds.add(id);
    }
    areas.push({ ...area, components });
  }
  if (!areas.length) {
    throw archiveError('REPORT_VERSION_EMPTY', 422, 'The immutable report version contains no areas to archive.');
  }
  return { version, areas, photoIds };
}

async function loadTenantResponses(agencyId: string, reportId: string): Promise<Array<Record<string, unknown>>> {
  const database = firestoreDb(adminApp());
  const nested = await database.collection(`agencies/${agencyId}/reports/${reportId}/tenantResponses`).get();
  const nestedRecords = serialiseDocuments(nested.docs);

  const agencyScoped = await database.collection(`agencies/${agencyId}/tenantResponses`)
    .where('reportId', '==', reportId)
    .get();
  const combined = new Map<string, Record<string, unknown>>();
  for (const record of [...nestedRecords, ...serialiseDocuments(agencyScoped.docs)]) {
    combined.set(text(record.id), record);
  }
  return [...combined.values()].sort((left, right) => text(left.id).localeCompare(text(right.id)));
}

async function loadEvidence(agencyId: string, photoIds: Set<string>): Promise<Array<Record<string, unknown>>> {
  const database = firestoreDb(adminApp());
  const evidence: Array<Record<string, unknown>> = [];
  for (const photoId of [...photoIds].sort()) {
    const snapshot = await database.doc(`agencies/${agencyId}/photoEvidence/${photoId}`).get();
    if (!snapshot.exists) {
      throw archiveError('EVIDENCE_METADATA_MISSING', 422, `Evidence metadata is missing for photo ${photoId}.`, { photoId });
    }
    const record = snapshot.data() as Record<string, unknown>;
    const objectPath = text(record.objectPath);
    const generation = text(record.generation);
    const evidenceSha = text(record.sha256).toLowerCase();
    if (!objectPath || !generation || !validSha(evidenceSha)) {
      throw archiveError('EVIDENCE_METADATA_INCOMPLETE', 422, `Evidence provenance is incomplete for photo ${photoId}.`, { photoId });
    }
    evidence.push({
      photoId,
      objectPath,
      generation,
      sha256: evidenceSha,
      ...(text(record.contentType) ? { contentType: text(record.contentType) } : {}),
      ...(text(record.originalFilename) ? { originalFilename: text(record.originalFilename) } : {}),
    });
  }
  return evidence;
}

async function loadMaintenanceLinks(agencyId: string, reportId: string): Promise<Array<Record<string, unknown>>> {
  const snapshot = await firestoreDb(adminApp())
    .collection(`agencies/${agencyId}/maintenanceItems`)
    .where('sourceReportId', '==', reportId)
    .get();
  return snapshot.docs
    .map((document) => {
      const record = document.data() as Record<string, unknown>;
      return {
        id: document.id,
        status: record.status ?? null,
        sourceReportVersionId: record.sourceReportVersionId ?? null,
        sourceAreaId: record.sourceAreaId ?? null,
        sourceComponentId: record.sourceComponentId ?? null,
        followUpInspectionJobId: record.followUpInspectionJobId ?? null,
        followUpReportId: record.followUpReportId ?? null,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

async function loadAuditReferences(agencyId: string, reportId: string): Promise<Array<Record<string, unknown>>> {
  const snapshot = await firestoreDb(adminApp())
    .collection(`agencies/${agencyId}/auditEvents`)
    .where('entityId', '==', reportId)
    .get();
  return snapshot.docs
    .map((document) => {
      const record = document.data() as Record<string, unknown>;
      return {
        id: document.id,
        eventType: record.eventType ?? null,
        timestamp: record.timestamp ?? null,
        correlationId: record.correlationId ?? null,
      };
    })
    .sort((left, right) => `${left.timestamp ?? ''}:${left.id}`.localeCompare(`${right.timestamp ?? ''}:${right.id}`));
}

async function saveArchiveManifest(input: {
  bucketName: string;
  objectPath: string;
  bytes: Uint8Array;
  sha256: string;
  reportId: string;
  reportVersionId: string;
}): Promise<{ alreadyExists: boolean; sha256: string }> {
  const file = getStorage(adminApp()).bucket(input.bucketName).file(input.objectPath);
  const existing = async (): Promise<{ alreadyExists: boolean; sha256: string }> => {
    const [metadata] = await file.getMetadata();
    const existingSha = text(metadata.metadata?.sha256).toLowerCase();
    const existingVersion = text(metadata.metadata?.reportVersionId);
    if (!validSha(existingSha) || existingVersion !== input.reportVersionId) {
      throw archiveError(
        'IMMUTABLE_ARCHIVE_CONFLICT',
        409,
        'An archive artifact already exists at the immutable path with incompatible provenance.',
        { objectPath: input.objectPath },
      );
    }
    return { alreadyExists: true, sha256: existingSha };
  };

  const [exists] = await file.exists();
  if (exists) return existing();
  try {
    await file.save(Buffer.from(input.bytes), {
      resumable: false,
      validation: false,
      metadata: {
        contentType: 'application/json; charset=utf-8',
        cacheControl: 'private, max-age=31536000, immutable',
        metadata: {
          sha256: input.sha256,
          immutable: 'true',
          reportId: input.reportId,
          reportVersionId: input.reportVersionId,
        },
      },
      preconditionOpts: { ifGenerationMatch: 0 },
    });
  } catch (error) {
    const code = (error as { code?: number | string }).code;
    if (code === 412 || code === '412') return existing();
    throw archiveError(
      'ARCHIVE_STORAGE_FAILED',
      503,
      'The immutable archive manifest could not be stored.',
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
  return { alreadyExists: false, sha256: input.sha256 };
}

export async function createArchiveArtifact(input: CreateArchiveArtifactInput): Promise<ArchiveArtifactResult> {
  const database = firestoreDb(adminApp());
  const reportRef = database.doc(`agencies/${input.agencyId}/reports/${input.reportId}`);
  const reportSnapshot = await reportRef.get();
  if (!reportSnapshot.exists) throw archiveError('NOT_FOUND', 404, 'Report not found.');
  const report = reportSnapshot.data() as Record<string, unknown>;
  if (text(report.agencyId) !== input.agencyId) throw archiveError('AGENCY_SCOPE_MISMATCH', 404, 'Report not found.');
  if (report.lifecycleStatus !== 'finalised') {
    throw archiveError('REPORT_NOT_FINALISED', 409, 'The report must be finalised before its archive manifest can be created.');
  }
  if (report.version !== input.expectedVersion) {
    throw archiveError('VERSION_CONFLICT', 409, 'The report has changed. Reload before creating the archive.', {
      expectedVersion: input.expectedVersion,
      actualVersion: report.version,
    });
  }

  const reportVersionId = text(report.currentVersionId);
  if (!reportVersionId) throw archiveError('REPORT_VERSION_REQUIRED', 409, 'A current immutable report version is required before archiving.');

  const existingArchiveVersion = text(report.archiveReportVersionId);
  const existingArchivePath = text(report.archiveManifestObjectPath);
  const existingArchiveSha = text(report.archiveManifestSha256).toLowerCase();
  const existingArchiveCreatedAt = text(report.archiveCreatedAt);
  if (
    existingArchiveVersion === reportVersionId &&
    existingArchivePath &&
    validSha(existingArchiveSha) &&
    existingArchiveCreatedAt
  ) {
    return {
      reportId: input.reportId,
      reportVersionId,
      objectPath: existingArchivePath,
      sha256: existingArchiveSha,
      createdAt: existingArchiveCreatedAt,
      alreadyExists: true,
      reportVersion: input.expectedVersion,
    };
  }

  const finalPdfReportVersionId = text(report.finalPdfReportVersionId);
  const finalPdfObjectPath = text(report.finalPdfObjectPath);
  const finalPdfGeneration = text(report.finalPdfGeneration);
  const finalPdfSha256 = text(report.finalPdfSha256).toLowerCase();
  const renderManifestObjectPath = text(report.renderManifestObjectPath);
  const renderManifestSha256 = text(report.renderManifestSha256).toLowerCase();
  if (
    finalPdfReportVersionId !== reportVersionId ||
    !finalPdfObjectPath ||
    !finalPdfGeneration ||
    !validSha(finalPdfSha256) ||
    !renderManifestObjectPath ||
    !validSha(renderManifestSha256)
  ) {
    throw archiveError(
      'FINAL_PDF_NOT_READY_OR_STALE',
      422,
      'The final PDF and render manifest must be complete and bound to the current immutable report version before archiving.',
    );
  }

  const projectId = process.env.GOOGLE_CLOUD_PROJECT?.trim();
  if (!projectId) throw archiveError('PROJECT_ID_REQUIRED', 503, 'GOOGLE_CLOUD_PROJECT is required for archive creation.');
  const reportBucket = process.env.REPORT_BUCKET?.trim() || `${projectId}-reports`;
  await verifyStoredArtifact({
    bucketName: reportBucket,
    objectPath: finalPdfObjectPath,
    generation: finalPdfGeneration,
    expectedSha256: finalPdfSha256,
    label: 'Final PDF',
  });
  await verifyStoredArtifact({
    bucketName: reportBucket,
    objectPath: renderManifestObjectPath,
    expectedSha256: renderManifestSha256,
    label: 'Render manifest',
  });

  const { version, areas, photoIds } = await loadVersionContent(input.agencyId, input.reportId, reportVersionId);
  const tenantResponses = await loadTenantResponses(input.agencyId, input.reportId);
  for (const response of tenantResponses) {
    for (const photoId of responsePhotoIds(response)) photoIds.add(photoId);
  }
  const evidence = await loadEvidence(input.agencyId, photoIds);
  const maintenanceLinks = await loadMaintenanceLinks(input.agencyId, input.reportId);
  const auditEvents = await loadAuditReferences(input.agencyId, input.reportId);
  const createdAt = new Date().toISOString();

  const manifest = {
    format: 'proinspect-report-archive-v1',
    agencyId: input.agencyId,
    reportId: input.reportId,
    reportVersionId,
    createdAt,
    createdBy: input.actorId,
    finalisedAt: report.finalisedAt ?? null,
    version: structuredClone(version),
    report: {
      id: input.reportId,
      agencyId: input.agencyId,
      propertyId: report.propertyId ?? null,
      tenancyId: report.tenancyId ?? null,
      inspectionJobId: report.inspectionJobId ?? null,
      reportType: report.reportType ?? null,
      propertyAddress: report.propertyAddress ?? null,
      templateId: report.templateId ?? null,
      templateVersion: report.templateVersion ?? null,
      lifecycleStatus: report.lifecycleStatus,
      currentVersionId: reportVersionId,
      baselineReportId: report.baselineReportId ?? null,
      baselineReportVersionId: report.baselineReportVersionId ?? null,
    },
    finalPdf: {
      objectPath: finalPdfObjectPath,
      generation: finalPdfGeneration,
      sha256: finalPdfSha256,
      renderManifestObjectPath,
      renderManifestSha256,
    },
    areas: structuredClone(areas),
    evidence,
    tenantResponses,
    maintenanceLinks,
    auditEvents,
  };
  const manifestBytes = new TextEncoder().encode(`${canonicalJson(manifest)}\n`);
  const manifestSha256 = sha256(manifestBytes);
  const objectPath = `final-report-assets/reports/${input.reportId}/${reportVersionId}/archive/archive.manifest.json`;
  const stored = await saveArchiveManifest({
    bucketName: reportBucket,
    objectPath,
    bytes: manifestBytes,
    sha256: manifestSha256,
    reportId: input.reportId,
    reportVersionId,
  });

  const persisted = await database.runTransaction(async (transaction) => {
    const latestSnapshot = await transaction.get(reportRef);
    if (!latestSnapshot.exists) throw archiveError('NOT_FOUND', 404, 'Report not found.');
    const latest = latestSnapshot.data() as Record<string, unknown>;
    if (latest.version !== input.expectedVersion) {
      throw archiveError('VERSION_CONFLICT', 409, 'The report changed while the archive was being created. Reload before retrying.', {
        expectedVersion: input.expectedVersion,
        actualVersion: latest.version,
      });
    }
    if (latest.lifecycleStatus !== 'finalised' || text(latest.currentVersionId) !== reportVersionId) {
      throw archiveError('ARCHIVE_SOURCE_CHANGED', 409, 'The report lifecycle or immutable version changed while the archive was being created.');
    }
    const timestamp = new Date().toISOString();
    const nextVersion = input.expectedVersion + 1;
    transaction.update(reportRef, {
      archiveReportVersionId: reportVersionId,
      archiveManifestObjectPath: objectPath,
      archiveManifestSha256: stored.sha256,
      archiveCreatedAt: timestamp,
      version: nextVersion,
      updatedAt: timestamp,
      updatedBy: input.actorId,
    });
    const auditId = randomUUID();
    transaction.create(database.doc(`agencies/${input.agencyId}/auditEvents/${auditId}`), {
      id: auditId,
      agencyId: input.agencyId,
      entityType: 'report',
      entityId: input.reportId,
      eventType: 'report.archive_created',
      actorId: input.actorId,
      actorRole: input.actorRole,
      timestamp,
      correlationId: input.correlationId,
      metadata: {
        reportVersionId,
        archiveManifestObjectPath: objectPath,
        archiveManifestSha256: stored.sha256,
      },
    });
    return { timestamp, nextVersion };
  });

  return {
    reportId: input.reportId,
    reportVersionId,
    objectPath,
    sha256: stored.sha256,
    createdAt: persisted.timestamp,
    alreadyExists: stored.alreadyExists,
    reportVersion: persisted.nextVersion,
  };
}
