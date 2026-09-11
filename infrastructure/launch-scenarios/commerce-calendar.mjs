import { Buffer } from 'node:buffer';
import { run, requireThat } from '../upgrades/launch-readiness-v2/runtime.mjs';
import { shopifyAudit } from '../upgrades/launch-readiness-v2/providers.mjs';
import { applyExternalChecks, actionState } from './common.mjs';
export async function runScenario(probe) {
  const target=probe.input.target; const shop=await shopifyAudit(target.shopify); const services=JSON.parse(await run('gcloud',['services','list','--enabled','--project',target.google.projectId,'--format=json'],{live:true,sensitive:true})); const names=new Set(services.map((v)=>v.config?.name));
  requireThat(names.has('calendar-json.googleapis.com'),'Google Calendar API is not enabled in the configured Google Cloud project');
  const replay=actionState('shopify'); requireThat(replay?.status==='SUCCEEDED' && replay.result?.shopifyStoreMutated===false,'Synthetic Shopify installation replay is missing or unsafe');
  applyExternalChecks(probe,probe.input,probe.input.gate.checks,['automated-test']);
  probe.artifact('commerce-providers.json',Buffer.from(JSON.stringify({shopify:{domain:shop.domain,shopId:shop.shopId},googleProjectId:target.google.projectId,calendarApi:true,syntheticReplay:replay.completedAt})));
}
