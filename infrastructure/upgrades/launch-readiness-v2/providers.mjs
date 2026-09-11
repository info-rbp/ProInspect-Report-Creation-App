import { Buffer } from 'node:buffer';
import { resolve } from 'node:path';
import { atomicJson, requireThat, run, validateConfig, redact, hash, canonical, manifest } from './runtime.mjs';
import { appwriteContext } from './appwrite-session.mjs';
import { googleIdentity } from './actions/google.mjs';
import { cfRequest } from './actions/cloudflare.mjs';

export async function request(url,options={},fetcher=fetch) {
  const response=await fetcher(url,{...options,redirect:'error',signal:globalThis.AbortSignal.timeout(30000)});
  requireThat(response.ok,`HTTP ${response.status} from ${new URL(url).origin}; body suppressed`);
  const chunks=[];let size=0;
  if(response.body) for await(const chunk of response.body) {size+=chunk.length;requireThat(size<=2097152,'Response exceeds 2 MiB');chunks.push(Buffer.from(chunk));}
  return {response,text:Buffer.concat(chunks).toString('utf8')};
}
export async function shopifyAudit(target,{env=process.env,fetcher=fetch}={}) {
  requireThat(target.domain==='proinspect-2.myshopify.com' && target.apiVersion==='2026-07','Unapproved Shopify target');
  requireThat(env.SHOPIFY_ADMIN_ACCESS_TOKEN,'Shopify Admin token required');
  const {response,text}=await request(`https://${target.domain}/admin/api/${target.apiVersion}/graphql.json`,{method:'POST',headers:{'content-type':'application/json','X-Shopify-Access-Token':env.SHOPIFY_ADMIN_ACCESS_TOKEN},body:JSON.stringify({query:'query { shop { id myshopifyDomain } }'})},fetcher);
  const result=JSON.parse(text);requireThat(!result.errors && result.data?.shop?.myshopifyDomain===target.domain,'Shopify shop identity mismatch');
  requireThat(response.headers.get('x-shopify-api-version')===target.apiVersion,'Shopify API version fallback');
  return {shopId:result.data.shop.id,domain:target.domain,readOnly:true};
}
export async function appwriteAudit(target,directory) { const {project}=await appwriteContext(target,directory); return {projectId:project.$id,name:project.name}; }
export async function googleAudit(target) {
  await googleIdentity(target);
  const services=JSON.parse(await run('gcloud',['services','list','--enabled','--project',target.projectId,'--format=json'],{live:true,sensitive:true}));
  const enabled=services.map((v)=>v.config?.name).filter(Boolean).sort();
  requireThat(target.requiredApis.every((id)=>enabled.includes(id)), 'Required Google Cloud API is not enabled');
  return {projectId:target.projectId,region:target.region,requiredApis:[...target.requiredApis],enabledRequiredApis:target.requiredApis.filter((id)=>enabled.includes(id))};
}
export async function auditProviders(config,environment,directory) {
  const target=validateConfig(config,environment);const results={};const errors={};
  requireThat(canonical([...config.providerStack].sort())===canonical([...manifest.providerStack].sort()),'Unexpected provider stack');
  const calls={appwrite:()=>appwriteAudit(target.appwrite,directory),google:()=>googleAudit(target.google),cloudflare:async()=>{const scripts=await cfRequest(target.cloudflare,'/workers/scripts');return {accountId:target.cloudflare.accountId,workerName:target.cloudflare.workerName,workerPresent:scripts.some((s)=>s.id===target.cloudflare.workerName),readOnly:true};},shopify:()=>shopifyAudit(target.shopify)};
  for(const [id,call] of Object.entries(calls)) {try{results[id]=await call();}catch(error){errors[id]=redact(error.message);}}
  atomicJson(resolve(directory,'provider-inventory.json'),{results,errors});requireThat(!Object.keys(errors).length,`Provider checks failed: ${Object.keys(errors).join(', ')}; see private inventory`);return results;
}
export async function edgeAcceptance(target,commit,fetcher=fetch) {
  const health=await request(`${target.origin}${target.healthPath}`,{},fetcher);
  requireThat(health.response.headers.get('content-type')?.includes('json'),'Health response is not JSON');
  const actual=target.revisionField.split('.').reduce((v,k)=>v?.[k],JSON.parse(health.text));requireThat(actual===commit,'Backend candidate mismatch');
  const edge=await request(`${target.origin}/__launch/revision`,{},fetcher);requireThat(JSON.parse(edge.text).commit===commit,'Edge candidate mismatch');
  const routes=[];
  for(const portal of ['admin','inspector','building','strata','resident','client','contractor']) {
    const page=await request(`${target.origin}/${portal}`,{},fetcher);
    requireThat(page.response.headers.get('content-type')?.includes('text/html') && /id=["']root["']/u.test(page.text),'Portal shell missing');
    requireThat(page.response.headers.get('strict-transport-security') && page.response.headers.get('content-security-policy') && page.response.headers.get('x-content-type-options')==='nosniff','Security headers missing');
    routes.push({portal,bodySha256:hash(page.text)});
  }
  const denial=await fetcher(`${target.origin}${target.deniedPath}`,{redirect:'error',signal:globalThis.AbortSignal.timeout(30000)});
  requireThat([401,403].includes(denial.status),'Anonymous API access was not denied');if(denial.body)await denial.body.cancel();
  return {commit:actual,routes,anonymousStatus:denial.status,shellOnly:true};
}
export async function toolchain(live=false) {
  requireThat(process.versions.node.split('.')[0]==='22','Node 22 is required');
  const versions={node:process.versions.node};
  if(live) {
    const {manifest}=await import('./runtime.mjs');
    requireThat(process.versions.node===manifest.requiredToolchain.node,`Remote operations require Node ${manifest.requiredToolchain.node}`);
    for(const [exe,key] of [['npm','npm'],['appwrite','appwrite']]) {
      const value=await run(exe,['--version'],{timeoutMs:30000});const version=value.match(/\d+\.\d+\.\d+/u)?.[0];requireThat(version===manifest.requiredToolchain[key],`Wrong ${exe} version`);versions[key]=version;
    }
    const wrangler=await run('npx',['--no-install','wrangler','--version'],{timeoutMs:30000});versions.wrangler=wrangler.match(/\d+\.\d+\.\d+/u)?.[0];requireThat(versions.wrangler===manifest.requiredToolchain.wrangler,`Wrong Wrangler version; require ${manifest.requiredToolchain.wrangler}`);
    const terraform=JSON.parse(await run('terraform',['version','-json'],{timeoutMs:30000}));requireThat(/^\d+\.\d+\.\d+/u.test(terraform.terraform_version ?? ''),'Terraform CLI is unavailable or invalid');versions.terraform=terraform.terraform_version;
    const gcloud=await run('gcloud',['--version'],{timeoutMs:30000});versions.gcloud=gcloud.match(/Google Cloud SDK\s+([0-9.]+)/u)?.[1];requireThat(versions.gcloud,'Google Cloud CLI is unavailable or invalid');
    const gitVersion=await run('git',['--version'],{timeoutMs:30000});versions.git=gitVersion.match(/\d+\.\d+(?:\.\d+)?/u)?.[0];requireThat(versions.git,'Git CLI is unavailable or invalid');
  }
  return versions;
}
