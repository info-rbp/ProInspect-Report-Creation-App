import { requireThat } from '../runtime.mjs';
import { request, shopifyAudit } from '../providers.mjs';

export const requiredShopifyTopics=['ORDERS_CREATE','ORDERS_PAID','ORDERS_UPDATED','ORDERS_CANCELLED','REFUNDS_CREATE'];
async function graphQl(target,query,variables={},env=process.env) {
  requireThat(target.tokenEnv==='SHOPIFY_ADMIN_ACCESS_TOKEN' && env[target.tokenEnv],'Approved Shopify Admin token environment is required');
  const {response,text}=await request(`https://${target.domain}/admin/api/${target.apiVersion}/graphql.json`,{
    method:'POST',headers:{'content-type':'application/json','X-Shopify-Access-Token':env[target.tokenEnv]},body:JSON.stringify({query,variables}),
  });
  const payload=JSON.parse(text);requireThat(!payload.errors?.length && payload.data,'Shopify GraphQL operation failed');
  requireThat(response.headers.get('x-shopify-api-version')===target.apiVersion,'Shopify API version fallback');return payload.data;
}
export async function auditShopifySubscriptions(target,env=process.env) {
  await shopifyAudit(target,{env});
  requireThat(typeof target.webhookUri==='string' && target.webhookUri.startsWith('https://'),'Approved Shopify webhook URI is required');
  const data=await graphQl(target,`query ProInspectReleaseWebhooks { webhookSubscriptions(first: 250) { nodes { id topic uri } } }`,{},env);
  const nodes=data.webhookSubscriptions?.nodes ?? [];requireThat(Array.isArray(nodes),'Shopify webhook inventory missing');
  const missing=requiredShopifyTopics.filter((topic)=>!nodes.some((item)=>item.topic===topic && item.uri===target.webhookUri));
  const legacy=nodes.filter((item)=>requiredShopifyTopics.includes(item.topic) && item.uri!==target.webhookUri).map(({id,topic,uri})=>({id,topic,uri}));
  return {domain:target.domain,webhookUri:target.webhookUri,missing,legacy,configured:requiredShopifyTopics.length-missing.length};
}
export async function reconcileShopifySubscriptions(target,env=process.env) {
  const before=await auditShopifySubscriptions(target,env);const created=[];
  for(const topic of before.missing) {
    const data=await graphQl(target,`mutation ProInspectReleaseWebhook($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) { webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) { webhookSubscription { id topic uri } userErrors { field message } } }`,{topic,webhookSubscription:{uri:target.webhookUri,format:'JSON'}},env);
    const result=data.webhookSubscriptionCreate;requireThat(result && !result.userErrors?.length && result.webhookSubscription?.id,`Shopify webhook creation failed for ${topic}`);created.push(result.webhookSubscription);
  }
  const after=await auditShopifySubscriptions(target,env);requireThat(after.missing.length===0,'Shopify production webhook subscriptions remain incomplete');
  return {created,configured:after.configured,legacySubscriptionsRetained:after.legacy,destructiveChanges:false};
}
