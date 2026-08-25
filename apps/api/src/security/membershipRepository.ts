import { getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import type { AgencyMembership } from '@pcr/domain';
import { firestoreDb } from '../firestoreDatabase.js';
import type { MembershipRepository } from './types.js';

const PROVIDER_ID = process.env.PROINSPECT_PROVIDER_ID?.trim() || 'proinspect';

function adminApp() {
  return getApps()[0] ?? initializeApp({ credential: applicationDefault() });
}

export class FirestoreMembershipRepository implements MembershipRepository {
  async getMembership(uid: string, agencyId: string): Promise<AgencyMembership | undefined> {
    const db = firestoreDb(adminApp());
    const agencyMembership = await db.doc(`agencies/${agencyId}/memberships/${uid}`).get();
    if (agencyMembership.exists) {
      const data = agencyMembership.data() as AgencyMembership;
      if (data.status === 'active') return data;
    }

    // ProInspect provider administrators are deliberately provisioned in a separate,
    // explicit provider membership. An active provider super administrator can
    // administer an agency even when that agency does not contain a normal active
    // membership for the provider user. This keeps platform administration distinct
    // from ordinary agency-user access while avoiding a false MEMBERSHIP_INACTIVE.
    const providerMembership = await db.doc(`serviceProviders/${PROVIDER_ID}/memberships/${uid}`).get();
    if (!providerMembership.exists) return agencyMembership.exists ? agencyMembership.data() as AgencyMembership : undefined;

    const data = providerMembership.data() as Partial<AgencyMembership> & { role?: string; status?: string };
    if (data.status !== 'active' || data.role !== 'super_admin') {
      return agencyMembership.exists ? agencyMembership.data() as AgencyMembership : undefined;
    }

    return {
      uid,
      agencyId,
      role: 'super_admin',
      status: 'active',
      mfaRequired: data.mfaRequired !== false,
      updatedAt: data.updatedAt || new Date().toISOString(),
    };
  }
}
