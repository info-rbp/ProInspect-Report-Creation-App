import { assert, manifest, output } from './lib.mjs';

export function developmentIntegrationChecks({ env = process.env, requireIntegrations = false, readProject = () => output('gcloud', ['config', 'get-value', 'project']), log = console.log } = {}) {
  const expectedShop = manifest.development.shopifyStore;
  for (const name of ['SHOPIFY_STORE_DOMAIN', 'SHOPIFY_SHOP_DOMAIN']) {
    const shop = env[name]?.trim().toLowerCase();
    if (shop) assert(shop === expectedShop, `${name} must be ${expectedShop}; found ${shop}.`);
  }

  const expectedGoogle = env.GOOGLE_CLOUD_PROJECT?.trim();
  if (expectedGoogle) {
    assert(!manifest.development.prohibitedGoogleCloudProjectIds.includes(expectedGoogle), 'Prohibited Production Google Cloud project selected.');
    let configured;
    try { configured = readProject(); }
    catch { throw new Error('GOOGLE_CLOUD_PROJECT is set but the authenticated gcloud project could not be read.'); }
    assert(configured && configured !== '(unset)', 'gcloud has no active project.');
    assert(configured === expectedGoogle, `gcloud project ${configured} does not match GOOGLE_CLOUD_PROJECT ${expectedGoogle}.`);
  }

  // A declared store or matching local gcloud configuration establishes only a
  // target guard. Neither proves authenticated integration or worker acceptance.
  // This package has no live integration acceptance runner yet, so fail closed.
  const integrations = { shopify: false, google: false };
  log('INFO Stage 09 Shopify and Stage 10 Google Cloud remain READY: live Development integration acceptance is pending.');
  assert(!requireIntegrations, 'Integrated UAT requires live Shopify and Google Development acceptance evidence; target declarations alone are insufficient.');
  return integrations;
}
