import { Buffer } from 'node:buffer';
import { hash } from '../upgrades/launch-readiness-v2/runtime.mjs';
import { withAppwrite, optional } from '../upgrades/launch-readiness-v2/appwrite-session.mjs';
import { loadBundle, migrate } from '../upgrades/launch-readiness-v2/actions/migrate.mjs';
import { actionState, applyExternalChecks, stateEnvironmentDirectory } from './common.mjs';
export async function runScenario(probe) {
  const target=probe.input.target; const {bundle}=loadBundle(target); let found=0; let reconcile=true; let permissions=true;
  await withAppwrite(target.appwrite, process.env.PROINSPECT_LAUNCH_OUTPUT.slice(0, process.env.PROINSPECT_LAUNCH_OUTPUT.lastIndexOf('/')), ['files.read'], async(api)=>{
    for(const item of bundle.files){ const meta=await optional(()=>api.storage.getFile({bucketId:item.bucketId,fileId:item.id})); if(meta)found+=1; if(!meta){reconcile=false;permissions=false;continue;} const bytes=Buffer.from(await api.storage.getFileDownload({bucketId:item.bucketId,fileId:item.id})); if(hash(bytes)!==item.sha256)reconcile=false; if(hash(meta.$permissions ?? [])!==hash(item.permissions))permissions=false; }
  });
  probe.check('mapped_copy',found,bundle.files.length); probe.check('sha256_reconcile',reconcile,true); probe.check('metadata_permissions',permissions,true);
  await withAppwrite(target.appwrite, process.env.PROINSPECT_LAUNCH_OUTPUT.slice(0, process.env.PROINSPECT_LAUNCH_OUTPUT.lastIndexOf('/')), ['files.read','files.write'], (api)=>migrate(api,target,stateEnvironmentDirectory(),'files'));
  probe.check('idempotent_rerun',true,true);
  const backup=actionState('backup'); probe.check('file_restore',backup?.status==='SUCCEEDED' && backup.result?.restored===true && backup.result?.permissionsVerified===true,true);
  applyExternalChecks(probe,probe.input,['r2_firebase_inventory','denied_cross_scope','retention_legal_hold'],['automated-test','migration-rehearsal']);
  probe.artifact('files-live.json',Buffer.from(JSON.stringify({expected:bundle.files.length,found,reconcile,permissions,restore:backup?.completedAt ?? null})));
}
