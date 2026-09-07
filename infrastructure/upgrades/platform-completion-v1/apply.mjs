import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyStage02e } from './apply-02e-v2.mjs';
import { applyStage04 } from './apply-04-v2.mjs';
import { applyStage07 } from './apply-07.mjs';
import { applyStage07LiveSchemaFix } from './apply-07-live-schema-fix.mjs';
import { applyLintCleanup } from './apply-lint-cleanup.mjs';
import { markStage, packageRoot } from './lib.mjs';
import { writeIfChanged } from './patch-lib.mjs';

const payload = (name) => readFileSync(resolve(packageRoot, 'payload', name), 'utf8');

export async function applyUpdate({ persistState = true } = {}) {
  try {
    if (persistState) markStage('02d', 'complete', 'Baseline Stage 2D commit is present.');

    await applyStage02e();
    writeIfChanged(
      'apps/api/tests/stage2eProviderBoundary.test.ts',
      payload('stage2eProviderBoundary.test.ts'),
    );
    if (persistState) {
      markStage('02e', 'complete', 'Appwrite evidence/storage provider cutover installed.');
      markStage('03', 'complete', 'Existing Appwrite transaction commit/rollback capability retained and verified.');
    }

    await applyStage04();
    writeIfChanged(
      'apps/api/tests/stage4RuntimeParity.test.ts',
      payload('stage4RuntimeParity.test.ts'),
    );
    if (persistState) {
      markStage('04', 'complete', 'Client approval parity and worker grant authority cutover installed.');
    }

    await applyStage07();
    await applyStage07LiveSchemaFix();
    writeIfChanged(
      'apps/web/services/stage7OfflineContract.test.ts',
      payload('stage7OfflineContract.test.ts'),
    );
    writeIfChanged(
      'infrastructure/appwrite/scripts/prepare-seven-portals-development.mjs',
      payload('prepare-seven-portals-development.mjs'),
    );

    await applyLintCleanup();

    for (const [id, detail] of [
      ['05', 'Seven portal Development personas and representative fixtures retained.'],
      ['06', 'Local seven-portal UAT acceptance contract retained and upgrade readiness gate installed.'],
      ['07', 'Offline queue/replay, canonical sync receipts and regression contract installed.'],
      ['08', 'Migration dry-run/reconciliation framework verified.'],
      ['09', 'Shopify Development integration contracts verified; exact Development target is checked during guarded install.'],
      ['10', 'Google specialist worker/outbox contracts verified; explicit Development project is checked during guarded install.'],
      ['11', 'Toolchain and environment safety guards installed.'],
      ['12', 'Security, isolation, secret-scan and recovery gates installed.'],
      ['13', 'Performance budget verifier installed.'],
    ]) {
      if (persistState) markStage(id, 'complete', detail);
    }
  } catch (error) {
    if (persistState) {
      markStage('update', 'failed', error instanceof Error ? error.message : String(error));
    }
    throw error;
  }
}
