import { Buffer } from 'node:buffer';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, git } from '../upgrades/launch-readiness-v2/runtime.mjs';
import { actionState, applyExternalChecks, receipt } from './common.mjs';
export async function runScenario(probe) {
  if(probe.input.candidate.environment!=='staging')throw new Error('Cutover rehearsal is Staging-only');
  probe.check('staging_isolated',/staging/u.test(probe.input.target.web.origin) && /staging/u.test(probe.input.target.cloudflare.workerName),true);
  const migration=actionState('data'); probe.check('staging_migration',migration?.status==='SUCCEEDED',true);
  probe.check('seven_persona_e2e',receipt('identity')?.status==='PASS',true);
  const providerActions=['terraform','google','cloudflare','shopify']; probe.check('providers_live',providerActions.every((id)=>actionState(id)?.status==='SUCCEEDED'),true);
  probe.check('device_matrix',receipt('offline')?.status==='PASS',true);
  const rollbackOk=['rollback-google','rollback-cloudflare','rollback-migration'].every((id)=>actionState(id)?.status==='SUCCEEDED'); probe.check('rollback_tested',rollbackOk,true);
  probe.check('restore_tested',actionState('backup')?.result?.restored===true,true);
  const runbook=probe.input.target.acceptance.cutoverRunbook; const tracked=typeof runbook==='string' && existsSync(resolve(root,runbook)); if(tracked)git(['ls-files','--error-unmatch','--',runbook]);
  const external=applyExternalChecks(probe,probe.input,['cutover_runbook'],['staging-rehearsal']);
  probe.artifact('rehearsal-live.json',Buffer.from(JSON.stringify({migration:migration?.completedAt,rollbackOk,restore:actionState('backup')?.completedAt,cutoverRunbook:tracked,externalObservedAt:external?.observedAt ?? null})));
}
