import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID;
const adjacentIntervals = Number(process.env.TOTP_ADJACENT_INTERVALS || '1');

if (!projectId) {
  throw new Error('Set GOOGLE_CLOUD_PROJECT or FIREBASE_PROJECT_ID before enabling TOTP MFA.');
}
if (!Number.isInteger(adjacentIntervals) || adjacentIntervals < 0 || adjacentIntervals > 10) {
  throw new Error('TOTP_ADJACENT_INTERVALS must be an integer between 0 and 10.');
}

const app = getApps()[0] ?? initializeApp({
  credential: applicationDefault(),
  projectId,
});

await getAuth(app).projectConfigManager().updateProjectConfig({
  multiFactorConfig: {
    providerConfigs: [
      {
        state: 'ENABLED',
        totpProviderConfig: { adjacentIntervals },
      },
    ],
  },
});

console.log(JSON.stringify({
  event: 'identity-platform.totp-mfa.enabled',
  projectId,
  adjacentIntervals,
}));
