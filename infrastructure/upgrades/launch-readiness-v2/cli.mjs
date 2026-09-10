#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { root,packageRoot,manifest,readJson,atomicJson,stateRoot,verifyIntegrity,assertRepository,assertClean,candidate,parseArgs,requireThat,acquireLock,unlock,redact,validateConfig } from './runtime.mjs';
import { validateManifest,writeScorecard } from './evidence.mjs';
import { toolchain,auditProviders } from './providers.mjs';
import { verifyAll } from './verification.mjs';
import { install,actionPlan } from './installation.mjs';
import { complete } from './completion.mjs';
export async function main(argv=process.argv.slice(2)){
  const args=parseArgs(argv);
  requireThat(['init','audit','plan','doctor','local','complete','install','deploy','verify','status','gate','unlock'].includes(args.command),'Unknown command');
  verifyIntegrity();validateManifest();
  if(args.command==='audit')return {status:'PACKAGE_INTEGRITY_PASS',gates:manifest.gates.length,assertions:manifest.gates.reduce((n,g)=>n+g.checks.length,0)};
  if(args.command==='plan')return {status:'PLAN_ONLY',mutations:false,actions:actionPlan(args),gates:manifest.gates.map(({id,title,checks,dependsOn})=>({id,title,requiredAssertions:checks.length,dependsOn})),message:'Install applies infrastructure actions; complete performs separately reviewed source engineering. Neither grants launch acceptance.'};
  const directory=stateRoot(root);const configPath=resolve(directory,'config.json');
  if(args.command==='init'){
    requireThat(!existsSync(configPath),'Configuration already exists; no overwrite performed');
    atomicJson(configPath,readJson(resolve(packageRoot,'config.example.json')));return {status:'CONFIGURATION_CREATED',path:configPath};
  }
  if(args.command==='unlock'){unlock(directory,args.confirm);return {status:'UNLOCKED'};}
  requireThat(existsSync(configPath),'Run npm run launch:init first');
  const config=readJson(configPath);validateConfig(config,args.env,{complete:false});
  if(['install','deploy'].includes(args.command) && !args.apply)return {status:'PLAN_ONLY',actions:actionPlan(args),confirmation:`${args.command==='deploy'?'DEPLOY':'INSTALL'}:${args.env}:${config.environments[args.env].appwrite.projectId}`,mutations:false};
  if(args.command==='doctor' && !args.live){await toolchain();return {status:'LOCAL_DOCTOR_PASS',liveProvidersVerified:false,configPath};}
  assertRepository();assertClean();
  const context=candidate(config,args.env);let release;
  try{
    release=acquireLock(directory);
    if(args.command==='doctor'){await toolchain(true);return await auditProviders(config,args.env,resolve(directory,args.env,'doctor'));}
    if(args.command==='complete')return await complete(config,context,directory,args);
    if(['install','deploy'].includes(args.command))return await install(config,args,directory);
    if(args.command==='local')await verifyAll(config,context,directory,{...args,stage:'source'}),await verifyAll(config,context,directory,{...args,stage:'build'});
    if(args.command==='verify')await verifyAll(config,context,directory,args);
    const report=writeScorecard(directory,context);
    if(args.command==='gate')requireThat(report.decision==='READY_FOR_RELEASE_REVIEW','NOT_LAUNCH_READY: see the generated scorecard for missing, failed or stale evidence');
    return report;
  }finally{if(release)release();}
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{console.log(JSON.stringify(await main(),null,2));}catch(error){console.error(`LAUNCH BLOCKED: ${redact(error.message)}`);process.exitCode=1;}
}
