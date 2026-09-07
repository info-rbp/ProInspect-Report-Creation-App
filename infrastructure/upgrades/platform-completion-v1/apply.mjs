import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyStage02e } from './apply-02e-v2.mjs';
import { applyStage04 } from './apply-04-v2.mjs';
import { applyStage07 } from './apply-07.mjs';
import { applyStage07LiveSchemaFix } from './apply-07-live-schema-fix.mjs';
import { applyLintCleanup } from './apply-lint-cleanup.mjs';
import { packageRoot } from './lib.mjs';
import { writeIfChanged } from './patch-lib.mjs';

const payload = (name) => readFileSync(resolve(packageRoot, 'payload', name), 'utf8');

// Applying source alone must never record Development acceptance.
export async function applyUpdate() {
  await applyStage02e();
  writeIfChanged('apps/api/tests/stage2eProviderBoundary.test.ts', payload('stage2eProviderBoundary.test.ts'));
  await applyStage04();
  writeIfChanged('apps/api/tests/stage4RuntimeParity.test.ts', payload('stage4RuntimeParity.test.ts'));
  await applyStage07();
  await applyStage07LiveSchemaFix();
  writeIfChanged('apps/web/services/stage7OfflineContract.test.ts', payload('stage7OfflineContract.test.ts'));
  writeIfChanged('infrastructure/appwrite/scripts/prepare-seven-portals-development.mjs', payload('prepare-seven-portals-development.mjs'));
  await applyLintCleanup();
}
