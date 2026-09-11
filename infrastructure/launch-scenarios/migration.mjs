import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { hash } from '../upgrades/launch-readiness-v2/runtime.mjs';
import { privateDirectory } from '../upgrades/launch-readiness-v2/configuration.mjs';
import { withAppwrite, optional, rowData } from '../upgrades/launch-readiness-v2/appwrite-session.mjs';
import { loadBundle, migrate, orderedRows, validateBundle } from '../upgrades/launch-readiness-v2/actions/migrate.mjs';
import { applyExternalChecks, stateEnvironmentDirectory } from './common.mjs';
export async function runScenario(probe) {
  const target = probe.input.target; const loaded = loadBundle(target); const bundle = loaded.bundle; const dispositions = bundle.sourceDisposition ?? [];
  probe.check('d1_49_table_disposition', new Set(dispositions.map((v)=>v.table ?? v.source ?? JSON.stringify(v))).size >= 49, true);
  probe.check('transform_deterministic', bundle.rows.every((r)=>hash(r.data)===r.sha256) && orderedRows(bundle.rows).length===bundle.rows.length, true);
  const dupe = JSON.parse(JSON.stringify(bundle)); if (dupe.rows.length) dupe.rows.push(JSON.parse(JSON.stringify(dupe.rows[0]))); let duplicateRejected = dupe.rows.length === 0;
  if (dupe.rows.length) { try { validateBundle(dupe); } catch { duplicateRejected = true; } }
  probe.check('duplicates_rejected', duplicateRejected, true);
  let parents = true; let counts = 0; let checksums = true;
  await withAppwrite(target.appwrite, process.env.PROINSPECT_LAUNCH_OUTPUT.slice(0, process.env.PROINSPECT_LAUNCH_OUTPUT.lastIndexOf('/')), ['rows.read'], async (api) => {
    for (const row of bundle.rows) {
      for (const parent of row.parents) if (!(await optional(() => api.db.getRow({databaseId:target.appwrite.databaseId,tableId:parent.tableId,rowId:parent.id})))) parents = false;
      const live = await optional(() => api.db.getRow({databaseId:target.appwrite.databaseId,tableId:row.tableId,rowId:row.id})); if (live) counts += 1;
      if (!live || hash(rowData(live))!==row.sha256 || hash(live.$permissions ?? [])!==hash(row.permissions)) checksums = false;
    }
  });
  probe.check('parent_resolution', parents, true); probe.check('development_import', counts===bundle.rows.length, true); probe.check('target_count', counts, bundle.rows.length); probe.check('checksum_reconcile', checksums, true);
  const journalBefore = readFileSync(stateEnvironmentDirectory() + '/migration-' + target.migration.bundleSha256 + '.json','utf8');
  await withAppwrite(target.appwrite, process.env.PROINSPECT_LAUNCH_OUTPUT.slice(0, process.env.PROINSPECT_LAUNCH_OUTPUT.lastIndexOf('/')), ['rows.read','rows.write'], (api)=>migrate(api,target,stateEnvironmentDirectory(),'data'));
  const journalAfter = readFileSync(stateEnvironmentDirectory() + '/migration-' + target.migration.bundleSha256 + '.json','utf8');
  probe.check('idempotent_rerun', JSON.parse(journalAfter).bundleSha256===JSON.parse(journalBefore).bundleSha256, true);
  const external=applyExternalChecks(probe,probe.input,['source_count','rollback_rehearsal'],['migration-rehearsal','automated-test']);
  probe.artifact('migration-live.json', Buffer.from(JSON.stringify({ rows:bundle.rows.length,dispositions:dispositions.length,counts,checksums,rollbackObservedAt:external?.observedAt ?? null,bundleDirectory:privateDirectory(target.migration.bundleDirectory) ? '[private]' : null })));
}
