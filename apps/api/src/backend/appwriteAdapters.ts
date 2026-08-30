import { randomUUID } from 'node:crypto';
import {
  Query,
  createAppwriteServerServices,
  loadAppwriteServerConfig,
  type AppwriteServerServices,
} from '@pcr/appwrite-server';
import type { AgencyMembership } from '@pcr/domain';
import type { AuditWriter, MembershipRepository, SecurityAuditEvent } from '../security/types.js';
import type { OperationalRepository, Page, StoredRecord } from './types.js';

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
  people: 'people', tenants: 'tenants', tenancies: 'tenancies', tenancyParticipants: 'tenancy_participants', occupancies: 'occupancies',
  units: 'units', contractors: 'contractors', propertyClientRelationships: 'property_client_relationships', keyRegister: 'key_register',
  accessDeviceRequests: 'access_device_requests', defects: 'defects', operationalInspectionCheckpoints: 'operational_inspection_checkpoints',
  operationalInspectionResults: 'operational_inspection_results', serviceEvents: 'service_events', wasteServices: 'waste_services',
  tasks: 'tasks', calendarEvents: 'calendar_events', documents: 'documents', inventoryItems: 'inventory_items', notifications: 'notifications',
  formSubmissions: 'form_submissions', propertyOperatingSettings: 'property_operating_settings', operationalQuotes: 'operational_quotes',
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
  'contractorId', 'assignedUserId', 'userId', 'status', 'linkedEntityType', 'linkedEntityId',
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
