import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import type {
  DocumentData,
  QueryDocumentSnapshot,
} from 'firebase-admin/firestore';
import type { ReportAggregate } from '@pcr/domain';
import { firestoreDb } from '../firestoreDatabase.js';
import type {
  ReportVersionReader,
  ReportVersionSnapshot,
} from './types.js';

function adminApp() {
  return getApps()[0] ?? initializeApp({ credential: applicationDefault() });
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : fallback;
}

async function snapshotFromDocument(
  agencyId: string,
  reportId: string,
  document: QueryDocumentSnapshot<DocumentData>,
): Promise<ReportVersionSnapshot> {
  const database = firestoreDb(adminApp());
  const data = document.data() as Record<string, unknown>;

  const root = await database
    .doc(`agencies/${agencyId}/reports/${reportId}`)
    .get();

  const reportData = root.exists
    ? root.data() as Record<string, unknown>
    : {};

  const areaSnapshot = await document.ref
    .collection('areas')
    .orderBy('sequence')
    .get();

  const areas: ReportAggregate['areas'] = [];

  for (const areaDocument of areaSnapshot.docs) {
    const area = areaDocument.data() as Record<string, unknown>;
    const componentSnapshot = await areaDocument.ref
      .collection('components')
      .get();

    const components = componentSnapshot.docs.map((componentDocument) => {
      const stored = componentDocument.data() as Record<string, unknown>;
      const copy = { ...stored };

      for (const field of [
        'agencyId',
        'reportId',
        'areaId',
        'createdAt',
        'updatedAt',
        'version',
        'versionId',
      ]) {
        delete copy[field];
      }

      return {
        id: text(copy.id) || componentDocument.id,
        ...copy,
      } as ReportAggregate['areas'][number]['components'][number];
    });

    areas.push({
      id: text(area.id) || areaDocument.id,
      name: text(area.name) || areaDocument.id,
      sequence: numberValue(area.sequence, areas.length + 1),
      overallCommentary: text(area.overallCommentary),
      photoReferences: Array.isArray(area.photoReferences)
        ? area.photoReferences as ReportAggregate['areas'][number]['photoReferences']
        : [],
      ...(typeof area.canonicalAreaDefinitionId === 'string'
        ? { canonicalAreaDefinitionId: area.canonicalAreaDefinitionId }
        : {}),
      ...(typeof area.canonicalAreaDefinitionVersion === 'number'
        ? { canonicalAreaDefinitionVersion: area.canonicalAreaDefinitionVersion }
        : {}),
      ...(typeof area.templateAreaReferenceId === 'string'
        ? { templateAreaReferenceId: area.templateAreaReferenceId }
        : {}),
      components,
    });
  }

  const version = numberValue(
    data.sequence,
    numberValue(data.version, numberValue(reportData.version, 1)),
  );

  const createdAt =
    text(data.createdAt)
    || text(document.createTime?.toDate().toISOString())
    || new Date(0).toISOString();

  const updatedAt = text(data.updatedAt) || createdAt;

  const lifecycleStatus = text(
    data.lifecycleStatus
    ?? data.status
    ?? reportData.lifecycleStatus
    ?? 'draft',
  ) as ReportAggregate['report']['lifecycleStatus'];

  const aggregate: ReportAggregate = {
    report: {
      ...reportData,
      id: reportId,
      agencyId,
      currentVersionId: document.id,
      lifecycleStatus,
      version,
      createdAt: text(reportData.createdAt) || createdAt,
      updatedAt,
    } as ReportAggregate['report'],
    areas,
  };

  return {
    id: document.id,
    agencyId,
    reportId,
    version,
    immutable: data.immutable === true,
    status: lifecycleStatus,
    createdAt,
    updatedAt,
    aggregate,
    ...(typeof data.contentHash === 'string'
      ? { contentHash: data.contentHash }
      : {}),
    ...(typeof data.createdBy === 'string'
      ? { createdBy: data.createdBy }
      : {}),
    ...(typeof data.updatedBy === 'string'
      ? { updatedBy: data.updatedBy }
      : {}),
    ...(typeof data.finalisedAt === 'string'
      ? { finalisedAt: data.finalisedAt }
      : {}),
    ...(typeof data.supersedesVersionId === 'string'
      ? { supersedesVersionId: data.supersedesVersionId }
      : {}),
  };
}

export class FirestoreReportVersionReader implements ReportVersionReader {
  async get(
    agencyId: string,
    reportId: string,
    versionId: string,
  ): Promise<ReportVersionSnapshot | undefined> {
    const document = await firestoreDb(adminApp())
      .doc(
        `agencies/${agencyId}/reports/${reportId}/versions/${versionId}`,
      )
      .get();

    if (!document.exists) return undefined;

    return snapshotFromDocument(
      agencyId,
      reportId,
      document as QueryDocumentSnapshot<DocumentData>,
    );
  }

  async list(
    agencyId: string,
    reportId: string,
  ): Promise<ReportVersionSnapshot[]> {
    const snapshot = await firestoreDb(adminApp())
      .collection(`agencies/${agencyId}/reports/${reportId}/versions`)
      .orderBy('sequence', 'asc')
      .get();

    const values = await Promise.all(
      snapshot.docs.map((document) =>
        snapshotFromDocument(agencyId, reportId, document),
      ),
    );

    return values.sort(
      (left, right) =>
        left.version - right.version
        || left.createdAt.localeCompare(right.createdAt),
    );
  }
}
