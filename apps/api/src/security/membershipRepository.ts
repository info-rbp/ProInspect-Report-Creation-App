import { getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { AgencyMembership } from '@pcr/domain';
import type { MembershipRepository } from './types.js';

const PROVIDER_ID = process.env.PROINSPECT_PROVIDER_ID?.trim() || 'proinspect';

function adminApp() {
  return getApps()[0] ?? initializeApp({ credential: applicationDefault() });
}

export class FirestoreMembershipRepository implements MembershipRepository {
  async getMembership(uid: string, agencyId: string): Promise<AgencyMembership | undefined> {
    const db = getFirestore(adminApp());
    const agencyMembership = await db.doc(`agencies/${agencyId}/memberships/${uid}`).get();
    if (agencyMembership.exists) return agencyMembership.data() as AgencyMembership;

    // ProInspect provider administrators are deliberately provisioned in a separate,
    // explicit provider membership. This allows cross-agency administration without
    // silently turning every authenticated Firebase user into an administrator.
    const providerMembership = await db.doc(`serviceProviders/${PROVIDER_ID}/memberships/${uid}`).get();
    if (!providerMembership.exists) return undefined;

    const data = providerMembership.data() as Partial<AgencyMembership> & { role?: string; status?: string };
    if (data.status !== 'active' || data.role !== 'super_admin') return undefined;

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
