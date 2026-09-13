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
  return Boolean(key && Array.isArray(key.scopes) && Number.isFinite(Date.parse(key.expire)) && Date.parse(key.expire)>now+minimumRemaining && canonical([...key.scopes].sort())===canonical([...policy.scopes].sort()));
}

export function runtimeCredentialBootstrap(service,env=process.env) {
  const suffix=String(service).toUpperCase().replace(/[^A-Z0-9]/gu,'_');
  const keyIdName=`APPWRITE_RUNTIME_KEY_ID_${suffix}`;
  const versionName=`APPWRITE_RUNTIME_SECRET_VERSION_${suffix}`;
  const keyId=env[keyIdName]?.trim();
  const secretVersion=env[versionName]?.trim();
  requireThat(Boolean(keyId),`Create the reviewed Appwrite runtime key in the Console and export ${keyIdName}; no credential mutation performed`);
  requireThat(/^[0-9]+$/u.test(secretVersion ?? ''),`Add its secret directly to Google Secret Manager and export ${versionName}; no credential mutation performed`);
  return {keyId,secretVersion,keyIdName,versionName};
}

export function credentialMatchesPolicy(key,policy,environment,now=Date.now()) {
  if(!credentialUsable(key,policy,now)) return false;
  if(!String(key.name ?? '').startsWith(`launch-${environment}-${policy.service}-`)) return false;
  return Date.parse(key.expire)<=now+(policy.expiryHours*3600000)+(5*60000);
}

export async function provisionCredentials(config,environment,directory,configurationPath) {
  const target=config.environments[environment];const policies=target.appwrite.runtimeCredentialPolicies;
  validateCredentialPolicy(policies,target.google.services);await googleIdentity(target.google);
  const {cli}=await appwriteContext(target.appwrite,directory);const adopted=[];const rotations=[];
  const listKeys=async()=>{const result=await cli(['project','list-keys','--project-id',target.appwrite.projectId,'--limit','100']);requireThat(Array.isArray(result.keys) && result.total===result.keys.length,'Key inventory truncated');return result.keys;};
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
      const existingVersion=JSON.parse(await run('gcloud',['secrets','versions','describe',bound.split(':')[1],'--secret',policy.secretId,'--project',target.google.projectId,'--format=json'],{live:true,sensitive:true}));
      requireThat(existingVersion.state==='ENABLED','Bound Secret Manager version is not enabled');
      continue;
    }

    await run('gcloud',['secrets','describe',policy.secretId,'--project',target.google.projectId,'--format=json'],{live:true,sensitive:true});
    const bootstrap=runtimeCredentialBootstrap(policy.service);
    const key=keys.find((item)=>item.$id===bootstrap.keyId);
    requireThat(credentialMatchesPolicy(key,policy,environment),'Operator-created runtime key does not match reviewed service, scopes or lifetime; no credential mutation performed');
    const version=JSON.parse(await run('gcloud',['secrets','versions','describe',bootstrap.secretVersion,'--secret',policy.secretId,'--project',target.google.projectId,'--format=json'],{live:true,sensitive:true}));
    requireThat(version.state==='ENABLED','Operator-provided Secret Manager version is not enabled; no credential mutation performed');

    const previous=approved && current && Date.parse(current.expire)>Date.now() ? {...approved,status:'retiring',retireAfter:current.expire} : null;
    const active={id:key.$id,name:key.name,scopes:[...policy.scopes].sort(),expire:key.expire,service:policy.service,secretRef:`${policy.secretId}:${bootstrap.secretVersion}`,status:'active'};
    target.appwrite.approvedRuntimeKeys=target.appwrite.approvedRuntimeKeys.filter((item)=>item.id!==approved?.id);
    if(previous)target.appwrite.approvedRuntimeKeys.push(previous);
    target.appwrite.approvedRuntimeKeys.push(active);
    binding.secretRefs.APPWRITE_API_KEY=active.secretRef;
    atomicJson(configurationPath,config);metadataChanged=true;
    const result={...active,rotatedFrom:previous?.id ?? null,source:'operator-created'};
    adopted.push(result);
    if(previous)rotations.push({service:policy.service,oldKeyId:previous.id,newKeyId:active.id,oldExpire:previous.expire,newExpire:active.expire});
    atomicJson(resolve(directory,`runtime-key-${policy.service}.json`),{...result,state:previous?'ROTATED_BOUND_OLD_KEY_RETAINED':'BOUND'});

    if(approved && current && !previous){
      await cli(['project','delete-key','--project-id',target.appwrite.projectId,'--key-id',approved.id]);
      keys=keys.filter((item)=>item.$id!==approved.id);
    }
    keys.push(key);
  }
  if(metadataChanged)atomicJson(configurationPath,config);
  requireThat(readJson(configurationPath).environments[environment].appwrite.approvedRuntimeKeys.length>=adopted.length,'Credential metadata was not saved');
  if(rotations.length)atomicJson(resolve(directory,'credential-rotation.json'),{environment,rotations,oldKeysRetainedForRollback:true,cleanup:'Remove retiring keys after the approved rollback window or expiry'});
  return {created:adopted,adopted,rotations,configurationChanged:metadataChanged,requiresFreshAcceptance:metadataChanged,oldKeysRetainedForRollback:rotations.length>0};
}
