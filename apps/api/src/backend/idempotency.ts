import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { IdempotencyResult, IdempotencyStore } from './types.js';

function adminApp() {
  return getApps()[0] ?? initializeApp({ credential: applicationDefault() });
}

interface StoredIdempotencyRecord {
  agencyId: string;
  operation: string;
  key: string;
  payloadHash: string;
  status: 'processing' | 'completed';
  result?: IdempotencyResult;
  createdAt: string;
  updatedAt: string;
}

export class IdempotencyConflictError extends Error {
  readonly code = 'IDEMPOTENCY_CONFLICT';
  readonly status = 409;
}

export class IdempotencyInProgressError extends Error {
  readonly code = 'IDEMPOTENCY_IN_PROGRESS';
  readonly status = 409;
}

export class FirestoreIdempotencyStore implements IdempotencyStore {
  async execute(
    agencyId: string,
    operation: string,
    key: string,
    payloadHash: string,
    action: () => Promise<IdempotencyResult>,
  ): Promise<{ replayed: boolean; result: IdempotencyResult }> {
    const database = getFirestore(adminApp());
    const documentId = Buffer.from(`${operation}:${key}`).toString('base64url');
    const reference = database.doc(`agencies/${agencyId}/idempotencyKeys/${documentId}`);
    const now = new Date().toISOString();

    const reservation = await database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (snapshot.exists) {
        const stored = snapshot.data() as StoredIdempotencyRecord;
        if (stored.payloadHash !== payloadHash || stored.operation !== operation) throw new IdempotencyConflictError('The idempotency key was already used with a different request.');
        if (stored.status === 'completed' && stored.result) return { replayed: true, result: stored.result };
        throw new IdempotencyInProgressError('A request using this idempotency key is already in progress.');
      }
      const record: StoredIdempotencyRecord = { agencyId, operation, key, payloadHash, status: 'processing', createdAt: now, updatedAt: now };
      transaction.create(reference, record);
      return undefined;
    });

    if (reservation) return reservation;

    try {
      const result = await action();
      await reference.update({ status: 'completed', result, updatedAt: new Date().toISOString() });
      return { replayed: false, result };
    } catch (error) {
      await reference.delete().catch(() => undefined);
      throw error;
    }
  }
}

export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<string, { payloadHash: string; result: IdempotencyResult }>();

  async execute(
    agencyId: string,
    operation: string,
    key: string,
    payloadHash: string,
    action: () => Promise<IdempotencyResult>,
  ): Promise<{ replayed: boolean; result: IdempotencyResult }> {
    const recordKey = `${agencyId}:${operation}:${key}`;
    const existing = this.records.get(recordKey);
    if (existing) {
      if (existing.payloadHash !== payloadHash) throw new IdempotencyConflictError('The idempotency key was already used with a different request.');
      return { replayed: true, result: existing.result };
    }
    const result = await action();
    this.records.set(recordKey, { payloadHash, result });
    return { replayed: false, result };
  }
}
