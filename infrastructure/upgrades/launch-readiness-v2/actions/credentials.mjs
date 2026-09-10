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
export async function provisionCredentials(config,environment,directory,configurationPath) {
  const target=config.environments[environment];const policies=target.appwrite.runtimeCredentialPolicies;
  validateCredentialPolicy(policies,target.google.services);await googleIdentity(target.google);
  const {cli}=await appwriteContext(target.appwrite,directory);const created=[];
  for(const policy of policies) {
    const bound = target.google.runtimeBindings[policy.service].secretRefs.APPWRITE_API_KEY;
    if (bound) {
      requireThat(new RegExp(`^${policy.secretId}:[0-9]+$`, 'u').test(bound), 'Bound credential does not match policy');
      const keys = await cli(['project','list-keys','--project-id',target.appwrite.projectId,'--limit','100']);
      requireThat(keys.total === keys.keys.length, 'Key inventory truncated');
      const approved = target.appwrite.approvedRuntimeKeys.find((k) => k.service === policy.service && k.secretRef === bound);
      const key = keys.keys.find((k) => k.$id === approved?.id);
      requireThat(key && Date.parse(key.expire) > Date.now() && canonical([...key.scopes].sort()) === canonical([...policy.scopes].sort()), 'Bound runtime credential expired or differs; review rotation');
      await run('gcloud',['secrets','versions','describe',bound.split(':')[1],'--secret',policy.secretId,'--project',target.google.projectId,'--format=json'],{live:true,sensitive:true});
      continue;
    }
    // Secrets must already be managed by Terraform. No broad IAM grants are added here.
    await run('gcloud',['secrets','describe',policy.secretId,'--project',target.google.projectId,'--format=json'],{live:true,sensitive:true});
    const expire=new Date(Date.now()+policy.expiryHours*3600000).toISOString();let key;let stored=false;
    try {
      key=await cli(['project','create-key','--project-id',target.appwrite.projectId,'--name',`launch-${environment}-${policy.service}`,'--scopes',...policy.scopes,'--expire',expire]);
      requireThat(key.$id && key.secret,'Runtime key creation returned no credential');
      atomicJson(resolve(directory,`runtime-key-${policy.service}.json`),{id:key.$id,projectId:target.appwrite.projectId,expire,state:'CREATED_NOT_BOUND'});
      const version=JSON.parse(await run('gcloud',['secrets','versions','add',policy.secretId,'--project',target.google.projectId,'--data-file=-','--format=json'],{live:true,sensitive:true,input:key.secret}));
      const number=version.name?.split('/').at(-1);requireThat(/^[0-9]+$/u.test(number),'No immutable secret version returned');
      target.appwrite.approvedRuntimeKeys.push({id:key.$id,name:key.name,scopes:[...policy.scopes].sort(),expire,service:policy.service,secretRef:`${policy.secretId}:${number}`});
      target.google.runtimeBindings[policy.service].secretRefs.APPWRITE_API_KEY=`${policy.secretId}:${number}`;
      atomicJson(configurationPath,config);stored=true;
      const result={id:key.$id,service:policy.service,secretRef:`${policy.secretId}:${number}`,expire};created.push(result);
      atomicJson(resolve(directory,`runtime-key-${policy.service}.json`),{...result,state:'BOUND'});
    } finally {
      if(key?.$id && !stored)await cli(['project','delete-key','--project-id',target.appwrite.projectId,'--key-id',key.$id]);
      if(key)key.secret=undefined;
    }
  }
  // Confirm that the committed identifiers, not secret values, were persisted.
  requireThat(readJson(configurationPath).environments[environment].appwrite.approvedRuntimeKeys.length>=created.length,'Credential metadata was not saved');
  return {created,configurationChanged:created.length>0,requiresFreshAcceptance:true};
}
