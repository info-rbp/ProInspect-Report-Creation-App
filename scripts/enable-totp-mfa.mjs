import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { buildTotpMfaUpdate } from './totp-mfa-config.mjs';

const googleProjectId = process.env.GOOGLE_CLOUD_PROJECT?.trim();
const firebaseProjectId = process.env.FIREBASE_PROJECT_ID?.trim();
const projectId = googleProjectId || firebaseProjectId;
const adjacentIntervals = Number(process.env.TOTP_ADJACENT_INTERVALS || '1');

if (!projectId) {
  throw new Error('Set GOOGLE_CLOUD_PROJECT or FIREBASE_PROJECT_ID before enabling TOTP MFA.');
}
if (googleProjectId && firebaseProjectId && googleProjectId !== firebaseProjectId) {
  throw new Error('GOOGLE_CLOUD_PROJECT and FIREBASE_PROJECT_ID must identify the same project.');
}
if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u.test(projectId)) {
  throw new Error('The configured Firebase project ID is not valid.');
}
if (!Number.isInteger(adjacentIntervals) || adjacentIntervals < 0 || adjacentIntervals > 10) {
  throw new Error('TOTP_ADJACENT_INTERVALS must be an integer between 0 and 10.');
}

const app = getApps()[0] ?? initializeApp({
  credential: applicationDefault(),
  projectId,
});

const manager = getAuth(app).projectConfigManager();
const currentConfig = await manager.getProjectConfig();
const update = buildTotpMfaUpdate(currentConfig, adjacentIntervals);
if (update.changed) {
  await manager.updateProjectConfig({ multiFactorConfig: update.multiFactorConfig });
}

console.log(JSON.stringify({
  event: update.changed
    ? 'identity-platform.totp-mfa.enabled'
    : 'identity-platform.totp-mfa.already-enabled',
  projectId,
  adjacentIntervals,
}));
