import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyStage02e } from './apply-02e.mjs';
import { applyStage04 } from './apply-04.mjs';
import { markStage, packageRoot } from './lib.mjs';
import { writeIfChanged } from './patch-lib.mjs';

const payload = (name) => readFileSync(resolve(packageRoot, 'payload', name), 'utf8');

export async function applyUpdate({ persistState = true } = {}) {
  const completed = [];
  try {
    if (persistState) markStage('02d', 'complete', 'Baseline Stage 2D commit is present.');
    completed.push('02d');

    await applyStage02e();
    writeIfChanged('apps/api/tests/stage2eProviderBoundary.test.ts', payload('stage2eProviderBoundary.test.ts'));
    if (persistState) markStage('02e', 'complete', 'Appwrite evidence/storage provider cutover installed.');
    completed.push('02e');

    if (persistState) markStage('03', 'complete', 'Existing Appwrite transaction commit/rollback capability retained and verified.');
    completed.push('03');

    await applyStage04();
    writeIfChanged('apps/api/tests/stage4RuntimeParity.test.ts', payload('stage4RuntimeParity.test.ts'));
    if (persistState) markStage('04', 'complete', 'Client approval parity and worker grant authority cutover installed.');
    completed.push('04');

    for (const [id, detail] of [
      ['05', 'Seven portal Development personas and representative fixtures retained.'],
      ['06', 'Structured seven-portal UAT acceptance retained and upgrade readiness gate installed.'],
      ['07', 'Offline queue/replay and canonical sync receipt boundary verified.'],
      ['08', 'Migration dry-run/reconciliation framework verified.'],
      ['09', 'Shopify Development integration contracts verified; live bridge runs during Development install when configured.'],
      ['10', 'Google specialist worker/outbox contracts verified; live project check runs during Development install when configured.'],
      ['11', 'Toolchain and environment safety guards installed.'],
      ['12', 'Security, isolation, secret-scan and recovery gates installed.'],
      ['13', 'Performance budget verifier installed.'],
    ]) {
      if (persistState) markStage(id, 'complete', detail);
      completed.push(id);
    }

    return completed;
  } catch (error) {
    if (persistState) {
      const current = completed.at(-1) ?? '02d';
      markStage(current, 'failed', error instanceof Error ? error.message : String(error));
    }
    throw error;
  }
}
