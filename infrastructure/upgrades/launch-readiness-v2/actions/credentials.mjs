import { resolve } from 'node:path';
import { atomicJson, run, requireThat, readJson, canonical } from '../runtime.mjs';
import { appwriteContext } from '../appwrite-session.mjs';
import { googleIdentity } from './google.mjs';

export function validateCredentialPolicy(policy,services) {
  requireThat(Array.isArray(policy) && policy.length>0,'Declare reviewed per-service runtime credential policies');
  const allowed=new Set(['databases.read','tables.read','columns.read','indexes.read','rows.read','rows.write','files.read','files.write','buckets.read','users.read','users.write','teams.read','teams.write']);
  const seen=new Set();
  for(const item of policy) {
    requireThat(services.includes(item.service) && !seen.has(item.service),'Invalid/duplicate credential service');seen.add(item.service);
    requireThat(/^[a-z][a-z0-9_-]{2,200}$/u.test(item.secretId),'Invalid Secret Manager name');
    requireThat(Number.isInteger(item.expiryHours) && item.expiryHours>=1 && item.expiryHours<=720,'Explicit runtime credential lifetime must be 1-720 hours');
    requireThat(Array.isArray(item.scopes) && item.scopes.length>0 && new Set(item.scopes).size===item.scopes.length && item.scopes.every((s)=>allowed.has(s)),'Excessive or invalid runtime key scopes');
  }
  return true;
}
export function credentialUsable(key,policy,now=Date.now()) {
  const minimumRemaining=Math.min(2*3600000,Math.max(15*60000,Math.floor(policy.expiryHours*3600000/4)));
  return Boolean(key && Date.parse(key.expire)>now+minimumRemaining && canonical([...key.scopes].sort())===canonical([...policy.scopes].sort()));
}
export async function provisionCredentials(config,environment,directory,configurationPath) {
  const target=config.environments[environment];const policies=target.appwrite.runtimeCredentialPolicies;
  validateCredentialPolicy(policies,target.google.services);await googleIdentity(target.google);
  const {cli}=await appwriteContext(target.appwrite,directory);const created=[];const rotations=[];
  const listKeys=async()=>{const result=await cli(['project','list-keys','--project-id',target.appwrite.projectId,'--limit','100']);requireThat(result.total===result.keys.length,'Key inventory truncated');return result.keys;};
  let keys=await listKeys();let metadataChanged=false;
  for(const approved of [...target.appwrite.approvedRuntimeKeys]) {
    if(approved.status==='retiring' && Date.parse(approved.expire)<=Date.now()){
      if(keys.some((key)=>key.$id===approved.id))await cli(['project','delete-key','--project-id',target.appwrite.projectId,'--key-id',approved.id]);
      target.appwrite.approvedRuntimeKeys=target.appwrite.approvedRuntimeKeys.filter((item)=>item.id!==approved.id);keys=keys.filter((key)=>key.$id!==approved.id);metadataChanged=true;
    }
  }
  for(const policy of policies) {
    const binding=target.google.runtimeBindings[policy.service];requireThat(binding?.secretRefs,'Missing runtime binding');
    const bound=binding.secretRefs.APPWRITE_API_KEY;
    let approved=bound ? target.appwrite.approvedRuntimeKeys.find((item)=>item.service===policy.service && item.secretRef===bound && item.status!=='retiring') : null;
    const current=approved ? keys.find((key)=>key.$id===approved.id) : null;
    if(bound) requireThat(new RegExp(`^${policy.secretId}:[0-9]+$`,'u').test(bound),'Bound credential does not match policy');
    if(bound && credentialUsable(current,policy)){
      await run('gcloud',['secrets','versions','describe',bound.split(':')[1],'--secret',policy.secretId,'--project',target.google.projectId,'--format=json'],{live:true,sensitive:true});
      continue;
    }
    await run('gcloud',['secrets','describe',policy.secretId,'--project',target.google.projectId,'--format=json'],{live:true,sensitive:true});
    const previous=approved && current && Date.parse(current.expire)>Date.now() ? {...approved,status:'retiring',retireAfter:current.expire} : null;
    if(approved && current && !previous){await cli(['project','delete-key','--project-id',target.appwrite.projectId,'--key-id',approved.id]);keys=keys.filter((key)=>key.$id!==approved.id);}
    const expire=new Date(Date.now()+policy.expiryHours*3600000).toISOString();let key;let stored=false;let secretVersion=null;
    try {
      key=await cli(['project','create-key','--project-id',target.appwrite.projectId,'--name',`launch-${environment}-${policy.service}-${Date.now()}`,'--scopes',...policy.scopes,'--expire',expire]);
      requireThat(key.$id && key.secret,'Runtime key creation returned no credential');
      atomicJson(resolve(directory,`runtime-key-${policy.service}.json`),{id:key.$id,projectId:target.appwrite.projectId,expire,state:'CREATED_NOT_BOUND',previousKeyId:previous?.id ?? null});
      const version=JSON.parse(await run('gcloud',['secrets','versions','add',policy.secretId,'--project',target.google.projectId,'--data-file=-','--format=json'],{live:true,sensitive:true,input:key.secret}));
      const number=version.name?.split('/').at(-1);requireThat(/^[0-9]+$/u.test(number),'No immutable secret version returned');secretVersion=number;
      const active={id:key.$id,name:key.name,scopes:[...policy.scopes].sort(),expire,service:policy.service,secretRef:`${policy.secretId}:${number}`,status:'active'};
      target.appwrite.approvedRuntimeKeys=target.appwrite.approvedRuntimeKeys.filter((item)=>item.id!==approved?.id);
      if(previous)target.appwrite.approvedRuntimeKeys.push(previous);
      target.appwrite.approvedRuntimeKeys.push(active);
      binding.secretRefs.APPWRITE_API_KEY=active.secretRef;
      atomicJson(configurationPath,config);stored=true;metadataChanged=true;
      const result={...active,rotatedFrom:previous?.id ?? null};created.push(result);
      if(previous)rotations.push({service:policy.service,oldKeyId:previous.id,newKeyId:active.id,oldExpire:previous.expire,newExpire:active.expire});
      atomicJson(resolve(directory,`runtime-key-${policy.service}.json`),{...result,state:previous?'ROTATED_BOUND_OLD_KEY_RETAINED':'BOUND'});
      keys.push({...key,secret:undefined});
    } finally {
      if(key?.$id && !stored){await cli(['project','delete-key','--project-id',target.appwrite.projectId,'--key-id',key.$id]);if(secretVersion)await run('gcloud',['secrets','versions','disable',secretVersion,'--secret',policy.secretId,'--project',target.google.projectId,'--quiet'],{live:true,sensitive:true}).catch(()=>{});}
      if(key)key.secret=undefined;
    }
  }
  if(metadataChanged)atomicJson(configurationPath,config);
  requireThat(readJson(configurationPath).environments[environment].appwrite.approvedRuntimeKeys.length>=created.length,'Credential metadata was not saved');
  if(rotations.length)atomicJson(resolve(directory,'credential-rotation.json'),{environment,rotations,oldKeysRetainedForRollback:true,cleanup:'Remove retiring keys after the approved rollback window or expiry'});
  return {created,rotations,configurationChanged:metadataChanged,requiresFreshAcceptance:metadataChanged,oldKeysRetainedForRollback:rotations.length>0};
}
