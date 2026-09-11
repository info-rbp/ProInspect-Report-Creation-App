import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { packageRoot,readJson,root } from '../runtime.mjs';
import { checkpointEvaluation,makeIssue,openIssues,syncIssueLedger } from '../operator.mjs';
import { validateShopifyReplay } from '../configuration.mjs';

const baseCandidate={commit:'a'.repeat(40),tree:'b'.repeat(40),manifestHash:'c'.repeat(64),schemaHash:'d'.repeat(64),configHash:'e'.repeat(64),environment:'development',dirty:false};

test('operator issues have stable IDs and explicit severities',()=>{
  const a=makeIssue({environment:'development',stage:'shopify',code:'SHOPIFY_REPLAY',message:'missing'});
  const b=makeIssue({environment:'development',stage:'shopify',code:'SHOPIFY_REPLAY',message:'different detail'});
  const warning=makeIssue({environment:'development',stage:'preflight',code:'DEVICE',severity:'WARNING',message:'pending'});
  assert.equal(a.id,b.id);assert.equal(a.severity,'BLOCKER');assert.equal(warning.severity,'WARNING');
  assert.match(a.remediation,/Shopify|shopify/u);assert.match(a.recheck,/launch:check/u);
});

test('issue ledger resolves only the scanned stage',()=>{
  const directory=mkdtempSync(join(tmpdir(),'launch-ledger-'));
  try{
    const source=makeIssue({environment:'development',stage:'source',code:'AUTHORITY',message:'blocked'});
    const shopify=makeIssue({environment:'development',stage:'shopify',code:'SHOPIFY_REPLAY',message:'blocked'});
    syncIssueLedger(directory,'development',baseCandidate,[source,shopify],['*']);
    syncIssueLedger(directory,'development',baseCandidate,[],['shopify']);
    const open=openIssues(directory,'development');
    assert.deepEqual(open.map((item)=>item.stage),['source']);
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('checkpoints are exact, invalidated or durable-recheck according to candidate drift',()=>{
  const current={...baseCandidate};
  const changedConfig={...baseCandidate,configHash:'f'.repeat(64)};
  assert.equal(checkpointEvaluation({stage:'source',status:'PASS',candidate:current},current).status,'CURRENT');
  assert.equal(checkpointEvaluation({stage:'source',status:'PASS',candidate:current},changedConfig).status,'INVALIDATED');
  assert.equal(checkpointEvaluation({stage:'schema',status:'PASS',candidate:current},changedConfig).status,'RECHECK_REQUIRED');
});

test('Shopify replay is deterministic, tracked and bound to the acceptance secret',()=>{
  const config=readJson(resolve(packageRoot,'config.example.json'));
  const target=config.environments.development;
  const replay=validateShopifyReplay(target);
  assert.equal(replay.agencyId,'dev_agency');
  assert.equal(replay.path,'/api/v1/integrations/shopify/webhooks/dev_agency');
  assert.equal(replay.secretEnv,target.acceptance.shopifyWebhookSecretEnv);
  assert.ok(readFileSync(resolve(root,replay.fixture),'utf8').includes('DEV-LAUNCH-0001'));
  assert.throws(()=>validateShopifyReplay({...target,shopify:{...target.shopify,replay:{...target.shopify.replay,agencyId:'dev_other'}}}),/dev_agency/u);
});

test('Appwrite API exposes Shopify aliases and collection transforms',()=>{
  const adapter=readFileSync(resolve(root,'apps/api/src/backend/appwriteAdapters.ts'),'utf8');
  assert.match(adapter,/inspectionServiceMappings:\s*'shopify_service_mappings'/u);
  assert.match(adapter,/integrationSyncExceptions:\s*'integration_exceptions'/u);
  assert.match(adapter,/appwriteCollectionWriteData/u);
  assert.match(adapter,/appwriteCollectionReadData/u);
});

test('package exposes all guided execution commands',()=>{
  const pkg=readJson(resolve(root,'package.json'));
  for(const id of ['launch:preflight','launch:check','launch:issues','launch:reconcile','launch:repair'])assert.equal(typeof pkg.scripts[id],'string');
});

test('diagnostic issues use executable diagnostic recheck commands',()=>{
  const preflight=makeIssue({environment:'development',stage:'preflight',code:'CONFIGURATION',message:'missing'});
  const reconciliation=makeIssue({environment:'staging',stage:'reconcile',code:'WORKTREE_DIRTY',message:'dirty'});
  assert.equal(preflight.recheck,'npm run launch:preflight -- --all');
  assert.equal(reconciliation.recheck,'npm run launch:reconcile -- --env staging --stage all');
});

test('reconciliation treats ledger blockers as blocking',()=>{
  const source=readFileSync(resolve(packageRoot,'operator.mjs'),'utf8').replace(/\s+/gu,' ');
  assert.match(source,/issues\.some\(\(item\) => item\.severity === 'BLOCKER'\)/u);
});

test('preflight and reconciliation preserve issue-ledger scope',()=>{
  const source=readFileSync(resolve(packageRoot,'operator.mjs'),'utf8').replace(/\s+/gu,'');
  assert.ok(source.includes("syncIssueLedger(directory,environment,context,issues,['preflight'])"));
  assert.ok(source.includes("syncIssueLedger(directory,environment,context,issues,['reconcile',...scanned])"));
});
