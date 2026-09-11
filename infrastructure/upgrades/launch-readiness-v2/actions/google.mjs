import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { atomicJson, readJson, run, root, requireThat, safePath } from '../runtime.mjs';
import { assertTargetAuthority } from './runtime-authority.mjs';

export async function googleIdentity(target, execute = run) {
  const value = JSON.parse(await execute('gcloud',['projects','describe',target.projectId,'--format=json'],{live:true,sensitive:true}));
  requireThat(value.projectId === target.projectId && value.lifecycleState === 'ACTIVE' && value.labels?.environment === target.environment,'Google project identity/environment mismatch');
  return value.projectId;
}
export function buildConfiguration(target,commit) {
  requireThat(/^[a-f0-9]{40}$/u.test(commit),'Invalid source commit');
  requireThat(/^[a-z][a-z0-9-]+$/u.test(target.imageRepository),'Invalid image repository');
  const steps=[]; const images=[];
  for (const service of target.services) {
    requireThat(/^[a-z][a-z0-9-]+$/u.test(service),'Invalid service name');
    const image=`${target.region}-docker.pkg.dev/${target.projectId}/${target.imageRepository}/${service}:${commit}`;
    images.push(image);
    steps.push({name:'gcr.io/cloud-builders/docker',args:['build','-f',`apps/${service}/Dockerfile`,'--label',`org.opencontainers.image.revision=${commit}`,'-t',image,'.']});
    steps.push({name:'gcr.io/cloud-builders/docker',args:['push',image]});
  }
  return {steps,images,serviceAccount:`projects/${target.projectId}/serviceAccounts/cloud-build@${target.projectId}.iam.gserviceaccount.com`,options:{logging:'CLOUD_LOGGING_ONLY'}};
}
export function runtimeArguments(target,service,commit) {
  const configured=target.google.runtimeBindings[service];
  requireThat(configured && configured.env && configured.secretRefs,'Review env and secretRefs for every service before deployment');
  const vars={...configured.env,APP_ENV:target.google.environment,NODE_ENV:target.google.environment==='production'?'production':'development',GOOGLE_CLOUD_PROJECT:target.google.projectId,APP_VERSION:commit,APPWRITE_ENDPOINT:target.appwrite.endpoint,APPWRITE_PROJECT_ID:target.appwrite.projectId,APPWRITE_DATABASE_ID:target.appwrite.databaseId};
  for(const [key,value] of Object.entries(vars)) requireThat(/^[A-Z][A-Z0-9_]*$/u.test(key) && !/SECRET|TOKEN|PASSWORD|API_KEY/u.test(key) && typeof value === 'string' && !/[|\n\r]/u.test(value),'Unsafe runtime variable; use a Secret Manager reference');
  const secrets=Object.entries(configured.secretRefs).map(([key,value])=>{requireThat(/^[A-Z][A-Z0-9_]*$/u.test(key) && /^[A-Za-z0-9_-]+:[0-9]+$/u.test(value),'Use numeric, immutable Secret Manager versions');return `${key}=${value}`;});
  requireThat(configured.env.AUTH_PROVIDER === 'appwrite' && configured.env.APPWRITE_BACKEND_MODE === 'appwrite','Explicit Appwrite runtime configuration required');
  requireThat(secrets.some((value)=>value.startsWith('APPWRITE_API_KEY=')),'Every deployed service requires an immutable Appwrite runtime credential');
  return ['--update-env-vars',`^|^${Object.entries(vars).map(([k,v])=>`${k}=${v}`).join('|')}`,'--update-secrets',secrets.join(',')];
}
function trafficRoutes(traffic){const routes=(traffic??[]).filter((v)=>v.percent>0).map((v)=>{requireThat(v.revisionName,'Recorded traffic entry has no immutable revision');return `${v.revisionName}=${v.percent}`;});requireThat(routes.length,'No recorded prior traffic');return routes.join(',');}
async function restoreTraffic(target,items){const errors=[];for(const item of [...items].reverse()){try{await run('gcloud',['run','services','update-traffic',item.name,'--project',target.google.projectId,'--region',target.google.region,'--to-revisions',trafficRoutes(item.traffic),'--quiet'],{live:true,sensitive:true});}catch(error){errors.push(`${item.name}:${error.message}`);}}requireThat(errors.length===0,`ROLLBACK_INCOMPLETE:${errors.join(';')}`);}
export async function deployGoogle(target,context,directory) {
  await googleIdentity(target.google);const cloud=buildConfiguration(target.google,context.commit);
  for(const name of target.google.services){safePath(root,`apps/${name}/Dockerfile`);runtimeArguments(target,name,context.commit);}
  const prior=[];
  for(const name of target.google.services){const state=JSON.parse(await run('gcloud',['run','services','describe',name,'--project',target.google.projectId,'--region',target.google.region,'--format=json'],{live:true,sensitive:true}));requireThat(state.metadata?.name===name&&state.status?.latestReadyRevisionName,'Provision all services with Terraform before deployment');prior.push({name,traffic:state.status.traffic,previousRevision:state.status.latestReadyRevisionName,phase:'RECORDED'});}
  atomicJson(resolve(directory,'google-deployment.json'),{candidate:context,projectId:target.google.projectId,services:prior,status:'PREPARED'});
  const workspace=mkdtempSync(join(tmpdir(),'proinspect-build-'));
  try{
    const archive=resolve(workspace,'source.tar');const source=resolve(workspace,'source');await run('git',['archive','--format=tar','--output',archive,context.commit],{cwd:root});await run('mkdir',['-p',source]);await run('tar',['-xf',archive,'-C',source]);const authority=assertTargetAuthority(source);atomicJson(resolve(directory,'runtime-authority.json'),authority);atomicJson(resolve(workspace,'cloudbuild.json'),cloud);
    await run('gcloud',['builds','submit',source,'--project',target.google.projectId,'--region',target.google.region,'--config',resolve(workspace,'cloudbuild.json'),'--quiet'],{live:true,timeoutMs:3600000,logFile:resolve(directory,'cloud-build.log')});
    for(let i=0;i<prior.length;i++){
      await googleIdentity(target.google);const item=prior[i];const image=JSON.parse(await run('gcloud',['artifacts','docker','images','describe',cloud.images[i],'--project',target.google.projectId,'--format=json'],{live:true,sensitive:true}));const digest=image.image_summary?.digest;requireThat(/^sha256:[a-f0-9]{64}$/u.test(digest),'No immutable image digest returned');item.image=`${cloud.images[i].split(':')[0]}@${digest}`;
      await run('gcloud',['run','services','update',item.name,'--project',target.google.projectId,'--region',target.google.region,'--image',item.image,...runtimeArguments(target,item.name,context.commit),'--no-traffic','--quiet'],{live:true,sensitive:true});
      const state=JSON.parse(await run('gcloud',['run','services','describe',item.name,'--project',target.google.projectId,'--region',target.google.region,'--format=json'],{live:true,sensitive:true}));item.deployedRevision=state.status?.latestReadyRevisionName;requireThat(item.deployedRevision&&state.status.latestCreatedRevisionName===item.deployedRevision,'New revision is not Ready');item.phase='READY_NO_TRAFFIC';
      atomicJson(resolve(directory,'google-deployment.json'),{candidate:context,projectId:target.google.projectId,services:prior,status:'REVISIONS_READY'});
    }
    const switched=[];
    try{
      for(const item of prior){await run('gcloud',['run','services','update-traffic',item.name,'--project',target.google.projectId,'--region',target.google.region,'--to-revisions',`${item.deployedRevision}=100`,'--quiet'],{live:true,sensitive:true});const live=JSON.parse(await run('gcloud',['run','services','describe',item.name,'--project',target.google.projectId,'--region',target.google.region,'--format=json'],{live:true,sensitive:true}));requireThat(live.status?.traffic?.some((v)=>v.revisionName===item.deployedRevision&&v.percent===100),'Traffic did not converge to the candidate revision');item.phase='TRAFFIC_100';switched.push(item);atomicJson(resolve(directory,'google-deployment.json'),{candidate:context,projectId:target.google.projectId,services:prior,status:'SWITCHING_TRAFFIC'});}
    }catch(error){try{await restoreTraffic(target,switched);}catch(rollbackError){atomicJson(resolve(directory,'google-deployment.json'),{candidate:context,projectId:target.google.projectId,services:prior,status:'ROLLBACK_INCOMPLETE',error:error.message,rollbackError:rollbackError.message});throw new Error(`Google rollout failed and rollback was incomplete: ${rollbackError.message}`);}atomicJson(resolve(directory,'google-deployment.json'),{candidate:context,projectId:target.google.projectId,services:prior,status:'ROLLED_BACK_AFTER_FAILURE',error:error.message});throw error;}
    const result={candidate:context,projectId:target.google.projectId,services:prior,status:'DEPLOYED_NOT_ACCEPTED',twoPhase:true};atomicJson(resolve(directory,'google-deployment.json'),result);return result;
  }finally{rmSync(workspace,{recursive:true,force:true});}
}
export async function rollbackGoogle(target,path){await googleIdentity(target.google);const record=readJson(path);requireThat(record.projectId===target.google.projectId,'Rollback project mismatch');const changed=[];for(const item of record.services){if(!item.deployedRevision)continue;const live=JSON.parse(await run('gcloud',['run','services','describe',item.name,'--project',target.google.projectId,'--region',target.google.region,'--format=json'],{live:true,sensitive:true}));requireThat(live.status?.traffic?.some((v)=>v.revisionName===item.deployedRevision&&v.percent===100),'Service traffic changed since deployment; rollback blocked');changed.push(item);}await restoreTraffic(target,changed);return {trafficRestored:true,databaseRestored:false,services:changed.map((item)=>item.name)};}
