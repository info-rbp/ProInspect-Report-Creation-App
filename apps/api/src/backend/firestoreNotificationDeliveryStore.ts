import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { firestoreDb } from '../firestoreDatabase.js';
import type {
  NotificationDeliveryStore,
  NotificationDeliveryUpdate,
} from './types.js';

function adminApp() {
  return getApps()[0] ?? initializeApp({ credential: applicationDefault() });
}

export class FirestoreNotificationDeliveryStore
implements NotificationDeliveryStore {
  async update(input: NotificationDeliveryUpdate): Promise<void> {
    const database = firestoreDb(adminApp());
    const now = new Date().toISOString();

    const patch: Record<string, unknown> = {
      status: input.status,
      updatedAt: now,
      ...(input.metadata ?? {}),
    };

    if (input.status === 'sent') {
      patch.sentAt = now;
    }

    if (input.status === 'delivered') {
      patch.sentAt = now;
      patch.deliveredAt = now;
    }

    await database
      .doc(
        `agencies/${input.agencyId}/notificationJobs/${input.notificationId}`,
      )
      .set(patch, { merge: true });

    if (input.communicationId) {
      await database
        .doc(
          `agencies/${input.agencyId}/tenantCommunications/${input.communicationId}`,
        )
        .set(patch, { merge: true });
    }
  }
}
