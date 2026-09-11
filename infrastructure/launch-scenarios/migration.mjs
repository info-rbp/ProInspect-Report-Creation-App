import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { hash } from '../upgrades/launch-readiness-v2/runtime.mjs';
import { privateDirectory } from '../upgrades/launch-readiness-v2/configuration.mjs';
import { optional, rowData, withAppwrite } from '../upgrades/launch-readiness-v2/appwrite-session.mjs';
import { loadBundle, migrate, orderedRows, validateBundle } from '../upgrades/launch-readiness-v2/actions/migrate.mjs';
import { applyExternalChecks, stateEnvironmentDirectory } from './common.mjs';

export async function runScenario(probe) {
  const target=probe.input.target;const {bundle}=loadBundle(target);const ordered=orderedRows(bundle.rows);
  const deterministic=bundle.rows.every((row)=>hash(row.data)===row.sha256) && ordered.length===bundle.rows.length;
  const duplicate=JSON.parse(JSON.stringify(bundle));if(duplicate.rows.length)duplicate.rows.push(JSON.parse(JSON.stringify(duplicate.rows[0])));let duplicateRejected=duplicate.rows.length===0;
  if(duplicate.rows.length){try{validateBundle(duplicate);}catch{duplicateRejected=true;}}
  let parents=true;let count=0;let checksums=true;
  await withAppwrite(target.appwrite,process.env.PROINSPECT_LAUNCH_OUTPUT.slice(0,process.env.PROINSPECT_LAUNCH_OUTPUT.lastIndexOf('/')),['rows.read'],async(api)=>{
    for(const row of bundle.rows){
      for(const parent of row.parents)if(!(await optional(()=>api.db.getRow({databaseId:target.appwrite.databaseId,tableId:parent.tableId,rowId:parent.id}))))parents=false;
      const live=await optional(()=>api.db.getRow({databaseId:target.appwrite.databaseId,tableId:row.tableId,rowId:row.id}));if(live)count+=1;
      if(!live||hash(rowData(live))!==row.sha256||hash(live.$permissions??[])!==hash(row.permissions))checksums=false;
    }
  });
  probe.check('deterministic_id_parent_integrity',deterministic && parents,true);
  probe.check('source_target_counts_checksums',count===bundle.rows.length && checksums,true);
  const journalPath=stateEnvironmentDirectory()+'/migration-'+target.migration.bundleSha256+'.json';const before=readFileSync(journalPath,'utf8');
  await withAppwrite(target.appwrite,process.env.PROINSPECT_LAUNCH_OUTPUT.slice(0,process.env.PROINSPECT_LAUNCH_OUTPUT.lastIndexOf('/')),['rows.read','rows.write'],(api)=>migrate(api,target,stateEnvironmentDirectory(),'data'));
  const after=readFileSync(journalPath,'utf8');let afterCount=0;let afterChecksums=true;
  await withAppwrite(target.appwrite,process.env.PROINSPECT_LAUNCH_OUTPUT.slice(0,process.env.PROINSPECT_LAUNCH_OUTPUT.lastIndexOf('/')),['rows.read'],async(api)=>{for(const row of bundle.rows){const live=await optional(()=>api.db.getRow({databaseId:target.appwrite.databaseId,tableId:row.tableId,rowId:row.id}));if(live)afterCount+=1;if(!live||hash(rowData(live))!==row.sha256||hash(live.$permissions??[])!==hash(row.permissions))afterChecksums=false;}});
  probe.check('zero_duplicate_rerun',duplicateRejected && hash(JSON.parse(after))===hash(JSON.parse(before)) && afterCount===bundle.rows.length && afterChecksums,true);
  const external=applyExternalChecks(probe,probe.input,['all_49_d1_tables_disposition','firestore_domain_disposition','approved_unit_role_mapping','interrupted_resume','rollback_rehearsal','final_delta_rehearsal','no_source_deletion'],['migration-rehearsal','automated-test']);
  probe.artifact('migration-live.json',Buffer.from(JSON.stringify({rows:bundle.rows.length,dispositions:(bundle.sourceDisposition??[]).length,count,checksums,externalObservedAt:external?.observedAt??null,bundleDirectory:privateDirectory(target.migration.bundleDirectory)?'[private]':null})));
}
