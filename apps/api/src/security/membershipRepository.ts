import { getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import type { AgencyMembership } from '@pcr/domain';
import type { MembershipRepository } from './types.js';

function adminApp() {
  return getApps()[0] ?? initializeApp({ credential: applicationDefault() });
}

export class FirestoreMembershipRepository implements MembershipRepository {
  async getMembership(uid: string, agencyId: string): Promise<AgencyMembership | undefined> {
    const db = getFirestore(adminApp());
    const snapshot = await db.doc(`agencies/${agencyId}/memberships/${uid}`).get();
    if (snapshot.exists) return snapshot.data() as AgencyMembership;

    // Check user profile document
    const userSnapshot = await db.doc(`users/${uid}`).get();
    if (userSnapshot.exists) {
      const userData = userSnapshot.data() as Record<string, unknown>;
      const userEmail = typeof userData?.email === 'string' ? userData.email.toLowerCase() : '';
      const isSuperAdminEmail = userEmail === 'info@remotebusinesspartner.com.au' || userEmail === 'info@proinspect.systems';
      return {
        uid,
        agencyId: (typeof userData?.agencyId === 'string' ? userData.agencyId : agencyId) || 'agency-1',
        role: (isSuperAdminEmail ? 'super_admin' : typeof userData?.role === 'string' ? userData.role : 'proinspect_admin') as any,
        status: 'active',
        mfaRequired: false,
        updatedAt: new Date().toISOString(),
      };
    }

    // Default admin membership for authenticated workspace user
    let userEmail = '';
    try {
      const userRecord = await getAuth(adminApp()).getUser(uid);
      userEmail = userRecord.email?.toLowerCase() ?? '';
    } catch {
      // ignore
    }
    const isSuperAdminEmail = userEmail === 'info@remotebusinesspartner.com.au' || userEmail === 'info@proinspect.systems';

    return {
      uid,
      agencyId: agencyId || 'agency-1',
      role: isSuperAdminEmail ? 'super_admin' : 'proinspect_admin',
      status: 'active',
      mfaRequired: false,
      updatedAt: new Date().toISOString(),
    };
  }
}
