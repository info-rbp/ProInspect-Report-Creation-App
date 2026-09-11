import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MAX_BACKUP_FILE_BYTES } from '../actions/backup.mjs';
import { MAX_MIGRATION_FILE_BYTES } from '../actions/migrate.mjs';
import { runtimeArguments } from '../actions/google.mjs';
import { subscriptionState, requiredShopifyTopics } from '../actions/shopify-production.mjs';

const packageDir=resolve(import.meta.dirname,'..');
test('backup and migration bounds cover every configured Appwrite bucket',()=>{const buckets=JSON.parse(readFileSync(resolve(packageDir,'../../appwrite/buckets/buckets.json'),'utf8'));const max=Math.max(...buckets.map((bucket)=>bucket.maximumFileSize));assert(max<=MAX_BACKUP_FILE_BYTES);assert(max<=MAX_MIGRATION_FILE_BYTES);});
test('Google runtime deployment replaces env and secret sets',()=>{const target={appwrite:{endpoint:'https://syd.cloud.appwrite.io/v1',projectId:'p',databaseId:'proinspect_core'},google:{environment:'staging',projectId:'g-project',runtimeBindings:{api:{env:{AUTH_PROVIDER:'appwrite',APPWRITE_BACKEND_MODE:'appwrite'},secretRefs:{APPWRITE_API_KEY:'appwrite-api:1'}}}}};const args=runtimeArguments(target,'api','a'.repeat(40));assert(args.includes('--set-env-vars'));assert(args.includes('--set-secrets'));assert(!args.includes('--update-env-vars'));assert(!args.includes('--update-secrets'));const env=args[args.indexOf('--set-env-vars')+1];assert.match(env,/APP_ENV=staging/);assert.match(env,/GOOGLE_CLOUD_PROJECT=g-project/);});
test('Shopify state reports missing and duplicate canonical subscriptions',()=>{const target={webhookUri:'https://app.proinspect.com.au/api/v1/integrations/shopify/webhooks/proinspect'};const nodes=requiredShopifyTopics.map((topic,index)=>({id:'gid://shopify/WebhookSubscription/'+index,topic,uri:target.webhookUri}));assert.deepEqual(subscriptionState(nodes,target).missing,[]);const duplicate=subscriptionState([...nodes,{...nodes[0],id:'gid://shopify/WebhookSubscription/duplicate'}],target);assert.equal(duplicate.duplicates.length,1);const missing=subscriptionState(nodes.slice(1),target);assert.deepEqual(missing.missing,[requiredShopifyTopics[0]]);});

test('Appwrite console administration uses the projects CLI service',()=>{for(const relative of ['appwrite-session.mjs','actions/credentials.mjs','adapters/appwrite-cli.mjs']){const source=readFileSync(resolve(packageDir,relative),'utf8');assert(!source.includes("['project','get'"));assert(!source.includes("['project','create-key'"));assert(!source.includes("['project','delete-key'"));assert(!source.includes("['project','list-keys'"));assert(!source.includes("['project','list-platforms'"));assert(!source.includes("['project','create-platform'"));}const session=readFileSync(resolve(packageDir,'appwrite-session.mjs'),'utf8');assert(session.includes("['projects','get'"));assert(session.includes("['projects','create-key'"));assert(session.includes("['projects','list-platforms'"));});
