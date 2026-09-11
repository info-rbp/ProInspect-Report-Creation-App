import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root=resolve(import.meta.dirname,'../../../..');
const config=JSON.parse(readFileSync(resolve(root,'infrastructure/upgrades/launch-readiness-v2/config.example.json'),'utf8'));
const gates=JSON.parse(readFileSync(resolve(root,'infrastructure/upgrades/launch-readiness-v2/gates.json'),'utf8'));

test('every non-Appwrite adapter scenario statically covers only declared gate assertions',()=>{
  for(const gate of gates.filter((item)=>item.kind==='adapter'&&item.id!=='appwrite')){
    const path=config.scenarioFiles[gate.id];assert.equal(typeof path,'string',gate.id+' scenario path missing');const source=readFileSync(resolve(root,path),'utf8');
    for(const match of source.matchAll(/probe\.check\(\s*['"]([^'"]+)['"]/gu))assert(gate.checks.includes(match[1]),gate.id+' emits undeclared assertion '+match[1]);
    if(!source.includes('probe.input.gate.checks'))for(const id of gate.checks)assert(source.includes("'"+id+"'")||source.includes('"'+id+'"'),gate.id+' scenario does not cover '+id);
  }
});
