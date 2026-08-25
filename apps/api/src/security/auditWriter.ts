import { getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { firestoreDb } from '../firestoreDatabase.js';
import type { AuditWriter, SecurityAuditEvent } from './types.js';

function adminApp() {
  return getApps()[0] ?? initializeApp({ credential: applicationDefault() });
}

export class FirestoreAuditWriter implements AuditWriter {
  async append(event: SecurityAuditEvent): Promise<void> {
    await firestoreDb(adminApp()).doc(`agencies/${event.agencyId}/auditEvents/${event.id}`).create(event);
  }
}
