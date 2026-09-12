import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MAX_BACKUP_FILE_BYTES } from '../actions/backup.mjs';
import { MAX_MIGRATION_FILE_BYTES } from '../actions/migrate.mjs';
import { runtimeArguments } from '../actions/google.mjs';
import { subscriptionState, requiredShopifyTopics } from '../actions/shopify-production.mjs';
import { validateCommandHelp, requireRuntimeKeyCreation, scopeArguments } from '../appwrite-contract.mjs';

const packageDir=resolve(import.meta.dirname,'..');
test('backup and migration bounds cover every configured Appwrite bucket',()=>{const buckets=JSON.parse(readFileSync(resolve(packageDir,'../../appwrite/buckets/buckets.json'),'utf8'));const max=Math.max(...buckets.map((bucket)=>bucket.maximumFileSize));assert(max<=MAX_BACKUP_FILE_BYTES);assert(max<=MAX_MIGRATION_FILE_BYTES);});
test('Google runtime deployment updates launch-owned env and secret bindings',()=>{const target={appwrite:{endpoint:'https://syd.cloud.appwrite.io/v1',projectId:'p',databaseId:'proinspect_core'},google:{environment:'staging',projectId:'g-project',runtimeBindings:{api:{env:{AUTH_PROVIDER:'appwrite',APPWRITE_BACKEND_MODE:'appwrite'},secretRefs:{APPWRITE_API_KEY:'appwrite-api:1'}}}}};const args=runtimeArguments(target,'api','a'.repeat(40));assert(args.includes('--update-env-vars'));assert(args.includes('--update-secrets'));assert(!args.includes('--set-env-vars'));assert(!args.includes('--set-secrets'));assert(!args.includes('--clear-secrets'));const env=args[args.indexOf('--update-env-vars')+1];assert.match(env,/APP_ENV=staging/);assert.match(env,/GOOGLE_CLOUD_PROJECT=g-project/);});
test('Shopify state reports missing and duplicate canonical subscriptions',()=>{const target={webhookUri:'https://app.proinspect.com.au/api/v1/integrations/shopify/webhooks/proinspect'};const nodes=requiredShopifyTopics.map((topic,index)=>({id:'gid://shopify/WebhookSubscription/'+index,topic,uri:target.webhookUri}));assert.deepEqual(subscriptionState(nodes,target).missing,[]);const duplicate=subscriptionState([...nodes,{...nodes[0],id:'gid://shopify/WebhookSubscription/duplicate'}],target);assert.equal(duplicate.duplicates.length,1);const missing=subscriptionState(nodes.slice(1),target);assert.deepEqual(missing.missing,[requiredShopifyTopics[0]]);});

test('Appwrite capability detection rejects parent help despite successful exit',async()=>{
  const parent='Usage:\n  appwrite project [flags]\n  appwrite project [command]\nAvailable Commands:\n  create-ephemeral-key\n';
  assert.throws(()=>validateCommandHelp(parent,['project','create-key'],['--project-id']),/lacks project create-key/);
  const calls=[];
  await assert.rejects(requireRuntimeKeyCreation('/private/context',async(exe,args,options)=>{calls.push({exe,args,options});return parent;}),/no mutation performed/);
  assert.deepEqual(calls.map(({exe,args})=>[exe,...args]),[['appwrite','project','create-key','--help']]);
});
test('Appwrite capability detection requires exact supported flags and repeated scopes',()=>{
  const help='Usage:\n  appwrite project create-ephemeral-key [flags]\nFlags:\n  --project-id string\n  --scopes stringArray\n  --duration int\n';
  assert.doesNotThrow(()=>validateCommandHelp(help,['project','create-ephemeral-key'],['--project-id','--scopes','--duration']));
  assert.throws(()=>validateCommandHelp(help,['project','create-ephemeral-key'],['--expire']),/lacks.*--expire/);
  assert.deepEqual(scopeArguments(['rows.read','files.read']),['--scopes','rows.read','--scopes','files.read']);
});
test('Appwrite retains target validation, raw inventory and guarded credential mutation',()=>{
  for(const relative of ['appwrite-session.mjs','actions/credentials.mjs','adapters/appwrite-cli.mjs'])assert(!readFileSync(resolve(packageDir,relative),'utf8').includes("['projects',"));
  const session=readFileSync(resolve(packageDir,'appwrite-session.mjs'),'utf8');
  assert(session.includes("['--raw'"));assert(session.includes("project.status === 'active' && project.region === 'syd'"));
  const credentials=readFileSync(resolve(packageDir,'actions/credentials.mjs'),'utf8');
  assert(credentials.indexOf('await requireRuntimeKeyCreation(cwd)')<credentials.indexOf("await cli(['project','delete-key'"));
});
