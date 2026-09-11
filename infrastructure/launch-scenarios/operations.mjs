import { Buffer } from 'node:buffer';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { git, requireThat, root } from '../upgrades/launch-readiness-v2/runtime.mjs';
import { currentAction, applyExternalChecks } from './common.mjs';

export async function runScenario(probe) {
  const backup=currentAction('backup',probe.input);const age=Date.now()-Date.parse(backup?.result?.completedAt);const max=(probe.input.target.acceptance.evidenceMaxAgeHours??24)*3600000;
  requireThat(backup?.status==='SUCCEEDED'&&backup.result?.restored===true&&Number.isFinite(age)&&age>=0&&age<=max,'Operations acceptance requires a current verified backup/restore');
  const runbook=probe.input.target.acceptance.operationsRunbook;requireThat(typeof runbook==='string'&&existsSync(resolve(root,runbook)),'Operations runbook is missing');git(['ls-files','--error-unmatch','--',runbook]);
  applyExternalChecks(probe,probe.input,probe.input.gate.checks,['operations-rehearsal','automated-test']);
  probe.artifact('operations-live.json',Buffer.from(JSON.stringify({backupCompletedAt:backup.result.completedAt,runbook})));
}
