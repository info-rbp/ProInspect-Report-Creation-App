import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { hash, requireThat } from '../upgrades/launch-readiness-v2/runtime.mjs';
import { actionState } from './common.mjs';
export async function runScenario(probe) {
  const state = actionState('backup');
  requireThat(state?.status === 'SUCCEEDED' && state.candidate.commit === probe.input.candidate.commit, 'Current-candidate backup action has not succeeded');
  const value = state.result;
  requireThat(value?.restored === true && value.probeRemoved === true, 'Backup restore probe is incomplete');
  requireThat(hash(readFileSync(value.directory + '/index.enc')) === value.indexSha256, 'Encrypted backup index changed');
  probe.check('backup_encrypted', value.encryption, 'AES-256-GCM');
  probe.check('database_snapshot', value.databaseSnapshot === true, true);
  probe.check('file_snapshot', value.fileSnapshot === true, true);
  probe.check('consistency_read', value.consistencyVerified === true, true);
  probe.check('isolated_restore', value.probeRemoved === true, true);
  probe.check('restored_checksums_permissions', value.checksumsVerified === true && value.permissionsVerified === true, true);
  probe.artifact('recovery.json', Buffer.from(JSON.stringify({ runId:value.runId,tables:value.tables,rows:value.rows,files:value.files,completedAt:value.completedAt })));
}
