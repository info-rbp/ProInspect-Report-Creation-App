import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { FieldPath, getFirestore } from 'firebase-admin/firestore';
import { IMMUTABLE_REPORT_STATUSES, type ReportLifecycleStatus } from '@pcr/domain';
import type { OperationalRepository, Page, StoredRecord } from './types.js';

function adminApp() {
  return getApps()[0] ?? initializeApp({ credential: applicationDefault() });
}

function collectionPath(collection: string, agencyId: string): string {
  if (collection === 'agencies') return 'agencies';
  if (collection === 'users') return `agencies/${agencyId}/memberships`;
  return `agencies/${agencyId}/${collection}`;
}

function timestamp(): string {
  return new Date().toISOString();
}

function assertReportMetadata(collection: string, data: Record<string, unknown>): void {
  if (collection !== 'reports') return;
  const forbidden = ['rooms', 'areas', 'components', 'photos', 'heroPhoto', 'previousReport'];
  const supplied = forbidden.filter((field) => field in data);
  if (supplied.length) throw Object.assign(new Error('Nested report content must use the report aggregate API.'), {
    code: 'REPORT_AGGREGATE_REQUIRED',
    status: 400,
    details: { fields: supplied },
  });
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertTenancyDocumentMutation(collection: string, existing: StoredRecord, data: Record<string, unknown>): void {
  if (collection !== 'tenancyDocuments' || existing.immutable !== true) return;
  const authorityFields = [
    'tenantId',
    'tenancyId',
    'propertyId',
    'type',
    'title',
    'content',
    'contentType',
    'templateKey',
    'objectPath',
    'sha256',
    'generation',
    'documentVersion',
    'issuedAt',
    'issuedTo',
    'acknowledgementText',
    'immutable',
  ];
  const changed = authorityFields.filter((field) => field in data && !sameValue(existing[field], data[field]));
  if (changed.length) {
    throw Object.assign(new Error('Issued tenancy document content and authority metadata are immutable.'), {
      code: 'TENANCY_DOCUMENT_IMMUTABLE',
      status: 409,
      details: { fields: changed },
    });
  }
}

function isSystemCatalogueSeed(collection: string, data: Record<string, unknown>): boolean {
  return collection.startsWith('catalogue') && data.systemDefault === true;
}

function isSatisfiedConcurrentSystemPointerUpdate(
  collection: string,
  existing: StoredRecord,
  data: Record<string, unknown>,
): boolean {
  if (!isSystemCatalogueSeed(collection, data) || existing.systemDefault !== true) return false;
  const currentDefinitionVersion = existing.definitionVersion;
  const targetDefinitionVersion = data.definitionVersion;
  return typeof currentDefinitionVersion === 'number'
    && typeof targetDefinitionVersion === 'number'
    && currentDefinitionVersion >= targetDefinitionVersion;
}

export class FirestoreOperationalRepository implements OperationalRepository {
  async list(collection: string, agencyId: string, limit: number, cursor?: string): Promise<Page<StoredRecord>> {
    const effectiveLimit = Math.min(Math.max(limit, 1), 100);
    let query = getFirestore(adminApp())
      .collection(collectionPath(collection, agencyId))
      .orderBy(FieldPath.documentId())
      .limit(effectiveLimit);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    const items = snapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as StoredRecord);
    const last = snapshot.docs.at(-1);
    return { items, ...(snapshot.size === effectiveLimit && last ? { nextCursor: last.id } : {}) };
  }

  async get(collection: string, agencyId: string, id: string): Promise<StoredRecord | undefined> {
    const snapshot = await getFirestore(adminApp()).collection(collectionPath(collection, agencyId)).doc(id).get();
    return snapshot.exists ? ({ id: snapshot.id, ...snapshot.data() } as StoredRecord) : undefined;
  }

  async create(collection: string, agencyId: string, id: string, data: Record<string, unknown>, actorId: string): Promise<StoredRecord> {
    assertReportMetadata(collection, data);
    const now = timestamp();
    const record: StoredRecord = {
      ...data,
      id,
      agencyId,
      version: 1,
      createdAt: now,
      updatedAt: now,
      createdBy: actorId,
      updatedBy: actorId,
    };
    const reference = getFirestore(adminApp()).collection(collectionPath(collection, agencyId)).doc(id);
    try {
      await reference.create(record);
      return record;
    } catch (error) {
      if (isSystemCatalogueSeed(collection, data)) {
        const existing = await reference.get();
        if (existing.exists) return { id: existing.id, ...existing.data() } as StoredRecord;
      }
      throw error;
    }
  }

  async update(collection: string, agencyId: string, id: string, data: Record<string, unknown>, expectedVersion: number, actorId: string): Promise<StoredRecord> {
    assertReportMetadata(collection, data);
    const reference = getFirestore(adminApp()).collection(collectionPath(collection, agencyId)).doc(id);
    return getFirestore(adminApp()).runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) throw Object.assign(new Error('Record not found.'), { code: 'NOT_FOUND', status: 404 });
      const existing = { id: snapshot.id, ...snapshot.data() } as StoredRecord;
      if (existing.agencyId !== agencyId) throw Object.assign(new Error('Record not found.'), { code: 'NOT_FOUND', status: 404 });
      if (collection === 'reports' && IMMUTABLE_REPORT_STATUSES.has(existing.lifecycleStatus as ReportLifecycleStatus)) {
        throw Object.assign(new Error('Finalised report metadata is immutable.'), { code: 'REPORT_IMMUTABLE', status: 409 });
      }
      assertTenancyDocumentMutation(collection, existing, data);
      if (existing.version !== expectedVersion) {
        if (isSatisfiedConcurrentSystemPointerUpdate(collection, existing, data)) return existing;
        throw Object.assign(new Error('The record has changed. Reload and retry.'), {
          code: 'VERSION_CONFLICT',
          status: 409,
          details: { expectedVersion, actualVersion: existing.version },
        });
      }
      const updated: StoredRecord = {
        ...existing,
        ...data,
        id,
        agencyId,
        version: existing.version + 1,
        createdAt: existing.createdAt,
        updatedAt: timestamp(),
        updatedBy: actorId,
      };
      transaction.set(reference, updated);
      return updated;
    });
  }
}
