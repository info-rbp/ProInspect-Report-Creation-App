import { mkdtempSync,rmSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { run,root,atomicJson } from '../runtime.mjs';
import { assertTargetAuthority } from './runtime-authority.mjs';
export async function validateSource(context,directory){
  const parent=mkdtempSync(join(tmpdir(),'proinspect-validate-'));const checkout=resolve(parent,'checkout');let attached=false;
  const commands=[['npm',['ci','--ignore-scripts','--no-audit','--no-fund']],['npm',['run','check']],['npm',['run','test:emulator']],['npm',['run','test:e2e']],['npm',['run','security:scan']],['npm',['audit','--omit=dev','--audit-level=high']],['node',['infrastructure/upgrades/platform-completion-v1/performance-budget.mjs']]];
  try{
    await run('git',['worktree','add','--detach',checkout,context.commit],{cwd:root});attached=true;
    const authority=assertTargetAuthority(checkout);atomicJson(resolve(directory,'runtime-authority.json'),authority);
    for(let i=0;i<commands.length;i++)await run(commands[i][0],commands[i][1],{cwd:checkout,logFile:resolve(directory,`source-${i}.log`),timeoutMs:3600000});
    const result={commit:context.commit,validated:true,authority,commands:commands.map(([command,args])=>({command,args}))};atomicJson(resolve(directory,'source-validation.json'),result);return result;
  }finally{if(attached)await run('git',['worktree','remove','--force',checkout],{cwd:root});rmSync(parent,{recursive:true,force:true});}
}
