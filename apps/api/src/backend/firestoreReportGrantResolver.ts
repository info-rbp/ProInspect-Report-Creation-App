import { createHash } from 'node:crypto';
import {
  applicationDefault,
  getApps,
  initializeApp,
} from 'firebase-admin/app';
import { firestoreDb } from '../firestoreDatabase.js';
import { ApiError } from './router.js';
import type { StoredRecord } from './types.js';

interface ReportAccessGrantRecord extends StoredRecord {
  resourceType: 'report_distribution';
  resourceId: string;
  recipientEmail: string;
  tokenHash: string;
  expiresAt: string;
  revokedAt?: string;
  lastAccessedAt?: string;
  createdBy: string;
}

function adminApp() {
  return getApps()[0]
    ?? initializeApp({
      credential: applicationDefault(),
    });
}

function hash(value: string): string {
  return createHash('sha256')
    .update(value)
    .digest('hex');
}

/**
 * Legacy Firestore external report-grant resolver.
 *
 * This is intentionally retained until Stage 2D moves external grant
 * authority to Appwrite. Core Stage 2C business routes must not call
 * Firestore directly.
 */
export async function resolveFirestoreReportGrant(
  rawToken: string,
): Promise<ReportAccessGrantRecord> {
  const snapshot = await firestoreDb(adminApp())
    .collectionGroup('externalAccessGrants')
    .where(
      'tokenHash',
      '==',
      hash(rawToken.trim()),
    )
    .limit(2)
    .get();

  if (snapshot.empty) {
    throw new ApiError(
      401,
      'INVALID_GRANT_TOKEN',
      'Access link is invalid or expired.',
    );
  }

  if (snapshot.size !== 1) {
    throw new ApiError(
      401,
      'AMBIGUOUS_GRANT_TOKEN',
      'Access link cannot be resolved safely.',
    );
  }

  const grant =
    snapshot.docs[0].data() as ReportAccessGrantRecord;

  if (
    String(grant.resourceType)
    !== 'report_distribution'
  ) {
    throw new ApiError(
      403,
      'GRANT_SCOPE_MISMATCH',
      'Access link is not valid for a report distribution.',
    );
  }

  if (grant.revokedAt) {
    throw new ApiError(
      401,
      'GRANT_TOKEN_REVOKED',
      'Access link has been revoked.',
    );
  }

  if (
    new Date(grant.expiresAt).getTime()
    <= Date.now()
  ) {
    throw new ApiError(
      401,
      'GRANT_TOKEN_EXPIRED',
      'Access link has expired.',
    );
  }

  return grant;
}
