import { mkdirSync,writeFileSync,readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { manifest,root,packageRoot,run,requireThat,verifyIntegrity,git,hash,filesUnder } from './runtime.mjs';
import { workpack } from './workpacks.mjs';
export async function complete(config,context,directory,args){
  const gates=args.stage && args.stage!=='all'?manifest.gates.filter((g)=>g.id===args.stage):manifest.gates.filter((g)=>g.kind==='adapter');
  requireThat(gates.length,'Unknown completion stage');const folder=resolve(directory,'workpacks');mkdirSync(folder,{recursive:true,mode:0o700});
  const protectedSnapshot=()=>hash(filesUnder(packageRoot).map((p)=>[p,hash(readFileSync(resolve(packageRoot,p)))]));const before=protectedSnapshot();
  for(const gate of gates){
    const text=workpack(gate.id,config,context);writeFileSync(resolve(folder,`${gate.id}.md`),text,{mode:0o600});
    if(args.execute){
      requireThat(args.confirm==='SOURCE_EDITS_ONLY','Code generation requires --confirm SOURCE_EDITS_ONLY');
      await run('codex',['exec','--sandbox','workspace-write','-'],{cwd:root,input:text,timeoutMs:3600000,logFile:resolve(folder,`${gate.id}.log`)});
      requireThat(protectedSnapshot()===before,'Completion changed installer controls; review the diff before proceeding');verifyIntegrity();
      const removed=git(['diff','--name-only','--diff-filter=D']);requireThat(!/test|spec/u.test(removed),'Completion removed tests; review before proceeding');
      await run('npm',['run','check'],{cwd:root,timeoutMs:3600000,logFile:resolve(folder,`${gate.id}-check.log`)});
    }
  }
  return {workpacks:folder,sourceEngineeringExecuted:Boolean(args.execute),requiresReviewAndCommit:Boolean(args.execute),launchAcceptanceGranted:false};
}
