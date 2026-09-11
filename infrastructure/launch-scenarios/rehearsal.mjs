import { Buffer } from 'node:buffer';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { git, requireThat, root } from '../upgrades/launch-readiness-v2/runtime.mjs';
import { actionState, applyExternalChecks, receipt } from './common.mjs';

export async function runScenario(probe) {
  requireThat(probe.input.candidate.environment==='staging','Cutover rehearsal is Staging-only');
  requireThat(/staging/u.test(probe.input.target.web.origin)&&/staging/u.test(probe.input.target.cloudflare.workerName),'Staging targets are not isolated');
  requireThat(actionState('data')?.status==='SUCCEEDED'&&receipt('identity')?.status==='PASS'&&receipt('offline')?.status==='PASS','Staging migration/persona/device prerequisites are incomplete');
  requireThat(['terraform','google','cloudflare','shopify'].every((id)=>actionState(id)?.status==='SUCCEEDED'),'Staging provider installation is incomplete');
  requireThat(actionState('backup')?.result?.restored===true,'Staging restore rehearsal prerequisite is incomplete');
  const runbook=probe.input.target.acceptance.cutoverRunbook;requireThat(typeof runbook==='string'&&existsSync(resolve(root,runbook)),'Cutover runbook is missing');git(['ls-files','--error-unmatch','--',runbook]);
  const evidence=applyExternalChecks(probe,probe.input,probe.input.gate.checks,['staging-rehearsal']);
  probe.artifact('rehearsal-live.json',Buffer.from(JSON.stringify({migration:actionState('data')?.completedAt,restore:actionState('backup')?.completedAt,runbook,observedAt:evidence?.observedAt??null})));
}
