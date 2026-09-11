import { requireThat } from '../runtime.mjs';
import { request, shopifyAudit } from '../providers.mjs';

export const requiredShopifyTopics=['ORDERS_CREATE','ORDERS_PAID','ORDERS_UPDATED','ORDERS_CANCELLED','REFUNDS_CREATE'];
async function graphQl(target,query,variables={},env=process.env) {
  requireThat(target.tokenEnv==='SHOPIFY_ADMIN_ACCESS_TOKEN' && env[target.tokenEnv],'Approved Shopify Admin token environment is required');
  const {response,text}=await request('https://'+target.domain+'/admin/api/'+target.apiVersion+'/graphql.json',{method:'POST',headers:{'content-type':'application/json','X-Shopify-Access-Token':env[target.tokenEnv]},body:JSON.stringify({query,variables})});
  const payload=JSON.parse(text);requireThat(!payload.errors?.length && payload.data,'Shopify GraphQL operation failed');requireThat(response.headers.get('x-shopify-api-version')===target.apiVersion,'Shopify API version fallback');return payload.data;
}
export function subscriptionState(nodes,target){
  requireThat(Array.isArray(nodes),'Shopify webhook inventory missing');const missing=[];const duplicates=[];
  for(const topic of requiredShopifyTopics){const exact=nodes.filter((item)=>item.topic===topic&&item.uri===target.webhookUri);if(exact.length===0)missing.push(topic);if(exact.length>1)duplicates.push({topic,count:exact.length,ids:exact.map((item)=>item.id)});}
  const legacy=nodes.filter((item)=>requiredShopifyTopics.includes(item.topic)&&item.uri!==target.webhookUri).map(({id,topic,uri})=>({id,topic,uri}));
  return {missing,duplicates,legacy,configured:requiredShopifyTopics.length-missing.length};
}
export async function auditShopifySubscriptions(target,env=process.env) {
  await shopifyAudit(target,{env});requireThat(typeof target.webhookUri==='string'&&target.webhookUri.startsWith('https://'),'Approved Shopify webhook URI is required');
  const nodes=[];let after=null;const cursors=new Set();
  for(let page=0;page<100;page+=1){const data=await graphQl(target,`query ProInspectReleaseWebhooks($after: String) { webhookSubscriptions(first: 250, after: $after) { nodes { id topic uri } pageInfo { hasNextPage endCursor } } }`,{after},env);const connection=data.webhookSubscriptions;requireThat(Array.isArray(connection?.nodes)&&connection?.pageInfo,'Shopify webhook connection is invalid');nodes.push(...connection.nodes);if(!connection.pageInfo.hasNextPage)break;const next=connection.pageInfo.endCursor;requireThat(typeof next==='string'&&next&&!cursors.has(next),'Shopify webhook pagination did not advance');cursors.add(next);after=next;if(page===99)throw new Error('Shopify webhook inventory exceeded pagination safety limit');}
  requireThat(new Set(nodes.map((item)=>item.id)).size===nodes.length,'Shopify webhook inventory contains duplicate IDs');return {domain:target.domain,webhookUri:target.webhookUri,...subscriptionState(nodes,target),total:nodes.length};
}
export async function reconcileShopifySubscriptions(target,env=process.env) {
  const before=await auditShopifySubscriptions(target,env);requireThat(before.duplicates.length===0,'Duplicate Production webhook subscriptions require owner-reviewed cleanup before release');const created=[];
  for(const topic of before.missing){const data=await graphQl(target,`mutation ProInspectReleaseWebhook($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) { webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) { webhookSubscription { id topic uri } userErrors { field message } } }`,{topic,webhookSubscription:{uri:target.webhookUri,format:'JSON'}},env);const result=data.webhookSubscriptionCreate;requireThat(result&&!result.userErrors?.length&&result.webhookSubscription?.id,'Shopify webhook creation failed for '+topic);created.push(result.webhookSubscription);}
  const after=await auditShopifySubscriptions(target,env);requireThat(after.missing.length===0&&after.duplicates.length===0,'Shopify Production webhook subscriptions remain incomplete or duplicated');return {created,configured:after.configured,legacySubscriptionsRetained:after.legacy,destructiveChanges:false};
}
