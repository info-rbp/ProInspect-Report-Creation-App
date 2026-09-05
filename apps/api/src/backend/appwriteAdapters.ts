import { createHash, randomUUID } from 'node:crypto';
import {
  Query,
  createAppwriteServerServices,
  loadAppwriteServerConfig,
  type AppwriteServerServices,
} from '@pcr/appwrite-server';
import {
  IMMUTABLE_REPORT_STATUSES,
  REPORT_CONTENT_LOCKED_STATUSES,
  calculateWorkflowGateContext,
  transitionReport,
  WorkflowError,
  type AgencyMembership,
  type AuthenticatedPrincipal,
  type ReportAggregate,
  type UserRole,
} from '@pcr/domain';
import type { AuditWriter, MembershipRepository, SecurityAuditEvent } from '../security/types.js';
import { IdempotencyConflictError, IdempotencyInProgressError } from './idempotency.js';
import type {
  IdempotencyResult,
  IdempotencyStore,
  OperationalRepository,
  Page,
  NotificationDeliveryStore,
  NotificationDeliveryUpdate,
  ReportAggregateStore,
  ReportTransitionCommand,
  ReportVersionReader,
  ReportVersionSnapshot,
  StoredRecord,
  TaskDispatcher,
  TaskKind,
  UploadSessionIssuer,
} from './types.js';

const COLLECTION_TABLES: Readonly<Record<string, string>> = {
  agencies: 'agencies', managedSites: 'managed_sites', userProfiles: 'user_profiles',
  agencyMemberships: 'agency_memberships', siteMemberships: 'site_memberships', clients: 'clients',
  clientContacts: 'client_contacts', properties: 'properties', buildings: 'buildings',
  propertyLevels: 'property_levels', propertyAreas: 'property_areas', serviceDefinitions: 'service_definitions',
  serviceRequests: 'service_requests', serviceRequestItems: 'service_request_items', shopifyServiceMappings: 'shopify_service_mappings',
  inspectionRequests: 'inspection_requests', inspectionJobs: 'inspection_jobs', inspectionTemplates: 'inspection_templates',
  inspectionTemplateVersions: 'inspection_template_versions', inspections: 'inspections', inspectionSections: 'inspection_sections',
  observations: 'observations', inspectionEvidence: 'inspection_evidence', reports: 'reports', reportVersions: 'report_versions',
  maintenanceCandidates: 'maintenance_candidates', maintenanceItems: 'maintenance_items', maintenanceQuotes: 'maintenance_quotes',
  maintenanceEstimates: 'maintenance_estimates', maintenanceApprovals: 'maintenance_approvals', maintenanceWorkOrders: 'maintenance_work_orders',
  maintenanceVariations: 'maintenance_variations', preventiveMaintenance: 'preventive_maintenance', warrantyClaims: 'warranty_claims',
  contractorQuoteRequests: 'contractor_quote_requests', contractorQuotes: 'contractor_quotes', workRequests: 'work_requests',
  tenantInstructions: 'tenant_instructions', externalContacts: 'external_contacts', dailyActivityLogs: 'daily_activity_logs',
  residentRequests: 'resident_requests', contractorAttendance: 'contractor_attendance', keyTransactions: 'key_transactions',
  accessDevices: 'access_devices', accessDeviceHistory: 'access_device_history', moveBookings: 'move_bookings',
  residentOnboarding: 'resident_onboarding', operationalInspections: 'operational_inspections', assets: 'assets',
  maintenancePlans: 'maintenance_plans', wasteEvents: 'waste_events', incidents: 'incidents',
  bylawObservations: 'bylaw_observations', notices: 'notices', communications: 'communications', handovers: 'handovers',
  handoverChecklistItems: 'handover_checklist_items', operationalReportDrafts: 'operational_report_drafts', operationalReports: 'operational_reports',
  people: 'people', peopleInvitations: 'people_invitations', workforceProfiles: 'workforce_profiles', tenants: 'tenants', tenancies: 'tenancies', tenancyParticipants: 'tenancy_participants', occupancies: 'occupancies',
  units: 'units', contractors: 'contractors', propertyClientRelationships: 'property_client_relationships', keyRegister: 'key_register',
  accessDeviceRequests: 'access_device_requests', defects: 'defects', operationalInspectionCheckpoints: 'operational_inspection_checkpoints',
  operationalInspectionResults: 'operational_inspection_results', serviceEvents: 'service_events', wasteServices: 'waste_services',
  tasks: 'tasks', calendarEvents: 'calendar_events', documents: 'documents', inventoryItems: 'inventory_items', notifications: 'notifications',
  formSubmissions: 'form_submissions', idempotencyKeys: 'idempotency_keys', uploadSessions: 'upload_sessions',
  propertyOperatingSettings: 'property_operating_settings', operationalQuotes: 'operational_quotes',
  operationalApprovals: 'operational_approvals', operationalWorkOrders: 'operational_work_orders', reportReviewComments: 'report_review_comments',
  reportDistributions: 'report_distributions', reportAcknowledgements: 'report_acknowledgements', reportRecipientResponses: 'report_recipient_responses',
  reportSupersessions: 'report_supersessions', tenantCommunications: 'tenant_communications', tenancyDocuments: 'tenancy_documents',
  tenantPortalGrants: 'tenant_portal_grants', auditEvents: 'audit_events', integrationConnections: 'integration_connections',
  integrationEvents: 'integration_events', integrationDeliveries: 'integration_deliveries', integrationExceptions: 'integration_exceptions',
  integrationOutbox: 'integration_outbox', evidenceFiles: 'evidence_files', portalEntitlements: 'portal_entitlements',
  contractorCompliance: 'contractor_compliance', offerPartners: 'offer_partners', offers: 'offers', offerRedemptions: 'offer_redemptions',
  conversations: 'conversations', conversationParticipants: 'conversation_participants', conversationMessages: 'conversation_messages',
  notificationPreferences: 'notification_preferences', appointmentAvailability: 'appointment_availability', appointmentBookings: 'appointment_bookings',
  routePlans: 'route_plans', routePlanStops: 'route_plan_stops', offlineSyncReceipts: 'offline_sync_receipts',
};

const VERSIONED_TABLES = new Set([
  'inspection_jobs', 'inspection_template_versions', 'inspections', 'reports', 'report_versions',
  'maintenance_items', 'maintenance_work_orders', 'operational_report_drafts', 'documents', 'tenancy_documents',
]);
const FILTERABLE_COLUMNS = new Set([
  'managedSiteId', 'buildingId', 'locationId', 'unitId', 'propertyId', 'clientAccountId',
  'contractorId', 'assignedUserId', 'assigneeUserId', 'requestedByUserId', 'residentUserId', 'inspectorId', 'analystId', 'reviewerId',
  'participantId', 'userId', 'status', 'linkedEntityType', 'linkedEntityId', 'conversationId', 'routePlanId',
  'offerId', 'serviceDefinitionId',
]);

function tableId(collection: string): string {
  const value = COLLECTION_TABLES[collection];
  if (!value) throw Object.assign(new Error(`No Appwrite table mapping exists for ${collection}.`), { code: 'APPWRITE_TABLE_MAPPING_MISSING' });
  return value;
}

function publicRecord(row: Record<string, unknown>): StoredRecord {
  const id = String(row.$id ?? row.id ?? '');
  const createdAt = String(row.createdAt ?? row.$createdAt ?? new Date(0).toISOString());
  const updatedAt = String(row.updatedAt ?? row.$updatedAt ?? createdAt);
  const explicitVersion = typeof row.version === 'number' ? row.version : undefined;
  const timestampVersion = Math.max(1, Date.parse(String(row.$updatedAt ?? updatedAt)) || 1);
  const value = { ...row };
  for (const key of ['$id', '$createdAt', '$updatedAt', '$permissions', '$databaseId', '$tableId', '$sequence']) delete value[key];
  return { ...value, id, agencyId: String(row.agencyId ?? ''), version: explicitVersion ?? timestampVersion, createdAt, updatedAt } as StoredRecord;
}

function writeData(input: Record<string, unknown>, actorId: string, existing?: Record<string, unknown>): Record<string, unknown> {
  const now = new Date().toISOString();
  const value = { ...input };
  for (const field of ['id', '$id', '$createdAt', '$updatedAt', '$permissions', '$databaseId', '$tableId', '$sequence']) delete value[field];
  if (!existing) {
    value.status = typeof value.status === 'string' ? value.status : 'active';
    value.createdAt = typeof value.createdAt === 'string' ? value.createdAt : now;
    value.createdBy = typeof value.createdBy === 'string' ? value.createdBy : actorId;
  }
  value.updatedAt = now;
  value.updatedBy = actorId;
  return value;
}

export function createAppwriteApiServices(env: NodeJS.ProcessEnv = process.env): AppwriteServerServices {
  return createAppwriteServerServices(loadAppwriteServerConfig(env));
}

export class AppwriteOperationalRepository implements OperationalRepository {
  constructor(private readonly services: AppwriteServerServices) {}

  async list(
    collection: string,
    agencyId: string,
    limit: number,
    cursor?: string,
    filters: Record<string, string | number | boolean> = {},
  ): Promise<Page<StoredRecord>> {
    const filterQueries = Object.entries(filters).map(([column, value]) => {
      if (!FILTERABLE_COLUMNS.has(column)) throw Object.assign(new Error(`Unsupported Appwrite query filter: ${column}.`), { code: 'APPWRITE_FILTER_NOT_ALLOWED' });
      return Query.equal(column, [value]);
    });
    const queries = [Query.equal('agencyId', [agencyId]), ...filterQueries, Query.limit(limit), ...(cursor ? [Query.cursorAfter(cursor)] : [])];
    const result = await this.services.tables.listRows({ databaseId: this.services.databaseId, tableId: tableId(collection), queries });
    const items = result.rows.map((row) => publicRecord(row as unknown as Record<string, unknown>));
    return { items, ...(items.length === limit ? { nextCursor: items.at(-1)?.id } : {}) };
  }

  async get(collection: string, agencyId: string, id: string): Promise<StoredRecord | undefined> {
    try {
      const row = await this.services.tables.getRow({ databaseId: this.services.databaseId, tableId: tableId(collection), rowId: id });
      const record = publicRecord(row as unknown as Record<string, unknown>);
      return record.agencyId === agencyId ? record : undefined;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && Number((error as { code?: unknown }).code) === 404) return undefined;
      throw error;
    }
  }

  async create(collection: string, agencyId: string, id: string, data: Record<string, unknown>, actorId: string): Promise<StoredRecord> {
    const row = await this.services.tables.createRow({
      databaseId: this.services.databaseId, tableId: tableId(collection), rowId: id,
      data: writeData({ ...data, agencyId }, actorId), permissions: [],
    });
    return publicRecord(row as unknown as Record<string, unknown>);
  }

  async update(collection: string, agencyId: string, id: string, data: Record<string, unknown>, expectedVersion: number, actorId: string): Promise<StoredRecord> {
    const current = await this.get(collection, agencyId, id);
    if (!current) throw Object.assign(new Error('Record not found.'), { code: 'NOT_FOUND', status: 404 });
    if (current.version !== expectedVersion) throw Object.assign(new Error('Record changed. Reload and retry.'), { code: 'VERSION_CONFLICT', status: 409 });
    const mappedTable = tableId(collection);
    const patch = writeData(data, actorId, current);
    if (VERSIONED_TABLES.has(mappedTable)) patch.version = (typeof current.version === 'number' && current.version < 10_000_000_000 ? current.version : 0) + 1;
    const row = await this.services.tables.updateRow({ databaseId: this.services.databaseId, tableId: mappedTable, rowId: id, data: patch });
    return publicRecord(row as unknown as Record<string, unknown>);
  }
}

function appwriteErrorCode(error: unknown): number | undefined {
  return error && typeof error === 'object' && 'code' in error
    ? Number((error as { code?: unknown }).code)
    : undefined;
}

function reportError(code: string, status: number, message: string): Error {
  return Object.assign(new Error(message), { code, status });
}

function reportSnapshot(aggregate: ReportAggregate): string {
  return JSON.stringify(aggregate);
}

function parseReportSnapshot(value: unknown): ReportAggregate {
  if (typeof value !== 'string') throw reportError('REPORT_SNAPSHOT_MISSING', 500, 'The report snapshot is missing.');
  const parsed = JSON.parse(value) as Partial<ReportAggregate>;
  if (!parsed.report || !Array.isArray(parsed.areas)) {
    throw reportError('REPORT_SNAPSHOT_INVALID', 500, 'The report snapshot is invalid.');
  }
  return parsed as ReportAggregate;
}

function reportContentHash(snapshot: string): string {
  return createHash('sha256').update(snapshot).digest('hex');
}

function reportVersionFromRow(
  row: Record<string, unknown>,
): ReportVersionSnapshot {
  const aggregate = parseReportSnapshot(row.snapshot);
  const id = String(row.$id ?? '');
  const createdAt = String(
    row.createdAt ?? row.$createdAt ?? new Date(0).toISOString(),
  );
  const updatedAt = String(
    row.updatedAt ?? row.$updatedAt ?? createdAt,
  );

  return {
    id,
    agencyId: String(row.agencyId ?? ''),
    reportId: String(row.reportId ?? aggregate.report.id),
    version: Number(row.version ?? aggregate.report.version ?? 0),
    immutable: row.immutable === true,
    status: String(
      row.status ?? aggregate.report.lifecycleStatus ?? 'draft',
    ),
    createdAt,
    updatedAt,
    aggregate: {
      ...aggregate,
      report: {
        ...aggregate.report,
        currentVersionId: id,
        version: Number(row.version ?? aggregate.report.version ?? 0),
      },
    },
    ...(typeof row.contentHash === 'string'
      ? { contentHash: row.contentHash }
      : {}),
    ...(typeof row.createdBy === 'string'
      ? { createdBy: row.createdBy }
      : {}),
    ...(typeof row.updatedBy === 'string'
      ? { updatedBy: row.updatedBy }
      : {}),
    ...(typeof row.finalisedAt === 'string'
      ? { finalisedAt: row.finalisedAt }
      : {}),
    ...(typeof row.supersedesVersionId === 'string'
      ? { supersedesVersionId: row.supersedesVersionId }
      : {}),
  };
}

export class AppwriteReportVersionReader implements ReportVersionReader {
  constructor(private readonly services: AppwriteServerServices) {}

  async get(
    agencyId: string,
    reportId: string,
    versionId: string,
  ): Promise<ReportVersionSnapshot | undefined> {
    try {
      const row = await this.services.tables.getRow({
        databaseId: this.services.databaseId,
        tableId: 'report_versions',
        rowId: versionId,
      }) as unknown as Record<string, unknown>;

      if (
        row.agencyId !== agencyId
        || row.reportId !== reportId
      ) {
        return undefined;
      }

      return reportVersionFromRow(row);
    } catch (error) {
      if (appwriteErrorCode(error) === 404) return undefined;
      throw error;
    }
  }

  async list(
    agencyId: string,
    reportId: string,
  ): Promise<ReportVersionSnapshot[]> {
    const values: ReportVersionSnapshot[] = [];
    let cursor: string | undefined;

    do {
      const result = await this.services.tables.listRows({
        databaseId: this.services.databaseId,
        tableId: 'report_versions',
        queries: [
          Query.equal('reportId', [reportId]),
          Query.limit(100),
          ...(cursor ? [Query.cursorAfter(cursor)] : []),
        ],
      });

      const rows = result.rows as unknown as Record<string, unknown>[];

      for (const row of rows) {
        if (row.agencyId !== agencyId) continue;
        values.push(reportVersionFromRow(row));
      }

      cursor = rows.length === 100
        ? String(rows.at(-1)?.$id ?? '')
        : undefined;
    } while (cursor);

    return values.sort(
      (left, right) =>
        left.version - right.version
        || left.createdAt.localeCompare(right.createdAt),
    );
  }
}

export class AppwriteNotificationDeliveryStore
implements NotificationDeliveryStore {
  constructor(private readonly services: AppwriteServerServices) {}

  private async row(
    tableId: string,
    rowId: string,
  ): Promise<Record<string, unknown> | undefined> {
    try {
      return await this.services.tables.getRow({
        databaseId: this.services.databaseId,
        tableId,
        rowId,
      }) as unknown as Record<string, unknown>;
    } catch (error) {
      if (appwriteErrorCode(error) === 404) return undefined;
      throw error;
    }
  }

  async update(input: NotificationDeliveryUpdate): Promise<void> {
    const now = new Date().toISOString();
    const actorId = 'system:notification-callback';

    const notification = await this.row(
      'notifications',
      input.notificationId,
    );

    if (
      notification
      && notification.agencyId === input.agencyId
    ) {
      await this.services.tables.updateRow({
        databaseId: this.services.databaseId,
        tableId: 'notifications',
        rowId: input.notificationId,
        data: {
          deliveryStatus: input.status,
          updatedAt: now,
          updatedBy: actorId,
          ...(input.status === 'sent' || input.status === 'delivered'
            ? { sentAt: now }
            : {}),
        },
      });
    }

    if (input.communicationId) {
      const communication = await this.row(
        'tenant_communications',
        input.communicationId,
      );

      if (
        communication
        && communication.agencyId === input.agencyId
      ) {
        await this.services.tables.updateRow({
          databaseId: this.services.databaseId,
          tableId: 'tenant_communications',
          rowId: input.communicationId,
          data: {
            updatedAt: now,
            updatedBy: actorId,
            ...(input.status === 'sent' || input.status === 'delivered'
              ? { sentAt: now }
              : {}),
            ...(input.status === 'delivered'
              ? { deliveredAt: now }
              : {}),
          },
        });
      }
    }

    const metadata = input.metadata ?? {};
    const provider = String(metadata.provider ?? 'notification')
      .slice(0, 64);
    const providerStatus = String(
      metadata.providerStatus ?? input.status,
    );

    const externalDeliveryId = String(
      metadata.providerMessageId
      ?? `${input.notificationId}:${providerStatus}`,
    ).slice(0, 255);

    const deliveryId = createHash('sha256')
      .update(
        `${input.agencyId}:${provider}:${externalDeliveryId}`,
      )
      .digest('hex')
      .slice(0, 36);

    const existing = await this.row(
      'integration_deliveries',
      deliveryId,
    );

    const detail = JSON.stringify(metadata);

    if (existing) {
      await this.services.tables.updateRow({
        databaseId: this.services.databaseId,
        tableId: 'integration_deliveries',
        rowId: deliveryId,
        data: {
          deliveryStatus: input.status,
          attempts: Number(existing.attempts ?? 0) + 1,
          lastAttemptedAt: now,
          errorState: detail,
          updatedAt: now,
          updatedBy: actorId,
          ...(input.status === 'delivered'
            ? { deliveredAt: now }
            : {}),
        },
      });
      return;
    }

    await this.services.tables.createRow({
      databaseId: this.services.databaseId,
      tableId: 'integration_deliveries',
      rowId: deliveryId,
      permissions: [],
      data: {
        agencyId: input.agencyId,
        status: 'active',
        provider,
        eventId: input.notificationId,
        externalDeliveryId,
        deliveryStatus: input.status,
        attempts: 1,
        lastAttemptedAt: now,
        errorState: detail,
        createdAt: now,
        updatedAt: now,
        createdBy: actorId,
        updatedBy: actorId,
        ...(input.status === 'delivered'
          ? { deliveredAt: now }
          : {}),
      },
    });
  }
}


export class AppwriteReportAggregateStore implements ReportAggregateStore {
  constructor(private readonly services: AppwriteServerServices) {}

  private async row(reportId: string, transactionId?: string): Promise<Record<string, unknown> | undefined> {
    try {
      return await this.services.tables.getRow({
        databaseId: this.services.databaseId,
        tableId: 'reports',
        rowId: reportId,
        transactionId,
      }) as unknown as Record<string, unknown>;
    } catch (error) {
      if (appwriteErrorCode(error) === 404) return undefined;
      throw error;
    }
  }

  private async aggregate(row: Record<string, unknown>, transactionId?: string): Promise<ReportAggregate> {
    const versionId = String(row.currentVersionId ?? '');
    if (!versionId) throw reportError('REPORT_SNAPSHOT_MISSING', 500, 'The report has no current Appwrite snapshot.');
    const version = await this.services.tables.getRow({
      databaseId: this.services.databaseId,
      tableId: 'report_versions',
      rowId: versionId,
      transactionId,
    }) as unknown as Record<string, unknown>;
    const aggregate = parseReportSnapshot(version.snapshot);
    return {
      ...aggregate,
      report: {
        ...aggregate.report,
        lifecycleStatus: String(row.lifecycleStatus) as ReportAggregate['report']['lifecycleStatus'],
        currentVersionId: versionId,
        version: Number(row.version),
        createdAt: String(row.createdAt ?? aggregate.report.createdAt),
        updatedAt: String(row.updatedAt ?? aggregate.report.updatedAt),
        ...(typeof row.finalisedAt === 'string' ? { finalisedAt: row.finalisedAt } : {}),
      },
    };
  }

  async load(agencyId: string, reportId: string): Promise<ReportAggregate | undefined> {
    const row = await this.row(reportId);
    if (!row || row.agencyId !== agencyId) return undefined;
    return this.aggregate(row);
  }

  async saveDraft(
    aggregate: ReportAggregate,
    expectedVersion: number | undefined,
    actorId: string,
  ): Promise<ReportAggregate> {
    const transaction = await this.services.tables.createTransaction({ ttl: 60 });
    const transactionId = transaction.$id;
    try {
      const existing = await this.row(aggregate.report.id, transactionId);
      if (existing && existing.agencyId !== aggregate.report.agencyId) throw reportError('NOT_FOUND', 404, 'Report not found.');
      const lifecycle = existing
        ? String(existing.lifecycleStatus) as ReportAggregate['report']['lifecycleStatus']
        : aggregate.report.lifecycleStatus;
      if (existing && (IMMUTABLE_REPORT_STATUSES.has(lifecycle) || REPORT_CONTENT_LOCKED_STATUSES.has(lifecycle))) {
        throw reportError('REPORT_IMMUTABLE', 409, 'Locked or finalised report content must be superseded.');
      }
      if (existing && expectedVersion === undefined) throw reportError('EXPECTED_VERSION_REQUIRED', 400, 'expectedVersion is required.');
      if (existing && Number(existing.version) !== expectedVersion) throw reportError('VERSION_CONFLICT', 409, 'The report changed. Reload and retry.');
      if (!existing && expectedVersion !== undefined) throw reportError('VERSION_CONFLICT', 409, 'The report does not yet exist.');

      const timestamp = new Date().toISOString();
      const nextVersion = existing ? Number(existing.version) + 1 : 1;
      const versionId = randomUUID();
      const stored: ReportAggregate = {
        ...aggregate,
        report: {
          ...aggregate.report,
          lifecycleStatus: lifecycle,
          currentVersionId: versionId,
          version: nextVersion,
          createdAt: String(existing?.createdAt ?? aggregate.report.createdAt ?? timestamp),
          updatedAt: timestamp,
        },
      };
      const snapshot = reportSnapshot(stored);
      await this.services.tables.createRow({
        databaseId: this.services.databaseId,
        tableId: 'report_versions',
        rowId: versionId,
        transactionId,
        permissions: [],
        data: {
          agencyId: aggregate.report.agencyId, reportId: aggregate.report.id, version: nextVersion,
          contentHash: reportContentHash(snapshot), snapshot, immutable: false, status: 'draft',
          createdAt: timestamp, updatedAt: timestamp, createdBy: actorId, updatedBy: actorId,
          ...(existing?.currentVersionId ? { supersedesVersionId: String(existing.currentVersionId) } : {}),
        },
      });
      const reportData = {
        agencyId: aggregate.report.agencyId, status: 'active', lifecycleStatus: lifecycle,
        currentVersionId: versionId, version: nextVersion,
        createdAt: String(existing?.createdAt ?? timestamp), updatedAt: timestamp,
        createdBy: String(existing?.createdBy ?? actorId), updatedBy: actorId,
        ...(aggregate.report.inspectionJobId ? { inspectionJobId: aggregate.report.inspectionJobId } : {}),
        ...(aggregate.report.propertyId ? { propertyId: aggregate.report.propertyId } : {}),
      };
      if (existing) {
        await this.services.tables.updateRow({ databaseId: this.services.databaseId, tableId: 'reports', rowId: aggregate.report.id, transactionId, data: reportData });
      } else {
        await this.services.tables.createRow({ databaseId: this.services.databaseId, tableId: 'reports', rowId: aggregate.report.id, transactionId, permissions: [], data: reportData });
      }
      await this.services.tables.updateTransaction({ transactionId, commit: true });
      return stored;
    } catch (error) {
      await this.services.tables.updateTransaction({ transactionId, rollback: true }).catch(() => undefined);
      throw error;
    }
  }

  async transition(agencyId: string, command: ReportTransitionCommand): Promise<Record<string, unknown>> {
    const transaction = await this.services.tables.createTransaction({ ttl: 60 });
    const transactionId = transaction.$id;
    try {
      const row = await this.row(command.reportId, transactionId);
      if (!row || row.agencyId !== agencyId) throw reportError('NOT_FOUND', 404, 'Report not found.');
      const aggregate = await this.aggregate(row, transactionId);
      if (IMMUTABLE_REPORT_STATUSES.has(aggregate.report.lifecycleStatus) && command.status !== 'archived') {
        throw reportError('REPORT_IMMUTABLE', 409, 'Finalised report data cannot return to an editable state.');
      }
      const gate = calculateWorkflowGateContext(aggregate);
      let event;
      try {
        event = transitionReport({
          entityId: command.reportId, current: aggregate.report.lifecycleStatus, requested: command.status,
          currentVersion: Number(row.version), expectedVersion: command.expectedVersion,
          actorId: command.actorId, actorRole: command.actorRole as UserRole,
          correlationId: command.correlationId, context: gate.context,
          ...(command.reason ? { reason: command.reason } : {}),
        });
      } catch (error) {
        if (error instanceof WorkflowError) throw reportError(error.code, error.code === 'VERSION_CONFLICT' ? 409 : 422, error.message);
        throw error;
      }
      const timestamp = event.occurredAt;
      const versionId = randomUUID();
      const next: ReportAggregate = {
        ...aggregate,
        report: {
          ...aggregate.report, lifecycleStatus: event.to, currentVersionId: versionId,
          version: event.resultingVersion, updatedAt: timestamp,
          ...(event.to === 'finalised' ? { finalisedAt: timestamp } : {}),
        },
      };
      const snapshot = reportSnapshot(next);
      await this.services.tables.createRow({
        databaseId: this.services.databaseId, tableId: 'report_versions', rowId: versionId,
        transactionId, permissions: [], data: {
          agencyId, reportId: command.reportId, version: event.resultingVersion,
          contentHash: reportContentHash(snapshot), snapshot,
          immutable: IMMUTABLE_REPORT_STATUSES.has(event.to), status: event.to,
          createdAt: timestamp, updatedAt: timestamp, createdBy: command.actorId, updatedBy: command.actorId,
          supersedesVersionId: String(row.currentVersionId),
          ...(event.to === 'finalised' ? { finalisedAt: timestamp } : {}),
        },
      });
      await this.services.tables.updateRow({
        databaseId: this.services.databaseId, tableId: 'reports', rowId: command.reportId,
        transactionId, data: {
          lifecycleStatus: event.to, currentVersionId: versionId, version: event.resultingVersion,
          updatedAt: timestamp, updatedBy: command.actorId,
          ...(event.to === 'finalised' ? { finalisedAt: timestamp, finalisedBy: command.actorId } : {}),
        },
      });
      await this.services.tables.createRow({
        databaseId: this.services.databaseId, tableId: 'audit_events', rowId: randomUUID(),
        transactionId, permissions: [], data: {
          agencyId, actorUserId: command.actorId, actorType: 'user', actorRole: command.actorRole,
          action: 'report.lifecycle_transition', entityType: 'report', entityId: command.reportId,
          source: 'proinspect_api', outcome: 'allowed', status: 'recorded', correlationId: command.correlationId,
          previousState: JSON.stringify({ lifecycleStatus: event.from, version: Number(row.version) }),
          newState: JSON.stringify({ lifecycleStatus: event.to, version: event.resultingVersion, versionId }),
          createdAt: timestamp, updatedAt: timestamp, createdBy: command.actorId, updatedBy: command.actorId,
        },
      });
      await this.services.tables.updateTransaction({ transactionId, commit: true });
      return { transition: event, report: next.report, versionId };
    } catch (error) {
      await this.services.tables.updateTransaction({ transactionId, rollback: true }).catch(() => undefined);
      throw error;
    }
  }
}

export class AppwriteIdempotencyStore implements IdempotencyStore {
  constructor(private readonly services: AppwriteServerServices) {}

  async execute(
    agencyId: string,
    operation: string,
    key: string,
    payloadHash: string,
    action: () => Promise<IdempotencyResult>,
  ): Promise<{ replayed: boolean; result: IdempotencyResult }> {
    const keyHash = createHash('sha256').update(key).digest('hex');
    const rowId = createHash('sha256').update(`${agencyId}:${operation}:${keyHash}`).digest('hex').slice(0, 36);
    const read = async () => this.services.tables.getRow({ databaseId: this.services.databaseId, tableId: 'idempotency_keys', rowId }) as unknown as Promise<Record<string, unknown>>;
    let existing: Record<string, unknown> | undefined;
    try { existing = await read(); } catch (error) { if (appwriteErrorCode(error) !== 404) throw error; }
    if (existing) return this.replay(existing, operation, payloadHash);
    const timestamp = new Date().toISOString();
    try {
      await this.services.tables.createRow({
        databaseId: this.services.databaseId, tableId: 'idempotency_keys', rowId, permissions: [],
        data: {
          agencyId, operation, keyHash, payloadHash, executionState: 'processing', status: 'active',
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          createdAt: timestamp, updatedAt: timestamp, createdBy: 'proinspect_api', updatedBy: 'proinspect_api',
        },
      });
    } catch (error) {
      if (appwriteErrorCode(error) !== 409) throw error;
      return this.replay(await read(), operation, payloadHash);
    }
    try {
      const result = await action();
      await this.services.tables.updateRow({
        databaseId: this.services.databaseId, tableId: 'idempotency_keys', rowId,
        data: { executionState: 'completed', responseStatus: result.status, responseBody: JSON.stringify(result.body), updatedAt: new Date().toISOString() },
      });
      return { replayed: false, result };
    } catch (error) {
      await this.services.tables.deleteRow({ databaseId: this.services.databaseId, tableId: 'idempotency_keys', rowId }).catch(() => undefined);
      throw error;
    }
  }

  private replay(row: Record<string, unknown>, operation: string, payloadHash: string): { replayed: boolean; result: IdempotencyResult } {
    if (row.operation !== operation || row.payloadHash !== payloadHash) {
      throw new IdempotencyConflictError('The idempotency key was already used with a different request.');
    }
    if (row.executionState !== 'completed' || typeof row.responseBody !== 'string') {
      throw new IdempotencyInProgressError('A request using this idempotency key is already in progress.');
    }
    return { replayed: true, result: { status: Number(row.responseStatus), body: JSON.parse(row.responseBody) } };
  }
}

export class AppwriteTaskOutbox implements TaskDispatcher {
  constructor(private readonly services: AppwriteServerServices) {}
  async dispatch(kind: TaskKind, agencyId: string, taskId: string, payload: Record<string, unknown>): Promise<void> {
    const timestamp = new Date().toISOString();
    await this.services.tables.createRow({
      databaseId: this.services.databaseId, tableId: 'integration_outbox', rowId: taskId, permissions: [],
      data: {
        agencyId, eventType: `${kind}.requested`, entityType: kind, entityId: taskId,
        payload: JSON.stringify(payload), deliveryStatus: 'pending', attempts: 0, availableAt: timestamp,
        status: 'active', createdAt: timestamp, updatedAt: timestamp, createdBy: 'proinspect_api', updatedBy: 'proinspect_api',
      },
    });
  }
}

export class AppwriteUploadSessionIssuer implements UploadSessionIssuer {
  constructor(private readonly services: AppwriteServerServices) {}
  async create(agencyId: string, uploadId: string, input: Record<string, unknown>, principal: AuthenticatedPrincipal): Promise<Record<string, unknown>> {
    const timestamp = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const bucketId = typeof input.bucketId === 'string' ? input.bucketId : 'inspection-evidence';
    const fileId = randomUUID();
    await this.services.tables.createRow({
      databaseId: this.services.databaseId, tableId: 'upload_sessions', rowId: uploadId, permissions: [],
      data: {
        agencyId, userId: principal.uid, bucketId, fileId,
        originalFilename: String(input.fileName), mimeType: String(input.contentType), size: Number(input.size),
        checksum: String(input.sha256), expiresAt, status: 'awaiting_binary',
        createdAt: timestamp, updatedAt: timestamp, createdBy: principal.uid, updatedBy: principal.uid,
        ...(typeof input.managedSiteId === 'string' ? { managedSiteId: input.managedSiteId } : {}),
        ...(typeof input.propertyId === 'string' ? { propertyId: input.propertyId } : {}),
        ...(typeof input.inspectionJobId === 'string' ? { inspectionJobId: input.inspectionJobId } : {}),
        ...(typeof input.reportId === 'string' ? { reportId: input.reportId } : {}),
        ...(typeof input.externalResourceType === 'string' ? { entityType: input.externalResourceType } : {}),
        ...(typeof input.externalResourceId === 'string' ? { entityId: input.externalResourceId } : {}),
      },
    });
    return { id: uploadId, agencyId, bucketId, fileId, expiresAt, status: 'awaiting_binary', uploadProvider: 'appwrite' };
  }
}

export class AppwriteMembershipRepository implements MembershipRepository {
  constructor(private readonly services: AppwriteServerServices) {}

  async getMembership(uid: string, agencyId: string): Promise<AgencyMembership | undefined> {
    const [agencyRows, siteRows, entitlementRows] = await Promise.all([
      this.services.tables.listRows({
        databaseId: this.services.databaseId, tableId: 'agency_memberships',
        queries: [Query.equal('userId', [uid]), Query.equal('agencyId', [agencyId]), Query.limit(2)],
      }),
      this.services.tables.listRows({
        databaseId: this.services.databaseId, tableId: 'site_memberships',
        queries: [Query.equal('userId', [uid]), Query.equal('agencyId', [agencyId]), Query.equal('status', ['active']), Query.limit(100)],
      }),
      this.services.tables.listRows({
        databaseId: this.services.databaseId, tableId: 'portal_entitlements',
        queries: [Query.equal('userId', [uid]), Query.equal('agencyId', [agencyId]), Query.equal('status', ['active']), Query.limit(100)],
      }),
    ]);
    const row = agencyRows.rows[0] as unknown as Record<string, unknown> | undefined;
    if (!row) return undefined;
    const entitlements = entitlementRows.rows as unknown as Record<string, unknown>[];
    const values = (field: string) => [...new Set(entitlements.map((item) => String(item[field] ?? '')).filter(Boolean))];
    return {
      uid,
      agencyId,
      role: String(row.role) as AgencyMembership['role'],
      status: String(row.status) as AgencyMembership['status'],
      mfaRequired: row.mfaRequired === true,
      ...(typeof row.validUntil === 'string' ? { invitationExpiresAt: row.validUntil } : {}),
      siteIds: [...new Set([
        ...siteRows.rows.map((item) => String((item as unknown as Record<string, unknown>).managedSiteId)).filter(Boolean),
        ...values('managedSiteId'),
      ])],
      propertyIds: values('propertyId'),
      clientAccountIds: values('clientAccountId'),
      ...(values('contractorId')[0] ? { contractorId: values('contractorId')[0] } : {}),
      updatedAt: String(row.updatedAt ?? row.$updatedAt ?? new Date(0).toISOString()),
    };
  }
}

export class AppwriteAuditWriter implements AuditWriter {
  constructor(private readonly services: AppwriteServerServices) {}
  async append(event: SecurityAuditEvent): Promise<void> {
    const now = new Date().toISOString();
    await this.services.tables.createRow({
      databaseId: this.services.databaseId, tableId: 'audit_events', rowId: event.id || randomUUID(),
      data: {
        agencyId: event.agencyId, status: 'recorded', createdAt: event.timestamp || now, updatedAt: now,
        createdBy: event.actorId, updatedBy: event.actorId,
        ...(event.target?.managedSiteId ? { managedSiteId: event.target.managedSiteId } : {}),
        actorUserId: event.actorId, actorType: 'user', actorRole: event.actorRole,
        action: event.eventType ?? event.reason ?? event.capability,
        entityType: event.entityType ?? 'security_event',
        entityId: event.entityId ?? event.target?.reportId ?? event.target?.maintenanceItemId ?? event.target?.defectId ?? event.target?.managedSiteId ?? event.actorId,
        source: 'proinspect_api', outcome: event.outcome, correlationId: event.correlationId,
        ...(event.sourceIp ? { ipAddress: event.sourceIp } : {}),
        ...(event.userAgent ? { userAgent: event.userAgent } : {}), sourceCreatedAt: event.timestamp || now,
        ...(event.metadata ? { newState: JSON.stringify(event.metadata) } : {}),
      }, permissions: [],
    });
  }
}

export function appwriteCollectionTableMap(): Readonly<Record<string, string>> { return COLLECTION_TABLES; }
