import { Buffer } from 'node:buffer';
import { run, requireThat } from '../upgrades/launch-readiness-v2/runtime.mjs';
import { shopifyAudit } from '../upgrades/launch-readiness-v2/providers.mjs';
import { applyExternalChecks, currentAction } from './common.mjs';
export async function runScenario(probe) {
  const target=probe.input.target; const shop=await shopifyAudit(target.shopify); const services=JSON.parse(await run('gcloud',['services','list','--enabled','--project',target.google.projectId,'--format=json'],{live:true,sensitive:true})); const names=new Set(services.map((v)=>v.config?.name));
  requireThat(names.has('calendar-json.googleapis.com'),'Google Calendar API is not enabled in the configured Google Cloud project');
  const replay=currentAction('shopify',probe.input); requireThat(replay.result?.shopifyStoreMutated===false,'Synthetic Shopify installation replay is missing or unsafe');
  probe.check('authenticated_exact_shop',shop.domain===target.shopify.domain&&Boolean(shop.shopId),true);
  probe.check('no_live_webhook_switch',replay.result.shopifyStoreMutated===false,true);
  applyExternalChecks(probe,probe.input,probe.input.gate.checks.filter((id)=>!['authenticated_exact_shop','no_live_webhook_switch'].includes(id)),['automated-test']);
  probe.artifact('commerce-providers.json',Buffer.from(JSON.stringify({shopify:{domain:shop.domain,shopId:shop.shopId},googleProjectId:target.google.projectId,calendarApi:true,syntheticReplay:replay.completedAt})));
}
