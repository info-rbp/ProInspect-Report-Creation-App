import { doc, getDoc } from 'firebase/firestore';
import { getIdTokenResult, type User } from 'firebase/auth';
import type { UserProfile, UserRole } from '../../types/platform';
import { getFirestoreDb, isFirebaseConfigured } from '../storageService';

const validRoles = new Set<UserRole>([
  'super_admin',
  'proinspect_admin',
  'operations',
  'inspector',
  'analyst',
  'reviewer',
  'tenant',
  'landlord',
  'shopify_customer',
]);

// Legacy offline forms still require an agency field. This sentinel is never
// accepted as an authorisation source and cloud writes are API-only.
export const DEFAULT_AGENCY_ID = 'unprovisioned-agency';

export const getOrCreateUserProfile = async (user: User): Promise<UserProfile> => {
  const db = getFirestoreDb();
  if (!isFirebaseConfigured() || !db) {
    throw new Error('Identity Platform and Firestore must be configured. Local administrator fallback has been removed.');
  }

  const token = await getIdTokenResult(user, true);
  const firebaseClaim = token.claims.firebase;
  const agencyId = typeof token.claims.agencyId === 'string'
    ? token.claims.agencyId
    : typeof firebaseClaim === 'object' && firebaseClaim && 'tenant' in firebaseClaim
      ? String(firebaseClaim.tenant)
      : undefined;

  if (!agencyId) throw new Error('Your account is not linked to an agency.');

  const membershipSnapshot = await getDoc(doc(db, 'agencies', agencyId, 'memberships', user.uid));
  if (!membershipSnapshot.exists()) throw new Error('Your agency membership has not been provisioned.');

  const membership = membershipSnapshot.data() as {
    role?: string;
    status?: string;
    displayName?: string;
    createdAt?: string;
    updatedAt?: string;
  };
  if (membership.status !== 'active') throw new Error('Your agency membership is not active.');
  if (!membership.role || !validRoles.has(membership.role as UserRole)) throw new Error('Your agency role is invalid.');

  const timestamp = new Date().toISOString();
  const displayName = membership.displayName || user.displayName || undefined;
  return {
    id: user.uid,
    agencyId,
    ...(displayName ? { displayName } : {}),
    email: user.email || '',
    role: membership.role as UserRole,
    status: 'active',
    createdAt: membership.createdAt || timestamp,
    updatedAt: membership.updatedAt || timestamp,
  };
};
