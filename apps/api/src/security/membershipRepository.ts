import { getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { AgencyMembership } from '@pcr/domain';
import type { MembershipRepository } from './types.js';

function adminApp() {
  return getApps()[0] ?? initializeApp({ credential: applicationDefault() });
}

export class FirestoreMembershipRepository implements MembershipRepository {
  async getMembership(uid: string, agencyId: string): Promise<AgencyMembership | undefined> {
    const snapshot = await getFirestore(adminApp()).doc(`agencies/${agencyId}/memberships/${uid}`).get();
    return snapshot.exists ? snapshot.data() as AgencyMembership : undefined;
  }
}
