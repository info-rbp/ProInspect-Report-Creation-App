import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { hash, requireThat } from '../upgrades/launch-readiness-v2/runtime.mjs';
import { currentAction, applyExternalChecks } from './common.mjs';

export async function runScenario(probe) {
  const state=currentAction('backup',probe.input);
  requireThat(state.result?.restored===true,'Current-candidate backup action has not succeeded');
  const value=state.result;
  requireThat(value?.restored===true && value.probeRemoved===true,'Backup restore probe is incomplete');
  requireThat(hash(readFileSync(value.directory+'/index.enc'))===value.indexSha256,'Encrypted backup index changed');
  probe.check('database_backup',value.databaseSnapshot===true && value.encryption==='AES-256-GCM',true);
  probe.check('database_restore',value.restored===true && value.probeRemoved===true && value.checksumsVerified===true,true);
  probe.check('file_backup',value.fileSnapshot===true && value.encryption==='AES-256-GCM',true);
  probe.check('file_restore',value.restored===true && value.probeRemoved===true && value.permissionsVerified===true,true);
  probe.check('source_checksums',value.consistencyVerified===true && value.checksumsVerified===true,true);
  applyExternalChecks(probe,probe.input,['source_counts','retention_and_rto_rpo'],['automated-test','operations-rehearsal']);
  probe.artifact('recovery.json',Buffer.from(JSON.stringify({runId:value.runId,tables:value.tables,rows:value.rows,files:value.files,completedAt:value.completedAt,encryption:value.encryption})));
}
