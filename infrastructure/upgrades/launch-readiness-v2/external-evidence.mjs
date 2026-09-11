#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { approvedConfig, privateDirectory } from './configuration.mjs';
import { assertClean, assertRepository, atomicJson, candidate, hash, manifest, readJson, redact, requireThat, root, safePath, stateRoot } from './runtime.mjs';

const producerKinds=new Set(['automated-test','physical-device','migration-rehearsal','operations-rehearsal','staging-rehearsal']);
export function permittedKinds(gate){
  if(gate.mode==='device')return new Set(['physical-device']);
  if(gate.id==='migration'||gate.id==='files')return new Set(['automated-test','migration-rehearsal']);
  if(gate.id==='operations')return new Set(['automated-test','operations-rehearsal']);
  if(gate.id==='rehearsal')return new Set(['staging-rehearsal']);
  return new Set(['automated-test']);
}
function parse(argv){
  const out={env:'development'};
  for(let i=0;i<argv.length;i+=1){const key=argv[i];requireThat(['--env','--gate','--input','--approved-by'].includes(key),'Unknown launch:evidence argument: '+key);requireThat(argv[i+1] && !argv[i+1].startsWith('--'),'Missing value for '+key);out[key.slice(2).replace('approved-by','approvedBy')]=argv[++i];}
  requireThat(['development','staging'].includes(out.env),'External evidence capture is non-production only');
  requireThat(out.gate && out.input && out.approvedBy?.trim().length>=3,'Use --gate, --input and --approved-by');
  return out;
}
function targets(target){return {appwriteProjectId:target.appwrite.projectId,googleProjectId:target.google.projectId,cloudflareAccountId:target.cloudflare.accountId,cloudflareWorker:target.cloudflare.workerName,shopifyDomain:target.shopify.domain,webOrigin:target.web.origin};}
function privateFile(path){requireThat(typeof path==='string'&&isAbsolute(path),'Evidence input must be an absolute private path');const absolute=resolve(path);const directory=privateDirectory(dirname(absolute));return safePath(directory,basename(absolute));}
export function validateCaptureInput(input,gate){
  requireThat(input.schemaVersion===1&&input.producer&&input.checks&&Array.isArray(input.artifacts)&&input.artifacts.length>0,'Invalid evidence capture input');
  requireThat(producerKinds.has(input.producer.kind)&&permittedKinds(gate).has(input.producer.kind),'Evidence producer kind is not permitted for this gate');
  requireThat(typeof input.producer.command==='string'&&input.producer.command.trim().length>=3&&!/--(?:password|secret|token|api-?key)\b/iu.test(input.producer.command),'Producer command is missing or contains credential arguments');
  const observed=Date.parse(input.observedAt);requireThat(Number.isFinite(observed)&&observed<=Date.now()&&Date.now()-observed<=24*3600000,'Producer observation is stale or future-dated');
  const ids=Object.keys(input.checks);requireThat(ids.length>0&&ids.every((id)=>gate.checks.includes(id)&&input.checks[id]===true),'Evidence checks must be named gate assertions with true results');
  requireThat(new Set(ids).size===ids.length,'Duplicate evidence checks');
  return true;
}
export function capture(argv=process.argv.slice(2)){
  const args=parse(argv);assertRepository();assertClean();
  const configPath=resolve(stateRoot(root),'config.json');requireThat(existsSync(configPath),'Run launch:init and complete private configuration first');
  const config=readJson(configPath);const target=approvedConfig(config,args.env);const context=candidate(config,args.env);
  const gate=manifest.gates.find((value)=>value.id===args.gate);requireThat(gate&&gate.kind==='adapter'&&gate.mode!=='local','Gate does not accept external evidence');if(gate.id==='rehearsal')requireThat(args.env==='staging','Rehearsal evidence is Staging-only');
  const inputPath=privateFile(args.input);const raw=readFileSync(inputPath,'utf8');requireThat(redact(raw)===raw,'Evidence input contains a credential-like value');const input=JSON.parse(raw);validateCaptureInput(input,gate);
  const artifactRoot=privateDirectory(input.artifactDirectory);const evidenceRoot=privateDirectory(target.acceptance.evidenceDirectory);mkdirSync(evidenceRoot,{recursive:true,mode:0o700});const artifacts=[];
  for(const item of input.artifacts){requireThat(typeof item==='string'&&!isAbsolute(item)&&item.length>0,'Artifact paths must be relative');const source=safePath(artifactRoot,item);const bytes=readFileSync(source);requireThat(bytes.length>0&&bytes.length<=20*1024*1024,'Evidence artifact is empty or exceeds 20 MiB');if(!bytes.includes(0)){const text=bytes.toString('utf8');requireThat(redact(text)===text,'Evidence artifact contains a credential-like value');}
    const digest=hash(bytes);const safeName=basename(item).replace(/[^A-Za-z0-9._-]/gu,'_');const relativePath=args.gate+'/artifacts/'+digest+'-'+safeName;const destination=safePath(evidenceRoot,relativePath,{mustExist:false});mkdirSync(dirname(destination),{recursive:true,mode:0o700});if(existsSync(destination))requireThat(hash(readFileSync(destination))===digest,'Existing evidence artifact conflicts');else writeFileSync(destination,bytes,{mode:0o600,flag:'wx'});artifacts.push({path:relativePath,sha256:digest});
  }
  const bundle={schemaVersion:1,gateId:gate.id,environment:args.env,candidateCommit:context.commit,configHash:context.configHash,targets:targets(target),approvedBy:args.approvedBy.trim(),observedAt:new Date(input.observedAt).toISOString(),producer:{kind:input.producer.kind,command:input.producer.command.trim()},checks:input.checks,artifacts};
  atomicJson(resolve(evidenceRoot,gate.id+'.json'),bundle);return {status:'EVIDENCE_CAPTURED',gateId:gate.id,environment:args.env,candidateCommit:context.commit,checks:Object.keys(input.checks).length,artifacts:artifacts.length,path:resolve(evidenceRoot,gate.id+'.json')};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{console.log(JSON.stringify(capture(),null,2));}catch(error){console.error('EVIDENCE BLOCKED: '+redact(error.message));process.exitCode=1;}}
