import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findWranglerVersion, singlePreviousVersion, deploymentBody } from '../actions/cloudflare.mjs';
import { validateProductionConfig, releaseStages } from '../release.mjs';

const packageDir=resolve(import.meta.dirname,'..');
function configured(){
  const config=JSON.parse(readFileSync(resolve(packageDir,'release.example.json'),'utf8'));
  const target=config.environments.production;const now=Date.now();
  target.appwrite.projectId='proinspect-production-v2';target.appwrite.projectName='ProInspect Production';
  target.appwrite.runtimeCredentialPolicies=target.google.services.map((service)=>({service,secretId:`appwrite-${service}`,expiryHours:24,scopes:['rows.read','rows.write']}));
  target.google.projectId='proinspect-production-gcp';
  for(const service of target.google.services){target.google.runtimeBindings[service].secretRefs={};}
  target.google.runtimeBindings.api.env.PUBLIC_API_BASE_URL='https://app.proinspect.example';
  target.google.runtimeBindings.api.env.WEB_APP_BASE_URL='https://app.proinspect.example';
  target.google.runtimeBindings.api.env.GOOGLE_CALENDAR_CLIENT_ID='calendar-client-id';
  target.google.runtimeBindings.api.env.GOOGLE_CALENDAR_REDIRECT_URI='https://app.proinspect.example/api/v1/integrations/google-calendar/oauth/callback';
  for(const key of ['CLOUDFLARE_ORIGIN_SECRET','SHOPIFY_WEBHOOK_SECRET','GOOGLE_CALENDAR_CLIENT_SECRET','INTEGRATION_TOKEN_ENCRYPTION_KEY','INTEGRATION_STATE_SECRET','AUTOMATION_RUNNER_SECRET'])target.google.runtimeBindings.api.secretRefs[key]=`${key.toLowerCase().replaceAll('_','-')}:1`;
  target.cloudflare.accountId='0123456789abcdef0123456789abcdef';target.cloudflare.workerName='proinspect-production-edge';target.cloudflare.apiOrigin='https://api-prod-7k3p6q.australia-southeast1.run.app';
  target.web.origin='https://app.proinspect.example';target.shopify.agencyId='proinspect-production';target.shopify.webhookUri='https://app.proinspect.example/api/v1/integrations/shopify/webhooks/proinspect-production';
  target.terraform.variablesFile='/tmp/proinspect-production.tfvars.json';target.terraform.backendFile='/tmp/proinspect-production.backend.json';target.migration.bundleDirectory='/tmp/proinspect-production-migration';target.migration.bundleSha256='a'.repeat(64);target.backup.directory='/tmp/proinspect-production-backup';target.backup.freezeApproved=true;
  config.releaseControl={productionMutationEnabled:false,approvedBy:'Release Owner',approvedAt:new Date(now-60000).toISOString(),approvedCommit:'b'.repeat(40),changeTicket:'CHG-123',releaseWindowStart:new Date(now-60000).toISOString(),releaseWindowEnd:new Date(now+3600000).toISOString(),rollbackWindowHours:24,supportOwner:'On-call owner',supportReady:true,legacyWriteFreezeApproved:true,finalMigrationDeltaApproved:true,legacyRetirementApproved:false};
  return config;
}

test('Production release stages are explicit and omit bulk deployment',()=>{assert.deepEqual(releaseStages,['terraform','credentials','backup','schema','data','files','google','cloudflare','shopify','verify']);});
test('Production configuration accepts dedicated four-provider targets',()=>assert.doesNotThrow(()=>validateProductionConfig(configured())));
test('Production configuration rejects legacy provider targets',()=>{const app=configured();app.environments.production.appwrite.projectId='6a911f1e0031e90015b2';assert.throws(()=>validateProductionConfig(app),/prohibited/i);const google=configured();google.environments.production.google.projectId='business-plan-applicatio-17047';assert.throws(()=>validateProductionConfig(google),/prohibited/i);const edge=configured();edge.environments.production.cloudflare.workerName='proinspect';assert.throws(()=>validateProductionConfig(edge),/Production Cloudflare|prohibited/i);});
test('Production mutation requires explicit enablement and active window',()=>{const config=configured();assert.throws(()=>validateProductionConfig(config,{forMutation:true}),/productionMutationEnabled/);config.releaseControl.productionMutationEnabled=true;assert.doesNotThrow(()=>validateProductionConfig(config,{forMutation:true}));assert.throws(()=>validateProductionConfig(config,{forMutation:true,now:Date.now()+10*3600000}),/outside/);});
test('Production Shopify webhook is pinned to the Cloudflare public edge',()=>{const config=configured();config.environments.production.shopify.webhookUri='https://api-prod-7k3p6q.australia-southeast1.run.app/webhook';assert.throws(()=>validateProductionConfig(config),/Cloudflare public API edge/);});
test('Cloudflare candidate version parser tolerates Wrangler JSON shapes',()=>{assert.deepEqual(findWranglerVersion([{id:'version-12345678',tag:'release-tag'}],'release-tag').id,'version-12345678');assert.equal(findWranglerVersion({versions:[{version_id:'version-87654321',metadata:{tag:'release-tag'}}]},'release-tag').id,'version-87654321');});
test('Cloudflare promotion requires one settled previous active version',()=>{const deployment={versions:[{version_id:'old-version',percentage:100}]};assert.equal(singlePreviousVersion(deployment),'old-version');assert.deepEqual(deploymentBody(deployment),{strategy:'percentage',versions:[{version_id:'old-version',percentage:100}]});assert.throws(()=>singlePreviousVersion({versions:[{version_id:'a',percentage:50},{version_id:'b',percentage:50}]}),/Settle/);});
