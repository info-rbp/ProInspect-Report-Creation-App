import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const email = (process.argv[2] || process.env.PROINSPECT_PROVIDER_ADMIN_EMAIL || '').trim().toLowerCase();
const providerId = (process.env.PROINSPECT_PROVIDER_ID || 'proinspect').trim();
const homeAgencyId = (process.env.PROINSPECT_HOME_AGENCY_ID || 'agency-1').trim();
if (!email) {
  console.error('Usage: npm run provision:provider-admin -- admin@example.com');
  process.exit(64);
}

const app = getApps()[0] ?? initializeApp({ credential: applicationDefault() });
const auth = getAuth(app);
const db = getFirestore(app);
const user = await auth.getUserByEmail(email);
const now = new Date().toISOString();
const existingClaims = user.customClaims || {};

await auth.setCustomUserClaims(user.uid, { ...existingClaims, agencyId: homeAgencyId, providerId, providerRole: 'super_admin' });
await Promise.all([
  db.doc(`serviceProviders/${providerId}/memberships/${user.uid}`).set({ uid:user.uid, providerId, email, role:'super_admin', status:'active', mfaRequired:true, createdAt:now, updatedAt:now }, { merge:true }),
  db.doc(`agencies/${homeAgencyId}/memberships/${user.uid}`).set({ uid:user.uid, agencyId:homeAgencyId, email, role:'super_admin', status:'active', mfaRequired:true, createdAt:now, updatedAt:now }, { merge:true }),
  db.doc(`users/${user.uid}`).set({ email, agencyId:homeAgencyId, providerId, role:'super_admin', status:'active', updatedAt:now }, { merge:true }),
]);
console.log(`Provisioned ${email} as explicit ProInspect provider super_admin (${providerId}) with home agency ${homeAgencyId}.`);
console.log('The user must sign out and sign back in so refreshed Firebase custom claims are issued.');
