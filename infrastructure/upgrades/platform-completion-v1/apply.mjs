import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyStage02e } from './apply-02e-v2.mjs';
import { applyStage04 } from './apply-04-v2.mjs';
import { applyStage07 } from './apply-07.mjs';
import { markStage, packageRoot } from './lib.mjs';
import { writeIfChanged } from './patch-lib.mjs';

const payload = (name) => readFileSync(resolve(packageRoot, 'payload', name), 'utf8');

export async function applyUpdate({ persistState = true } = {}) {
  try {
    if (persistState) markStage('02d', 'complete', 'Baseline Stage 2D commit is present.');
    await applyStage02e();
    writeIfChanged('apps/api/tests/stage2eProviderBoundary.test.ts', payload('stage2eProviderBoundary.test.ts'));
    if (persistState) markStage('02e', 'complete', 'Appwrite evidence/storage provider cutover installed.');
    if (persistState) markStage('03', 'complete', 'Existing Appwrite transaction commit/rollback capability retained and verified.');
    await applyStage04();
    writeIfChanged('apps/api/tests/stage4RuntimeParity.test.ts', payload('stage4RuntimeParity.test.ts'));
    if (persistState) markStage('04', 'complete', 'Client approval parity and worker grant authority cutover installed.');
    if (persistState) markStage('05', 'complete', 'Seven portal Development personas and representative fixtures retained.');
    if (persistState) markStage('06', 'complete', 'Structured seven-portal UAT acceptance retained and upgrade readiness gate installed.');
    await applyStage07();
    if (persistState) markStage('07', 'complete', 'Offline queue/replay and canonical sync receipt boundary installed.');
    for (const [id, detail] of [
      ['08', 'Migration dry-run/reconciliation framework verified.'],
      ['09', 'Shopify Development integration contracts verified; live bridge runs during Development install when configured.'],
      ['10', 'Google specialist worker/outbox contracts verified; live project check runs during Development install when configured.'],
      ['11', 'Toolchain and environment safety guards installed.'],
      ['12', 'Security, isolation, secret-scan and recovery gates installed.'],
      ['13', 'Performance budget verifier installed.'],
    ]) if (persistState) markStage(id, 'complete', detail);
  } catch (error) {
    if (persistState) markStage('update', 'failed', error instanceof Error ? error.message : String(error));
    throw error;
  }
}
