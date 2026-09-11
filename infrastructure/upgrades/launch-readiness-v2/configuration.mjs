import { isAbsolute, resolve } from 'node:path';
import { manifest, root, readJson, safePath, git, requireThat, canonical } from './runtime.mjs';

function containsSensitiveFixtureKey(value) {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, item]) =>
    /^(?:customer|email|phone|shipping_address|billing_address|access_token|token|secret|password)$/iu.test(key)
      || containsSensitiveFixtureKey(item),
  );
}

export function validateShopifyReplay(target) {
  const replay = target?.shopify?.replay;
  requireThat(replay?.syntheticOnly === true, 'Shopify replay must be explicitly synthetic-only');
  requireThat(replay.agencyId === 'dev_agency', 'Shopify replay must use the deterministic synthetic dev_agency fixture');
  requireThat(/^[A-Z][A-Z0-9_]*$/u.test(replay.secretEnv ?? ''), 'Shopify replay HMAC secret must be an environment-variable reference');
  requireThat(replay.secretEnv === target.acceptance?.shopifyWebhookSecretEnv, 'Shopify replay and acceptance must use the same webhook-secret environment variable');
  requireThat(typeof replay.fixture === 'string', 'Shopify replay fixture path is required');
  const fixturePath = safePath(root, replay.fixture);
  git(['ls-files', '--error-unmatch', '--', replay.fixture]);
  const payload = readJson(fixturePath);
  requireThat(payload?.test === true && !containsSensitiveFixtureKey(payload), 'Shopify replay fixture must be synthetic and contain no customer/contact/credential data');
  requireThat(Array.isArray(payload.line_items) && payload.line_items.length === 1, 'Shopify replay fixture must contain exactly one deterministic synthetic line item');
  const line = payload.line_items[0];
  requireThat(String(line.product_id) === '90000000000021' && String(line.variant_id) === '90000000000022' && line.sku === 'DEV-ROUTINE', 'Shopify replay fixture identity drifted from the seeded synthetic service mapping');
  return {
    agencyId: replay.agencyId,
    fixture: replay.fixture,
    secretEnv: replay.secretEnv,
    path: `/api/v1/integrations/shopify/webhooks/${encodeURIComponent(replay.agencyId)}`,
  };
}

export function validateConfig(config, environment, { complete = true } = {}) {
  requireThat(config.schemaVersion === 1 && ['development', 'staging'].includes(environment), 'Unsupported configuration/environment');
  const inspect = (value, parent = '') => {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (/(password|secret|api.?key|access.?token)/iu.test(key) && !key.endsWith('Env') && !['secretRefs','secretId','approvedRuntimeKeys'].includes(key) && parent !== 'secretRefs') requireThat(item === null, `Secret values are forbidden in configuration: ${key}`);
      inspect(item, key);
    }
  };
  inspect(config);
  requireThat(canonical([...(config.providerStack ?? [])].sort())===canonical([...manifest.providerStack].sort()), 'Deployment provider stack must be exactly Appwrite, Google Cloud, Cloudflare and Shopify');
  const scenarioGateIds=manifest.gates.filter((g)=>g.kind==='adapter' && g.id!=='appwrite').map((g)=>g.id);
  requireThat(config.scenarioFiles && scenarioGateIds.every((id)=>typeof config.scenarioFiles[id]==='string'), 'Every non-Appwrite live/device gate requires a tracked scenario module');
  const target = config.environments?.[environment]; const app = target?.appwrite;
  requireThat(app?.endpoint === 'https://syd.cloud.appwrite.io/v1' && app.databaseId === 'proinspect_core', 'Unapproved Appwrite endpoint/database');
  requireThat(!manifest.prohibited.appwriteProjects.includes(app.projectId), 'Production Appwrite target is prohibited');
  requireThat(!manifest.prohibited.googleProjects.includes(target.google?.projectId), 'Production Google target is prohibited');
  requireThat(!manifest.prohibited.cloudflareWorkers.includes(target.cloudflare?.workerName), 'Production Worker is prohibited');
  if (environment === 'development') requireThat(app.projectId === 'proinspect-development' && app.projectName === 'ProInspect Development', 'Unexpected Development target');
  else if (app.projectId) requireThat(app.projectId !== 'proinspect-development', 'Staging cannot use Development');
  requireThat(target.shopify?.domain === 'proinspect-2.myshopify.com' && target.shopify.apiVersion === '2026-07' && target.shopify.tokenEnv === 'SHOPIFY_ADMIN_ACCESS_TOKEN', 'Unexpected Shopify target');
  if (!complete) return target;
  requireThat(config.approvedBy?.trim().length >= 3, 'Configuration requires named approval');
  for (const value of [app.projectId, app.projectName, target.google.projectId, target.cloudflare.accountId, target.cloudflare.workerName, target.web.origin]) requireThat(typeof value === 'string' && value.trim() && !/REPLACE|example\.|<|>/iu.test(value), 'A real approved target value is missing');
  requireThat(/^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u.test(app.projectId), 'Invalid Appwrite project ID');
  if (environment === 'staging') requireThat(/staging/iu.test(app.projectName) && !/(?:prod|production)/iu.test(app.projectName), 'Staging Appwrite project name must explicitly identify Staging and cannot identify Production');
  requireThat(/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/u.test(target.google.projectId), 'Invalid Google project ID');
  requireThat(target.google.environment === environment && /^[a-z]+-[a-z]+[0-9]$/u.test(target.google.region), 'Invalid Google environment/region');
  requireThat(Array.isArray(target.google.services) && new Set(target.google.services).size === target.google.services.length && ['api','pdf-worker','document-worker','notification-worker','dashboard-worker','integration-worker'].every((id) => target.google.services.includes(id)), 'Declare the six existing deployable services');
  requireThat(target.google.aiRuntime === 'api', 'Standalone AI deployment requires a reviewed entrypoint and infrastructure change');
  for (const service of ['api','pdf-worker','notification-worker','dashboard-worker','document-worker','integration-worker']) { const binding=target.google.runtimeBindings?.[service]; requireThat(binding?.env?.AUTH_PROVIDER==='appwrite'&&binding.env.APPWRITE_BACKEND_MODE==='appwrite'&&binding.secretRefs&&typeof binding.secretRefs==='object'&&!Array.isArray(binding.secretRefs), `Missing Appwrite runtime binding for ${service}`); }
  requireThat(Array.isArray(target.google.requiredApis) && manifest.requiredGoogleApis.every((id)=>target.google.requiredApis.includes(id)), 'Google Cloud must enable the required Cloud Run/build/secrets/monitoring/logging/Calendar APIs');
  requireThat(isAbsolute(target.acceptance?.evidenceDirectory ?? '') && Number.isInteger(target.acceptance?.evidenceMaxAgeHours) && target.acceptance.evidenceMaxAgeHours>=1 && target.acceptance.evidenceMaxAgeHours<=manifest.evidenceMaxAgeHours, 'Configure a private bounded acceptance evidence directory');
  requireThat(/^[A-Z][A-Z0-9_]*$/u.test(target.acceptance.seedPasswordEnv ?? '') && /^[A-Z][A-Z0-9_]*$/u.test(target.acceptance.shopifyWebhookSecretEnv ?? ''), 'Acceptance secrets must be environment-variable references');
  validateShopifyReplay(target);
  for(const path of [target.acceptance.operationsRunbook,target.acceptance.cutoverRunbook]) { requireThat(typeof path==='string','Acceptance runbook path missing'); safePath(root,path); git(['ls-files','--error-unmatch','--',path]); }
  requireThat(/^[a-f0-9]{32}$/iu.test(target.cloudflare.accountId), 'Invalid Cloudflare account');
  requireThat(/^[A-Z][A-Z0-9_]*$/u.test(target.cloudflare.trustedEdgeSecretEnv ?? ''), 'Cloudflare origin secret must be referenced by an environment-variable name');
  requireThat(typeof target.cloudflare.contentSecurityPolicy === 'string' && target.cloudflare.contentSecurityPolicy.includes("object-src 'none'") && target.cloudflare.contentSecurityPolicy.includes("frame-ancestors 'none'") && !/default-src\s+\*/iu.test(target.cloudflare.contentSecurityPolicy), 'Cloudflare CSP must explicitly block objects/framing and cannot use a wildcard default source');
  requireThat(/^[a-z0-9_-]+$/u.test(target.cloudflare.workerName) && (environment === 'development' ? /(?:^|[-_])(dev|development)(?:$|[-_])/u : /(?:^|[-_])staging(?:$|[-_])/u).test(target.cloudflare.workerName), 'Use an environment-specific Worker');
  for (const name of ['origin']) {
    const url = new URL(target.web[name]);
    requireThat((environment === 'development' ? /(?:^|[.-])(dev|development)(?:[.-]|$)/u : /(?:^|[.-])staging(?:[.-]|$)/u).test(url.hostname), 'Use an explicitly non-production hostname');
    requireThat(url.protocol === 'https:' && url.origin === target.web[name] && !url.username, 'Web origin must be exact HTTPS');
  }
  for (const name of ['healthPath','deniedPath']) requireThat(/^\/(?!\/)[^?#\\]*$/u.test(target.web[name]), 'Unsafe web path');
  requireThat(/^[A-Za-z][A-Za-z0-9_.]*$/u.test(target.web.revisionField), 'Invalid revision field');
  if (environment === 'staging') {
    const dev = config.environments.development;
    requireThat(target.google.projectId !== dev.google.projectId && target.cloudflare.workerName !== dev.cloudflare.workerName && target.web.origin !== dev.web.origin, 'Staging targets must be isolated');
  }
  return target;
}
export function approvedConfig(config, environment) {
  const target = validateConfig(config, environment);
  const policy = safePath(root, config.policyDocument); git(['ls-files', '--error-unmatch', '--', config.policyDocument]);
  const data = readJson(policy);
  for (const key of Object.keys(readJson(resolve(root, 'infrastructure/upgrades/launch-readiness-v2/policy.example.json')))) {
    const item = data[key]; requireThat(item?.decision?.trim().length >= 15 && !/TODO|UNDECIDED/iu.test(item.decision), `Missing policy: ${key}`);
    requireThat(item.approvedBy?.trim().length >= 3 && Number.isFinite(Date.parse(item.approvedAt)) && Date.parse(item.approvedAt) <= Date.now(), `Missing dated policy approval: ${key}`);
  }
  return target;
}
export function targetEnv(target) {
  const values = { APPWRITE_ENDPOINT: target.appwrite.endpoint, APPWRITE_PROJECT_ID: target.appwrite.projectId, APPWRITE_PROJECT_NAME: target.appwrite.projectName, GOOGLE_CLOUD_PROJECT: target.google.projectId, CLOUDFLARE_ACCOUNT_ID: target.cloudflare.accountId, SHOPIFY_STORE_DOMAIN: target.shopify.domain, SHOPIFY_SHOP_DOMAIN: target.shopify.domain };
  for (const [key,value] of Object.entries(values)) if (process.env[key]) requireThat(process.env[key] === value, `Conflicting target in ${key}`);
  for (const key of ['GCLOUD_PROJECT','CLOUDSDK_CORE_PROJECT']) if (process.env[key]) requireThat(process.env[key] === target.google.projectId, `Conflicting target in ${key}`);
  return values;
}
export function privateDirectory(path) {
  requireThat(typeof path === 'string' && isAbsolute(path) && resolve(path) !== root && !resolve(path).startsWith(`${root}/`), 'Use an absolute private directory outside the checkout');
  return resolve(path);
}
