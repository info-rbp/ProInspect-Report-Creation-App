import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { installerCredentialFromEnvironment, validateInstallerCredential, withAppwrite } from '../appwrite-session.mjs';

const target={endpoint:'https://syd.cloud.appwrite.io/v1',projectId:'proinspect-development',projectName:'ProInspect Development'};
const requestedScopes=['rows.read','files.read'];
const environment={APPWRITE_INSTALLER_KEY_ID:'installer-key',APPWRITE_INSTALLER_KEY_SECRET:'unit-test-only-not-a-real-credential'};

function harness(overrides={}) {
  const calls=[];
  const key={$id:'installer-key',name:'launch-installer-development-test',scopes:requestedScopes,expire:new Date(Date.now()+3599000).toISOString(),...overrides.key};
  const execute=async(exe,args,options)=>{
    calls.push({exe,args,options});
    if(args.includes('list-keys'))return JSON.stringify({total:1,keys:[key],...overrides.inventory});
    if(args.includes('get'))return JSON.stringify({$id:target.projectId,name:target.projectName,status:'active',region:'syd',...overrides.project});
    if(args.includes('delete-key')){if(overrides.revokeError)throw new Error('revocation failed');return '{}';}
    throw new Error(`Unexpected command: ${args.join(' ')}`);
  };
  return {calls,execute,key};
}

test('operator-created installer session verifies identity and metadata, then revokes after operation failure',async()=>{
  const directory=mkdtempSync(resolve(tmpdir(),'appwrite-session-test-'));const {calls,execute}=harness();
  try {
    await assert.rejects(withAppwrite(target,directory,requestedScopes,async()=>{throw new Error('operation failed');},execute,environment),/operation failed/);
    assert.equal(calls.some(({args})=>args.includes('create-key')||args.includes('create-ephemeral-key')),false);
    assert(calls.some(({args})=>args.includes('list-keys')));
    assert(calls.at(-1).args.includes('delete-key'));
    const receipt=readFileSync(resolve(directory,'temporary-key.json'),'utf8');
    assert.equal(JSON.parse(receipt).revoked,true);
    assert.equal(JSON.parse(receipt).source,'operator-created');
    assert(!receipt.includes(environment.APPWRITE_INSTALLER_KEY_SECRET));
  } finally {rmSync(directory,{recursive:true,force:true});}
});

test('missing operator credential fails before inventory or mutation',async()=>{
  const directory=mkdtempSync(resolve(tmpdir(),'appwrite-session-test-'));const {calls,execute}=harness();
  try {
    await assert.rejects(withAppwrite(target,directory,requestedScopes,async()=>assert.fail('Operation must not execute'),execute,{}),/APPWRITE_INSTALLER_KEY_ID/);
    assert.equal(calls.some(({args})=>args.includes('list-keys')||args.includes('delete-key')),false);
  } finally {rmSync(directory,{recursive:true,force:true});}
});

test('invalid identity or installer key metadata fails without deleting a key',async()=>{
  for(const [overrides,message] of [
    [{project:{region:'fra'}},/identity mismatch/],
    [{key:{name:'unrelated-key'}},/name prefix/],
    [{key:{scopes:['rows.write']}},/scopes differ/],
    [{key:{expire:new Date(Date.now()+7200000).toISOString()}},/within one hour/],
  ]) {
    const directory=mkdtempSync(resolve(tmpdir(),'appwrite-session-test-'));const {calls,execute}=harness(overrides);
    try {
      await assert.rejects(withAppwrite(target,directory,requestedScopes,async()=>assert.fail('Operation must not execute'),execute,environment),message);
      assert.equal(calls.some(({args})=>args.includes('delete-key')),false);
    } finally {rmSync(directory,{recursive:true,force:true});}
  }
});

test('failed revocation never records successful cleanup',async()=>{
  const directory=mkdtempSync(resolve(tmpdir(),'appwrite-session-test-'));const {execute}=harness({revokeError:true});
  try {
    await assert.rejects(withAppwrite(target,directory,requestedScopes,async()=>({ok:true}),execute,environment),/revocation failed/);
    assert(existsSync(resolve(directory,'temporary-key.json')));
    assert.equal(JSON.parse(readFileSync(resolve(directory,'temporary-key.json'),'utf8')).revoked,false);
  } finally {rmSync(directory,{recursive:true,force:true});}
});

test('credential helpers reject incomplete and excessive operator inputs',()=>{
  assert.throws(()=>installerCredentialFromEnvironment({}),/APPWRITE_INSTALLER_KEY_ID/);
  assert.doesNotThrow(()=>validateInstallerCredential({$id:'key',name:'launch-installer-development-test',scopes:requestedScopes,expire:new Date(Date.now()+3500000).toISOString()},requestedScopes));
  assert.throws(()=>validateInstallerCredential({$id:'key',name:'launch-installer-development-test',scopes:requestedScopes,expire:new Date(Date.now()+7200000).toISOString()},requestedScopes),/within one hour/);
});
