import { Buffer } from 'node:buffer';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { git, root, requireThat } from '../upgrades/launch-readiness-v2/runtime.mjs';
import { actionState, applyExternalChecks } from './common.mjs';
export async function runScenario(probe) {
  const backup=actionState('backup'); const age=Date.now()-Date.parse(backup?.result?.completedAt); const max=(probe.input.target.acceptance.evidenceMaxAgeHours ?? 24)*3600000;
  probe.check('backup_restore_age',backup?.status==='SUCCEEDED' && backup.result?.restored===true && Number.isFinite(age) && age>=0 && age<=max,true);
  const runbook=probe.input.target.acceptance.operationsRunbook; requireThat(typeof runbook==='string' && existsSync(resolve(root,runbook)),'Operations runbook is missing'); git(['ls-files','--error-unmatch','--',runbook]); probe.check('support_runbook',true,true);
  applyExternalChecks(probe,probe.input,['cloud_run_alerts','cloudflare_alerts','appwrite_errors','worker_backlog','failed_webhooks','failed_notifications'],['operations-rehearsal','automated-test']);
  probe.artifact('operations-live.json',Buffer.from(JSON.stringify({backupCompletedAt:backup.result.completedAt,runbook})));
}
