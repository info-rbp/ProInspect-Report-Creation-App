import { createHash, randomUUID } from 'node:crypto';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import {
  getFirestore,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Transaction,
} from 'firebase-admin/firestore';
import {
  IMMUTABLE_REPORT_STATUSES,
  REPORT_CONTENT_LOCKED_STATUSES,
  calculateWorkflowGateContext,
  transitionReport,
  WorkflowError,
  type InspectionJobStatus,
  type ReportAggregate,
  type ReportAreaRecord,
  type ReportComponentRecord,
  type ReportLifecycleStatus,
  type ReportMetadataRecord,
  type UserRole,
} from '@pcr/domain';
import type { ReportAggregateStore, ReportTransitionCommand } from './types.js';

const MAX_TRANSACTION_WRITES = 450;
const VERSIONED_STATUSES = new Set<ReportLifecycleStatus>([
  'approved_for_issue',
  'tenant_submitted',
  'finalised',
  'archived',
]);

function adminApp() {
  return getApps()[0] ?? initializeApp({ credential: applicationDefault() });
}

function now(): string {
  return new Date().toISOString();
}

function reportReference(agencyId: string, reportId: string) {
  return getFirestore(adminApp()).doc(`agencies/${agencyId}/reports/${reportId}`);
}

function error(code: string, status: number, message: string, details?: Record<string, unknown>): Error {
  return Object.assign(new Error(message), { code, status, ...(details ? { details } : {}) });
}

function workflowError(err: WorkflowError): Error {
  if (err.code === 'VERSION_CONFLICT') return error(err.code, 409, err.message);
  if (err.code === 'GATE_NOT_MET') return error('WORKFLOW_GATES_NOT_MET', 422, err.message);
  return error(err.code, 400, err.message);
}

function jobStatus(status: ReportLifecycleStatus): InspectionJobStatus {
  const mapping: Partial<Record<ReportLifecycleStatus, InspectionJobStatus>> = {
    draft: 'draft',
    internal_review: 'analyst_review_in_progress',
    photos_uploaded: 'photos_uploaded',
    analysis_queued: 'analysis_queued',
    analysis_running: 'analysis_running',
    analysis_complete: 'analysis_complete',
    review_required: 'review_required',
    changes_requested: 'changes_requested',
    approved_for_issue: 'ready_to_issue',
    issued_to_tenant: 'issued_to_tenant',
    tenant_response_in_progress: 'tenant_response_in_progress',
    tenant_submitted: 'tenant_submitted',
    agent_response_required: 'agent_response_required',
    finalisation_ready: 'finalisation_ready',
    finalised: 'finalised',
    archived: 'archived',
    cancelled: 'cancelled',
  };
  return mapping[status] ?? 'on_hold';
}

function metadataFromAggregate(
  aggregate: ReportAggregate,
  timestamp: string,
  version: number,
): ReportMetadataRecord {
  const componentCount = aggregate.areas.reduce((count, area) => count + area.components.length, 0);
  return {
    ...aggregate.report,
    id: aggregate.report.id,
    agencyId: aggregate.report.agencyId,
    lifecycleStatus: aggregate.report.lifecycleStatus ?? 'draft',
    areaCount: aggregate.areas.length,
    componentCount,
    createdAt: aggregate.report.createdAt ?? timestamp,
    updatedAt: timestamp,
    version,
  };
}

function areaRecord(
  aggregate: ReportAggregate,
  area: ReportAggregate['areas'][number],
  timestamp: string,
): ReportAreaRecord {
  return {
    id: area.id,
    agencyId: aggregate.report.agencyId,
    reportId: aggregate.report.id,
    name: area.name,
    sequence: area.sequence,
    ...(area.overallCommentary ? { overallCommentary: area.overallCommentary } : {}),
    ...(area.photoReferences?.length ? { photoReferences: structuredClone(area.photoReferences) } : {}),
    componentCount: area.components.length,
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function componentRecord(
  aggregate: ReportAggregate,
  areaId: string,
  component: ReportAggregate['areas'][number]['components'][number],
  timestamp: string,
): ReportComponentRecord {
  return {
    ...component,
    agencyId: aggregate.report.agencyId,
    reportId: aggregate.report.id,
    areaId,
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

async function readAggregateInTransaction(
  transaction: Transaction,
  agencyId: string,
  reportId: string,
): Promise<{ report: ReportMetadataRecord; areas: ReportAreaRecord[]; components: ReportComponentRecord[] }> {
  const reference = reportReference(agencyId, reportId);
  const reportSnapshot = await transaction.get(reference);
  if (!reportSnapshot.exists) throw error('NOT_FOUND', 404, 'Report not found.');
  const report = reportSnapshot.data() as ReportMetadataRecord;
  const areaSnapshot = await transaction.get(reference.collection('areas'));
  const areas = areaSnapshot.docs
    .map((document) => document.data() as ReportAreaRecord)
    .sort((left, right) => left.sequence - right.sequence);
  const components: ReportComponentRecord[] = [];
  for (const area of areas) {
    const componentSnapshot = await transaction.get(
      reference.collection('areas').doc(area.id).collection('components'),
    );
    components.push(...componentSnapshot.docs.map((document) => document.data() as ReportComponentRecord));
  }
  return { report, areas, components };
}

function aggregateFromRecords(
  report: ReportMetadataRecord,
  areas: ReportAreaRecord[],
  components: ReportComponentRecord[],
): ReportAggregate {
  return {
    report,
    areas: areas.map((area) => ({
      id: area.id,
      name: area.name,
      sequence: area.sequence,
      ...(area.overallCommentary ? { overallCommentary: area.overallCommentary } : {}),
      ...(area.photoReferences?.length ? { photoReferences: structuredClone(area.photoReferences) } : {}),
      components: components
        .filter((component) => component.areaId === area.id)
        .map((component) => {
          const copy = { ...component } as Record<string, unknown>;
          for (const field of ['agencyId', 'reportId', 'areaId', 'createdAt', 'updatedAt', 'version']) {
            delete copy[field];
          }
          return copy as ReportAggregate['areas'][number]['components'][number];
        }),
    })),
  };
}

function setVersionSnapshot(
  transaction: Transaction,
  reportRef: DocumentReference<DocumentData>,
  records: { report: ReportMetadataRecord; areas: ReportAreaRecord[]; components: ReportComponentRecord[] },
  command: ReportTransitionCommand,
  timestamp: string,
): string {
  const versionId = randomUUID();
  const versionRef = reportRef.collection('versions').doc(versionId);
  const contentHash = createHash('sha256').update(JSON.stringify(records)).digest('hex');
  transaction.create(versionRef, {
    id: versionId,
    agencyId: command.agencyId,
    reportId: command.reportId,
    lifecycleStatus: command.status,
    sequence: records.report.version + 1,
    areaCount: records.areas.length,
    componentCount: records.components.length,
    contentHash,
    immutable: true,
    createdAt: timestamp,
    createdBy: command.actorId,
  });
  for (const area of records.areas) {
    transaction.create(versionRef.collection('areas').doc(area.id), { ...area, versionId });
  }
  for (const component of records.components) {
    transaction.create(
      versionRef.collection('areas').doc(component.areaId).collection('components').doc(component.id),
      { ...component, versionId },
    );
  }
  return versionId;
}

export class FirestoreReportAggregateStore implements ReportAggregateStore {
  async load(agencyId: string, reportId: string): Promise<ReportAggregate | undefined> {
    const reference = reportReference(agencyId, reportId);
    const reportSnapshot = await reference.get();
    if (!reportSnapshot.exists) return undefined;
    const report = reportSnapshot.data() as ReportMetadataRecord;
    if (report.agencyId !== agencyId) return undefined;
    const areaSnapshot = await reference.collection('areas').orderBy('sequence').get();
    const areas = areaSnapshot.docs.map((document) => document.data() as ReportAreaRecord);
    const components: ReportComponentRecord[] = [];
    for (const area of areas) {
      const componentSnapshot = await reference.collection('areas').doc(area.id).collection('components').get();
      components.push(...componentSnapshot.docs.map((document) => document.data() as ReportComponentRecord));
    }
    return aggregateFromRecords(report, areas, components);
  }

  async saveDraft(
    aggregate: ReportAggregate,
    expectedVersion: number | undefined,
    actorId: string,
  ): Promise<ReportAggregate> {
    const database = getFirestore(adminApp());
    const reference = reportReference(aggregate.report.agencyId, aggregate.report.id);
    const requestedWrites =
      1 + aggregate.areas.length + aggregate.areas.reduce((count, area) => count + area.components.length, 0);
    if (requestedWrites > MAX_TRANSACTION_WRITES) {
      throw error('REPORT_TOO_LARGE', 413, 'Report contains too many records for one atomic draft save.', {
        requestedWrites,
        maximum: MAX_TRANSACTION_WRITES,
      });
    }

    return database.runTransaction(async (transaction) => {
      const existingSnapshot = await transaction.get(reference);
      const existing = existingSnapshot.exists ? (existingSnapshot.data() as ReportMetadataRecord) : undefined;
      if (existing && IMMUTABLE_REPORT_STATUSES.has(existing.lifecycleStatus)) {
        throw error('REPORT_IMMUTABLE', 409, 'Finalised report data cannot be modified.');
      }
      if (existing && REPORT_CONTENT_LOCKED_STATUSES.has(existing.lifecycleStatus)) {
        throw error(
          'REPORT_CONTENT_LOCKED',
          409,
          'Approved or issued report content is locked. Request changes and create a superseding version instead of editing it in place.',
          { lifecycleStatus: existing.lifecycleStatus, currentVersionId: existing.currentVersionId },
        );
      }
      if (existing && expectedVersion === undefined) {
        throw error('EXPECTED_VERSION_REQUIRED', 400, 'expectedVersion is required when updating a report.');
      }
      if (existing && existing.version !== expectedVersion) {
        throw error('VERSION_CONFLICT', 409, 'The report has changed. Reload and retry.', {
          expectedVersion,
          actualVersion: existing.version,
        });
      }
      if (!existing && expectedVersion !== undefined) {
        throw error('VERSION_CONFLICT', 409, 'The report does not yet exist.');
      }

      const oldAreaSnapshot = await transaction.get(reference.collection('areas'));
      const oldComponentReferences: DocumentReference[] = [];
      for (const areaDocument of oldAreaSnapshot.docs) {
        const oldComponents = await transaction.get(areaDocument.ref.collection('components'));
        oldComponentReferences.push(...oldComponents.docs.map((document) => document.ref));
      }
      const totalWrites = requestedWrites + oldAreaSnapshot.size + oldComponentReferences.length;
      if (totalWrites > MAX_TRANSACTION_WRITES) {
        throw error('REPORT_TOO_LARGE', 413, 'Report replacement exceeds the atomic Firestore write limit.', {
          totalWrites,
          maximum: MAX_TRANSACTION_WRITES,
        });
      }

      for (const componentReference of oldComponentReferences) transaction.delete(componentReference);
      for (const areaDocument of oldAreaSnapshot.docs) transaction.delete(areaDocument.ref);

      const timestamp = now();
      const metadata = metadataFromAggregate(aggregate, timestamp, existing ? existing.version + 1 : 1);
      transaction.set(reference, { ...metadata, updatedBy: actorId, ...(existing ? {} : { createdBy: actorId }) });
      for (const area of aggregate.areas) {
        const storedArea = areaRecord(aggregate, area, timestamp);
        const areaRef = reference.collection('areas').doc(area.id);
        transaction.set(areaRef, storedArea);
        for (const component of area.components) {
          transaction.set(
            areaRef.collection('components').doc(component.id),
            componentRecord(aggregate, area.id, component, timestamp),
          );
        }
      }
      return aggregateFromRecords(
        metadata,
        aggregate.areas.map((area) => areaRecord(aggregate, area, timestamp)),
        aggregate.areas.flatMap((area) =>
          area.components.map((component) => componentRecord(aggregate, area.id, component, timestamp)),
        ),
      );
    });
  }

  async transition(agencyId: string, command: ReportTransitionCommand): Promise<Record<string, unknown>> {
    const database = getFirestore(adminApp());
    const reference = reportReference(agencyId, command.reportId);
    return database.runTransaction(async (transaction) => {
      const records = await readAggregateInTransaction(transaction, agencyId, command.reportId);
      let jobSnapshot: DocumentSnapshot | undefined;
      if (records.report.inspectionJobId) {
        jobSnapshot = await transaction.get(
          database.doc(`agencies/${agencyId}/inspectionJobs/${records.report.inspectionJobId}`),
        );
      }

      if (IMMUTABLE_REPORT_STATUSES.has(records.report.lifecycleStatus) && command.status !== 'archived') {
        throw error('REPORT_IMMUTABLE', 409, 'Finalised report data cannot return to an editable lifecycle state.');
      }

      const aggregate = aggregateFromRecords(records.report, records.areas, records.components);
      const gateEvaluation = calculateWorkflowGateContext(
        aggregate,
        jobSnapshot?.exists ? (jobSnapshot.data() as Record<string, unknown>) : undefined,
      );

      let transitionEvent;
      try {
        transitionEvent = transitionReport({
          entityId: command.reportId,
          current: records.report.lifecycleStatus,
          requested: command.status,
          currentVersion: records.report.version,
          expectedVersion: command.expectedVersion,
          actorId: command.actorId,
          actorRole: command.actorRole as UserRole,
          correlationId: command.correlationId,
          context: gateEvaluation.context,
          ...(command.reason ? { reason: command.reason } : {}),
        });
      } catch (err) {
        if (err instanceof WorkflowError) throw workflowError(err);
        throw err;
      }

      const versionWrites = VERSIONED_STATUSES.has(transitionEvent.to)
        ? 1 + records.areas.length + records.components.length
        : 0;
      const baseWrites = 3 + (jobSnapshot?.exists ? 1 : 0);
      if (versionWrites + baseWrites > MAX_TRANSACTION_WRITES) {
        throw error('REPORT_TOO_LARGE', 413, 'Report version exceeds the atomic Firestore write limit.');
      }

      const timestamp = transitionEvent.occurredAt;
      const versionCommand: ReportTransitionCommand = { ...command, status: transitionEvent.to };
      const versionId = VERSIONED_STATUSES.has(transitionEvent.to)
        ? setVersionSnapshot(transaction, reference, records, versionCommand, timestamp)
        : undefined;
      const updated = {
        ...records.report,
        lifecycleStatus: transitionEvent.to,
        version: transitionEvent.resultingVersion,
        updatedAt: timestamp,
        updatedBy: command.actorId,
        ...(command.assignedUserId
          ? { assignedUserId: command.assignedUserId }
          : records.report.assignedUserId
            ? { assignedUserId: records.report.assignedUserId }
            : {}),
        ...(transitionEvent.reason ? { transitionReason: transitionEvent.reason } : {}),
        ...(versionId ? { currentVersionId: versionId } : {}),
        ...(transitionEvent.to === 'finalised' ? { finalisedAt: timestamp } : {}),
        ...(transitionEvent.to === 'archived' ? { archivedAt: timestamp } : {}),
      };
      transaction.set(reference, updated);

      if (jobSnapshot?.exists) {
        transaction.update(jobSnapshot.ref, {
          status: jobStatus(transitionEvent.to),
          ...(command.assignedUserId ? { assignedUserId: command.assignedUserId } : {}),
          updatedAt: timestamp,
          updatedBy: command.actorId,
        });
      }

      const auditId = randomUUID();
      transaction.create(database.doc(`agencies/${agencyId}/auditEvents/${auditId}`), {
        id: auditId,
        agencyId,
        entityType: 'report',
        entityId: command.reportId,
        eventType: 'report.lifecycle_transition',
        actorId: command.actorId,
        actorRole: command.actorRole,
        timestamp,
        correlationId: command.correlationId,
        metadata: {
          from: transitionEvent.from,
          to: transitionEvent.to,
          reason: transitionEvent.reason ?? null,
          versionId: versionId ?? null,
        },
      });

      const notificationId = randomUUID();
      transaction.create(database.doc(`agencies/${agencyId}/notificationJobs/${notificationId}`), {
        id: notificationId,
        agencyId,
        reportId: command.reportId,
        inspectionJobId: records.report.inspectionJobId ?? null,
        type: 'report_lifecycle_changed',
        status: 'queued',
        lifecycleStatus: transitionEvent.to,
        queuedAt: timestamp,
        createdAt: timestamp,
        createdBy: command.actorId,
      });
      return updated;
    });
  }
}
