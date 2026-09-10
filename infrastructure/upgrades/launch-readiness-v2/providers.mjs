import { Buffer } from 'node:buffer';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { atomicJson, requireThat, run, manifest, validateConfig, redact } from './runtime.mjs';

// No provider mutation is performed by this module. Tokens never enter URLs or results.
export async function request(url, options = {}, fetcher = fetch) {
  const response = await fetcher(url, { ...options, redirect: 'error', signal: globalThis.AbortSignal.timeout(30_000) });
  requireThat(response.ok, `HTTP ${response.status} from ${new URL(url).origin}; response body suppressed.`);
  const chunks = []; let size = 0;
  if (response.body) for await (const chunk of response.body) { size += chunk.length; requireThat(size <= 2 * 1024 * 1024, 'Provider response exceeded 2 MiB.'); chunks.push(Buffer.from(chunk)); }
  return { response, text: Buffer.concat(chunks).toString('utf8') };
}
export async function shopifyAudit(target, { env = process.env, fetcher = fetch } = {}) {
  requireThat(target.domain === 'proinspect-2.myshopify.com' && target.apiVersion === '2026-07', 'Unapproved Shopify target.');
  const token = env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  requireThat(token?.trim(), 'SHOPIFY_ADMIN_ACCESS_TOKEN is required for the read-only Shopify check.');
  const { response, text } = await request(`https://${target.domain}/admin/api/${target.apiVersion}/graphql.json`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query: 'query ProInspectLaunchIdentity { shop { id name myshopifyDomain } }' }),
  }, fetcher);
  const value = JSON.parse(text);
  requireThat(!value.errors?.length && value.data?.shop?.myshopifyDomain === target.domain, 'Shopify identity query failed or returned another shop.');
  requireThat(response.headers.get('x-shopify-api-version') === target.apiVersion, 'Shopify API version fallback detected. Review the pinned integration before continuing.');
  return { domain: value.data.shop.myshopifyDomain, shopId: value.data.shop.id, apiVersion: target.apiVersion, readOnly: true, workflowAccepted: false };
}
export async function cloudflareAudit(target, { env = process.env, fetcher = fetch, allowUndeployed = false } = {}) {
  requireThat(/^[a-f0-9]{32}$/iu.test(target.accountId) && /^[a-zA-Z0-9_-]+$/u.test(target.workerName), 'Invalid Cloudflare target.');
  requireThat(env.CLOUDFLARE_API_TOKEN?.trim(), 'CLOUDFLARE_API_TOKEN with Workers Scripts Read is required for the read-only check.');
  if (allowUndeployed) {
    const inventory = await request(`https://api.cloudflare.com/client/v4/accounts/${target.accountId}/workers/scripts`, { headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` } }, fetcher);
    const payload = JSON.parse(inventory.text);
    requireThat(payload.success === true && Array.isArray(payload.result), 'Cloudflare account/Workers inventory could not be verified.');
    if (!payload.result.some((worker) => worker.id === target.workerName)) return { accountId: target.accountId, workerName: target.workerName, notYetDeployed: true, readOnly: true, workflowAccepted: false };
  }
  const { text } = await request(`https://api.cloudflare.com/client/v4/accounts/${target.accountId}/workers/scripts/${target.workerName}/deployments`, { headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` } }, fetcher);
  const value = JSON.parse(text);
  requireThat(value.success === true && Array.isArray(value.result?.deployments) && value.result.deployments.length > 0, 'No verifiable Cloudflare deployment exists for this Worker.');
  const active = value.result.deployments[0];
  return { accountId: target.accountId, workerName: target.workerName, deploymentId: active.id, versions: (active.versions ?? []).map(({ version_id, percentage }) => ({ id: version_id, percentage })), readOnly: true, workflowAccepted: false };
}
export async function googleAudit(target, execute = run, { allowUndeployed = false } = {}) {
  requireThat(target.projectId && !manifest.prohibited.googleProjects.includes(target.projectId), 'Unapproved Google project.');
  const project = JSON.parse(await execute('gcloud', ['projects', 'describe', target.projectId, '--format=json'], { live: true, quiet: true, timeoutMs: 60_000 }));
  requireThat(project.projectId === target.projectId && project.lifecycleState === 'ACTIVE', 'Google project is not the declared active target.');
  requireThat(project.labels?.environment === target.environment, 'Google project environment label does not match the declared Development/Staging environment.');
  const inventory = allowUndeployed ? JSON.parse(await execute('gcloud', ['run', 'services', 'list', '--project', target.projectId, '--region', target.region, '--format=json'], { live: true, quiet: true, timeoutMs: 60_000 })) : null;
  if (allowUndeployed) requireThat(Array.isArray(inventory), 'Cloud Run service inventory is invalid.');
  const services = [];
  for (const name of target.services) {
    if (inventory && !inventory.some((service) => service.metadata?.name === name)) { services.push({ name, notYetDeployed: true }); continue; }
    const value = JSON.parse(await execute('gcloud', ['run', 'services', 'describe', name, '--project', target.projectId, '--region', target.region, '--format=json'], { live: true, quiet: true, timeoutMs: 60_000 }));
    requireThat(value.metadata?.name === name, 'Cloud Run service identity mismatch.');
    const containers = value.spec?.template?.spec?.containers ?? [];
    const ready = (value.status?.conditions ?? []).some((c) => c.type === 'Ready' && c.status === 'True');
    requireThat(ready && value.status?.latestReadyRevisionName, `Cloud Run service ${name} is not Ready.`);
    services.push({ name, revision: value.status.latestReadyRevisionName, images: containers.map((c) => c.image), dataAuthorityDeclared: containers.some((c) => (c.env ?? []).some((v) => ['PROINSPECT_DATA_AUTHORITY', 'APPWRITE_BACKEND_MODE'].includes(v.name) && v.value === 'appwrite')) });
  }
  return { projectId: target.projectId, region: target.region, services, readOnly: true, workflowAccepted: false };
}
export async function appwriteAudit(target, directory, execute = run) {
  requireThat(!process.env.APPWRITE_API_KEY, 'APPWRITE_API_KEY must be unset. Use the authenticated Appwrite CLI account.');
  requireThat(target.projectId && !manifest.prohibited.appwriteProjects.includes(target.projectId), 'Unapproved Appwrite project.');
  const cwd = resolve(directory, 'appwrite-context');
  mkdirSync(cwd, { recursive: true, mode: 0o700 });
  atomicJson(resolve(cwd, 'appwrite.config.json'), { projectId: target.projectId, projectName: target.projectName, endpoint: target.endpoint });
  const value = JSON.parse(await execute('appwrite', ['--json', 'project', 'get', '--project-id', target.projectId], { cwd, live: true, quiet: true, timeoutMs: 60_000 }));
  requireThat(value.$id === target.projectId && value.name === target.projectName && value.status === 'active' && value.region === 'syd', 'Appwrite did not return the approved active Sydney project.');
  return { projectId: value.$id, name: value.name, region: value.region, readOnly: true, schemaAccepted: false };
}
export async function auditProviders(config, environment, directory, { allowUndeployed = false } = {}) {
  const target = validateConfig(config, environment);
  const checks = {}; const errors = {};
  const operations = { appwrite: () => appwriteAudit(target.appwrite, directory), cloudflare: () => cloudflareAudit(target.cloudflare, { allowUndeployed }), google: () => googleAudit(target.google, run, { allowUndeployed }), shopify: () => shopifyAudit(target.shopify) };
  for (const [name, operation] of Object.entries(operations)) {
    try { checks[name] = await operation(); console.log(`PASS ${name} authenticated target inventory (not workflow acceptance)`); }
    catch (error) { errors[name] = redact(error.message); console.log(`BLOCKED ${name}: ${errors[name]}`); }
  }
  atomicJson(resolve(directory, 'provider-inventory.json'), { capturedAt: new Date().toISOString(), environment, checks, errors });
  requireThat(Object.keys(errors).length === 0, 'Provider preflight is incomplete. See the private provider-inventory.json. No deployment was performed.');
  return checks;
}
export async function edgeAcceptance(target, commit, fetcher = fetch) {
  const health = await request(`${target.origin}${target.healthPath}`, {}, fetcher);
  requireThat(health.response.headers.get('content-type')?.includes('json'), 'Health endpoint did not return JSON.');
  const healthData = JSON.parse(health.text);
  const revision = target.revisionField.split('.').reduce((value, key) => value?.[key], healthData);
  requireThat(revision === commit, 'Deployed API release does not match the candidate SHA.');
  const routes = [];
  for (const portal of ['admin', 'inspector', 'building', 'strata', 'resident', 'client', 'contractor']) {
    const page = await request(`${target.origin}/${portal}`, {}, fetcher);
    requireThat(page.response.headers.get('content-type')?.includes('text/html') && /id=["']root["']/u.test(page.text), `Portal route /${portal} did not return the application shell.`);
    requireThat(page.response.headers.get('strict-transport-security') && page.response.headers.get('x-content-type-options') === 'nosniff' && page.response.headers.get('content-security-policy'), `Missing security headers on /${portal}.`);
    routes.push({ portal, status: page.response.status });
  }
  const denied = await fetcher(`${target.origin}${target.deniedPath}`, { redirect: 'error', signal: globalThis.AbortSignal.timeout(30_000) });
  requireThat([401, 403].includes(denied.status), 'Anonymous API access was not denied. A 200 SPA fallback is not a passing API response.');
  if (denied.body) await denied.body.cancel();
  return { release: revision, routes, anonymousStatus: denied.status, shellOnly: true };
}
