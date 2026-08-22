import { randomUUID } from 'node:crypto';
import {
  CLIENT_ACCOUNT_TYPES,
  CLIENT_ENTITY_TYPES,
  evaluateClientOnboarding,
  legacyClientType,
  type ClientAccount,
  type ClientAccountType,
  type ClientContact,
  type ClientEngagement,
  type ClientEntityType,
  type PropertyClientRelationshipType,
} from '@pcr/domain';
import { ApiError } from '../backend/router.js';
import type { ApiDependencies, StoredRecord } from '../backend/types.js';
import {
  duplicateCandidates,
  listAllClientRecords,
  syncPropertyClientContext,
} from './clientManagementService.js';

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function email(value: unknown): string | undefined {
  const candidate = text(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(candidate) ? candidate : undefined;
}

function accountType(value: unknown): ClientAccountType {
  const candidate = text(value).toLowerCase().replace(/[\s-]+/gu, '_');
  if ((CLIENT_ACCOUNT_TYPES as readonly string[]).includes(candidate)) return candidate as ClientAccountType;
  if (candidate.includes('property') && candidate.includes('management')) return 'property_management_firm';
  if (candidate.includes('landlord') || candidate.includes('owner')) return 'private_landlord';
  return 'other';
}

function entityType(value: unknown, clientType: ClientAccountType): ClientEntityType {
  const candidate = text(value).toLowerCase().replace(/[\s-]+/gu, '_');
  if ((CLIENT_ENTITY_TYPES as readonly string[]).includes(candidate)) return candidate as ClientEntityType;
  if (clientType === 'property_management_firm') return 'property_management_agency';
  return clientType === 'private_landlord' ? 'individual' : 'company';
}

function relationshipType(value: unknown): PropertyClientRelationshipType {
  const candidate = text(value).toLowerCase().replace(/[\s-]+/gu, '_');
  const supported = new Set<PropertyClientRelationshipType>([
    'owner',
    'managing_agent',
    'engaging_client',
    'billing_party',
    'report_recipient',
    'maintenance_authority',
    'strata_manager',
    'owner_representative',
  ]);
  return supported.has(candidate as PropertyClientRelationshipType)
    ? candidate as PropertyClientRelationshipType
    : 'engaging_client';
}

export async function appendClientTimelineEvent(
  dependencies: ApiDependencies,
  agencyId: string,
  clientAccountId: string,
  actorId: string,
  type: string,
  summary: string,
  relatedEntityType?: string,
  relatedEntityId?: string,
): Promise<void> {
  const now = new Date().toISOString();
  await dependencies.repository.create(
    'clientTimelineEvents',
    agencyId,
    randomUUID(),
    {
      clientAccountId,
      type,
      summary,
      ...(relatedEntityType ? { relatedEntityType } : {}),
      ...(relatedEntityId ? { relatedEntityId } : {}),
      actorId,
      occurredAt: now,
    },
    actorId,
  );
}

export async function activateClientAccount(
  dependencies: ApiDependencies,
  agencyId: string,
  clientId: string,
  expectedVersion: number,
  actorId: string,
): Promise<StoredRecord> {
  const account = await dependencies.repository.get('clients', agencyId, clientId);
  if (!account) throw new ApiError(404, 'CLIENT_NOT_FOUND', 'Client Account was not found.');
  const [contacts, engagements] = await Promise.all([
    listAllClientRecords(dependencies, 'clientContacts', agencyId),
    listAllClientRecords(dependencies, 'clientEngagements', agencyId),
  ]);
  const readiness = evaluateClientOnboarding(
    account as unknown as ClientAccount,
    contacts.filter((item) => item.clientAccountId === clientId) as unknown as ClientContact[],
    engagements.filter((item) => item.clientAccountId === clientId) as unknown as ClientEngagement[],
  );
  if (!readiness.readyForActivation) {
    throw new ApiError(
      422,
      'CLIENT_ONBOARDING_INCOMPLETE',
      'Client Account cannot be activated until onboarding blockers are resolved.',
      { blockers: readiness.blockers, warnings: readiness.warnings },
    );
  }
  const now = new Date().toISOString();
  const updated = await dependencies.repository.update(
    'clients',
    agencyId,
    clientId,
    {
      status: 'active',
      activatedAt: now,
      onboardingCompletedSteps: readiness.completedSteps,
      onboardingBlockers: [],
    },
    expectedVersion,
    actorId,
  );
  await appendClientTimelineEvent(
    dependencies,
    agencyId,
    clientId,
    actorId,
    'client_activated',
    'Client onboarding completed and account activated.',
  );
  return updated;
}

export async function offboardClientAccount(
  dependencies: ApiDependencies,
  agencyId: string,
  clientId: string,
  expectedVersion: number,
  actorId: string,
  reason?: string,
): Promise<StoredRecord> {
  const account = await dependencies.repository.get('clients', agencyId, clientId);
  if (!account) throw new ApiError(404, 'CLIENT_NOT_FOUND', 'Client Account was not found.');
  const now = new Date().toISOString();
  const relationships = await listAllClientRecords(dependencies, 'propertyClientRelationships', agencyId);
  const affectedProperties = new Set<string>();
  for (const relationship of relationships) {
    if (relationship.clientAccountId !== clientId || relationship.isCurrent !== true) continue;
    if (typeof relationship.propertyId === 'string') affectedProperties.add(relationship.propertyId);
    await dependencies.repository.update(
      'propertyClientRelationships',
      agencyId,
      relationship.id,
      {
        isCurrent: false,
        endDate: now.slice(0, 10),
        offboardingReason: reason || 'Client offboarded.',
      },
      Number(relationship.version),
      actorId,
    );
  }
  const portalUsers = await listAllClientRecords(dependencies, 'clientPortalUsers', agencyId);
  for (const portalUser of portalUsers) {
    if (portalUser.clientAccountId !== clientId || portalUser.status === 'revoked') continue;
    await dependencies.repository.update(
      'clientPortalUsers',
      agencyId,
      portalUser.id,
      { status: 'revoked', revokedAt: now, revokeReason: reason || 'Client offboarded.' },
      Number(portalUser.version),
      actorId,
    );
  }
  const updated = await dependencies.repository.update(
    'clients',
    agencyId,
    clientId,
    { status: 'inactive', offboardedAt: now, ...(reason ? { offboardingReason: reason } : {}) },
    expectedVersion,
    actorId,
  );
  for (const propertyId of affectedProperties) {
    await syncPropertyClientContext(dependencies, { agencyId, propertyId, actorId });
  }
  await appendClientTimelineEvent(
    dependencies,
    agencyId,
    clientId,
    actorId,
    'client_offboarded',
    reason || 'Client account offboarded.',
  );
  return updated;
}

export async function mergeClientAccountsCommand(
  dependencies: ApiDependencies,
  agencyId: string,
  sourceClientId: string,
  targetClientId: string,
  expectedVersion: number,
  actorId: string,
): Promise<{ source: StoredRecord; target: StoredRecord; moved: number }> {
  if (!targetClientId || targetClientId === sourceClientId) {
    throw new ApiError(400, 'MERGE_TARGET_INVALID', 'A different target Client Account is required.');
  }
  const [source, target] = await Promise.all([
    dependencies.repository.get('clients', agencyId, sourceClientId),
    dependencies.repository.get('clients', agencyId, targetClientId),
  ]);
  if (!source || !target) throw new ApiError(404, 'CLIENT_NOT_FOUND', 'Source or target Client Account was not found.');
  const collections = [
    'clientContacts',
    'clientEngagements',
    'propertyClientRelationships',
    'clientDocuments',
    'clientPortalUsers',
    'clientTimelineEvents',
  ];
  const affectedProperties = new Set<string>();
  let moved = 0;
  for (const collection of collections) {
    const records = await listAllClientRecords(dependencies, collection, agencyId);
    for (const record of records) {
      if (record.clientAccountId !== sourceClientId) continue;
      if (collection === 'propertyClientRelationships' && typeof record.propertyId === 'string') {
        affectedProperties.add(record.propertyId);
      }
      await dependencies.repository.update(
        collection,
        agencyId,
        record.id,
        { clientAccountId: targetClientId },
        Number(record.version),
        actorId,
      );
      moved += 1;
    }
  }
  const sourceUpdated = await dependencies.repository.update(
    'clients',
    agencyId,
    sourceClientId,
    { status: 'archived', mergedIntoClientId: targetClientId, mergedAt: new Date().toISOString() },
    expectedVersion,
    actorId,
  );
  for (const propertyId of affectedProperties) {
    await syncPropertyClientContext(dependencies, { agencyId, propertyId, actorId });
  }
  await appendClientTimelineEvent(
    dependencies,
    agencyId,
    targetClientId,
    actorId,
    'client_merged',
    `Merged Client Account ${sourceClientId} into this account.`,
    'client',
    sourceClientId,
  );
  return { source: sourceUpdated, target, moved };
}

export interface ClientImportResult {
  row: number;
  status: 'ready' | 'created' | 'linked_existing' | 'review_required' | 'rejected';
  clientAccountId?: string;
  propertyId?: string;
  messages: string[];
}

export async function bulkImportClientRows(
  dependencies: ApiDependencies,
  agencyId: string,
  rows: unknown[],
  actorId: string,
  dryRun: boolean,
): Promise<{
  results: ClientImportResult[];
  created: number;
  linkedExisting: number;
  reviewRequired: number;
  rejected: number;
}> {
  if (!rows.length) throw new ApiError(400, 'IMPORT_ROWS_REQUIRED', 'At least one Client import row is required.');
  if (rows.length > 5_000) throw new ApiError(400, 'IMPORT_TOO_LARGE', 'Client bulk imports are limited to 5,000 rows per batch.');
  const results: ClientImportResult[] = [];
  let created = 0;
  let linkedExisting = 0;
  let reviewRequired = 0;
  let rejected = 0;

  for (let index = 0; index < rows.length; index += 1) {
    const raw = rows[index];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      results.push({ row: index + 2, status: 'rejected', messages: ['Row is not a valid object.'] });
      rejected += 1;
      continue;
    }
    const row = raw as Record<string, unknown>;
    const legalName = text(row.legalName || row.client || row.clientName || row.landlord || row.agency || row.name);
    if (!legalName) {
      results.push({ row: index + 2, status: 'rejected', messages: ['Client legal name is required.'] });
      rejected += 1;
      continue;
    }
    const type = accountType(row.clientType || row.type);
    const entity = entityType(row.entityType, type);
    const primaryEmail = email(row.primaryEmail || row.email || row.clientEmail || row.ownerEmail);
    const candidate: Partial<ClientAccount> & { primaryEmail?: string } = {
      legalName,
      tradingName: text(row.tradingName) || undefined,
      clientType: type,
      entityType: entity,
      abn: text(row.abn) || undefined,
      acn: text(row.acn) || undefined,
      ...(primaryEmail ? { primaryEmail } : {}),
    };
    const duplicates = await duplicateCandidates(dependencies, agencyId, candidate);
    const strongDuplicate = duplicates.find((item) => item.score >= 0.8);
    const possibleDuplicate = duplicates.find((item) => item.score >= 0.5);
    const propertyId = text(row.propertyId);

    if (possibleDuplicate && !strongDuplicate) {
      results.push({
        row: index + 2,
        status: 'review_required',
        clientAccountId: possibleDuplicate.clientAccountId,
        ...(propertyId ? { propertyId } : {}),
        messages: [`Possible duplicate requires review: ${possibleDuplicate.reasons.join(', ')}`],
      });
      reviewRequired += 1;
      continue;
    }
    if (dryRun) {
      results.push({
        row: index + 2,
        status: strongDuplicate ? 'linked_existing' : 'ready',
        clientAccountId: strongDuplicate?.clientAccountId,
        ...(propertyId ? { propertyId } : {}),
        messages: strongDuplicate
          ? [`Will use existing Client: ${strongDuplicate.reasons.join(', ')}`]
          : ['Ready to create Client Account.'],
      });
      continue;
    }

    let clientId = strongDuplicate?.clientAccountId;
    if (!clientId) {
      clientId = randomUUID();
      const contactId = randomUUID();
      const phone = text(row.primaryPhone || row.phone || row.ownerPhone);
      const billingMethod = text(row.billingMethod) || 'invoice_per_inspection';
      await dependencies.repository.create(
        'clients',
        agencyId,
        clientId,
        {
          legalName,
          ...(text(row.tradingName) ? { tradingName: text(row.tradingName) } : {}),
          clientType: type,
          entityType: entity,
          ...(text(row.abn) ? { abn: text(row.abn) } : {}),
          ...(text(row.acn) ? { acn: text(row.acn) } : {}),
          ...(primaryEmail ? { generalEmail: primaryEmail } : {}),
          ...(phone ? { mainPhone: phone } : {}),
          primaryContactId: contactId,
          billingProfile: {
            method: billingMethod,
            ...(email(row.invoiceRecipientEmail || row.accountsEmail)
              ? { invoiceRecipientEmail: email(row.invoiceRecipientEmail || row.accountsEmail) }
              : primaryEmail ? { invoiceRecipientEmail: primaryEmail } : {}),
            ...(Number.isFinite(Number(row.paymentTermsDays)) ? { paymentTermsDays: Number(row.paymentTermsDays) } : {}),
          },
          maintenancePolicy: {
            ...(Number.isFinite(Number(row.propertyManagerApprovalLimit)) ? { propertyManagerApprovalLimit: Number(row.propertyManagerApprovalLimit) } : {}),
            ...(Number.isFinite(Number(row.landlordApprovalThreshold)) ? { landlordApprovalThreshold: Number(row.landlordApprovalThreshold) } : {}),
            ...(Number.isFinite(Number(row.emergencyAuthorisationLimit)) ? { emergencyAuthorisationLimit: Number(row.emergencyAuthorisationLimit) } : {}),
            ownerApprovalContactId: contactId,
            quoteContactId: contactId,
          },
          externalReferences: {
            ...(text(row.shopifyCustomerId) ? { shopifyCustomerIds: [text(row.shopifyCustomerId)] } : {}),
          },
          status: 'onboarding',
          name: text(row.tradingName) || legalName,
          email: primaryEmail,
          phone,
          type: legacyClientType(type),
          shopifyCustomerId: text(row.shopifyCustomerId) || undefined,
          defaultApprovalEmail: primaryEmail,
        },
        actorId,
      );
      await dependencies.repository.create(
        'clientContacts',
        agencyId,
        contactId,
        {
          clientAccountId: clientId,
          displayName: text(row.primaryContactName || row.contactName) || legalName,
          ...(primaryEmail ? { email: primaryEmail } : {}),
          ...(phone ? { phone } : {}),
          roles: type === 'property_management_firm' ? ['property_manager'] : ['owner_landlord'],
          isPrimary: true,
          receivesReports: true,
          receivesMaintenance: true,
          receivesAccounts: true,
          canApproveMaintenance: true,
          status: 'active',
        },
        actorId,
      );
      await appendClientTimelineEvent(
        dependencies,
        agencyId,
        clientId,
        actorId,
        'client_created',
        'Client Account created by bulk import.',
      );
      created += 1;
    } else {
      linkedExisting += 1;
    }

    if (propertyId) {
      const property = await dependencies.repository.get('properties', agencyId, propertyId);
      if (property) {
        await dependencies.repository.create(
          'propertyClientRelationships',
          agencyId,
          randomUUID(),
          {
            propertyId,
            clientAccountId: clientId,
            relationshipType: relationshipType(row.relationshipType),
            isCurrent: true,
            ...(text(row.relationshipStartDate) ? { startDate: text(row.relationshipStartDate) } : {}),
            ...(Number.isFinite(Number(row.propertyManagerApprovalLimit)) ? { propertyManagerApprovalLimit: Number(row.propertyManagerApprovalLimit) } : {}),
          },
          actorId,
        );
        await syncPropertyClientContext(dependencies, { agencyId, propertyId, actorId });
      }
    }

    results.push({
      row: index + 2,
      status: strongDuplicate ? 'linked_existing' : 'created',
      clientAccountId: clientId,
      ...(propertyId ? { propertyId } : {}),
      messages: [],
    });
  }

  return { results, created, linkedExisting, reviewRequired, rejected };
}
