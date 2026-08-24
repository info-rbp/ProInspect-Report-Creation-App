import { doc, getDoc } from 'firebase/firestore';
import { getIdTokenResult, type User } from 'firebase/auth';
import type { UserProfile, UserRole } from '../../types/platform';
import { getFirestoreDb, isFirebaseConfigured } from '../storageService';

const validRoles = new Set<UserRole>(['super_admin','proinspect_admin','operations','inspector','analyst','reviewer','tenant','landlord','shopify_customer']);
const PROVIDER_ID = 'proinspect';
export const DEFAULT_AGENCY_ID = 'unprovisioned-agency';

function storeAgency(profile: UserProfile): UserProfile {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem('pcr_agency_id', profile.agencyId);
    window.localStorage.setItem('agencyId', profile.agencyId);
  }
  return profile;
}

export const getOrCreateUserProfile = async (user: User): Promise<UserProfile> => {
  const db = getFirestoreDb();
  if (!isFirebaseConfigured() || !db) throw new Error('Identity Platform and Firestore must be configured.');

  const token = await getIdTokenResult(user, true);
  const firebaseClaim = token.claims.firebase;
  const tokenAgencyId = typeof token.claims.agencyId === 'string'
    ? token.claims.agencyId
    : typeof firebaseClaim === 'object' && firebaseClaim && 'tenant' in firebaseClaim ? String(firebaseClaim.tenant) : undefined;
  const providerId = typeof token.claims.providerId === 'string' ? token.claims.providerId : undefined;
  const providerRole = typeof token.claims.providerRole === 'string' ? token.claims.providerRole : undefined;
  const providerSuperAdmin = providerId === PROVIDER_ID && providerRole === 'super_admin';

  const userSnapshot = await getDoc(doc(db, 'users', user.uid));
  const userData = userSnapshot.exists() ? userSnapshot.data() as Record<string, unknown> : undefined;
  const profileAgencyId = typeof userData?.agencyId === 'string' ? userData.agencyId : undefined;
  const agencyId = tokenAgencyId || profileAgencyId;
  if (!agencyId) throw new Error('Your account has not been provisioned with a ProInspect or agency workspace.');

  const membershipSnapshot = await getDoc(doc(db, 'agencies', agencyId, 'memberships', user.uid));
  const agencyMembership = membershipSnapshot.exists()
    ? membershipSnapshot.data() as { role?: string; status?: string; displayName?: string; createdAt?: string; updatedAt?: string }
    : undefined;

  // An explicitly provisioned ProInspect provider super administrator is allowed
  // to enter the application shell for the agency in their signed identity claim,
  // even if that agency membership is missing or inactive. The API independently
  // verifies the provider membership server-side before authorising operations.
  const membership = agencyMembership?.status === 'active'
    ? agencyMembership
    : providerSuperAdmin
      ? { role: 'super_admin', status: 'active' }
      : agencyMembership;

  if (!membership) throw new Error('Your agency membership has not been provisioned.');
  if (membership.status !== 'active') throw new Error('Your agency membership is not active.');
  if (!membership.role || !validRoles.has(membership.role as UserRole)) throw new Error('Your agency role is invalid.');

  const timestamp = new Date().toISOString();
  const displayName = agencyMembership?.displayName || (typeof userData?.displayName === 'string' ? userData.displayName : undefined) || user.displayName || undefined;
  return storeAgency({
    id: user.uid,
    agencyId,
    ...(displayName ? { displayName } : {}),
    email: user.email || '',
    role: membership.role as UserRole,
    status: 'active',
    createdAt: agencyMembership?.createdAt || timestamp,
    updatedAt: agencyMembership?.updatedAt || timestamp,
  });
};
