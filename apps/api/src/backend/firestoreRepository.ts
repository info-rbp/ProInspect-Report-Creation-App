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

export class FirestoreOperationalRepository implements OperationalRepository {
  async list(collection: string, agencyId: string, limit: number, cursor?: string): Promise<Page<StoredRecord>> {
    let query = getFirestore(adminApp())
      .collection(collectionPath(collection, agencyId))
      .orderBy(FieldPath.documentId())
      .limit(Math.min(Math.max(limit, 1), 100));
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    const items = snapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as StoredRecord);
    const last = snapshot.docs.at(-1);
    return { items, ...(snapshot.size === limit && last ? { nextCursor: last.id } : {}) };
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
    await reference.create(record);
    return record;
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
      if (existing.version !== expectedVersion) {
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
