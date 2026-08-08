import { getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { AuditWriter, SecurityAuditEvent } from './types.js';

function adminApp() {
  return getApps()[0] ?? initializeApp({ credential: applicationDefault() });
}

export class FirestoreAuditWriter implements AuditWriter {
  async append(event: SecurityAuditEvent): Promise<void> {
    await getFirestore(adminApp()).doc(`agencies/${event.agencyId}/auditEvents/${event.id}`).create(event);
  }
}
