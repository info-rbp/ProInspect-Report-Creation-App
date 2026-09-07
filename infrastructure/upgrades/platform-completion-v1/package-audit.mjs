import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { manifest, packageRoot, root } from './lib.mjs';

const failures = [];
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
};
const packageHas = (path) => existsSync(resolve(packageRoot, path));
const packageText = (path) => readFileSync(resolve(packageRoot, path), 'utf8');

console.log(`ProInspect ${manifest.id} v${manifest.version} package audit`);

const expectedStages = ['02d','02e','03','04','05','06','07','08','09','10','11','12','13'];
check(JSON.stringify(manifest.stages.map((stage) => stage.id)) === JSON.stringify(expectedStages), 'manifest covers Stage 2D through Stage 13 in order');
check(manifest.baselineCommit === '030d2650870f09556e72b7aebb58a4bec2a7a75f', 'Stage 2D baseline commit is pinned');
check(manifest.targetSchemaTables === 121, 'target Appwrite schema is pinned to 121 tables');
check(manifest.localValidationRequired === true, 'local validation is mandatory');
check(manifest.development?.projectId === 'proinspect-development', 'Development Appwrite target is pinned');
check(manifest.development?.shopifyStore === 'proinspect-2.myshopify.com', 'Development Shopify store is pinned');
check(manifest.development?.prohibitedProjectIds?.includes('6a911f1e0031e90015b2'), 'legacy Appwrite project is prohibited');
check(manifest.development?.prohibitedGoogleCloudProjectIds?.includes('business-plan-applicatio-17047'), 'documented Production Google Cloud project is prohibited');

for (const stage of manifest.stages) {
  check(['baseline','migration','verified-existing','closure'].includes(stage.completionMode), `Stage ${stage.id} has an explicit completion mode`);
}

for (const path of [
  'manifest.json','README.md','lib.mjs','patch-lib.mjs','apply.mjs','apply-02e-v2.mjs','apply-04-v2.mjs','apply-07.mjs','stage-verification.mjs','performance-budget.mjs','upgrade.mjs',
  'payload/appwriteEvidenceStore.ts','payload/firestoreEvidenceStore.ts','payload/externalEvidenceCompletionRoutes.ts','payload/stage2eProviderBoundary.test.ts','payload/stage4RuntimeParity.test.ts','payload/stage7OfflineContract.test.ts',
]) check(packageHas(path), `package contains ${path}`);

check(!packageHas('apply-02e.mjs') && !packageHas('apply-04.mjs'), 'superseded patchers are absent');

const apply = packageText('apply.mjs');
for (const marker of ["./apply-02e-v2.mjs","./apply-04-v2.mjs","./apply-07.mjs","stage2eProviderBoundary.test.ts","stage4RuntimeParity.test.ts","stage7OfflineContract.test.ts"]) {
  check(apply.includes(marker), `apply sequence contains ${marker}`);
}

const stage07 = packageText('apply-07.mjs');
check(stage07.includes("agencyEntity('offline_sync_receipts'") && stage07.includes("unique('operation_once',['agencyId','operationId'])") && stage07.includes('toHaveLength(121)'), 'Stage 7 installs idempotent offline receipts and 121-table target');

const rootPackage = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
for (const script of ['appwrite:smoke:portals','upgrade:status','upgrade:preflight','upgrade:apply','upgrade:verify','upgrade:audit','upgrade:install']) {
  check(Boolean(rootPackage.scripts?.[script]), `root package exposes ${script}`);
}

check(existsSync(resolve(root, 'infrastructure/appwrite/scripts/test-seven-portals-development.mjs')), 'local seven-portal acceptance script exists');
check(existsSync(resolve(root, 'apps/web/services/offlineWorkspace.ts')), 'offline workspace implementation exists');

if (failures.length) {
  console.error(`PACKAGE AUDIT FAILED: ${failures.length} issue(s).`);
  process.exitCode = 1;
} else {
  console.log('PACKAGE AUDIT PASS: installer media is structurally complete for Stages 2D-13.');
}
