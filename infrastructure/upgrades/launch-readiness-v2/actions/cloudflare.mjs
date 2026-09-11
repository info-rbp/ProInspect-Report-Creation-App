import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { atomicJson, readJson, root, run, requireThat, packageRoot } from '../runtime.mjs';
import { googleIdentity } from './google.mjs';

export async function cfRequest(target,path,options={}) {
  requireThat(process.env.CLOUDFLARE_API_TOKEN && /^[a-f0-9]{32}$/iu.test(target.accountId),'Cloudflare credentials/identity are missing');
  const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${target.accountId}${path}`,{...options,redirect:'error',signal:globalThis.AbortSignal.timeout(30000),headers:{authorization:`Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,'content-type':'application/json',...(options.headers ?? {})}});
  requireThat(response.ok,`Cloudflare HTTP ${response.status}; body suppressed`);
  const value=await response.json(); requireThat(value.success===true,'Cloudflare rejected request'); return value.result;
}
export function wranglerVersionId(value) { return value?.id ?? value?.version_id ?? value?.versionId ?? null; }
export function wranglerVersionTag(value) { return value?.tag ?? value?.metadata?.tag ?? value?.annotations?.['workers/tag'] ?? value?.annotations?.tag ?? null; }
export function findWranglerVersion(payload,tag) {
  const values=Array.isArray(payload)?payload:(payload?.versions ?? payload?.items ?? payload?.result ?? []);
  requireThat(Array.isArray(values),'Unexpected Wrangler versions JSON');
  const found=values.find((item)=>wranglerVersionTag(item)===tag); const id=wranglerVersionId(found);
  requireThat(id && /^[A-Za-z0-9-]{8,}$/u.test(id),'Uploaded Cloudflare version could not be resolved by tag');
  return {id,tag,raw:found};
}
export function singlePreviousVersion(deployment) {
  const active=(deployment?.versions ?? []).filter((item)=>Number(item.percentage)>0);
  requireThat(active.length===1 && wranglerVersionId(active[0]),'Settle the current Cloudflare deployment to one active version before release');
  return wranglerVersionId(active[0]);
}
export function deploymentBody(deployment) {
  const versions=(deployment?.versions ?? []).filter((item)=>Number(item.percentage)>0).map((item)=>({version_id:wranglerVersionId(item),percentage:Number(item.percentage)}));
  requireThat(versions.length && versions.every((item)=>item.version_id && item.percentage>0),'Recorded Cloudflare deployment has no restorable traffic');
  return {strategy:'percentage',versions};
}
async function smokeCandidate(target,context,version) {
  const headers={'Cloudflare-Workers-Version-Overrides':`${target.cloudflare.workerName}="${version.id}"`};
  let lastError;
  for(let attempt=0;attempt<6;attempt+=1) {
    try {
      const revisionResponse=await fetch(`${target.web.origin}/__launch/revision`,{headers,redirect:'error',signal:globalThis.AbortSignal.timeout(30000)});
      requireThat(revisionResponse.ok,'Candidate revision endpoint failed');
      const revision=await revisionResponse.json();
      requireThat(revision.commit===context.commit && revision.versionId===version.id && revision.versionTag===version.tag,'Cloudflare version override did not reach the exact candidate');
      const health=await fetch(`${target.web.origin}${target.web.healthPath}`,{headers,redirect:'error',signal:globalThis.AbortSignal.timeout(30000)});
      requireThat(health.ok && health.headers.get('content-type')?.includes('json'),'Candidate health check failed');
      const healthBody=await health.json(); const backendCommit=target.web.revisionField.split('.').reduce((value,key)=>value?.[key],healthBody);
      requireThat(backendCommit===context.commit,'Candidate edge points at a different backend release');
      const routes=[];
      for(const portal of ['admin','inspector','building','strata','resident','client','contractor']) {
        const response=await fetch(`${target.web.origin}/${portal}`,{headers,redirect:'error',signal:globalThis.AbortSignal.timeout(30000)}); const text=await response.text();
        requireThat(response.ok && response.headers.get('content-type')?.includes('text/html') && /id=["']root["']/u.test(text),'Candidate portal shell failed');
        requireThat(response.headers.get('strict-transport-security') && response.headers.get('content-security-policy') && response.headers.get('x-content-type-options')==='nosniff','Candidate security headers failed');
        routes.push(portal);
      }
      const denied=await fetch(`${target.web.origin}${target.web.deniedPath}`,{headers,redirect:'error',signal:globalThis.AbortSignal.timeout(30000)});
      requireThat([401,403].includes(denied.status),'Candidate anonymous API denial failed'); if(denied.body)await denied.body.cancel();
      return {versionId:version.id,versionTag:version.tag,commit:context.commit,backendCommit,routes,anonymousStatus:denied.status};
    } catch(error) { lastError=error; if(attempt<5)await delay(2000); }
  }
  throw lastError;
}
async function restoreDeployment(target,previous) {
  return cfRequest(target.cloudflare,`/workers/scripts/${target.cloudflare.workerName}/deployments`,{method:'POST',body:JSON.stringify(deploymentBody(previous))});
}
export async function deployCloudflare(target,context,directory,{requireExisting=false}={}) {
  await googleIdentity(target.google);
  const api=JSON.parse(await run('gcloud',['run','services','describe','api','--project',target.google.projectId,'--region',target.google.region,'--format=json'],{live:true,sensitive:true}));
  requireThat(api.status?.url===target.cloudflare.apiOrigin,'Configured API origin differs from the actual Cloud Run API service');
  const secret=process.env[target.cloudflare.trustedEdgeSecretEnv];
  requireThat(typeof secret==='string' && secret.length>=32,'Supply the already-matched Cloud Run/Cloudflare origin secret through its environment variable');
  requireThat(target.cloudflare.contentSecurityPolicy?.includes("object-src 'none'") && target.cloudflare.contentSecurityPolicy.includes("frame-ancestors 'none'"),'Review an explicit CSP before deployment');
  const scripts=await cfRequest(target.cloudflare,'/workers/scripts'); let exists=scripts.some((item)=>item.id===target.cloudflare.workerName);
  requireThat(!requireExisting || exists,'Production release requires a pre-existing Cloudflare Worker/deployment; bootstrap it safely before the release window');
  let previous=exists ? (await cfRequest(target.cloudflare,`/workers/scripts/${target.cloudflare.workerName}/deployments`)).deployments?.[0] : null;
  const tag=`lr-${context.commit.slice(0,12)}-${context.configHash.slice(0,12)}`;
  atomicJson(resolve(directory,'cloudflare-deployment.json'),{candidate:context,workerName:target.cloudflare.workerName,accountId:target.cloudflare.accountId,previous,status:'PREPARED_VERSION_UPLOAD'});
  const wrangler=resolve(root,'node_modules/wrangler/bin/wrangler.js');
  const uploadHelp=await run('node',[wrangler,'versions','upload','--help'],{cwd:root});
  const deployHelp=await run('node',[wrangler,'versions','deploy','--help'],{cwd:root});
  requireThat(['--secrets-file','--tag','--strict'].every((option)=>uploadHelp.includes(option)) && deployHelp.includes('--version-tag'),'Pinned Wrangler does not support reviewed version upload/deployment');
  const temp=mkdtempSync(join(tmpdir(),'proinspect-edge-'));
  try {
    await run('npm',['run','cloudflare:build'],{cwd:root,env:{VITE_AUTH_PROVIDER:'appwrite',VITE_APPWRITE_ENDPOINT:target.appwrite.endpoint,VITE_APPWRITE_PROJECT_ID:target.appwrite.projectId},logFile:resolve(directory,'edge-build.log')});
    const config={name:target.cloudflare.workerName,account_id:target.cloudflare.accountId,main:resolve(packageRoot,'edge-entry.mjs'),compatibility_date:'2026-08-23',workers_dev:true,assets:{directory:resolve(root,'apps/web/dist'),binding:'ASSETS',not_found_handling:'single-page-application',run_worker_first:['/api/*','/v1/*','/health','/__launch/*']},vars:{GOOGLE_API_ORIGIN:target.cloudflare.apiOrigin,RELEASE_SHA:context.commit,CONTENT_SECURITY_POLICY:target.cloudflare.contentSecurityPolicy},version_metadata:{binding:'CF_VERSION_METADATA'},observability:{enabled:true}};
    const origin=new URL(target.web.origin); if(!origin.hostname.endsWith('.workers.dev'))config.routes=[{pattern:origin.hostname,custom_domain:true}];
    const configPath=resolve(temp,'wrangler.json'); const secretsPath=resolve(temp,'secrets.json'); atomicJson(configPath,config); atomicJson(secretsPath,{CLOUDFLARE_ORIGIN_SECRET:secret});
    if(!exists) {
      await run('node',[wrangler,'deploy','--config',configPath,'--secrets-file',secretsPath],{cwd:root,live:true,sensitive:true,logFile:resolve(directory,'edge-bootstrap.log')});
      exists=true; previous=(await cfRequest(target.cloudflare,`/workers/scripts/${target.cloudflare.workerName}/deployments`)).deployments?.[0];
      requireThat(previous?.id && previous.versions?.length,'Cloudflare bootstrap produced no deployment');
    }
    const previousVersion=singlePreviousVersion(previous);
    await run('node',[wrangler,'versions','upload','--config',configPath,'--secrets-file',secretsPath,'--tag',tag,'--message',`ProInspect ${context.environment} ${context.commit}`,'--strict'],{cwd:root,live:true,sensitive:true,logFile:resolve(directory,'edge-version-upload.log')});
    const versionPayload=JSON.parse(await run('node',[wrangler,'versions','list','--config',configPath,'--name',target.cloudflare.workerName,'--json'],{cwd:root,live:true,sensitive:true}));
    const candidate=findWranglerVersion(versionPayload,tag); requireThat(candidate.id!==previousVersion,'Candidate version did not advance');
    await run('node',[wrangler,'versions','deploy',`${candidate.id}@0%`,`${previousVersion}@100%`,'--config',configPath,'--name',target.cloudflare.workerName,'--message',`Smoke ${tag}`,'-y'],{cwd:root,live:true,sensitive:true,logFile:resolve(directory,'edge-smoke-deployment.log')});
    atomicJson(resolve(directory,'cloudflare-deployment.json'),{candidate:context,workerName:target.cloudflare.workerName,accountId:target.cloudflare.accountId,previous,candidateVersion:candidate,status:'CANDIDATE_AT_ZERO_PERCENT'});
    let smoke;
    try {
      smoke=await smokeCandidate(target,context,candidate);
      await run('node',[wrangler,'versions','deploy',`${candidate.id}@100%`,'--config',configPath,'--name',target.cloudflare.workerName,'--message',`Promote ${tag}`,'-y'],{cwd:root,live:true,sensitive:true,logFile:resolve(directory,'edge-promote.log')});
    } catch(error) {
      await restoreDeployment(target,previous).catch(()=>{}); throw error;
    }
    const deployed=await cfRequest(target.cloudflare,`/workers/scripts/${target.cloudflare.workerName}/deployments`); const current=deployed.deployments?.[0];
    requireThat(current?.id && singlePreviousVersion(current)===candidate.id,'Cloudflare candidate promotion did not become the sole active version');
    const result={candidate:context,accountId:target.cloudflare.accountId,workerName:target.cloudflare.workerName,previous,current,candidateVersion:candidate,smoke,status:'PROMOTED_NOT_ACCEPTED'};
    atomicJson(resolve(directory,'cloudflare-deployment.json'),result); return result;
  } finally {rmSync(temp,{recursive:true,force:true});}
}
export async function rollbackCloudflare(target,path) {
  const record=readJson(path); requireThat(record.accountId===target.cloudflare.accountId && record.workerName===target.cloudflare.workerName,'Cloudflare rollback target mismatch');
  requireThat(record.previous?.versions?.length,'First deployment has no previous version; no destructive deletion is attempted');
  const route=`/workers/scripts/${target.cloudflare.workerName}/deployments`; const live=await cfRequest(target.cloudflare,route);
  requireThat(live.deployments?.[0]?.id===record.current.id,'Worker changed since deployment; rollback blocked');
  const result=await restoreDeployment(target,record.previous); return {trafficRestored:true,deployment:result};
}
