import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { atomicJson, readJson, root, run, requireThat, packageRoot } from '../runtime.mjs';
import { googleIdentity } from './google.mjs';

export async function cfRequest(target,path,options={}) {
  requireThat(process.env.CLOUDFLARE_API_TOKEN && /^[a-f0-9]{32}$/iu.test(target.accountId),'Cloudflare credentials/identity are missing');
  const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${target.accountId}${path}`,{...options,redirect:'error',signal:globalThis.AbortSignal.timeout(30000),headers:{authorization:`Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,'content-type':'application/json'}});
  requireThat(response.ok,`Cloudflare HTTP ${response.status}; body suppressed`);
  const value=await response.json(); requireThat(value.success===true,'Cloudflare rejected request'); return value.result;
}
export async function deployCloudflare(target,context,directory) {
  await googleIdentity(target.google);
  const api=JSON.parse(await run('gcloud',['run','services','describe','api','--project',target.google.projectId,'--region',target.google.region,'--format=json'],{live:true,sensitive:true}));
  requireThat(api.status?.url===target.cloudflare.apiOrigin,'Configured API origin differs from the actual Cloud Run API service');
  const secret=process.env[target.cloudflare.trustedEdgeSecretEnv];
  requireThat(typeof secret==='string' && secret.length>=32,'Supply the already-matched Cloud Run/Cloudflare origin secret through its environment variable');
  requireThat(target.cloudflare.contentSecurityPolicy?.includes("object-src 'none'") && target.cloudflare.contentSecurityPolicy.includes("frame-ancestors 'none'"),'Review an explicit CSP before deployment');
  const scripts=await cfRequest(target.cloudflare,'/workers/scripts');
  const exists=scripts.some((s)=>s.id===target.cloudflare.workerName);
  const previous=exists ? await cfRequest(target.cloudflare,`/workers/scripts/${target.cloudflare.workerName}/deployments`) : {deployments:[]};
  const old=previous.deployments?.[0];
  atomicJson(resolve(directory,'cloudflare-deployment.json'),{candidate:context,workerName:target.cloudflare.workerName,accountId:target.cloudflare.accountId,previous:old ?? null,status:'PREPARED'});
  const help=await run('node',[resolve(root,'node_modules/wrangler/bin/wrangler.js'),'deploy','--help'],{cwd:root});
  requireThat(help.includes('--secrets-file'),'Pinned Wrangler does not support atomic secrets-file upload');
  const temp=mkdtempSync(join(tmpdir(),'proinspect-edge-'));
  try {
    // Build from this clean, exact candidate. No private configuration enters the public assets.
    await run('npm',['run','cloudflare:build'],{cwd:root,env:{VITE_AUTH_PROVIDER:'appwrite',VITE_APPWRITE_ENDPOINT:target.appwrite.endpoint,VITE_APPWRITE_PROJECT_ID:target.appwrite.projectId},logFile:resolve(directory,'edge-build.log')});
    const config={name:target.cloudflare.workerName,account_id:target.cloudflare.accountId,main:resolve(packageRoot,'edge-entry.mjs'),compatibility_date:'2026-08-23',workers_dev:true,assets:{directory:resolve(root,'apps/web/dist'),binding:'ASSETS',not_found_handling:'single-page-application',run_worker_first:['/api/*','/v1/*','/health','/__launch/*']},vars:{GOOGLE_API_ORIGIN:target.cloudflare.apiOrigin,RELEASE_SHA:context.commit,CONTENT_SECURITY_POLICY:target.cloudflare.contentSecurityPolicy},observability:{enabled:true}};
    const origin=new URL(target.web.origin);
    if(!origin.hostname.endsWith('.workers.dev')) config.routes=[{pattern:origin.hostname,custom_domain:true}];
    atomicJson(resolve(temp,'wrangler.json'),config); atomicJson(resolve(temp,'secrets.json'),{CLOUDFLARE_ORIGIN_SECRET:secret});
    await run('node',[resolve(root,'node_modules/wrangler/bin/wrangler.js'),'deploy','--config',resolve(temp,'wrangler.json'),'--secrets-file',resolve(temp,'secrets.json')],{cwd:root,live:true,sensitive:true,logFile:resolve(directory,'edge-deploy.log')});
    const deployed=await cfRequest(target.cloudflare,`/workers/scripts/${target.cloudflare.workerName}/deployments`);
    const current=deployed.deployments?.[0]; requireThat(current?.id,'No Cloudflare deployment receipt');
    const result={candidate:context,accountId:target.cloudflare.accountId,workerName:target.cloudflare.workerName,previous:old ?? null,current,status:'DEPLOYED_NOT_ACCEPTED'};
    atomicJson(resolve(directory,'cloudflare-deployment.json'),result); return result;
  } finally {rmSync(temp,{recursive:true,force:true});}
}
export async function rollbackCloudflare(target,path) {
  const record=readJson(path); requireThat(record.accountId===target.cloudflare.accountId && record.workerName===target.cloudflare.workerName,'Cloudflare rollback target mismatch');
  requireThat(record.previous?.versions?.length,'First deployment has no previous version; no destructive deletion is attempted');
  const route=`/workers/scripts/${target.cloudflare.workerName}/deployments`;
  const live=await cfRequest(target.cloudflare,route); requireThat(live.deployments?.[0]?.id===record.current.id,'Worker changed since deployment; rollback blocked');
  return cfRequest(target.cloudflare,route,{method:'POST',body:JSON.stringify({strategy:'percentage',versions:record.previous.versions.map(({version_id,percentage})=>({version_id,percentage}))})});
}
