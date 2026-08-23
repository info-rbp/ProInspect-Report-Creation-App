import { doc, getDoc, setDoc } from 'firebase/firestore';
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

export const DEFAULT_AGENCY_ID = 'agency-1';

function syncStorageAndReturn(profile: UserProfile): UserProfile {
  if (typeof window !== 'undefined' && profile.agencyId) {
    window.localStorage.setItem('pcr_agency_id', profile.agencyId);
    window.localStorage.setItem('agencyId', profile.agencyId);
  }
  return profile;
}

export const getOrCreateUserProfile = async (user: User): Promise<UserProfile> => {
  const db = getFirestoreDb();
  const timestamp = new Date().toISOString();

  let agencyId: string | undefined;
  try {
    const token = await getIdTokenResult(user, true);
    const firebaseClaim = token.claims.firebase;
    agencyId = typeof token.claims.agencyId === 'string'
      ? token.claims.agencyId
      : typeof firebaseClaim === 'object' && firebaseClaim && 'tenant' in firebaseClaim
        ? String(firebaseClaim.tenant)
        : undefined;
  } catch {
    // Continue with Firestore resolution
  }

  if (db && isFirebaseConfigured()) {
    try {
      // 1. If agencyId was resolved from token, check agency membership
      if (agencyId) {
        const membershipDoc = await getDoc(doc(db, 'agencies', agencyId, 'memberships', user.uid));
        if (membershipDoc.exists()) {
          const data = membershipDoc.data();
          const role = (data.role && validRoles.has(data.role as UserRole)) ? (data.role as UserRole) : 'proinspect_admin';
          return syncStorageAndReturn({
            id: user.uid,
            agencyId,
            displayName: data.displayName || user.displayName || user.email?.split('@')[0] || 'User',
            email: user.email || '',
            role,
            status: 'active',
            createdAt: data.createdAt || timestamp,
            updatedAt: data.updatedAt || timestamp,
          });
        }
      }

      // 2. Check user profile in /users/{uid}
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if (userDoc.exists()) {
        const data = userDoc.data();
        const resolvedAgencyId = data.agencyId || agencyId || DEFAULT_AGENCY_ID;
        const role = (data.role && validRoles.has(data.role as UserRole)) ? (data.role as UserRole) : 'proinspect_admin';
        return syncStorageAndReturn({
          id: user.uid,
          agencyId: resolvedAgencyId,
          displayName: data.displayName || user.displayName || user.email?.split('@')[0] || 'User',
          email: user.email || '',
          role,
          status: 'active',
          createdAt: data.createdAt || timestamp,
          updatedAt: data.updatedAt || timestamp,
        });
      }

      // 3. Check default agency membership
      const defaultAgencyId = agencyId || DEFAULT_AGENCY_ID;
      const defaultMembershipDoc = await getDoc(doc(db, 'agencies', defaultAgencyId, 'memberships', user.uid));
      if (defaultMembershipDoc.exists()) {
        const data = defaultMembershipDoc.data();
        const role = (data.role && validRoles.has(data.role as UserRole)) ? (data.role as UserRole) : 'proinspect_admin';
        return syncStorageAndReturn({
          id: user.uid,
          agencyId: defaultAgencyId,
          displayName: data.displayName || user.displayName || user.email?.split('@')[0] || 'User',
          email: user.email || '',
          role,
          status: 'active',
          createdAt: data.createdAt || timestamp,
          updatedAt: data.updatedAt || timestamp,
        });
      }

      // 4. Provision default admin membership and profile for authenticated user
      const isSuperAdminEmail = user.email?.toLowerCase() === 'info@remotebusinesspartner.com.au' || user.email?.toLowerCase() === 'info@proinspect.systems';
      const assignedRole: UserRole = isSuperAdminEmail ? 'super_admin' : 'proinspect_admin';
      const displayName = user.displayName || (user.email === 'info@remotebusinesspartner.com.au' ? 'ProInspect Admin (RBP)' : user.email?.split('@')[0]) || 'Administrator';
      const profile: UserProfile = {
        id: user.uid,
        agencyId: defaultAgencyId,
        displayName,
        email: user.email || '',
        role: assignedRole,
        status: 'active',
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      try {
        await Promise.all([
          setDoc(doc(db, 'users', user.uid), {
            displayName,
            email: user.email || '',
            role: assignedRole,
            agencyId: defaultAgencyId,
            status: 'active',
            createdAt: timestamp,
            updatedAt: timestamp,
          }, { merge: true }),
          setDoc(doc(db, 'agencies', defaultAgencyId, 'memberships', user.uid), {
            displayName,
            email: user.email || '',
            role: assignedRole,
            agencyId: defaultAgencyId,
            status: 'active',
            createdAt: timestamp,
            updatedAt: timestamp,
          }, { merge: true }),
        ]);
      } catch (err) {
        console.warn('Could not write provisioned profile to Firestore, returning local active profile', err);
      }

      return syncStorageAndReturn(profile);
    } catch (err) {
      console.warn('Error reading from Firestore profile collections, using active fallback profile', err);
    }
  }

  // Fallback for authenticated user if Firestore is uninitialized or unreachable
  const isSuperAdminEmail = user.email?.toLowerCase() === 'info@remotebusinesspartner.com.au' || user.email?.toLowerCase() === 'info@proinspect.systems';
  return syncStorageAndReturn({
    id: user.uid,
    agencyId: agencyId || DEFAULT_AGENCY_ID,
    displayName: user.displayName || (user.email === 'info@remotebusinesspartner.com.au' ? 'ProInspect Admin (RBP)' : user.email?.split('@')[0]) || 'Administrator',
    email: user.email || '',
    role: isSuperAdminEmail ? 'super_admin' : 'proinspect_admin',
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
  });
};
