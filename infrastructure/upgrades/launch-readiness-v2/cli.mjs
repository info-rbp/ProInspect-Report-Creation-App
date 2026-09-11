#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { root,packageRoot,manifest,readJson,atomicJson,stateRoot,verifyIntegrity,assertRepository,assertClean,candidate,parseArgs,requireThat,acquireLock,unlock,redact,validateConfig } from './runtime.mjs';
import { validateManifest,writeScorecard } from './evidence.mjs';
import { toolchain,auditProviders } from './providers.mjs';
import { verifyAll,adapterCoverage } from './verification.mjs';
import { install,actionPlan } from './installation.mjs';
import { complete } from './completion.mjs';
import { checkStage,checkpointSummary,issueSummary,openIssues,preflight,reconcile,safeRepair,writeOperatorReport } from './operator.mjs';

const commands=['init','audit','plan','doctor','local','complete','install','deploy','verify','status','gate','unlock','preflight','check','issues','reconcile','repair'];

export async function main(argv=process.argv.slice(2)){
  const args=parseArgs(argv);requireThat(commands.includes(args.command),'Unknown command');
  verifyIntegrity();validateManifest();
  const directory=stateRoot(root);const configPath=resolve(directory,'config.json');let config=null;let context=null;let release;
  const report=async(result,error=null)=>{
    try{await writeOperatorReport(directory,args.env,context,{command:args.command,result:result?.status ?? result?.decision ?? null,error:error?.message ?? null});}catch{/* Operator reporting must never hide the primary command result. */}
  };
  try{
    if(args.command==='audit'){
      const result={status:'PACKAGE_INTEGRITY_PASS',gates:manifest.gates.length,assertions:manifest.gates.reduce((n,g)=>n+g.checks.length,0)};await report(result);return result;
    }
    if(args.command==='plan'){
      const result={status:'PLAN_ONLY',mutations:false,actions:actionPlan(args),gates:manifest.gates.map(({id,title,checks,dependsOn})=>({id,title,requiredAssertions:checks.length,dependsOn})),message:'Install applies dependency-checked infrastructure actions; preflight collects all safe diagnostics first. Neither grants launch acceptance.'};await report(result);return result;
    }
    if(args.command==='init'){
      requireThat(!existsSync(configPath),'Configuration already exists; no overwrite performed');
      atomicJson(configPath,readJson(resolve(packageRoot,'config.example.json')));const result={status:'CONFIGURATION_CREATED',path:configPath,next:'Complete the private config and tracked policy, then run npm run launch:preflight -- --all'};await report(result);return result;
    }
    if(args.command==='unlock'){unlock(directory,args.confirm);const result={status:'UNLOCKED'};await report(result);return result;}
    requireThat(existsSync(configPath),'Run npm run launch:init first');
    config=readJson(configPath);

    if(args.command==='issues'){
      context=candidate(config,args.env,{allowDirty:true});
      const issues=openIssues(directory,args.env);const result={status:issues.some((item)=>item.severity==='BLOCKER')?'OPEN_BLOCKERS':'ISSUE_LEDGER',counts:issueSummary(directory,args.env),issues,checkpoints:checkpointSummary(directory,context)};await report(result);return result;
    }
    if(args.command==='preflight'){
      context=candidate(config,args.env,{allowDirty:true});release=acquireLock(directory);const result=await preflight(config,context,directory,{all:args.all===true});await report(result);if(result.blocked)process.exitCode=2;return result;
    }
    if(args.command==='check'){
      requireThat(args.stage && args.stage!=='all','launch:check requires one explicit --stage');context=candidate(config,args.env,{allowDirty:true});release=acquireLock(directory);const result=await checkStage(config,context,directory,args.stage,{live:args.live===true});await report(result);if(result.blocked)process.exitCode=2;return result;
    }
    if(args.command==='reconcile'){
      context=candidate(config,args.env,{allowDirty:true});release=acquireLock(directory);const result=reconcile(config,context,directory,args.stage ?? 'all');await report(result);if(result.blocked)process.exitCode=2;return result;
    }
    if(args.command==='repair'){
      requireThat(args.safe===true,'Safe repair requires --safe; there is no unrestricted automatic repair mode');context=candidate(config,args.env,{allowDirty:true});release=acquireLock(directory);const result=await safeRepair(config,args.env,directory);await report(result);return result;
    }

    validateConfig(config,args.env,{complete:false});
    if(['install','deploy'].includes(args.command) && !args.apply){const result={status:'PLAN_ONLY',actions:actionPlan(args),confirmation:`${args.command==='deploy'?'DEPLOY':'INSTALL'}:${args.env}:${config.environments[args.env].appwrite.projectId}`,mutations:false};await report(result);return result;}
    if(args.command==='doctor' && !args.live){const tools=await toolchain();const result={status:'LOCAL_DOCTOR_PASS',liveProvidersVerified:false,configPath,tools,acceptanceAdapters:adapterCoverage(config,args.env)};await report(result);return result;}
    assertRepository();assertClean();context=candidate(config,args.env);
    release=acquireLock(directory);
    if(args.command==='doctor'){const tools=await toolchain(true);const providers=await auditProviders(config,args.env,resolve(directory,args.env,'doctor'));const result={status:'LIVE_DOCTOR_PASS',tools,providers,acceptanceAdapters:adapterCoverage(config,args.env)};await report(result);return result;}
    if(args.command==='complete'){const result=await complete(config,context,directory,args);await report(result);return result;}
    if(['install','deploy'].includes(args.command)){const result=await install(config,args,directory);context=candidate(readJson(configPath),args.env);await report(result);return result;}
    if(args.command==='local'){
      await verifyAll(config,context,directory,{...args,stage:'source'});
      await verifyAll(config,context,directory,{...args,stage:'build'});
    }
    if(args.command==='verify')await verifyAll(config,context,directory,args);
    const developmentContext=args.env==='staging'?candidate(config,'development'):context;
    const scorecard=writeScorecard(directory,context,developmentContext);
    if(args.command==='gate')requireThat(scorecard.decision==='READY_FOR_RELEASE_REVIEW','NOT_LAUNCH_READY: see the generated scorecard for missing, failed or stale evidence');
    const result={...scorecard,operator:{counts:issueSummary(directory,args.env),checkpoints:checkpointSummary(directory,context)}};await report(result);return result;
  }catch(error){await report(null,error);throw error;}
  finally{if(release)release();}
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{console.log(JSON.stringify(await main(),null,2));}catch(error){console.error(`LAUNCH BLOCKED: ${redact(error.message)}`);process.exitCode=process.exitCode||1;}
}
