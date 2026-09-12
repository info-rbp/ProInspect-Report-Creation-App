import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { withAppwrite } from '../appwrite-session.mjs';

const target={endpoint:'https://syd.cloud.appwrite.io/v1',projectId:'proinspect-development',projectName:'ProInspect Development'};
const help='Usage:\n  appwrite project create-key [flags]\nFlags:\n  --project-id string\n  --scopes stringArray\n  --name string\n  --expire string\n';
function harness(overrides={}) {
  const calls=[];
  const execute=async(exe,args,options)=>{
    calls.push({exe,args,options});
    if(args.includes('--help'))return help;
    if(args.includes('get'))return JSON.stringify({$id:target.projectId,name:target.projectName,status:'active',region:'syd',...overrides.project});
    if(args.includes('create-key'))return JSON.stringify({$id:'test-key',secret:'unit-test-only-not-a-real-credential',scopes:['rows.read','files.read'],expire:new Date(Date.now()+3599000).toISOString(),...overrides.key});
    if(args.includes('delete-key')){if(overrides.revokeError)throw new Error('revocation failed');return '{}';}
    throw new Error('Unexpected command');
  };
  return {calls,execute};
}
test('temporary session verifies identity, preserves scopes, and revokes after operation failure',async()=>{
  const directory=mkdtempSync(resolve(tmpdir(),'appwrite-session-test-'));const {calls,execute}=harness();
  try {
    await assert.rejects(withAppwrite(target,directory,['rows.read','files.read'],async()=>{throw new Error('operation failed');},execute),/operation failed/);
    const creation=calls.find(({args})=>args.includes('create-key')&&!args.includes('--help'));
    assert.deepEqual(creation.args.slice(0,6),['--raw','--show-secrets','project','create-key','--project-id',target.projectId]);
    assert.deepEqual(creation.args.slice(8,12),['--scopes','rows.read','--scopes','files.read']);
    assert.equal(creation.args[6],'--name');assert.match(creation.args[7],/^launch-/);
    assert.equal(creation.args[12],'--expire');assert(Date.parse(creation.args[13])<=Date.now()+3600000);
    assert.equal(creation.options.sensitive,true);assert.equal(creation.options.logFile,undefined);
    assert(calls.at(-1).args.includes('delete-key'));
    const receipt=readFileSync(resolve(directory,'temporary-key.json'),'utf8');assert.equal(JSON.parse(receipt).revoked,true);assert(!receipt.includes('credential'));
  } finally {rmSync(directory,{recursive:true,force:true});}
});
test('invalid identity prevents key creation; unexpected key scope or lifetime still triggers cleanup',async()=>{
  for(const [overrides,message] of [[{project:{region:'fra'}},/identity mismatch/],[{key:{scopes:['rows.write']}},/scopes differ/],[{key:{expire:new Date(Date.now()+7200000).toISOString()}},/one-hour bound/]]) {
    const directory=mkdtempSync(resolve(tmpdir(),'appwrite-session-test-'));const {calls,execute}=harness(overrides);
    try {
      await assert.rejects(withAppwrite(target,directory,['rows.read','files.read'],async()=>assert.fail('Operation must not execute'),execute),message);
      assert.equal(calls.some(({args})=>args.includes('delete-key')),!overrides.project);
      if(overrides.project)assert(!calls.some(({args})=>args.includes('create-key')));
    } finally {rmSync(directory,{recursive:true,force:true});}
  }
});
test('failed revocation never records successful cleanup',async()=>{
  const directory=mkdtempSync(resolve(tmpdir(),'appwrite-session-test-'));const {execute}=harness({revokeError:true});
  try {
    await assert.rejects(withAppwrite(target,directory,['rows.read','files.read'],async()=>({ok:true}),execute),/revocation failed/);
    assert(existsSync(resolve(directory,'temporary-key.json')));assert.equal(JSON.parse(readFileSync(resolve(directory,'temporary-key.json'))).revoked,false);
  } finally {rmSync(directory,{recursive:true,force:true});}
});

test('pinned CLI without stored-key creation never falls back to ephemeral credentials',async()=>{
  const directory=mkdtempSync(resolve(tmpdir(),'appwrite-session-test-'));const {calls,execute}=harness();
  const pinned=async(exe,args,options)=>args.includes('--help')?'Usage:\n  appwrite project [flags]\nAvailable Commands:\n  create-ephemeral-key\n':execute(exe,args,options);
  try {
    await assert.rejects(withAppwrite(target,directory,['rows.read','files.read'],async()=>assert.fail('Operation must not execute'),pinned),/lacks project create-key/);
    assert.equal(calls.length,1);assert(calls[0].args.includes('get'));assert(!existsSync(resolve(directory,'temporary-key.json')));
  } finally {rmSync(directory,{recursive:true,force:true});}
});
