import { existsSync,mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { root,manifest,run,readJson,atomicJson,hash,safePath,requireThat,assertRepository,assertClean,verifyIntegrity,git,redact } from './runtime.mjs';
import { dependenciesFor,saveReceipt,loadReceipt,receiptValid,validateResult,recordArtifacts } from './evidence.mjs';
import { approvedConfig,targetEnv } from './configuration.mjs';
import { validateSource } from './actions/source.mjs';
import { edgeAcceptance } from './providers.mjs';

const scenarioAdapter='infrastructure/upgrades/launch-readiness-v2/adapters/scenario-cli.mjs';
function allowedAdapterPath(path) {
  return typeof path==='string' && (path.startsWith('infrastructure/launch-adapters/') || path.startsWith('infrastructure/upgrades/launch-readiness-v2/adapters/')) && path.endsWith('.mjs');
}
function allowedScenarioPath(path) {
  return typeof path==='string' && (path.startsWith('infrastructure/launch-scenarios/') || path.startsWith('infrastructure/upgrades/launch-readiness-v2/scenarios/')) && path.endsWith('.mjs');
}
export function adapterPath(config,id) {
  const configured=config.adapters?.[id];
  if(configured) return configured;
  const fallback=`infrastructure/launch-adapters/${id}.mjs`;
  if(existsSync(resolve(root,fallback))) return fallback;
  if(config.scenarioFiles?.[id]) return scenarioAdapter;
  return null;
}
export function resolveAdapter(config,id) {
  const path=adapterPath(config,id);
  requireThat(path,'BLOCKED_ENGINEERING: implement and register a reviewed acceptance adapter or scenario');
  requireThat(allowedAdapterPath(path),'Unapproved adapter path');
  return {path,file:safePath(root,path)};
}
export function adapterCoverage(config,environment) {
  const gates=manifest.gates.filter((g)=>g.kind==='adapter' && (g.id!=='rehearsal' || environment==='staging'));
  const implemented=[];const missing=[];const invalid=[];
  for(const gate of gates) {
    try {
      const path=adapterPath(config,gate.id);
      requireThat(path,'missing');
      requireThat(allowedAdapterPath(path),'invalid adapter path');
      safePath(root,path);
      const scenario=config.scenarioFiles?.[gate.id];
      if(path===scenarioAdapter) {
        requireThat(allowedScenarioPath(scenario),'invalid scenario path');
        safePath(root,scenario);
      }
      implemented.push({gate:gate.id,adapter:path,scenario:scenario ?? null});
    } catch(error) {
      if(error.message==='missing') missing.push(gate.id);
      else invalid.push({gate:gate.id,detail:redact(error.message)});
    }
  }
  return {complete:missing.length===0 && invalid.length===0,implemented,missing,invalid};
}
export async function verifyGate(gate,config,context,directory,args){
  if(args.resume && receiptValid(loadReceipt(directory,context.environment,gate.id),gate,context,directory))return;
  const runId=randomUUID();const folder=resolve(directory,context.environment,'runs',runId);mkdirSync(folder,{recursive:true,mode:0o700});
  saveReceipt(directory,context,gate,{status:'RUNNING',runId});
  try{
    const dependencies=dependenciesFor(gate,context,directory);let result;
    if(gate.mode!=='local'){
      const target=approvedConfig(config,context.environment);
      requireThat(args.live && args.apply && args.confirm===`ACCEPT:${context.environment}:${target.appwrite.projectId}`,'Live tests need exact ACCEPT confirmation');
    }
    if(gate.kind==='builtin'){
      let observations;
      if(gate.id==='source'){assertRepository();verifyIntegrity();observations={commit:context.commit,schemaHash:context.schemaHash,integrity:true};}
      else if(gate.id==='build')observations=await validateSource(context,folder);
      else if(gate.id==='edge')observations=await edgeAcceptance(config.environments[context.environment].web,context.commit);
      else throw new Error('Unknown built-in gate');
      atomicJson(resolve(folder,'observations.json'),observations);
      result={schemaVersion:1,runId,candidate:context,mode:gate.mode,mocked:false,failed:0,skipped:0,checks:gate.checks.map((id)=>({id,status:'PASS',observed:true,expected:true})),artifacts:['observations.json']};
      if(gate.id==='build')result.artifacts.push(...Array.from({length:7},(_,i)=>`source-${i}.log`));
      atomicJson(resolve(folder,'result.json'),result);
    }else{
      const {path,file}=resolveAdapter(config,gate.id);
      await run('git',['ls-files','--error-unmatch','--',path],{cwd:root});
      const scenarioFile=config.scenarioFiles?.[gate.id] ?? null;
      if(scenarioFile){
        requireThat(allowedScenarioPath(scenarioFile),'Unapproved scenario path');
        safePath(root,scenarioFile);
        await run('git',['ls-files','--error-unmatch','--',scenarioFile],{cwd:root});
      }
      atomicJson(resolve(folder,'input.json'),{schemaVersion:1,runId,candidate:context,gate,target:config.environments[context.environment],policyDocument:config.policyDocument,scenarioFile,productionMutationAllowed:false});
      await run(process.execPath,[file],{cwd:root,live:true,sensitive:true,timeoutMs:3600000,logFile:resolve(folder,'adapter.log'),env:{...targetEnv(config.environments[context.environment]),PROINSPECT_LAUNCH_INPUT:resolve(folder,'input.json'),PROINSPECT_LAUNCH_OUTPUT:resolve(folder,'result.json')}});
      requireThat(existsSync(resolve(folder,'result.json')),'Adapter exited without evidence');result=readJson(resolve(folder,'result.json'));
    }
    validateResult(result,gate,context,runId);assertClean();requireThat(git(['rev-parse','HEAD'])===context.commit,'Source changed during acceptance');
    saveReceipt(directory,context,gate,{status:'PASS',runId,dependencies,artifacts:recordArtifacts(folder,[...result.artifacts,'result.json'])});
  }catch(error){saveReceipt(directory,context,gate,{status:'FAIL',runId,detail:redact(error.message)});throw error;}
}
export async function verifyAll(config,context,directory,args){
  const gates=args.stage && args.stage!=='all'?manifest.gates.filter((g)=>g.id===args.stage):manifest.gates.filter((g)=>g.id!=='rehearsal' || context.environment==='staging');
  requireThat(gates.length,'Unknown verification stage');
  if(!args.stage || args.stage==='all'){
    const coverage=adapterCoverage(config,context.environment);
    requireThat(coverage.complete,`BLOCKED_ENGINEERING: acceptance implementation missing or invalid for ${[...coverage.missing,...coverage.invalid.map((x)=>x.gate)].join(', ')}`);
  }
  for(const gate of gates){await verifyGate(gate,config,context,directory,args);console.log(`PASS ${gate.id}`);}
  return {verified:gates.map((g)=>g.id),candidateHash:hash(context)};
}
