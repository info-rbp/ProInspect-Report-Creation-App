import { existsSync, readFileSync } from 'node:fs';

const problems = [];
const warnings = [];
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const wrangler = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const firebaseConfig = JSON.parse(readFileSync(new URL('../firebase-cloudflare-config.json', import.meta.url), 'utf8'));

if (packageJson.packageManager !== 'npm@10.9.2') {
  problems.push('package.json must pin packageManager to npm@10.9.2 for the Cloudflare build image.');
}
if (packageJson.devDependencies?.wrangler !== '4.120.0') {
  problems.push('Wrangler must be pinned to 4.120.0 so deploy behavior cannot drift between builds.');
}
if (existsSync(new URL('../bun.lock', import.meta.url))) {
  if (process.env.WORKERS_CI) {
    warnings.push('bun.lock exists in the ephemeral Workers build workspace. Cloudflare may have generated it during automatic dependency installation.');
  } else {
    problems.push('bun.lock must not be committed; npm is the canonical package manager for this repository.');
  }
}
if (wrangler.name !== 'proinspect') problems.push('wrangler.jsonc worker name must be proinspect.');
if (wrangler.main !== './cloudflare/worker.js') problems.push('wrangler.jsonc must use cloudflare/worker.js as the Worker entrypoint.');
if (wrangler.assets?.directory !== './apps/web/dist') problems.push('wrangler.jsonc must publish apps/web/dist as static assets.');
if (wrangler.assets?.not_found_handling !== 'single-page-application') problems.push('Cloudflare assets must use SPA fallback handling.');

const requiredFirebaseFields = [
  'apiKey',
  'authDomain',
  'projectId',
  'storageBucket',
  'messagingSenderId',
  'appId',
];
const missingEmbeddedFirebaseFields = requiredFirebaseFields.filter((name) => !String(firebaseConfig[name] || '').trim());
if (missingEmbeddedFirebaseFields.length) {
  problems.push(`firebase-cloudflare-config.json is incomplete: ${missingEmbeddedFirebaseFields.join(', ')}`);
}

const requiredFirebaseBuildVars = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
];
const missingFirebaseBuildVars = requiredFirebaseBuildVars.filter((name) => !process.env[name]?.trim());
if (process.env.WORKERS_CI) {
  if (!['1', 'true'].includes((process.env.SKIP_DEPENDENCY_INSTALL || '').toLowerCase())) {
    warnings.push('SKIP_DEPENDENCY_INSTALL=1 is not active. The build can continue, but Cloudflare may perform a redundant automatic dependency install before npm run cloudflare:ci.');
  }
  if (missingFirebaseBuildVars.length && !missingEmbeddedFirebaseFields.length) {
    console.log(JSON.stringify({
      event: 'cloudflare.firebase.embedded-config',
      missingEnvironmentOverrides: missingFirebaseBuildVars,
      projectId: firebaseConfig.projectId,
    }));
  }
}

for (const warning of warnings) console.warn(`Cloudflare build input warning: ${warning}`);

if (problems.length) {
  for (const problem of problems) console.error(`Cloudflare build input error: ${problem}`);
  process.exit(1);
}

console.log(JSON.stringify({
  event: 'cloudflare.build.inputs.valid',
  commit: process.env.WORKERS_CI_COMMIT_SHA || 'local',
  branch: process.env.WORKERS_CI_BRANCH || 'local',
  firebaseProjectId: firebaseConfig.projectId,
  firebaseConfigSource: missingFirebaseBuildVars.length ? 'repository' : 'environment',
}));
