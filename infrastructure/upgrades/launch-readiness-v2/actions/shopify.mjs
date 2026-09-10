import { createHmac,randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { requireThat,hash,atomicJson,safePath,root } from '../runtime.mjs';
import { shopifyAudit,request } from '../providers.mjs';

export async function replayShopify(target,directory){
  const identity=await shopifyAudit(target.shopify);const replay=target.shopify.replay;
  requireThat(replay?.syntheticOnly===true && replay.agencyId?.startsWith('dev_'),'An isolated synthetic Development agency is required for replay');
  requireThat(typeof replay.path==='string' && /^\/api\//u.test(replay.path) && !/[?#\\]/u.test(replay.path),'Invalid configured webhook path');
  const secret=process.env[replay.secretEnv];requireThat(secret?.length>=16,'Supply the non-production webhook HMAC secret');
  const file=safePath(root,replay.fixture);const payload=JSON.parse(readFileSync(file,'utf8'));
  requireThat(payload.test===true && !payload.customer && !payload.email && !payload.shipping_address,'Only non-customer test fixtures are permitted');
  const bytes=JSON.stringify(payload);const id=randomUUID();const url=`${target.web.origin}${replay.path}`;
  const headers={'content-type':'application/json','x-shopify-shop-domain':target.shopify.domain,'x-shopify-topic':'orders/paid','x-shopify-webhook-id':id,'x-agency-id':replay.agencyId};
  const invalid=await fetch(url,{method:'POST',redirect:'error',signal:globalThis.AbortSignal.timeout(30000),headers:{...headers,'x-shopify-hmac-sha256':'invalid'},body:bytes});
  requireThat([401,403].includes(invalid.status),'Invalid Shopify HMAC was accepted');if(invalid.body)await invalid.body.cancel();
  const hmac=createHmac('sha256',secret).update(bytes).digest('base64');const results=[];
  for(let i=0;i<2;i++){
    const response=await request(url,{method:'POST',headers:{...headers,'x-shopify-hmac-sha256':hmac},body:bytes});
    requireThat(response.response.headers.get('content-type')?.includes('json'),'Webhook returned SPA fallback');results.push({status:response.response.status,sha256:hash(response.text)});
  }
  const result={identity,deliveryId:id,deliveries:results,invalidDenied:true,duplicateBusinessEffectsVerified:false,shopifyStoreMutated:false};atomicJson(resolve(directory,'shopify-replay.json'),result);return result;
}
