import { createHmac,randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { requireThat,hash,atomicJson,safePath,root } from '../runtime.mjs';
import { validateShopifyReplay } from '../configuration.mjs';
import { shopifyAudit,request } from '../providers.mjs';

export async function replayShopify(target,directory){
  const identity=await shopifyAudit(target.shopify);const replay=validateShopifyReplay(target);
  const secret=process.env[replay.secretEnv];requireThat(secret?.length>=16,'Supply the non-production webhook HMAC secret');
  const file=safePath(root,replay.fixture);const payload=JSON.parse(readFileSync(file,'utf8'));
  const bytes=JSON.stringify(payload);const id=randomUUID();const url=`${target.web.origin}${replay.path}`;
  const headers={'content-type':'application/json','x-shopify-shop-domain':target.shopify.domain,'x-shopify-topic':'orders/paid','x-shopify-webhook-id':id};
  const invalid=await fetch(url,{method:'POST',redirect:'error',signal:globalThis.AbortSignal.timeout(30000),headers:{...headers,'x-shopify-hmac-sha256':'invalid'},body:bytes});
  requireThat([401,403].includes(invalid.status),'Invalid Shopify HMAC was accepted');if(invalid.body)await invalid.body.cancel();
  const hmac=createHmac('sha256',secret).update(bytes).digest('base64');const results=[];
  for(let i=0;i<2;i++){
    const response=await request(url,{method:'POST',headers:{...headers,'x-shopify-hmac-sha256':hmac},body:bytes});
    requireThat(response.response.headers.get('content-type')?.includes('json'),'Webhook returned SPA fallback');
    const body=JSON.parse(response.text);results.push({status:response.response.status,body,sha256:hash(response.text),replayed:response.response.headers.get('x-proinspect-webhook-replayed')==='true'});
  }
  requireThat(results[0].body?.data?.accepted===true && !results[0].body?.data?.duplicate,'First synthetic Shopify delivery was not processed');
  requireThat(results[1].body?.data?.duplicate===true && results[1].replayed===true,'Duplicate Shopify delivery was not idempotently short-circuited');
  const result={identity,agencyId:replay.agencyId,path:replay.path,deliveryId:id,deliveries:results.map(({status,sha256,replayed})=>({status,sha256,replayed})),invalidDenied:true,duplicateBusinessEffectsVerified:true,shopifyStoreMutated:false,syntheticOnly:true};atomicJson(resolve(directory,'shopify-replay.json'),result);return result;
}
