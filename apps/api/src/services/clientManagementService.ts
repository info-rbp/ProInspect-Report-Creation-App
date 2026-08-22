import { randomUUID } from 'node:crypto';
import {
  activePropertyClientRelationships,
  clientDisplayName,
  findClientDuplicateCandidates,
  legacyClientType,
  resolveClientMaintenanceApprovalRecipient,
  resolveClientSnapshot,
  type ClientAccount,
  type ClientContact,
  type ClientEngagement,
  type ClientSnapshot,
  type MaintenanceItem,
  type PropertyClientRelationship,
  type PropertyRecord,
} from '@pcr/domain';
import type { ApiDependencies, StoredRecord } from '../backend/types.js';

const MAX_PAGES = 100;
const PAGE_SIZE = 100;

function typed<T>(value: StoredRecord): T {
  return value as unknown as T;
}

export async function listAllClientRecords(
  dependencies: ApiDependencies,
  collection: string,
  agencyId: string,
): Promise<StoredRecord[]> {
  const items: StoredRecord[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await dependencies.repository.list(collection, agencyId, PAGE_SIZE, cursor);
    items.push(...result.items);
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  return items;
}

function currentRelationshipsForProperty(
  relationships: PropertyClientRelationship[],
  propertyId: string,
): PropertyClientRelationship[] {
  return activePropertyClientRelationships(relationships).filter(
    (relationship) => relationship.propertyId === propertyId,
  );
}

export interface ResolvedPropertyClientContext {
  propertyId: string;
  snapshot?: ClientSnapshot;
  account?: ClientAccount;
  relationships: PropertyClientRelationship[];
  contacts: ClientContact[];
  engagement?: ClientEngagement;
  warnings: string[];
}

export async function resolvePropertyClientContext(
  dependencies: ApiDependencies,
  agencyId: string,
  propertyId: string,
): Promise<ResolvedPropertyClientContext> {
  const property = await dependencies.repository.get('properties', agencyId, propertyId);
  if (!property) {
    throw Object.assign(new Error('Property was not found.'), { status: 404, code: 'PROPERTY_NOT_FOUND' });
  }
  const [accountRecords, contactRecords, relationshipRecords, engagementRecords] = await Promise.all([
    listAllClientRecords(dependencies, 'clients', agencyId),
    listAllClientRecords(dependencies, 'clientContacts', agencyId),
    listAllClientRecords(dependencies, 'propertyClientRelationships', agencyId),
    listAllClientRecords(dependencies, 'clientEngagements', agencyId),
  ]);
  const accounts = accountRecords.map(typed<ClientAccount>);
  const contacts = contactRecords.map(typed<ClientContact>);
  const relationships = relationshipRecords.map(typed<PropertyClientRelationship>);
  const engagements = engagementRecords.map(typed<ClientEngagement>);
  const currentRelationships = currentRelationshipsForProperty(relationships, propertyId);
  const snapshot = resolveClientSnapshot({
    propertyId,
    accounts,
    contacts,
    relationships: currentRelationships,
    engagements,
  });
  const account = snapshot
    ? accounts.find((candidate) => candidate.id === snapshot.clientAccountId)
    : undefined;
  const engagement = snapshot?.engagementId
    ? engagements.find((candidate) => candidate.id === snapshot.engagementId)
    : undefined;
  const warnings: string[] = [];
  if (!currentRelationships.length) warnings.push('No current Client relationship is linked to this Property.');
  if (currentRelationships.length && !snapshot) warnings.push('Current Client relationships could not be resolved to an active Client Account.');
  if (snapshot && !snapshot.reportRecipients.length) warnings.push('No report recipient is configured for the resolved Client Account.');
  if (snapshot && !snapshot.maintenanceApprover) warnings.push('No maintenance approval contact is configured for the resolved Client Account.');
  return {
    propertyId,
    ...(snapshot ? { snapshot } : {}),
    ...(account ? { account } : {}),
    relationships: currentRelationships,
    contacts: snapshot
      ? contacts.filter((contact) => currentRelationships.some((relationship) => relationship.clientAccountId === contact.clientAccountId))
      : [],
    ...(engagement ? { engagement } : {}),
    warnings,
  };
}

function openJobStatus(status: unknown): boolean {
  return !['finalised', 'archived', 'cancelled'].includes(String(status || ''));
}

function openMaintenanceStatus(status: unknown): boolean {
  return !['closed', 'dismissed', 'cancelled', 'duplicate', 'not_actionable'].includes(String(status || ''));
}

export async function syncPropertyClientContext(
  dependencies: ApiDependencies,
  input: {
    agencyId: string;
    propertyId: string;
    actorId: string;
  },
): Promise<{
  context: ResolvedPropertyClientContext;
  updatedProperty: boolean;
  requestsUpdated: number;
  jobsUpdated: number;
  maintenanceItemsUpdated: number;
}> {
  const context = await resolvePropertyClientContext(dependencies, input.agencyId, input.propertyId);
  const propertyRecord = await dependencies.repository.get('properties', input.agencyId, input.propertyId);
  if (!propertyRecord) throw Object.assign(new Error('Property was not found.'), { status: 404, code: 'PROPERTY_NOT_FOUND' });
  const clientIds = [...new Set(context.relationships.map((relationship) => relationship.clientAccountId))];
  const relationshipIds = context.relationships.map((relationship) => relationship.id);
  const existingClientIds = Array.isArray(propertyRecord.clientIds)
    ? propertyRecord.clientIds.filter((value): value is string => typeof value === 'string')
    : [];
  const existingRelationshipIds = Array.isArray(propertyRecord.currentClientRelationshipIds)
    ? propertyRecord.currentClientRelationshipIds.filter((value): value is string => typeof value === 'string')
    : [];
  let updatedProperty = false;
  if (
    JSON.stringify(existingClientIds) !== JSON.stringify(clientIds) ||
    JSON.stringify(existingRelationshipIds) !== JSON.stringify(relationshipIds)
  ) {
    await dependencies.repository.update(
      'properties',
      input.agencyId,
      input.propertyId,
      {
        clientIds,
        currentClientRelationshipIds: relationshipIds,
        clientMigrationStatus: context.relationships.length ? 'migrated' : 'review_required',
      },
      Number(propertyRecord.version),
      input.actorId,
    );
    updatedProperty = true;
  }
  if (!context.snapshot) {
    return { context, updatedProperty, requestsUpdated: 0, jobsUpdated: 0, maintenanceItemsUpdated: 0 };
  }

  const [requestRecords, jobRecords, maintenanceRecords] = await Promise.all([
    listAllClientRecords(dependencies, 'inspectionRequests', input.agencyId),
    listAllClientRecords(dependencies, 'inspectionJobs', input.agencyId),
    listAllClientRecords(dependencies, 'maintenanceItems', input.agencyId),
  ]);
  let requestsUpdated = 0;
  let jobsUpdated = 0;
  let maintenanceItemsUpdated = 0;
  for (const request of requestRecords) {
    if (request.propertyId !== input.propertyId || request.cancelledAt) continue;
    await dependencies.repository.update(
      'inspectionRequests',
      input.agencyId,
      request.id,
      {
        clientAccountId: context.snapshot.clientAccountId,
        ...(context.snapshot.engagementId ? { clientEngagementId: context.snapshot.engagementId } : {}),
        clientSnapshot: context.snapshot,
      },
      Number(request.version),
      input.actorId,
    );
    requestsUpdated += 1;
  }
  for (const job of jobRecords) {
    if (job.propertyId !== input.propertyId || !openJobStatus(job.status)) continue;
    await dependencies.repository.update(
      'inspectionJobs',
      input.agencyId,
      job.id,
      {
        clientAccountId: context.snapshot.clientAccountId,
        ...(context.snapshot.engagementId ? { clientEngagementId: context.snapshot.engagementId } : {}),
        clientSnapshot: context.snapshot,
      },
      Number(job.version),
      input.actorId,
    );
    jobsUpdated += 1;
  }
  for (const item of maintenanceRecords) {
    if (item.propertyId !== input.propertyId || !openMaintenanceStatus(item.status)) continue;
    await dependencies.repository.update(
      'maintenanceItems',
      input.agencyId,
      item.id,
      {
        clientAccountId: context.snapshot.clientAccountId,
        clientSnapshot: context.snapshot,
        ...(context.snapshot.maintenanceApprover?.contactId
          ? { maintenanceApprovalContactId: context.snapshot.maintenanceApprover.contactId }
          : {}),
      },
      Number(item.version),
      input.actorId,
    );
    maintenanceItemsUpdated += 1;
  }
  return { context, updatedProperty, requestsUpdated, jobsUpdated, maintenanceItemsUpdated };
}

export async function attachClientContextToRequest(
  dependencies: ApiDependencies,
  agencyId: string,
  request: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const propertyId = typeof request.propertyId === 'string' ? request.propertyId : '';
  if (!propertyId) return request;
  const context = await resolvePropertyClientContext(dependencies, agencyId, propertyId);
  if (!context.snapshot) return request;
  return {
    ...request,
    clientAccountId: context.snapshot.clientAccountId,
    ...(context.snapshot.engagementId ? { clientEngagementId: context.snapshot.engagementId } : {}),
    clientSnapshot: context.snapshot,
  };
}

export async function snapshotClientContextForJob(
  dependencies: ApiDependencies,
  agencyId: string,
  jobId: string,
  actorId: string,
): Promise<StoredRecord> {
  const job = await dependencies.repository.get('inspectionJobs', agencyId, jobId);
  if (!job) throw Object.assign(new Error('Inspection job was not found.'), { status: 404, code: 'JOB_NOT_FOUND' });
  const propertyId = typeof job.propertyId === 'string' ? job.propertyId : '';
  if (!propertyId) throw Object.assign(new Error('Inspection job has no linked Property.'), { status: 422, code: 'PROPERTY_REQUIRED' });
  const context = await resolvePropertyClientContext(dependencies, agencyId, propertyId);
  if (!context.snapshot) throw Object.assign(new Error('No current Client relationship is available for the Property.'), { status: 422, code: 'CLIENT_CONTEXT_REQUIRED' });
  return dependencies.repository.update(
    'inspectionJobs',
    agencyId,
    jobId,
    {
      clientAccountId: context.snapshot.clientAccountId,
      ...(context.snapshot.engagementId ? { clientEngagementId: context.snapshot.engagementId } : {}),
      clientSnapshot: context.snapshot,
    },
    Number(job.version),
    actorId,
  );
}

export async function snapshotClientContextForReport(
  dependencies: ApiDependencies,
  agencyId: string,
  reportId: string,
  actorId: string,
): Promise<StoredRecord> {
  const report = await dependencies.repository.get('reports', agencyId, reportId);
  if (!report) throw Object.assign(new Error('Report was not found.'), { status: 404, code: 'REPORT_NOT_FOUND' });
  const status = String(report.lifecycleStatus || 'draft');
  if (['approved_for_issue', 'issued_to_tenant', 'tenant_response_in_progress', 'tenant_submitted', 'agent_response_required', 'finalisation_ready', 'finalised', 'archived'].includes(status)) {
    if (report.clientSnapshot && report.clientAccountId) return report;
    throw Object.assign(new Error('Client context cannot be introduced after an immutable Report Version has been approved.'), { status: 409, code: 'REPORT_CLIENT_SNAPSHOT_LOCKED' });
  }
  const propertyId = typeof report.propertyId === 'string' ? report.propertyId : '';
  if (!propertyId) throw Object.assign(new Error('Report has no linked Property.'), { status: 422, code: 'PROPERTY_REQUIRED' });
  const context = await resolvePropertyClientContext(dependencies, agencyId, propertyId);
  if (!context.snapshot) throw Object.assign(new Error('No current Client relationship is available for the Property.'), { status: 422, code: 'CLIENT_CONTEXT_REQUIRED' });
  return dependencies.repository.update(
    'reports',
    agencyId,
    reportId,
    {
      clientAccountId: context.snapshot.clientAccountId,
      ...(context.snapshot.engagementId ? { clientEngagementId: context.snapshot.engagementId } : {}),
      clientName: context.snapshot.clientName,
      clientSnapshot: context.snapshot,
    },
    Number(report.version),
    actorId,
  );
}

export async function resolveMaintenanceClientContext(
  dependencies: ApiDependencies,
  agencyId: string,
  maintenanceItemId: string,
  amount = 0,
): Promise<{
  item: MaintenanceItem;
  context: ResolvedPropertyClientContext;
  approval: ReturnType<typeof resolveClientMaintenanceApprovalRecipient>;
}> {
  const itemRecord = await dependencies.repository.get('maintenanceItems', agencyId, maintenanceItemId);
  if (!itemRecord) throw Object.assign(new Error('Maintenance item was not found.'), { status: 404, code: 'MAINTENANCE_ITEM_NOT_FOUND' });
  const item = typed<MaintenanceItem>(itemRecord);
  const context = await resolvePropertyClientContext(dependencies, agencyId, item.propertyId);
  if (!context.snapshot) throw Object.assign(new Error('No current Client relationship is available for this Maintenance Item.'), { status: 422, code: 'CLIENT_CONTEXT_REQUIRED' });
  const maintenanceRelationship = context.relationships.find((relationship) => relationship.relationshipType === 'maintenance_authority');
  const approval = resolveClientMaintenanceApprovalRecipient({
    snapshot: context.snapshot,
    account: context.account,
    amount,
    emergency: item.priority === 'urgent',
    relationshipApprovalLimit: maintenanceRelationship?.propertyManagerApprovalLimit,
    relationshipEmergencyLimit: maintenanceRelationship?.emergencyAuthorisationLimit,
  });
  return { item, context, approval };
}

export async function clientOverview(
  dependencies: ApiDependencies,
  agencyId: string,
  clientAccountId: string,
): Promise<Record<string, unknown>> {
  const client = await dependencies.repository.get('clients', agencyId, clientAccountId);
  if (!client) throw Object.assign(new Error('Client Account was not found.'), { status: 404, code: 'CLIENT_NOT_FOUND' });
  const collections = await Promise.all([
    listAllClientRecords(dependencies, 'clientContacts', agencyId),
    listAllClientRecords(dependencies, 'propertyClientRelationships', agencyId),
    listAllClientRecords(dependencies, 'clientEngagements', agencyId),
    listAllClientRecords(dependencies, 'clientDocuments', agencyId),
    listAllClientRecords(dependencies, 'clientPortalUsers', agencyId),
    listAllClientRecords(dependencies, 'clientTimelineEvents', agencyId),
    listAllClientRecords(dependencies, 'inspectionJobs', agencyId),
    listAllClientRecords(dependencies, 'reports', agencyId),
    listAllClientRecords(dependencies, 'maintenanceItems', agencyId),
    listAllClientRecords(dependencies, 'inspectionRequests', agencyId),
  ]);
  const [contacts, relationships, engagements, documents, portalUsers, timeline, jobs, reports, maintenance, requests] = collections;
  const currentRelationships = activePropertyClientRelationships(
    relationships.map(typed<PropertyClientRelationship>),
  ).filter((relationship) => relationship.clientAccountId === clientAccountId);
  const propertyIds = [...new Set(currentRelationships.map((relationship) => relationship.propertyId))];
  const linked = (record: StoredRecord): boolean =>
    record.clientAccountId === clientAccountId ||
    propertyIds.includes(String(record.propertyId || '')) ||
    (record.clientSnapshot && typeof record.clientSnapshot === 'object' && (record.clientSnapshot as Record<string, unknown>).clientAccountId === clientAccountId);
  return {
    client,
    contacts: contacts.filter((record) => record.clientAccountId === clientAccountId),
    relationships: relationships.filter((record) => record.clientAccountId === clientAccountId),
    engagements: engagements.filter((record) => record.clientAccountId === clientAccountId),
    documents: documents.filter((record) => record.clientAccountId === clientAccountId),
    portalUsers: portalUsers.filter((record) => record.clientAccountId === clientAccountId),
    timeline: timeline.filter((record) => record.clientAccountId === clientAccountId).sort((left, right) => String(right.occurredAt || right.createdAt || '').localeCompare(String(left.occurredAt || left.createdAt || ''))),
    counts: {
      properties: propertyIds.length,
      activeJobs: jobs.filter((record) => linked(record) && openJobStatus(record.status)).length,
      reports: reports.filter(linked).length,
      openMaintenance: maintenance.filter((record) => linked(record) && openMaintenanceStatus(record.status)).length,
      pendingInspectionRequests: requests.filter((record) => linked(record) && !['converted', 'cancelled', 'duplicate', 'failed'].includes(String(record.intakeStatus || ''))).length,
    },
    recentJobs: jobs.filter(linked).sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''))).slice(0, 20),
    recentReports: reports.filter(linked).sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''))).slice(0, 20),
    recentMaintenance: maintenance.filter(linked).sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''))).slice(0, 20),
  };
}

export async function duplicateCandidates(
  dependencies: ApiDependencies,
  agencyId: string,
  candidate: Partial<ClientAccount> & { primaryEmail?: string },
): Promise<ReturnType<typeof findClientDuplicateCandidates>> {
  const accounts = (await listAllClientRecords(dependencies, 'clients', agencyId)).map(typed<ClientAccount>);
  return findClientDuplicateCandidates(candidate, accounts);
}

export async function createLegacyLandlordClient(
  dependencies: ApiDependencies,
  input: {
    agencyId: string;
    propertyId: string;
    actorId: string;
  },
): Promise<{ account: StoredRecord; contact: StoredRecord; relationship: StoredRecord; context: ResolvedPropertyClientContext }> {
  const propertyRecord = await dependencies.repository.get('properties', input.agencyId, input.propertyId);
  if (!propertyRecord) throw Object.assign(new Error('Property was not found.'), { status: 404, code: 'PROPERTY_NOT_FOUND' });
  const property = typed<PropertyRecord>(propertyRecord);
  if (!property.landlordDetails?.name?.trim()) {
    throw Object.assign(new Error('The Property does not contain legacy landlord details to migrate.'), { status: 422, code: 'LEGACY_LANDLORD_DETAILS_REQUIRED' });
  }
  const duplicate = await duplicateCandidates(dependencies, input.agencyId, {
    legalName: property.landlordDetails.companyName || property.landlordDetails.name,
    primaryEmail: property.landlordDetails.email,
  });
  if (duplicate[0] && duplicate[0].score >= 0.8) {
    throw Object.assign(new Error('A likely matching Client Account already exists. Link the existing Client rather than creating a duplicate.'), {
      status: 409,
      code: 'CLIENT_DUPLICATE_REVIEW_REQUIRED',
      details: { duplicateCandidates: duplicate },
    });
  }
  const now = new Date().toISOString();
  const accountId = randomUUID();
  const contactId = randomUUID();
  const relationshipId = randomUUID();
  const legalName = property.landlordDetails.companyName || property.landlordDetails.name;
  const accountData: Omit<ClientAccount, 'id' | 'agencyId' | 'createdAt' | 'updatedAt' | 'version'> = {
    legalName,
    ...(property.landlordDetails.companyName ? { tradingName: property.landlordDetails.companyName } : {}),
    clientType: 'private_landlord',
    entityType: property.landlordDetails.companyName ? 'company' : 'individual',
    mainPhone: property.landlordDetails.phone,
    generalEmail: property.landlordDetails.email,
    primaryContactId: contactId,
    billingProfile: { method: 'invoice_per_inspection', invoiceRecipientEmail: property.landlordDetails.email },
    maintenancePolicy: { ownerApprovalContactId: contactId, quoteContactId: contactId },
    notes: property.landlordDetails.notes,
    status: 'onboarding',
    name: legalName,
    email: property.landlordDetails.email,
    phone: property.landlordDetails.phone,
    type: legacyClientType('private_landlord'),
    defaultApprovalEmail: property.landlordDetails.email,
  };
  const account = await dependencies.repository.create('clients', input.agencyId, accountId, accountData as unknown as Record<string, unknown>, input.actorId);
  const contact = await dependencies.repository.create('clientContacts', input.agencyId, contactId, {
    clientAccountId: accountId,
    displayName: property.landlordDetails.name,
    email: property.landlordDetails.email,
    phone: property.landlordDetails.phone,
    roles: ['owner_landlord'],
    preferredContactMethod: property.landlordDetails.contactPreference || 'email',
    isPrimary: true,
    receivesReports: true,
    receivesMaintenance: true,
    receivesAccounts: true,
    canApproveMaintenance: true,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }, input.actorId);
  const relationship = await dependencies.repository.create('propertyClientRelationships', input.agencyId, relationshipId, {
    propertyId: property.id,
    clientAccountId: accountId,
    relationshipType: 'owner',
    primaryContactId: contactId,
    isCurrent: true,
    startDate: now.slice(0, 10),
  }, input.actorId);
  const context = (await syncPropertyClientContext(dependencies, {
    agencyId: input.agencyId,
    propertyId: input.propertyId,
    actorId: input.actorId,
  })).context;
  return { account, contact, relationship, context };
}
