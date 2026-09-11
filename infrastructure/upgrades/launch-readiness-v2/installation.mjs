import { existsSync,mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicJson,readJson,requireThat,candidate,assertClean,git,redact,root,sameSourceCandidate } from './runtime.mjs';
import { approvedConfig,targetEnv,privateDirectory } from './configuration.mjs';
import { auditProviders,toolchain } from './providers.mjs';
import { action,installationOrder,requireBackup } from './actions/index.mjs';
import { scorecard } from './evidence.mjs';
import { loadBundle } from './actions/migrate.mjs';
import { validateCredentialPolicy } from './actions/credentials.mjs';
export function actionPlan(args){
  const allowed=[...installationOrder,'rollback-google','rollback-cloudflare','rollback-migration'];
  const selected=args.stage && args.stage!=='all'?[args.stage]:args.command==='deploy'?['google','cloudflare']:installationOrder;
  requireThat(selected.every((id)=>allowed.includes(id)),'Unknown installation action');return selected;
}
export function actionPreflight(config,args){
  const target=approvedConfig(config,args.env);targetEnv(target);
  const selected=actionPlan(args);
  if(selected.some((id)=>['backup','schema','data','files','terraform','credentials','google','cloudflare'].includes(id))){
    privateDirectory(target.backup.directory);requireThat(target.backup.freezeApproved===true,'Freeze application and worker writes before changes');
  }
  if(selected.some((id)=>['data','files','rollback-migration'].includes(id)))loadBundle(target);
  if(selected.includes('credentials'))validateCredentialPolicy(target.appwrite.runtimeCredentialPolicies,target.google.services);
  if(selected.includes('terraform'))for(const path of [target.terraform.variablesFile,target.terraform.backendFile])requireThat(typeof path==='string' && existsSync(path),'Private Terraform input missing');
  if(selected.includes('shopify'))requireThat(target.shopify.replay?.syntheticOnly===true,'Configure isolated synthetic Shopify replay fixtures before installation');
  return target;
}
export async function install(config,args,directory){
  const selected=actionPlan(args);const target=actionPreflight(config,args);await toolchain(true);
  const kind=args.command==='deploy'?'DEPLOY':'INSTALL';
  requireThat(args.apply && args.confirm===`${kind}:${args.env}:${target.appwrite.projectId}`,'Incorrect exact installation confirmation');
  let current=config;let context=candidate(current,args.env);
  if(args.env==='staging' && selected.some((id)=>!id.startsWith('rollback-'))){
    const developmentContext=candidate(current,'development');
    requireThat(sameSourceCandidate(context,developmentContext),'Staging and Development must use the same immutable source candidate');
    const dev=scorecard(directory,developmentContext).filter((g)=>g.id!=='rehearsal');
    requireThat(dev.every((g)=>g.status==='PASS'),'The same source candidate must pass Development before Staging mutation');
  }
  requireThat(!args.resume,'Use --resume for verification only. Retry an explicit installation --stage after inspecting remote state');
  const session=resolve(directory,args.env,'installations',randomUUID());mkdirSync(session,{recursive:true,mode:0o700});
  await auditProviders(current,args.env,session);
  const results=[];
  for(const id of selected){
    assertClean();requireThat(git(['rev-parse','HEAD'])===context.commit,'Source candidate changed');
    const folder=resolve(session,id);mkdirSync(folder,{recursive:true,mode:0o700});
    const statePath=resolve(directory,args.env,'actions',`${id}.json`);
    if(id!=='source' && !id.startsWith('rollback-')){
      const validation=readJson(resolve(directory,args.env,'actions/source.json'));
      requireThat(validation.status==='SUCCEEDED' && validation.candidate.commit===context.commit,'Run the source installation stage first');
    }
    if(!['source','backup','rollback-google','rollback-cloudflare','rollback-migration'].includes(id))requireBackup(directory,context);
    atomicJson(statePath,{status:'RUNNING',id,candidate:context,folder});
    try{
      const result=await action(id,current,context,folder,directory,randomUUID());
      assertClean();requireThat(git(['rev-parse','HEAD'])===context.commit,'Action changed source');
      atomicJson(statePath,{status:'SUCCEEDED',id,candidate:context,folder,result,completedAt:new Date().toISOString()});
      results.push({id,result});console.log(`SUCCEEDED ${id}; acceptance remains separate`);
      if(result.configurationChanged){
        current=readJson(resolve(directory,'config.json'));context=candidate(current,args.env);
        const sourceFolder=resolve(session,'post-credential-source');mkdirSync(sourceFolder,{recursive:true,mode:0o700});
        const sourceResult=await action('source',current,context,sourceFolder,directory,randomUUID());
        atomicJson(resolve(directory,args.env,'actions','source.json'),{status:'SUCCEEDED',id:'source',candidate:context,folder:sourceFolder,result:sourceResult,completedAt:new Date().toISOString()});
        const backupFolder=resolve(session,'post-credential-backup');mkdirSync(backupFolder,{recursive:true,mode:0o700});
        await action('backup',current,context,backupFolder,directory,randomUUID());
      }
    }catch(error){atomicJson(statePath,{status:'FAILED',id,candidate:context,folder,error:redact(error.message),inspectBeforeRetry:true});throw error;}
  }
  return {status:'INSTALLED_NOT_LAUNCH_READY',results:results.map((r)=>r.id),session,sourceRoot:root};
}
