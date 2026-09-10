import { dirname,resolve } from 'node:path';
import { mkdirSync,writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { readJson,safePath,atomicJson } from './runtime.mjs';
export function acceptance(env=process.env) {
  if(!env.PROINSPECT_LAUNCH_INPUT || !env.PROINSPECT_LAUNCH_OUTPUT)throw new Error('Run through launch:verify');
  const input=readJson(env.PROINSPECT_LAUNCH_INPUT);const directory=dirname(env.PROINSPECT_LAUNCH_OUTPUT);const checks=[];const artifacts=[];
  return {input,check(id,observed,expected){if(checks.some((c)=>c.id===id))throw new Error('Duplicate check');checks.push({id,observed,expected,status:isDeepStrictEqual(observed,expected)?'PASS':'FAIL'});},
    artifact(name,bytes){const path=safePath(directory,name,{mustExist:false});mkdirSync(dirname(path),{recursive:true,mode:0o700});writeFileSync(path,bytes,{mode:0o600});artifacts.push(name);},
    finish(){const failed=checks.filter((c)=>c.status!=='PASS').length;const result={schemaVersion:1,runId:input.runId,candidate:input.candidate,mode:input.gate.mode,mocked:false,failed,skipped:0,checks,artifacts};atomicJson(resolve(env.PROINSPECT_LAUNCH_OUTPUT),result);if(failed)process.exitCode=1;return result;}};
}
