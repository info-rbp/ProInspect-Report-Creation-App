import { existsSync,readFileSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { atomicJson,canonical,hash,manifest,readJson,redact,requireThat,safePath } from './runtime.mjs';
export function validateManifest(value=manifest) {
  const seen=new Set();requireThat(value.schemaVersion===1 && /^[a-f0-9]{40}$/u.test(value.baselineCommit),'Invalid manifest');
  for(const gate of value.gates){requireThat(/^[a-z][a-z0-9-]+$/u.test(gate.id) && !seen.has(gate.id),'Duplicate/invalid gate');requireThat(['builtin','adapter'].includes(gate.kind) && ['local','live','device'].includes(gate.mode),'Invalid mode');requireThat(gate.dependsOn.every((id)=>seen.has(id)),'Dependency cycle or missing dependency');requireThat(gate.checks.length && new Set(gate.checks).size===gate.checks.length,'Missing/duplicate assertions');seen.add(gate.id);}return true;
}
export const receiptPath=(directory,environment,id)=>resolve(directory,environment,'receipts',`${id}.json`);
export function loadReceipt(directory,environment,id){try{const path=receiptPath(directory,environment,id);return existsSync(path)?readJson(path):null;}catch{return null;}}
export function validateResult(result,gate,context,runId){
  requireThat(result.schemaVersion===1 && result.runId===runId && canonical(result.candidate)===canonical(context),'Foreign/stale acceptance output');
  requireThat(result.mode===gate.mode && result.mocked===false && result.failed===0 && result.skipped===0,'Failed, skipped or mocked acceptance');
  requireThat(Array.isArray(result.checks),'Missing checks');const ids=result.checks.map((c)=>c.id);
  requireThat(new Set(ids).size===ids.length && gate.checks.every((id)=>ids.includes(id)),'Missing or duplicate check');
  for(const check of result.checks)requireThat(check.status==='PASS' && Object.hasOwn(check,'expected') && Object.hasOwn(check,'observed') && canonical(check.expected)===canonical(check.observed),'Assertion failed');
  requireThat(Array.isArray(result.artifacts) && result.artifacts.length>0 && result.artifacts.length<=64 && new Set(result.artifacts).size===result.artifacts.length && !result.artifacts.some((p)=>['input.json','result.json'].includes(p)),'Missing/invalid proof artifacts');return true;
}
export function recordArtifacts(directory,paths,env=process.env){return paths.map((name)=>{const bytes=readFileSync(safePath(directory,name));requireThat(bytes.length>0 && bytes.length<=20*1024*1024,'Empty/oversized evidence');if(/\.(json|xml|log|txt|md|csv)$/u.test(name))requireThat(redact(bytes.toString(),env)===bytes.toString(),'Credential detected in evidence');return {path:name,sha256:hash(bytes)};});}
export function receiptValid(receipt,gate,context,directory,now=Date.now(),seen=new Set()){
  try{
    requireThat(receipt?.status==='PASS' && receipt.gateId===gate.id && canonical(receipt.candidate)===canonical(context),'No matching PASS');
    const age=now-Date.parse(receipt.completedAt);requireThat(Number.isFinite(age) && age>=0 && age<=manifest.evidenceMaxAgeHours*3600000,'Expired/future evidence');
    requireThat(!seen.has(gate.id) && /^[a-f0-9-]{36}$/u.test(receipt.runId),'Invalid receipt');const next=new Set([...seen,gate.id]);
    const path=resolve(directory,context.environment,'runs',receipt.runId);
    requireThat(receipt.artifacts?.some((a)=>a.path==='result.json'),'Missing result');
    for(const file of receipt.artifacts)requireThat(hash(readFileSync(safePath(path,file.path)))===file.sha256,'Changed evidence');
    const result=readJson(safePath(path,'result.json'));validateResult(result,gate,context,receipt.runId);
    requireThat(result.artifacts.every((p)=>receipt.artifacts.some((a)=>a.path===p)),'Unbound artifact');
    for(const id of gate.dependsOn){const parent=loadReceipt(directory,context.environment,id);requireThat(receipt.dependencies[id]===hash(parent) && receiptValid(parent,manifest.gates.find((g)=>g.id===id),context,directory,now,next),'Stale dependency');}return true;
  }catch{return false;}
}
export function dependenciesFor(gate,context,directory){const values={};for(const id of gate.dependsOn){const parent=loadReceipt(directory,context.environment,id);requireThat(receiptValid(parent,manifest.gates.find((g)=>g.id===id),context,directory),`Prerequisite '${id}' is not passing for this candidate`);values[id]=hash(parent);}return values;}
export function saveReceipt(directory,context,gate,value){atomicJson(receiptPath(directory,context.environment,gate.id),{...value,gateId:gate.id,candidate:context,completedAt:new Date().toISOString()});}
export function scorecard(directory,context){return manifest.gates.map((gate)=>{const r=loadReceipt(directory,context.environment,gate.id);return {id:gate.id,title:gate.title,status:receiptValid(r,gate,context,directory)?'PASS':r?.status==='PASS'?'STALE':r?.status ?? 'NOT_RUN'};});}
export function writeScorecard(directory,context){
  const gates=scorecard(directory,context);const dev=scorecard(directory,{...context,environment:'development'}).filter((g)=>g.id!=='rehearsal');
  const decision=context.environment==='staging' && gates.every((g)=>g.status==='PASS') && dev.every((g)=>g.status==='PASS')?'READY_FOR_RELEASE_REVIEW':'NOT_LAUNCH_READY';
  const result={candidate:context,decision,gates,productionDeploymentAuthorised:false};const path=resolve(directory,context.environment);atomicJson(resolve(path,'scorecard.json'),result);
  writeFileSync(resolve(path,'scorecard.md'),`# Launch-readiness evidence\n\n**${decision}**\n\nCandidate: ${context.commit}\n\n| Gate | Status |\n| --- | --- |\n${gates.map((g)=>`| ${g.title} | ${g.status} |`).join('\n')}\n\nProduction deployment is not authorised by this report.\n`,{mode:0o600});return result;
}
